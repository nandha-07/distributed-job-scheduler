/**
 * Executes one claimed job through its full lifecycle:
 * claimed → running (+execution row) → completed | failed.
 * Never throws — every outcome is recorded in the database.
 */
import { jobExecRepo } from "@jobs/db";
import type { JobRow } from "@jobs/db";
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
    await jobExecRepo.failJob(job.id, execution.id, message, stack);
    log.warn(
      { jobId: job.id, name: job.name, attempt: runningJob.attempts, err: message },
      "job failed",
    );
  }
}
