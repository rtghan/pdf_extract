import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { auth } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { uploadPdf, uploadMarkdown } from "@/lib/supabase/storage";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "Missing file" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64pdf = buffer.toString("base64");

    const scriptPath = path.join(
      process.cwd(),
      "engines",
      "python",
      "tesseract_engine.py"
    );

    const payload = JSON.stringify({ pdf: base64pdf });

    const result = await new Promise<{ output: string; errorOutput: string; exitCode: number }>((resolve, reject) => {
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

      python.stdin.on("error", (err) => {
        // Ignore stdin errors - we'll capture the actual error from stderr
      });

      python.on("close", (exitCode) => {
        resolve({ output, errorOutput, exitCode: exitCode ?? 1 });
      });

      // Write payload to stdin
      python.stdin.write(payload, (err) => {
        if (err) {
          // stdin write failed, but let the process continue to capture stderr
        }
        python.stdin.end();
      });
    });

    if (result.exitCode !== 0) {
      console.error("Tesseract Python error:", result.errorOutput || result.output);
      return NextResponse.json(
        {
          success: false,
          engine: "tesseract",
          error: result.errorOutput || result.output || "Python error"
        },
        { status: 500 }
      );
    }

    const parsed = JSON.parse(result.output);

    // If user is logged in, try to save to Supabase (non-blocking)
    let saved = false;
    let conversionId: string | undefined;

    try {
      const session = await auth();
      if (session?.user?.id && parsed.success) {
        const supabase = createServerClient();
        conversionId = randomUUID();
        const userId = session.user.id;

        // Upload files to storage
        const pdfPath = await uploadPdf(userId, conversionId, buffer);
        const mdPath = await uploadMarkdown(userId, conversionId, parsed.output);

        // Save metadata to database
        await supabase.from("conversions").insert({
          id: conversionId,
          user_id: userId,
          original_filename: file.name,
          file_size_bytes: file.size,
          engine: "tesseract",
          status: "completed",
          pdf_storage_path: pdfPath,
          markdown_storage_path: mdPath,
          markdown_preview: parsed.output.substring(0, 500),
          word_count: parsed.output.split(/\s+/).length,
          completed_at: new Date().toISOString(),
        });

        saved = true;
      }
    } catch (saveError) {
      console.error("Failed to save conversion:", saveError);
    }

    return NextResponse.json({
      ...parsed,
      ...(conversionId && { conversionId }),
      ...(saved && { saved: true }),
    });

  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}