import { NextResponse } from "next/server";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

// In-memory store for rate limiting
// Key: identifier (IP or user ID), Value: rate limit entry
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically (every 5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpiredEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  response?: NextResponse;
}

/**
 * Check rate limit for a given identifier
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanupExpiredEntries();

  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  // No existing entry or expired
  if (!entry || entry.resetAt < now) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(identifier, newEntry);
    return {
      success: true,
      remaining: config.maxRequests - 1,
      resetAt: newEntry.resetAt,
    };
  }

  // Entry exists and is still valid
  if (entry.count >= config.maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
      response: NextResponse.json(
        {
          error: "Too many requests",
          message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
          retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(config.maxRequests),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
          },
        }
      ),
    };
  }

  // Increment count
  entry.count++;
  return {
    success: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Get client identifier from request (IP address or user ID)
 */
export function getClientIdentifier(
  request: Request,
  userId?: string | null
): string {
  // Prefer user ID if authenticated
  if (userId) {
    return `user:${userId}`;
  }

  // Fall back to IP address
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ip = forwarded?.split(",")[0]?.trim() || realIp || "unknown";

  return `ip:${ip}`;
}

// Preset rate limit configurations
export const RATE_LIMITS = {
  // Extraction endpoints - expensive operations
  extraction: {
    windowMs: 60 * 1000, // 1 minute window
    maxRequests: 5, // 5 requests per minute
  },
  // Stricter limit for unauthenticated users
  extractionAnonymous: {
    windowMs: 60 * 1000, // 1 minute window
    maxRequests: 2, // 2 requests per minute
  },
  // General API endpoints
  api: {
    windowMs: 60 * 1000, // 1 minute window
    maxRequests: 60, // 60 requests per minute
  },
} as const;

/**
 * Apply rate limit headers to a successful response
 */
export function withRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult,
  limit: number
): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set(
    "X-RateLimit-Reset",
    String(Math.ceil(result.resetAt / 1000))
  );
  return response;
}
