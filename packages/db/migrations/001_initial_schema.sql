-- 001_initial_schema.sql
-- Full initial schema. Rationale: docs/03-database.md
-- Conventions: uuid PKs (bigserial for append-only internals),
-- timestamptz everywhere, TEXT+CHECK for states, snake_case names.

-- ─────────────────────────────── helpers ──────────────────────────────

-- Auto-maintain updated_at on any table that has the column.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────── identity ─────────────────────────────

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL, -- bcrypt hash; plaintext never stored
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness: A@x.com and a@x.com are the same account.
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Composite PK: the (org, user) pair IS the identity of a membership.
CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner', 'admin', 'member')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
-- PK covers lookups by org; this covers "orgs for a user".
CREATE INDEX organization_members_user_idx ON organization_members (user_id);

CREATE TABLE projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

-- ─────────────────────────── queue configuration ──────────────────────

CREATE TABLE retry_policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name              text NOT NULL,
  strategy          text NOT NULL
                    CHECK (strategy IN ('fixed', 'linear', 'exponential')),
  max_attempts      integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
  base_delay_ms     integer NOT NULL CHECK (base_delay_ms >= 0),
  max_delay_ms      integer NOT NULL,
  jitter            boolean NOT NULL DEFAULT true, -- randomize delays to avoid thundering herds
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name),
  CHECK (max_delay_ms >= base_delay_ms)
);

CREATE TABLE queues (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  description             text,
  priority                integer NOT NULL DEFAULT 0, -- scheduling weight between queues
  max_concurrency         integer NOT NULL DEFAULT 10 CHECK (max_concurrency >= 1),
  is_paused               boolean NOT NULL DEFAULT false,
  default_retry_policy_id uuid REFERENCES retry_policies(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

-- ────────────────────────────── workers ───────────────────────────────

CREATE TABLE workers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL, -- e.g. worker-12345-abc
  hostname          text NOT NULL,
  pid               integer,
  state             text NOT NULL DEFAULT 'online'
                    CHECK (state IN ('online', 'draining', 'offline', 'stale')),
  max_concurrency   integer NOT NULL DEFAULT 10,
  started_at        timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  stopped_at        timestamptz
);
-- Reaper scan: "who hasn't heartbeated recently?" — only live workers matter.
CREATE INDEX workers_heartbeat_idx ON workers (last_heartbeat_at)
  WHERE state IN ('online', 'draining');

-- Append-only history (bigserial by design — see docs §3).
CREATE TABLE worker_heartbeats (
  id           bigserial PRIMARY KEY,
  worker_id    uuid NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  active_jobs  integer NOT NULL DEFAULT 0,
  cpu_percent  real,
  memory_mb    real
);
CREATE INDEX worker_heartbeats_worker_time_idx
  ON worker_heartbeats (worker_id, recorded_at DESC);

-- ───────────────────────── scheduling templates ───────────────────────

-- Recurring (cron) definitions. Each due occurrence SPAWNS a row in jobs.
CREATE TABLE schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id         uuid NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  name             text NOT NULL,
  cron_expression  text NOT NULL, -- validated at the API layer
  timezone         text NOT NULL DEFAULT 'UTC',
  job_name         text NOT NULL,          -- handler to invoke
  payload          jsonb NOT NULL DEFAULT '{}',
  is_active        boolean NOT NULL DEFAULT true,
  next_run_at      timestamptz,            -- precomputed next occurrence
  last_enqueued_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_id, name)
);
CREATE INDEX schedules_due_idx ON schedules (next_run_at) WHERE is_active;

CREATE TABLE batches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────── THE jobs table ──────────────────────────

