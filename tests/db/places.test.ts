// Tables and hotel rooms: numbering per kind, QR tokens, removal, bulk room creation and floors.
import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createCafe, line, newUser, placeOrder, testDb, type Cafe } from './db';

const db = testDb();
let su: pg.Client;
let cafe: Cafe;
let manager: pg.Client;

beforeAll(async () => {
  su = await db.superuser();
  cafe = await createCafe(su);
  manager = await db.as('authenticated', cafe.manager);
});

const saveTable = (input: Record<string, unknown>, cafeId = cafe.id) =>
  manager.query('select public.admin_save_table($1, $2::jsonb) as id', [cafeId, JSON.stringify({ seats: 2, zone: 'hall', floor: null, ...input })]);

describe('numbering', () => {
  it('table 1 and room 1 live side by side', async () => {
    const { rows } = await su.query(`select kind, number from public.dining_tables where cafe_id = $1 and active order by kind`, [cafe.id]);
    expect(rows).toEqual([{ kind: 'room', number: 1 }, { kind: 'table', number: 1 }]);
  });

  it('numbers stay unique within each kind', async () => {
    await expect(saveTable({ kind: 'table', number: 1 })).rejects.toThrow(/^duplicate_number$/);
    await expect(saveTable({ kind: 'room', number: 1 })).rejects.toThrow(/^duplicate_number$/);
    await saveTable({ kind: 'table', number: 2 });
    await saveTable({ kind: 'room', number: 2 });
  });

  it('the database itself enforces it (not only the function)', async () => {
    await expect(su.query(`insert into public.dining_tables (cafe_id, kind, number) values ($1, 'room', 1)`, [cafe.id])).rejects.toThrow(/dining_tables_active_kind_number_idx/);
  });

  it('renumbering onto a taken number is refused; the kind of a place cannot change', async () => {
    const { rows: [t] } = await saveTable({ kind: 'table', number: 3 });
    await expect(saveTable({ id: t.id, kind: 'table', number: 1 })).rejects.toThrow(/^duplicate_number$/);
    await saveTable({ id: t.id, kind: 'room', number: 3 }); // kind in the request is ignored for an existing place
    const { rows: [after] } = await su.query('select kind from public.dining_tables where id = $1', [t.id]);
    expect(after.kind).toBe('table');
  });
});

describe('QR tokens', () => {
  it('a new code replaces the old one immediately', async () => {
    const { rows: [{ token }] } = await manager.query('select public.admin_regenerate_table_token($1) as token', [cafe.tableId]);
    const anon = await db.as('anon');
    expect((await anon.query('select public.guest_table($1) as m', [cafe.tableToken])).rows[0].m).toBeNull();
    expect((await anon.query('select public.guest_table($1) as m', [token])).rows[0].m.table.id).toBe(cafe.tableId);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    cafe.tableToken = token;
  });
});

describe('removing a place', () => {
  it('keeps the order history, frees the number and disables the QR code', async () => {
    const { rows: [t] } = await saveTable({ kind: 'table', number: 40 });
    const { rows: [{ qr_token }] } = await su.query('select qr_token from public.dining_tables where id = $1', [t.id]);
    const guest = await db.as('authenticated', await newUser(su, true));
    await placeOrder(guest, qr_token, [line(cafe.cakeId)]);

    await manager.query('select public.admin_delete_table($1)', [t.id]);
    expect((await su.query('select active from public.dining_tables where id = $1', [t.id])).rows[0].active).toBe(false);
    expect((await su.query('select count(*)::int as n from public.orders where table_id = $1', [t.id])).rows[0].n).toBe(1);
    expect((await (await db.as('anon')).query('select public.guest_table($1) as m', [qr_token])).rows[0].m).toBeNull();
    await saveTable({ kind: 'table', number: 40 }); // the number is free again
  });

  it('deletes a place without history outright', async () => {
    const { rows: [t] } = await saveTable({ kind: 'room', number: 41 });
    await manager.query('select public.admin_delete_table($1)', [t.id]);
    expect((await su.query('select count(*)::int as n from public.dining_tables where id = $1', [t.id])).rows[0].n).toBe(0);
  });
});

describe('adding rooms in bulk', () => {
  it('skips numbers that exist, stores the floor, gives every room its own code', async () => {
    const { rows: [{ n }] } = await manager.query('select public.admin_add_rooms($1, 1, 5, 0) as n', [cafe.id]);
    expect(n).toBe(3); // 1 and 2 already exist
    const { rows } = await su.query(`select number, floor, qr_token from public.dining_tables where cafe_id = $1 and kind = 'room' and number between 3 and 5 order by number`, [cafe.id]);
    expect(rows.map((r) => [r.number, r.floor])).toEqual([[3, 0], [4, 0], [5, 0]]);
    expect(new Set(rows.map((r) => r.qr_token)).size).toBe(3);
  });

  it('validates the range and the floor', async () => {
    await expect(manager.query('select public.admin_add_rooms($1, 10, 9, null)', [cafe.id])).rejects.toThrow(/^invalid_range$/);
    await expect(manager.query('select public.admin_add_rooms($1, 1, 301, null)', [cafe.id])).rejects.toThrow(/^invalid_range$/);
    await expect(manager.query('select public.admin_add_rooms($1, 600, 601, 201)', [cafe.id])).rejects.toThrow(/^invalid_floor$/);
    await expect(saveTable({ kind: 'room', number: 700, floor: -1 })).rejects.toThrow(/^invalid_floor$/);
  });

  it('waiters cannot add rooms', async () => {
    await expect((await db.as('authenticated', cafe.waiter)).query('select public.admin_add_rooms($1, 900, 901, null)', [cafe.id])).rejects.toThrow(/^forbidden$/);
  });
});

describe('seed', () => {
  it('has 12 tables and 90 rooms on floors 1–3', async () => {
    const { rows } = await su.query(
      `select kind, count(*)::int as n, min(floor) as lo, max(floor) as hi from public.dining_tables
        where cafe_id = '00000000-0000-4000-8000-000000000001' group by kind order by kind`,
    );
    expect(rows).toEqual([{ kind: 'room', n: 90, lo: 1, hi: 3 }, { kind: 'table', n: 12, lo: null, hi: null }]);
  });
});
