/**
 * Worker entry point.
 * M2 scope: boot skeleton with the poll-loop shape and graceful shutdown.
 * Real claiming/execution arrives in M6.
 */
import { createLogger } from "@jobs/core";
import { closePool } from "@jobs/db";

const log = createLogger("worker");

// Each worker instance gets a unique identity — later this is registered
// in the workers table and attached to every job it claims.
const workerId = `worker-${process.pid}-${Date.now().toString(36)}`;

let running = true;

async function pollLoop() {
  log.info({ workerId }, "worker started");
  while (running) {
    // M6 will: claim due jobs atomically, execute them, heartbeat.
    await sleep(2_000);
    log.debug({ workerId }, "poll tick (no-op until M6)");
  }
  // Loop exited => finish cleanup.
  await closePool();
  log.info({ workerId }, "worker stopped cleanly");
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Graceful shutdown: finish the current iteration, then exit the loop. */
function shutdown(signal: string) {
  log.info({ signal }, "shutdown requested — finishing current work");
  running = false;
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void pollLoop();
