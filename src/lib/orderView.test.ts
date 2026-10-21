import { describe, expect, it } from 'vitest';
import type { Order } from '../api/types';
import { displayStatus, floorFromNumber, floorLabel, mmss, placeKey, tableState } from './orderView';
import { defaultChoices, resolveChoice, unitPrice } from '../api/pricing';
import { DEMO_PRODUCTS } from '../api/seedData';

const MIN = 60_000;
const T = Date.UTC(2026, 9, 20, 9, 0); // a real timestamp: 0 would read as "not set"
const order = (o: Partial<Order>): Order => ({
  id: 'o', number: 1, tableId: 't', tableNumber: 1, tableKind: 'table', status: 'pending', note: '', total: 0, createdAt: 0,
  acceptedAt: null, deadline: null, prepMinutes: null, estimateUpdatedAt: null, readyAt: null, servedAt: null, rejectedAt: null,
  rejectReason: null, waiterId: null, waiterName: null, items: [], ...o,
});

describe('order status shown to people', () => {
  it('"accepted" for a few seconds, then "preparing", then "late" after the deadline', () => {
    const o = order({ status: 'preparing', acceptedAt: T, deadline: T + 10 * MIN });
    expect(displayStatus(o, T + 1_000)).toBe('accepted');
    expect(displayStatus(o, T + MIN)).toBe('preparing');
    expect(displayStatus(o, T + 11 * MIN)).toBe('late');
  });

  it('table occupancy from its orders', () => {
    expect(tableState([order({ status: 'pending' })], 0)).toBe('new');
    expect(tableState([order({ status: 'ready' })], 0)).toBe('preparing');
    expect(tableState([order({ status: 'served', servedAt: T })], T + 30 * MIN)).toBe('occupied');
    expect(tableState([order({ status: 'served', servedAt: T })], T + 2 * 60 * MIN)).toBe('free');
  });

  it('formats a countdown', () => {
    expect(mmss(65_000)).toBe('1:05');
    expect(mmss(-5)).toBe('0:00');
  });
});

describe('tables and rooms', () => {
  it('labels and floors', () => {
    expect(placeKey('room')).toBe('common.room');
    expect(placeKey('table')).toBe('common.table');
    expect(placeKey(undefined)).toBe('common.table'); // data saved before rooms existed
    const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? `:${v.n}` : ''}`;
    expect(floorLabel(t, 0)).toBe('admin.tables.groundFloor');
    expect(floorLabel(t, 4)).toBe('admin.tables.floor:4');
    expect(floorLabel(t, null)).toBeNull();
    expect(floorFromNumber(402)).toBe(4);
    expect(floorFromNumber(1215)).toBe(12);
    expect(floorFromNumber(12)).toBeNull();
  });
});

describe('price estimate in the cart (the server recomputes it)', () => {
  const cappuccino = DEMO_PRODUCTS.find((p) => p.id === 'p2')!;
  it('adds the surcharges of the chosen options', () => {
    expect(unitPrice(cappuccino, { size: 'l', milk: 'oat' })).toBe(260 + 60 + 50);
  });
  it('falls back to the first choice, like the server', () => {
    expect(resolveChoice(cappuccino, 'milk', 'gold')?.id).toBe('cow');
    expect(unitPrice(cappuccino, {})).toBe(260);
    expect(defaultChoices(cappuccino)).toEqual({ size: 's', milk: 'cow' });
  });
});
