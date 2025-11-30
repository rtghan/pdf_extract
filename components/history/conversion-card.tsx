"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { FileText, Download, Trash2, Calendar, FileType } from "lucide-react"
import type { Conversion } from "@/types/database"

interface ConversionCardProps {
  conversion: Conversion
  onDelete: (id: string) => Promise<void>
}

export function ConversionCard({ conversion, onDelete }: ConversionCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await onDelete(conversion.id)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDownloadMarkdown = async () => {
    setIsDownloading(true)
    try {
      const response = await fetch(`/api/conversions/${conversion.id}`)
      const data = await response.json()

      if (data.markdownUrl) {
        // Fetch the markdown content as a blob
        const mdResponse = await fetch(data.markdownUrl)
        const blob = await mdResponse.blob()

        // Create a download link and trigger it
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = conversion.original_filename.replace(/\.pdf$/i, ".md")
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      console.error("Failed to download:", error)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <Card className="border-border bg-card/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base font-medium truncate max-w-[200px]">
              {conversion.original_filename}
            </CardTitle>
          </div>
          <Badge variant="secondary" className="text-xs">
            {conversion.engine}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {formatDate(conversion.created_at)}
          </div>
          <div className="flex items-center gap-1">
            <FileType className="h-3.5 w-3.5" />
            {formatFileSize(conversion.file_size_bytes)}
          </div>
          {conversion.word_count && (
            <span>{conversion.word_count.toLocaleString()} words</span>
          )}
        </div>

        {conversion.markdown_preview && (
          <p className="text-sm text-muted-foreground line-clamp-2 bg-muted/50 p-2 rounded">
            {conversion.markdown_preview}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadMarkdown}
            disabled={isDownloading}
            className="flex-1"
          >
            <Download className="h-4 w-4 mr-1" />
            {isDownloading ? "..." : "Download"}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Conversion?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the conversion and all associated
                  files. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}
