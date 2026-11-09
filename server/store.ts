// Everything the two of us change in the app, stored on the server so both phones see it:
//  - Booked/Paid marks for the workbook's red items (`status`, history in `status_log`);
//  - things added to the itinerary (`schedule`);
//  - hotels added per place (`hotels`).
// Every add/edit/delete of schedule entries and hotels is also written to `change_log`
// with the row as it was after the change (or before a delete), so nothing is lost silently.
//
// The SQL is written once (with `?` placeholders) on top of a tiny adapter per database:
//  - PostgreSQL when DATABASE_URL is set (Railway's Postgres survives redeploys);
//  - a local SQLite file otherwise (development, or a server with a persistent disk).

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import pg from 'pg';
import type { HotelInput, ScheduleInput } from '../shared/places.ts';
import type { CheckEntry, CheckState, DayOverride, HandledState, HotelEntry, Person, ScheduleEntry, StatusEntry, StatusMap, UserState } from '../shared/types.ts';

type Params = Array<string | number | null>;

interface Db {
  all<T>(sql: string, params?: Params): Promise<T[]>;
  run(sql: string, params?: Params): Promise<void>;
  /** Runs `fn` atomically; statements inside must go through the `db` it is given. */
  tx(fn: (db: Db) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

const schema = (autoId: string) => `
  CREATE TABLE IF NOT EXISTS status (
    key   TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('booked', 'paid')),
    by    TEXT NOT NULL,
    at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS status_log (
    id    ${autoId},
    key   TEXT NOT NULL,
    state TEXT,            -- NULL = undone
    by    TEXT NOT NULL,
    at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schedule (
    id         TEXT PRIMARY KEY,
    date       TEXT NOT NULL,
    time       TEXT,
    text       TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hotels (
    id         TEXT PRIMARY KEY,
    place      TEXT NOT NULL,
    name       TEXT NOT NULL,
    stay_kind  TEXT NOT NULL CHECK (stay_kind IN ('full', 'nights')),
    check_in   TEXT,
    nights     INTEGER,
    note       TEXT NOT NULL,
    paid       INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS day_overrides (
    date TEXT PRIMARY KEY,
    text TEXT,             -- NULL = the day's workbook text was removed
    by   TEXT NOT NULL,
    at   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS checks (
    key   TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('done', 'missed')),
    by    TEXT NOT NULL,
    at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS change_log (
    id        ${autoId},
    entity    TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action    TEXT NOT NULL,
    data      TEXT NOT NULL,
    by        TEXT NOT NULL,
    at        TEXT NOT NULL
  );
`;

class SqliteDb implements Db {
  private db: Database.Database;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(schema('INTEGER PRIMARY KEY AUTOINCREMENT'));
  }
  async all<T>(sql: string, params: Params = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }
  async run(sql: string, params: Params = []): Promise<void> {
    this.db.prepare(sql).run(...params);
  }
  tx(fn: (db: Db) => Promise<void>): Promise<void> {
    // One connection: serialize transactions so requests cannot interleave inside one.
    const next = this.lock.then(async () => {
      this.db.exec('BEGIN');
      try {
        await fn(this);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    });
    this.lock = next.catch(() => {});
    return next;
  }
  async close(): Promise<void> {
    this.db.close();
  }
}

/** `?` placeholders → `$1, $2, ...` */
const toPg = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

class PgDb implements Db {
  private pool: pg.Pool;
  private migrated: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000 });
    // An idle connection dropping (e.g. a database restart) must not crash the server.
    this.pool.on('error', () => {});
  }
  /** Creates the tables on first use; retried on the next call if the database was not up yet. */
  private ready(): Promise<void> {
    this.migrated ??= this.pool
      .query(schema('BIGSERIAL PRIMARY KEY'))
      .then(() => undefined)
      .catch((err: unknown) => {
        this.migrated = null;
        throw err;
      });
    return this.migrated;
  }
  async all<T>(sql: string, params: Params = []): Promise<T[]> {
    await this.ready();
    return (await this.pool.query(toPg(sql), params)).rows as T[];
  }
  async run(sql: string, params: Params = []): Promise<void> {
    await this.ready();
    await this.pool.query(toPg(sql), params);
  }
  async tx(fn: (db: Db) => Promise<void>): Promise<void> {
    await this.ready();
    const client = await this.pool.connect();
    const scoped: Db = {
      all: async <T,>(sql: string, params: Params = []) => (await client.query(toPg(sql), params)).rows as T[],
      run: async (sql, params = []) => {
        await client.query(toPg(sql), params);
      },
      tx: (inner) => inner(scoped),
      close: async () => {},
    };
    try {
      await client.query('BEGIN');
      await fn(scoped);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}

interface ScheduleRow {
  id: string;
  date: string;
  time: string | null;
  text: string;
  created_by: Person;
  created_at: string;
  updated_by: Person;
  updated_at: string;
}
interface HotelRow {
  id: string;
  place: string;
  name: string;
  stay_kind: 'full' | 'nights';
  check_in: string | null;
  nights: number | null;
  note: string;
  paid: number;
  created_by: Person;
  created_at: string;
  updated_by: Person;
  updated_at: string;
}

const scheduleFromRow = (r: ScheduleRow): ScheduleEntry => ({
  id: r.id,
  date: r.date,
  time: r.time,
  text: r.text,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
});
const hotelFromRow = (r: HotelRow): HotelEntry => ({
  id: r.id,
  place: r.place,
  name: r.name,
  stay: r.stay_kind === 'full' ? { kind: 'full' } : { kind: 'nights', checkIn: r.check_in ?? '', nights: Number(r.nights) },
  note: r.note,
  paid: Number(r.paid) === 1,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
});

export class TripStore {
  private db: Db;
  readonly kind: 'postgres' | 'sqlite';

  constructor(db: Db, kind: 'postgres' | 'sqlite') {
    this.db = db;
    this.kind = kind;
  }

  static sqlite(path: string): TripStore {
    return new TripStore(new SqliteDb(path), 'sqlite');
  }
  static postgres(url: string): TripStore {
    return new TripStore(new PgDb(url), 'postgres');
  }

  // ---- Booked / Paid marks -----------------------------------------------------------

  async statusAll(): Promise<StatusMap> {
    const rows = await this.db.all<StatusEntry & { key: string }>('SELECT key, state, by, at FROM status');
    return Object.fromEntries(rows.map(({ key, state, by, at }) => [key, { state, by, at }]));
  }

  async setStatus(key: string, state: HandledState, by: Person, now = new Date()): Promise<StatusEntry> {
    const at = now.toISOString();
    await this.db.tx(async (db) => {
      await db.run(
        'INSERT INTO status (key, state, by, at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET state = excluded.state, by = excluded.by, at = excluded.at',
        [key, state, by, at],
      );
      await db.run('INSERT INTO status_log (key, state, by, at) VALUES (?, ?, ?, ?)', [key, state, by, at]);
    });
    return { state, by, at };
  }

  async clearStatus(key: string, by: Person, now = new Date()): Promise<void> {
    await this.db.tx(async (db) => {
      await db.run('DELETE FROM status WHERE key = ?', [key]);
      await db.run('INSERT INTO status_log (key, state, by, at) VALUES (?, NULL, ?, ?)', [key, by, now.toISOString()]);
    });
  }

  // ---- Schedule ------------------------------------------------------------------------

  async listSchedule(): Promise<ScheduleEntry[]> {
    const rows = await this.db.all<ScheduleRow>('SELECT * FROM schedule ORDER BY date, time, created_at');
    return rows.map(scheduleFromRow);
  }

  async addSchedule(input: ScheduleInput, by: Person, now = new Date()): Promise<ScheduleEntry> {
    const at = now.toISOString();
    const entry: ScheduleEntry = {
      id: randomUUID(),
      date: input.date,
      time: input.time,
      text: input.text.trim(),
      createdBy: by,
      createdAt: at,
      updatedBy: by,
      updatedAt: at,
    };
    await this.db.tx(async (db) => {
      await db.run(
        'INSERT INTO schedule (id, date, time, text, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [entry.id, entry.date, entry.time, entry.text, by, at, by, at],
      );
      await this.log(db, 'schedule', entry.id, 'add', entry, by, at);
    });
    return entry;
  }

  async updateSchedule(id: string, input: ScheduleInput, by: Person, now = new Date()): Promise<ScheduleEntry | null> {
    const at = now.toISOString();
    let result: ScheduleEntry | null = null;
    await this.db.tx(async (db) => {
      const [row] = await db.all<ScheduleRow>('SELECT * FROM schedule WHERE id = ?', [id]);
      if (!row) return;
      result = { ...scheduleFromRow(row), date: input.date, time: input.time, text: input.text.trim(), updatedBy: by, updatedAt: at };
      await db.run('UPDATE schedule SET date = ?, time = ?, text = ?, updated_by = ?, updated_at = ? WHERE id = ?', [
        input.date,
        input.time,
        result.text,
        by,
        at,
        id,
      ]);
      await this.log(db, 'schedule', id, 'update', result, by, at);
    });
    return result;
  }

  async deleteSchedule(id: string, by: Person, now = new Date()): Promise<boolean> {
    return this.deleteRow('schedule', id, by, now, (r: ScheduleRow) => scheduleFromRow(r));
  }

  // ---- Hotels --------------------------------------------------------------------------

  async listHotels(): Promise<HotelEntry[]> {
    const rows = await this.db.all<HotelRow>('SELECT * FROM hotels ORDER BY created_at');
    return rows.map(hotelFromRow);
  }

  async addHotel(input: HotelInput, by: Person, now = new Date()): Promise<HotelEntry> {
    const at = now.toISOString();
    const entry: HotelEntry = {
      id: randomUUID(),
      place: input.place,
      name: input.name.trim(),
      stay: input.stay,
      note: input.note.trim(),
      paid: input.paid,
      createdBy: by,
      createdAt: at,
      updatedBy: by,
      updatedAt: at,
    };
    await this.db.tx(async (db) => {
      await db.run(
        'INSERT INTO hotels (id, place, name, stay_kind, check_in, nights, note, paid, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [entry.id, entry.place, entry.name, ...stayColumns(entry.stay), entry.note, entry.paid ? 1 : 0, by, at, by, at],
      );
      await this.log(db, 'hotel', entry.id, 'add', entry, by, at);
    });
    return entry;
  }

  async updateHotel(id: string, input: HotelInput, by: Person, now = new Date()): Promise<HotelEntry | null> {
    const at = now.toISOString();
    let result: HotelEntry | null = null;
    await this.db.tx(async (db) => {
      const [row] = await db.all<HotelRow>('SELECT * FROM hotels WHERE id = ?', [id]);
      if (!row) return;
      result = {
        ...hotelFromRow(row),
        place: input.place,
        name: input.name.trim(),
        stay: input.stay,
        note: input.note.trim(),
        paid: input.paid,
        updatedBy: by,
        updatedAt: at,
      };
      await db.run(
        'UPDATE hotels SET place = ?, name = ?, stay_kind = ?, check_in = ?, nights = ?, note = ?, paid = ?, updated_by = ?, updated_at = ? WHERE id = ?',
        [result.place, result.name, ...stayColumns(result.stay), result.note, result.paid ? 1 : 0, by, at, id],
      );
      await this.log(db, 'hotel', id, 'update', result, by, at);
    });
    return result;
  }

  async deleteHotel(id: string, by: Person, now = new Date()): Promise<boolean> {
    return this.deleteRow('hotels', id, by, now, (r: HotelRow) => hotelFromRow(r));
  }

  // ---- Edits to the workbook's day text ------------------------------------------------

  async listDayOverrides(): Promise<Record<string, DayOverride>> {
    const rows = await this.db.all<DayOverride>('SELECT date, text, by, at FROM day_overrides');
    return Object.fromEntries(rows.map((r) => [r.date, { date: r.date, text: r.text, by: r.by, at: r.at }]));
  }

  /** Replaces the day's workbook text (`text`), or removes it (`null`). */
  async setDayOverride(date: string, text: string | null, by: Person, now = new Date()): Promise<DayOverride> {
    const entry: DayOverride = { date, text: text === null ? null : text.trim(), by, at: now.toISOString() };
    await this.db.tx(async (db) => {
      await db.run(
        'INSERT INTO day_overrides (date, text, by, at) VALUES (?, ?, ?, ?) ON CONFLICT (date) DO UPDATE SET text = excluded.text, by = excluded.by, at = excluded.at',
        [date, entry.text, by, entry.at],
      );
      await this.log(db, 'day', date, text === null ? 'remove' : 'edit', entry, by, entry.at);
    });
    return entry;
  }

  /** Brings back the workbook's original text for the day. */
  async clearDayOverride(date: string, by: Person, now = new Date()): Promise<boolean> {
    let found = false;
    await this.db.tx(async (db) => {
      const [row] = await db.all<DayOverride>('SELECT date, text, by, at FROM day_overrides WHERE date = ?', [date]);
      if (!row) return;
      found = true;
      await db.run('DELETE FROM day_overrides WHERE date = ?', [date]);
      await this.log(db, 'day', date, 'restore', row, by, now.toISOString());
    });
    return found;
  }

  // ---- Done / missed marks ---------------------------------------------------------------

  async listChecks(): Promise<Record<string, CheckEntry>> {
    const rows = await this.db.all<CheckEntry & { key: string }>('SELECT key, state, by, at FROM checks');
    return Object.fromEntries(rows.map(({ key, state, by, at }) => [key, { state, by, at }]));
  }

  async setCheck(key: string, state: CheckState, by: Person, now = new Date()): Promise<CheckEntry> {
    const entry: CheckEntry = { state, by, at: now.toISOString() };
    await this.db.tx(async (db) => {
      await db.run(
        'INSERT INTO checks (key, state, by, at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET state = excluded.state, by = excluded.by, at = excluded.at',
        [key, state, by, entry.at],
      );
      await this.log(db, 'check', key, state, entry, by, entry.at);
    });
    return entry;
  }

  async clearCheck(key: string, by: Person, now = new Date()): Promise<void> {
    await this.db.tx(async (db) => {
      await db.run('DELETE FROM checks WHERE key = ?', [key]);
      await this.log(db, 'check', key, 'clear', {}, by, now.toISOString());
    });
  }

  // ---- Shared --------------------------------------------------------------------------

  async state(): Promise<UserState> {
    const [status, schedule, hotels, days, checks] = await Promise.all([
      this.statusAll(),
      this.listSchedule(),
      this.listHotels(),
      this.listDayOverrides(),
      this.listChecks(),
    ]);
    return { status, schedule, hotels, days, checks };
  }

  /** Whether the store answers, with the driver's error message when it does not (never contains secrets). */
  async ping(): Promise<{ ok: boolean; error?: string }> {
    try {
      const [row] = await this.db.all<{ ok: number }>('SELECT 1 AS ok');
      return { ok: Number(row?.ok) === 1 };
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return { ok: false, error: [e.code, e.message].filter(Boolean).join(': ') || String(err) };
    }
  }

  close(): Promise<void> {
    return this.db.close();
  }

  private async deleteRow<R>(table: 'schedule' | 'hotels', id: string, by: Person, now: Date, toEntry: (r: R) => unknown): Promise<boolean> {
    let found = false;
    await this.db.tx(async (db) => {
      const [row] = await db.all<R>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (!row) return;
      found = true;
      await db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
      await this.log(db, table === 'hotels' ? 'hotel' : 'schedule', id, 'delete', toEntry(row), by, now.toISOString());
    });
    return found;
  }

  private log(db: Db, entity: string, id: string, action: string, data: unknown, by: Person, at: string): Promise<void> {
    return db.run('INSERT INTO change_log (entity, entity_id, action, data, by, at) VALUES (?, ?, ?, ?, ?, ?)', [
      entity,
      id,
      action,
      JSON.stringify(data),
      by,
      at,
    ]);
  }
}

function stayColumns(stay: HotelEntry['stay']): [string, string | null, number | null] {
  return stay.kind === 'full' ? ['full', null, null] : ['nights', stay.checkIn, stay.nights];
}

export interface OpenedStore {
  store: TripStore;
  kind: 'postgres' | 'sqlite';
  /** Set when DATABASE_URL was present but unusable, so the SQLite fallback is in use. */
  warning?: string;
}

/** Postgres when DATABASE_URL is a postgres URL, otherwise the SQLite file at `sqlitePath`. */
export function openStore(env: { DATABASE_URL?: string }, sqlitePath: string): OpenedStore {
  const url = env.DATABASE_URL?.trim();
  if (url && /^postgres(ql)?:\/\//.test(url)) return { store: TripStore.postgres(url), kind: 'postgres' };
  const warning = url
    ? url.includes('${{')
      ? 'DATABASE_URL contains an unresolved Railway reference (check the service name inside ${{...}})'
      : 'DATABASE_URL is set but is not a postgres:// URL'
    : undefined;
  return { store: TripStore.sqlite(sqlitePath), kind: 'sqlite', warning };
}
