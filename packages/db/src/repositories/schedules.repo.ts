/**
 * Schedules repository — recurring (cron) job templates.
 */
import { pool } from "../pool.js";

export interface ScheduleRow {
  id: string;
  queue_id: string;
  name: string;
  cron_expression: string;
  timezone: string;
  job_name: string;
  payload: unknown;
  is_active: boolean;
  next_run_at: Date | null;
  last_enqueued_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function create(params: {
  queueId: string;
  name: string;
  cronExpression: string;
  timezone: string;
  jobName: string;
  payload?: unknown;
  nextRunAt: Date;
}): Promise<ScheduleRow> {
  const res = await pool.query<ScheduleRow>(
    `INSERT INTO schedules
       (queue_id, name, cron_expression, timezone, job_name, payload, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      params.queueId,
      params.name,
      params.cronExpression,
      params.timezone,
      params.jobName,
      JSON.stringify(params.payload ?? {}),
      params.nextRunAt,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error("INSERT returned no row");
  return row;
}

export async function findById(id: string): Promise<ScheduleRow | null> {
  const res = await pool.query<ScheduleRow>(
    "SELECT * FROM schedules WHERE id = $1",
    [id],
  );
  return res.rows[0] ?? null;
}

export async function listByQueue(queueId: string): Promise<ScheduleRow[]> {
  const res = await pool.query<ScheduleRow>(
    "SELECT * FROM schedules WHERE queue_id = $1 ORDER BY created_at",
    [queueId],
  );
  return res.rows;
}

export async function setActive(
  id: string,
  isActive: boolean,
): Promise<ScheduleRow | null> {
  const res = await pool.query<ScheduleRow>(
    "UPDATE schedules SET is_active = $2 WHERE id = $1 RETURNING *",
    [id, isActive],
  );
  return res.rows[0] ?? null;
}

export async function remove(id: string): Promise<boolean> {
  const res = await pool.query("DELETE FROM schedules WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}
