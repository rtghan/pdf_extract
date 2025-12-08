import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import crypto, { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { uploadPdf, uploadMarkdown } from "@/lib/supabase/storage";
import { pythonProcessQueue } from "@/lib/process-queue";
import { sanitizeFilename } from "@/lib/sanitize";
import { Logger, createRequestLogger, generateRequestId } from "@/lib/logger";
import { captureException, addBreadcrumb, withTransaction } from "@/lib/sentry";
import { metrics, METRIC_NAMES, withMetrics } from "@/lib/metrics";

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const ALLOWED_TYPES = ["application/pdf"];

export type EngineType = "markitdown" | "mineru" | "tesseract";

interface ExtractOptions {
  engine: EngineType;
  file: File;
  buffer: Buffer;
  extraPayload?: Record<string, unknown>;
}

interface PythonResult {
  output: string;
  errorOutput: string;
  exitCode: number;
}

interface ConversionResult {
  success: boolean;
  output?: string;
  error?: string;
  engine: EngineType;
  cached?: boolean;
  conversionId?: string;
  saved?: boolean;
}

// In-memory cache for PDF conversions
// Key: hash of (file content + engine), Value: { result, timestamp }
const conversionCache = new Map<string, { result: ConversionResult; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function generateCacheKey(buffer: Buffer, engine: EngineType): string {
  const hash = crypto.createHash("sha256");
  hash.update(buffer);
  hash.update(engine);
  return hash.digest("hex");
}

function getCachedResult(cacheKey: string): ConversionResult | null {
  const cached = conversionCache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    conversionCache.delete(cacheKey);
    return null;
  }

  return { ...cached.result, cached: true };
}

function setCachedResult(cacheKey: string, result: ConversionResult): void {
  // Limit cache size to prevent memory issues
  if (conversionCache.size > 100) {
    // Remove oldest entries
    const entries = Array.from(conversionCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 20; i++) {
      conversionCache.delete(entries[i][0]);
    }
  }

  conversionCache.set(cacheKey, { result, timestamp: Date.now() });
}

export function validateFile(file: File | null): { valid: true } | { valid: false; response: NextResponse } {
  if (!file) {
    return {
      valid: false,
      response: NextResponse.json({ error: "Missing file" }, { status: 400 }),
    };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      response: NextResponse.json(
        { error: "Invalid file type. Only PDF files are allowed." },
        { status: 400 }
      ),
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      response: NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
        { status: 400 }
      ),
    };
  }

  return { valid: true };
}

// Default timeouts for each engine (in milliseconds)
const ENGINE_TIMEOUTS: Record<EngineType, number> = {
  markitdown: 120 * 1000, // 2 minutes
  tesseract: 300 * 1000, // 5 minutes (OCR is slower)
  mineru: 480 * 1000, // 8 minutes (most complex)
};

async function runPythonEngine(
  engine: EngineType,
  payload: string,
  timeoutMs?: number,
  logger?: Logger
): Promise<PythonResult> {
  const log = logger ?? new Logger({ engine });
  const scriptPath = path.join(
    process.cwd(),
    "engines",
    "python",
    `${engine}_engine.py`
  );

  const timeout = timeoutMs ?? ENGINE_TIMEOUTS[engine];
  const startTime = performance.now();

  log.debug("Starting Python engine", { scriptPath, timeout_ms: timeout });
  addBreadcrumb("Starting Python engine", "process", { engine, timeout });

  return new Promise((resolve, reject) => {
    const python = spawn("python", [scriptPath]);
    let isResolved = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    let output = "";
    let errorOutput = "";

    // Set up timeout to kill the process
    timeoutHandle = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        python.kill("SIGKILL");
        const duration = Math.round(performance.now() - startTime);

        log.warn("Python process timed out", { duration_ms: duration, timeout_ms: timeout });
        metrics.incrementCounter(METRIC_NAMES.PYTHON_PROCESS_TIMEOUTS, 1, { engine });
        metrics.recordTiming(METRIC_NAMES.PYTHON_PROCESS_DURATION, duration, { engine, status: "timeout" });

        resolve({
          output: JSON.stringify({
            success: false,
            error: `Process timed out after ${timeout / 1000} seconds`,
          }),
          errorOutput: `Timeout: Process exceeded ${timeout / 1000} second limit`,
          exitCode: 124, // Standard timeout exit code
        });
      }
    }, timeout);

    python.stdout.on("data", (data) => {
      output += data.toString();
    });

    python.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    python.on("error", (err) => {
      if (!isResolved) {
        isResolved = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const duration = Math.round(performance.now() - startTime);

        log.error("Failed to start Python process", err, { duration_ms: duration });
        metrics.recordTiming(METRIC_NAMES.PYTHON_PROCESS_DURATION, duration, { engine, status: "error" });

        reject(new Error(`Failed to start Python: ${err.message}`));
      }
    });

    python.stdin.on("error", () => {
      // Ignore stdin errors - we'll capture the actual error from stderr
    });

    python.on("close", (exitCode) => {
      if (!isResolved) {
        isResolved = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const duration = Math.round(performance.now() - startTime);
        const status = exitCode === 0 ? "success" : "error";

        log.debug("Python process completed", { exitCode, duration_ms: duration });
        metrics.recordTiming(METRIC_NAMES.PYTHON_PROCESS_DURATION, duration, { engine, status });

        resolve({ output, errorOutput, exitCode: exitCode ?? 1 });
      }
    });

    python.stdin.write(payload, (err) => {
      if (err) {
        log.warn("Failed to write to Python stdin", { error: err.message });
      }
      python.stdin.end();
    });
  });
}

