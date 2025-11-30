"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ConversionHistory } from "@/components/history/conversion-history"
import { UserMenu } from "@/components/auth/user-menu"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export default function HistoryPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/")
    }
  }, [status, router])

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="h-8 w-48 bg-muted animate-pulse rounded mb-8" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-48 rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!session) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20">
      {/* Header */}
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
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8">
          <Link href="/">
            <Button variant="ghost" size="sm" className="mb-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Converter
            </Button>
          </Link>
          <h2 className="text-3xl font-bold tracking-tight">Conversion History</h2>
          <p className="text-muted-foreground mt-2">
            View and manage your past PDF conversions.
          </p>
        </div>

        <ConversionHistory />
      </main>
    </div>
  )
}
