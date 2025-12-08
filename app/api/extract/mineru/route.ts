import { NextRequest } from "next/server";
import { validateFile, processExtraction } from "@/lib/extract";
import { auth } from "@/lib/auth";
import {
  checkRateLimit,
  getClientIdentifier,
  RATE_LIMITS,
  withRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Get user session for rate limiting
  const session = await auth();
  const userId = session?.user?.id;
  const identifier = getClientIdentifier(req, userId);

  // Apply rate limiting - stricter for anonymous users
  const rateLimit = userId ? RATE_LIMITS.extraction : RATE_LIMITS.extractionAnonymous;
  const rateLimitResult = checkRateLimit(identifier, rateLimit);

  if (!rateLimitResult.success) {
    return rateLimitResult.response!;
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;

  const validation = validateFile(file);
  if (!validation.valid) {
    return validation.response;
  }

  // MinerU-specific options
  const cliArgsRaw = form.getAll("cli_args");
  const cli_args = cliArgsRaw.map((v) => String(v));
  const timeoutParam = form.get("timeout_seconds");
  const timeout_seconds = timeoutParam ? Number(timeoutParam) : undefined;

  const extraPayload: Record<string, unknown> = {};
  if (cli_args.length > 0) extraPayload.cli_args = cli_args;
  if (timeout_seconds) extraPayload.timeout_seconds = timeout_seconds;

  const arrayBuffer = await file!.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const response = await processExtraction({
    engine: "mineru",
    file: file!,
    buffer,
    extraPayload,
  });

  return withRateLimitHeaders(response, rateLimitResult, rateLimit.maxRequests);
}
