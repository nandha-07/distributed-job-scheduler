/**
 * Organizations + memberships repository.
 */
import type { Queryable } from "../tx.js";
import { pool } from "../pool.js";

export interface OrganizationRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export type OrgRole = "owner" | "admin" | "member";

export async function create(
  db: Queryable,
  params: { name: string },
): Promise<OrganizationRow> {
  const res = await db.query<OrganizationRow>(
    "INSERT INTO organizations (name) VALUES ($1) RETURNING *",
    [params.name],
  );
  const row = res.rows[0];
  if (!row) throw new Error("INSERT returned no row");
  return row;
}

export async function addMember(
  db: Queryable,
  params: { organizationId: string; userId: string; role: OrgRole },
): Promise<void> {
  await db.query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, $3)`,
    [params.organizationId, params.userId, params.role],
  );
}

export async function listForUser(userId: string): Promise<
  Array<OrganizationRow & { role: OrgRole }>
> {
  const res = await pool.query<OrganizationRow & { role: OrgRole }>(
    `SELECT o.*, m.role
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
      WHERE m.user_id = $1
      ORDER BY o.created_at`,
    [userId],
  );
  return res.rows;
}

/** Authorization primitive: is this user a member of this org? */
export async function isMember(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM organization_members
      WHERE user_id = $1 AND organization_id = $2`,
    [userId, organizationId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** RBAC primitive: the user's role in the org, or null if not a member. */
export async function getRole(
  userId: string,
  organizationId: string,
): Promise<OrgRole | null> {
  const res = await pool.query<{ role: OrgRole }>(
    `SELECT role FROM organization_members
      WHERE user_id = $1 AND organization_id = $2`,
    [userId, organizationId],
  );
  return res.rows[0]?.role ?? null;
}
