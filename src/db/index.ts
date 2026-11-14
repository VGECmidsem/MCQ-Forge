import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: NodePgDatabase;
};

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Set it to a PostgreSQL connection string " +
        "(see README → Running as a website).",
    );
  }
  return url;
}

/**
 * Lazily create the connection pool.
 *
 * This must not run at module load time: `next build` imports every route to
 * collect page data, and a hard throw there would make the build fail on any
 * machine (or CI runner) that has no database. Keeping it lazy means
 * `next build` works anywhere and the error only surfaces on a real request.
 */
export function getPool(): Pool {
  if (globalForDb.__arenaNextJsPostgresqlPool) {
    return globalForDb.__arenaNextJsPostgresqlPool;
  }
  const pool = new Pool({ connectionString: databaseUrl() });
  globalForDb.__arenaNextJsPostgresqlPool = pool;
  return pool;
}

/** Lazily initialised Drizzle client. Safe to import without a database. */
export function getDb(): NodePgDatabase {
  if (!globalForDb.__arenaNextJsPostgresqlDb) {
    globalForDb.__arenaNextJsPostgresqlDb = drizzle(getPool());
  }
  return globalForDb.__arenaNextJsPostgresqlDb;
}

/** Proxy so existing `db.select(...)` call sites keep working unchanged. */
export const db: NodePgDatabase = new Proxy({} as NodePgDatabase, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_target, prop) {
    return prop in (getDb() as unknown as object);
  },
});

/** Backwards-compatible lazy pool accessor. */
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const real = getPool() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});
