/**
 * Scheduler-process queries: promotion of due jobs and cron
 * materialization. Runs every tick (~1s).
 */
import { pool } from "../pool.js";
import { withTransaction } from "../tx.js";
import { nextCronRun } from "@jobs/core";
import * as jobsRepo from "./jobs.repo.js";
import type { ScheduleRow } from "./schedules.repo.js";
import type { RetryPolicyRow } from "./retry-policies.repo.js";

/** scheduled → queued for every job whose time has come. O(due) via partial index. */
export async function promoteDueJobs(): Promise<number> {
  const res = await pool.query(
    `UPDATE jobs SET state = 'queued'
      WHERE state = 'scheduled' AND run_at <= now()`,
  );
  return res.rowCount ?? 0;
}

/**
 * A job whose dependency dead-lettered or was cancelled can never run —
 * cancel it explicitly instead of leaving it invisible forever.
 */
export async function cancelOrphanedDependents(): Promise<number> {
  const res = await pool.query(
    `UPDATE jobs SET state = 'cancelled', finished_at = now(),
            last_error = 'cancelled: a dependency failed permanently'
      WHERE state IN ('queued', 'scheduled')
        AND EXISTS (
          SELECT 1 FROM job_dependencies d
            JOIN jobs dj ON dj.id = d.depends_on_job_id
           WHERE d.job_id = jobs.id
             AND dj.state IN ('dead_letter', 'cancelled')
        )`,
  );
  return res.rowCount ?? 0;
}

const DEFAULT_RETRY = {
  maxAttempts: 3,
  retryStrategy: "exponential" as const,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 60_000,
};

/**
 * For each due active schedule: spawn one job for this occurrence and
 * advance next_run_at to the following occurrence. FOR UPDATE SKIP LOCKED
 * means even multiple scheduler processes could never double-fire an
 * occurrence. One transaction covers select+spawn+advance.
 */
export async function materializeDueSchedules(limit = 20): Promise<number> {
  return withTransaction(async (tx) => {
    const due = await tx.query<ScheduleRow & { default_retry_policy_id: string | null }>(
      `SELECT s.*, q.default_retry_policy_id
         FROM schedules s
         JOIN queues q ON q.id = s.queue_id
        WHERE s.is_active AND s.next_run_at <= now()
        ORDER BY s.next_run_at
        LIMIT $1
        FOR UPDATE OF s SKIP LOCKED`,
      [limit],
    );

    for (const sched of due.rows) {
      // Retry snapshot: queue's default policy, else system default.
      let retry: {
        maxAttempts: number;
        retryStrategy: "fixed" | "linear" | "exponential";
        retryBaseDelayMs: number;
        retryMaxDelayMs: number;
      } = DEFAULT_RETRY;
      if (sched.default_retry_policy_id) {
        const p = await tx.query<RetryPolicyRow>(
          "SELECT * FROM retry_policies WHERE id = $1",
          [sched.default_retry_policy_id],
        );
        const policy = p.rows[0];
        if (policy) {
          retry = {
            maxAttempts: policy.max_attempts,
            retryStrategy: policy.strategy,
            retryBaseDelayMs: policy.base_delay_ms,
            retryMaxDelayMs: policy.max_delay_ms,
          };
        }
      }

      await jobsRepo.create(tx, {
        queueId: sched.queue_id,
        name: sched.job_name,
        payload: sched.payload,
        state: "queued",
        scheduleId: sched.id,
        ...retry,
      });

      await tx.query(
        `UPDATE schedules
            SET next_run_at = $2, last_enqueued_at = now()
          WHERE id = $1`,
        [sched.id, nextCronRun(sched.cron_expression, sched.timezone)],
      );
    }
    return due.rows.length;
  });
}
