/**
 * The demo backend — the whole product in the browser, no Supabase project needed.
 *
 * Data lives in localStorage, and every tab of the same browser sees changes live
 * (BroadcastChannel + storage events), so a guest tab and a waiter tab talk to each other. It
 * follows the same rules as the SQL functions: server-side prices, atomic claims, only the allowed
 * status transitions, admin changes for owners and managers only, and the Stočić Café / Stočić
 * Hotel edition rules. demo.test.ts and tests/db check both against the same scenarios.
 *
 * Saved data carries a version (DemoDb.v) and read() upgrades anything older in place, so a
 * visitor's demo survives every new feature.
 */

import { DEMO_CAFE, DEMO_CATEGORIES, DEMO_PRODUCTS, DEMO_ROOMS, DEMO_STAFF, DEMO_TABLES } from './seedData';
import { resolveChoice } from './pricing';
import { floorFromNumber, MAX_FLOOR } from '../lib/orderView';
import { computeOrderStats } from './stats';
import {
  ApiError,
  MANAGER_ROLES,
  STAFF_ROLES,
  TABLE_ZONES,
  type Backend,
  type Cafe,
  type CafeSettings,
  type CartLineInput,
  type Category,
  type ClaimResult,
  type DiningTable,
  type Localized,
  type OptionGroup,
  type Order,
  type OrderItem,
  type Product,
  type StaffMember,
  type StaffSession,
  type WaiterCall,
} from './types';

const DB_KEY = 'stolic.demo.db.v1';
const GUEST_KEY = 'stolic.demo.guest';
const STAFF_KEY = 'stolic.demo.staff';
const MIN = 60_000;

interface DemoOrder extends Order {
  guestId: string;
}
interface DemoCall extends WaiterCall {
  tableId: string;
  resolvedAt: number | null;
}
interface DemoTable extends DiningTable {
  active: boolean;
}
interface DemoMenu {
  cafe: CafeSettings;
  categories: Category[];
  products: Product[];
  tables: DemoTable[];
  staff: StaffMember[];
}
interface DemoDb extends DemoMenu {
  /** 2 = tables and rooms, 3 = rooms have a floor, 4 = a month of history, 5 = editions. Older data is upgraded in read(). */
  v?: number;
  orders: DemoOrder[];
  calls: DemoCall[];
}

const listeners = new Set<() => void>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('stolic-demo') : null;
const emit = () => listeners.forEach((fn) => fn());
channel?.addEventListener('message', emit);
window.addEventListener('storage', (e) => {
  if (e.key === DB_KEY) emit();
});

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const token = () => uid().replace(/-/g, '').slice(0, 20);

function item(products: Product[], pid: string, qty: number, choices: Record<string, string> = {}, note = ''): OrderItem {
  const p = products.find((x) => x.id === pid)!;
  let unit = p.price;
  const out: OrderItem['choices'] = [];
  for (const g of p.options) {
    const c = resolveChoice(p, g.id, choices[g.id]);
    if (!c) continue;
    unit += c.price;
    out.push({ group: g.id, groupName: g.name, choice: c.id, choiceName: c.name, quiet: !!c.quiet });
  }
  return { id: uid(), productId: pid, name: p.name, qty, unitPrice: unit, choices: out, note };
}

function order(partial: Partial<DemoOrder> & Pick<DemoOrder, 'number' | 'tableNumber' | 'items' | 'createdAt'>): DemoOrder {
  return {
    id: uid(),
    guestId: 'seed',
    tableId: `demo-t${partial.tableNumber}`,
    tableKind: 'table',
    status: 'pending',
    note: '',
    total: partial.items.reduce((a, i) => a + i.unitPrice * i.qty, 0),
    acceptedAt: null,
    deadline: null,
    prepMinutes: null,
    estimateUpdatedAt: null,
    readyAt: null,
    servedAt: null,
    rejectedAt: null,
    rejectReason: null,
    waiterId: null,
    waiterName: null,
    ...partial,
  };
}

