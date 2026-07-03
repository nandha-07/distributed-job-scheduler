/**
 * Batches repository.
 */
import type { Queryable } from "../tx.js";
import { pool } from "../pool.js";

export interface BatchRow {
  id: string;
  project_id: string;
  name: string | null;
  created_at: Date;
}

export async function create(
  db: Queryable,
  params: { projectId: string; name?: string | null },
): Promise<BatchRow> {
  const res = await db.query<BatchRow>(
    "INSERT INTO batches (project_id, name) VALUES ($1, $2) RETURNING *",
    [params.projectId, params.name ?? null],
  );
  const row = res.rows[0];
  if (!row) throw new Error("INSERT returned no row");
  return row;
}

export async function findById(id: string): Promise<BatchRow | null> {
  const res = await pool.query<BatchRow>(
    "SELECT * FROM batches WHERE id = $1",
    [id],
  );
  return res.rows[0] ?? null;
}

/** Progress = job counts by state for the batch. */
export async function progress(
  batchId: string,
): Promise<Record<string, number>> {
  const res = await pool.query<{ state: string; n: string }>(
    "SELECT state, count(*) AS n FROM jobs WHERE batch_id = $1 GROUP BY state",
    [batchId],
  );
  const out: Record<string, number> = {};
  for (const r of res.rows) out[r.state] = Number(r.n);
  return out;
}
