/**
 * App construction, separated from process startup so tests can build the
 * app without binding a port (supertest drives it in-memory).
 */
import express from "express";
import type { Express } from "express";
import { pool } from "@jobs/db";
import { requestContext } from "./middleware/request-context.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRouter } from "./routes/auth.routes.js";
import { resourcesRouter } from "./routes/resources.routes.js";
import { jobsRouter } from "./routes/jobs.routes.js";

export function createApp(): Express {
  const app = express();

  app.use(requestContext);
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ status: "degraded", database: "unreachable" });
    }
  });

  app.use("/api/v1", authRouter);
  app.use("/api/v1", resourcesRouter);
  app.use("/api/v1", jobsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });
  app.use(errorHandler);

  return app;
}
