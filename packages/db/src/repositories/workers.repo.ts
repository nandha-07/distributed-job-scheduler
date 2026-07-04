/**
 * Workers repository: registration, liveness (heartbeats), reaping.
 */
import { pool } from "../pool.js";

export interface WorkerRow {
  id: string;
  name: string;
  hostname: string;
  pid: number | null;
  state: "online" | "draining" | "offline" | "stale";
  max_concurrency: number;
  started_at: Date;
  last_heartbeat_at: Date;
  stopped_at: Date | null;
}

export async function register(params: {
  name: string;
  hostname: string;
  pid: number;
  maxConcurrency: number;
}): Promise<WorkerRow> {
  const res = await pool.query<WorkerRow>(
    `INSERT INTO workers (name, hostname, pid, max_concurrency)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [params.name, params.hostname, params.pid, params.maxConcurrency],
  );
  const row = res.rows[0];
  if (!row) throw new Error("INSERT returned no row");
  return row;
}

/** "I'm alive": bump liveness + append a history sample with metrics. */
export async function heartbeat(
  workerId: string,
  activeJobs: number,
): Promise<void> {
  await pool.query(
    "UPDATE workers SET last_heartbeat_at = now() WHERE id = $1",
    [workerId],
  );
  const mem = process.memoryUsage().rss / (1024 * 1024);
  await pool.query(
    `INSERT INTO worker_heartbeats (worker_id, active_jobs, memory_mb)
     VALUES ($1, $2, $3)`,
    [workerId, activeJobs, Math.round(mem * 10) / 10],
  );
}

export async function setState(
  workerId: string,
  state: WorkerRow["state"],
): Promise<void> {
  await pool.query(
    `UPDATE workers
        SET state = $2,
            stopped_at = CASE WHEN $2 = 'offline' THEN now() ELSE stopped_at END
      WHERE id = $1`,
    [workerId, state],
  );
}

export async function list(): Promise<WorkerRow[]> {
  const res = await pool.query<WorkerRow>(
    "SELECT * FROM workers ORDER BY started_at DESC",
  );
  return res.rows;
}

/**
 * The reaper: mark silent workers stale and recover their jobs.
 * Steps (each idempotent, so multiple workers reaping concurrently is safe):
 *  1. workers silent longer than timeout → state 'stale'
 *  2. their running executions → 'lost'
 *  3. their claimed/running jobs → back to 'queued' for someone else
 */
export async function reapStale(
  timeoutMs: number,
): Promise<{ staleWorkers: number; requeuedJobs: number }> {
  const stale = await pool.query<{ id: string }>(
    `UPDATE workers SET state = 'stale'
      WHERE state IN ('online', 'draining')
        AND last_heartbeat_at < now() - make_interval(secs => $1)
      RETURNING id`,
    [timeoutMs / 1000],
  );
  const ids = stale.rows.map((r) => r.id);
  if (ids.length === 0) return { staleWorkers: 0, requeuedJobs: 0 };

  await pool.query(
    `UPDATE job_executions SET state = 'lost', finished_at = now()
      WHERE worker_id = ANY($1) AND state = 'running'`,
    [ids],
  );
  const requeued = await pool.query(
    `UPDATE jobs
        SET state = 'queued', claimed_by = NULL, claimed_at = NULL
      WHERE claimed_by = ANY($1) AND state IN ('claimed', 'running')`,
    [ids],
  );
  return { staleWorkers: ids.length, requeuedJobs: requeued.rowCount ?? 0 };
}
