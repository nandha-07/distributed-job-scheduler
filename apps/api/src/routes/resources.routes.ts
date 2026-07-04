/**
 * Projects / queues / retry-policies routes.
 * Every route here requires authentication (mounted behind requireAuth).
 */
import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import * as projects from "../controllers/projects.controller.js";
import * as queues from "../controllers/queues.controller.js";
import * as retryPolicies from "../controllers/retry-policies.controller.js";
import { workersRepo } from "@jobs/db";

export const resourcesRouter = Router();
resourcesRouter.use(requireAuth);

// Projects
resourcesRouter.post("/projects", validate(projects.createProjectSchema), asyncHandler(projects.create));
resourcesRouter.get("/projects", asyncHandler(projects.list));
resourcesRouter.get("/projects/:id", asyncHandler(projects.get));
resourcesRouter.patch("/projects/:id", validate(projects.updateProjectSchema), asyncHandler(projects.update));
resourcesRouter.delete("/projects/:id", asyncHandler(projects.remove));

// Queues (created/listed under their project; managed by their own id)
resourcesRouter.post("/projects/:projectId/queues", validate(queues.createQueueSchema), asyncHandler(queues.create));
resourcesRouter.get("/projects/:projectId/queues", asyncHandler(queues.list));
resourcesRouter.get("/queues/:id", asyncHandler(queues.get));
resourcesRouter.patch("/queues/:id", validate(queues.updateQueueSchema), asyncHandler(queues.update));
resourcesRouter.delete("/queues/:id", asyncHandler(queues.remove));
resourcesRouter.post("/queues/:id/pause", asyncHandler(queues.pause));
resourcesRouter.post("/queues/:id/resume", asyncHandler(queues.resume));
resourcesRouter.get("/queues/:id/stats", asyncHandler(queues.stats));
resourcesRouter.get("/queues/:id/throughput", asyncHandler(queues.throughput));

// Retry policies
resourcesRouter.post("/projects/:projectId/retry-policies", validate(retryPolicies.createRetryPolicySchema), asyncHandler(retryPolicies.create));
resourcesRouter.get("/projects/:projectId/retry-policies", asyncHandler(retryPolicies.list));

// Worker fleet (infrastructure visibility for the dashboard)
resourcesRouter.get("/workers", asyncHandler(async (_req, res) => {
  res.json({ workers: await workersRepo.list() });
}));
