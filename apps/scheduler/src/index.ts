/**
 * Scheduler process. Each tick (~1s):
 *  1. Promote due jobs: scheduled → queued (delayed jobs + retry backoffs).
 *  2. Materialize due cron schedules: spawn a job per occurrence and
 *     advance next_run_at.
 * All state lives in Postgres — if this process dies, jobs become late,
 * never lost. FOR UPDATE SKIP LOCKED makes multiple schedulers safe.
 */
import { config } from "@jobs/config";
import { createLogger } from "@jobs/core";
import { closePool, schedulerRepo } from "@jobs/db";

const log = createLogger("scheduler");

let running = true;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tickLoop(): Promise<void> {
  log.info({ tickMs: config.SCHEDULER_TICK_MS }, "scheduler started");
  while (running) {
    try {
      const promoted = await schedulerRepo.promoteDueJobs();
      const spawned = await schedulerRepo.materializeDueSchedules();
      const orphaned = await schedulerRepo.cancelOrphanedDependents();
      if (promoted > 0 || spawned > 0 || orphaned > 0) {
        log.info({ promoted, spawned, orphaned }, "tick");
      }
    } catch (err) {
      log.error({ err }, "tick failed - will retry next tick");
    }
    await sleep(config.SCHEDULER_TICK_MS);
  }
  await closePool();
  log.info("scheduler stopped cleanly");
  process.exit(0);
}

function shutdown(signal: string) {
  log.info({ signal }, "shutdown requested");
  running = false;
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await tickLoop();
