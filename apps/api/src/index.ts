/**
 * API process entry point: build the app (see app.ts) and run it with
 * graceful shutdown. Kept separate from app construction for testability.
 */
import { config } from "@jobs/config";
import { createLogger } from "@jobs/core";
import { closePool } from "@jobs/db";
import { createApp } from "./app.js";

const log = createLogger("api");
const app = createApp();

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
