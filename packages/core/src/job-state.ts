/**
 * The job lifecycle state machine (see docs/01-architecture.md §5).
 *
 * Kept as pure data + pure functions: no I/O, no framework imports.
 * The database, API, and workers all derive their behavior from this
 * single definition, so an invalid transition is impossible to introduce
 * in one place without the type checker complaining everywhere.
 */

export const JOB_STATES = [
  "scheduled", // waiting for its run-at time (delayed / cron occurrence)
  "queued", // runnable now, waiting for a worker
  "claimed", // atomically claimed by exactly one worker, not yet started
  "running", // handler executing
  "completed", // terminal: success
  "failed", // handler threw; may still be retried
  "dead_letter", // terminal: retries exhausted, parked for inspection
  "cancelled", // terminal: cancelled by a user before execution
] as const;

export type JobState = (typeof JOB_STATES)[number];

/** Legal transitions. Anything not listed here is a bug. */
const TRANSITIONS: Record<JobState, readonly JobState[]> = {
  scheduled: ["queued", "cancelled"],
  queued: ["claimed", "cancelled"],
  claimed: ["running", "queued" /* stale-worker reclaim */],
  running: ["completed", "failed", "queued" /* stale-worker reclaim */],
  failed: ["scheduled" /* retry with backoff */, "dead_letter"],
  completed: [],
  dead_letter: ["queued" /* manual retry from dashboard */],
  cancelled: [],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

export const TERMINAL_STATES: readonly JobState[] = [
  "completed",
  "cancelled",
];
