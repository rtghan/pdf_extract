import { NextRequest } from "next/server";
import { validateFile, processExtraction } from "@/lib/extract";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;

  const validation = validateFile(file);
  if (!validation.valid) {
    return validation.response;
  }

  const arrayBuffer = await file!.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return processExtraction({
    engine: "tesseract",
    file: file!,
    buffer,
  });
}
