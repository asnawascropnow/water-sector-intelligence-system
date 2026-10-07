import { Router } from "express";
import { db } from "../db";
import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from "../../shared/constants";
import { actorId, ah, HttpError, intParam } from "../lib/http";
import { audit, logActivity, logProjectActivity } from "../lib/log";
import { PRIMARY_OPPORTUNITY_ORDER, syncNextFollowUp, userName } from "../lib/crm";
import { todayIST } from "../lib/time";

export const tasksRouter = Router();

/** Tasks with their context: organization, CRM opportunity (title, type, pipeline) and project. */
const TASK_SELECT = `
  SELECT t.id, t.organization_id, org.name AS organization_name, t.opportunity_id, t.assigned_to, u.name AS assigned_name,
         t.title, t.task_type, t.due_date, t.priority, t.status, t.created_at, t.completed_at,
         (t.status = 'Pending' AND t.due_date < $1) AS overdue,
         t.project_id, p.name AS project_name, o.pipeline AS opportunity_pipeline, o.opportunity_type, o.title AS opportunity_title
    FROM tasks t
    LEFT JOIN organizations org ON org.id = t.organization_id
    LEFT JOIN crm_opportunities o ON o.id = t.opportunity_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN users u ON u.id = t.assigned_to`;

tasksRouter.get(
  "/",
  ah(async (req, res) => {
    const today = todayIST();
    const { assigned_to, scope, opportunity_id, project_id, organization_id } = req.query as Record<string, string | undefined>;
    const params: unknown[] = [today];
    const where: string[] = [];
    if (assigned_to) {
      params.push(Number(assigned_to));
      where.push(`t.assigned_to = $${params.length}`);
    }
    for (const [v, col] of [[opportunity_id, "t.opportunity_id"], [project_id, "t.project_id"], [organization_id, "t.organization_id"]] as const) {
      if (!v) continue;
      params.push(intParam(v, col.slice(2)));
      where.push(`${col} = $${params.length}`);
    }
    if (scope === "overdue") where.push(`t.status = 'Pending' AND t.due_date < $1`);
    else if (scope === "today") where.push(`t.status = 'Pending' AND t.due_date = $1`);
    else if (scope === "upcoming") where.push(`t.status = 'Pending' AND (t.due_date > $1 OR t.due_date IS NULL)`);
    else if (scope === "pending") where.push(`t.status = 'Pending'`);
    else if (scope === "done") where.push(`t.status <> 'Pending'`);
    const { rows } = await db().query(
      `${TASK_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY (t.status = 'Pending') DESC, t.due_date NULLS LAST, CASE t.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END LIMIT 1000`,
      params,
    );
    res.json(rows);
  }),
);

/**
 * Create a task. Context, most specific first (WSIS Phase 7):
 * - opportunity_id: the task belongs to that CRM opportunity; organization and project come from it;
 * - project_id (+ optional organization_id): a project task, not attached to any opportunity;
 * - organization_id only: as before, attached to the organization's relationship opportunity if it has one
 *   (never to a project opportunity — that would be a project task presented as an organization one).
 */
