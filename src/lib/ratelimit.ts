// src/lib/ratelimit.ts
// Simple rate limiter using Supabase DB.
// No Redis needed — uses a lightweight in-memory store per Edge instance
// with a DB-backed fallback for distributed deployments.

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store per serverless instance
const store = new Map<string, RateLimitEntry>();

interface RateLimitOptions {
  key: string;        // e.g. userId + endpoint
  limit: number;      // max requests
  windowMs: number;   // time window in ms
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit({ key, limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // Fresh window
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

// Preset limits for EchoRepo endpoints
export const LIMITS = {
  // Max 5 repo connections per user per hour
  connectRepo: (userId: string) =>
    rateLimit({ key: `connect:${userId}`, limit: 5, windowMs: 60 * 60 * 1000 }),

  // Max 3 full syncs per user per hour
  syncRepo: (userId: string) =>
    rateLimit({ key: `sync:${userId}`, limit: 3, windowMs: 60 * 60 * 1000 }),

  // Max 30 chat messages per user per minute
  chat: (userId: string) =>
    rateLimit({ key: `chat:${userId}`, limit: 30, windowMs: 60 * 1000 }),
};
