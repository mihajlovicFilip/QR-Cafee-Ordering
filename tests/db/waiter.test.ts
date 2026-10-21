// The waiter side: who sees which orders, the atomic claim, allowed status transitions,
// preparation time, and waiter calls.
import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createCafe, line, newUser, newUsers, pause, placeOrder, testDb, type Cafe } from './db';

const db = testDb();
let su: pg.Client;
let cafe: Cafe;
let other: Cafe;

beforeAll(async () => {
  su = await db.superuser();
  cafe = await createCafe(su);
  other = await createCafe(su);
});

async function freshOrder(c: Cafe = cafe) {
  const guestId = await newUser(su, true);
  const guest = await db.as('authenticated', guestId);
  const id = await placeOrder(guest, c.tableToken, [line(c.cakeId)]);
  return { id, guest, guestId };
}

const call = async (client: pg.Client, sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0];

describe('who sees an order', () => {
  it('the guest who placed it and the staff of that café — nobody else', async () => {
    const { id, guest } = await freshOrder();
    const count = async (client: pg.Client) => (await client.query('select count(*)::int as n from public.orders where id = $1', [id])).rows[0].n;
    const items = async (client: pg.Client) => (await client.query('select count(*)::int as n from public.order_items where order_id = $1', [id])).rows[0].n;

    expect(await count(guest)).toBe(1);
    expect(await items(guest)).toBe(1);
    expect(await count(await db.as('authenticated', cafe.waiter))).toBe(1);
    expect(await count(await db.as('authenticated', other.waiter))).toBe(0);
    expect(await items(await db.as('authenticated', other.owner))).toBe(0);
    expect(await count(await db.as('authenticated', await newUser(su, true)))).toBe(0);
    expect(await count(await db.as('anon'))).toBe(0);
  });

  it('an inactive staff member sees nothing', async () => {
    const { id } = await freshOrder();
    await su.query('update public.staff set active = false where user_id = $1', [cafe.waiter2]);
    const n = (await (await db.as('authenticated', cafe.waiter2)).query('select count(*)::int as n from public.orders where id = $1', [id])).rows[0].n;
    await su.query('update public.staff set active = true where user_id = $1', [cafe.waiter2]);
    expect(n).toBe(0);
  });
});

describe('accepting an order', () => {
  it('sets the preparation time, the deadline and the waiter; the guest sees it', async () => {
    const { id, guest } = await freshOrder();
    const waiter = await db.as('authenticated', cafe.waiter);
    expect((await call(waiter, 'select public.accept_order($1, 10) as r', [id])).r).toBe('ok');
    const o = await call(guest, `select status, prep_minutes, waiter_name is not null as named,
                                       round(extract(epoch from deadline - accepted_at) / 60)::int as minutes
                                from public.orders where id = $1`, [id]);
    expect(o).toEqual({ status: 'preparing', prep_minutes: 10, named: true, minutes: 10 });
  });

  it('two waiters at the same moment: exactly one gets it, the other is told it is taken', async () => {
    const { id } = await freshOrder();
    const a = await db.as('authenticated', cafe.waiter);
    const b = await db.as('authenticated', cafe.waiter2);

    await a.query('begin');
    expect((await call(a, 'select public.accept_order($1, 5) as r', [id])).r).toBe('ok');
    const second = call(b, 'select public.accept_order($1, 7) as r', [id]);
    await pause();
    await a.query('commit');

    expect((await second).r).toBe('taken');
    const o = await call(su, 'select prep_minutes, waiter_id from public.orders where id = $1', [id]);
    expect(o.prep_minutes).toBe(5);
  });

  it('many waiters at once: one winner', async () => {
    const { id } = await freshOrder();
    const waiters = await Promise.all([cafe.waiter, cafe.waiter2, cafe.manager, cafe.owner].map((u) => db.as('authenticated', u)));
    const results = await Promise.all(waiters.map((w) => call(w, 'select public.accept_order($1, 5) as r', [id])));
    expect(results.filter((r) => r.r === 'ok')).toHaveLength(1);
  });

  it('accept and reject racing: only one of them happens', async () => {
    const { id } = await freshOrder();
    const [a, b] = await Promise.all([db.as('authenticated', cafe.waiter), db.as('authenticated', cafe.waiter2)]);
    const [x, y] = await Promise.all([
      call(a, 'select public.accept_order($1, 5) as r', [id]),
      call(b, `select public.reject_order($1, 'duplicate') as r`, [id]),
    ]);
    expect([x.r, y.r].sort()).toEqual(['ok', 'taken']);
  });

  it('refuses guests, other cafés and inactive staff', async () => {
    const { id, guest } = await freshOrder();
    await expect(guest.query('select public.accept_order($1, 5)', [id])).rejects.toThrow(/^forbidden$/);
    await expect((await db.as('authenticated', other.waiter)).query('select public.accept_order($1, 5)', [id])).rejects.toThrow(/^forbidden$/);
    await su.query('update public.staff set active = false where user_id = $1', [cafe.waiter2]);
    await expect((await db.as('authenticated', cafe.waiter2)).query('select public.accept_order($1, 5)', [id])).rejects.toThrow(/^forbidden$/);
    await su.query('update public.staff set active = true where user_id = $1', [cafe.waiter2]);
    await expect((await db.as('anon')).query('select public.accept_order($1, 5)', [id])).rejects.toThrow(/permission denied/);
  });

  it('validates the minutes', async () => {
    const { id } = await freshOrder();
    const waiter = await db.as('authenticated', cafe.waiter);
    await expect(waiter.query('select public.accept_order($1, 0)', [id])).rejects.toThrow(/^invalid_minutes$/);
    await expect(waiter.query('select public.accept_order($1, 181)', [id])).rejects.toThrow(/^invalid_minutes$/);
  });
});

