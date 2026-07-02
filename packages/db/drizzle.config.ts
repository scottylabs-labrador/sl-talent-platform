import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Only read at generate/push time; not needed for the checked-in SQL.
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/tartan',
  },
  // Keep the generated SQL readable and stable in review.
  verbose: true,
  strict: true,
});
