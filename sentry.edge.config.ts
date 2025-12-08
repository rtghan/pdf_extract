// This file configures the initialization of Sentry for edge features (middleware, edge routes).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Adjust sample rates based on traffic volume
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Set to true to see console logs in development
    debug: false,
  });
}
