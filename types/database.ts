export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          name: string | null
          email: string | null
          email_verified: string | null
          image: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name?: string | null
          email?: string | null
          email_verified?: string | null
          image?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string | null
          email?: string | null
          email_verified?: string | null
          image?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversions: {
        Row: {
          id: string
          user_id: string
          original_filename: string
          file_size_bytes: number
          engine: string
          status: string
          pdf_storage_path: string | null
          markdown_storage_path: string | null
          markdown_preview: string | null
          word_count: number | null
          created_at: string
          completed_at: string | null
          error_message: string | null
        }
        Insert: {
          id?: string
          user_id: string
          original_filename: string
          file_size_bytes: number
          engine: string
          status?: string
          pdf_storage_path?: string | null
          markdown_storage_path?: string | null
          markdown_preview?: string | null
          word_count?: number | null
          created_at?: string
          completed_at?: string | null
          error_message?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          original_filename?: string
          file_size_bytes?: number
          engine?: string
          status?: string
          pdf_storage_path?: string | null
          markdown_storage_path?: string | null
          markdown_preview?: string | null
          word_count?: number | null
          created_at?: string
          completed_at?: string | null
          error_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type User = Database["public"]["Tables"]["users"]["Row"]
export type Conversion = Database["public"]["Tables"]["conversions"]["Row"]
export type NewConversion = Database["public"]["Tables"]["conversions"]["Insert"]
