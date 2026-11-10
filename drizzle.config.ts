import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/modules/*/schema.ts',
  out: './src/server/core/db/migrations',
  // Only `generate` is used (no DB access), so no credentials are needed here.
});
