/**
 * Reusable transaction wrapper.
 *
 * Usage:
 *   await withTransaction(async (tx) => {
 *     await usersRepo.create(tx, ...);
 *     await orgsRepo.create(tx, ...);   // all-or-nothing
 *   });
 *
 * Guarantees: BEGIN before the callback, COMMIT on success, ROLLBACK on any
 * thrown error, and the connection is always returned to the pool.
 * Repositories accept a `Queryable` so the same function works inside a
 * transaction (pass the tx client) or standalone (pass the pool).
 */
import type { PoolClient } from "pg";
import { pool } from "./pool.js";

/** Anything you can run a query on: the pool itself, or a tx client. */
export type Queryable = Pick<PoolClient, "query">;

export async function withTransaction<T>(
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
