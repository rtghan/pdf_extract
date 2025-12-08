/**
 * Sentry error tracking integration
 *
 * Provides:
 * - Error capture with context
 * - User identification
 * - Custom tags and extras
 * - Performance transaction tracking
 * - Graceful degradation when Sentry is not configured
 */

import * as Sentry from "@sentry/nextjs";

// Check if Sentry is configured
const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
const IS_SENTRY_ENABLED = !!SENTRY_DSN;

export interface ErrorContext {
  userId?: string;
  requestId?: string;
  engine?: string;
  conversionId?: string;
  tags?: Record<string, string>;
  extras?: Record<string, unknown>;
}

/**
 * Initialize Sentry (call this in instrumentation.ts or app initialization)
 */
export function initSentry(): void {
  if (!IS_SENTRY_ENABLED) {
    console.warn("[Sentry] No DSN configured, error tracking disabled");
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",

    // Performance monitoring sample rate (adjust based on traffic)
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Error sampling (capture all errors)
    sampleRate: 1.0,

    // Enable profiling for performance insights
    profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Ignore common non-actionable errors
    ignoreErrors: [
      // Network errors that are client-side
      "NetworkError",
      "Failed to fetch",
      "Load failed",
      // User aborted requests
      "AbortError",
      // Rate limiting (expected behavior)
      "Rate limit exceeded",
    ],

    // Add release version if available
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA,

    // Attach additional context to all events
    beforeSend(event, hint) {
      // Don't send events in development unless explicitly enabled
      if (process.env.NODE_ENV === "development" && !process.env.SENTRY_DEBUG) {
        console.debug("[Sentry] Would have sent event:", event.message || hint.originalException);
        return null;
      }
      return event;
    },
  });
}

/**
 * Set the current user for error tracking
 */
export function setUser(userId: string | null, email?: string): void {
  if (!IS_SENTRY_ENABLED) return;

  if (userId) {
    Sentry.setUser({ id: userId, email });
  } else {
    Sentry.setUser(null);
  }
}

/**
 * Capture an exception with optional context
 */
export function captureException(error: unknown, context?: ErrorContext): string | undefined {
  // Always log to console for local debugging
  console.error("[Error]", error, context);

  if (!IS_SENTRY_ENABLED) {
    return undefined;
  }

  return Sentry.captureException(error, (scope) => {
    if (context?.userId) {
      scope.setUser({ id: context.userId });
    }
    if (context?.requestId) {
      scope.setTag("request_id", context.requestId);
    }
    if (context?.engine) {
      scope.setTag("engine", context.engine);
    }
    if (context?.conversionId) {
      scope.setTag("conversion_id", context.conversionId);
    }
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }
    if (context?.extras) {
      for (const [key, value] of Object.entries(context.extras)) {
        scope.setExtra(key, value);
      }
    }
    return scope;
  });
}

/**
 * Capture a message (for non-error events worth tracking)
 */
export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
  context?: ErrorContext
): string | undefined {
  if (!IS_SENTRY_ENABLED) {
    console.log(`[${level.toUpperCase()}]`, message, context);
    return undefined;
  }

  return Sentry.captureMessage(message, (scope) => {
    scope.setLevel(level);
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }
    return scope;
  });
}

/**
 * Add breadcrumb for debugging context
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
  level: "debug" | "info" | "warning" | "error" = "info"
): void {
  if (!IS_SENTRY_ENABLED) return;

  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Start a performance transaction
 */
export function startTransaction(
  name: string,
  op: string,
  data?: Record<string, unknown>
): ReturnType<typeof Sentry.startInactiveSpan> | null {
  if (!IS_SENTRY_ENABLED) return null;

  return Sentry.startInactiveSpan({
    name,
    op,
    attributes: data as Record<string, string | number | boolean>,
  });
}

/**
 * Wrap an async function with Sentry transaction tracking
 */
export async function withTransaction<T>(
  name: string,
  op: string,
  fn: () => Promise<T>,
  context?: ErrorContext
): Promise<T> {
  if (!IS_SENTRY_ENABLED) {
    return fn();
  }

  return Sentry.startSpan(
    {
      name,
      op,
      attributes: {
        ...(context?.engine && { engine: context.engine }),
        ...(context?.requestId && { request_id: context.requestId }),
      },
    },
    async () => {
      try {
        return await fn();
      } catch (error) {
        captureException(error, context);
        throw error;
      }
    }
  );
}

/**
 * Flush pending events (useful before process exit)
 */
export async function flush(timeout = 2000): Promise<boolean> {
  if (!IS_SENTRY_ENABLED) return true;
  return Sentry.flush(timeout);
}

// Re-export Sentry for advanced usage
export { Sentry };
