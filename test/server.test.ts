import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Trip } from '../shared/types.ts';
import { buildApp } from '../server/app.ts';
import pg from 'pg';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { placesOf } from '../shared/places.ts';
import { TripStore } from '../server/store.ts';

const trip = JSON.parse(readFileSync(resolve(__dirname, '../data/trip.json'), 'utf8')) as Trip;
const key = trip.reminders[0]!.key;

// The Postgres run needs a disposable database: TEST_DATABASE_URL=postgres://... npm test
const pgUrl = process.env.TEST_DATABASE_URL;
const backends: Array<[string, () => Promise<TripStore>]> = [['sqlite', async () => TripStore.sqlite(':memory:')]];
if (pgUrl)
  backends.push([
    'postgres',
    async () => {
      const c = new pg.Client({ connectionString: pgUrl });
      await c.connect();
      await c.query('DROP TABLE IF EXISTS status, status_log, schedule, hotels, change_log;');
      await c.end();
      return TripStore.postgres(pgUrl);
    },
  ]);

describe.each(backends)('api with %s store', (_name, open) => {
  let store: TripStore;
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

  const day = trip.itinerary.days[8]!.date!;
  const json = (method: 'POST' | 'PUT', url: string, payload: object) => app.inject({ method, url, payload });
  const del = (url: string, who = 'טל') => app.inject({ method: 'DELETE', url: `${url}?by=${encodeURIComponent(who)}` });

  it('adds, edits and deletes schedule entries', async () => {
    const add = await json('POST', '/api/schedule', { date: day, time: '19:30', text: '  ארוחת ערב  ', by: 'עדי' });
    expect(add.statusCode).toBe(201);
    const entry = add.json();
    expect(entry).toMatchObject({ date: day, time: '19:30', text: 'ארוחת ערב', createdBy: 'עדי', updatedBy: 'עדי' });

    const edit = await json('PUT', `/api/schedule/${entry.id}`, { date: day, time: null, text: 'ארוחת ערב מאוחרת', by: 'טל' });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toMatchObject({ time: null, text: 'ארוחת ערב מאוחרת', createdBy: 'עדי', updatedBy: 'טל' });

    expect((await app.inject('/api/state')).json().schedule).toEqual([edit.json()]);
    expect((await del(`/api/schedule/${entry.id}`)).statusCode).toBe(204);
    expect((await del(`/api/schedule/${entry.id}`)).statusCode).toBe(404);
    expect((await app.inject('/api/state')).json().schedule).toEqual([]);
  });

  it('rejects schedule entries outside the itinerary or without text', async () => {
    expect((await json('POST', '/api/schedule', { date: '2030-01-01', time: null, text: 'x', by: 'טל' })).statusCode).toBe(400);
    expect((await json('POST', '/api/schedule', { date: day, time: '7pm', text: 'x', by: 'טל' })).statusCode).toBe(400);
    expect((await json('POST', '/api/schedule', { date: day, time: null, text: ' ', by: 'טל' })).statusCode).toBe(400);
    expect((await json('POST', '/api/schedule', { date: day, time: null, text: 'x', by: 'someone' })).statusCode).toBe(400);
    expect((await json('PUT', '/api/schedule/missing', { date: day, time: null, text: 'x', by: 'טל' })).statusCode).toBe(404);
  });

  it('adds, edits and deletes hotels', async () => {
    const kyoto = placesOf(trip.itinerary).find((p) => p.cityId === 'kyoto')!;
    const add = await json('POST', '/api/hotels', { place: kyoto.id, name: 'Hotel X', stay: { kind: 'full' }, note: '', paid: false, by: 'טל' });
    expect(add.statusCode).toBe(201);
    const hotel = add.json();
    expect(hotel).toMatchObject({ place: kyoto.id, name: 'Hotel X', stay: { kind: 'full' }, paid: false });

    const nights = { kind: 'nights', checkIn: kyoto.dates[1], nights: 2 };
    const edit = await json('PUT', `/api/hotels/${hotel.id}`, { place: kyoto.id, name: 'Hotel X', stay: nights, note: 'https://example.com', paid: true, by: 'עדי' });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toMatchObject({ stay: nights, paid: true, note: 'https://example.com', updatedBy: 'עדי' });
    expect((await app.inject('/api/state')).json().hotels).toEqual([edit.json()]);

    expect((await del(`/api/hotels/${hotel.id}`, 'עדי')).statusCode).toBe(204);
    expect((await app.inject('/api/state')).json().hotels).toEqual([]);
  });

  it('rejects hotels with nights outside the stay', async () => {
    const kyoto = placesOf(trip.itinerary).find((p) => p.cityId === 'kyoto')!;
    const base = { place: kyoto.id, name: 'H', note: '', paid: false, by: 'טל' };
    expect((await json('POST', '/api/hotels', { ...base, stay: { kind: 'nights', checkIn: kyoto.dates[0], nights: 99 } })).statusCode).toBe(400);
    expect((await json('POST', '/api/hotels', { ...base, stay: { kind: 'nights', checkIn: '2030-01-01', nights: 1 } })).statusCode).toBe(400);
    expect((await json('POST', '/api/hotels', { ...base, place: 'nowhere' , stay: { kind: 'full' } })).statusCode).toBe(400);
    expect((await json('POST', '/api/hotels', { ...base, stay: { kind: 'sometimes' } })).statusCode).toBe(400);
    expect((await json('POST', '/api/hotels', { ...base, stay: { kind: 'nights', nights: 1 } })).statusCode).toBe(400);
    // Extra fields on a whole-stay hotel are dropped, not stored.
    const full = await json('POST', '/api/hotels', { ...base, stay: { kind: 'full', nights: 3 } });
    expect(full.json().stay).toEqual({ kind: 'full' });
  });
});

describe('upgrading an existing database', () => {
  it('keeps Booked/Paid marks saved by the previous version', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'trip-')), 'state.db');
    const old = new Database(path);
    old.exec(`CREATE TABLE status (key TEXT PRIMARY KEY, state TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL);
              CREATE TABLE status_log (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, state TEXT, by TEXT NOT NULL, at TEXT NOT NULL);
              INSERT INTO status VALUES ('maguro mart', 'paid', 'עדי', '2026-11-02T10:00:00.000Z');`);
    old.close();
    const store = TripStore.sqlite(path);
    expect(await store.state()).toEqual({
      status: { 'maguro mart': { state: 'paid', by: 'עדי', at: '2026-11-02T10:00:00.000Z' } },
      schedule: [],
      hotels: [],
    });
    await store.close();
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
