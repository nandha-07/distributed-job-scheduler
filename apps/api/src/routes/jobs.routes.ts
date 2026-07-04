/**
 * Job / schedule / batch routes (all authenticated).
 */
import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import * as jobs from "../controllers/jobs.controller.js";
import * as schedules from "../controllers/schedules.controller.js";

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

// Jobs (created/listed under their queue; inspected by their own id)
jobsRouter.post("/queues/:queueId/jobs", validate(jobs.createJobSchema), asyncHandler(jobs.create));
jobsRouter.get("/queues/:queueId/jobs", asyncHandler(jobs.list));
jobsRouter.post("/queues/:queueId/jobs/batch", validate(jobs.createBatchSchema), asyncHandler(jobs.createBatch));
jobsRouter.get("/jobs/:id", asyncHandler(jobs.get));
jobsRouter.post("/jobs/:id/cancel", asyncHandler(jobs.cancel));
jobsRouter.get("/batches/:id", asyncHandler(jobs.getBatch));

// Dead Letter Queue
jobsRouter.get("/queues/:queueId/dlq", asyncHandler(jobs.listDlq));
jobsRouter.post("/jobs/:id/retry", asyncHandler(jobs.retryFromDlq));

// Recurring schedules (cron templates)
jobsRouter.post("/queues/:queueId/schedules", validate(schedules.createScheduleSchema), asyncHandler(schedules.create));
jobsRouter.get("/queues/:queueId/schedules", asyncHandler(schedules.list));
jobsRouter.patch("/schedules/:id", validate(schedules.setActiveSchema), asyncHandler(schedules.setActive));
jobsRouter.delete("/schedules/:id", asyncHandler(schedules.remove));
