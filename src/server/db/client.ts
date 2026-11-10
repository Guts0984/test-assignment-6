import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '../env';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(databaseUrl: string, max = 10): { db: Db; close: () => Promise<void> } {
  const client = postgres(databaseUrl, { max, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

// Survive Next.js dev hot reloads without leaking pools.
const globalForDb = globalThis as unknown as { __db?: Db };

export function getDb(): Db {
  globalForDb.__db ??= createDb(getEnv().DATABASE_URL).db;
  return globalForDb.__db;
}
