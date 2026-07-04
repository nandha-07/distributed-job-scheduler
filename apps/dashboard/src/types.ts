/** Shapes returned by the API (subset the dashboard needs). */
export interface Project { id: string; name: string }
export interface Queue {
  id: string; name: string; priority: number; max_concurrency: number;
  is_paused: boolean;
}
export interface QueueStats {
  byState: Record<string, number>;
  completedLastHour: number;
  failedLastHour: number;
}
export interface Job {
  id: string; name: string; state: string; priority: number; attempts: number;
  max_attempts: number; run_at: string; created_at: string;
  last_error: string | null; payload: unknown;
}
export interface JobExecution {
  id: string; attempt: number; state: string; started_at: string;
  finished_at: string | null; duration_ms: number | null;
  error_message: string | null;
}
export interface JobLog { id: string; level: string; message: string; created_at: string }
export interface Worker {
  id: string; name: string; state: string; max_concurrency: number;
  last_heartbeat_at: string; started_at: string;
}
export interface DlqEntry {
  id: string; job_id: string; job_name: string; final_error: string | null;
  attempts_used: number; moved_at: string; retried_at: string | null;
}
export interface Schedule {
  id: string; name: string; cron_expression: string; timezone: string;
  job_name: string; is_active: boolean; next_run_at: string | null;
}
export interface Paginated<T> { data: T[]; pagination: { total: number } }
