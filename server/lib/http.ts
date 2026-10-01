import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: object) {
    super(message);
  }
}

export const ah =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** Acting user, sent by the client in X-User-Id (MVP: no authentication yet). */
export function actorId(req: Request): number | null {
  const v = Number(req.header("x-user-id"));
  return Number.isInteger(v) && v > 0 ? v : null;
}

export function intParam(v: unknown, name = "id"): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}`);
  return n;
}

export function pick<T extends object>(obj: T, allowed: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) if (k in obj) out[k] = (obj as Record<string, unknown>)[k];
  return out as Partial<T>;
}
