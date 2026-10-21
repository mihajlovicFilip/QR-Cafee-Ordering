/** Menu and café settings functions — validation and clean-up of what the admin panel sends. */

import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createCafe, testDb, type Cafe } from './db';

const db = testDb();
let su: pg.Client;
let cafe: Cafe;
let manager: pg.Client;

beforeAll(async () => {
  su = await db.superuser();
  cafe = await createCafe(su);
  manager = await db.as('authenticated', cafe.manager);
});

const saveProduct = (p: Record<string, unknown>) =>
  manager.query('select public.admin_save_product($1, $2::jsonb) as id', [cafe.id, JSON.stringify({ categoryId: null, available: true, options: [], price: 100, name: { sr: 'Test' }, ...p })]);

describe('products', () => {
  it('cleans names and options before saving', async () => {
    const { rows: [{ id }] } = await saveProduct({
      name: { sr: '  Limunada ', en: '', xx_bad: 'no', de: 5 },
      options: [{ id: 'size', name: { sr: 'Veličina' }, extra: 1, choices: [{ id: 's', name: { sr: 'Mala' }, price: 0, hack: true }, { id: 'l', name: { sr: 'Velika' }, price: 40.4 }] }],
    });
    const { rows: [p] } = await su.query('select name, options from public.products where id = $1', [id]);
    expect(p.name).toEqual({ sr: 'Limunada' });
    expect(p.options).toEqual([{ id: 'size', name: { sr: 'Veličina' }, choices: [
      { id: 's', name: { sr: 'Mala' }, price: 0, quiet: false },
      { id: 'l', name: { sr: 'Velika' }, price: 40, quiet: false },
    ] }]);
  });

  it.each([
    ['a Serbian name', { name: { en: 'Only English' } }, 'name_required'],
    ['a numeric price', { price: '100' }, 'invalid_price'],
    ['a price in range', { price: 1_000_001 }, 'invalid_price'],
    ['a category of this café', { categoryId: '00000000-0000-4000-8000-000000000011' }, 'invalid_input'],
    ['a web address for the photo', { imageUrl: 'javascript:alert(1)' }, 'invalid_input'],
    ['unique option ids', { options: [{ id: 'a', name: { sr: 'A' }, choices: [{ id: 'x', name: { sr: 'X' } }] }, { id: 'a', name: { sr: 'B' }, choices: [{ id: 'y', name: { sr: 'Y' } }] }] }, 'invalid_input'],
    ['non-negative surcharges', { options: [{ id: 'a', name: { sr: 'A' }, choices: [{ id: 'x', name: { sr: 'X' }, price: -5 }] }] }, 'invalid_price'],
  ])('requires %s', async (_what, patch, code) => {
    await expect(saveProduct(patch)).rejects.toThrow(new RegExp(`^${code}$`));
  });
});

describe('categories', () => {
  it('cannot delete a category that still has products', async () => {
    const { rows: [{ category_id }] } = await su.query('select category_id from public.products where id = $1', [cafe.cakeId]);
    await expect(manager.query('select public.admin_delete_category($1)', [category_id])).rejects.toThrow(/^category_not_empty$/);
  });
});

describe('café settings', () => {
  it('saves valid settings and refuses a bad colour', async () => {
    await manager.query(`select public.admin_update_cafe($1, $2::jsonb)`, [cafe.id, JSON.stringify({
      name: 'Hotel Lipa', accent: '#2F5D50', defaultLang: 'en', allowRepeat: false, callButton: false,
      phone: ' 011 ', email: '', address: 'Ulica 1', openingHours: { weekdays: '07:00–23:00', evil: 'x' },
    })]);
    const { rows: [c] } = await su.query('select name, accent, default_lang, allow_repeat, call_button, phone, email, opening_hours from public.cafes where id = $1', [cafe.id]);
    expect(c).toEqual({ name: 'Hotel Lipa', accent: '#2f5d50', default_lang: 'en', allow_repeat: false, call_button: false, phone: '011', email: null, opening_hours: { weekdays: '07:00–23:00' } });
    await expect(manager.query(`select public.admin_update_cafe($1, '{"name":"X","accent":"red","defaultLang":"sr"}'::jsonb)`, [cafe.id])).rejects.toThrow(/^invalid_color$/);
  });
});
