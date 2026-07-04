# REST API Design

Base URL: `/api/v1` (versioned so breaking changes ship as /v2 without
stranding existing clients).

## Conventions

- **Resources are plural nouns**; HTTP methods carry the verb:
  `GET /queues` list, `POST /queues` create, `GET /queues/:id` fetch,
  `PATCH /queues/:id` partial update, `DELETE /queues/:id` remove.
  Non-CRUD actions are sub-resources: `POST /queues/:id/pause`.
- **Auth**: `Authorization: Bearer <JWT>` on every route except
  register/login/health. 401 = missing/invalid token, 403 = valid token
  but insufficient rights.
- **Validation**: every body/query validated with Zod before any logic
  runs; failures return 400 with per-field details.
- **Error envelope** (uniform across the whole API):
  ```json
  { "error": { "code": "EMAIL_TAKEN", "message": "...", "details": [] } }
  ```
  `code` is machine-readable (stable), `message` is human-readable.
- **Status codes**: 200 ok, 201 created, 204 deleted-no-body, 400 bad
  input, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict,
  500 unexpected (never leaks internals; correlated via request id).
- **Pagination** (list endpoints): `?limit=25&offset=0`, response includes
  `{ data, pagination: { total, limit, offset } }`. Limit capped at 100.
- **Request IDs**: every response carries `X-Request-Id`; the same id
  appears in every log line for that request — this is how you trace one
  failing call through the logs.

## Endpoints — Part A (authentication)

| Method & path | Auth | Body | Success | Errors |
|---|---|---|---|---|
| POST /api/v1/auth/register | — | email, password (≥8), name | 201 `{user, token}` | 400 invalid, 409 email taken |
| POST /api/v1/auth/login | — | email, password | 200 `{user, token}` | 400, 401 bad credentials |
| GET /api/v1/me | ✅ | — | 200 `{user}` | 401 |

Registration also creates the user's personal organization and an `owner`
membership — atomically, in one transaction.

Login failure is deliberately vague ("invalid email or password") — never
reveal whether the email exists (prevents account enumeration).

## Endpoints — Part B (projects, queues, retry policies) — implemented next

| Method & path | Purpose |
|---|---|
| POST /api/v1/projects · GET /api/v1/projects | create / list (paginated) |
| GET/PATCH/DELETE /api/v1/projects/:id | fetch / update / delete |
| POST/GET /api/v1/projects/:projectId/queues | create / list queues |
| GET/PATCH/DELETE /api/v1/queues/:id | fetch / update / delete |
| POST /api/v1/queues/:id/pause · /resume | pause / resume consumption |
| GET /api/v1/queues/:id/stats | depth, throughput, failure rate |
| POST/GET /api/v1/projects/:projectId/retry-policies | create / list |

Authorization rule for every Part B route: requester must be a member of
the organization that (transitively) owns the resource.

## Endpoints — M5 (jobs, schedules, batches)

| Method & path | Purpose |
|---|---|
| POST /queues/:queueId/jobs | create job — immediate (default), delayed (`delaySeconds`), or scheduled (`runAt` ISO). Optional `idempotencyKey`, `retryPolicyId`, `priority`, `payload` |
| GET /queues/:queueId/jobs?state=&name=&limit=&offset= | job explorer with filters |
| POST /queues/:queueId/jobs/batch | create N jobs atomically (≤1000), linked to a batch |
| GET /jobs/:id | job detail + execution history + logs |
| POST /jobs/:id/cancel | cancel; 409 unless state is scheduled/queued |
| GET /batches/:id | batch + progress (job counts by state) |
| POST /queues/:queueId/schedules | create cron template; validates expression & timezone; precomputes next_run_at |
| GET /queues/:queueId/schedules | list schedules |
| PATCH /schedules/:id | `{isActive}` activate/deactivate |
| DELETE /schedules/:id | remove schedule |

Idempotency contract: same `idempotencyKey` on the same queue returns the
original job with `deduplicated: true` and status 200 (not 201). Clients can
therefore retry job creation blindly after network failures.

## Endpoints — M7 (DLQ)

| Method & path | Purpose |
|---|---|
| GET /queues/:queueId/dlq?limit=&offset= | browse dead-lettered jobs (error, attempts, payload) |
| POST /jobs/:id/retry | manual retry from DLQ: attempts reset to 0, job re-queued; 409 if job is not dead-lettered |
