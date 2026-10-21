// The demo version of admin_order_stats; tests/db/stats.test.ts runs the same scenario in SQL.
import { describe, expect, it } from 'vitest';
import { computeOrderStats, dayKey } from './stats';
import type { Order, OrderItem } from './types';

const MIN = 60_000;
const today = new Date();
today.setHours(0, 0, 0, 0);
/** Local wall-clock time: midnight `daysAgo` days ago plus `hours` (daylight-saving safe). */
const at = (daysAgo: number, hours: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(Math.floor(hours), Math.round((hours % 1) * 60));
  return d.getTime();
};
const item = (productId: string, qty: number, unitPrice: number): OrderItem => ({ id: productId + qty, productId, name: { sr: productId }, qty, unitPrice, choices: [], note: '' });
const order = (createdAt: number, status: Order['status'], total: number, items: OrderItem[], extra: Partial<Order> = {}): Order => ({
  id: String(createdAt), number: 1, tableId: 't', tableNumber: 1, tableKind: 'table', status, note: '', total, createdAt,
  acceptedAt: null, deadline: null, prepMinutes: null, estimateUpdatedAt: null, readyAt: null, servedAt: null, rejectedAt: null,
  rejectReason: null, waiterId: null, waiterName: null, items, ...extra,
});
const prep = (createdAt: number, minutes: number) => ({ acceptedAt: createdAt + MIN, readyAt: createdAt + MIN + minutes * MIN });

const orders: Order[] = [
  order(at(1, 10), 'served', 500, [item('latte', 2, 250)], prep(at(1, 10), 10)),
  order(at(1, 11), 'served', 400, [item('cake', 1, 400)], { ...prep(at(1, 11), 8), tableKind: 'room' }),
  order(at(1, 23.5), 'served', 300, [item('cake', 1, 300)], prep(at(1, 23.5), 6)),
  order(at(0, 0.5), 'pending', 250, [item('latte', 1, 250)]),
  order(at(0, 1), 'rejected', 999, [item('souffle', 5, 450)]),
  order(at(3, 23), 'served', 7777, [item('cake', 9, 400)]), // before the period
];

describe('computeOrderStats', () => {
  const s = computeOrderStats(orders, at(2, 0), null, at(0, 2));

  it('matches the SQL totals', () => {
    expect(s).toMatchObject({ orders: 4, rejected: 1, revenue: 1200, roomOrders: 1, prepCount: 3, prepMinutes: 8 });
  });

  it('lists every day, oldest first, with empty days', () => {
    expect(s.byDay.map((d) => [d.orders, d.revenue])).toEqual([[0, 0], [3, 1200], [1, 0]]);
    expect(s.byDay.at(-1)!.day).toBe(dayKey(Date.now()));
    expect(s.byHour).toEqual([{ hour: 0, orders: 1 }, { hour: 1, orders: 1 }, { hour: 10, orders: 1 }, { hour: 11, orders: 1 }, { hour: 23, orders: 1 }]);
  });

  it('can be limited to one earlier day', () => {
    const day = computeOrderStats(orders, at(1, 0), at(0, 0), at(0, 2));
    expect(day).toMatchObject({ orders: 3, rejected: 0, revenue: 1200, roomOrders: 1, prepCount: 3, prepMinutes: 8 });
    expect(day.byDay).toEqual([{ day: dayKey(at(1, 0)), orders: 3, revenue: 1200 }]);
    expect(day.byHour.map((h) => h.hour)).toEqual([10, 11, 23]);
  });

  it('ranks best sellers without rejected orders', () => {
    expect(s.top.map((p) => [p.key, p.qty, p.revenue])).toEqual([['latte', 3, 750], ['cake', 2, 700]]);
  });
});
