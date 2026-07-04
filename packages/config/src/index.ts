/**
 * Single source of truth for configuration.
 *
 * Every process (api, worker, scheduler) imports `config` from here.
 * Rules enforced:
 *  1. All env variables are declared in ONE schema below.
 *  2. Validation happens once, at boot. A missing or malformed variable
 *     crashes the process immediately with a readable message ("fail fast"),
 *     instead of surfacing as a confusing error deep inside a request.
 */
import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

// Load .env from the repo root (all our npm scripts run from the root).
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // Standard Postgres connection string:
  // postgresql://USER:PASSWORD@HOST:PORT/DATABASE
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required — copy .env.example to .env"),

  // Signs JWTs. Anyone with this value can forge logins — secret, long,
  // random, never committed. Min length enforced to prevent weak secrets.
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 chars — see .env.example"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // Worker tuning (sensible defaults; override per-worker via env).
  WORKER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(1000),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
  WORKER_STALE_TIMEOUT_MS: z.coerce.number().int().min(5000).default(30000),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),

  SCHEDULER_TICK_MS: z.coerce.number().int().min(100).default(1000),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Print every problem at once, then refuse to start.
  console.error("❌ Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`   ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
