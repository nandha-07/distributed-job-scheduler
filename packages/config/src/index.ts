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
