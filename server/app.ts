import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { checkChildren, checkDayText, checkHotel, checkSchedule, isValidCheckKey, placesOf, type HotelInput, type ScheduleInput } from '../shared/places.ts';
import type { CheckState, HandledState, Person, Trip } from '../shared/types.ts';
import type { TripStore } from './store.ts';

export interface AppOptions {
  trip: Trip;
  store: TripStore;
  /** Shown on /healthz to make storage problems visible without reading logs. */
  storeInfo?: { kind: string; warning?: string };
  /** Built front-end directory; omitted in tests and in dev (Vite serves it). */
  webRoot?: string;
  logger?: boolean;
}

const STATES: readonly HandledState[] = ['booked', 'paid'];
const PEOPLE: readonly Person[] = ['טל', 'עדי'];

const by = { type: 'string', enum: [...PEOPLE] } as const;
const byQuery = { type: 'object', required: ['by'], properties: { by } } as const;
const idParam = { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } } as const;

const scheduleBody = {
  type: 'object',
  required: ['date', 'time', 'text', 'by'],
  additionalProperties: false,
  properties: {
    date: { type: 'string', maxLength: 10 },
    time: { type: ['string', 'null'], maxLength: 5 },
    text: { type: 'string', maxLength: 2000 },
    by,
  },
} as const;

const hotelBody = {
  type: 'object',
  required: ['place', 'name', 'stay', 'note', 'paid', 'by'],
  additionalProperties: false,
  properties: {
    place: { type: 'string', maxLength: 200 },
    name: { type: 'string', maxLength: 1000 },
    // Flat on purpose: Fastify's validator strips unknown keys per oneOf branch, which breaks
    // oneOf + additionalProperties. The kind-specific rules live in checkHotel().
    stay: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { type: 'string', enum: ['full', 'nights'] },
        checkIn: { type: 'string', maxLength: 10 },
        nights: { type: 'integer', minimum: 1, maximum: 60 },
      },
    },
    note: { type: 'string', maxLength: 4000 },
    paid: { type: 'boolean' },
    by,
  },
} as const;

