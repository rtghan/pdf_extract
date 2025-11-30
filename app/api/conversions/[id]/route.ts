import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { getSignedUrl, deleteFile } from "@/lib/supabase/storage";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from("conversions")
      .select("*")
      .eq("id", id)
      .eq("user_id", session.user.id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Conversion not found" },
        { status: 404 }
      );
    }

    // Generate signed URLs for file downloads
    let pdfUrl = null;
    let markdownUrl = null;

    if (data.pdf_storage_path) {
      try {
        pdfUrl = await getSignedUrl("pdfs", data.pdf_storage_path);
      } catch (e) {
        console.error("Failed to get PDF signed URL:", e);
      }
    }

    if (data.markdown_storage_path) {
      try {
        markdownUrl = await getSignedUrl("markdown", data.markdown_storage_path);
      } catch (e) {
        console.error("Failed to get markdown signed URL:", e);
      }
    }

    return NextResponse.json({
      conversion: data,
      pdfUrl,
      markdownUrl,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const supabase = createServerClient();

    // First get the conversion to get file paths
    const { data, error: fetchError } = await supabase
      .from("conversions")
      .select("*")
      .eq("id", id)
      .eq("user_id", session.user.id)
      .single();

    if (fetchError || !data) {
      return NextResponse.json(
        { error: "Conversion not found" },
        { status: 404 }
      );
    }

    // Delete files from storage
    if (data.pdf_storage_path) {
      try {
        await deleteFile("pdfs", data.pdf_storage_path);
      } catch (e) {
        console.error("Failed to delete PDF:", e);
      }
    }

    if (data.markdown_storage_path) {
      try {
        await deleteFile("markdown", data.markdown_storage_path);
      } catch (e) {
        console.error("Failed to delete markdown:", e);
      }
    }

    // Delete from database
    const { error: deleteError } = await supabase
      .from("conversions")
      .delete()
      .eq("id", id)
      .eq("user_id", session.user.id);

    if (deleteError) {
      return NextResponse.json(
        { error: "Failed to delete conversion" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
