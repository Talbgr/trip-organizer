import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Trip } from '../shared/types.ts';
import { buildApp } from '../server/app.ts';
import pg from 'pg';
import { PgStatusStore, SqliteStatusStore, type StatusStore } from '../server/store.ts';

const trip = JSON.parse(readFileSync(resolve(__dirname, '../data/trip.json'), 'utf8')) as Trip;
const key = trip.reminders[0]!.key;

// The Postgres run needs a disposable database: TEST_DATABASE_URL=postgres://... npm test
const pgUrl = process.env.TEST_DATABASE_URL;
const backends: Array<[string, () => Promise<StatusStore>]> = [['sqlite', async () => new SqliteStatusStore(':memory:')]];
if (pgUrl)
  backends.push([
    'postgres',
    async () => {
      const c = new pg.Client({ connectionString: pgUrl });
      await c.connect();
      await c.query('DROP TABLE IF EXISTS status; DROP TABLE IF EXISTS status_log;');
      await c.end();
      return new PgStatusStore(pgUrl);
    },
  ]);

describe.each(backends)('api with %s store', (_name, open) => {
  let store: StatusStore;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    store = await open();
    app = buildApp({ trip, store });
  });
  afterEach(async () => {
    await app.close();
    await store.close();
  });

  it('serves the trip with an etag', async () => {
    const res = await app.inject('/api/trip');
    expect(res.statusCode).toBe(200);
    expect(res.json().cities).toHaveLength(4);
    const again = await app.inject({ url: '/api/trip', headers: { 'if-none-match': res.headers.etag as string } });
    expect(again.statusCode).toBe(304);
  });

  it('marks, reads back and undoes a reminder', async () => {
    const put = await app.inject({ method: 'PUT', url: `/api/status/${encodeURIComponent(key)}`, payload: { state: 'paid', by: 'עדי' } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ state: 'paid', by: 'עדי' });
    expect((await app.inject('/api/status')).json()[key]).toMatchObject({ state: 'paid' });

    const del = await app.inject({ method: 'DELETE', url: `/api/status/${encodeURIComponent(key)}?by=${encodeURIComponent('טל')}` });
    expect(del.statusCode).toBe(204);
    expect((await app.inject('/api/status')).json()).toEqual({});
  });

  it('rejects unknown reminders and bad input', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/status/nope', payload: { state: 'paid', by: 'טל' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/status/${encodeURIComponent(key)}`, payload: { state: 'maybe', by: 'טל' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/api/status/${encodeURIComponent(key)}`, payload: { state: 'paid', by: 'x' } })).statusCode).toBe(400);
  });

  it('reports health', async () => {
    const health = (await app.inject('/healthz')).json();
    expect(health).toMatchObject({ ok: true, store: { ok: true } });
  });
});

describe('store selection', () => {
  it('uses Postgres only when DATABASE_URL is set', async () => {
    const { openStore } = await import('../server/store.ts');
    const a = openStore({}, ':memory:');
    expect(a.kind).toBe('sqlite');
    await a.store.close();
    const b = openStore({ DATABASE_URL: 'postgres://user:pw@127.0.0.1:1/none' }, ':memory:');
    expect(b.kind).toBe('postgres');
    const ping = await b.store.ping(); // unreachable → reported, not thrown
    expect(ping.ok).toBe(false);
    expect(ping.error).toMatch(/ECONNREFUSED/);
    await b.store.close();
    const c = openStore({ DATABASE_URL: '${{Postgres.DATABASE_URL}}' }, ':memory:');
    expect(c.kind).toBe('sqlite');
    expect(c.warning).toMatch(/unresolved Railway reference/);
    await c.store.close();
  });
});
