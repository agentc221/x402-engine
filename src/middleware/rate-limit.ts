import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, RequestHandler } from "express";

function ipAndPathKey(req: Request): string {
  return `${ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown")}:${req.path}`;
}

/**
 * Strict rate limit for free endpoints (health, discovery, facilitator).
 * 60 requests per minute per IP.
 */
export const freeEndpointLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 60,
  keyGenerator: ipAndPathKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — try again later" },
});

/**
 * General rate limit for paid endpoints.
 * 300 requests per minute per IP and endpoint. The payment requirement is the
 * primary guard, while the path-scoped key lets discovery services validate the
 * full catalog without one route consuming the origin-wide budget.
 */
export const paidEndpointLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 300,
  keyGenerator: ipAndPathKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — try again later" },
});

/**
 * Very strict rate limit for expensive free endpoints (stats, facilitator status).
 * 10 requests per minute per IP.
 */
export const expensiveEndpointLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests to this endpoint — try again later" },
});