function seedMenu(): DemoMenu {
  return structuredClone({
    cafe: DEMO_CAFE,
    categories: DEMO_CATEGORIES,
    products: DEMO_PRODUCTS,
    tables: [...DEMO_TABLES, ...DEMO_ROOMS].map((t) => ({ ...t, active: true })),
    staff: DEMO_STAFF,
  });
}

const staffName = (id: string) => DEMO_STAFF.find((s) => s.id === id)!.name;

/**
 * Served (and a few rejected) orders between `from` and `to`, during opening hours (07–23),
 * so the admin overview has a month of history to show. Numbers are filled in by the caller.
 */
function history(from: number, to: number): DemoOrder[] {
  let s = 20261020;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pool = DEMO_PRODUCTS.filter((p) => p.available);
  const tables = DEMO_TABLES.length;
  const out: DemoOrder[] = [];
  for (let slot = from; slot < to; slot += 30 * MIN) {
    const d = new Date(slot);
    const hour = d.getHours();
    if (hour < 7 || hour >= 23) continue;
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const peak = hour === 8 || hour === 9 || hour === 13 || hour === 14 || hour === 18 || hour === 19;
    const count = Math.floor(rand() * (weekend ? 3 : 2)) + (peak ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const createdAt = Math.min(to, slot + rand() * 30 * MIN);
      const items = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => item(DEMO_PRODUCTS, pool[Math.floor(rand() * pool.length)].id, 1 + Math.floor(rand() * 2)));
      const waiter = rand() < 0.5 ? 'ana' : 'marko';
      // Now and then room service, mostly tables.
      const room = rand() < 0.12 ? DEMO_ROOMS[Math.floor(rand() * DEMO_ROOMS.length)] : null;
      const place = room
        ? { tableNumber: room.number, tableId: room.id, tableKind: 'room' as const }
        : { tableNumber: 1 + Math.floor(rand() * tables) };
      if (rand() < 0.06) {
        out.push(order({ number: 0, ...place, createdAt, items, status: 'rejected', rejectedAt: createdAt + MIN, rejectReason: 'unavailable', waiterId: waiter, waiterName: staffName(waiter) }));
        continue;
      }
      const acceptedAt = createdAt + (20 + rand() * 70) * 1000;
      const prep = [5, 8, 10, 12, 15][Math.floor(rand() * 5)];
      const readyAt = acceptedAt + Math.max(2, prep + rand() * 6 - 3) * MIN;
      out.push(
        order({
          number: 0, ...place, createdAt, items, status: 'served',
          acceptedAt, prepMinutes: prep, deadline: acceptedAt + prep * MIN, waiterId: waiter, waiterName: staffName(waiter),
          readyAt, servedAt: readyAt + (1 + rand() * 3) * MIN,
        }),
      );
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** Midnight 29 days ago: with today, the last 30 days of the admin overview. */
const monthAgo = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 29);
  return d.getTime();
};