describe('status transitions', () => {
  it('pending → preparing → (extend) → ready → served', async () => {
    const { id, guest } = await freshOrder();
    const w = await db.as('authenticated', cafe.waiter);
    await expect(w.query('select public.mark_order_ready($1)', [id])).rejects.toThrow(/^invalid_status$/);
    await expect(w.query('select public.extend_order($1, 5)', [id])).rejects.toThrow(/^invalid_status$/);
    await w.query('select public.accept_order($1, 10)', [id]);
    await expect(w.query('select public.extend_order($1, 0)', [id])).rejects.toThrow(/^invalid_minutes$/);
    await expect(w.query('select public.extend_order($1, 61)', [id])).rejects.toThrow(/^invalid_minutes$/);
    await w.query('select public.extend_order($1, 5)', [id]);
    const extended = await call(guest, 'select prep_minutes, estimate_updated_at is not null as updated from public.orders where id = $1', [id]);
    expect(extended).toEqual({ prep_minutes: 15, updated: true });
    await w.query('select public.mark_order_ready($1)', [id]);
    await w.query('select public.mark_order_served($1)', [id]);
    expect((await call(guest, 'select status from public.orders where id = $1', [id])).status).toBe('served');
    await expect(w.query('select public.mark_order_served($1)', [id])).rejects.toThrow(/^invalid_status$/);
    expect((await call(w, `select public.reject_order($1, 'x') as r`, [id])).r).toBe('taken');
  });

  it('serving straight from preparing records a ready time', async () => {
    const { id } = await freshOrder();
    const w = await db.as('authenticated', cafe.waiter);
    await w.query('select public.accept_order($1, 10)', [id]);
    await w.query('select public.mark_order_served($1)', [id]);
    expect((await call(su, 'select ready_at is not null as ok from public.orders where id = $1', [id])).ok).toBe(true);
  });

  it('a rejected order keeps its reason, cut to 60 characters', async () => {
    const { id, guest } = await freshOrder();
    const w = await db.as('authenticated', cafe.waiter);
    expect((await call(w, 'select public.reject_order($1, $2) as r', [id, 'x'.repeat(100)])).r).toBe('ok');
    const o = await call(guest, 'select status, length(reject_reason)::int as len from public.orders where id = $1', [id]);
    expect(o).toEqual({ status: 'rejected', len: 60 });
  });
});

describe('waiter calls', () => {
  it('a guest at a table can call; staff of that café see and resolve it', async () => {
    const uid = await newUser(su, true);
    const guest = await db.as('authenticated', uid);
    await guest.query('select public.call_waiter($1)', [cafe.tableToken]);
    const open = await call(await db.as('authenticated', cafe.waiter), 'select id from public.waiter_calls where table_id = $1 and resolved_at is null', [cafe.tableId]);
    expect(open?.id).toBeTruthy();
    expect((await guest.query('select * from public.waiter_calls')).rowCount).toBe(0);
    await expect((await db.as('authenticated', other.waiter)).query('select public.resolve_call($1)', [open.id])).rejects.toThrow(/^forbidden$/);
    await (await db.as('authenticated', cafe.waiter)).query('select public.resolve_call($1)', [open.id]);
    expect((await call(su, 'select resolved_at is not null as done from public.waiter_calls where id = $1', [open.id])).done).toBe(true);
  });

  it('rooms have no call button: the server refuses too', async () => {
    const guest = await db.as('authenticated', await newUser(su, true));
    await expect(guest.query('select public.call_waiter($1)', [cafe.roomToken])).rejects.toThrow(/^invalid_table$/);
  });

  it('many taps at the same moment leave a single open call', async () => {
    const c = await createCafe(su);
    const guests = await Promise.all((await newUsers(su, 8)).map((id) => db.as('authenticated', id)));
    await Promise.all(guests.map((g) => g.query('select public.call_waiter($1)', [c.tableToken])));
    const { rows } = await su.query('select count(*)::int as n from public.waiter_calls where table_id = $1 and resolved_at is null', [c.tableId]);
    expect(rows[0].n).toBe(1);
  });
});
