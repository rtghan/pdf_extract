"use client"

import { useState, useEffect } from "react"
import { ConversionCard } from "./conversion-card"
import type { Conversion } from "@/types/database"
import { FileX } from "lucide-react"

export function ConversionHistory() {
  const [conversions, setConversions] = useState<Conversion[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchConversions = async () => {
    try {
      const response = await fetch("/api/conversions")
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch conversions")
      }

      setConversions(data.conversions || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchConversions()
  }, [])

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/conversions/${id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete conversion")
      }

      setConversions((prev) => prev.filter((c) => c.id !== id))
    } catch (err: any) {
      console.error("Delete failed:", err)
    }
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-48 rounded-lg bg-muted/50 animate-pulse"
          />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  if (conversions.length === 0) {
    return (
      <div className="text-center py-12">
        <FileX className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No conversions yet</h3>
        <p className="text-muted-foreground">
          Your conversion history will appear here after you convert a PDF.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {conversions.map((conversion) => (
        <ConversionCard
          key={conversion.id}
          conversion={conversion}
          onDelete={handleDelete}
        />
      ))}
    </div>
  )
}
