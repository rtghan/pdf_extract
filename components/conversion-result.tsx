"use client"

import { Loader2, Copy, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState } from "react"

interface ConversionResultProps {
  markdown: string | null
  isLoading: boolean
}

export default function ConversionResult({ markdown, isLoading }: ConversionResultProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (markdown) {
      navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDownload = () => {
    if (markdown) {
      const element = document.createElement("a")
      const file = new Blob([markdown], { type: "text/markdown" })
      element.href = URL.createObjectURL(file)
      element.download = "converted.md"
      document.body.appendChild(element)
      element.click()
      document.body.removeChild(element)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Converting...</p>
      </div>
    )
  }

  if (!markdown) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <div className="h-10 w-10 rounded-lg bg-secondary" />
        <p className="text-sm text-muted-foreground">Your converted markdown will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={handleCopy} className="flex-1 bg-transparent">
          <Copy className="h-4 w-4" />
          {copied ? "Copied!" : "Copy"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleDownload} className="flex-1 bg-transparent">
          <Download className="h-4 w-4" />
          Download
        </Button>
      </div>

      <div className="max-h-96 overflow-y-auto rounded-lg bg-secondary/30 p-4 border border-border">
        <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
          <pre className="text-xs whitespace-pre-wrap break-words font-mono text-muted-foreground">{markdown}</pre>
        </div>
      </div>
    </div>
  )
}
