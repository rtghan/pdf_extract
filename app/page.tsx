"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import PdfUploader from "@/components/pdf-uploader"
import ConversionResult from "@/components/conversion-result"
import { UserMenu } from "@/components/auth/user-menu"

const CONVERSION_ENGINES = [
  { id: "markitdown", name: "MarkItDown", endpoint: "/api/extract/markitdown" },
  { id: "tesseract", name: "Tesseract", endpoint: "/api/extract/tesseract" },
  { id: "mineru", name: "MinerU", endpoint: "/api/extract/mineru" }
]

interface ProgressState {
  percent: number
  message: string
  stage: string
}

export default function Page() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedEngine, setSelectedEngine] = useState(CONVERSION_ENGINES[0].id)
  const [isConverting, setIsConverting] = useState(false)
  const [markdownResult, setMarkdownResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [displayProgress, setDisplayProgress] = useState(0)
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Aesthetic progress bar animation - animates to ~50% while waiting for response
  useEffect(() => {
    if (isConverting && !markdownResult) {
      setDisplayProgress(0)
      progressIntervalRef.current = setInterval(() => {
        setDisplayProgress((prev) => {
          // Slow down as we approach 50%
          if (prev >= 50) return prev
          const increment = Math.max(0.5, (50 - prev) / 20)
          return Math.min(50, prev + increment)
        })
      }, 100)
    } else if (markdownResult) {
      // Jump to 100% when complete
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
      }
      setDisplayProgress(100)
    } else {
      // Reset when not converting
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
      }
      setDisplayProgress(0)
    }

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
      }
    }
  }, [isConverting, markdownResult])

  const handleConvert = useCallback(async () => {
    if (!selectedFile) {
      setError("Please upload a PDF file first")
      return
    }

    setIsConverting(true)
    setError(null)
    setMarkdownResult(null)
    setProgress({ percent: 0, message: "Starting conversion...", stage: "initializing" })

    try {
      const formData = new FormData()
      formData.append("file", selectedFile)
      formData.append("engine", selectedEngine)

      // Use streaming endpoint
      const response = await fetch("/api/extract/stream", {
        method: "POST",
        body: formData,
      })

      if (!response.ok && !response.body) {
        setError("Failed to start conversion")
        setIsConverting(false)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        setError("Failed to read response stream")
        setIsConverting(false)
        return
      }

      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6))

              if (event.type === "progress") {
                setProgress({
                  percent: event.percent ?? 0,
                  message: event.message ?? "Processing...",
                  stage: event.stage ?? "processing",
                })
              } else if (event.type === "result") {
                if (event.result?.success) {
                  setMarkdownResult(event.result.output)
                  setProgress({ percent: 100, message: "Complete!", stage: "complete" })
                } else {
                  setError(event.result?.error || "Conversion failed")
                }
                setIsConverting(false)
              } else if (event.type === "error") {
                setError(event.message || "Conversion failed")
                setIsConverting(false)
              }
            } catch (e) {
              console.error("Failed to parse SSE event:", e)
            }
          }
        }
      }
    } catch (err) {
      setError("Conversion failed. Please try again.")
      console.error(err)
    } finally {
      setIsConverting(false)
    }
  }, [selectedFile, selectedEngine])

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20">
      {/* Header with Login */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-accent" />
            <h1 className="text-xl font-bold">PDF Converter</h1>
          </div>
          <UserMenu />
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="space-y-6">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">Convert PDFs to Markdown</h2>
            <p className="text-muted-foreground">
              Upload your PDF file and select a conversion engine to transform it into Markdown text.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* PDF Upload Card */}
            <Card className="border-border bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle>Upload PDF File</CardTitle>
                <CardDescription>Drag and drop or click to select a PDF file (max 50MB)</CardDescription>
              </CardHeader>
              <CardContent>
                <PdfUploader selectedFile={selectedFile} onFileSelect={setSelectedFile} />
              </CardContent>
            </Card>

            {/* Markdown Preview */}
            <Card className="border-border bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle>Markdown Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <ConversionResult markdown={markdownResult} isLoading={isConverting} />
              </CardContent>
            </Card>
          </div>

          {/* Conversion Engine Selector */}
            <Card className="border-border bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle>Conversion Engine</CardTitle>
                <CardDescription>Choose the conversion engine that best suits your PDF</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select value={selectedEngine} onValueChange={setSelectedEngine}>
                  <SelectTrigger className="border-border bg-input">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONVERSION_ENGINES.map((engine) => (
                      <SelectItem key={engine.id} value={engine.id}>
                        {engine.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedEngine === "markitdown" && (
                  <p className="text-sm text-amber-600 dark:text-amber-500">
                    Note: MarkItDown only works with PDFs that contain selectable text.
                  </p>
                )}
                {selectedEngine === "mineru" && (
                  <p className="text-sm text-amber-600 dark:text-amber-500">
                    Note: MinerU will likely be significantly slower than other engines.
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  {selectedFile ? `File: ${selectedFile.name}` : "No file selected"}
                </p>
              </CardContent>
            </Card>

            {/* Progress Bar */}
            {isConverting && (
              <Card className="border-border bg-card/50 backdrop-blur-sm">
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{progress?.message || "Processing..."}</span>
                      <span className="font-medium">{Math.round(displayProgress)}%</span>
                    </div>
                    <Progress value={displayProgress} className="h-2" />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Convert Button */}
            <Button
              onClick={handleConvert}
              disabled={!selectedFile || isConverting}
              className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground font-semibold py-6 text-lg"
              size="lg"
            >
              {isConverting ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {progress?.message || "Converting..."}
                </div>
              ) : (
                "Convert to Markdown"
              )}
            </Button>

            {/* Error Message */}
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-destructive">
                <p className="font-semibold">Error</p>
                <p className="text-sm">{error}</p>
              </div>
            )}
        </div>
      </main>
    </div>
  )
}