CREATE TABLE jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id            uuid NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  schedule_id         uuid REFERENCES schedules(id) ON DELETE SET NULL,
  batch_id            uuid REFERENCES batches(id) ON DELETE SET NULL,
  name                text NOT NULL,               -- handler name, e.g. send-email
  payload             jsonb NOT NULL DEFAULT '{}',
  state               text NOT NULL DEFAULT 'queued'
                      CHECK (state IN ('scheduled', 'queued', 'claimed', 'running',
                                       'completed', 'failed', 'dead_letter', 'cancelled')),
  priority            integer NOT NULL DEFAULT 0,  -- higher runs first
  run_at              timestamptz NOT NULL DEFAULT now(), -- eligibility time

  -- Retry policy SNAPSHOT (copied at creation — docs §4)
  attempts            integer NOT NULL DEFAULT 0,
  max_attempts        integer NOT NULL DEFAULT 1 CHECK (max_attempts >= 1),
  retry_strategy      text NOT NULL DEFAULT 'exponential'
                      CHECK (retry_strategy IN ('fixed', 'linear', 'exponential')),
  retry_base_delay_ms integer NOT NULL DEFAULT 1000,
  retry_max_delay_ms  integer NOT NULL DEFAULT 60000,

  idempotency_key     text,                        -- client-supplied dedup key
  claimed_by          uuid REFERENCES workers(id) ON DELETE SET NULL,
  claimed_at          timestamptz,
  started_at          timestamptz,
  finished_at         timestamptz,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- The claim path (hottest query in the system) — partial + composite:
CREATE INDEX jobs_claim_idx ON jobs (queue_id, priority DESC, run_at)
  WHERE state = 'queued';
-- Scheduler promotion: which delayed jobs are due?
CREATE INDEX jobs_promote_idx ON jobs (run_at) WHERE state = 'scheduled';
-- Dashboard counts / filters:
CREATE INDEX jobs_queue_state_idx ON jobs (queue_id, state);
-- Job explorer default listing:
CREATE INDEX jobs_list_idx ON jobs (queue_id, created_at DESC);
-- Reaper: jobs held by a given (possibly dead) worker:
CREATE INDEX jobs_claimed_by_idx ON jobs (claimed_by)
  WHERE state IN ('claimed', 'running');
-- Batch progress:
CREATE INDEX jobs_batch_idx ON jobs (batch_id) WHERE batch_id IS NOT NULL;
-- Duplicate-submission protection (unique only where a key was provided):
CREATE UNIQUE INDEX jobs_idempotency_idx ON jobs (queue_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ───────────────────────── execution history ──────────────────────────

CREATE TABLE job_executions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt       integer NOT NULL CHECK (attempt >= 1),
  worker_id     uuid REFERENCES workers(id) ON DELETE SET NULL,
  state         text NOT NULL DEFAULT 'running'
                CHECK (state IN ('running', 'succeeded', 'failed', 'timed_out', 'lost')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  duration_ms   integer,
  error_message text,
  error_stack   text,
  UNIQUE (job_id, attempt) -- one row per attempt, enforced
);
CREATE INDEX job_executions_job_idx ON job_executions (job_id, attempt DESC);
CREATE INDEX job_executions_worker_idx ON job_executions (worker_id, started_at DESC);

-- Append-only log lines (bigserial by design).
CREATE TABLE job_logs (
  id           bigserial PRIMARY KEY,
  job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  execution_id uuid REFERENCES job_executions(id) ON DELETE CASCADE,
  level        text NOT NULL DEFAULT 'info'
               CHECK (level IN ('debug', 'info', 'warn', 'error')),
  message      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_logs_job_idx ON job_logs (job_id, created_at);

CREATE TABLE dead_letter_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  queue_id       uuid NOT NULL REFERENCES queues(id) ON DELETE CASCADE, -- denormalized for DLQ browser
  final_error    text,
  attempts_used  integer NOT NULL,
  moved_at       timestamptz NOT NULL DEFAULT now(),
  retried_at     timestamptz,          -- set when manually re-queued
  retried_by     uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX dead_letter_entries_queue_idx ON dead_letter_entries (queue_id, moved_at DESC);

-- ─────────────────────── updated_at triggers ──────────────────────────

CREATE TRIGGER users_updated_at          BEFORE UPDATE ON users          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER organizations_updated_at  BEFORE UPDATE ON organizations  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER projects_updated_at       BEFORE UPDATE ON projects       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER retry_policies_updated_at BEFORE UPDATE ON retry_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER queues_updated_at         BEFORE UPDATE ON queues         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER schedules_updated_at      BEFORE UPDATE ON schedules      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER jobs_updated_at           BEFORE UPDATE ON jobs           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
