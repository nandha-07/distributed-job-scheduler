/**
 * Event-driven wakeups: hold a dedicated connection with LISTEN so callers
 * are notified the instant a job becomes queued (see the pg_notify trigger
 * in migration 002). Returns an unsubscribe function.
 */
import { pool } from "./pool.js";

export async function listenForQueuedJobs(
  onNotify: (queueId: string) => void,
): Promise<() => Promise<void>> {
  const client = await pool.connect();
  client.on("notification", (msg) => {
    if (msg.channel === "job_queued") onNotify(msg.payload ?? "");
  });
  await client.query("LISTEN job_queued");
  return async () => {
    await client.query("UNLISTEN job_queued").catch(() => {});
    client.release();
  };
}
