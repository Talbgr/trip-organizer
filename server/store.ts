// Shared "handled" state for reminders (Booked / Paid), kept in SQLite so both
// phones see the same thing. Every change is appended to `status_log` so a
// mistaken tap can be traced; `status` holds the current state per reminder.

import Database from 'better-sqlite3';
import type { HandledState, Person, StatusEntry, StatusMap } from '../shared/types.ts';

export class StatusStore {
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

  all(): StatusMap {
    const rows = this.db.prepare('SELECT key, state, by, at FROM status').all() as Array<StatusEntry & { key: string }>;
    return Object.fromEntries(rows.map(({ key, ...e }) => [key, e]));
  }

  set(key: string, state: HandledState, by: Person, now = new Date()): StatusEntry {
    const entry: StatusEntry = { state, by, at: now.toISOString() };
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO status (key, state, by, at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET state = excluded.state, by = excluded.by, at = excluded.at')
        .run(key, state, by, entry.at);
      this.db.prepare('INSERT INTO status_log (key, state, by, at) VALUES (?, ?, ?, ?)').run(key, state, by, entry.at);
    })();
    return entry;
  }

  clear(key: string, by: Person, now = new Date()): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM status WHERE key = ?').run(key);
      this.db.prepare('INSERT INTO status_log (key, state, by, at) VALUES (?, NULL, ?, ?)').run(key, by, now.toISOString());
    })();
  }

  ping(): boolean {
    return (this.db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
  }

  close(): void {
    this.db.close();
  }
}
