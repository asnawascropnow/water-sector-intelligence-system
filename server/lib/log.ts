import type { Queryable } from "../db";

/**
 * Append an entry to the organization's timeline. Activities are never updated or deleted.
 * An entry about a CRM opportunity also carries that opportunity's project (activities.project_id), so the
 * same single row appears on the organization, opportunity and project timelines — never copied.
 */
export async function logActivity(
  q: Queryable,
  a: { organizationId: number; opportunityId?: number | null; projectId?: number | null; type: string; summary: string; details?: object; actorId?: number | null; occurredAt?: string | null },
) {
  await q.query(
    `INSERT INTO activities (organization_id, opportunity_id, project_id, type, summary, details, actor_id, occurred_at)
     VALUES ($1, $2, coalesce($3::int, (SELECT project_id FROM crm_opportunities WHERE id = $2::int)), $4, $5, $6, $7, coalesce($8::timestamptz, now()))`,
    [a.organizationId, a.opportunityId ?? null, a.projectId ?? null, a.type, a.summary, JSON.stringify(a.details ?? {}), a.actorId ?? null, a.occurredAt ?? null],
  );
}

export async function audit(q: Queryable, actorId: number | null, entity: string, entityId: number | null, action: string, changes: object = {}) {
  await q.query(`INSERT INTO audit_logs (actor_id, entity, entity_id, action, changes) VALUES ($1, $2, $3, $4, $5)`, [
    actorId,
    entity,
    entityId,
    action,
    JSON.stringify(changes),
  ]);
}

export async function createSource(
  q: Queryable,
  s: { kind: string; label: string; url?: string | null; importId?: number | null; createdBy?: number | null },
): Promise<number> {
  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO sources (kind, label, url, import_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [s.kind, s.label, s.url ?? null, s.importId ?? null, s.createdBy ?? null],
  );
  return rows[0].id;
}

/** Append an entry to a project's timeline (project_activities). Never updated or deleted. */
export async function logProjectActivity(
  q: Queryable,
  a: { projectId: number; type: string; summary: string; details?: object; actorId?: number | null },
) {
  await q.query(`INSERT INTO project_activities (project_id, type, summary, details, actor_id) VALUES ($1, $2, $3, $4, $5)`, [
    a.projectId,
    a.type,
    a.summary,
    JSON.stringify(a.details ?? {}),
    a.actorId ?? null,
  ]);
}
