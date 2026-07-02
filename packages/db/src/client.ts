// Lazy singleton DB client. Never connects at import time — importing this
// module in a build with no DATABASE_URL must not throw. The connection is
// created on the first db() / rawSql() call.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import * as relationsModule from './relations.js';

type Sql = ReturnType<typeof postgres>;
type Database = ReturnType<typeof drizzle<typeof schema & typeof relationsModule>>;

let _sql: Sql | undefined;
let _db: Database | undefined;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. db()/rawSql() require a Postgres connection; ' +
        'do not call them at import time.',
    );
  }
  return url;
}

/** The raw postgres.js client (for views and hand-written SQL). Lazily opened. */
export function rawSql(): Sql {
  if (!_sql) {
    _sql = postgres(connectionString(), {
      max: Number(process.env.PG_POOL_MAX ?? 10),
      // Railway pgbouncer-friendly defaults; harmless on a direct connection.
      prepare: false,
    });
  }
  return _sql;
}

/** The drizzle database, with schema + relations bound. Lazily opened. */
export function db(): Database {
  if (!_db) {
    _db = drizzle(rawSql(), {
      schema: { ...schema, ...relationsModule },
    });
  }
  return _db;
}

/** Close the pool (tests, graceful shutdown). Safe to call when never opened. */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = undefined;
    _db = undefined;
  }
}
