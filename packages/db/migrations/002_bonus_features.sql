-- 002_bonus_features.sql
-- Bonus features: rate limiting, workflow dependencies, event-driven wakeups.

-- Per-queue rate limit (claims per second). NULL = unlimited.
ALTER TABLE queues ADD COLUMN rate_limit_per_sec integer
  CHECK (rate_limit_per_sec IS NULL OR rate_limit_per_sec >= 1);

-- Workflow dependencies: job_id may not run until every depends_on_job_id
-- has completed. Composite PK prevents duplicate edges.
CREATE TABLE job_dependencies (
  job_id            uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  depends_on_job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, depends_on_job_id)
);
-- Reverse lookup: "which jobs are waiting on me?"
CREATE INDEX job_dependencies_reverse_idx ON job_dependencies (depends_on_job_id);

-- Event-driven execution: whenever a job becomes runnable, notify listeners.
-- Workers LISTEN on this channel and wake instantly instead of waiting for
-- the next poll tick. Polling remains as the fallback (hybrid model).
CREATE OR REPLACE FUNCTION notify_job_queued() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('job_queued', NEW.queue_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_notify_queued
  AFTER INSERT OR UPDATE OF state ON jobs
  FOR EACH ROW WHEN (NEW.state = 'queued')
  EXECUTE FUNCTION notify_job_queued();
