/**
 * Demo backend tests.
 *
 * The demo must follow the same rules as the SQL functions (tests/db covers those). Every test
 * starts from a freshly seeded demo (see src/test/setup.ts).
 */

import { describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo';
import { DEMO_CAFE, DEMO_CATEGORIES, DEMO_PRODUCTS, DEMO_STAFF, DEMO_TABLES } from './seedData';
import { ApiError, type CartLineInput } from './types';

const api = createDemoBackend();
const MIN = 60_000;

const outcome = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof ApiError ? e.code : String(e)));
const asGuest = (id: string) => localStorage.setItem('stolic.demo.guest', id);
const line = (productId: string, qty = 1, choices: Record<string, string> = {}): CartLineInput => ({ productId, qty, choices, note: '' });

async function signIn(staffId: string) {
  return api.demoSignIn(staffId);
}

describe('QR code → menu', () => {
  it('opens the menu of the right table, or room', async () => {
    const table = await api.loadTable('demo-sto-7');
    expect(table?.table).toMatchObject({ number: 7, kind: 'table' });
    expect(table?.products.length).toBeGreaterThan(10);
    const room = await api.loadTable('demo-soba-214');
    expect(room?.table).toMatchObject({ number: 214, kind: 'room' });
    expect(await api.loadTable('nope')).toBeNull();
  });
});

describe('ordering', () => {
  it('prices on the "server", not from the cart, and shows the order to the guest and the waiters', async () => {
    asGuest('g1');
    // Kapućino 260 + large 60 + oat milk 50 = 370, twice.
    const id = await api.placeOrder('demo-sto-7', [line('p2', 2, { size: 'l', milk: 'oat' })], 'Bez šećera');
    const [mine] = await api.myOrders('demo-sto-7');
    expect(mine).toMatchObject({ id, status: 'pending', total: 740, tableNumber: 7, tableKind: 'table', note: 'Bez šećera' });

    await signIn('ana');
    const all = await api.cafeOrders('demo-lipa');
    expect(all.find((o) => o.id === id)).toMatchObject({ status: 'pending', tableNumber: 7 });
  });

  it('room orders are room service', async () => {
    asGuest('g2');
    const id = await api.placeOrder('demo-soba-214', [line('p1')], '');
    const [mine] = await api.myOrders('demo-soba-214');
    expect(mine).toMatchObject({ id, tableNumber: 214, tableKind: 'room' });
  });

  it('applies the same limits as the database', async () => {
    asGuest('g3');
    expect(await outcome(api.placeOrder('demo-sto-1', [], ''))).toBe('empty_order');
    expect(await outcome(api.placeOrder('demo-sto-1', Array.from({ length: 41 }, () => line('p1')), ''))).toBe('too_many_items');
    expect(await outcome(api.placeOrder('demo-sto-1', [line('p1', 1.5)], ''))).toBe('invalid_quantity');
    expect(await outcome(api.placeOrder('demo-sto-1', [line('p1', 51)], ''))).toBe('invalid_quantity');
    expect(await outcome(api.placeOrder('demo-sto-1', [line('p13')], ''))).toBe('product_unavailable');
    expect(await outcome(api.placeOrder('demo-sto-1', [line('nope')], ''))).toBe('unknown_product');
    expect(await outcome(api.placeOrder('nope', [line('p1')], ''))).toBe('invalid_table');
    await api.placeOrder('demo-sto-1', [line('p1')], '');
    expect(await outcome(api.placeOrder('demo-sto-1', [line('p1')], ''))).toBe('too_fast');
  });

  it('respects "one order at a time" when the café turns repeats off', async () => {
    await signIn('jelena');
    const settings = await api.cafeSettings('demo-lipa');
    const { id: _id, slug: _slug, ...input } = settings;
    await api.updateCafe('demo-lipa', { ...input, allowRepeat: false });
    asGuest('g4');
    await api.placeOrder('demo-sto-2', [line('p1')], '');
    const db = JSON.parse(localStorage.getItem('stolic.demo.db.v1')!);
    for (const o of db.orders) if (o.guestId === 'g4') o.createdAt -= MIN; // past the five-second limit
    localStorage.setItem('stolic.demo.db.v1', JSON.stringify(db));
    expect(await outcome(api.placeOrder('demo-sto-2', [line('p1')], ''))).toBe('order_in_progress');
  });
});