function seed(): DemoDb {
  const now = Date.now();
  const products = DEMO_PRODUCTS;
  const accepted = (ago: number, minutes: number, waiter: 'ana' | 'marko') => ({
    acceptedAt: now - ago,
    deadline: now - ago + minutes * MIN,
    prepMinutes: minutes,
    waiterId: waiter,
    waiterName: staffName(waiter),
  });
  const past = history(monthAgo(now), now - 60 * MIN);
  past.forEach((o, i) => (o.number = 1001 + i));
  const n = 1001 + past.length; // the orders below are the newest, in this order
  return {
    ...seedMenu(),
    v: 5,
    calls: [],
    orders: [
      ...past,
      order({ number: n + 7, tableNumber: 3, createdAt: now - 2 * MIN - 15_000, note: 'Bez šećera u kafi, molim.', items: [item(products, 'p2', 2, { size: 's', milk: 'oat' }), item(products, 'p12', 1)] }),
      order({ number: n + 6, tableNumber: 12, createdAt: now - 9 * MIN, status: 'preparing', ...accepted(6 * MIN + 20_000, 10, 'marko'), items: [item(products, 'p10', 2, { egg: 'poached' }), item(products, 'p8', 2, { ice: 'no' })] }),
      order({ number: n + 5, tableNumber: 9, createdAt: now - 5 * MIN, status: 'preparing', ...accepted(4 * MIN + 30_000, 5, 'ana'), items: [item(products, 'p4', 2, { sugar: 'some' }), item(products, 'p14', 1)] }),
      order({ number: n + 4, tableNumber: 5, createdAt: now - 14 * MIN, status: 'ready', ...accepted(12 * MIN, 10, 'ana'), readyAt: now - 90_000, items: [item(products, 'p15', 2), item(products, 'p9', 1)] }),
      order({ number: n + 3, tableNumber: 214, tableId: 'demo-r214', tableKind: 'room', createdAt: now - 20 * MIN, note: 'Molim vas, pokucajte tiho — beba spava.', status: 'preparing', ...accepted(18 * MIN, 25, 'marko'), items: [item(products, 'p10', 2, { egg: 'scrambled' }), item(products, 'p2', 2, { size: 'l' }), item(products, 'p8', 1)] }),
      order({ number: n + 2, tableNumber: 2, createdAt: now - 38 * MIN, status: 'served', ...accepted(37 * MIN, 10, 'marko'), readyAt: now - 26 * MIN, servedAt: now - 25 * MIN, items: [item(products, 'p3', 1), item(products, 'p11', 1)] }),
      order({ number: n + 1, tableNumber: 10, createdAt: now - 46 * MIN, status: 'rejected', rejectedAt: now - 45 * MIN, rejectReason: 'duplicate', waiterId: 'ana', waiterName: staffName('ana'), items: [item(products, 'p16', 4)] }),
      order({ number: n, tableNumber: 4, createdAt: now - 52 * MIN, status: 'served', ...accepted(51 * MIN, 3, 'ana'), readyAt: now - 48 * MIN, servedAt: now - 47 * MIN, items: [item(products, 'p1', 2, { shot: 'double' })] }),
    ],
  };
}

function read(): DemoDb {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const db = JSON.parse(raw) as DemoDb;
      // Data saved before the admin panel existed has no menu of its own yet.
      return upgrade(db.cafe ? db : { ...seedMenu(), ...db });
    }
  } catch {
    /* fall through to a fresh seed */
  }
  const db = seed();
  write(db, false);
  return db;
}

/**
 * Older saved data. Before v2 every place was a table: mark them and add the demo rooms.
 * Before v3 rooms had no floor: take it from the number (402 → floor 4), like the SQL migration.
 * Before v4 there was only one day of history: add the rest of the month before the oldest order.
 * Before v5 there were no editions: rooms make it Stočić Hotel, like the SQL migration.
 */
function upgrade(db: DemoDb): DemoDb {
  if (db.v === 5) return db;
  if (!db.v || db.v < 2) {
    for (const t of db.tables) t.kind ??= 'table';
    for (const o of db.orders) o.tableKind ??= 'table';
    const taken = new Set(db.tables.filter((t) => t.kind === 'room').map((t) => t.number));
    db.tables.push(...structuredClone(DEMO_ROOMS).filter((r) => !taken.has(r.number)).map((r) => ({ ...r, active: true })));
  }
  for (const t of db.tables) {
    if (t.floor === undefined) t.floor = t.kind === 'room' ? floorFromNumber(t.number) : null;
  }
  if (!db.v || db.v < 4) {
    const now = Date.now();
    const oldest = db.orders.reduce((m, o) => Math.min(m, o.createdAt), now - 60 * MIN);
    const past = history(monthAgo(now), oldest);
    let next = db.orders.reduce((m, o) => Math.max(m, o.number), 1000);
    for (const o of past) o.number = ++next; // numbers stay unique; their order does not matter here
    db.orders.unshift(...past);
  }
  db.cafe.edition ??= db.tables.some((t) => t.kind === 'room') || db.orders.some((o) => o.tableKind === 'room') ? 'hotel' : 'cafe';
  db.v = 5;
  return db;
}

function checkFloor(floor: number | null): number | null {
  if (floor === null) return null;
  if (!Number.isInteger(floor) || floor < 0 || floor > MAX_FLOOR) throw new ApiError('invalid_floor');
  return floor;
}

function write(db: DemoDb, notify = true): boolean {
  let saved = true;
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    saved = false; // storage full or blocked
  }
  if (notify) {
    channel?.postMessage('change');
    emit();
  }
  return saved;
}

