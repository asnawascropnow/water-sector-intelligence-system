import type { Queryable } from "../db";

/** Append an entry to the organization's timeline. Activities are never updated or deleted. */
export async function logActivity(
  q: Queryable,
  a: { organizationId: number; opportunityId?: number | null; type: string; summary: string; details?: object; actorId?: number | null; occurredAt?: string | null },
) {
  await q.query(
    `INSERT INTO activities (organization_id, opportunity_id, type, summary, details, actor_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))`,
    [a.organizationId, a.opportunityId ?? null, a.type, a.summary, JSON.stringify(a.details ?? {}), a.actorId ?? null, a.occurredAt ?? null],
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
