import type { NextFunction, Request, Response } from "express";

/**
 * Small in-memory fixed-window rate limiter (per process). Keyed by acting user when known, else by IP.
 * Good enough for a single API instance; use a shared store if the API is scaled out.
 */
export function rateLimit(opts: { name: string; max: number; windowMs: number; key?: (req: Request) => string; skipClientErrors?: boolean }) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const id = opts.key ? opts.key(req) : req.header("x-user-id") || req.ip || "unknown";
    const k = `${opts.name}:${id}`;
    let h = hits.get(k);
    if (!h || h.reset <= now) {
      h = { count: 0, reset: now + opts.windowMs };
      hits.set(k, h);
      if (hits.size > 10000) for (const [key, v] of hits) if (v.reset <= now) hits.delete(key);
    }
    h.count++;
    if (h.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: "Too many requests — please wait and try again" });
    }
    if (opts.skipClientErrors) {
      const hit = h;
      // Refund requests the server rejected (4xx other than 429), e.g. validation or permission errors.
      res.on("finish", () => {
        if (res.statusCode >= 400 && res.statusCode < 500 && res.statusCode !== 429 && hit.count > 0) hit.count--;
      });
    }
    next();
  };
}

export const ipKey = (req: Request) => req.ip || "unknown";
