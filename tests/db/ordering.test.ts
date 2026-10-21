/**
 * Guest ordering against the real schema — menu by QR token, server-side prices, validation,
 * and the five-second limit under concurrent requests.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createCafe, line, newUser, newUsers, pause, placeOrder, testDb, type Cafe } from './db';

const db = testDb();
let su: pg.Client;
let cafe: Cafe;

beforeAll(async () => {
  su = await db.superuser();
  cafe = await createCafe(su);
});

describe('menu by QR code', () => {
  it('returns the café, the table and the menu for a table token, even to anon', async () => {
    const anon = await db.as('anon');
    const { rows } = await anon.query('select public.guest_table($1) as menu', [cafe.tableToken]);
    const menu = rows[0].menu;
    expect(menu.cafe.id).toBe(cafe.id);
    expect(menu.table).toMatchObject({ id: cafe.tableId, number: 1, kind: 'table' });
    expect(menu.products.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining([cafe.latteId, cafe.cakeId, cafe.soldOutId]));
  });

  it('tells a room from a table with the same number', async () => {
    const anon = await db.as('anon');
    const { rows } = await anon.query('select public.guest_table($1) as menu', [cafe.roomToken]);
    expect(rows[0].menu.table).toMatchObject({ id: cafe.roomId, number: 1, kind: 'room' });
  });

  it('returns null for an unknown token', async () => {
    const anon = await db.as('anon');
    const { rows } = await anon.query('select public.guest_table($1) as menu', ['nope']);
    expect(rows[0].menu).toBeNull();
  });
});

describe('placing an order', () => {
  it('computes prices on the server and records the table', async () => {
    const guest = await db.as('authenticated', await newUser(su, true));
    const id = await placeOrder(guest, cafe.tableToken, [line(cafe.latteId, 2, { milk: 'oat' }), line(cafe.cakeId, 1)], 'Bez šećera');
    const { rows: [o] } = await su.query('select * from public.orders where id = $1', [id]);
    expect(o).toMatchObject({ cafe_id: cafe.id, table_id: cafe.tableId, table_number: 1, table_kind: 'table', status: 'pending', total: 2 * 310 + 400, note: 'Bez šećera' });
    const { rows: items } = await su.query('select unit_price, qty from public.order_items where order_id = $1 order by unit_price', [id]);
    expect(items).toEqual([{ unit_price: 310, qty: 2 }, { unit_price: 400, qty: 1 }]);
  });

  it('ignores prices and unknown choices sent by the phone', async () => {
    const guest = await db.as('authenticated', await newUser(su, true));
    const id = await placeOrder(guest, cafe.tableToken, [{ productId: cafe.latteId, qty: 1, choices: { milk: 'gold' }, note: '', price: 1, unitPrice: 1 }]);
    const { rows: [o] } = await su.query('select total from public.orders where id = $1', [id]);
    expect(o.total).toBe(250); // unknown choice → the group's default (cow, +0)
  });

  it('records orders from a room as room service', async () => {
    const guest = await db.as('authenticated', await newUser(su, true));
    const id = await placeOrder(guest, cafe.roomToken, [line(cafe.cakeId)]);
    const { rows: [o] } = await su.query('select table_id, table_number, table_kind from public.orders where id = $1', [id]);
    expect(o).toEqual({ table_id: cafe.roomId, table_number: 1, table_kind: 'room' });
  });

  it.each([
    ['unavailable product', () => [line(cafe.soldOutId)], 'product_unavailable'],
    ['unknown product', () => [line('00000000-0000-4000-8000-0000000000ff')], 'unknown_product'],
    ['zero quantity', () => [line(cafe.cakeId, 0)], 'invalid_quantity'],
    ['quantity above 50', () => [line(cafe.cakeId, 51)], 'invalid_quantity'],
    ['empty order', () => [], 'empty_order'],
    ['more than 40 lines', () => Array.from({ length: 41 }, () => line(cafe.cakeId)), 'too_many_items'],
  ])('rejects %s', async (_name, items, code) => {
    const guest = await db.as('authenticated', await newUser(su, true));
    await expect(placeOrder(guest, cafe.tableToken, items())).rejects.toThrow(new RegExp(`^${code}$`));
  });

  it('rejects an unknown or removed table', async () => {
    const guest = await db.as('authenticated', await newUser(su, true));
    await expect(placeOrder(guest, 'nope', [line(cafe.cakeId)])).rejects.toThrow(/^invalid_table$/);
  });

  it('needs a signed-in (anonymous) guest', async () => {
    const noUser = await db.as('authenticated');
    await expect(placeOrder(noUser, cafe.tableToken, [line(cafe.cakeId)])).rejects.toThrow(/^not_authenticated$/);
    const anon = await db.as('anon');
    await expect(placeOrder(anon, cafe.tableToken, [line(cafe.cakeId)])).rejects.toThrow(/permission denied/);
  });

  it('reports an order too large for an integer total as too large, not as a crash', async () => {
    const { rows: [p] } = await su.query(`insert into public.products (cafe_id, name, price) values ($1, '{"sr":"Skupo"}', 100000000) returning id`, [cafe.id]);
    const guest = await db.as('authenticated', await newUser(su, true));
    await expect(placeOrder(guest, cafe.tableToken, [line(p.id, 50)])).rejects.toThrow(/^too_many_items$/);
  });
});

describe('five-second limit per guest', () => {
  it('rejects a second order sent right after the first', async () => {
    const guest = await db.as('authenticated', await newUser(su, true));
    await placeOrder(guest, cafe.tableToken, [line(cafe.cakeId)]);
    await expect(placeOrder(guest, cafe.tableToken, [line(cafe.cakeId)])).rejects.toThrow(/^too_fast$/);
  });

  it('holds when the second request arrives while the first is still being saved', async () => {
    const uid = await newUser(su, true);
    const a = await db.as('authenticated', uid);
    const b = await db.as('authenticated', uid);

    await a.query('begin');
    await placeOrder(a, cafe.tableToken, [line(cafe.cakeId)]); // inserted, not yet committed
    const second = placeOrder(b, cafe.tableToken, [line(cafe.cakeId)]).then(() => 'ok', (e: Error) => e.message);
    await pause();
    await a.query('commit');

    expect(await second).toBe('too_fast');
    const { rows } = await su.query('select count(*)::int as n from public.orders where guest_id = $1', [uid]);
    expect(rows[0].n).toBe(1);
  });

  it('lets exactly one of ten simultaneous requests through', async () => {
    const uid = await newUser(su, true);
    const clients = await Promise.all(Array.from({ length: 10 }, () => db.as('authenticated', uid)));
    const results = await Promise.all(clients.map((c) => placeOrder(c, cafe.tableToken, [line(cafe.cakeId)]).then(() => 'ok', (e: Error) => e.message)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r !== 'ok').every((r) => r === 'too_fast')).toBe(true);
    const { rows } = await su.query('select count(*)::int as n from public.orders where guest_id = $1', [uid]);
    expect(rows[0].n).toBe(1);
  });

  it('does not slow down different guests: simultaneous orders all succeed with distinct numbers', async () => {
    const guests = await Promise.all((await newUsers(su, 8)).map((id) => db.as('authenticated', id)));
    const ids = await Promise.all(guests.map((g) => placeOrder(g, cafe.tableToken, [line(cafe.cakeId)])));
    const { rows } = await su.query('select number from public.orders where id = any($1::uuid[])', [ids]);
    expect(new Set(rows.map((r) => r.number)).size).toBe(8);
  });
});

describe('one open order at a time (allow_repeat = false)', () => {
  it('holds under concurrent requests from the same guest', async () => {
    const strict = await createCafe(su, { allowRepeat: false });
    const uid = await newUser(su, true);
    const a = await db.as('authenticated', uid);
    const b = await db.as('authenticated', uid);
    // Make the five-second limit irrelevant: only the "order in progress" rule should stop b.
    await su.query(`insert into public.orders (number, cafe_id, table_id, table_number, guest_id, status, created_at)
                    values (1, $1, $2, 1, $3, 'served', now() - interval '1 hour')`, [strict.id, strict.tableId, uid]);

    await a.query('begin');
    await placeOrder(a, strict.tableToken, [line(strict.cakeId)]);
    const second = placeOrder(b, strict.tableToken, [line(strict.cakeId)]).then(() => 'ok', (e: Error) => e.message);
    await pause();
    await a.query('commit');

    expect(['too_fast', 'order_in_progress']).toContain(await second);
    const { rows } = await su.query(`select count(*)::int as n from public.orders where guest_id = $1 and status = 'pending'`, [uid]);
    expect(rows[0].n).toBe(1);
  });
});
