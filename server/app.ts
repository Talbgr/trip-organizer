import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { HandledState, Person, Trip } from '../shared/types.ts';
import type { StatusStore } from './store.ts';

export interface AppOptions {
  trip: Trip;
  store: StatusStore;
  /** Shown on /healthz to make storage problems visible without reading logs. */
  storeInfo?: { kind: string; warning?: string };
  /** Built front-end directory; omitted in tests and in dev (Vite serves it). */
  webRoot?: string;
  logger?: boolean;
}

const STATES: readonly HandledState[] = ['booked', 'paid'];
const PEOPLE: readonly Person[] = ['טל', 'עדי'];

export function buildApp({ trip, store, storeInfo, webRoot, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: 4 * 1024 });
  const tripJson = JSON.stringify(trip);
  const tripEtag = `"${createHash('sha1').update(tripJson).digest('hex')}"`;
  const reminderKeys = new Set(trip.reminders.map((r) => r.key));

  // The server is healthy as long as it can serve the trip, so deploys are not blocked by
  // a database problem; the store's own state is reported alongside for diagnosis.
  app.get('/healthz', async () => {
    const s = await store.ping();
    return { ok: true, store: { ...storeInfo, ok: s.ok, ...(s.error ? { error: s.error } : {}) } };
  });

  app.get('/api/trip', async (req, reply) => {
    reply.header('etag', tripEtag).header('cache-control', 'no-cache').type('application/json');
    if (req.headers['if-none-match'] === tripEtag) return reply.code(304).send();
    return tripJson;
  });

  app.get('/api/status', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return store.all();
  });

  app.put<{ Params: { key: string }; Body: { state: HandledState; by: Person } }>(
    '/api/status/:key',
    {
      schema: {
        body: {
          type: 'object',
          required: ['state', 'by'],
          additionalProperties: false,
          properties: { state: { type: 'string', enum: [...STATES] }, by: { type: 'string', enum: [...PEOPLE] } },
        },
      },
    },
    async (req, reply) => {
      if (!reminderKeys.has(req.params.key)) return reply.code(404).send({ error: 'unknown reminder' });
      return store.set(req.params.key, req.body.state, req.body.by);
    },
  );

  app.delete<{ Params: { key: string }; Querystring: { by: Person } }>(
    '/api/status/:key',
    {
      schema: {
        querystring: { type: 'object', required: ['by'], properties: { by: { type: 'string', enum: [...PEOPLE] } } },
      },
    },
    async (req, reply) => {
      if (!reminderKeys.has(req.params.key)) return reply.code(404).send({ error: 'unknown reminder' });
      await store.clear(req.params.key, req.query.by);
      return reply.code(204).send();
    },
  );

  if (webRoot && existsSync(webRoot)) {
    app.register(fastifyStatic, {
      root: webRoot,
      setHeaders(res, path) {
        // Hashed assets can be cached forever; the shell and service worker must revalidate.
        if (/\/assets\//.test(path)) res.header('cache-control', 'public, max-age=31536000, immutable');
        else res.header('cache-control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
