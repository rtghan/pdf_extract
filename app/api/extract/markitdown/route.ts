import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

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
      "markitdown_engine.py"
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
      return NextResponse.json(
        {
          success: false,
          engine: "markitdown",
          error: "Python error",
          details: result.errorOutput || result.output
        },
        { status: 500 }
      );
    }

    const parsed = JSON.parse(result.output);
    return NextResponse.json(parsed);

  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}