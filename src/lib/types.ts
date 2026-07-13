export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          id: string
          message: string
          seconds_spent: number
          sent_whatsapp: boolean
          task_id: string | null
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          id?: string
          message: string
          seconds_spent?: number
          sent_whatsapp?: boolean
          task_id?: string | null
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          id?: string
          message?: string
          seconds_spent?: number
          sent_whatsapp?: boolean
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
          whatsapp_contact_id: string | null
          whatsapp_group_name: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
          whatsapp_contact_id?: string | null
          whatsapp_group_name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
          whatsapp_contact_id?: string | null
          whatsapp_group_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_consultants: {
        Row: {
          assigned_at: string
          company_id: string
          consultant_id: string
        }
        Insert: {
          assigned_at?: string
          company_id: string
          consultant_id: string
        }
        Update: {
          assigned_at?: string
          company_id?: string
          consultant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_consultants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_consultants_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_labels: {
        Row: {
          company_id: string
          created_at: string
          label_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          label_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_labels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      company_notes: {
        Row: {
          attachments: Json
          author_id: string
          company_id: string
          content_html: string
          created_at: string
          id: string
          updated_at: string | null
          updated_by: string | null
          visible_to_client: boolean
        }
        Insert: {
          attachments?: Json
          author_id: string
          company_id: string
          content_html: string
          created_at?: string
          id?: string
          updated_at?: string | null
          updated_by?: string | null
          visible_to_client?: boolean
        }
        Update: {
          attachments?: Json
          author_id?: string
          company_id?: string
          content_html?: string
          created_at?: string
          id?: string
          updated_at?: string | null
          updated_by?: string | null
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "company_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          bg_color: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          text_color: string
        }
        Insert: {
          bg_color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          text_color?: string
        }
        Update: {
          bg_color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          text_color?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_brands: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
          template_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position?: number
          template_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_brands_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_results: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          link: string | null
          marketplace: Database["public"]["Enums"]["listing_marketplace"]
          not_done_reason: string | null
          task_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          link?: string | null
          marketplace: Database["public"]["Enums"]["listing_marketplace"]
          not_done_reason?: string | null
          task_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          link?: string | null
          marketplace?: Database["public"]["Enums"]["listing_marketplace"]
          not_done_reason?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_results_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "listing_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_results_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      standard_tasks: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          description: string | null
          due_time: string | null
          id: string
          instructions: string | null
          kind: Database["public"]["Enums"]["task_kind"]
          title: string
          updated_at: string
          weekdays: number[] | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          description?: string | null
          due_time?: string | null
          id?: string
          instructions?: string | null
          kind: Database["public"]["Enums"]["task_kind"]
          title: string
          updated_at?: string
          weekdays?: number[] | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          description?: string | null
          due_time?: string | null
          id?: string
          instructions?: string | null
          kind?: Database["public"]["Enums"]["task_kind"]
          title?: string
          updated_at?: string
          weekdays?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "standard_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_instances: {
        Row: {
          collaborator_id: string
          company_id: string
          completion_note: string | null
          created_at: string
          description: string | null
          due_at: string | null
          finished_at: string | null
          id: string
          instructions: string | null
          note_sent_whatsapp: boolean
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_date: string
          template_id: string | null
          title: string
          total_seconds: number
        }
        Insert: {
          collaborator_id: string
          company_id: string
          completion_note?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          finished_at?: string | null
          id?: string
          instructions?: string | null
          note_sent_whatsapp?: boolean
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_date?: string
          template_id?: string | null
          title: string
          total_seconds?: number
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          completion_note?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          finished_at?: string | null
          id?: string
          instructions?: string | null
          note_sent_whatsapp?: boolean
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_date?: string
          template_id?: string | null
          title?: string
          total_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_instances_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          active: boolean
          collaborator_id: string
          company_id: string
          created_at: string
          created_by: string
          description: string | null
          due_time: string | null
          end_date: string | null
          id: string
          instructions: string | null
          kind: Database["public"]["Enums"]["task_kind"]
          listing_marketplaces: Database["public"]["Enums"]["listing_marketplace"][]
          listing_needs_margin: boolean
          listing_tax_rate: number | null
          standard_task_id: string | null
          start_date: string
          template_type: Database["public"]["Enums"]["template_type"]
          title: string
          weekdays: number[] | null
        }
        Insert: {
          active?: boolean
          collaborator_id: string
          company_id: string
          created_at?: string
          created_by: string
          description?: string | null
          due_time?: string | null
          end_date?: string | null
          id?: string
          instructions?: string | null
          kind: Database["public"]["Enums"]["task_kind"]
          listing_marketplaces?: Database["public"]["Enums"]["listing_marketplace"][]
          listing_needs_margin?: boolean
          listing_tax_rate?: number | null
          standard_task_id?: string | null
          start_date?: string
          template_type?: Database["public"]["Enums"]["template_type"]
          title: string
          weekdays?: number[] | null
        }
        Update: {
          active?: boolean
          collaborator_id?: string
          company_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_time?: string | null
          end_date?: string | null
          id?: string
          instructions?: string | null
          kind?: Database["public"]["Enums"]["task_kind"]
          listing_marketplaces?: Database["public"]["Enums"]["listing_marketplace"][]
          listing_needs_margin?: boolean
          listing_tax_rate?: number | null
          standard_task_id?: string | null
          start_date?: string
          template_type?: Database["public"]["Enums"]["template_type"]
          title?: string
          weekdays?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_standard_task_id_fkey"
            columns: ["standard_task_id"]
            isOneToOne: false
            referencedRelation: "standard_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      time_adjustments: {
        Row: {
          adjusted_by: string
          created_at: string
          id: string
          new_seconds: number
          old_seconds: number
          reason: string | null
          task_id: string
        }
        Insert: {
          adjusted_by: string
          created_at?: string
          id?: string
          new_seconds: number
          old_seconds: number
          reason?: string | null
          task_id: string
        }
        Update: {
          adjusted_by?: string
          created_at?: string
          id?: string
          new_seconds?: number
          old_seconds?: number
          reason?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_adjustments_adjusted_by_fkey"
            columns: ["adjusted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_adjustments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          collaborator_id: string
          created_at: string
          ended_at: string | null
          id: string
          seconds: number | null
          started_at: string
          task_id: string
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          seconds?: number | null
          started_at: string
          task_id: string
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          seconds?: number | null
          started_at?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_adjust_time: {
        Args: { p_new_seconds: number; p_reason?: string; p_task: string }
        Returns: number
      }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      company_collaborator_summary: {
        Args: { p_company_id: string; p_start: string }
        Returns: {
          avatar_path: string
          collaborator_id: string
          done: number
          email: string
          full_name: string
          seconds: number
          total: number
        }[]
      }
      company_overview: {
        Args: { p_company_id: string; p_month_start: string; p_start: string }
        Returns: {
          a_fazer: number
          cancelada: number
          finalizada: number
          iniciada: number
          overdue: number
          seconds_all: number
          seconds_month: number
          seconds_period: number
          total: number
        }[]
      }
      display_names: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
          name: string
        }[]
      }
      generate_daily_tasks: { Args: { target_date?: string }; Returns: number }
      generate_template_today: {
        Args: { p_template: string }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      my_collaborator_companies: { Args: never; Returns: string[] }
      my_consultant_companies: { Args: never; Returns: string[] }
      sync_standard_task: { Args: { p_standard: string }; Returns: number }
      sync_template_instances: { Args: { p_template: string }; Returns: number }
      timer_finish: {
        Args: { p_note: string; p_send: boolean; p_task: string }
        Returns: number
      }
      timer_finish_listing: {
        Args: {
          p_note: string
          p_results: Json
          p_send: boolean
          p_task: string
        }
        Returns: number
      }
      timer_pause: { Args: { p_task: string }; Returns: number }
      timer_start: { Args: { p_task: string }; Returns: string }
    }
    Enums: {
      listing_marketplace: "mercado_livre" | "shopee" | "amazon"
      task_kind: "unica" | "diaria"
      task_status: "a_fazer" | "iniciada" | "finalizada" | "cancelada"
      template_type: "padrao" | "listagem"
      user_role: "admin" | "consultor" | "colaborador" | "pending"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      listing_marketplace: ["mercado_livre", "shopee", "amazon"],
      task_kind: ["unica", "diaria"],
      task_status: ["a_fazer", "iniciada", "finalizada", "cancelada"],
      template_type: ["padrao", "listagem"],
      user_role: ["admin", "consultor", "colaborador", "pending"],
    },
  },
} as const

// ---------------------------------------------------------------------------
// Aliases de conveniência (derivados do schema gerado acima).
// Mantêm os nomes usados pelo app sem precisar referenciar Tables<...> direto.
// ---------------------------------------------------------------------------

export type Role = Database["public"]["Enums"]["user_role"]
export type TaskKind = Database["public"]["Enums"]["task_kind"]
export type TaskStatus = Database["public"]["Enums"]["task_status"]
export type TemplateType = Database["public"]["Enums"]["template_type"]
export type ListingMarketplace = Database["public"]["Enums"]["listing_marketplace"]

export type Profile = Tables<"profiles">
export type Company = Tables<"companies">
export type CompanyConsultant = Tables<"company_consultants">
export type TaskTemplate = Tables<"task_templates">
export type TaskInstance = Tables<"task_instances">
export type TimeEntry = Tables<"time_entries">
export type ActivityLog = Tables<"activity_log">
export type StandardTask = Tables<"standard_tasks">
export type TimeAdjustment = Tables<"time_adjustments">
export type ListingBrand = Tables<"listing_brands">
export type CompanyNote = Tables<"company_notes">
export type ListingResult = Tables<"listing_results">