describe('waiter workflow', () => {
  it('accept → extend → ready → served, with the guest seeing each step', async () => {
    asGuest('g5');
    const id = await api.placeOrder('demo-sto-5', [line('p1')], '');
    await signIn('ana');
    expect(await api.acceptOrder(id, 10)).toBe('ok');
    let [o] = await api.myOrders('demo-sto-5');
    expect(o.status).toBe('preparing');
    expect(o.prepMinutes).toBe(10);
    expect(o.deadline! - o.acceptedAt!).toBe(10 * MIN);
    expect(o.waiterName).toBe('Ana Petrović');

    expect(await outcome(api.extendOrder(id, 0))).toBe('invalid_minutes');
    expect(await outcome(api.extendOrder(id, 61))).toBe('invalid_minutes');
    await api.extendOrder(id, 5);
    [o] = await api.myOrders('demo-sto-5');
    expect(o.prepMinutes).toBe(15);
    expect(o.estimateUpdatedAt).not.toBeNull();

    await api.markReady(id);
    await api.markServed(id);
    [o] = await api.myOrders('demo-sto-5');
    expect(o.status).toBe('served');
    expect(await outcome(api.markReady(id))).toBe('invalid_status');
  });

  it('two waiters accepting at once: one gets it, the other is told it is taken', async () => {
    asGuest('g6');
    const id = await api.placeOrder('demo-sto-6', [line('p1')], '');
    await signIn('marko');
    const results = await Promise.all([api.acceptOrder(id, 5), api.acceptOrder(id, 8), api.rejectOrder(id, 'duplicate')]);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'taken')).toHaveLength(2);
  });

  it('validates the minutes and needs a signed-in staff member', async () => {
    asGuest('g7');
    const id = await api.placeOrder('demo-sto-8', [line('p1')], '');
    expect(await outcome(api.acceptOrder(id, 5))).toBe('forbidden');
    await signIn('ana');
    expect(await outcome(api.acceptOrder(id, 0))).toBe('invalid_minutes');
    expect(await outcome(api.acceptOrder(id, 2.5))).toBe('invalid_minutes');
    expect(await api.rejectOrder(id, 'x'.repeat(100))).toBe('ok');
    asGuest('g7');
    const [o] = await api.myOrders('demo-sto-8');
    expect(o.rejectReason).toHaveLength(60);
  });

  it('a table can call the waiter; a room cannot', async () => {
    await api.callWaiter('demo-sto-9');
    await api.callWaiter('demo-sto-9');
    await signIn('ana');
    expect((await api.cafeCalls('demo-lipa')).filter((c) => c.tableNumber === 9)).toHaveLength(1);
    expect(await outcome(api.callWaiter('demo-soba-101'))).toBe('invalid_table');
  });
});

describe('tables and rooms', () => {
  it('table 1 and room 1 can coexist; numbers are unique within a kind', async () => {
    await signIn('jelena');
    const room = { kind: 'room' as const, number: 1, seats: 2, zone: 'room', floor: 0 };
    expect(await outcome(api.saveTable('demo-lipa', room))).toBe('ok');
    expect(await outcome(api.saveTable('demo-lipa', room))).toBe('duplicate_number');
    expect(await outcome(api.saveTable('demo-lipa', { kind: 'table', number: 1, seats: 2, zone: 'hall', floor: null }))).toBe('duplicate_number');
    const places = await api.cafeTables('demo-lipa');
    expect(places.filter((p) => p.number === 1).map((p) => p.kind).sort()).toEqual(['room', 'table']);
  });

  it('adds rooms in bulk with a floor and skips existing numbers', async () => {
    await signIn('jelena');
    expect(await api.addRooms('demo-lipa', 129, 133, 1)).toBe(3);
    const rooms = (await api.cafeTables('demo-lipa')).filter((p) => p.kind === 'room');
    expect(rooms).toHaveLength(93);
    expect(rooms.find((r) => r.number === 133)?.floor).toBe(1);
    expect(await outcome(api.addRooms('demo-lipa', 5, 4, null))).toBe('invalid_range');
    expect(await outcome(api.addRooms('demo-lipa', 900, 901, 999))).toBe('invalid_floor');
  });

  it('upgrades demo data saved by the admin panel before rooms existed', async () => {
    const tables = DEMO_TABLES.map(({ kind: _k, floor: _f, ...t }) => ({ ...t, active: true }));
    localStorage.setItem('stolic.demo.db.v1', JSON.stringify({ cafe: DEMO_CAFE, categories: DEMO_CATEGORIES, products: DEMO_PRODUCTS, staff: DEMO_STAFF, tables, orders: [], calls: [] }));
    const places = await api.cafeTables('demo-lipa');
    expect(places.filter((p) => p.kind === 'table')).toHaveLength(12);
    expect(places.filter((p) => p.kind === 'room')).toHaveLength(90);
    expect(places.find((p) => p.kind === 'room' && p.number === 330)?.floor).toBe(3);
  });

  it('upgrades demo data saved before the admin panel existed', async () => {
    const t = Date.now();
    localStorage.setItem('stolic.demo.db.v1', JSON.stringify({ orders: [], calls: [{ id: 'c', tableId: 'demo-t1', tableNumber: 1, createdAt: t, resolvedAt: null }] }));
    expect((await api.loadTable('demo-soba-101'))?.table).toMatchObject({ kind: 'room', number: 101 });
    const places = await api.cafeTables('demo-lipa');
    expect(places.filter((p) => p.kind === 'room')).toHaveLength(90);
    expect(places.find((p) => p.number === 214 && p.kind === 'room')?.floor).toBe(2);
  });
});