async function saveConversion(params: {
  userId: string;
  file: File;
  buffer: Buffer;
  engine: EngineType;
  success: boolean;
  output?: string;
  errorMessage?: string;
}): Promise<{ conversionId: string; saved: boolean }> {
  const { userId, file, buffer, engine, success, output, errorMessage } = params;
  const supabase = createServerClient();
  const conversionId = randomUUID();

  try {
    let pdfPath: string | null = null;
    let mdPath: string | null = null;

    // Always upload PDF for tracking
    pdfPath = await uploadPdf(userId, conversionId, buffer);

    // Only upload markdown if successful
    if (success && output) {
      mdPath = await uploadMarkdown(userId, conversionId, output);
    }

    await supabase.from("conversions").insert({
      id: conversionId,
      user_id: userId,
      original_filename: sanitizeFilename(file.name, { allowedExtensions: ["pdf"] }),
      file_size_bytes: file.size,
      engine,
      status: success ? "completed" : "failed",
      pdf_storage_path: pdfPath,
      markdown_storage_path: mdPath,
      markdown_preview: success && output ? output.substring(0, 500) : null,
      word_count: success && output ? output.split(/\s+/).length : null,
      completed_at: success ? new Date().toISOString() : null,
      error_message: errorMessage ?? null,
    });

    return { conversionId, saved: true };
  } catch (saveError) {
    console.error("Failed to save conversion:", saveError);
    return { conversionId, saved: false };
  }
}