tasksRouter.post(
  "/",
  ah(async (req, res) => {
    const actor = actorId(req);
    const { title, task_type, due_date, priority, assigned_to } = req.body ?? {};
    let organizationId: number | null = req.body?.organization_id ? intParam(req.body.organization_id, "organization_id") : null;
    let projectId: number | null = req.body?.project_id ? intParam(req.body.project_id, "project_id") : null;
    const opportunityParam: number | null = req.body?.opportunity_id ? intParam(req.body.opportunity_id, "opportunity_id") : null;
    if (!title?.trim()) throw new HttpError(400, "Task is required");
    if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) throw new HttpError(400, "Due date must be YYYY-MM-DD");
    const task = await db().tx(async (q) => {
      let oppId: number | null = null;
      if (opportunityParam) {
        const o = (await q.query<{ organization_id: number; project_id: number | null }>(`SELECT organization_id, project_id FROM crm_opportunities WHERE id = $1`, [opportunityParam])).rows[0];
        if (!o) throw new HttpError(404, "Opportunity not found");
        if (organizationId && organizationId !== o.organization_id) throw new HttpError(400, "organization_id does not match the opportunity");
        if (projectId && projectId !== o.project_id) throw new HttpError(400, "project_id does not match the opportunity");
        oppId = opportunityParam;
        organizationId = o.organization_id;
        projectId = o.project_id;
      } else if (projectId) {
        if (!(await q.query(`SELECT 1 FROM projects WHERE id = $1 AND merged_into IS NULL`, [projectId])).rows.length) throw new HttpError(404, "Project not found");
      } else if (organizationId) {
        const { rows } = await q.query<{ id: number }>(
          `SELECT o.id FROM crm_opportunities o WHERE o.organization_id = $1 AND o.pipeline = 'relationship' ORDER BY ${PRIMARY_OPPORTUNITY_ORDER} LIMIT 1`,
          [organizationId],
        );
        oppId = rows[0]?.id ?? null;
      }
      const type = TASK_TYPES.includes(task_type) ? task_type : "Follow-up";
      const { rows } = await q.query<{ id: number }>(
        `INSERT INTO tasks (organization_id, opportunity_id, project_id, assigned_to, title, task_type, due_date, priority, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [organizationId, oppId, projectId, assigned_to || actor, title.trim(), type, due_date || null, TASK_PRIORITIES.includes(priority) ? priority : "Medium", actor],
      );
      const summary = `${type} created${due_date ? ` for ${due_date}` : ""}: ${title.trim()} (assigned to ${await userName(q, assigned_to || actor)})`;
      if (organizationId) {
        await logActivity(q, { organizationId, opportunityId: oppId, projectId, type: "follow_up_created", summary, actorId: actor });
      } else if (projectId) {
        await logProjectActivity(q, { projectId, type: "follow_up_created", summary, actorId: actor });
      }
      await syncNextFollowUp(q, oppId);
      await audit(q, actor, "task", rows[0].id, "create", req.body);
      return (await q.query(`${TASK_SELECT} WHERE t.id = $2`, [todayIST(), rows[0].id])).rows[0];
    });
    res.status(201).json(task);
  }),
);

tasksRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const actor = actorId(req);
    const b = req.body ?? {};
    const task = await db().tx(async (q) => {
      const { rows } = await q.query<any>(`${TASK_SELECT} WHERE t.id = $2`, [todayIST(), id]);
      const cur = rows[0];
      if (!cur) throw new HttpError(404, "Task not found");
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if ("status" in b && b.status !== cur.status) {
        if (!TASK_STATUSES.includes(b.status)) throw new HttpError(400, "Unknown status");
        set("status", b.status);
        sets.push(b.status === "Pending" ? "completed_at = NULL" : "completed_at = now()");
      }
      if ("due_date" in b) set("due_date", b.due_date || null);
      if ("priority" in b && TASK_PRIORITIES.includes(b.priority)) set("priority", b.priority);
      if ("assigned_to" in b) set("assigned_to", b.assigned_to || null);
      if ("title" in b && b.title?.trim()) set("title", b.title.trim());
      if (!sets.length) return cur;
      await q.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = $1`, params);
      if (cur.organization_id) {
        const who = await userName(q, actor);
        let summary: string | null = null;
        if (b.status === "Done") summary = `${cur.task_type} completed: ${cur.title} — by ${who}`;
        else if (b.status === "Cancelled") summary = `${cur.task_type} cancelled: ${cur.title} — by ${who}`;
        else if ("due_date" in b && b.due_date !== cur.due_date) summary = `${cur.task_type} rescheduled to ${b.due_date || "no date"}: ${cur.title}`;
        else if ("assigned_to" in b && b.assigned_to !== cur.assigned_to) summary = `${cur.task_type} reassigned to ${await userName(q, b.assigned_to)}: ${cur.title}`;
        if (summary) await logActivity(q, { organizationId: cur.organization_id, opportunityId: cur.opportunity_id, projectId: cur.project_id, type: b.status === "Done" ? "follow_up_completed" : "follow_up_updated", summary, actorId: actor });
      } else if (cur.project_id && b.status === "Done") {
        await logProjectActivity(q, { projectId: cur.project_id, type: "follow_up_completed", summary: `${cur.task_type} completed: ${cur.title} — by ${await userName(q, actor)}`, actorId: actor });
      }
      await syncNextFollowUp(q, cur.opportunity_id);
      await audit(q, actor, "task", id, "update", b);
      return (await q.query(`${TASK_SELECT} WHERE t.id = $2`, [todayIST(), id])).rows[0];
    });
    res.json(task);
  }),
);
