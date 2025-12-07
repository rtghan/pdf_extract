import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import crypto, { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { uploadPdf, uploadMarkdown } from "@/lib/supabase/storage";

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

async function runPythonEngine(
  engine: EngineType,
  payload: string
): Promise<PythonResult> {
  const scriptPath = path.join(
    process.cwd(),
    "engines",
    "python",
    `${engine}_engine.py`
  );

  return new Promise((resolve, reject) => {
    const python = spawn("python", [scriptPath]);

    let output = "";
    let errorOutput = "";

    python.stdout.on("data", (data) => {
      output += data.toString();
    });

    python.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    python.on("error", (err) => {
      reject(new Error(`Failed to start Python: ${err.message}`));
    });

    python.stdin.on("error", () => {
      // Ignore stdin errors - we'll capture the actual error from stderr
    });

    python.on("close", (exitCode) => {
      resolve({ output, errorOutput, exitCode: exitCode ?? 1 });
    });

    python.stdin.write(payload, (err) => {
      if (err) {
        // stdin write failed, but let the process continue to capture stderr
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
      original_filename: file.name,
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

  try {
    // Check cache first
    const cacheKey = generateCacheKey(buffer, engine);
    const cachedResult = getCachedResult(cacheKey);

    if (cachedResult && cachedResult.success) {
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
        console.error("Failed to save cached conversion:", e);
      }

      return NextResponse.json({
        success: true,
        output: cachedResult.output,
        engine,
        cached: true,
        ...(conversionId && { conversionId }),
        ...(saved && { saved: true }),
      });
    }

    // Run Python engine
    const base64pdf = buffer.toString("base64");
    const payload = JSON.stringify({ pdf: base64pdf, ...extraPayload });
    const result = await runPythonEngine(engine, payload);

    // Handle Python errors
    if (result.exitCode !== 0) {
      const errorMessage = result.errorOutput || result.output || "Python error";
      console.error(`${engine} Python error:`, errorMessage);

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
        console.error("Failed to save failed conversion:", e);
      }

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

    return NextResponse.json({
      ...parsed,
      engine,
      ...(conversionId && { conversionId }),
      ...(saved && { saved: true }),
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

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
      console.error("Failed to save error conversion:", e);
    }

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