export async function processExtraction(options: ExtractOptions): Promise<NextResponse> {
  const { engine, file, buffer, extraPayload = {} } = options;
  const requestId = generateRequestId();
  const log = createRequestLogger(requestId).child({ engine, fileSize: file.size });
  const startTime = performance.now();

  log.info("Starting extraction", { filename: file.name });
  addBreadcrumb("Extraction started", "extraction", { engine, fileSize: file.size });
  metrics.incrementCounter(METRIC_NAMES.EXTRACTION_TOTAL, 1, { engine });

  try {
    // Check cache first
    const cacheKey = generateCacheKey(buffer, engine);
    const cachedResult = getCachedResult(cacheKey);

    if (cachedResult && cachedResult.success) {
      log.info("Cache hit", { cacheKey: cacheKey.substring(0, 16) });
      metrics.incrementCounter(METRIC_NAMES.EXTRACTION_CACHE_HITS, 1, { engine });

      // For cached results, still try to save to database if user is logged in
      let conversionId: string | undefined;
      let saved = false;

      try {
        const session = await auth();
        if (session?.user?.id) {
          const saveResult = await saveConversion({
            userId: session.user.id,
            file,
            buffer,
            engine,
            success: true,
            output: cachedResult.output,
          });
          conversionId = saveResult.conversionId;
          saved = saveResult.saved;
        }
      } catch (e) {
        log.error("Failed to save cached conversion", e);
      }

      const duration = Math.round(performance.now() - startTime);
      metrics.recordTiming(METRIC_NAMES.EXTRACTION_DURATION, duration, { engine, status: "cache_hit" });
      log.info("Extraction completed (cached)", { duration_ms: duration });

      return NextResponse.json({
        success: true,
        output: cachedResult.output,
        engine,
        cached: true,
        ...(conversionId && { conversionId }),
        ...(saved && { saved: true }),
      });
    }

    // Run Python engine with concurrency limiting
    const base64pdf = buffer.toString("base64");
    const payload = JSON.stringify({ pdf: base64pdf, ...extraPayload });

    // Extract custom timeout if provided (in seconds, convert to ms)
    const customTimeoutMs =
      typeof extraPayload.timeout_seconds === "number"
        ? extraPayload.timeout_seconds * 1000
        : undefined;

    log.debug("Submitting to process queue");
    addBreadcrumb("Submitting to process queue", "queue", { engine });

    const result = await pythonProcessQueue.execute(() =>
      runPythonEngine(engine, payload, customTimeoutMs, log)
    );

    // Handle Python errors
    if (result.exitCode !== 0) {
      const errorMessage = result.errorOutput || result.output || "Python error";
      log.error("Python engine failed", new Error(errorMessage), { exitCode: result.exitCode });

      metrics.incrementCounter(METRIC_NAMES.EXTRACTION_ERRORS, 1, { engine, reason: "python_error" });
      captureException(new Error(errorMessage), { engine, requestId, extras: { exitCode: result.exitCode } });

      // Save failed conversion to database
      let conversionId: string | undefined;
      try {
        const session = await auth();
        if (session?.user?.id) {
          const saveResult = await saveConversion({
            userId: session.user.id,
            file,
            buffer,
            engine,
            success: false,
            errorMessage,
          });
          conversionId = saveResult.conversionId;
        }
      } catch (e) {
        log.error("Failed to save failed conversion", e);
      }

      const duration = Math.round(performance.now() - startTime);
      metrics.recordTiming(METRIC_NAMES.EXTRACTION_DURATION, duration, { engine, status: "error" });

      // Try to parse JSON error from Python
      try {
        const parsed = JSON.parse(result.output || "{}");
        return NextResponse.json(
          { ...parsed, engine, ...(conversionId && { conversionId }) },
          { status: 500 }
        );
      } catch {
        return NextResponse.json(
          {
            success: false,
            engine,
            error: errorMessage,
            ...(conversionId && { conversionId }),
          },
          { status: 500 }
        );
      }
    }

    // Parse successful result
    const parsed = JSON.parse(result.output);
    log.debug("Python output parsed", { success: parsed.success });

    // Cache successful result
    if (parsed.success) {
      setCachedResult(cacheKey, {
        success: true,
        output: parsed.output,
        engine,
      });
      log.debug("Result cached", { cacheKey: cacheKey.substring(0, 16) });
    }

    // Save to database
    let conversionId: string | undefined;
    let saved = false;

    try {
      const session = await auth();
      if (session?.user?.id) {
        const saveResult = await saveConversion({
          userId: session.user.id,
          file,
          buffer,
          engine,
          success: parsed.success,
          output: parsed.output,
          errorMessage: parsed.error,
        });
        conversionId = saveResult.conversionId;
        saved = saveResult.saved;
        log.debug("Conversion saved to database", { conversionId, saved });
      }
    } catch (e) {
      log.error("Failed to save conversion", e);
    }

    const duration = Math.round(performance.now() - startTime);
    const status = parsed.success ? "success" : "error";
    metrics.recordTiming(METRIC_NAMES.EXTRACTION_DURATION, duration, { engine, status });
    log.info("Extraction completed", { success: parsed.success, duration_ms: duration, conversionId });

    return NextResponse.json({
      ...parsed,
      engine,
      ...(conversionId && { conversionId }),
      ...(saved && { saved: true }),
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    log.error("Extraction failed with exception", err);

    // Check if this is a queue-related error (server busy)
    const isQueueError =
      errorMessage.includes("Queue is full") ||
      errorMessage.includes("timed out waiting in queue") ||
      errorMessage.includes("Server is busy");

    // Don't save queue errors to database - they're not conversion failures
    if (isQueueError) {
      metrics.incrementCounter(METRIC_NAMES.QUEUE_REJECTIONS, 1, { engine });
      log.warn("Request rejected due to queue capacity", { error: errorMessage });

      const duration = Math.round(performance.now() - startTime);
      metrics.recordTiming(METRIC_NAMES.EXTRACTION_DURATION, duration, { engine, status: "queue_rejected" });

      return NextResponse.json(
        {
          success: false,
          engine,
          error: errorMessage,
        },
        { status: 503 } // Service Unavailable
      );
    }

    // Track non-queue errors
    metrics.incrementCounter(METRIC_NAMES.EXTRACTION_ERRORS, 1, { engine, reason: "exception" });
    captureException(err, { engine, requestId });

    // Try to save the error
    let conversionId: string | undefined;
    try {
      const session = await auth();
      if (session?.user?.id) {
        const saveResult = await saveConversion({
          userId: session.user.id,
          file,
          buffer,
          engine,
          success: false,
          errorMessage,
        });
        conversionId = saveResult.conversionId;
      }
    } catch (e) {
      log.error("Failed to save error conversion", e);
    }

    const duration = Math.round(performance.now() - startTime);
    metrics.recordTiming(METRIC_NAMES.EXTRACTION_DURATION, duration, { engine, status: "error" });

    return NextResponse.json(
      {
        success: false,
        engine,
        error: errorMessage,
        ...(conversionId && { conversionId }),
      },
      { status: 500 }
    );
  }
}