describe('editions', () => {
  it('a fresh demo is Stočić Hotel, because it has rooms', () => {
    expect(api.demoEdition()).toBe('hotel');
  });

  it('Stočić Café: tables work, a room code is inactive and rooms cannot be managed', async () => {
    api.setDemoEdition('cafe');
    expect((await api.loadTable('demo-sto-7'))?.cafe.edition).toBe('cafe');
    expect(await api.loadTable('demo-soba-214')).toBeNull();
    asGuest('e1');
    expect(await outcome(api.placeOrder('demo-soba-214', [line('p1')], ''))).toBe('invalid_table');
    expect(await outcome(api.placeOrder('demo-sto-7', [line('p1')], ''))).toBe('ok');

    await signIn('jelena');
    expect(await outcome(api.addRooms('demo-lipa', 401, 402, 4))).toBe('hotel_only');
    expect(await outcome(api.saveTable('demo-lipa', { kind: 'room', number: 500, seats: 2, zone: 'room', floor: 5 }))).toBe('hotel_only');
    expect(await outcome(api.regenerateTableToken('demo-r214'))).toBe('hotel_only');
    expect(await outcome(api.deleteTable('demo-r214'))).toBe('hotel_only');
    expect(await outcome(api.saveTable('demo-lipa', { kind: 'table', number: 13, seats: 2, zone: 'hall', floor: null }))).toBe('ok');
  });

  it('back on Stočić Hotel the same room codes work again', async () => {
    api.setDemoEdition('cafe');
    api.setDemoEdition('hotel');
    expect((await api.loadTable('demo-soba-214'))?.table.kind).toBe('room');
    asGuest('e2');
    expect(await outcome(api.placeOrder('demo-soba-214', [line('p1')], ''))).toBe('ok');
  });

  it('demo data from before editions becomes Stočić Hotel when it has rooms, Stočić Café when not', async () => {
    const tablesOnly = DEMO_TABLES.map((t) => ({ ...t, active: true }));
    const { edition: _e, ...oldCafe } = DEMO_CAFE;
    localStorage.setItem('stolic.demo.db.v1', JSON.stringify({ v: 4, cafe: oldCafe, categories: DEMO_CATEGORIES, products: DEMO_PRODUCTS, staff: DEMO_STAFF, tables: tablesOnly, orders: [], calls: [] }));
    expect(api.demoEdition()).toBe('cafe');
    localStorage.removeItem('stolic.demo.db.v1');
    localStorage.setItem('stolic.demo.db.v1', JSON.stringify({ v: 4, cafe: oldCafe, categories: DEMO_CATEGORIES, products: DEMO_PRODUCTS, staff: DEMO_STAFF, tables: [...tablesOnly, { ...DEMO_TABLES[0], id: 'r', kind: 'room', number: 101, token: 'room-101', floor: 1, active: true }], orders: [], calls: [] }));
    expect(api.demoEdition()).toBe('hotel');
  });
});

describe('administration is for owners and managers', () => {
  it('refuses a waiter', async () => {
    await signIn('ana');
    expect(await outcome(api.adminMenu('demo-lipa'))).toBe('forbidden');
    expect(await outcome(api.addRooms('demo-lipa', 900, 901, null))).toBe('forbidden');
  });

  it('only offers active staff on the demo sign-in', () => {
    const names = api.demoStaff().map((s) => s.id);
    expect(names).toContain('jelena');
    expect(names).not.toContain('stefan');
  });

  it('only an owner may make someone an owner', async () => {
    await signIn('nikola');
    expect(await outcome(api.updateStaff('ana', 'owner', true))).toBe('owner_required');
    expect(await outcome(api.updateStaff('nikola', 'waiter', true))).toBe('cannot_change_self');
  });
});

