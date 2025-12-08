/**
 * Next.js instrumentation file
 * This runs once when the server starts up
 */

export async function register() {
  // Initialize Sentry for server-side error tracking
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }

  // Log startup information
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Application starting",
      context: {
        runtime: process.env.NEXT_RUNTIME || "unknown",
        nodeEnv: process.env.NODE_ENV,
        sentryEnabled: !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
      },
    })
  );
}
