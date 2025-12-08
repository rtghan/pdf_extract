import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  checkRateLimit,
  getClientIdentifier,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  processExtractionWithProgress,
  MAX_FILE_SIZE,
  ALLOWED_TYPES,
  EngineType,
  ProgressEvent,
} from "@/lib/extract-stream";
import { createRequestLogger, generateRequestId } from "@/lib/logger";
import { captureException, addBreadcrumb } from "@/lib/sentry";
import { metrics, METRIC_NAMES } from "@/lib/metrics";

export const runtime = "nodejs";

function validateEngine(engine: string | null): engine is EngineType {
  return engine === "markitdown" || engine === "tesseract" || engine === "mineru";
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  const startTime = performance.now();

  // Get user session for rate limiting
  const session = await auth();
  const userId = session?.user?.id;
  const identifier = getClientIdentifier(req, userId);

  const log = createRequestLogger(requestId, userId);
  log.info("Stream extraction request received", { path: "/api/extract/stream" });
  metrics.incrementCounter(METRIC_NAMES.HTTP_REQUEST_TOTAL, 1, { endpoint: "extract_stream", method: "POST" });

  // Apply rate limiting - stricter for anonymous users
  const rateLimit = userId
    ? RATE_LIMITS.extraction
    : RATE_LIMITS.extractionAnonymous;
  const rateLimitResult = checkRateLimit(identifier, rateLimit);

  if (!rateLimitResult.success) {
    log.warn("Rate limit exceeded", { identifier });
    metrics.incrementCounter(METRIC_NAMES.HTTP_REQUEST_ERRORS, 1, { endpoint: "extract_stream", reason: "rate_limit" });
    return rateLimitResult.response!;
  }

  // Parse form data
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const engine = form.get("engine") as string | null;

  // Validate engine
  if (!validateEngine(engine)) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Invalid engine. Must be markitdown, tesseract, or mineru" })}\n\n`,
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    );
  }

  // Validate file
  if (!file) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Missing file" })}\n\n`,
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    );
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Invalid file type. Only PDF files are allowed." })}\n\n`,
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` })}\n\n`,
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    );
  }

  // Get extra payload options (for mineru)
  const extraPayload: Record<string, unknown> = {};
  const cliArgsRaw = form.getAll("cli_args");
  if (cliArgsRaw.length > 0) {
    extraPayload.cli_args = cliArgsRaw.map((v) => String(v));
  }
  const timeoutParam = form.get("timeout_seconds");
  if (timeoutParam) {
    extraPayload.timeout_seconds = Number(timeoutParam);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  log.info("Starting stream extraction", { engine, filename: file.name, fileSize: file.size });
  addBreadcrumb("Stream extraction started", "extraction", { engine, fileSize: file.size });
  metrics.incrementCounter(METRIC_NAMES.EXTRACTION_TOTAL, 1, { engine, type: "stream" });

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: ProgressEvent) => {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      try {
        await processExtractionWithProgress({
          engine,
          file,
          buffer,
          extraPayload,
          onProgress: sendEvent,
        });

        const duration = Math.round(performance.now() - startTime);
        log.info("Stream extraction completed", { engine, duration_ms: duration });
        metrics.recordTiming(METRIC_NAMES.HTTP_REQUEST_DURATION, duration, { endpoint: "extract_stream", status: "success" });
      } catch (err) {
        const duration = Math.round(performance.now() - startTime);
        log.error("Stream extraction failed", err, { engine, duration_ms: duration });
        metrics.recordTiming(METRIC_NAMES.HTTP_REQUEST_DURATION, duration, { endpoint: "extract_stream", status: "error" });
        metrics.incrementCounter(METRIC_NAMES.EXTRACTION_ERRORS, 1, { engine, type: "stream" });
        captureException(err, { engine, requestId, userId });

        sendEvent({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-RateLimit-Limit": String(rateLimit.maxRequests),
      "X-RateLimit-Remaining": String(rateLimitResult.remaining),
      "X-RateLimit-Reset": String(Math.ceil(rateLimitResult.resetAt / 1000)),
      "X-Request-ID": requestId,
    },
  });
}
