/**
 * Executes one claimed job through its full lifecycle:
 * claimed → running (+execution row) → completed | retry-scheduled | dead_letter.
 * Never throws — every outcome is recorded in the database.
 */
import { jobExecRepo } from "@jobs/db";
import type { JobRow } from "@jobs/db";
import { computeRetryDelayMs } from "@jobs/core";
import type { Logger } from "@jobs/core";
import { getHandler } from "./handlers.js";

export async function executeJob(
  job: JobRow,
  workerId: string,
  log: Logger,
): Promise<void> {
  const started = await jobExecRepo.startExecution(job.id, workerId);
  if (!started) {
    // Job was cancelled or reaped between claim and start — that's fine.
    log.warn({ jobId: job.id }, "job no longer claimable, skipping");
    return;
  }
  const { job: runningJob, execution } = started;
  const jobLog = (message: string, level?: "debug" | "info" | "warn" | "error") =>
    jobExecRepo.appendLog({
      jobId: job.id,
      executionId: execution.id,
      level,
      message,
    });

  const handler = getHandler(job.name);
  try {
    if (!handler) {
      throw new Error(`No handler registered for job name '${job.name}'`);
    }
    await handler((runningJob.payload ?? {}) as Record<string, unknown>, {
      jobId: job.id,
      attempt: runningJob.attempts,
      log: jobLog,
    });
    await jobExecRepo.completeJob(job.id, execution.id);
    log.info(
      { jobId: job.id, name: job.name, attempt: runningJob.attempts },
      "job completed",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    // Retry decision: attempts was already incremented for THIS run.
    const retriesLeft = runningJob.attempts < runningJob.max_attempts;
    const delayMs = retriesLeft
      ? computeRetryDelayMs({
          strategy: runningJob.retry_strategy,
          attempt: runningJob.attempts,
          baseDelayMs: runningJob.retry_base_delay_ms,
          maxDelayMs: runningJob.retry_max_delay_ms,
        })
      : null;

    await jobExecRepo.failJob({
      jobId: job.id,
      executionId: execution.id,
      queueId: job.queue_id,
      attemptsUsed: runningJob.attempts,
      errorMessage: message,
      errorStack: stack,
      nextRunAt: delayMs !== null ? new Date(Date.now() + delayMs) : null,
    });

    if (delayMs !== null) {
      log.warn(
        { jobId: job.id, name: job.name, attempt: runningJob.attempts, retryInMs: delayMs, err: message },
        "job failed - retry scheduled",
      );
    } else {
      log.error(
        { jobId: job.id, name: job.name, attempts: runningJob.attempts, err: message },
        "job failed permanently - moved to dead letter queue",
      );
    }
  }
}
