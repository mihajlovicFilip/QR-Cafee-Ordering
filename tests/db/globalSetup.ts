// Starts a throwaway PostgreSQL 17 server for the database tests, applies the Supabase stand-ins,
// every migration in order and the seed, and hands the connection URL to the tests.
//
// To use an existing server instead, set TEST_DATABASE_URL to an EMPTY database you can throw away:
// the setup creates roles and schemas in it.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';

const ROOT = join(import.meta.dirname, '..', '..');

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

export async function applySchema(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(readFileSync(join(ROOT, 'tests/db/supabase-stubs.sql'), 'utf8'));
    const dir = join(ROOT, 'supabase/migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
      } catch (e) {
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`, { cause: e });
      }
    }
    await client.query(readFileSync(join(ROOT, 'supabase/seed.sql'), 'utf8'));
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject) {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    await applySchema(external);
    project.provide('dbUrl', external);
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'stocic-pg-'));
  const port = await freePort();
  const server = new EmbeddedPostgres({ databaseDir: dir, port, user: 'postgres', password: 'postgres', persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  await server.createDatabase('stocic_test');
  const url = `postgres://postgres:postgres@localhost:${port}/stocic_test`;
  await applySchema(url);
  project.provide('dbUrl', url);

  return async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
