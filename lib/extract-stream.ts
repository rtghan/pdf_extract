import { spawn } from "child_process";
import path from "path";
import crypto, { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { uploadPdf, uploadMarkdown } from "@/lib/supabase/storage";
import { sanitizeFilename } from "@/lib/sanitize";

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const ALLOWED_TYPES = ["application/pdf"];

export type EngineType = "markitdown" | "mineru" | "tesseract";

// Default timeouts for each engine (in milliseconds)
const ENGINE_TIMEOUTS: Record<EngineType, number> = {
  markitdown: 120 * 1000, // 2 minutes
  tesseract: 300 * 1000, // 5 minutes (OCR is slower)
  mineru: 480 * 1000, // 8 minutes (most complex)
};

export interface ProgressEvent {
  type: "progress" | "result" | "error";
  stage?: string;
  percent?: number;
  message?: string;
  result?: {
    success: boolean;
    output?: string;
    error?: string;
    engine: EngineType;
    conversionId?: string;
    saved?: boolean;
    cached?: boolean;
  };
}

interface StreamOptions {
  engine: EngineType;
  file: File;
  buffer: Buffer;
  extraPayload?: Record<string, unknown>;
  onProgress: (event: ProgressEvent) => void;
}

// In-memory cache for PDF conversions
const conversionCache = new Map<
  string,
  { result: { success: boolean; output?: string; engine: EngineType }; timestamp: number }
>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function generateCacheKey(buffer: Buffer, engine: EngineType): string {
  const hash = crypto.createHash("sha256");
  hash.update(buffer);
  hash.update(engine);
  return hash.digest("hex");
}

function getCachedResult(cacheKey: string) {
  const cached = conversionCache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    conversionCache.delete(cacheKey);
    return null;
  }

  return cached.result;
}

function setCachedResult(
  cacheKey: string,
  result: { success: boolean; output?: string; engine: EngineType }
): void {
  if (conversionCache.size > 100) {
    const entries = Array.from(conversionCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 20; i++) {
      conversionCache.delete(entries[i][0]);
    }
  }

  conversionCache.set(cacheKey, { result, timestamp: Date.now() });
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

    pdfPath = await uploadPdf(userId, conversionId, buffer);

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

/**
 * Run extraction with streaming progress updates
 */
export async function processExtractionWithProgress(
  options: StreamOptions
): Promise<void> {
  const { engine, file, buffer, extraPayload = {}, onProgress } = options;

  try {
    // Check cache first
    const cacheKey = generateCacheKey(buffer, engine);
    const cachedResult = getCachedResult(cacheKey);

    if (cachedResult && cachedResult.success) {
      onProgress({
        type: "progress",
        stage: "cache_hit",
        percent: 100,
        message: "Using cached result",
      });

      // Save to database if user is logged in
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
        console.error("Failed to save cached conversion:", e);
      }

      onProgress({
        type: "result",
        result: {
          success: true,
          output: cachedResult.output,
          engine,
          cached: true,
          conversionId,
          saved,
        },
      });
      return;
    }

    // Run Python engine with progress streaming
    const base64pdf = buffer.toString("base64");
    const payload = JSON.stringify({ pdf: base64pdf, ...extraPayload });

    const customTimeoutMs =
      typeof extraPayload.timeout_seconds === "number"
        ? extraPayload.timeout_seconds * 1000
        : undefined;

    const timeout = customTimeoutMs ?? ENGINE_TIMEOUTS[engine];

    const scriptPath = path.join(
      process.cwd(),
      "engines",
      "python",
      `${engine}_engine.py`
    );

    await new Promise<void>((resolve, reject) => {
      const python = spawn("python", [scriptPath]);
      let isResolved = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      let output = "";
      let errorOutput = "";

      // Set up timeout
      timeoutHandle = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          python.kill("SIGKILL");
          onProgress({
            type: "error",
            message: `Process timed out after ${timeout / 1000} seconds`,
          });
          resolve();
        }
      }, timeout);

      // Capture stdout (final result)
      python.stdout.on("data", (data) => {
        output += data.toString();
      });

      // Capture stderr (progress events)
      python.stderr.on("data", (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const progress = JSON.parse(line);
            if (progress.type === "progress") {
              onProgress({
                type: "progress",
                stage: progress.stage,
                percent: progress.percent,
                message: progress.message,
              });
            }
          } catch {
            // Not JSON, append to errorOutput
            errorOutput += line + "\n";
          }
        }
      });

      python.on("error", (err) => {
        if (!isResolved) {
          isResolved = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          onProgress({
            type: "error",
            message: `Failed to start Python: ${err.message}`,
          });
          resolve();
        }
      });

      python.stdin.on("error", () => {
        // Ignore stdin errors
      });

      python.on("close", async (exitCode) => {
        if (isResolved) return;
        isResolved = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);

        // Process result
        if (exitCode !== 0) {
          const errorMessage = errorOutput || output || "Python error";

          // Save failed conversion
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
            console.error("Failed to save failed conversion:", e);
          }

          onProgress({
            type: "result",
            result: {
              success: false,
              error: errorMessage,
              engine,
              conversionId,
            },
          });
          resolve();
          return;
        }

        // Parse successful result
        try {
          const parsed = JSON.parse(output);

          // Cache successful result
          if (parsed.success) {
            setCachedResult(cacheKey, {
              success: true,
              output: parsed.output,
              engine,
            });
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
            }
          } catch (e) {
            console.error("Failed to save conversion:", e);
          }

          onProgress({
            type: "result",
            result: {
              success: parsed.success,
              output: parsed.output,
              error: parsed.error,
              engine,
              conversionId,
              saved,
            },
          });
        } catch {
          onProgress({
            type: "error",
            message: "Failed to parse Python output",
          });
        }

        resolve();
      });

      python.stdin.write(payload, (err) => {
        if (err) {
          // stdin write failed
        }
        python.stdin.end();
      });
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    onProgress({
      type: "error",
      message: errorMessage,
    });
  }
}