function mutate<T>(fn: (db: DemoDb) => T): T {
  const db = read();
  const result = fn(db);
  if (!write(db)) throw new ApiError('storage_full');
  return result;
}

function guestId(): string {
  try {
    let id = localStorage.getItem(GUEST_KEY);
    if (!id) {
      id = uid();
      localStorage.setItem(GUEST_KEY, id);
    }
    return id;
  } catch {
    return 'guest';
  }
}

/** The active place behind a QR token; a room only counts for Stočić Hotel (same as guest_table). */
function placeByToken(db: DemoDb, tok: string) {
  return db.tables.find((x) => x.token === tok && x.active && (x.kind === 'table' || db.cafe.edition === 'hotel'));
}

function tableByToken(db: DemoDb, tok: string) {
  const t = placeByToken(db, tok);
  if (!t) throw new ApiError('invalid_table');
  return t;
}

/** Rooms are a Stočić Hotel feature (public._require_hotel). */
function requireHotel(db: DemoDb) {
  if (db.cafe.edition !== 'hotel') throw new ApiError('hotel_only');
}

function strip(o: DemoOrder): Order {
  const { guestId: _g, ...rest } = o;
  return rest;
}

function publicCafe(c: CafeSettings): Cafe {
  const { id, slug, name, accent, defaultLang, allowRepeat, callButton, edition } = c;
  return { id, slug, name, accent, defaultLang, allowRepeat, callButton, edition };
}

function currentStaff(db = read()) {
  try {
    const id = sessionStorage.getItem(STAFF_KEY);
    return db.staff.find((s) => s.id === id && s.active) ?? null;
  } catch {
    return null;
  }
}

function sessionFor(db: DemoDb, id: string): StaffSession {
  const s = db.staff.find((x) => x.id === id && x.active);
  if (!s) throw new ApiError('forbidden');
  return { staffId: s.id, name: s.name, role: s.role, cafe: publicCafe(db.cafe) };
}

function staffOrThrow(db = read()) {
  const s = currentStaff(db);
  if (!s) throw new ApiError('forbidden');
  return s;
}

function managerOrThrow(db: DemoDb) {
  const s = staffOrThrow(db);
  if (!MANAGER_ROLES.includes(s.role)) throw new ApiError('forbidden');
  return s;
}

function findOrder(db: DemoDb, id: string) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) throw new ApiError('not_found');
  return o;
}

function find<T extends { id: string }>(list: T[], id: string): T {
  const x = list.find((y) => y.id === id);
  if (!x) throw new ApiError('gone');
  return x;
}

// Same clean-up as public._clean_localized / _clean_options in the admin migration.
function cleanLocalized(f: Localized, max: number): Localized {
  const out: Localized = {};
  for (const [k, v] of Object.entries(f ?? {})) {
    if (/^[a-z]{2}$/.test(k) && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, max);
  }
  return out;
}

function cleanOptions(groups: OptionGroup[]): OptionGroup[] {
  if (groups.length > 10) throw new ApiError('invalid_input');
  const gids = new Set<string>();
  return groups.map((g) => {
    if (!g.id || gids.has(g.id)) throw new ApiError('invalid_input');
    gids.add(g.id);
    const name = cleanLocalized(g.name, 60);
    if (!name.sr) throw new ApiError('name_required');
    if (!g.choices.length || g.choices.length > 20) throw new ApiError('invalid_input');
    const cids = new Set<string>();
    return {
      id: g.id,
      name,
      choices: g.choices.map((c) => {
        if (!c.id || cids.has(c.id)) throw new ApiError('invalid_input');
        cids.add(c.id);
        const cname = cleanLocalized(c.name, 60);
        if (!cname.sr) throw new ApiError('name_required');
        const price = Math.round(c.price);
        if (!(price >= 0 && price <= 100_000)) throw new ApiError('invalid_price');
        return { id: c.id, name: cname, price, quiet: !!c.quiet };
      }),
    };
  });
}

const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort;
const nextSort = (list: { sort: number }[]) => list.reduce((m, x) => Math.max(m, x.sort), 0) + 1;

