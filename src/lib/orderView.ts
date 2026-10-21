/** How orders and places are shown — display status, countdown, table state and labels. */

import type { Order, OrderItem, OrderStatus, PlaceKind } from '../api/types';

/** What the UI shows. `accepted` and `late` are derived from timestamps, not stored. */
export type DisplayStatus = OrderStatus | 'accepted' | 'late';

/** How long the "your order has been accepted" moment is shown before switching to "preparing". */
const ACCEPTED_MOMENT_MS = 8_000;

export function displayStatus(o: Order, now: number): DisplayStatus {
  if (o.status === 'preparing') {
    if (o.deadline && now > o.deadline) return 'late';
    if (o.acceptedAt && now - o.acceptedAt < ACCEPTED_MOMENT_MS) return 'accepted';
  }
  return o.status;
}

export const isOpen = (o: Order) => o.status === 'pending' || o.status === 'preparing' || o.status === 'ready';

export function progress(o: Order, now: number): number {
  if (!o.acceptedAt || !o.deadline) return 0;
  const span = Math.max(1, o.deadline - o.acceptedAt);
  return Math.min(1, Math.max(0, (now - o.acceptedAt) / span));
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const minutesSince = (ts: number, now: number) => Math.max(0, Math.floor((now - ts) / 60_000));

export const itemCount = (o: Pick<Order, 'items'>) => o.items.reduce((a, i) => a + i.qty, 0);

export const STEPS = ['pending', 'accepted', 'preparing', 'ready', 'served'] as const;

export function stepIndex(s: DisplayStatus): number {
  switch (s) {
    case 'pending': return 0;
    case 'accepted': return 1;
    case 'preparing':
    case 'late': return 2;
    case 'ready': return 3;
    case 'served': return 4;
    default: return -1;
  }
}

/** Choices worth printing on a ticket, in the visitor's language. */
export function itemOptions(item: OrderItem, loc: (f: Record<string, string>) => string): string {
  return item.choices.filter((c) => !c.quiet).map((c) => loc(c.choiceName)).join(' · ');
}

export type TableState = 'free' | 'occupied' | 'new' | 'preparing';

/** Derived from today's orders: guests who were served in the last hour still count as seated. */
export function tableState(orders: Order[], now: number): TableState {
  if (orders.some((o) => o.status === 'pending')) return 'new';
  if (orders.some((o) => o.status === 'preparing' || o.status === 'ready')) return 'preparing';
  if (orders.some((o) => o.status === 'served' && o.servedAt && now - o.servedAt < 60 * 60_000)) return 'occupied';
  return 'free';
}

export const MAX_FLOOR = 200;

/** "2. sprat" / "Prizemlje", or null when the room has no floor set. */
export function floorLabel(t: (key: string, vars?: Record<string, string | number>) => string, floor: number | null | undefined): string | null {
  if (floor === null || floor === undefined) return null;
  return floor === 0 ? t('admin.tables.groundFloor') : t('admin.tables.floor', { n: floor });
}

/** The usual hotel convention, used only as a suggestion: room 402 is on floor 4. */
export const floorFromNumber = (n: number): number | null => (n >= 100 ? Math.floor(n / 100) : null);

/** Translation key for "Table 7" / "Room 214". Data saved before rooms existed has no kind: it is a table. */
export const placeKey = (kind: PlaceKind | undefined) => (kind === 'room' ? 'common.room' : 'common.table');
