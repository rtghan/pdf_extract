import { NextRequest, NextResponse } from "next/server";
import { metrics } from "@/lib/metrics";

// Optional: Add basic auth protection for metrics endpoint
const METRICS_AUTH_TOKEN = process.env.METRICS_AUTH_TOKEN;

function isAuthorized(req: NextRequest): boolean {
  // If no token is configured, allow access (for local dev)
  if (!METRICS_AUTH_TOKEN) return true;

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;

  // Support both "Bearer <token>" and raw token
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  return token === METRICS_AUTH_TOKEN;
}

/**
 * GET /api/metrics - Export metrics in Prometheus format
 * GET /api/metrics?format=json - Export metrics as JSON
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const format = req.nextUrl.searchParams.get("format");

  if (format === "json") {
    return NextResponse.json(metrics.toJSON());
  }

  // Default: Prometheus format
  return new Response(metrics.toPrometheusFormat(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
