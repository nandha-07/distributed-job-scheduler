/**
 * The one and only PostgreSQL connection pool.
 *
 * Why a pool? Opening a TCP connection + auth handshake per query is slow
 * and Postgres caps total connections. A pool keeps a small set of warm
 * connections and lends them out per query/transaction — this is how every
 * production Node service talks to Postgres.
 */
import pg from "pg";
import { config } from "@jobs/config";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10, // per-process cap; tune per process type later
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

/** Graceful shutdown: let in-flight queries finish, then close sockets. */
export async function closePool(): Promise<void> {
  await pool.end();
}
