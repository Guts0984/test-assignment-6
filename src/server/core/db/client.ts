import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '../env';

export type Db = PostgresJsDatabase;

export function createDb(databaseUrl: string, max = 10): { db: Db; close: () => Promise<void> } {
  const client = postgres(databaseUrl, { max, onnotice: () => {} });
  return { db: drizzle(client), close: () => client.end() };
}

// Survive Next.js dev hot reloads without leaking pools.
const globalForDb = globalThis as unknown as { __db?: Db };

export function getDb(): Db {
  globalForDb.__db ??= createDb(getEnv().DATABASE_URL).db;
  return globalForDb.__db;
}
