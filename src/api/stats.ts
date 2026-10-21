/**
 * Order statistics for the demo backend — the browser twin of public.admin_order_stats.
 *
 * The SQL function totals orders in the database (a busy month is more than the API returns in
 * one request); the demo has every order at hand and computes the same figures here.
 */

import type { Order, OrderStats } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** A local calendar day as YYYY-MM-DD (the format admin_order_stats returns). */
export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * The same figures as public.admin_order_stats, computed from orders in the browser's time zone.
 * Used by the demo backend; keep the two in step (tests cover both).
 */
export function computeOrderStats(all: Order[], since: number, until: number | null, now = Date.now()): OrderStats {
  const orders = all.filter((o) => o.createdAt >= since && (until === null || o.createdAt < until));
  const end = Math.min(until === null ? now : until - 1, now);
  const kept = orders.filter((o) => o.status !== 'rejected');
  const prepped = orders.filter((o) => o.acceptedAt && o.readyAt && o.readyAt > o.acceptedAt);

  // Every calendar day from the first to today; setDate() steps over daylight-saving changes correctly.
  const days = new Map<string, { day: string; orders: number; revenue: number }>();
  for (const d = new Date(new Date(since).setHours(0, 0, 0, 0)); d.getTime() <= end; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d.getTime());
    days.set(key, { day: key, orders: 0, revenue: 0 });
  }
  for (const o of kept) {
    const d = days.get(dayKey(o.createdAt));
    if (!d) continue;
    d.orders++;
    if (o.status !== 'pending') d.revenue += o.total;
  }

  const hours = new Map<number, number>();
  for (const o of orders) {
    const h = new Date(o.createdAt).getHours();
    hours.set(h, (hours.get(h) ?? 0) + 1);
  }

  const sellers = new Map<string, OrderStats['top'][number] & { last: number }>();
  for (const o of kept) {
    for (const i of o.items) {
      const key = i.productId ?? JSON.stringify(i.name);
      const s = sellers.get(key) ?? { key, name: i.name, qty: 0, revenue: 0, last: 0 };
      s.qty += i.qty;
      s.revenue += i.qty * i.unitPrice;
      if (o.createdAt >= s.last) {
        s.name = i.name; // the latest name, like the SQL version
        s.last = o.createdAt;
      }
      sellers.set(key, s);
    }
  }

  const prepTotal = prepped.reduce((a, o) => a + (o.readyAt! - o.acceptedAt!), 0);
  return {
    orders: kept.length,
    rejected: orders.length - kept.length,
    revenue: kept.filter((o) => o.status !== 'pending').reduce((a, o) => a + o.total, 0),
    roomOrders: kept.filter((o) => o.tableKind === 'room').length,
    prepMinutes: prepped.length ? Math.round((prepTotal / prepped.length / 60_000) * 10) / 10 : null,
    prepCount: prepped.length,
    byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byHour: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([hour, n]) => ({ hour, orders: n })),
    top: [...sellers.values()]
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
      .slice(0, 5)
      .map(({ key, name, qty, revenue }) => ({ key, name, qty, revenue })),
  };
}
