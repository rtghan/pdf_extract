"use client"

import type React from "react"

import { useRef } from "react"
import { Upload } from "lucide-react"
import { cn } from "@/lib/utils"

interface PdfUploaderProps {
  selectedFile: File | null
  onFileSelect: (file: File) => void
}

export default function PdfUploader({ selectedFile, onFileSelect }: PdfUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const files = e.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      if (file.type === "application/pdf") {
        onFileSelect(file)
      }
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      onFileSelect(e.target.files[0])
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "relative rounded-lg border-2 border-dashed transition-colors cursor-pointer",
        selectedFile ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/50 hover:bg-primary/5",
      )}
    >
      <input ref={inputRef} type="file" accept=".pdf" onChange={handleFileInput} className="hidden" />

      <div className="flex flex-col items-center justify-center gap-3 py-12 px-6">
        <div className={cn("rounded-lg p-3 transition-colors", selectedFile ? "bg-primary/10" : "bg-secondary")}>
          <Upload className={cn("h-6 w-6", selectedFile ? "text-primary" : "text-muted-foreground")} />
        </div>

        {selectedFile ? (
          <div className="text-center">
            <p className="font-semibold text-foreground">{selectedFile.name}</p>
            <p className="text-sm text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        ) : (
          <div className="text-center">
            <p className="font-semibold">Drag and drop your PDF here</p>
            <p className="text-sm text-muted-foreground">or click to browse</p>
          </div>
        )}
      </div>
    </div>
  )
}
