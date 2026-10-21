// The in-browser demo backend must follow the same rules as the SQL functions
// (tests/db covers those). Every test starts from a freshly seeded demo (see src/test/setup.ts).
import { describe, expect, it } from 'vitest';
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
