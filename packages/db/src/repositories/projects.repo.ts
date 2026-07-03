/**
 * Projects repository.
 */
import { pool } from "../pool.js";

export interface ProjectRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function create(params: {
  organizationId: string;
  name: string;
  description?: string | null;
}): Promise<ProjectRow> {
  const res = await pool.query<ProjectRow>(
    `INSERT INTO projects (organization_id, name, description)
     VALUES ($1, $2, $3) RETURNING *`,
    [params.organizationId, params.name, params.description ?? null],
  );
  const row = res.rows[0];
  if (!row) throw new Error("INSERT returned no row");
  return row;
}

export async function findById(id: string): Promise<ProjectRow | null> {
  const res = await pool.query<ProjectRow>(
    "SELECT * FROM projects WHERE id = $1",
    [id],
  );
  return res.rows[0] ?? null;
}

/** All projects in orgs the user belongs to — paginated. */
export async function listForUser(
  userId: string,
  limit: number,
  offset: number,
): Promise<{ rows: ProjectRow[]; total: number }> {
  const [rows, count] = await Promise.all([
    pool.query<ProjectRow>(
      `SELECT p.*
         FROM projects p
         JOIN organization_members m ON m.organization_id = p.organization_id
        WHERE m.user_id = $1
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    pool.query<{ total: string }>(
      `SELECT count(*) AS total
         FROM projects p
         JOIN organization_members m ON m.organization_id = p.organization_id
        WHERE m.user_id = $1`,
      [userId],
    ),
  ]);
  return { rows: rows.rows, total: Number(count.rows[0]?.total ?? 0) };
}

/** PATCH semantics: COALESCE keeps current value when a field is omitted. */
export async function update(
  id: string,
  params: { name?: string; description?: string | null },
): Promise<ProjectRow | null> {
  const res = await pool.query<ProjectRow>(
    `UPDATE projects
        SET name        = COALESCE($2, name),
            description = COALESCE($3, description)
      WHERE id = $1
      RETURNING *`,
    [id, params.name ?? null, params.description ?? null],
  );
  return res.rows[0] ?? null;
}

export async function remove(id: string): Promise<boolean> {
  const res = await pool.query("DELETE FROM projects WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}
