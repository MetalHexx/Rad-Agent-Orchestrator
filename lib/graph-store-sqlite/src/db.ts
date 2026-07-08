import Database from 'better-sqlite3';
import { runMigrations } from './schema/migrations.js';

/**
 * Opens (creating if necessary) a WAL-enabled, foreign-key-enforcing SQLite database at `path`
 * and migrates it to the latest schema version. `path` may be `:memory:` for an in-process handle.
 */
export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL'); // no-op for ':memory:', fine
  db.pragma('foreign_keys = ON'); // per-connection, must be set every open
  runMigrations(db);
  return db;
}
