import { Router } from "express";
import { db } from "../db";
import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from "../../shared/constants";
import { actorId, ah, HttpError, intParam } from "../lib/http";
import { audit, logActivity } from "../lib/log";
import { syncNextFollowUp, userName } from "../lib/crm";
import { todayIST } from "../lib/time";

export const tasksRouter = Router();

const TASK_SELECT = `
  SELECT t.id, t.organization_id, org.name AS organization_name, t.opportunity_id, t.assigned_to, u.name AS assigned_name,
         t.title, t.task_type, t.due_date, t.priority, t.status, t.created_at, t.completed_at,
         (t.status = 'Pending' AND t.due_date < $1) AS overdue
    FROM tasks t
    LEFT JOIN organizations org ON org.id = t.organization_id
    LEFT JOIN users u ON u.id = t.assigned_to`;

tasksRouter.get(
  "/",
  ah(async (req, res) => {
    const today = todayIST();
    const { assigned_to, scope } = req.query as Record<string, string | undefined>;
    const params: unknown[] = [today];
    const where: string[] = [];
    if (assigned_to) {
      params.push(Number(assigned_to));
      where.push(`t.assigned_to = $${params.length}`);
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

tasksRouter.post(
  "/",
  ah(async (req, res) => {
    const actor = actorId(req);
    const { organization_id, title, task_type, due_date, priority, assigned_to } = req.body ?? {};
    if (!title?.trim()) throw new HttpError(400, "Task is required");
    if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) throw new HttpError(400, "Due date must be YYYY-MM-DD");
    const task = await db().tx(async (q) => {
      let oppId: number | null = null;
      if (organization_id) {
        const { rows } = await q.query<{ id: number }>(`SELECT id FROM crm_opportunities WHERE organization_id = $1`, [organization_id]);
        oppId = rows[0]?.id ?? null;
      }
      const { rows } = await q.query<{ id: number }>(
        `INSERT INTO tasks (organization_id, opportunity_id, assigned_to, title, task_type, due_date, priority, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          organization_id || null, oppId, assigned_to || actor, title.trim(),
          TASK_TYPES.includes(task_type) ? task_type : "Follow-up", due_date || null,
          TASK_PRIORITIES.includes(priority) ? priority : "Medium", actor,
        ],
      );
      if (organization_id) {
        await logActivity(q, {
          organizationId: organization_id,
          opportunityId: oppId,
          type: "follow_up_created",
          summary: `${TASK_TYPES.includes(task_type) ? task_type : "Follow-up"} created${due_date ? ` for ${due_date}` : ""}: ${title.trim()} (assigned to ${await userName(q, assigned_to || actor)})`,
          actorId: actor,
        });
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
        if (summary) await logActivity(q, { organizationId: cur.organization_id, opportunityId: cur.opportunity_id, type: b.status === "Done" ? "follow_up_completed" : "follow_up_updated", summary, actorId: actor });
      }
      await syncNextFollowUp(q, cur.opportunity_id);
      await audit(q, actor, "task", id, "update", b);
      return (await q.query(`${TASK_SELECT} WHERE t.id = $2`, [todayIST(), id])).rows[0];
    });
    res.json(task);
  }),
);
