/**
 * Scheduler entry point.
 * M2 scope: boot skeleton with tick-loop shape and graceful shutdown.
 * M7 will make each tick promote due delayed jobs and materialize cron runs.
 */
import { createLogger } from "@jobs/core";
import { closePool } from "@jobs/db";

const log = createLogger("scheduler");

let running = true;

async function tickLoop() {
  log.info("scheduler started");
  while (running) {
    // M7 will: UPDATE due scheduled jobs -> queued; compute next cron runs.
    await sleep(1_000);
    log.debug("tick (no-op until M7)");
  }
  await closePool();
  log.info("scheduler stopped cleanly");
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown(signal: string) {
  log.info({ signal }, "shutdown requested");
  running = false;
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void tickLoop();
