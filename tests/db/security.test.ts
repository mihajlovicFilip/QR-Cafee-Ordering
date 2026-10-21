// Privileges and isolation as the database enforces them: grants per role, RLS, SECURITY DEFINER
// hygiene, cross-café access, the owner/manager rules and the Storage policies.
import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createCafe, newUser, testDb, type Cafe } from './db';

const db = testDb();
let su: pg.Client;
let a: Cafe;
let b: Cafe;

beforeAll(async () => {
  su = await db.superuser();
  a = await createCafe(su);
  b = await createCafe(su);
});

const TABLES = ['cafes', 'staff', 'dining_tables', 'categories', 'products', 'orders', 'order_items', 'waiter_calls'];

describe('grants', () => {
  it('browsers (anon, authenticated) cannot write, truncate or attach triggers to any table', async () => {
    const { rows } = await su.query(
      `select r.role, t.name, p.priv
         from unnest(array['anon', 'authenticated']) as r(role),
              unnest($1::text[]) as t(name),
              unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(priv)
        where has_table_privilege(r.role, 'public.' || t.name, p.priv)`,
      [TABLES],
    );
    expect(rows).toEqual([]);
  });

  it('anon can only run the two public functions', async () => {
    const { rows } = await su.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual(['guest_table', 'server_now']);
  });

  it('internal and service-role functions are not callable from the browser', async () => {
    const { rows } = await su.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
          and (p.proname like '\\_%' or p.proname like 'staff\\_%')`,
    );
    expect(rows).toEqual([]);
  });

  it('every SECURITY DEFINER function pins its search_path', async () => {
    const { rows } = await su.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });
});

describe('direct table access from the browser', () => {
  it('a guest cannot create, change or delete orders without the functions', async () => {
    const guest = await db.as('authenticated', await newUser(su, true));
    await expect(guest.query(`insert into public.orders (number, cafe_id, table_id, table_number, guest_id) values (1, $1, $2, 1, auth.uid())`, [a.id, a.tableId])).rejects.toThrow(/permission denied/);
    await expect(guest.query(`update public.orders set status = 'served'`)).rejects.toThrow(/permission denied/);
    await expect(guest.query('delete from public.orders')).rejects.toThrow(/permission denied/);
    await expect(guest.query('update public.products set price = 1')).rejects.toThrow(/permission denied/);
  });

  it('a guest reads nothing but their own orders', async () => {
    const guest = await db.as('authenticated', await newUser(su, true));
    for (const t of TABLES) {
      expect((await guest.query(`select 1 from public.${t}`)).rowCount, t).toBe(0);
    }
  });

  it('staff read only their own café', async () => {
    const waiter = await db.as('authenticated', a.waiter);
    const queries: Record<string, string> = {
      cafes: 'select distinct id as cafe_id from public.cafes',
      dining_tables: 'select distinct cafe_id from public.dining_tables',
      categories: 'select distinct cafe_id from public.categories',
      products: 'select distinct cafe_id from public.products',
      staff: 'select distinct cafe_id from public.staff',
    };
    for (const [table, sql] of Object.entries(queries)) {
      const { rows } = await waiter.query(sql);
      expect(rows.map((r) => r.cafe_id), table).toEqual([a.id]);
    }
  });
});

describe('administration', () => {
  const saveProduct = (client: pg.Client, cafeId: string) =>
    client.query('select public.admin_save_product($1, $2::jsonb)', [cafeId, JSON.stringify({ name: { sr: 'Novo' }, price: 100, categoryId: null, available: true, options: [] })]);

  it('anon cannot even call the admin functions', async () => {
    await expect(saveProduct(await db.as('anon'), a.id)).rejects.toThrow(/permission denied/);
  });

  it('guests and waiters are refused', async () => {
    await expect(saveProduct(await db.as('authenticated', await newUser(su, true)), a.id)).rejects.toThrow(/^forbidden$/);
    await expect(saveProduct(await db.as('authenticated', a.waiter), a.id)).rejects.toThrow(/^forbidden$/);
  });

  it('a manager manages their own café, not another one', async () => {
    const manager = await db.as('authenticated', a.manager);
    await saveProduct(manager, a.id);
    await expect(saveProduct(manager, b.id)).rejects.toThrow(/^forbidden$/);
    await expect(manager.query('select public.admin_staff($1)', [b.id])).rejects.toThrow(/^forbidden$/);
    await expect(manager.query('select public.admin_delete_table($1)', [b.tableId])).rejects.toThrow(/^forbidden$/);
    await expect(manager.query('select public.admin_set_product_available($1, false)', [b.cakeId])).rejects.toThrow(/^forbidden$/);
    await expect(manager.query(`select public.admin_update_cafe($1, '{"name":"X","accent":"#000000","defaultLang":"sr"}'::jsonb)`, [b.id])).rejects.toThrow(/^forbidden$/);
  });

  it('only an owner touches owners, and nobody changes their own role', async () => {
    const staffId = async (user: string) => (await su.query('select id from public.staff where user_id = $1', [user])).rows[0].id;
    const manager = await db.as('authenticated', a.manager);
    const owner = await db.as('authenticated', a.owner);
    await expect(manager.query(`select public.admin_update_staff($1, 'waiter', true)`, [await staffId(a.owner)])).rejects.toThrow(/^owner_required$/);
    await expect(manager.query(`select public.admin_update_staff($1, 'owner', true)`, [await staffId(a.waiter)])).rejects.toThrow(/^owner_required$/);
    await expect(manager.query(`select public.admin_update_staff($1, 'waiter', false)`, [await staffId(a.manager)])).rejects.toThrow(/^cannot_change_self$/);
    await manager.query(`select public.admin_update_staff($1, 'barista', true)`, [await staffId(a.waiter)]);
    await owner.query(`select public.admin_update_staff($1, 'waiter', true)`, [await staffId(a.waiter)]);
  });

  it('the staff list (with emails) is for managers only', async () => {
    await expect((await db.as('authenticated', a.waiter)).query('select public.admin_staff($1)', [a.id])).rejects.toThrow(/^forbidden$/);
    const { rows } = await (await db.as('authenticated', a.owner)).query('select public.admin_staff($1) as s', [a.id]);
    expect(rows[0].s).toHaveLength(4);
    expect(rows[0].s[0].email).toMatch(/@test\.local$/);
  });

  it('the invite functions run for the service role only, and still check the inviter', async () => {
    const guest = await db.as('authenticated', a.manager);
    await expect(guest.query(`select public.staff_invite_check($1, $2, 'waiter')`, [a.manager, a.id])).rejects.toThrow(/permission denied/);
    await expect(guest.query(`select public.staff_user_id_by_email('x@test.local')`)).rejects.toThrow(/permission denied/);
    const service = await db.as('service_role');
    await expect(service.query(`select public.staff_invite_check($1, $2, 'waiter')`, [a.waiter, a.id])).rejects.toThrow(/^forbidden$/);
    await expect(service.query(`select public.staff_invite_check($1, $2, 'owner')`, [a.manager, a.id])).rejects.toThrow(/^owner_required$/);
    const newcomer = await newUser(su);
    await service.query(`select public.staff_link_user($1, $2, $3, 'Nova', 'waiter')`, [a.manager, a.id, newcomer]);
    await expect(service.query(`select public.staff_link_user($1, $2, $3, 'Nova', 'waiter')`, [a.manager, a.id, newcomer])).rejects.toThrow(/^already_staff$/);
  });
});

describe('product photos (Storage)', () => {
  const upload = (client: pg.Client, path: string) =>
    client.query(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [path]);

  it('a manager uploads into their own café folder only', async () => {
    const manager = await db.as('authenticated', a.manager);
    await upload(manager, `${a.id}/photo.webp`);
    await expect(upload(manager, `${b.id}/photo.webp`)).rejects.toThrow(/row-level security/);
    await expect(upload(manager, `not-a-uuid/photo.webp`)).rejects.toThrow(/row-level security/);
  });

  it('guests and waiters cannot upload', async () => {
    await expect(upload(await db.as('authenticated', await newUser(su, true)), `${a.id}/x.webp`)).rejects.toThrow(/row-level security/);
    await expect(upload(await db.as('authenticated', a.waiter), `${a.id}/x.webp`)).rejects.toThrow(/row-level security/);
  });
});
