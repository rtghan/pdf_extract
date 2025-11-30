import { createServerClient } from "./server"

export async function uploadPdf(
  userId: string,
  conversionId: string,
  fileBuffer: Buffer
): Promise<string> {
  const supabase = createServerClient()
  const path = `${userId}/${conversionId}.pdf`

  const { error } = await supabase.storage
    .from("pdfs")
    .upload(path, fileBuffer, {
      contentType: "application/pdf",
      upsert: false,
    })

  if (error) throw error
  return path
}

export async function uploadMarkdown(
  userId: string,
  conversionId: string,
  markdown: string
): Promise<string> {
  const supabase = createServerClient()
  const path = `${userId}/${conversionId}.md`

  const { error } = await supabase.storage
    .from("markdown")
    .upload(path, markdown, {
      contentType: "text/markdown",
      upsert: false,
    })

  if (error) throw error
  return path
}

export async function getSignedUrl(
  bucket: "pdfs" | "markdown",
  path: string,
  expiresIn = 3600
): Promise<string> {
  const supabase = createServerClient()

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn)

  if (error) throw error
  return data.signedUrl
}

export async function deleteFile(
  bucket: "pdfs" | "markdown",
  path: string
): Promise<void> {
  const supabase = createServerClient()

  const { error } = await supabase.storage.from(bucket).remove([path])

  if (error) throw error
}
