import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema>;

let instance: DB | undefined;

/**
 * Lazily-created singleton. Connection + migration happen on FIRST CALL, not at
 * import time: `vite build` (and anything else that merely imports server
 * modules for analysis) must never create or touch data.db as a side effect.
 * Call inside request handlers / hooks, never at module top level.
 */
export function getDb(): DB {
	if (instance) return instance;

	const dbPath = process.env.DATABASE_PATH ?? './data.db';

	const sqlite = new Database(dbPath);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');

	const db = drizzle(sqlite, { schema });

	// Resolved relative to process.cwd() by default (the project root in `vite dev`;
	// deploy/server-manager.service pins WorkingDirectory to the install dir in
	// production). MIGRATIONS_PATH overrides it for non-standard layouts. Using
	// import.meta.url instead would break here since Vite bundles server code into
	// chunk files at unpredictable depths.
	const migrationsFolder = process.env.MIGRATIONS_PATH ?? join(process.cwd(), 'drizzle');

	if (!existsSync(migrationsFolder)) {
		throw new Error(
			`Drizzle migrations folder not found at ${JSON.stringify(migrationsFolder)}. ` +
				'Run the app from the project root (or set WorkingDirectory in the systemd unit), ' +
				'or point MIGRATIONS_PATH at the drizzle/ directory.'
		);
	}

	migrate(db, { migrationsFolder });

	instance = db;
	return instance;
}
