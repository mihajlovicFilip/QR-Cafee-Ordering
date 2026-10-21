/**
 * Building a test database — the Supabase stand-ins, the migrations in order, and the seed.
 *
 * Shared by the global setup (one database for every test file) and by tests that need a
 * database of their own, such as replaying a migration over data that existed before it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';

export const ROOT = join(import.meta.dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

/** Migration file names in the order Supabase applies them (by their timestamp prefix). */
export const migrationFiles = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

export async function applyStubs(client: pg.Client) {
  await client.query(readFileSync(join(ROOT, 'tests/db/supabase-stubs.sql'), 'utf8'));
}

/** Runs the given migrations; a failure names the file, keeping the database error as the cause. */
export async function applyMigrations(client: pg.Client, files = migrationFiles()) {
  for (const file of files) {
    try {
      await client.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`, { cause: e });
    }
  }
}

export async function applySeed(client: pg.Client) {
  await client.query(readFileSync(join(ROOT, 'supabase/seed.sql'), 'utf8'));
}
