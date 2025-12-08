// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a user visits your app.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Adjust sample rates based on traffic volume
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Set to true to see console logs in development
    debug: false,

    // Only enable replay in production
    replaysOnErrorSampleRate: process.env.NODE_ENV === "production" ? 1.0 : 0,
    replaysSessionSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,

    // Ignore common client-side errors
    ignoreErrors: [
      // Network errors
      "NetworkError",
      "Failed to fetch",
      "Load failed",
      "ChunkLoadError",
      // User aborted
      "AbortError",
      // Browser extensions
      "ResizeObserver loop",
    ],
  });
}
