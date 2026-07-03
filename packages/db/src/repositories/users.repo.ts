/**
 * Users repository — the ONLY place with SQL touching the users table.
 * Repositories: no business rules, no HTTP concepts. Just typed queries.
 * All queries use $1/$2 parameters — string concatenation into SQL is how
 * SQL injection happens, and it is banned in this codebase.
 */
import type { Queryable } from "../tx.js";
import { pool } from "../pool.js";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

/** Safe subset for API responses — password_hash must never leave the server. */
export type PublicUser = Omit<UserRow, "password_hash">;

export function toPublicUser(u: UserRow): PublicUser {
  const { password_hash: _omitted, ...pub } = u;
  return pub;
}

export async function findByEmail(email: string): Promise<UserRow | null> {
  const res = await pool.query<UserRow>(
    "SELECT * FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  return res.rows[0] ?? null;
}

export async function findById(id: string): Promise<UserRow | null> {
  const res = await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [
    id,
  ]);
  return res.rows[0] ?? null;
}

export async function create(
  db: Queryable,
  params: { email: string; passwordHash: string; name: string },
): Promise<UserRow> {
  const res = await db.query<UserRow>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [params.email, params.passwordHash, params.name],
  );
  const row = res.rows[0];
  if (!row) throw new Error("INSERT returned no row");
  return row;
}
