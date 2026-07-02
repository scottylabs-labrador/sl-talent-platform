// @tartan/db — Drizzle ORM schema, client, migrations, seed.
export const DB_PACKAGE = '@tartan/db';

export * from './schema.js';
export * from './relations.js';
export { db, rawSql, closeDb } from './client.js';
export { runMigrations } from './migrate.js';
export { seed } from './seed.js';
export type { SeedResult } from './seed.js';

// Re-export drizzle-orm operators so consumers get them from one place and
// pin to the same version the schema was built against.
export {
  and,
  or,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  desc,
  asc,
  sql,
} from 'drizzle-orm';
