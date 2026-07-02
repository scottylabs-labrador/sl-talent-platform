// Web's single entry point to the database. Re-exports everything from
// @tartan/db — the lazy drizzle accessor `db()` (opens the connection on first
// call, never at import time), `rawSql()`, the schema tables + relations, and
// the drizzle query operators (eq, and, desc, sql, …). App code imports these
// from '@/lib/db' so there is one door to the database.

export * from '@tartan/db';
