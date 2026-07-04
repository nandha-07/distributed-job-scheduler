/**
 * Dead Letter Queue repository.
 */
import { pool } from "../pool.js";
import { withTransaction } from "../tx.js";
import type { JobRow } from "./jobs.repo.js";

export interface DlqEntryRow {
  id: string;
  job_id: string;
  queue_id: string;
  final_error: string | null;
  attempts_used: number;
  moved_at: Date;
  retried_at: Date | null;
  retried_by: string | null;
  // joined from jobs for the browser:
  job_name: string;
  payload: unknown;
}

export async function listByQueue(
  queueId: string,
  limit: number,
  offset: number,
): Promise<{ rows: DlqEntryRow[]; total: number }> {
  const [rows, count] = await Promise.all([
    pool.query<DlqEntryRow>(
      `SELECT d.*, j.name AS job_name, j.payload
         FROM dead_letter_entries d
         JOIN jobs j ON j.id = d.job_id
        WHERE d.queue_id = $1
        ORDER BY d.moved_at DESC
        LIMIT $2 OFFSET $3`,
      [queueId, limit, offset],
    ),
    pool.query<{ total: string }>(
      "SELECT count(*) AS total FROM dead_letter_entries WHERE queue_id = $1",
      [queueId],
    ),
  ]);
  return { rows: rows.rows, total: Number(count.rows[0]?.total ?? 0) };
}

/**
 * Manual retry from the DLQ: fresh attempt budget (a human presumably
 * fixed the cause — DD-012), back to 'queued', entry marked retried.
 */
export async function retryFromDlq(
  jobId: string,
  retriedBy: string,
): Promise<JobRow | null> {
  return withTransaction(async (tx) => {
    const res = await tx.query<JobRow>(
      `UPDATE jobs
          SET state = 'queued', attempts = 0, last_error = NULL,
              finished_at = NULL, run_at = now()
        WHERE id = $1 AND state = 'dead_letter'
        RETURNING *`,
      [jobId],
    );
    const job = res.rows[0];
    if (!job) return null; // not in DLQ (already retried, or wrong id)
    await tx.query(
      `UPDATE dead_letter_entries
          SET retried_at = now(), retried_by = $2
        WHERE job_id = $1`,
      [jobId, retriedBy],
    );
    return job;
  });
}
