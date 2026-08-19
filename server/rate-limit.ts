import type { NextFunction, Request, Response } from "express";

// Fixed-window counters kept in process memory. The app runs as a single node
// (see server/index.ts), so a shared store is not needed yet; if it is ever
// scaled horizontally this is the one piece that has to move to Redis.
// windowMs is carried on the entry so the sweep can tell a still-live window
// from a dead one. Without it the sweep would evict on a fixed age and cut a
// longer lockout (the 10-minute auth window) short.
type WindowState = { count: number; windowStartedAt: number; windowMs: number };

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
  resetAtSec: number;
};

export type RateLimitOptions = {
  /** Distinguishes buckets so two limiters never share a counter. */
  name: string;
  windowMs: number;
  max: number;
  /** Overrides the default "user id, else IP" bucket key. */
  keyResolver?: (req: Request) => string;
  /** Skips counting a request entirely (e.g. successful reads that should stay free). */
  skip?: (req: Request) => boolean;
  message?: string;
};

const buckets = new Map<string, Map<string, WindowState>>();
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function bucketFor(name: string) {
  let bucket = buckets.get(name);
  if (!bucket) {
    bucket = new Map<string, WindowState>();
    buckets.set(name, bucket);
  }
  return bucket;
}

// Without this the maps grow once per unique client forever. Entries are only
// meaningful for the length of their window, so anything older is dropped.
function sweepExpiredWindows() {
  const now = Date.now();
  buckets.forEach((bucket) => {
    const stale: string[] = [];
    bucket.forEach((state, key) => {
      if (now - state.windowStartedAt >= state.windowMs) {
        stale.push(key);
      }
    });
    stale.forEach((key) => bucket.delete(key));
  });
}

const sweepTimer = setInterval(sweepExpiredWindows, SWEEP_INTERVAL_MS);
// The sweep is housekeeping, so it must not hold the process open on shutdown.
sweepTimer.unref?.();

/**
 * Counts one hit against a named window and reports whether it is allowed.
 * Exported so flows that key on something other than the request (a username,
 * an email address) can share this store instead of hand-rolling a second one.
 */
export function consumeRateLimit(name: string, key: string, windowMs: number, max: number): RateLimitDecision {
  const bucket = bucketFor(name);
  const now = Date.now();
  const current = bucket.get(key);

  if (!current || now - current.windowStartedAt >= windowMs) {
    bucket.set(key, { count: 1, windowStartedAt: now, windowMs });
    return {
      allowed: true,
      limit: max,
      remaining: Math.max(max - 1, 0),
      retryAfterSec: 0,
      resetAtSec: Math.ceil((now + windowMs) / 1000),
    };
  }

  const resetAtSec = Math.ceil((current.windowStartedAt + windowMs) / 1000);

  if (current.count >= max) {
    return {
      allowed: false,
      limit: max,
      remaining: 0,
      retryAfterSec: Math.max(Math.ceil((current.windowStartedAt + windowMs - now) / 1000), 1),
      resetAtSec,
    };
  }

  current.count += 1;
  return {
    allowed: true,
    limit: max,
    remaining: Math.max(max - current.count, 0),
    retryAfterSec: 0,
    resetAtSec,
  };
}

/** Drops a key's window, used to forgive attempts after a success. */
export function resetRateLimit(name: string, key: string) {
  buckets.get(name)?.delete(key);
}

/**
 * An authenticated caller is limited per account so that everyone behind one
 * NAT/office IP is not sharing a single budget; anonymous callers fall back to
 * the IP, which "trust proxy" makes the real client address.
 */
export function defaultRateLimitKey(req: Request) {
  const userId = req.user?.id;
  return userId ? `user:${userId}` : `ip:${req.ip || "unknown"}`;
}

export function createRateLimiter(options: RateLimitOptions) {
  const {
    name,
    windowMs,
    max,
    keyResolver = defaultRateLimitKey,
    skip,
    message = "تم تجاوز عدد الطلبات المسموح بها. حاول مرة أخرى بعد قليل",
  } = options;

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    if (skip?.(req)) {
      return next();
    }

    const decision = consumeRateLimit(name, keyResolver(req), windowMs, max);

    res.setHeader("RateLimit-Limit", decision.limit.toString());
    res.setHeader("RateLimit-Remaining", decision.remaining.toString());
    res.setHeader("RateLimit-Reset", decision.resetAtSec.toString());

    if (!decision.allowed) {
      res.setHeader("Retry-After", decision.retryAfterSec.toString());
      return res.status(429).json({ message });
    }

    next();
  };
}

// Tiers, loosest to tightest. Every /api route gets `apiRateLimit`; routes that
// write, cost money, or send messages stack a tighter tier on top of it.
export const RATE_LIMIT_TIERS = {
  /** Baseline for all API traffic. Generous: dashboards fan out many reads. */
  api: { windowMs: 60_000, max: 600 },
  /** Anything that mutates state. */
  write: { windowMs: 60_000, max: 120 },
  /** Costly work: AI calls, uploads, backups, outbound mail/push. */
  expensive: { windowMs: 60_000, max: 12 },
  /** Credential and account-recovery flows. */
  auth: { windowMs: 10 * 60_000, max: 5 },
} as const;

export const apiRateLimit = createRateLimiter({
  name: "api",
  ...RATE_LIMIT_TIERS.api,
});

export const writeRateLimit = createRateLimiter({
  name: "write",
  ...RATE_LIMIT_TIERS.write,
  message: "تم تجاوز عدد عمليات التعديل المسموح بها. حاول مرة أخرى بعد قليل",
});

export const expensiveRateLimit = createRateLimiter({
  name: "expensive",
  ...RATE_LIMIT_TIERS.expensive,
  message: "هذه العملية مكلفة وتم تجاوز الحد المسموح به. حاول مرة أخرى بعد قليل",
});
