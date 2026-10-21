/** admin_order_stats — totals for the overview, with days counted in the café's time zone. */

import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createCafe, newUser, testDb, type Cafe } from './db';

const db = testDb();
let su: pg.Client;
let cafe: Cafe;
let manager: pg.Client;

/**
 * A Belgrade wall-clock time as an SQL timestamptz: midnight `days` days ago plus `hours`
 * (computed in local time, so a daylight-saving change never shifts the hour).
 */
const local = (days: number, hours = 0) =>
  `((date_trunc('day', now() at time zone 'Europe/Belgrade') - interval '${days} days' + interval '${hours} hours') at time zone 'Europe/Belgrade')`;
const midnight = (days = 0) => local(days);

async function addOrder(o: {
  at: string; status: string; total: number; place?: 'table' | 'room'; prep?: number;
  items: { product: string; qty: number; price: number }[];
}) {
  const guest = await newUser(su, true);
  const { rows: [{ n }] } = await su.query('select coalesce(max(number), 0) + 1 as n from public.orders where cafe_id = $1', [cafe.id]);
  const room = o.place === 'room';
  const { rows: [row] } = await su.query(
    `insert into public.orders (number, cafe_id, table_id, table_number, table_kind, guest_id, status, total, created_at, accepted_at, ready_at)
     values ($1, $2, $3, 1, $4, $5, $6, $7, ${o.at}, ${o.prep ? `${o.at} + interval '1 minute'` : 'null'},
             ${o.prep ? `${o.at} + interval '1 minute' + make_interval(mins => ${o.prep})` : 'null'})
     returning id`,
    [n, cafe.id, room ? cafe.roomId : cafe.tableId, room ? 'room' : 'table', guest, o.status, o.total],
  );
  for (const i of o.items) {
    await su.query(`insert into public.order_items (order_id, product_id, name, qty, unit_price) select $1, id, name, $3, $4 from public.products where id = $2`, [row.id, i.product, i.qty, i.price]);
  }
}

beforeAll(async () => {
  su = await db.superuser();
  cafe = await createCafe(su);
  manager = await db.as('authenticated', cafe.manager);

  await addOrder({ at: local(1, 10), status: 'served', total: 500, prep: 10, items: [{ product: cafe.latteId, qty: 2, price: 250 }] });
  await addOrder({ at: local(1, 11), status: 'served', total: 400, prep: 8, place: 'room', items: [{ product: cafe.cakeId, qty: 1, price: 400 }] });
  await addOrder({ at: local(1, 23.5), status: 'served', total: 300, prep: 6, items: [{ product: cafe.cakeId, qty: 1, price: 300 }] });
  // 00:30 in Belgrade is still "yesterday" in UTC: it must count for today.
  await addOrder({ at: local(0, 0.5), status: 'pending', total: 250, items: [{ product: cafe.latteId, qty: 1, price: 250 }] });
  await addOrder({ at: local(0, 1), status: 'rejected', total: 999, items: [{ product: cafe.soldOutId, qty: 5, price: 450 }] });
  // Before the period.
  await addOrder({ at: local(3, 23), status: 'served', total: 7777, items: [{ product: cafe.cakeId, qty: 9, price: 400 }] });
});

const stats = async (client: pg.Client, days: number, tz = 'Europe/Belgrade', cafeId = cafe.id) =>
  (await client.query(`select public.admin_order_stats($1, ${midnight(days - 1)}, null, $2) as s`, [cafeId, tz])).rows[0].s;

describe('admin_order_stats', () => {
  it('totals the period: pending counts as an order but not as revenue, rejected stays apart', async () => {
    const s = await stats(manager, 3);
    expect(s).toMatchObject({ orders: 4, rejected: 1, revenue: 1200, roomOrders: 1, prepCount: 3, prepMinutes: 8 });
  });

  it('lists every day of the period in the café time zone, empty days included', async () => {
    const s = await stats(manager, 3);
    expect(s.byDay.map((d: { orders: number; revenue: number }) => [d.orders, d.revenue])).toEqual([[0, 0], [3, 1200], [1, 0]]);
    expect(s.byDay.at(-1).day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.byHour).toEqual([{ hour: 0, orders: 1 }, { hour: 1, orders: 1 }, { hour: 10, orders: 1 }, { hour: 11, orders: 1 }, { hour: 23, orders: 1 }]);
  });

  it('ranks best sellers by quantity and leaves rejected orders out', async () => {
    const s = await stats(manager, 3);
    expect(s.top.map((p: { qty: number; revenue: number }) => [p.qty, p.revenue])).toEqual([[3, 750], [2, 700]]);
    expect(s.top[0].name).toEqual({ sr: 'Latte', en: 'Latte' });
  });

  it('can be limited to one earlier day', async () => {
    const { rows: [{ s }] } = await manager.query(`select public.admin_order_stats($1, ${local(1)}, ${local(0)}, 'Europe/Belgrade') as s`, [cafe.id]);
    expect(s).toMatchObject({ orders: 3, rejected: 0, revenue: 1200, roomOrders: 1, prepCount: 3, prepMinutes: 8 });
    expect(s.byDay).toHaveLength(1);
    expect(s.byDay[0]).toMatchObject({ orders: 3, revenue: 1200 });
    expect(s.byHour.map((h: { hour: number }) => h.hour)).toEqual([10, 11, 23]);
  });

  it('falls back to Belgrade for an unknown time zone', async () => {
    expect(await stats(manager, 3, 'Mars/Olympus')).toEqual(await stats(manager, 3));
  });

  it('is for managers of that café only', async () => {
    await expect(stats(await db.as('authenticated', cafe.waiter), 3)).rejects.toThrow(/^forbidden$/);
    const other = await createCafe(su);
    await expect(stats(await db.as('authenticated', other.manager), 3)).rejects.toThrow(/^forbidden$/);
    await expect(stats(await db.as('anon'), 3)).rejects.toThrow(/permission denied/);
  });
});
