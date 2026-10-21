/**
 * Stočić Café and Stočić Hotel — what each edition may do, enforced by the database itself, and
 * how 20261021120000_editions.sql classifies establishments that existed before it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import pg from 'pg';
import { createCafe, line, newUser, placeOrder, testDb, type Cafe } from './db';
import { applyMigrations, applyStubs, migrationFiles } from './schema';

const db = testDb();
let su: pg.Client;
let cafe: Cafe; // Stočić Café that still has a room row (e.g. downgraded from Hotel)
let hotel: Cafe;

beforeAll(async () => {
  su = await db.superuser();
  cafe = await createCafe(su, { edition: 'cafe' });
  hotel = await createCafe(su, { edition: 'hotel' });
});

const menu = async (token: string) => (await (await db.as('anon')).query('select public.guest_table($1) as m', [token])).rows[0].m;
const asGuest = async () => db.as('authenticated', await newUser(su, true));
const room = (input: Record<string, unknown>) => JSON.stringify({ kind: 'room', seats: 2, zone: 'room', floor: 1, ...input });

describe('Stočić Café', () => {
  it('guests scan a table code, see the edition and order', async () => {
    const m = await menu(cafe.tableToken);
    expect(m.cafe.edition).toBe('cafe');
    expect(m.table.kind).toBe('table');
    const id = await placeOrder(await asGuest(), cafe.tableToken, [line(cafe.cakeId)]);
    const accepted = await (await db.as('authenticated', cafe.waiter)).query('select public.accept_order($1, 5) as r', [id]);
    expect(accepted.rows[0].r).toBe('ok');
  });

  it('a room code is not an active QR code, and a direct room-service order is refused', async () => {
    expect(await menu(cafe.roomToken)).toBeNull();
    await expect(placeOrder(await asGuest(), cafe.roomToken, [line(cafe.cakeId)])).rejects.toThrow(/^invalid_table$/);
  });

  it('managers keep managing tables', async () => {
    const manager = await db.as('authenticated', cafe.manager);
    const { rows: [t] } = await manager.query('select public.admin_save_table($1, $2::jsonb) as id', [cafe.id, JSON.stringify({ kind: 'table', number: 2, seats: 4, zone: 'garden', floor: null })]);
    await manager.query('select public.admin_regenerate_table_token($1)', [t.id]);
    await manager.query('select public.admin_delete_table($1)', [t.id]);
  });

  it('rooms cannot be created or managed through direct API calls', async () => {
    const manager = await db.as('authenticated', cafe.manager);
    await expect(manager.query('select public.admin_save_table($1, $2::jsonb)', [cafe.id, room({ number: 5 })])).rejects.toThrow(/^hotel_only$/);
    await expect(manager.query('select public.admin_save_table($1, $2::jsonb)', [cafe.id, room({ id: cafe.roomId, number: 6 })])).rejects.toThrow(/^hotel_only$/);
    await expect(manager.query('select public.admin_add_rooms($1, 100, 105, 1)', [cafe.id])).rejects.toThrow(/^hotel_only$/);
    await expect(manager.query('select public.admin_regenerate_table_token($1)', [cafe.roomId])).rejects.toThrow(/^hotel_only$/);
    await expect(manager.query('select public.admin_delete_table($1)', [cafe.roomId])).rejects.toThrow(/^hotel_only$/);
  });

  it('non-managers learn nothing about the edition: they are refused as before', async () => {
    await expect((await db.as('authenticated', cafe.waiter)).query('select public.admin_add_rooms($1, 100, 105, 1)', [cafe.id])).rejects.toThrow(/^forbidden$/);
    await expect((await db.as('authenticated', hotel.manager)).query('select public.admin_add_rooms($1, 100, 105, 1)', [cafe.id])).rejects.toThrow(/^forbidden$/);
  });
});

describe('Stočić Hotel', () => {
  it('guests order from tables and from rooms; staff can tell them apart', async () => {
    const t = await placeOrder(await asGuest(), hotel.tableToken, [line(hotel.cakeId)]);
    const r = await placeOrder(await asGuest(), hotel.roomToken, [line(hotel.cakeId)]);
    const { rows } = await (await db.as('authenticated', hotel.waiter)).query('select id, table_kind from public.orders where id = any($1::uuid[])', [[t, r]]);
    expect(Object.fromEntries(rows.map((o) => [o.id, o.table_kind]))).toEqual({ [t]: 'table', [r]: 'room' });
    expect((await menu(hotel.roomToken)).cafe.edition).toBe('hotel');
  });

  it('room orders follow the same statuses and preparation times', async () => {
    const id = await placeOrder(await asGuest(), hotel.roomToken, [line(hotel.cakeId)]);
    const w = await db.as('authenticated', hotel.waiter);
    await w.query('select public.accept_order($1, 20)', [id]);
    await w.query('select public.mark_order_ready($1)', [id]);
    await w.query('select public.mark_order_served($1)', [id]);
    const { rows: [o] } = await su.query('select status, prep_minutes from public.orders where id = $1', [id]);
    expect(o).toEqual({ status: 'served', prep_minutes: 20 });
  });

  it('rooms and floors are managed as before', async () => {
    const manager = await db.as('authenticated', hotel.manager);
    expect((await manager.query('select public.admin_add_rooms($1, 201, 203, 2) as n', [hotel.id])).rows[0].n).toBe(3);
    await manager.query('select public.admin_save_table($1, $2::jsonb)', [hotel.id, room({ id: hotel.roomId, number: 1, floor: 0 })]);
    const { rows } = await su.query(`select number, floor from public.dining_tables where cafe_id = $1 and kind = 'room' order by number`, [hotel.id]);
    expect(rows).toEqual([{ number: 1, floor: 0 }, { number: 201, floor: 2 }, { number: 202, floor: 2 }, { number: 203, floor: 2 }]);
  });
});

describe('migration over existing establishments', () => {
  const name = `stocic_editions_${Date.now()}`;
  let other: pg.Client;

  afterAll(async () => {
    await other?.end().catch(() => {});
    await su.query(`drop database if exists ${name}`);
  });

  it('keeps rooms for establishments that use them and makes the rest cafés, without touching codes or orders', async () => {
    await su.query(`create database ${name}`);
    const url = new URL(inject('dbUrl'));
    url.pathname = `/${name}`;
    other = new pg.Client({ connectionString: url.toString() });
    await other.connect();

    const files = migrationFiles();
    const at = files.indexOf('20261021120000_editions.sql');
    expect(at).toBeGreaterThan(0);
    await applyStubs(other);
    await applyMigrations(other, files.slice(0, at)); // the schema as it was before editions

    // Before: one establishment with rooms, one with only past room orders, one with tables only.
    await other.query(`
      insert into public.cafes (id, slug, name) values
        ('00000000-0000-4000-8000-0000000000a1', 'a', 'Sa sobama'),
        ('00000000-0000-4000-8000-0000000000a2', 'b', 'Stare porudžbine iz soba'),
        ('00000000-0000-4000-8000-0000000000a3', 'c', 'Samo stolovi');
      insert into public.dining_tables (id, cafe_id, kind, number, qr_token, active) values
        ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'room', 101, 'room-a', true),
        ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a2', 'room', 7, 'room-b', false),
        ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a3', 'table', 1, 'table-c', true);
      insert into public.orders (number, cafe_id, table_id, table_number, table_kind, guest_id) values
        (1001, '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b2', 7, 'room', gen_random_uuid()),
        (1001, '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000b3', 1, 'table', gen_random_uuid());
    `);
    const before = (await other.query('select qr_token, active from public.dining_tables order by id')).rows;

    await applyMigrations(other, files.slice(at, at + 1));

    const { rows } = await other.query('select slug, edition from public.cafes order by slug');
    expect(rows).toEqual([{ slug: 'a', edition: 'hotel' }, { slug: 'b', edition: 'hotel' }, { slug: 'c', edition: 'cafe' }]);
    expect((await other.query('select qr_token, active from public.dining_tables order by id')).rows).toEqual(before);
    expect((await other.query('select count(*)::int as n from public.orders')).rows[0].n).toBe(2);
    expect((await other.query(`select public.guest_table('room-a') as m`)).rows[0].m.table.kind).toBe('room');
    expect((await other.query(`select public.guest_table('table-c') as m`)).rows[0].m.cafe.edition).toBe('cafe');
  });
});
