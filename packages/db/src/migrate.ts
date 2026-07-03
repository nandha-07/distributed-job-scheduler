/**
 * Migration runner:  npm run db:migrate
 *
 * How it works (industry-standard pattern):
 *  1. Takes a Postgres ADVISORY LOCK — an application-level mutex — so two
 *     people/processes migrating at once can never interleave.
 *  2. Ensures a schema_migrations bookkeeping table exists.
 *  3. Reads packages/db/migrations/*.sql in filename order.
 *  4. Applies each not-yet-applied file inside its OWN transaction:
 *     either the whole file applies, or none of it does.
 *  5. Records the filename so it is never applied twice.
 *
 * Forward-only: never edit an applied migration — write a new one.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pool, closePool } from "./pool.js";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "packages/db/migrations");
// Arbitrary but fixed app-wide lock id for "migration in progress".
const MIGRATION_LOCK_ID = 727_770;

const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const appliedRows = await client.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );
  const applied = new Set(appliedRows.rows.map((r) => r.version));

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 001_, 002_, ... — filename order IS application order

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  = ${file} (already applied)`);
      continue;
    }
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");
      console.log(`  ✅ ${file} applied`);
      ran++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  ❌ ${file} FAILED — rolled back, nothing recorded`);
      throw err;
    }
  }
  console.log(
    ran === 0 ? "Database already up to date." : `Done: ${ran} migration(s) applied.`,
  );
} finally {
  await client
    .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
    .catch(() => {});
  client.release();
  await closePool();
}
