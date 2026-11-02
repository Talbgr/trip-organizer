import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Trip } from '../shared/types.ts';
import { buildApp } from './app.ts';
import { StatusStore } from './store.ts';

// Run directly with Node's built-in TypeScript support: `node server/main.ts`.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const port = Number(process.env.PORT ?? 3000);
const dbPath = resolve(process.env.DB_PATH ?? resolve(root, 'data/state.db'));
const tripPath = resolve(process.env.TRIP_PATH ?? resolve(root, 'data/trip.json'));
const webRoot = resolve(root, 'dist/web');

mkdirSync(dirname(dbPath), { recursive: true });
const trip = JSON.parse(readFileSync(tripPath, 'utf8')) as Trip;
const store = new StatusStore(dbPath);
const app = buildApp({ trip, store, webRoot, logger: true });

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port, host: '0.0.0.0' });
app.log.info({ dbPath, tripPath }, 'trip organizer ready');
