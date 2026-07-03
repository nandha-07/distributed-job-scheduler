/**
 * API server entry point: middleware pipeline + route mounting.
 * Order matters and is deliberate:
 *   request-context → json parser → routes → 404 → error handler (last).
 */
import express from "express";
import { config } from "@jobs/config";
import { createLogger } from "@jobs/core";
import { pool, closePool } from "@jobs/db";
import { requestContext } from "./middleware/request-context.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRouter } from "./routes/auth.routes.js";
import { resourcesRouter } from "./routes/resources.routes.js";

const log = createLogger("api");
const app = express();

app.use(requestContext);
app.use(express.json({ limit: "1mb" }));

/** Health: am I up, can I reach the DB? 200 healthy / 503 degraded. */
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

// Anything unmatched → uniform 404 (must come after all routes).
app.use((_req, res) => {
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

// Error handler is ALWAYS last in the pipeline.
app.use(errorHandler);

const server = app.listen(config.API_PORT, () => {
  log.info({ port: config.API_PORT }, "API server listening");
});

async function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
