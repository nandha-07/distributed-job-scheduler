/**
 * Queues repository, including per-queue statistics.
 */
import { pool } from "../pool.js";

export interface QueueRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  priority: number;
  max_concurrency: number;
  is_paused: boolean;
  default_retry_policy_id: string | null;
  rate_limit_per_sec: number | null;
  created_at: Date;
  updated_at: Date;
}

export async function create(params: {
  projectId: string;
  name: string;
  description?: string | null;
  priority?: number;
  maxConcurrency?: number;
  defaultRetryPolicyId?: string | null;
  rateLimitPerSec?: number | null;
}): Promise<QueueRow> {
  const res = await pool.query<QueueRow>(
    `INSERT INTO queues
       (project_id, name, description, priority, max_concurrency, default_retry_policy_id, rate_limit_per_sec)
     VALUES ($1, $2, $3, COALESCE($4, 0), COALESCE($5, 10), $6, $7)
     RETURNING *`,
    [
      params.projectId,
      params.name,
      params.description ?? null,
      params.priority ?? null,
      params.maxConcurrency ?? null,
      params.defaultRetryPolicyId ?? null,
      params.rateLimitPerSec ?? null,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error("INSERT returned no row");
  return row;
}

export async function findById(id: string): Promise<QueueRow | null> {
  const res = await pool.query<QueueRow>(
    "SELECT * FROM queues WHERE id = $1",
    [id],
  );
  return res.rows[0] ?? null;
}

export async function listByProject(
  projectId: string,
  limit: number,
  offset: number,
): Promise<{ rows: QueueRow[]; total: number }> {
  const [rows, count] = await Promise.all([
    pool.query<QueueRow>(
      `SELECT * FROM queues WHERE project_id = $1
        ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [projectId, limit, offset],
    ),
    pool.query<{ total: string }>(
      "SELECT count(*) AS total FROM queues WHERE project_id = $1",
      [projectId],
    ),
  ]);
  return { rows: rows.rows, total: Number(count.rows[0]?.total ?? 0) };
}

export async function update(
  id: string,
  params: {
    name?: string;
    description?: string | null;
    priority?: number;
    maxConcurrency?: number;
    defaultRetryPolicyId?: string | null;
    rateLimitPerSec?: number | null;
  },
): Promise<QueueRow | null> {
  const res = await pool.query<QueueRow>(
    `UPDATE queues
        SET name                    = COALESCE($2, name),
            description             = COALESCE($3, description),
            priority                = COALESCE($4, priority),
            max_concurrency         = COALESCE($5, max_concurrency),
            default_retry_policy_id = COALESCE($6, default_retry_policy_id),
            rate_limit_per_sec      = COALESCE($7, rate_limit_per_sec)
      WHERE id = $1
      RETURNING *`,
    [
      id,
      params.name ?? null,
      params.description ?? null,
      params.priority ?? null,
      params.maxConcurrency ?? null,
      params.defaultRetryPolicyId ?? null,
      params.rateLimitPerSec ?? null,
    ],
  );
  return res.rows[0] ?? null;
}

export async function setPaused(
  id: string,
  paused: boolean,
): Promise<QueueRow | null> {
  const res = await pool.query<QueueRow>(
    "UPDATE queues SET is_paused = $2 WHERE id = $1 RETURNING *",
    [id, paused],
  );
  return res.rows[0] ?? null;
}

export async function remove(id: string): Promise<boolean> {
  const res = await pool.query("DELETE FROM queues WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}

export interface QueueStats {
  byState: Record<string, number>;
  completedLastHour: number;
  failedLastHour: number;
}

/** Dashboard numbers — powered by the jobs_queue_state_idx index. */
export async function stats(queueId: string): Promise<QueueStats> {
  const [byState, lastHour] = await Promise.all([
    pool.query<{ state: string; n: string }>(
      "SELECT state, count(*) AS n FROM jobs WHERE queue_id = $1 GROUP BY state",
      [queueId],
    ),
    pool.query<{ completed: string; failed: string }>(
      `SELECT
         count(*) FILTER (WHERE state = 'completed' AND finished_at > now() - interval '1 hour') AS completed,
         count(*) FILTER (WHERE state IN ('failed','dead_letter') AND finished_at > now() - interval '1 hour') AS failed
       FROM jobs WHERE queue_id = $1`,
      [queueId],
    ),
  ]);
  const stateCounts: Record<string, number> = {};
  for (const r of byState.rows) stateCounts[r.state] = Number(r.n);
  return {
    byState: stateCounts,
    completedLastHour: Number(lastHour.rows[0]?.completed ?? 0),
    failedLastHour: Number(lastHour.rows[0]?.failed ?? 0),
  };
}
