/**
 * API server entry point.
 * M2 scope: boot, config, logging, /health, graceful shutdown.
 * Routes/controllers/services arrive in M4 once the schema exists (M3).
 */
import express from "express";
import { config } from "@jobs/config";
import { createLogger } from "@jobs/core";
import { pool, closePool } from "@jobs/db";

const log = createLogger("api");
const app = express();

app.use(express.json());

/**
 * Health endpoint. "Am I up, and can I reach my database?"
 * Returns 200 when healthy, 503 when the DB is unreachable —
 * standard contract for load balancers and uptime monitors.
 */
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  } catch {
    res.status(503).json({ status: "degraded", database: "unreachable" });
  }
});

const server = app.listen(config.API_PORT, () => {
  log.info({ port: config.API_PORT }, "API server listening");
});

/**
 * Graceful shutdown: on Ctrl+C (SIGINT) or `docker stop` (SIGTERM),
 * stop accepting new connections, let in-flight requests finish,
 * close DB connections, then exit. Killing abruptly instead can drop
 * requests mid-flight and leak connections.
 */
async function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
