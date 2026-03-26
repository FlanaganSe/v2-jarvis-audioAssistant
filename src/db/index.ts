import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

let db: Db | null = null;
let sql: ReturnType<typeof postgres> | null = null;

export const connectDb = (url: string): Db => {
  if (db) return db;
  sql = postgres(url);
  db = drizzle(sql, { schema });
  return db;
};

export const getDb = (): Db => {
  if (!db) throw new Error('Database not connected. Call connectDb() first.');
  return db;
};

export const disconnectDb = async (): Promise<void> => {
  if (sql) {
    await sql.end();
    sql = null;
    db = null;
  }
};
