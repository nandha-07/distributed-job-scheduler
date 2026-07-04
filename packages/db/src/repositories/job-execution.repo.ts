/**
 * Job execution lifecycle queries used by the worker:
 * claim → start → complete/fail, plus per-job logging.
 * THE most important SQL in the system lives here.
 */
import { pool } from "../pool.js";
import { withTransaction } from "../tx.js";
import type { JobRow, JobExecutionRow } from "./jobs.repo.js";

/**
 * Atomic claim — the heart of the scheduler.
 *
 * Three layers:
 *  1. `ranked` computes, per queue, each due job's rank and the queue's
 *     free slots (max_concurrency minus in-flight). Taking only rn <=
 *     free_slots enforces the cap even WITHIN one claim batch — a plain
 *     count check can't, because the subquery runs before this statement's
 *     own updates are visible (a bug our PGlite test caught).
 *  2. `eligible` orders across queues and applies the worker's batch limit.
 *  3. The UPDATE locks chosen rows with FOR UPDATE SKIP LOCKED: concurrent
 *     workers skip each other's locked rows and receive disjoint jobs.
 *     The final state='queued' guard re-checks after the lock is won.
 *
 * The cross-worker cap remains a soft limit (DD-010): two workers ranking
 * simultaneously see the same free_slots. Within a worker it is now exact.
 */
export async function claimJobs(
  workerId: string,
  limit: number,
): Promise<JobRow[]> {
  const res = await pool.query<JobRow>(
    `WITH ranked AS (
       SELECT j.id, j.priority, j.run_at, j.created_at,
              row_number() OVER (
                PARTITION BY j.queue_id
                ORDER BY j.priority DESC, j.run_at, j.created_at
              ) AS rn,
              q.max_concurrency - (
                SELECT count(*) FROM jobs r
                 WHERE r.queue_id = j.queue_id
                   AND r.state IN ('claimed', 'running')
              ) AS free_slots
         FROM jobs j
         JOIN queues q ON q.id = j.queue_id
        WHERE j.state = 'queued'
          AND j.run_at <= now()
          AND q.is_paused = false
     ),
     eligible AS (
       SELECT id FROM ranked
        WHERE rn <= free_slots
        ORDER BY priority DESC, run_at, created_at
        LIMIT $2
     )
     UPDATE jobs
        SET state = 'claimed', claimed_by = $1, claimed_at = now()
      WHERE id IN (
              SELECT j2.id FROM jobs j2
               WHERE j2.id IN (SELECT id FROM eligible)
               FOR UPDATE OF j2 SKIP LOCKED
            )
        AND state = 'queued'
      RETURNING *`,
    [workerId, limit],
  );
  return res.rows;
}

/**
 * claimed → running, attempts+1, and the execution history row — one
 * transaction. The WHERE state='claimed' guard means a job the reaper
 * just requeued cannot be started by a zombie worker.
 */
export async function startExecution(
  jobId: string,
  workerId: string,
): Promise<{ job: JobRow; execution: JobExecutionRow } | null> {
  return withTransaction(async (tx) => {
    const jobRes = await tx.query<JobRow>(
      `UPDATE jobs
          SET state = 'running', started_at = now(), attempts = attempts + 1
        WHERE id = $1 AND state = 'claimed'
        RETURNING *`,
      [jobId],
    );
    const job = jobRes.rows[0];
    if (!job) return null; // lost the job (reaper/cancel) — skip quietly

    // Execution 'attempt' is a HISTORICAL sequence (max+1), not jobs.attempts:
    // a DLQ retry resets the job's budget to 0 (DD-012), but execution rows
    // for attempts 1..N already exist — reusing numbers would violate
    // UNIQUE(job_id, attempt). Discovered live in M7 testing.
    const execRes = await tx.query<JobExecutionRow>(
      `INSERT INTO job_executions (job_id, attempt, worker_id, state)
       VALUES ($1,
               (SELECT COALESCE(MAX(attempt), 0) + 1
                  FROM job_executions WHERE job_id = $1),
               $2, 'running')
       RETURNING *`,
      [jobId, workerId],
    );
    const execution = execRes.rows[0];
    if (!execution) throw new Error("INSERT returned no row");
    return { job, execution };
  });
}

export async function completeJob(
  jobId: string,
  executionId: string,
): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE jobs SET state = 'completed', finished_at = now()
        WHERE id = $1 AND state = 'running'`,
      [jobId],
    );
    await tx.query(
      `UPDATE job_executions
          SET state = 'succeeded', finished_at = now(),
              duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int
        WHERE id = $1`,
      [executionId],
    );
  });
}

/**
 * Failure outcome — decided by the WORKER (which computed nextRunAt from
 * the job's retry snapshot), executed here atomically:
 *  - nextRunAt != null → back to 'scheduled' with run_at = nextRunAt
 *    (the scheduler will promote it when due) — an automatic retry.
 *  - nextRunAt == null → attempts exhausted → 'dead_letter' + DLQ entry.
 * Either way the execution row records the error.
 */
export async function failJob(params: {
  jobId: string;
  executionId: string;
  queueId: string;
  attemptsUsed: number;
  errorMessage: string;
  errorStack?: string;
  nextRunAt: Date | null;
}): Promise<void> {
  await withTransaction(async (tx) => {
    if (params.nextRunAt) {
      await tx.query(
        `UPDATE jobs
            SET state = 'scheduled', run_at = $2, last_error = $3,
                claimed_by = NULL, claimed_at = NULL
          WHERE id = $1 AND state = 'running'`,
        [params.jobId, params.nextRunAt, params.errorMessage],
      );
    } else {
      await tx.query(
        `UPDATE jobs
            SET state = 'dead_letter', finished_at = now(), last_error = $2,
                claimed_by = NULL, claimed_at = NULL
          WHERE id = $1 AND state = 'running'`,
        [params.jobId, params.errorMessage],
      );
      await tx.query(
        `INSERT INTO dead_letter_entries (job_id, queue_id, final_error, attempts_used)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (job_id) DO UPDATE
           SET final_error = $3, attempts_used = $4, moved_at = now(),
               retried_at = NULL, retried_by = NULL`,
        [params.jobId, params.queueId, params.errorMessage, params.attemptsUsed],
      );
    }
    await tx.query(
      `UPDATE job_executions
          SET state = 'failed', finished_at = now(), error_message = $2,
              error_stack = $3,
              duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int
        WHERE id = $1`,
      [params.executionId, params.errorMessage, params.errorStack ?? null],
    );
  });
}

/** Handlers log through this — visible later in the dashboard's log viewer. */
export async function appendLog(params: {
  jobId: string;
  executionId?: string;
  level?: "debug" | "info" | "warn" | "error";
  message: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO job_logs (job_id, execution_id, level, message)
     VALUES ($1, $2, $3, $4)`,
    [
      params.jobId,
      params.executionId ?? null,
      params.level ?? "info",
      params.message,
    ],
  );
}
