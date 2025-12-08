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

  const arrayBuffer = await file!.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const response = await processExtraction({
    engine: "markitdown",
    file: file!,
    buffer,
  });

  return withRateLimitHeaders(response, rateLimitResult, rateLimit.maxRequests);
}
