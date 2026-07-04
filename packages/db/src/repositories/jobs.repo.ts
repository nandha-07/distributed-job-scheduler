/**
 * Jobs repository — creation, explorer queries, cancellation.
 * Claiming/execution updates arrive in M6 (worker milestone).
 */
import type { Queryable } from "../tx.js";
import { pool } from "../pool.js";

export interface JobRow {
  id: string;
  queue_id: string;
  schedule_id: string | null;
  batch_id: string | null;
  name: string;
  payload: unknown;
  state: string;
  priority: number;
  run_at: Date;
  attempts: number;
  max_attempts: number;
  retry_strategy: "fixed" | "linear" | "exponential";
  retry_base_delay_ms: number;
  retry_max_delay_ms: number;
  idempotency_key: string | null;
  claimed_by: string | null;
  claimed_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateJobParams {
  queueId: string;
  name: string;
  payload?: unknown;
  priority?: number;
  /** 'queued' for immediate, 'scheduled' for delayed/scheduled. */
  state: "queued" | "scheduled";
  runAt?: Date;
  idempotencyKey?: string | null;
  batchId?: string | null;
  scheduleId?: string | null;
  // Retry snapshot (resolved by the service before we get here):
  maxAttempts: number;
  retryStrategy: "fixed" | "linear" | "exponential";
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

export async function create(
  db: Queryable,
  p: CreateJobParams,
): Promise<JobRow> {
  const res = await db.query<JobRow>(
    `INSERT INTO jobs
       (queue_id, name, payload, priority, state, run_at, idempotency_key,
        batch_id, schedule_id, max_attempts, retry_strategy,
        retry_base_delay_ms, retry_max_delay_ms)
     VALUES ($1, $2, $3, COALESCE($4, 0), $5, COALESCE($6, now()), $7,
             $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      p.queueId,
      p.name,
      JSON.stringify(p.payload ?? {}),
      p.priority ?? null,
      p.state,
      p.runAt ?? null,
      p.idempotencyKey ?? null,
      p.batchId ?? null,
      p.scheduleId ?? null,
      p.maxAttempts,
      p.retryStrategy,
      p.retryBaseDelayMs,
      p.retryMaxDelayMs,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error("INSERT returned no row");
  return row;
}

export async function findById(id: string): Promise<JobRow | null> {
  const res = await pool.query<JobRow>("SELECT * FROM jobs WHERE id = $1", [
    id,
  ]);
  return res.rows[0] ?? null;
}

export async function findByIdempotencyKey(
  queueId: string,
  key: string,
): Promise<JobRow | null> {
  const res = await pool.query<JobRow>(
    "SELECT * FROM jobs WHERE queue_id = $1 AND idempotency_key = $2",
    [queueId, key],
  );
  return res.rows[0] ?? null;
}

export interface JobFilters {
  state?: string;
  name?: string;
}

/**
 * Explorer listing with safe dynamic filters: conditions and parameters
 * grow together; user values only ever travel as $n parameters.
 */
export async function listByQueue(
  queueId: string,
  filters: JobFilters,
  limit: number,
  offset: number,
): Promise<{ rows: JobRow[]; total: number }> {
  const conditions: string[] = ["queue_id = $1"];
  const params: unknown[] = [queueId];

  if (filters.state) {
    params.push(filters.state);
    conditions.push(`state = $${params.length}`);
  }
  if (filters.name) {
    params.push(filters.name);
    conditions.push(`name = $${params.length}`);
  }
  const where = conditions.join(" AND ");

  const countRes = await pool.query<{ total: string }>(
    `SELECT count(*) AS total FROM jobs WHERE ${where}`,
    params,
  );

  params.push(limit, offset);
  const rowsRes = await pool.query<JobRow>(
    `SELECT * FROM jobs WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    rows: rowsRes.rows,
    total: Number(countRes.rows[0]?.total ?? 0),
  };
}

/**
 * Cancel — only legal from 'scheduled' or 'queued' (see state machine).
 * The WHERE clause enforces the transition atomically: if the job was
 * claimed a millisecond ago by a worker, zero rows update and we return
 * null instead of corrupting a running job.
 */
export async function cancel(id: string): Promise<JobRow | null> {
  const res = await pool.query<JobRow>(
    `UPDATE jobs
        SET state = 'cancelled', finished_at = now()
      WHERE id = $1 AND state IN ('scheduled', 'queued')
      RETURNING *`,
    [id],
  );
  return res.rows[0] ?? null;
}

export interface JobExecutionRow {
  id: string;
  job_id: string;
  attempt: number;
  worker_id: string | null;
  state: string;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
  error_message: string | null;
  error_stack: string | null;
}

export async function executionsForJob(
  jobId: string,
): Promise<JobExecutionRow[]> {
  const res = await pool.query<JobExecutionRow>(
    "SELECT * FROM job_executions WHERE job_id = $1 ORDER BY attempt DESC",
    [jobId],
  );
  return res.rows;
}

export interface JobLogRow {
  id: string;
  job_id: string;
  execution_id: string | null;
  level: string;
  message: string;
  created_at: Date;
}

export async function logsForJob(
  jobId: string,
  limit = 200,
): Promise<JobLogRow[]> {
  const res = await pool.query<JobLogRow>(
    `SELECT * FROM job_logs WHERE job_id = $1
      ORDER BY created_at DESC LIMIT $2`,
    [jobId, limit],
  );
  return res.rows;
}

/** Workflow dependencies: record that jobId waits on each dep. */
export async function addDependencies(
  db: Queryable,
  jobId: string,
  dependsOn: string[],
): Promise<void> {
  for (const dep of dependsOn) {
    await db.query(
      `INSERT INTO job_dependencies (job_id, depends_on_job_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [jobId, dep],
    );
  }
}