export function buildApp({ trip, store, storeInfo, webRoot, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: 32 * 1024 });
  const tripJson = JSON.stringify(trip);
  const tripEtag = `"${createHash('sha1').update(tripJson).digest('hex')}"`;
  const reminderKeys = new Set(trip.reminders.map((r) => r.key));
  const places = placesOf(trip.itinerary);
  const noStore = { 'cache-control': 'no-store' };

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

  /** Everything both of us changed: marks, added schedule entries, added hotels. */
  app.get('/api/state', async (_req, reply) => {
    reply.headers(noStore);
    return store.state();
  });

  // ---- Booked / Paid marks -----------------------------------------------------------

  app.get('/api/status', async (_req, reply) => {
    reply.headers(noStore);
    return store.statusAll();
  });

  app.put<{ Params: { key: string }; Body: { state: HandledState; by: Person } }>(
    '/api/status/:key',
    {
      schema: {
        body: {
          type: 'object',
          required: ['state', 'by'],
          additionalProperties: false,
          properties: { state: { type: 'string', enum: [...STATES] }, by },
        },
      },
    },
    async (req, reply) => {
      if (!reminderKeys.has(req.params.key)) return reply.code(404).send({ error: 'unknown reminder' });
      return store.setStatus(req.params.key, req.body.state, req.body.by);
    },
  );

  app.delete<{ Params: { key: string }; Querystring: { by: Person } }>(
    '/api/status/:key',
    { schema: { querystring: byQuery } },
    async (req, reply) => {
      if (!reminderKeys.has(req.params.key)) return reply.code(404).send({ error: 'unknown reminder' });
      await store.clearStatus(req.params.key, req.query.by);
      return reply.code(204).send();
    },
  );

  // ---- Schedule entries --------------------------------------------------------------

  type ScheduleBody = ScheduleInput & { by: Person };

  app.post<{ Body: ScheduleBody }>('/api/schedule', { schema: { body: scheduleBody } }, async (req, reply) => {
    const error = checkSchedule(req.body, trip.itinerary);
    if (error) return reply.code(400).send({ error });
    return reply.code(201).send(await store.addSchedule(req.body, req.body.by));
  });

  app.put<{ Params: { id: string }; Body: ScheduleBody }>(
    '/api/schedule/:id',
    { schema: { params: idParam, body: scheduleBody } },
    async (req, reply) => {
      const error = checkSchedule(req.body, trip.itinerary);
      if (error) return reply.code(400).send({ error });
      const entry = await store.updateSchedule(req.params.id, req.body, req.body.by);
      return entry ?? reply.code(404).send({ error: 'not found' });
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { by: Person } }>(
    '/api/schedule/:id',
    { schema: { params: idParam, querystring: byQuery } },
    async (req, reply) => {
      const found = await store.deleteSchedule(req.params.id, req.query.by);
      return found ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
    },
  );

  // ---- Hotels ----------------------------------------------------------------------------

  type HotelBody = HotelInput & { by: Person };
  /** Keeps only the fields that belong to the chosen kind of stay. */
  const hotelInput = (b: HotelBody): HotelInput => ({
    place: b.place,
    name: b.name,
    note: b.note,
    paid: b.paid,
    stay: b.stay.kind === 'full' ? { kind: 'full' } : { kind: 'nights', checkIn: b.stay.checkIn, nights: b.stay.nights },
  });

  app.post<{ Body: HotelBody }>('/api/hotels', { schema: { body: hotelBody } }, async (req, reply) => {
    const input = hotelInput(req.body);
    const error = checkHotel(input, places);
    if (error) return reply.code(400).send({ error });
    return reply.code(201).send(await store.addHotel(input, req.body.by));
  });

  app.put<{ Params: { id: string }; Body: HotelBody }>(
    '/api/hotels/:id',
    { schema: { params: idParam, body: hotelBody } },
    async (req, reply) => {
      const input = hotelInput(req.body);
      const error = checkHotel(input, places);
      if (error) return reply.code(400).send({ error });
      const entry = await store.updateHotel(req.params.id, input, req.body.by);
      return entry ?? reply.code(404).send({ error: 'not found' });
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { by: Person } }>(
    '/api/hotels/:id',
    { schema: { params: idParam, querystring: byQuery } },
    async (req, reply) => {
      const found = await store.deleteHotel(req.params.id, req.query.by);
      return found ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
    },
  );

  // ---- Edits to the workbook's day text ------------------------------------------------

  const dateParam = { type: 'object', required: ['date'], properties: { date: { type: 'string', maxLength: 10 } } } as const;

  app.put<{ Params: { date: string }; Body: { text: string | null; by: Person } }>(
    '/api/days/:date',
    {
      schema: {
        params: dateParam,
        body: {
          type: 'object',
          required: ['text', 'by'],
          additionalProperties: false,
          properties: { text: { type: ['string', 'null'], maxLength: 6000 }, by },
        },
      },
    },
    async (req, reply) => {
      const error = checkDayText(req.params.date, req.body.text, trip.itinerary);
      if (error) return reply.code(400).send({ error });
      return store.setDayOverride(req.params.date, req.body.text, req.body.by);
    },
  );

  app.delete<{ Params: { date: string }; Querystring: { by: Person } }>(
    '/api/days/:date',
    { schema: { params: dateParam, querystring: byQuery } },
    async (req, reply) => {
      const found = await store.clearDayOverride(req.params.date, req.query.by);
      return found ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
    },
  );

  // ---- Done / missed marks ---------------------------------------------------------------

  const keyParam = { type: 'object', required: ['key'], properties: { key: { type: 'string', maxLength: 120 } } } as const;
  /** Boxes inside a whole-area / whole-day box (looked up only for those keys). */
  const childrenOf = async (key: string) =>
    key.startsWith('area:') || key.startsWith('wholeday:')
      ? checkChildren(key, trip, await store.listSchedule(), await store.listDayOverrides())
      : [];

  app.put<{ Params: { key: string }; Body: { state: CheckState; by: Person } }>(
    '/api/checks/:key',
    {
      schema: {
        params: keyParam,
        body: {
          type: 'object',
          required: ['state', 'by'],
          additionalProperties: false,
          properties: { state: { type: 'string', enum: ['done', 'missed'] }, by },
        },
      },
    },
    async (req, reply) => {
      if (!isValidCheckKey(req.params.key, trip)) return reply.code(404).send({ error: 'unknown item' });
      return { checks: await store.markCheck(req.params.key, req.body.state, req.body.by, await childrenOf(req.params.key)) };
    },
  );

  app.delete<{ Params: { key: string }; Querystring: { by: Person } }>(
    '/api/checks/:key',
    { schema: { params: keyParam, querystring: byQuery } },
    async (req, reply) => {
      if (!isValidCheckKey(req.params.key, trip)) return reply.code(404).send({ error: 'unknown item' });
      return { checks: await store.markCheck(req.params.key, null, req.query.by, await childrenOf(req.params.key)) };
    },
  );

  // ---- Front end -------------------------------------------------------------------------

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
