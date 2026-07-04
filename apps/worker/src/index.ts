/**
 * Worker process.
 *
 * Lifecycle:
 *  1. Register in the workers table (identity + capacity).
 *  2. Timers: heartbeat (liveness) and reaper (recover dead workers' jobs).
 *  3. Poll loop: while capacity is free, atomically claim due jobs and
 *     execute them concurrently (promises, capped by a semaphore counter).
 *  4. SIGINT/SIGTERM -> graceful drain: stop claiming, finish in-flight
 *     work (bounded by a timeout), mark offline, exit.
 *
 * Run several copies of this process to see "distributed" become real.
 */
import os from "node:os";
import { config } from "@jobs/config";
import { createLogger } from "@jobs/core";
import { closePool, jobExecRepo, listenForQueuedJobs, workersRepo } from "@jobs/db";
import { executeJob } from "./executor.js";

const log = createLogger("worker");

const worker = await workersRepo.register({
  name: `worker-${process.pid}-${Date.now().toString(36)}`,
  hostname: os.hostname(),
  pid: process.pid,
  maxConcurrency: config.WORKER_MAX_CONCURRENCY,
});
log.info(
  { workerId: worker.id, name: worker.name, maxConcurrency: worker.max_concurrency },
  "worker registered",
);

let running = true;
let active = 0; // semaphore counter: jobs currently in flight

// Heartbeat timer: "I'm alive" + utilization sample.
const heartbeatTimer = setInterval(() => {
  workersRepo
    .heartbeat(worker.id, active)
    .catch((err) => log.error({ err }, "heartbeat failed"));
}, config.WORKER_HEARTBEAT_INTERVAL_MS);

// Reaper timer (any worker may reap; all steps are idempotent).
const reaperTimer = setInterval(() => {
  workersRepo
    .reapStale(config.WORKER_STALE_TIMEOUT_MS)
    .then(({ staleWorkers, requeuedJobs }) => {
      if (staleWorkers > 0) {
        log.warn({ staleWorkers, requeuedJobs }, "reaped stale workers");
      }
    })
    .catch((err) => log.error({ err }, "reaper failed"));
}, 10000);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Event-driven wakeup (bonus): LISTEN notifications interrupt the idle
// sleep, so new jobs start in milliseconds. Polling remains the fallback.
let wake: (() => void) | null = null;
function interruptibleSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });
}
const unlisten = await listenForQueuedJobs(() => wake?.());
log.info("listening for job_queued notifications (event-driven wakeups on)");

async function pollLoop(): Promise<void> {
  while (running) {
    const free = config.WORKER_MAX_CONCURRENCY - active;
    if (free <= 0) {
      await sleep(100); // saturated - wait for a slot
      continue;
    }
    const jobs = await jobExecRepo
      .claimJobs(worker.id, free)
      .catch((err) => {
        log.error({ err }, "claim failed");
        return [];
      });

    for (const job of jobs) {
      active++;
      // Deliberately NOT awaited: jobs run concurrently. The semaphore
      // counter (active) caps how many we take on.
      void executeJob(job, worker.id, log)
        .catch((err) => {
          // A single job must NEVER crash the worker process. The job stays
          // claimed/running until the reaper recovers it.
          log.error({ err, jobId: job.id }, "executeJob threw unexpectedly");
        })
        .finally(() => {
          active--;
        });
    }

    // Adaptive polling: busy -> check again immediately; idle -> back off.
    if (jobs.length > 0) await sleep(50);
    else await interruptibleSleep(config.WORKER_POLL_INTERVAL_MS);
  }
}

async function shutdown(signal: string): Promise<void> {
  log.info({ signal, active }, "shutdown requested - draining");
  running = false;
  await workersRepo.setState(worker.id, "draining").catch(() => {});

  const deadline = Date.now() + config.WORKER_SHUTDOWN_TIMEOUT_MS;
  while (active > 0 && Date.now() < deadline) {
    await sleep(200);
  }
  if (active > 0) {
    log.warn({ active }, "shutdown timeout - abandoning in-flight jobs (reaper will requeue them)");
  }

  clearInterval(heartbeatTimer);
  clearInterval(reaperTimer);
  await unlisten().catch(() => {});
  await workersRepo.setState(worker.id, "offline").catch(() => {});
  await closePool();
  log.info("worker stopped cleanly");
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await pollLoop();
