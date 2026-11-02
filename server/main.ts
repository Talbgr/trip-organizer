import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Trip } from '../shared/types.ts';
import { buildApp } from './app.ts';
import { openStore } from './store.ts';

// Run directly with Node's built-in TypeScript support: `node server/main.ts`.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const port = Number(process.env.PORT ?? 3000);
const dbPath = resolve(process.env.DB_PATH ?? resolve(root, 'data/state.db'));
const tripPath = resolve(process.env.TRIP_PATH ?? resolve(root, 'data/trip.json'));
const webRoot = resolve(root, 'dist/web');

const trip = JSON.parse(readFileSync(tripPath, 'utf8')) as Trip;
const { store, kind, warning } = openStore(process.env, dbPath);
const app = buildApp({ trip, store, storeInfo: { kind, warning }, webRoot, logger: true });
if (warning) app.log.warn(warning + ' — using the SQLite file instead');

const shutdown = async () => {
  await app.close();
  await store.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port, host: '0.0.0.0' });
const health = await store.ping();
if (!health.ok) app.log.error({ store: kind, error: health.error }, 'status store is not reachable (will retry on each request)');
app.log.info({ store: kind, ...(kind === 'sqlite' ? { dbPath } : {}), tripPath }, 'trip organizer ready');
