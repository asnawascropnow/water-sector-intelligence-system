import type { NextFunction, Request, Response } from "express";
import { db } from "../db";
import { actorId, HttpError } from "./http";
import type { User } from "../../shared/types";

/**
 * Request-level user checks. WSIS has no login yet: the client names the acting user in X-User-Id.
 * These guards make that user mandatory, active, and role-checked, but the header itself is not proof of
 * identity — see docs/email-automation.md ("Authentication") before exposing the API beyond a trusted network.
 */

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

export async function loadActor(req: Request): Promise<User> {
  const id = actorId(req);
  if (!id) throw new HttpError(401, "Choose who you are working as (X-User-Id is missing)");
  const { rows } = await db().query<User>(`SELECT id, name, email, role, active FROM users WHERE id = $1`, [id]);
  if (!rows[0] || !rows[0].active) throw new HttpError(401, "Unknown or inactive user");
  return rows[0];
}

export const requireUser = (req: Request, _res: Response, next: NextFunction) => {
  loadActor(req)
    .then((u) => {
      req.user = u;
      next();
    })
    .catch(next);
};

export function hasRole(user: User | undefined, roles: string[]): boolean {
  return !!user && roles.includes(user.role.trim().toLowerCase());
}
