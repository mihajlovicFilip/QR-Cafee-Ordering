// Serbian and English must cover the same texts, including every error the app can show.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import sr from './sr.json';
import en from './en.json';
import { translateIn } from '.';

type Tree = { [k: string]: string | string[] | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string | string[]> {
  const out = new Map<string, string | string[]>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' || Array.isArray(v)) out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

const SR = flatten(sr as Tree);
const EN = flatten(en as Tree);
const placeholders = (v: string | string[]) => [...new Set((Array.isArray(v) ? v.join(' ') : v).match(/\{\w+\}/g) ?? [])].sort();

const SRC = join(import.meta.dirname, '..');
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}
const SOURCE = sourceFiles().map((f) => readFileSync(f, 'utf8')).join('\n');

describe('translations', () => {
  it('Serbian and English have exactly the same keys', () => {
    expect([...SR.keys()].filter((k) => !EN.has(k))).toEqual([]);
    expect([...EN.keys()].filter((k) => !SR.has(k))).toEqual([]);
  });

  it('use the same placeholders and plural shape (Serbian 3 forms, English 2)', () => {
    for (const [key, s] of SR) {
      const e = EN.get(key)!;
      expect(placeholders(e), key).toEqual(placeholders(s));
      expect(Array.isArray(e), key).toBe(Array.isArray(s));
      if (Array.isArray(s) && Array.isArray(e)) {
        expect(s.length, key).toBe(3);
        expect(e.length, key).toBe(2);
      }
    }
  });

  it('cover every text key used in the code', () => {
    const used = new Set<string>();
    for (const m of SOURCE.matchAll(/\b(?:t|tp)\(\s*'([a-zA-Z]+\.[\w.]+)'/g)) used.add(m[1]);
    for (const m of SOURCE.matchAll(/translateIn\([^,]+,\s*(?:[^']*\?\s*)?'([a-zA-Z]+\.[\w.]+)'(?:\s*:\s*'([a-zA-Z]+\.[\w.]+)')?/g)) {
      used.add(m[1]);
      if (m[2]) used.add(m[2]);
    }
    expect(used.size).toBeGreaterThan(200);
    expect([...used].filter((k) => !SR.has(k))).toEqual([]);
  });

  it('cover every error code the backends can raise', () => {
    const codes = new Set<string>();
    for (const m of SOURCE.matchAll(/new ApiError\('(\w+)'/g)) codes.add(m[1]);
    const known = /const KNOWN_ERRORS = \[([\s\S]*?)\];/.exec(readFileSync(join(SRC, 'api/supabase.ts'), 'utf8'))![1];
    for (const m of known.matchAll(/'(\w+)'/g)) codes.add(m[1]);
    const sql = readdirSync(join(SRC, '../supabase/migrations')).map((f) => readFileSync(join(SRC, '../supabase/migrations', f), 'utf8')).join('\n');
    for (const m of sql.matchAll(/raise exception '(\w+)'/g)) codes.add(m[1]);
    const edge = readFileSync(join(SRC, '../supabase/functions/invite-staff/index.ts'), 'utf8');
    for (const m of edge.matchAll(/error: '(\w+)'/g)) codes.add(m[1]);

    expect(codes.size).toBeGreaterThan(30);
    expect([...codes].filter((c) => !SR.has(`errors.${c}`))).toEqual([]);
  });

  it('fill in values and pick Serbian plural forms correctly', () => {
    expect(translateIn('sr', 'common.table', { n: 7 })).toBe('Sto 7');
    expect(translateIn('en', 'common.room', { n: 214 })).toBe('Room 214');
    const forms = SR.get('admin.tables.summary') as string[];
    expect(forms).toEqual(['{n} sto', '{n} stola', '{n} stolova']);
  });
});
