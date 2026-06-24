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
          id: string
          name: string
          updated_at: string
          whatsapp_contact_id: string | null
          whatsapp_group_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          whatsapp_contact_id?: string | null
          whatsapp_group_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          whatsapp_contact_id?: string | null
          whatsapp_group_name?: string | null
        }
        Relationships: []
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
          start_date: string
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
          start_date?: string
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
          start_date?: string
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
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      generate_daily_tasks: { Args: { target_date?: string }; Returns: number }
      is_admin: { Args: never; Returns: boolean }
      my_collaborator_companies: { Args: never; Returns: string[] }
      my_consultant_companies: { Args: never; Returns: string[] }
      sync_template_instances: { Args: { p_template: string }; Returns: number }
      timer_start: { Args: { p_task: string }; Returns: string }
      timer_pause: { Args: { p_task: string }; Returns: number }
      timer_finish: {
        Args: { p_task: string; p_note: string; p_send: boolean }
        Returns: number
      }
    }
    Enums: {
      task_kind: "unica" | "diaria"
      task_status: "a_fazer" | "iniciada" | "finalizada" | "cancelada"
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
      task_kind: ["unica", "diaria"],
      task_status: ["a_fazer", "iniciada", "finalizada", "cancelada"],
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

export type Profile = Tables<"profiles">
export type Company = Tables<"companies">
export type CompanyConsultant = Tables<"company_consultants">
export type TaskTemplate = Tables<"task_templates">
export type TaskInstance = Tables<"task_instances">
export type TimeEntry = Tables<"time_entries">
export type ActivityLog = Tables<"activity_log">
