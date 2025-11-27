import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const cliArgsRaw = form.getAll("cli_args");
    // form.getAll returns array of FormDataEntryValue; normalize to string[]
    const cli_args = cliArgsRaw.map((v) => String(v));

    // Optional timeout (seconds) param
    const timeoutParam = form.get("timeout_seconds");
    const timeout_seconds = timeoutParam ? Number(timeoutParam) : undefined;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64pdf = buffer.toString("base64");

    const scriptPath = path.join(process.cwd(), "engines", "python", "mineru_engine.py");

    const payloadObj: any = { pdf: base64pdf };
    if (cli_args && cli_args.length > 0) payloadObj.cli_args = cli_args;
    if (timeout_seconds) payloadObj.timeout_seconds = timeout_seconds;

    const payload = JSON.stringify(payloadObj);

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
      // Try to return whatever JSON the script produced; otherwise send stderr.
      console.error("MinerU Python error:", result.errorOutput || result.output);
      try {
        const parsed = JSON.parse(result.output || "{}");
        return NextResponse.json(parsed, { status: 500 });
      } catch (e) {
        return NextResponse.json(
          {
            success: false,
            engine: "mineru",
            error: result.errorOutput || result.output || "MinerU engine failed"
          },
          { status: 500 }
        );
      }
    }

    const parsed = JSON.parse(result.output);
    return NextResponse.json(parsed);

  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}