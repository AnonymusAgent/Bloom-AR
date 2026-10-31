import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { buildPgPoolConfig, resolveRuntimeDatabaseUrl } from "./pg-config";

const databaseUrl = resolveRuntimeDatabaseUrl();

if (!databaseUrl) {
  throw new Error("DATABASE_URL, DATABASE_URL_POOLED, or NEON_DATABASE_URL environment variable is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool(buildPgPoolConfig(databaseUrl));

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