describe('staff sign-in with a username and PIN', () => {
  it('signs in with the right PIN, whatever the case of the username', async () => {
    expect(api.staffSignIn).toBe('pin');
    expect(await api.signInWithPin(' Ana ', '641735')).toMatchObject({ staffId: 'ana', role: 'waiter' });
    expect((await api.staffSession())?.staffId).toBe('ana');
  });

  it('refuses a wrong PIN, an unknown username and an inactive account alike', async () => {
    expect(await outcome(api.signInWithPin('ana', '000000'))).toBe('invalid_pin');
    expect(await outcome(api.signInWithPin('nobody', '641735'))).toBe('invalid_pin');
    expect(await outcome(api.signInWithPin('stefan', '863957'))).toBe('invalid_pin');
    expect(await api.staffSession()).toBeNull();
  });

  it('locks a username for 15 minutes after five wrong PINs in a row, and only that one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (let i = 0; i < 5; i++) expect(await outcome(api.signInWithPin('marko', '111111'))).toBe('invalid_pin');
      expect(await outcome(api.signInWithPin('marko', '752846'))).toBe('login_locked');
      expect(await outcome(api.signInWithPin('ana', '641735'))).toBe('ok');
      vi.setSystemTime(Date.now() + 15 * MIN + 1000);
      expect(await outcome(api.signInWithPin('marko', '752846'))).toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a right PIN starts the count again', async () => {
    for (let i = 0; i < 4; i++) await outcome(api.signInWithPin('marko', '111111'));
    expect(await outcome(api.signInWithPin('marko', '752846'))).toBe('ok');
    for (let i = 0; i < 4; i++) expect(await outcome(api.signInWithPin('marko', '111111'))).toBe('invalid_pin');
    expect(await outcome(api.signInWithPin('marko', '752846'))).toBe('ok');
  });

  it('shows PINs on the demo sign-in, never in the admin staff list', async () => {
    expect(api.demoStaff().find((s) => s.id === 'ana')).toMatchObject({ username: 'ana', pin: '641735' });
    await signIn('jelena');
    for (const member of await api.cafeStaff('demo-lipa')) expect(Object.keys(member).sort()).toEqual(['active', 'email', 'id', 'name', 'role']);
  });

  it('gives a new member a free username and a PIN they can sign in with', async () => {
    await signIn('jelena');
    await api.inviteStaff('demo-lipa', { name: 'Đorđe Novak', email: 'Ana@druga.rs', role: 'waiter', password: '' });
    const added = api.demoStaff().find((s) => s.name === 'Đorđe Novak')!;
    expect(added.username).toBe('ana2');
    expect(added.pin).toMatch(/^\d{6}$/);
    await api.signOut();
    expect((await api.signInWithPin(added.username, added.pin)).name).toBe('Đorđe Novak');
  });

  it('upgrades demo data saved before PINs: seeded people get theirs, anyone added since a new one', async () => {
    const staff = [...DEMO_STAFF.map(({ username: _u, pin: _p, ...s }) => s), { id: 'x', name: 'Đurđa Šarić', role: 'waiter', active: true, email: null }];
    localStorage.setItem('stolic.demo.db.v1', JSON.stringify({ v: 5, cafe: DEMO_CAFE, categories: DEMO_CATEGORIES, products: DEMO_PRODUCTS, staff, tables: DEMO_TABLES.map((t) => ({ ...t, active: true })), orders: [], calls: [] }));
    const accounts = api.demoStaff();
    expect(accounts.find((s) => s.id === 'ana')).toMatchObject({ username: 'ana', pin: '641735' });
    const added = accounts.find((s) => s.id === 'x')!;
    expect(added.username).toBe('djurdja.saric');
    expect((await api.signInWithPin(added.username, added.pin)).staffId).toBe('x');
  });

  it('Filip Mihajlović signs in as an owner with PIN 1542, also in demo data saved before his account', async () => {
    expect(await api.signInWithPin('filip', '1542')).toMatchObject({ name: 'Filip Mihajlović', role: 'owner' });
    await api.signOut();
    const staff = DEMO_STAFF.filter((s) => s.id !== 'filip').map((s) => ({ ...s, failedPins: 0, lockedUntil: 0 }));
    localStorage.setItem('stolic.demo.db.v1', JSON.stringify({ v: 6, cafe: DEMO_CAFE, categories: DEMO_CATEGORIES, products: DEMO_PRODUCTS, staff, tables: DEMO_TABLES.map((t) => ({ ...t, active: true })), orders: [], calls: [] }));
    expect(api.demoStaff().find((s) => s.id === 'filip')).toMatchObject({ username: 'filip', pin: '1542', role: 'owner' });
    expect((await api.signInWithPin('filip', '1542')).role).toBe('owner');
  });
});
