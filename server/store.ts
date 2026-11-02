// Shared "handled" state for reminders (Booked / Paid), so both phones see the same
// thing. Every change is also appended to `status_log`, so a mistaken tap can be
// traced; `status` holds the current state per reminder.
//
// Two backends with the same tables:
//  - PostgreSQL when DATABASE_URL is set (Railway's Postgres survives redeploys);
//  - a local SQLite file otherwise (development, or a server with a persistent disk).

import Database from 'better-sqlite3';
import pg from 'pg';
import type { HandledState, Person, StatusEntry, StatusMap } from '../shared/types.ts';

export interface StatusStore {
  all(): Promise<StatusMap>;
  set(key: string, state: HandledState, by: Person, now?: Date): Promise<StatusEntry>;
  clear(key: string, by: Person, now?: Date): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

type Row = StatusEntry & { key: string };
const toMap = (rows: Row[]): StatusMap => Object.fromEntries(rows.map(({ key, state, by, at }) => [key, { state, by, at }]));

export class SqliteStatusStore implements StatusStore {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS status (
        key   TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('booked', 'paid')),
        by    TEXT NOT NULL,
        at    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS status_log (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        key   TEXT NOT NULL,
        state TEXT,            -- NULL = undone
        by    TEXT NOT NULL,
        at    TEXT NOT NULL
      );
    `);
  }

  async all(): Promise<StatusMap> {
    return toMap(this.db.prepare('SELECT key, state, by, at FROM status').all() as Row[]);
  }

  async set(key: string, state: HandledState, by: Person, now = new Date()): Promise<StatusEntry> {
    const at = now.toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO status (key, state, by, at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET state = excluded.state, by = excluded.by, at = excluded.at',
        )
        .run(key, state, by, at);
      this.db.prepare('INSERT INTO status_log (key, state, by, at) VALUES (?, ?, ?, ?)').run(key, state, by, at);
    })();
    return { state, by, at };
  }

  async clear(key: string, by: Person, now = new Date()): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM status WHERE key = ?').run(key);
      this.db.prepare('INSERT INTO status_log (key, state, by, at) VALUES (?, NULL, ?, ?)').run(key, by, now.toISOString());
    })();
  }

  async ping(): Promise<boolean> {
    return (this.db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export class PgStatusStore implements StatusStore {
  private pool: pg.Pool;
  private migrated: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
    // An idle connection dropping (e.g. a database restart) must not crash the server.
    this.pool.on('error', () => {});
  }

  /** Creates the tables on first use; retried on the next call if the database was not up yet. */
  private get ready(): Promise<void> {
    this.migrated ??= this.migrate().catch((err: unknown) => {
      this.migrated = null;
      throw err;
    });
    return this.migrated;
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS status (
        key   TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('booked', 'paid')),
        by    TEXT NOT NULL,
        at    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS status_log (
        id    BIGSERIAL PRIMARY KEY,
        key   TEXT NOT NULL,
        state TEXT,
        by    TEXT NOT NULL,
        at    TEXT NOT NULL
      );
    `);
  }

  /** Runs `fn` in one transaction on a single connection. */
  private async tx(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async all(): Promise<StatusMap> {
    await this.ready;
    const { rows } = await this.pool.query<Row>('SELECT key, state, by, at FROM status');
    return toMap(rows);
  }

  async set(key: string, state: HandledState, by: Person, now = new Date()): Promise<StatusEntry> {
    const at = now.toISOString();
    await this.tx(async (c) => {
      await c.query(
        'INSERT INTO status (key, state, by, at) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET state = excluded.state, by = excluded.by, at = excluded.at',
        [key, state, by, at],
      );
      await c.query('INSERT INTO status_log (key, state, by, at) VALUES ($1, $2, $3, $4)', [key, state, by, at]);
    });
    return { state, by, at };
  }

  async clear(key: string, by: Person, now = new Date()): Promise<void> {
    await this.tx(async (c) => {
      await c.query('DELETE FROM status WHERE key = $1', [key]);
      await c.query('INSERT INTO status_log (key, state, by, at) VALUES ($1, NULL, $2, $3)', [key, by, now.toISOString()]);
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.ready;
      const { rows } = await this.pool.query<{ ok: number }>('SELECT 1 AS ok');
      return rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Postgres when DATABASE_URL is set, otherwise the SQLite file at `sqlitePath`. */
export function openStore(env: { DATABASE_URL?: string }, sqlitePath: string): { store: StatusStore; kind: 'postgres' | 'sqlite' } {
  if (env.DATABASE_URL) return { store: new PgStatusStore(env.DATABASE_URL), kind: 'postgres' };
  return { store: new SqliteStatusStore(sqlitePath), kind: 'sqlite' };
}
