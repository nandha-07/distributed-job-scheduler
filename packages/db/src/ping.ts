/**
 * Connectivity check:  npm run db:ping
 * Verifies .env → pool → Docker Postgres end to end.
 */
import { pool, closePool } from "./pool.js";

const result = await pool.query<{ version: string; now: Date }>(
  "SELECT version() AS version, now() AS now",
);

const row = result.rows[0];
if (!row) throw new Error("No row returned — something is very wrong");

console.log("✅ Connected to PostgreSQL");
console.log(`   ${row.version}`);
console.log(`   Server time: ${row.now.toISOString()}`);

await closePool();
