/**
 * Retry policies repository (named, reusable per-project configs).
 */
import { pool } from "../pool.js";

export interface RetryPolicyRow {
  id: string;
  project_id: string;
  name: string;
  strategy: "fixed" | "linear" | "exponential";
  max_attempts: number;
  base_delay_ms: number;
  max_delay_ms: number;
  jitter: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function create(params: {
  projectId: string;
  name: string;
  strategy: RetryPolicyRow["strategy"];
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter?: boolean;
}): Promise<RetryPolicyRow> {
  const res = await pool.query<RetryPolicyRow>(
    `INSERT INTO retry_policies
       (project_id, name, strategy, max_attempts, base_delay_ms, max_delay_ms, jitter)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true))
     RETURNING *`,
    [
      params.projectId,
      params.name,
      params.strategy,
      params.maxAttempts,
      params.baseDelayMs,
      params.maxDelayMs,
      params.jitter ?? null,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error("INSERT returned no row");
  return row;
}

export async function findById(id: string): Promise<RetryPolicyRow | null> {
  const res = await pool.query<RetryPolicyRow>(
    "SELECT * FROM retry_policies WHERE id = $1",
    [id],
  );
  return res.rows[0] ?? null;
}

export async function listByProject(
  projectId: string,
): Promise<RetryPolicyRow[]> {
  const res = await pool.query<RetryPolicyRow>(
    "SELECT * FROM retry_policies WHERE project_id = $1 ORDER BY created_at",
    [projectId],
  );
  return res.rows;
}