export function createDemoBackend(): Backend {
  return {
    mode: 'demo',
    serverOffset: () => 0,

    async loadTable(tok) {
      await wait();
      const db = read();
      const table = placeByToken(db, tok);
      if (!table) return null;
      return {
        cafe: publicCafe(db.cafe),
        table: { id: table.id, number: table.number, kind: table.kind },
        categories: [...db.categories].sort(bySort),
        products: [...db.products].sort(bySort),
      };
    },

    async placeOrder(tok, lines: CartLineInput[], note) {
      await wait(350);
      if (!lines.length) throw new ApiError('empty_order');
      if (lines.length > 40) throw new ApiError('too_many_items');
      const gid = guestId();
      return mutate((db) => {
        const table = tableByToken(db, tok);
        const now = Date.now();
        if (db.orders.some((o) => o.guestId === gid && now - o.createdAt < 5_000)) throw new ApiError('too_fast');
        if (!db.cafe.allowRepeat && db.orders.some((o) => o.guestId === gid && o.tableId === table.id && ['pending', 'preparing', 'ready'].includes(o.status))) {
          throw new ApiError('order_in_progress');
        }
        const items = lines.map((l) => {
          const p = db.products.find((x) => x.id === l.productId);
          if (!p) throw new ApiError('unknown_product');
          if (!p.available) throw new ApiError('product_unavailable');
          if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 50) throw new ApiError('invalid_quantity');
          return item(db.products, p.id, l.qty, l.choices, l.note.slice(0, 200));
        });
        const number = db.orders.reduce((m, o) => Math.max(m, o.number), 1000) + 1;
        const o = order({ number, tableId: table.id, tableKind: table.kind, tableNumber: table.number, createdAt: now, items, note: note.slice(0, 300), guestId: gid });
        db.orders.push(o);
        return o.id;
      });
    },

    async myOrders(tok) {
      await wait(60);
      const db = read();
      const table = tableByToken(db, tok);
      const gid = guestId();
      return db.orders
        // Same window as the Supabase backend: the last 12 hours.
        .filter((o) => o.guestId === gid && o.tableId === table.id && o.createdAt > Date.now() - 12 * 60 * MIN)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(strip);
    },

    subscribeMyOrders(_token, onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },

    async callWaiter(tok) {
      await wait();
      mutate((db) => {
        const table = tableByToken(db, tok);
        if (table.kind === 'room') throw new ApiError('invalid_table'); // rooms have no "call waiter" button
        const now = Date.now();
        const open = db.calls.find((c) => c.tableId === table.id && !c.resolvedAt);
        if (open) {
          if (now - open.createdAt > 20_000) open.createdAt = now;
          return;
        }
        db.calls.push({ id: uid(), tableId: table.id, tableNumber: table.number, createdAt: now, resolvedAt: null });
      });
    },

    async staffSession() {
      const db = read();
      const s = currentStaff(db);
      return s ? sessionFor(db, s.id) : null;
    },
    async signIn() {
      throw new ApiError('demo_mode');
    },
    async signOut() {
      try {
        sessionStorage.removeItem(STAFF_KEY);
      } catch {
        /* ignore */
      }
    },
    demoStaff: () => read().staff.filter((s) => s.active).map(({ id, name, role }) => ({ id, name, role })),
    async demoSignIn(staffId) {
      await wait();
      const session = sessionFor(read(), staffId);
      // Per tab, so two tabs can be two different waiters.
      sessionStorage.setItem(STAFF_KEY, staffId);
      return session;
    },

    async cafeOrders() {
      await wait(60);
      const since = Date.now() - 12 * 60 * MIN;
      return read()
        .orders.filter((o) => o.createdAt > since)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(strip);
    },
    async cafeCalls() {
      return read()
        .calls.filter((c) => !c.resolvedAt)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ id, tableNumber, createdAt }) => ({ id, tableNumber, createdAt }));
    },
    async cafeTables() {
      return read()
        .tables.filter((t) => t.active)
        .sort((a, b) => b.kind.localeCompare(a.kind) || a.number - b.number) // tables first, then rooms
        .map(({ active: _a, ...t }) => t);
    },
    subscribeCafe(_cafeId, onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },

    async acceptOrder(orderId, minutes): Promise<ClaimResult> {
      await wait();
      const s = staffOrThrow();
      if (!(Number.isInteger(minutes) && minutes >= 1 && minutes <= 180)) throw new ApiError('invalid_minutes');
      return mutate((db) => {
        const o = findOrder(db, orderId);
        if (o.status !== 'pending') return 'taken';
        const now = Date.now();
        Object.assign(o, { status: 'preparing', acceptedAt: now, prepMinutes: minutes, deadline: now + minutes * MIN, waiterId: s.id, waiterName: s.name });
        return 'ok';
      });
    },
    async rejectOrder(orderId, reason): Promise<ClaimResult> {
      await wait();
      const s = staffOrThrow();
      return mutate((db) => {
        const o = findOrder(db, orderId);
        if (o.status !== 'pending') return 'taken';
        Object.assign(o, { status: 'rejected', rejectedAt: Date.now(), rejectReason: reason.slice(0, 60), waiterId: s.id, waiterName: s.name });
        return 'ok';
      });
    },
    async extendOrder(orderId, minutes) {
      await wait();
      staffOrThrow();
      if (!(Number.isInteger(minutes) && minutes >= 1 && minutes <= 60)) throw new ApiError('invalid_minutes');
      mutate((db) => {
        const o = findOrder(db, orderId);
        if (o.status !== 'preparing' || !o.deadline || !o.acceptedAt) throw new ApiError('invalid_status');
        const now = Date.now();
        o.deadline = Math.max(o.deadline, now) + minutes * MIN;
        o.prepMinutes = Math.ceil((o.deadline - o.acceptedAt) / MIN);
        o.estimateUpdatedAt = now;
      });
    },
    async markReady(orderId) {
      await wait();
      staffOrThrow();
      mutate((db) => {
        const o = findOrder(db, orderId);
        if (o.status !== 'preparing') throw new ApiError('invalid_status');
        o.status = 'ready';
        o.readyAt = Date.now();
      });
    },
    async markServed(orderId) {
      await wait();
      staffOrThrow();
      mutate((db) => {
        const o = findOrder(db, orderId);
        if (o.status !== 'preparing' && o.status !== 'ready') throw new ApiError('invalid_status');
        const now = Date.now();
        o.status = 'served';
        o.servedAt = now;
        o.readyAt = o.readyAt ?? now;
      });
    },
    async resolveCall(callId) {
      staffOrThrow();
      mutate((db) => {
        const c = db.calls.find((x) => x.id === callId);
        if (c) c.resolvedAt = Date.now();
      });
    },

    // === Admin =============================================

    async adminOrders(_cafeId, since, until) {
      await wait(60);
      const db = read();
      managerOrThrow(db);
      return db.orders
        .filter((o) => o.createdAt >= since && (until === undefined || o.createdAt < until))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(strip);
    },

    async orderStats(_cafeId, since, until) {
      await wait(60);
      const db = read();
      managerOrThrow(db);
      // The demo runs in the browser, so its time zone is the browser's (what the overview sends too).
      return computeOrderStats(db.orders, since, until);
    },

    async cafeSettings() {
      await wait(60);
      const db = read();
      managerOrThrow(db);
      return db.cafe;
    },

    async updateCafe(_cafeId, input) {
      await wait();
      mutate((db) => {
        managerOrThrow(db);
        const name = input.name.trim().slice(0, 80);
        if (!name) throw new ApiError('name_required');
        if (!/^#[0-9a-f]{6}$/i.test(input.accent)) throw new ApiError('invalid_color');
        if (input.defaultLang !== 'sr' && input.defaultLang !== 'en') throw new ApiError('invalid_input');
        db.cafe = {
          ...db.cafe,
          name,
          accent: input.accent.toLowerCase(),
          defaultLang: input.defaultLang,
          allowRepeat: input.allowRepeat,
          callButton: input.callButton,
          phone: input.phone.trim().slice(0, 40),
          email: input.email.trim().slice(0, 120),
          address: input.address.trim().slice(0, 160),
          openingHours: {
            weekdays: input.openingHours.weekdays.slice(0, 40),
            saturday: input.openingHours.saturday.slice(0, 40),
            sunday: input.openingHours.sunday.slice(0, 40),
          },
        };
      });
    },

    async adminMenu() {
      await wait(60);
      const db = read();
      managerOrThrow(db);
      return { categories: [...db.categories].sort(bySort), products: [...db.products].sort(bySort) };
    },

    async saveCategory(_cafeId, input) {
      await wait();
      return mutate((db) => {
        managerOrThrow(db);
        const name = cleanLocalized(input.name, 60);
        if (!name.sr) throw new ApiError('name_required');
        if (input.id) {
          Object.assign(find(db.categories, input.id), { name, icon: input.icon });
          return input.id;
        }
        const c: Category = { id: uid(), name, icon: input.icon, sort: nextSort(db.categories) };
        db.categories.push(c);
        return c.id;
      });
    },

    async deleteCategory(categoryId) {
      await wait();
      mutate((db) => {
        managerOrThrow(db);
        find(db.categories, categoryId);
        if (db.products.some((p) => p.categoryId === categoryId)) throw new ApiError('category_not_empty');
        db.categories = db.categories.filter((c) => c.id !== categoryId);
      });
    },

    async reorderCategories(_cafeId, ids) {
      mutate((db) => {
        managerOrThrow(db);
        ids.forEach((id, i) => {
          const c = db.categories.find((x) => x.id === id);
          if (c) c.sort = i + 1;
        });
      });
    },

    async saveProduct(_cafeId, input) {
      await wait();
      return mutate((db) => {
        managerOrThrow(db);
        const name = cleanLocalized(input.name, 80);
        if (!name.sr) throw new ApiError('name_required');
        const price = Math.round(input.price);
        if (!(price >= 0 && price <= 1_000_000)) throw new ApiError('invalid_price');
        if (input.categoryId && !db.categories.some((c) => c.id === input.categoryId)) throw new ApiError('invalid_input');
        const fields = {
          categoryId: input.categoryId,
          name,
          description: cleanLocalized(input.description, 400),
          price,
          available: input.available,
          options: cleanOptions(input.options),
          imageUrl: input.imageUrl,
        };
        if (input.id) {
          Object.assign(find(db.products, input.id), fields);
          return input.id;
        }
        const p: Product = { id: uid(), sort: nextSort(db.products), ...fields };
        db.products.push(p);
        return p.id;
      });
    },

    async setProductAvailable(productId, available) {
      mutate((db) => {
        managerOrThrow(db);
        find(db.products, productId).available = available;
      });
    },

    async deleteProduct(productId) {
      await wait();
      mutate((db) => {
        managerOrThrow(db);
        find(db.products, productId);
        db.products = db.products.filter((p) => p.id !== productId);
      });
    },

    async uploadProductImage(_cafeId, image) {
      managerOrThrow(read());
      // No storage server in the demo: the (already resized) image is stored as a data URL.
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new ApiError('upload_failed'));
        reader.readAsDataURL(image);
      });
    },

    async saveTable(_cafeId, input) {
      await wait();
      return mutate((db) => {
        managerOrThrow(db);
        // Same order of checks as admin_save_table: an existing place keeps its kind.
        const placeKind = input.id ? find(db.tables, input.id).kind : input.kind;
        if (placeKind === 'room') requireHotel(db);
        const number = Math.round(input.number);
        if (!(number >= 1 && number <= 9999)) throw new ApiError('invalid_number');
        const seats = Math.round(input.seats);
        const kind = input.kind === 'room' ? 'room' : 'table';
        const zone = kind === 'room' ? 'room' : input.zone;
        if (!(seats >= 1 && seats <= 50) || (kind === 'table' && !(TABLE_ZONES as readonly string[]).includes(zone))) throw new ApiError('invalid_input');
        if (input.id) {
          const t = find(db.tables, input.id);
          if (!t.active) throw new ApiError('gone');
          if (db.tables.some((x) => x.active && x.kind === t.kind && x.number === number && x.id !== t.id)) throw new ApiError('duplicate_number');
          Object.assign(t, { number, seats, zone: t.kind === 'room' ? 'room' : zone, floor: t.kind === 'room' ? checkFloor(input.floor) : null });
          return t.id;
        }
        if (db.tables.some((x) => x.active && x.kind === kind && x.number === number)) throw new ApiError('duplicate_number');
        const floor = kind === 'room' ? checkFloor(input.floor) : null;
        const t: DemoTable = { id: `demo-t-${token().slice(0, 8)}`, kind, number, seats, zone, token: `demo-${token()}`, floor, active: true };
        db.tables.push(t);
        return t.id;
      });
    },

    async deleteTable(tableId) {
      await wait();
      mutate((db) => {
        managerOrThrow(db);
        const t = find(db.tables, tableId);
        if (t.kind === 'room') requireHotel(db);
        if (db.orders.some((o) => o.tableId === tableId)) {
          t.active = false;
          db.calls.forEach((c) => {
            if (c.tableId === tableId && !c.resolvedAt) c.resolvedAt = Date.now();
          });
        } else {
          db.tables = db.tables.filter((x) => x.id !== tableId);
        }
      });
    },

    async addRooms(_cafeId, from, to, floor) {
      await wait();
      return mutate((db) => {
        managerOrThrow(db);
        requireHotel(db);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 9999 || to < from || to - from >= 300) throw new ApiError('invalid_range');
        checkFloor(floor);
        const taken = new Set(db.tables.filter((t) => t.active && t.kind === 'room').map((t) => t.number));
        let added = 0;
        for (let n = from; n <= to; n++) {
          if (taken.has(n)) continue;
          db.tables.push({ id: `demo-r-${token().slice(0, 8)}`, kind: 'room', number: n, seats: 2, zone: 'room', token: `demo-${token()}`, floor, active: true });
          added++;
        }
        return added;
      });
    },

    async regenerateTableToken(tableId) {
      await wait();
      return mutate((db) => {
        managerOrThrow(db);
        const t = find(db.tables, tableId);
        if (t.kind === 'room') requireHotel(db);
        t.token = `demo-${token()}`;
        return t.token;
      });
    },

    async cafeStaff() {
      await wait(60);
      const db = read();
      managerOrThrow(db);
      return [...db.staff].sort(
        (a, b) => Number(b.active) - Number(a.active) || STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role) || a.name.localeCompare(b.name),
      );
    },

    async updateStaff(staffId, role, active) {
      await wait();
      mutate((db) => {
        const me = managerOrThrow(db);
        const target = find(db.staff, staffId);
        if (target.id === me.id) throw new ApiError('cannot_change_self');
        if (!STAFF_ROLES.includes(role)) throw new ApiError('invalid_input');
        if ((target.role === 'owner' || role === 'owner') && me.role !== 'owner') throw new ApiError('owner_required');
        Object.assign(target, { role, active });
      });
    },

    async inviteStaff(_cafeId, input) {
      await wait(300);
      return mutate((db) => {
        const me = managerOrThrow(db);
        const name = input.name.trim().slice(0, 60);
        const email = input.email.trim().toLowerCase();
        if (!name) throw new ApiError('name_required');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('invalid_email');
        if (!STAFF_ROLES.includes(input.role)) throw new ApiError('invalid_input');
        if (input.role === 'owner' && me.role !== 'owner') throw new ApiError('owner_required');
        const existing = db.staff.find((s) => s.email === email);
        if (existing) {
          if (existing.id === me.id) throw new ApiError('cannot_change_self');
          if (existing.active) throw new ApiError('already_staff');
          if (existing.role === 'owner' && me.role !== 'owner') throw new ApiError('owner_required');
          Object.assign(existing, { name, role: input.role, active: true });
          return { created: false };
        }
        db.staff.push({ id: uid(), name, role: input.role, active: true, email });
        return { created: true };
      });
    },

    resetDemo() {
      write(seed());
    },
    demoEdition: () => read().cafe.edition,
    setDemoEdition(edition) {
      // Rooms stay in the data: back on Stočić Hotel they work again, as for a real establishment.
      mutate((db) => {
        db.cafe.edition = edition;
      });
    },
  };
}
