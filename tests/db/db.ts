/**
 * Database test helpers — connections that act as a user, and ready-made establishments.
 *
 * `as(role, uid)` behaves like an API request from that user (the SQL role plus auth.uid());
 * `superuser()` is like the Supabase SQL editor, where RLS does not apply.
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, inject } from 'vitest';

type Role = 'anon' | 'authenticated' | 'service_role';

/**
 * Connections for one test file, closed automatically after it.
 * `as(role, uid)` behaves like an API request from that user: the SQL role plus auth.uid().
 */
export function testDb() {
  const open: pg.Client[] = [];
  afterAll(async () => {
    await Promise.all(open.map((c) => c.end().catch(() => {})));
  });

  async function connect() {
    const c = new pg.Client({ connectionString: inject('dbUrl') });
    await c.connect();
    open.push(c);
    return c;
  }

  return {
    /** Like the Supabase SQL editor: superuser, RLS does not apply. */
    superuser: connect,
    async as(role: Role, uid?: string) {
      const c = await connect();
      await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
      await c.query(`set role ${role}`);
      return c;
    },
  };
}

export interface Cafe {
  id: string;
  tableId: string;
  tableToken: string;
  roomId: string;
  roomToken: string;
  /** 250 RSD, option group "milk": cow (default, 0) / oat (+60). */
  latteId: string;
  /** 400 RSD, no options. */
  cakeId: string;
  /** Marked unavailable. */
  soldOutId: string;
  owner: string;
  manager: string;
  waiter: string;
  waiter2: string;
}

const MILK = [{ id: 'milk', name: { sr: 'Mleko', en: 'Milk' }, choices: [
  { id: 'cow', name: { sr: 'Kravlje', en: 'Dairy' }, price: 0, quiet: true },
  { id: 'oat', name: { sr: 'Ovseno', en: 'Oat' }, price: 60 },
] }];

export async function newUser(su: pg.Client, anonymous = false): Promise<string> {
  const id = randomUUID();
  await su.query('insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)', [id, anonymous ? null : `${id}@test.local`, anonymous]);
  return id;
}

/** Creates users one after another (one connection runs one query at a time). */
export async function newUsers(su: pg.Client, n: number, anonymous = true): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await newUser(su, anonymous));
  return ids;
}

/**
 * An establishment with table 1, room 1 (same number on purpose), three products and four staff
 * members. Stočić Hotel by default, since it has a room; a Stočić Café keeps the room row too,
 * which is exactly what the edition rules must neutralise.
 */
export async function createCafe(su: pg.Client, opts: { allowRepeat?: boolean; edition?: 'cafe' | 'hotel' } = {}): Promise<Cafe> {
  const id = randomUUID();
  await su.query(`insert into public.cafes (id, slug, name, allow_repeat, edition) values ($1, $2, 'Test kafić', $3, $4)`, [id, `test-${id.slice(0, 8)}`, opts.allowRepeat ?? true, opts.edition ?? 'hotel']);

  const tableToken = `t-${randomUUID()}`;
  const roomToken = `r-${randomUUID()}`;
  const { rows: [table] } = await su.query(`insert into public.dining_tables (cafe_id, kind, number, qr_token) values ($1, 'table', 1, $2) returning id`, [id, tableToken]);
  const { rows: [room] } = await su.query(`insert into public.dining_tables (cafe_id, kind, number, zone, floor, qr_token) values ($1, 'room', 1, 'room', 0, $2) returning id`, [id, roomToken]);

  const { rows: [cat] } = await su.query(`insert into public.categories (cafe_id, name) values ($1, '{"sr":"Kafa","en":"Coffee"}') returning id`, [id]);
  const product = async (name: string, price: number, options: unknown[] = [], available = true) => {
    const { rows: [p] } = await su.query(
      `insert into public.products (cafe_id, category_id, name, price, options, available) values ($1, $2, $3, $4, $5, $6) returning id`,
      [id, cat.id, JSON.stringify({ sr: name, en: name }), price, JSON.stringify(options), available],
    );
    return p.id as string;
  };

  const staff = async (role: string) => {
    const user = await newUser(su);
    await su.query(`insert into public.staff (user_id, cafe_id, display_name, role) values ($1, $2, $3, $4)`, [user, id, `${role} ${user.slice(0, 4)}`, role]);
    return user;
  };

  return {
    id,
    tableId: table.id,
    tableToken,
    roomId: room.id,
    roomToken,
    latteId: await product('Latte', 250, MILK),
    cakeId: await product('Torta', 400),
    soldOutId: await product('Sufle', 450, [], false),
    owner: await staff('owner'),
    manager: await staff('manager'),
    waiter: await staff('waiter'),
    waiter2: await staff('barista'),
  };
}

export const line = (productId: string, qty = 1, choices: Record<string, string> = {}, note = '') => ({ productId, qty, choices, note });

/** place_order as `client`; returns the new order id. */
export async function placeOrder(client: pg.Client, token: string, items: unknown[], note = ''): Promise<string> {
  const { rows } = await client.query('select public.place_order($1, $2::jsonb, $3) as id', [token, JSON.stringify(items), note]);
  return rows[0].id;
}

/** Lets an in-flight query reach the point where it waits on a lock. */
export const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));
