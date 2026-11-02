import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Trip } from '../shared/types.ts';
import { buildApp } from '../server/app.ts';
import { StatusStore } from '../server/store.ts';

const trip = JSON.parse(readFileSync(resolve(__dirname, '../data/trip.json'), 'utf8')) as Trip;
const key = trip.reminders[0]!.key;

let store: StatusStore;
let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  store = new StatusStore(':memory:');
  app = buildApp({ trip, store });
});
afterEach(async () => {
  await app.close();
  store.close();
});

describe('api', () => {
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
    expect((await app.inject('/healthz')).json()).toEqual({ ok: true });
  });
});
