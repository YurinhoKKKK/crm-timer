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
      attendance_entries: {
        Row: {
          auto_closed: boolean
          company_id: string
          created_at: string
          ended_at: string | null
          id: string
          started_at: string
          user_id: string
        }
        Insert: {
          auto_closed?: boolean
          company_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          started_at?: string
          user_id: string
        }
        Update: {
          auto_closed?: boolean
          company_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_estimates: {
        Row: {
          broadcast_msgs: number
          client_msgs: number
          computed_at: string
          contact_id: string
          day: string
          digisac_user_id: string | null
          long_sessions: number
          minutes: number
          overlap_controle_conta_minutes: number
          overlap_same_company_minutes: number
          overlap_task_minutes: number
          sessions: number
          team_msgs: number
        }
        Insert: {
          broadcast_msgs?: number
          client_msgs?: number
          computed_at?: string
          contact_id: string
          day: string
          digisac_user_id?: string | null
          long_sessions?: number
          minutes?: number
          overlap_controle_conta_minutes?: number
          overlap_same_company_minutes?: number
          overlap_task_minutes?: number
          sessions?: number
          team_msgs?: number
        }
        Update: {
          broadcast_msgs?: number
          client_msgs?: number
          computed_at?: string
          contact_id?: string
          day?: string
          digisac_user_id?: string | null
          long_sessions?: number
          minutes?: number
          overlap_controle_conta_minutes?: number
          overlap_same_company_minutes?: number
          overlap_task_minutes?: number
          sessions?: number
          team_msgs?: number
        }
        Relationships: []
      }
      attendance_params: {
        Row: {
          broadcast_min_groups: number
          broadcast_window_seconds: number
          calibrated: boolean
          calibrated_at: string | null
          floor_minutes: number
          gap_minutes: number
          id: boolean
          long_session_minutes: number
          prep_minutes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          broadcast_min_groups?: number
          broadcast_window_seconds?: number
          calibrated?: boolean
          calibrated_at?: string | null
          floor_minutes?: number
          gap_minutes?: number
          id?: boolean
          long_session_minutes?: number
          prep_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          broadcast_min_groups?: number
          broadcast_window_seconds?: number
          calibrated?: boolean
          calibrated_at?: string | null
          floor_minutes?: number
          gap_minutes?: number
          id?: boolean
          long_session_minutes?: number
          prep_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_params_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sessions: {
        Row: {
          client_msgs: number
          computed_at: string
          contact_id: string
          day: string
          digisac_user_id: string | null
          ended_at: string
          id: string
          is_long: boolean
          minutes: number
          overlap_controle_conta_minutes: number
          overlap_same_company_minutes: number
          overlap_task_minutes: number
          started_at: string
          team_msgs: number
        }
        Insert: {
          client_msgs?: number
          computed_at?: string
          contact_id: string
          day: string
          digisac_user_id?: string | null
          ended_at: string
          id?: string
          is_long?: boolean
          minutes: number
          overlap_controle_conta_minutes?: number
          overlap_same_company_minutes?: number
          overlap_task_minutes?: number
          started_at: string
          team_msgs?: number
        }
        Update: {
          client_msgs?: number
          computed_at?: string
          contact_id?: string
          day?: string
          digisac_user_id?: string | null
          ended_at?: string
          id?: string
          is_long?: boolean
          minutes?: number
          overlap_controle_conta_minutes?: number
          overlap_same_company_minutes?: number
          overlap_task_minutes?: number
          started_at?: string
          team_msgs?: number
        }
        Relationships: []
      }
      backup_company_details_model_20261008: {
        Row: {
          company_id: string | null
          project_model: Database["public"]["Enums"]["project_model"] | null
        }
        Insert: {
          company_id?: string | null
          project_model?: Database["public"]["Enums"]["project_model"] | null
        }
        Update: {
          company_id?: string | null
          project_model?: Database["public"]["Enums"]["project_model"] | null
        }
        Relationships: []
      }
      backup_company_labels_20261008: {
        Row: {
          company_id: string | null
          created_at: string | null
          label_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          label_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          label_id?: string | null
        }
        Relationships: []
      }
      backup_expiracao_20261016_task_instances: {
        Row: {
          client_hidden: boolean | null
          collaborator_id: string | null
          company_id: string | null
          completion_note: string | null
          created_at: string | null
          description: string | null
          due_at: string | null
          finished_at: string | null
          id: string | null
          instructions: string | null
          note_sent_whatsapp: boolean | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          task_date: string | null
          template_id: string | null
          title: string | null
          total_seconds: number | null
        }
        Insert: {
          client_hidden?: boolean | null
          collaborator_id?: string | null
          company_id?: string | null
          completion_note?: string | null
          created_at?: string | null
          description?: string | null
          due_at?: string | null
          finished_at?: string | null
          id?: string | null
          instructions?: string | null
          note_sent_whatsapp?: boolean | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"] | null
          task_date?: string | null
          template_id?: string | null
          title?: string | null
          total_seconds?: number | null
        }
        Update: {
          client_hidden?: boolean | null
          collaborator_id?: string | null
          company_id?: string | null
          completion_note?: string | null
          created_at?: string | null
          description?: string | null
          due_at?: string | null
          finished_at?: string | null
          id?: string | null
          instructions?: string | null
          note_sent_whatsapp?: boolean | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"] | null
          task_date?: string | null
          template_id?: string | null
          title?: string | null
          total_seconds?: number | null
        }
        Relationships: []
      }
      backup_feriado_20261012_activity_log: {
        Row: {
          collaborator_id: string | null
          company_id: string | null
          created_at: string | null
          id: string | null
          message: string | null
          seconds_spent: number | null
          sent_whatsapp: boolean | null
          task_id: string | null
        }
        Insert: {
          collaborator_id?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          message?: string | null
          seconds_spent?: number | null
          sent_whatsapp?: boolean | null
          task_id?: string | null
        }
        Update: {
          collaborator_id?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          message?: string | null
          seconds_spent?: number | null
          sent_whatsapp?: boolean | null
          task_id?: string | null
        }
        Relationships: []
      }
      backup_feriado_20261012_listing_results: {
        Row: {
          brand_id: string | null
          created_at: string | null
          id: string | null
          link: string | null
          marketplace: Database["public"]["Enums"]["listing_marketplace"] | null
          not_done_reason: string | null
          task_id: string | null
        }
        Insert: {
          brand_id?: string | null
          created_at?: string | null
          id?: string | null
          link?: string | null
          marketplace?:
            | Database["public"]["Enums"]["listing_marketplace"]
            | null
          not_done_reason?: string | null
          task_id?: string | null
        }
        Update: {
          brand_id?: string | null
          created_at?: string | null
          id?: string | null
          link?: string | null
          marketplace?:
            | Database["public"]["Enums"]["listing_marketplace"]
            | null
          not_done_reason?: string | null
          task_id?: string | null
        }
        Relationships: []
      }
      backup_feriado_20261012_task_instances: {
        Row: {
          client_hidden: boolean | null
          collaborator_id: string | null
          company_id: string | null
          completion_note: string | null
          created_at: string | null
          description: string | null
          due_at: string | null
          finished_at: string | null
          id: string | null
          instructions: string | null
          note_sent_whatsapp: boolean | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          task_date: string | null
          template_id: string | null
          title: string | null
          total_seconds: number | null
        }
        Insert: {
          client_hidden?: boolean | null
          collaborator_id?: string | null
          company_id?: string | null
          completion_note?: string | null
          created_at?: string | null
          description?: string | null
          due_at?: string | null
          finished_at?: string | null
          id?: string | null
          instructions?: string | null
          note_sent_whatsapp?: boolean | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"] | null
          task_date?: string | null
          template_id?: string | null
          title?: string | null
          total_seconds?: number | null
        }
        Update: {
          client_hidden?: boolean | null
          collaborator_id?: string | null
          company_id?: string | null
          completion_note?: string | null
          created_at?: string | null
          description?: string | null
          due_at?: string | null
          finished_at?: string | null
          id?: string | null
          instructions?: string | null
          note_sent_whatsapp?: boolean | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"] | null
          task_date?: string | null
          template_id?: string | null
          title?: string | null
          total_seconds?: number | null
        }
        Relationships: []
      }
      backup_feriado_20261012_time_adjustments: {
        Row: {
          adjusted_by: string | null
          created_at: string | null
          id: string | null
          new_seconds: number | null
          old_seconds: number | null
          reason: string | null
          task_id: string | null
        }
        Insert: {
          adjusted_by?: string | null
          created_at?: string | null
          id?: string | null
          new_seconds?: number | null
          old_seconds?: number | null
          reason?: string | null
          task_id?: string | null
        }
        Update: {
          adjusted_by?: string | null
          created_at?: string | null
          id?: string | null
          new_seconds?: number | null
          old_seconds?: number | null
          reason?: string | null
          task_id?: string | null
        }
        Relationships: []
      }
      backup_feriado_20261012_time_entries: {
        Row: {
          collaborator_id: string | null
          created_at: string | null
          ended_at: string | null
          id: string | null
          seconds: number | null
          started_at: string | null
          task_id: string | null
        }
        Insert: {
          collaborator_id?: string | null
          created_at?: string | null
          ended_at?: string | null
          id?: string | null
          seconds?: number | null
          started_at?: string | null
          task_id?: string | null
        }
        Update: {
          collaborator_id?: string | null
          created_at?: string | null
          ended_at?: string | null
          id?: string | null
          seconds?: number | null
          started_at?: string | null
          task_id?: string | null
        }
        Relationships: []
      }
      client_portal_access: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          created_by: string | null
          failed_attempts: number
          locked_until: string | null
          password_generated: boolean
          password_hash: string
          password_set_at: string | null
          password_set_by: string | null
          token: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          failed_attempts?: number
          locked_until?: string | null
          password_generated?: boolean
          password_hash: string
          password_set_at?: string | null
          password_set_by?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          failed_attempts?: number
          locked_until?: string | null
          password_generated?: boolean
          password_hash?: string
          password_set_at?: string | null
          password_set_by?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_access_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_access_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_access_password_set_by_fkey"
            columns: ["password_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_audit: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string
          created_at: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id: string
          created_at?: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_sessions: {
        Row: {
          company_id: string
          created_at: string
          expires_at: string
          id: string
          secret_hash: string
        }
        Insert: {
          company_id: string
          created_at?: string
          expires_at: string
          id?: string
          secret_hash: string
        }
        Update: {
          company_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          secret_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_absences: {
        Row: {
          collaborator_id: string
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          start_date: string
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          start_date: string
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_absences_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_absences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          cnpj: string | null
          created_at: string
          created_by: string | null
          group_id: string | null
          id: string
          name: string
          trade_name: string | null
          updated_at: string
          whatsapp_contact_id: string | null
          whatsapp_group_name: string | null
        }
        Insert: {
          cnpj?: string | null
          created_at?: string
          created_by?: string | null
          group_id?: string | null
          id?: string
          name: string
          trade_name?: string | null
          updated_at?: string
          whatsapp_contact_id?: string | null
          whatsapp_group_name?: string | null
        }
        Update: {
          cnpj?: string | null
          created_at?: string
          created_by?: string | null
          group_id?: string | null
          id?: string
          name?: string
          trade_name?: string | null
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
          {
            foreignKeyName: "companies_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "company_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      company_churns: {
        Row: {
          churn_type: string
          churned_on: string | null
          company_id: string
          consultants: Json
          created_at: string
          created_by: string | null
          id: string
          mrr: number | null
          reason: Database["public"]["Enums"]["churn_reason"]
          reverted_at: string | null
          reverted_by: string | null
          seller_name: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          churn_type: string
          churned_on?: string | null
          company_id: string
          consultants?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          mrr?: number | null
          reason: Database["public"]["Enums"]["churn_reason"]
          reverted_at?: string | null
          reverted_by?: string | null
          seller_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          churn_type?: string
          churned_on?: string | null
          company_id?: string
          consultants?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          mrr?: number | null
          reason?: Database["public"]["Enums"]["churn_reason"]
          reverted_at?: string | null
          reverted_by?: string | null
          seller_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_churns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_collaborators: {
        Row: {
          assigned_at: string
          collaborator_id: string
          company_id: string
        }
        Insert: {
          assigned_at?: string
          collaborator_id: string
          company_id: string
        }
        Update: {
          assigned_at?: string
          collaborator_id?: string
          company_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_collaborators_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_collaborators_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      company_contract_values: {
        Row: {
          company_id: string
          installments: number | null
          project_value: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          installments?: number | null
          project_value?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          installments?: number | null
          project_value?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_contract_values_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_contract_values_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_contracted_channels: {
        Row: {
          channel: Database["public"]["Enums"]["contracted_service"]
          company_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["contracted_service"]
          company_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["contracted_service"]
          company_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_contracted_channels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_details: {
        Row: {
          about: string | null
          cadence: Database["public"]["Enums"]["contract_cadence"] | null
          closer_name: string | null
          company_id: string
          ends_on: string | null
          main_pain: string | null
          project_model: Database["public"]["Enums"]["project_model"] | null
          started_on: string | null
          system_used: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          about?: string | null
          cadence?: Database["public"]["Enums"]["contract_cadence"] | null
          closer_name?: string | null
          company_id: string
          ends_on?: string | null
          main_pain?: string | null
          project_model?: Database["public"]["Enums"]["project_model"] | null
          started_on?: string | null
          system_used?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          about?: string | null
          cadence?: Database["public"]["Enums"]["contract_cadence"] | null
          closer_name?: string | null
          company_id?: string
          ends_on?: string | null
          main_pain?: string | null
          project_model?: Database["public"]["Enums"]["project_model"] | null
          started_on?: string | null
          system_used?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_details_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_details_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_dev: {
        Row: {
          company_id: string
          group_id: string
          manual_paused: boolean
          pause_reason: string | null
          paused_at: string | null
          paused_by: string | null
          status: Database["public"]["Enums"]["dev_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          group_id: string
          manual_paused?: boolean
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          status: Database["public"]["Enums"]["dev_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          group_id?: string
          manual_paused?: boolean
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          status?: Database["public"]["Enums"]["dev_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_dev_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_dev_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "dev_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      company_events: {
        Row: {
          actor_id: string | null
          company_id: string
          created_at: string
          details: Json | null
          event_type: string
          id: string
          source: string | null
          source_id: string | null
          summary: string
        }
        Insert: {
          actor_id?: string | null
          company_id: string
          created_at?: string
          details?: Json | null
          event_type: string
          id?: string
          source?: string | null
          source_id?: string | null
          summary: string
        }
        Update: {
          actor_id?: string | null
          company_id?: string
          created_at?: string
          details?: Json | null
          event_type?: string
          id?: string
          source?: string | null
          source_id?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_groups: {
        Row: {
          churn_type: string | null
          color: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          name: string
          pauses_contract: boolean
          position: number
          traffic_group_id: string | null
        }
        Insert: {
          churn_type?: string | null
          color: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name: string
          pauses_contract?: boolean
          position: number
          traffic_group_id?: string | null
        }
        Update: {
          churn_type?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name?: string
          pauses_contract?: boolean
          position?: number
          traffic_group_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_groups_traffic_group_id_fkey"
            columns: ["traffic_group_id"]
            isOneToOne: false
            referencedRelation: "traffic_groups"
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
      company_note_areas: {
        Row: {
          area: Database["public"]["Enums"]["note_area"]
          note_id: string
        }
        Insert: {
          area: Database["public"]["Enums"]["note_area"]
          note_id: string
        }
        Update: {
          area?: Database["public"]["Enums"]["note_area"]
          note_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_note_areas_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "company_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      company_note_replies: {
        Row: {
          attachments: Json
          author_id: string
          body_html: string
          created_at: string
          edited_at: string | null
          id: string
          note_id: string
          parent_id: string | null
        }
        Insert: {
          attachments?: Json
          author_id: string
          body_html: string
          created_at?: string
          edited_at?: string | null
          id?: string
          note_id: string
          parent_id?: string | null
        }
        Update: {
          attachments?: Json
          author_id?: string
          body_html?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          note_id?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_note_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_note_replies_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "company_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_note_replies_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "company_note_replies"
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
          origin: string | null
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
          origin?: string | null
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
          origin?: string | null
          updated_at?: string | null
          updated_by?: string | null
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "company_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      company_pause_periods: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          ended_on: string | null
          id: string
          source: string
          started_on: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          ended_on?: string | null
          id?: string
          source: string
          started_on?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          ended_on?: string | null
          id?: string
          source?: string
          started_on?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_pause_periods_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_responsible_periods: {
        Row: {
          company_id: string
          created_at: string
          end_date: string | null
          id: string
          person_id: string
          role: string
          source: string
          start_date: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          person_id: string
          role: string
          source: string
          start_date?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          person_id?: string
          role?: string
          source?: string
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_responsible_periods_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_revenue_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          channel: Database["public"]["Enums"]["sales_channel"]
          company_id: string
          id: string
          new_amount: number | null
          old_amount: number | null
          reason: string | null
          reference_month: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          channel: Database["public"]["Enums"]["sales_channel"]
          company_id: string
          id?: string
          new_amount?: number | null
          old_amount?: number | null
          reason?: string | null
          reference_month: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          channel?: Database["public"]["Enums"]["sales_channel"]
          company_id?: string
          id?: string
          new_amount?: number | null
          old_amount?: number | null
          reason?: string | null
          reference_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_revenue_audit_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_revenue_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_revenue_notes: {
        Row: {
          company_id: string
          note: string | null
          reference_month: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          note?: string | null
          reference_month: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          note?: string | null
          reference_month?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_revenue_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_revenue_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_revenues: {
        Row: {
          amount: number
          channel: Database["public"]["Enums"]["sales_channel"]
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          reference_month: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          amount: number
          channel: Database["public"]["Enums"]["sales_channel"]
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          reference_month: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          amount?: number
          channel?: Database["public"]["Enums"]["sales_channel"]
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          reference_month?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_revenues_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_revenues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_revenues_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_sales_channels: {
        Row: {
          active: boolean
          channel: Database["public"]["Enums"]["sales_channel"]
          company_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          channel: Database["public"]["Enums"]["sales_channel"]
          company_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          channel?: Database["public"]["Enums"]["sales_channel"]
          company_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_sales_channels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_sales_channels_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_traffic: {
        Row: {
          budget: number | null
          company_id: string
          focus: Database["public"]["Enums"]["traffic_focus"] | null
          manual_group_id: string | null
          platform: Database["public"]["Enums"]["traffic_platform"] | null
          status: Database["public"]["Enums"]["traffic_status"] | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          budget?: number | null
          company_id: string
          focus?: Database["public"]["Enums"]["traffic_focus"] | null
          manual_group_id?: string | null
          platform?: Database["public"]["Enums"]["traffic_platform"] | null
          status?: Database["public"]["Enums"]["traffic_status"] | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          budget?: number | null
          company_id?: string
          focus?: Database["public"]["Enums"]["traffic_focus"] | null
          manual_group_id?: string | null
          platform?: Database["public"]["Enums"]["traffic_platform"] | null
          status?: Database["public"]["Enums"]["traffic_status"] | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_traffic_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_traffic_manual_group_id_fkey"
            columns: ["manual_group_id"]
            isOneToOne: false
            referencedRelation: "traffic_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      content_mentions: {
        Row: {
          author_id: string
          company_id: string | null
          created_at: string
          id: string
          mentioned_user_id: string
          source_id: string
          source_type: string
        }
        Insert: {
          author_id: string
          company_id?: string | null
          created_at?: string
          id?: string
          mentioned_user_id: string
          source_id: string
          source_type: string
        }
        Update: {
          author_id?: string
          company_id?: string | null
          created_at?: string
          id?: string
          mentioned_user_id?: string
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_mentions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_mentions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_mentions_mentioned_user_id_fkey"
            columns: ["mentioned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_intake_log: {
        Row: {
          action: string
          company_id: string | null
          id: string
          ip_hash: string | null
          number: number | null
          payload: Json | null
          razao_social: string | null
          reason: string | null
          received_at: string
          result: string
          source: string | null
        }
        Insert: {
          action: string
          company_id?: string | null
          id?: string
          ip_hash?: string | null
          number?: number | null
          payload?: Json | null
          razao_social?: string | null
          reason?: string | null
          received_at?: string
          result: string
          source?: string | null
        }
        Update: {
          action?: string
          company_id?: string | null
          id?: string
          ip_hash?: string | null
          number?: number | null
          payload?: Json | null
          razao_social?: string | null
          reason?: string | null
          received_at?: string
          result?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_intake_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cs_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          company_id: string
          field: string
          id: number
          new_value: string | null
          old_value: string | null
          subject_user_id: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          company_id: string
          field: string
          id?: never
          new_value?: string | null
          old_value?: string | null
          subject_user_id?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          field?: string
          id?: never
          new_value?: string | null
          old_value?: string | null
          subject_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cs_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cs_company_status: {
        Row: {
          company_id: string
          meeting_on: string | null
          nps_status: Database["public"]["Enums"]["cs_nps_status"] | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          meeting_on?: string | null
          nps_status?: Database["public"]["Enums"]["cs_nps_status"] | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          meeting_on?: string | null
          nps_status?: Database["public"]["Enums"]["cs_nps_status"] | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cs_company_status_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cs_note_replies: {
        Row: {
          attachments: Json
          author_id: string
          body_html: string
          created_at: string
          edited_at: string | null
          id: string
          note_id: string
          parent_id: string | null
        }
        Insert: {
          attachments?: Json
          author_id: string
          body_html: string
          created_at?: string
          edited_at?: string | null
          id?: string
          note_id: string
          parent_id?: string | null
        }
        Update: {
          attachments?: Json
          author_id?: string
          body_html?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          note_id?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cs_note_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_note_replies_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "cs_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_note_replies_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cs_note_replies"
            referencedColumns: ["id"]
          },
        ]
      }
      cs_notes: {
        Row: {
          attachments: Json
          author_id: string
          company_id: string
          content_html: string
          created_at: string
          id: string
          updated_at: string | null
          updated_by: string | null
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
        }
        Relationships: [
          {
            foreignKeyName: "cs_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cs_person_nps: {
        Row: {
          company_id: string
          status: Database["public"]["Enums"]["cs_nps_status"]
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          company_id: string
          status: Database["public"]["Enums"]["cs_nps_status"]
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          status?: Database["public"]["Enums"]["cs_nps_status"]
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_person_nps_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_person_nps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          company_id: string
          field: string
          id: number
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          company_id: string
          field: string
          id?: never
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          field?: string
          id?: never
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dev_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_clock_periods: {
        Row: {
          company_id: string
          ended_at: string | null
          id: number
          started_at: string
        }
        Insert: {
          company_id: string
          ended_at?: string | null
          id?: never
          started_at: string
        }
        Update: {
          company_id?: string
          ended_at?: string | null
          id?: never
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dev_clock_periods_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_groups: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          position?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
        }
        Relationships: []
      }
      digisac_messages: {
        Row: {
          contact_id: string
          digisac_user_id: string | null
          id: string
          is_comment: boolean | null
          is_from_bot: boolean | null
          is_from_me: boolean | null
          origin: string | null
          sent_at: string
          synced_at: string
          ticket_id: string | null
          type: string | null
          visible: boolean | null
        }
        Insert: {
          contact_id: string
          digisac_user_id?: string | null
          id: string
          is_comment?: boolean | null
          is_from_bot?: boolean | null
          is_from_me?: boolean | null
          origin?: string | null
          sent_at: string
          synced_at?: string
          ticket_id?: string | null
          type?: string | null
          visible?: boolean | null
        }
        Update: {
          contact_id?: string
          digisac_user_id?: string | null
          id?: string
          is_comment?: boolean | null
          is_from_bot?: boolean | null
          is_from_me?: boolean | null
          origin?: string | null
          sent_at?: string
          synced_at?: string
          ticket_id?: string | null
          type?: string | null
          visible?: boolean | null
        }
        Relationships: []
      }
      digisac_sync_cursor: {
        Row: {
          contact_id: string
          last_sent_at: string | null
          updated_at: string
        }
        Insert: {
          contact_id: string
          last_sent_at?: string | null
          updated_at?: string
        }
        Update: {
          contact_id?: string
          last_sent_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      digisac_sync_runs: {
        Row: {
          contacts_processed: number
          error_kind: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          messages_upserted: number
          requests: number
          started_at: string
          status: string | null
        }
        Insert: {
          contacts_processed?: number
          error_kind?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          messages_upserted?: number
          requests?: number
          started_at?: string
          status?: string | null
        }
        Update: {
          contacts_processed?: number
          error_kind?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          messages_upserted?: number
          requests?: number
          started_at?: string
          status?: string | null
        }
        Relationships: []
      }
      digisac_users: {
        Row: {
          email: string | null
          id: string
          name: string | null
          profile_id: string | null
          profile_locked: boolean
          updated_at: string
        }
        Insert: {
          email?: string | null
          id: string
          name?: string | null
          profile_id?: string | null
          profile_locked?: boolean
          updated_at?: string
        }
        Update: {
          email?: string | null
          id?: string
          name?: string | null
          profile_id?: string | null
          profile_locked?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "digisac_users_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_daily_credits: {
        Row: {
          collaborator_id: string
          company_id: string
          d: string
          points: number
        }
        Insert: {
          collaborator_id: string
          company_id: string
          d: string
          points?: number
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          d?: string
          points?: number
        }
        Relationships: [
          {
            foreignKeyName: "followup_daily_credits_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_daily_credits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_daily_scores: {
        Row: {
          collaborator_id: string | null
          color: string
          company_id: string
          computed_at: string
          contact_color: string | null
          d: string
          finalized: boolean
          first_msg_at: string | null
          points: number
          recovery_need: number
        }
        Insert: {
          collaborator_id?: string | null
          color: string
          company_id: string
          computed_at?: string
          contact_color?: string | null
          d: string
          finalized?: boolean
          first_msg_at?: string | null
          points?: number
          recovery_need?: number
        }
        Update: {
          collaborator_id?: string | null
          color?: string
          company_id?: string
          computed_at?: string
          contact_color?: string | null
          d?: string
          finalized?: boolean
          first_msg_at?: string | null
          points?: number
          recovery_need?: number
        }
        Relationships: [
          {
            foreignKeyName: "followup_daily_scores_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_daily_scores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      google_accounts: {
        Row: {
          access_token_enc: string
          connected_at: string
          google_email: string | null
          refresh_token_enc: string | null
          scope: string
          token_expiry: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_enc: string
          connected_at?: string
          google_email?: string | null
          refresh_token_enc?: string | null
          scope: string
          token_expiry: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_enc?: string
          connected_at?: string
          google_email?: string | null
          refresh_token_enc?: string | null
          scope?: string
          token_expiry?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_audit: {
        Row: {
          action: string
          created_at: string
          detail: string | null
          id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          detail?: string | null
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          detail?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_audit_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_import_state: {
        Row: {
          auto_apply_from: string | null
          last_full_sync_at: string | null
          last_reconcile_scan_at: string | null
          last_synced_at: string | null
          sync_token: string | null
          updated_at: string
          user_id: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          auto_apply_from?: string | null
          last_full_sync_at?: string | null
          last_reconcile_scan_at?: string | null
          last_synced_at?: string | null
          sync_token?: string | null
          updated_at?: string
          user_id: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          auto_apply_from?: string | null
          last_full_sync_at?: string | null
          last_reconcile_scan_at?: string | null
          last_synced_at?: string | null
          sync_token?: string | null
          updated_at?: string
          user_id?: string
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_import_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      imported_google_events: {
        Row: {
          ends_at: string
          google_calendar_id: string
          google_event_id: string
          id: string
          is_private: boolean
          starts_at: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ends_at: string
          google_calendar_id?: string
          google_event_id: string
          id?: string
          is_private?: boolean
          starts_at: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ends_at?: string
          google_calendar_id?: string
          google_event_id?: string
          id?: string
          is_private?: boolean
          starts_at?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imported_google_events_user_id_fkey"
            columns: ["user_id"]
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
          derived_kind: string | null
          derived_value: string | null
          highlight: boolean
          id: string
          name: string
          text_color: string
        }
        Insert: {
          bg_color?: string
          created_at?: string
          created_by?: string | null
          derived_kind?: string | null
          derived_value?: string | null
          highlight?: boolean
          id?: string
          name: string
          text_color?: string
        }
        Update: {
          bg_color?: string
          created_at?: string
          created_by?: string | null
          derived_kind?: string | null
          derived_value?: string | null
          highlight?: boolean
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
      listing_validation_reads: {
        Row: {
          last_read_at: string
          user_id: string
        }
        Insert: {
          last_read_at?: string
          user_id: string
        }
        Update: {
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_validation_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_validations: {
        Row: {
          author_id: string | null
          author_type: string
          client_ip_hash: string | null
          client_session_id: string | null
          client_user_agent: string | null
          comment: string | null
          company_id: string
          created_at: string
          event_type: string
          id: string
          listing_result_id: string
        }
        Insert: {
          author_id?: string | null
          author_type: string
          client_ip_hash?: string | null
          client_session_id?: string | null
          client_user_agent?: string | null
          comment?: string | null
          company_id: string
          created_at?: string
          event_type: string
          id?: string
          listing_result_id: string
        }
        Update: {
          author_id?: string | null
          author_type?: string
          client_ip_hash?: string | null
          client_session_id?: string | null
          client_user_agent?: string | null
          comment?: string | null
          company_id?: string
          created_at?: string
          event_type?: string
          id?: string
          listing_result_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_validations_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_validations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_validations_listing_result_id_fkey"
            columns: ["listing_result_id"]
            isOneToOne: false
            referencedRelation: "listing_results"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_google_reconciliation: {
        Row: {
          company_id: string | null
          crm_ends_at: string | null
          crm_meet_link: string | null
          crm_starts_at: string | null
          crm_title: string | null
          detected_at: string
          google_ends_at: string | null
          google_event_id: string | null
          google_meet_link: string | null
          google_starts_at: string | null
          google_title: string | null
          google_updated_at: string | null
          has_timer: boolean
          id: string
          meeting_id: string | null
          motivo: string | null
          owner_id: string
          proposed_action: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          company_id?: string | null
          crm_ends_at?: string | null
          crm_meet_link?: string | null
          crm_starts_at?: string | null
          crm_title?: string | null
          detected_at?: string
          google_ends_at?: string | null
          google_event_id?: string | null
          google_meet_link?: string | null
          google_starts_at?: string | null
          google_title?: string | null
          google_updated_at?: string | null
          has_timer?: boolean
          id?: string
          meeting_id?: string | null
          motivo?: string | null
          owner_id: string
          proposed_action: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          company_id?: string | null
          crm_ends_at?: string | null
          crm_meet_link?: string | null
          crm_starts_at?: string | null
          crm_title?: string | null
          detected_at?: string
          google_ends_at?: string | null
          google_event_id?: string | null
          google_meet_link?: string | null
          google_starts_at?: string | null
          google_title?: string | null
          google_updated_at?: string | null
          has_timer?: boolean
          id?: string
          meeting_id?: string | null
          motivo?: string | null
          owner_id?: string
          proposed_action?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_google_reconciliation_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_google_reconciliation_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: true
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_google_reconciliation_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_google_reconciliation_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_participants: {
        Row: {
          meeting_id: string
          response: string | null
          user_id: string
        }
        Insert: {
          meeting_id: string
          response?: string | null
          user_id: string
        }
        Update: {
          meeting_id?: string
          response?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_participants_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_timer_audit: {
        Row: {
          company_id: string | null
          edited_at: string
          edited_by: string | null
          event_type: string
          from_company_id: string | null
          id: string
          justification: string
          new_seconds: number
          old_seconds: number | null
          started_by: string | null
          timer_id: string | null
          title: string | null
        }
        Insert: {
          company_id?: string | null
          edited_at?: string
          edited_by?: string | null
          event_type?: string
          from_company_id?: string | null
          id?: string
          justification: string
          new_seconds: number
          old_seconds?: number | null
          started_by?: string | null
          timer_id?: string | null
          title?: string | null
        }
        Update: {
          company_id?: string | null
          edited_at?: string
          edited_by?: string | null
          event_type?: string
          from_company_id?: string | null
          id?: string
          justification?: string
          new_seconds?: number
          old_seconds?: number | null
          started_by?: string | null
          timer_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_timer_audit_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_timer_people: {
        Row: {
          timer_id: string
          user_id: string
        }
        Insert: {
          timer_id: string
          user_id: string
        }
        Update: {
          timer_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_timer_people_timer_id_fkey"
            columns: ["timer_id"]
            isOneToOne: false
            referencedRelation: "meeting_timers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_timer_people_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_timer_segments: {
        Row: {
          end_reason: string | null
          ended_at: string | null
          id: string
          notified_overrun: boolean
          started_at: string
          timer_id: string
        }
        Insert: {
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          notified_overrun?: boolean
          started_at?: string
          timer_id: string
        }
        Update: {
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          notified_overrun?: boolean
          started_at?: string
          timer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_timer_segments_timer_id_fkey"
            columns: ["timer_id"]
            isOneToOne: false
            referencedRelation: "meeting_timers"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_timers: {
        Row: {
          company_id: string
          created_at: string
          finalized_at: string | null
          finalized_reason: string | null
          google_event_id: string | null
          id: string
          manual_seconds: number | null
          meeting_id: string | null
          origin_deleted_at: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          started_by: string
          title: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          finalized_at?: string | null
          finalized_reason?: string | null
          google_event_id?: string | null
          id?: string
          manual_seconds?: number | null
          meeting_id?: string | null
          origin_deleted_at?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          started_by: string
          title?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          finalized_at?: string | null
          finalized_reason?: string | null
          google_event_id?: string | null
          id?: string
          manual_seconds?: number | null
          meeting_id?: string | null
          origin_deleted_at?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          started_by?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_timers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_timers_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_timers_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          client_hidden: boolean
          company_id: string
          created_at: string
          created_by: string
          description: string | null
          ends_at: string
          google_calendar_id: string | null
          google_email: string | null
          google_event_id: string | null
          google_missing_at: string | null
          google_pushed_at: string | null
          google_removed_at: string | null
          google_sync_error: string | null
          google_sync_status: string
          id: string
          meet_link: string | null
          meeting_type: string
          responses_synced_at: string | null
          room: string | null
          room_response: string | null
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          client_hidden?: boolean
          company_id: string
          created_at?: string
          created_by: string
          description?: string | null
          ends_at: string
          google_calendar_id?: string | null
          google_email?: string | null
          google_event_id?: string | null
          google_missing_at?: string | null
          google_pushed_at?: string | null
          google_removed_at?: string | null
          google_sync_error?: string | null
          google_sync_status?: string
          id?: string
          meet_link?: string | null
          meeting_type?: string
          responses_synced_at?: string | null
          room?: string | null
          room_response?: string | null
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          client_hidden?: boolean
          company_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          ends_at?: string
          google_calendar_id?: string | null
          google_email?: string | null
          google_event_id?: string | null
          google_missing_at?: string | null
          google_pushed_at?: string | null
          google_removed_at?: string | null
          google_sync_error?: string | null
          google_sync_status?: string
          id?: string
          meet_link?: string | null
          meeting_type?: string
          responses_synced_at?: string | null
          room?: string | null
          room_response?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          company_id: string | null
          created_at: string
          id: string
          read_at: string | null
          source_id: string | null
          source_type: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          source_id?: string | null
          source_type?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          source_id?: string | null
          source_type?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          attendance_timer_enabled: boolean
          avatar_path: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          attendance_timer_enabled?: boolean
          avatar_path?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          attendance_timer_enabled?: boolean
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
      support_ticket_replies: {
        Row: {
          attachments: Json
          author_id: string
          body_html: string
          created_at: string
          edited_at: string | null
          id: string
          parent_id: string | null
          ticket_id: string
        }
        Insert: {
          attachments?: Json
          author_id: string
          body_html: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          ticket_id: string
        }
        Update: {
          attachments?: Json
          author_id?: string
          body_html?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_replies_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "support_ticket_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_replies_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          attachments: Json
          company_id: string
          context_html: string
          created_at: string
          created_by: string
          finished_at: string | null
          id: string
          issue_type: Database["public"]["Enums"]["ticket_issue_type"]
          status: Database["public"]["Enums"]["ticket_status"]
          title: string
          updated_at: string | null
          updated_by: string | null
          urgency: Database["public"]["Enums"]["ticket_urgency"]
        }
        Insert: {
          attachments?: Json
          company_id: string
          context_html: string
          created_at?: string
          created_by: string
          finished_at?: string | null
          id?: string
          issue_type: Database["public"]["Enums"]["ticket_issue_type"]
          status?: Database["public"]["Enums"]["ticket_status"]
          title: string
          updated_at?: string | null
          updated_by?: string | null
          urgency: Database["public"]["Enums"]["ticket_urgency"]
        }
        Update: {
          attachments?: Json
          company_id?: string
          context_html?: string
          created_at?: string
          created_by?: string
          finished_at?: string | null
          id?: string
          issue_type?: Database["public"]["Enums"]["ticket_issue_type"]
          status?: Database["public"]["Enums"]["ticket_status"]
          title?: string
          updated_at?: string | null
          updated_by?: string | null
          urgency?: Database["public"]["Enums"]["ticket_urgency"]
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_auto_expirations: {
        Row: {
          expired_at: string
          id: string
          previous_status: Database["public"]["Enums"]["task_status"]
          run_id: string
          task_id: string
        }
        Insert: {
          expired_at?: string
          id?: string
          previous_status: Database["public"]["Enums"]["task_status"]
          run_id: string
          task_id: string
        }
        Update: {
          expired_at?: string
          id?: string
          previous_status?: Database["public"]["Enums"]["task_status"]
          run_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_auto_expirations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      task_instances: {
        Row: {
          client_hidden: boolean
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
          client_hidden?: boolean
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
          client_hidden?: boolean
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
          active_source: string
          category: Database["public"]["Enums"]["task_category"] | null
          collaborator_id: string
          company_id: string
          created_at: string
          created_by: string
          description: string | null
          due_time: string | null
          end_date: string | null
          from_standard: boolean
          id: string
          instructions: string | null
          kind: Database["public"]["Enums"]["task_kind"]
          listing_marketplaces: Database["public"]["Enums"]["listing_marketplace"][]
          listing_needs_margin: boolean
          listing_tax_rate: number | null
          paused_by_group: boolean
          standard_task_id: string | null
          start_date: string
          template_type: Database["public"]["Enums"]["template_type"]
          title: string
          weekdays: number[] | null
        }
        Insert: {
          active?: boolean
          active_source?: string
          category?: Database["public"]["Enums"]["task_category"] | null
          collaborator_id: string
          company_id: string
          created_at?: string
          created_by: string
          description?: string | null
          due_time?: string | null
          end_date?: string | null
          from_standard?: boolean
          id?: string
          instructions?: string | null
          kind: Database["public"]["Enums"]["task_kind"]
          listing_marketplaces?: Database["public"]["Enums"]["listing_marketplace"][]
          listing_needs_margin?: boolean
          listing_tax_rate?: number | null
          paused_by_group?: boolean
          standard_task_id?: string | null
          start_date?: string
          template_type?: Database["public"]["Enums"]["template_type"]
          title: string
          weekdays?: number[] | null
        }
        Update: {
          active?: boolean
          active_source?: string
          category?: Database["public"]["Enums"]["task_category"] | null
          collaborator_id?: string
          company_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_time?: string | null
          end_date?: string | null
          from_standard?: boolean
          id?: string
          instructions?: string | null
          kind?: Database["public"]["Enums"]["task_kind"]
          listing_marketplaces?: Database["public"]["Enums"]["listing_marketplace"][]
          listing_needs_margin?: boolean
          listing_tax_rate?: number | null
          paused_by_group?: boolean
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
          is_manual: boolean
          seconds: number | null
          started_at: string
          task_id: string
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          is_manual?: boolean
          seconds?: number | null
          started_at: string
          task_id: string
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          is_manual?: boolean
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
      traffic_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          company_id: string
          field: string
          id: number
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          company_id: string
          field: string
          id?: never
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          field?: string
          id?: never
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "traffic_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      traffic_groups: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          position?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
        }
        Relationships: []
      }
    }
    Views: {
      company_effective_labels: {
        Row: {
          company_id: string | null
          label_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _apply_meeting_google_change: {
        Args: {
          p_cancel: boolean
          p_ends: string
          p_meet: string
          p_meeting: string
          p_starts: string
          p_title: string
        }
        Returns: undefined
      }
      _mgr_notify_conta_diferente: {
        Args: { p_meeting: string; p_owner: string; p_title: string }
        Returns: undefined
      }
      _mgr_safe_ts: { Args: { p: string }; Returns: string }
      _mgr_upsert: {
        Args: {
          p_meeting: string
          p_motivo: string
          p_op: Json
          p_owner: string
        }
        Returns: undefined
      }
      active_group_requirements_missing: {
        Args: { p_company: string }
        Returns: string
      }
      activity_category_label: { Args: { p_key: string }; Returns: string }
      activity_event_visibility: { Args: { p_type: string }; Returns: string }
      activity_type_category: { Args: { p_type: string }; Returns: string }
      activity_type_label: { Args: { p_type: string }; Returns: string }
      admin_adjust_time: {
        Args: { p_new_seconds: number; p_reason?: string; p_task: string }
        Returns: number
      }
      admin_delete_meeting: { Args: { p_meeting: string }; Returns: undefined }
      agenda_sync_status: {
        Args: never
        Returns: {
          google_connected: boolean
          last_synced_at: string
          user_id: string
        }[]
      }
      atrasos_cell_tasks: {
        Args: {
          p_company?: string
          p_creator?: string
          p_dimension: string
          p_end: string
          p_include_standard?: boolean
          p_limit?: number
          p_metric: string
          p_offset?: number
          p_person: string
          p_responsible?: string
          p_search?: string
          p_start: string
          p_status?: string
          p_type?: string
        }
        Returns: {
          company_id: string
          company_name: string
          created_at: string
          creator_avatar_path: string
          creator_id: string
          creator_name: string
          delay_seconds: number
          due_at: string
          finished_at: string
          granted_seconds: number
          id: string
          responsible_avatar_path: string
          responsible_id: string
          responsible_name: string
          situation: string
          title: string
          total_count: number
          type_key: string
          type_label: string
        }[]
      }
      atrasos_dashboard: {
        Args: { p_end: string; p_start: string }
        Returns: Json
      }
      atrasos_excluded_ids: { Args: never; Returns: string[] }
      atrasos_facets: {
        Args: { p_end: string; p_include_standard?: boolean; p_start: string }
        Returns: Json
      }
      atrasos_list: {
        Args: {
          p_company?: string
          p_creator?: string
          p_end: string
          p_include_standard?: boolean
          p_limit?: number
          p_offset?: number
          p_order?: string
          p_responsible?: string
          p_search?: string
          p_start: string
          p_status?: string
          p_type?: string
        }
        Returns: {
          company_id: string
          company_name: string
          created_at: string
          creator_avatar_path: string
          creator_id: string
          creator_name: string
          delay_seconds: number
          due_at: string
          finished_at: string
          granted_seconds: number
          id: string
          responsible_avatar_path: string
          responsible_id: string
          responsible_name: string
          situation: string
          title: string
          total_count: number
          type_key: string
          type_label: string
        }[]
      }
      atrasos_summary: {
        Args: {
          p_company?: string
          p_creator?: string
          p_end: string
          p_include_standard?: boolean
          p_responsible?: string
          p_search?: string
          p_start: string
          p_status?: string
          p_type?: string
        }
        Returns: Json
      }
      attendance_admin_report: {
        Args: { p_bucket: string; p_end: string; p_start: string }
        Returns: {
          auto_closed: boolean
          bucket: string
          company_id: string
          company_name: string
          company_number: string
          entries: number
          minutes: number
          user_id: string
          user_name: string
        }[]
      }
      attendance_auto_close: { Args: never; Returns: number }
      attendance_capacity_client_people: {
        Args: { p_company_id: string; p_end: string; p_start: string }
        Returns: {
          hours: number
          person_label: string
        }[]
      }
      attendance_capacity_clients: {
        Args: { p_end: string; p_start: string }
        Returns: {
          client_msgs: number
          company_id: string
          company_name: string
          company_number: string
          group_name: string
          hours: number
          monthly_hours: number
          pct_out_task: number
          people: number
          project_model: string
          sessions: number
          team_msgs: number
        }[]
      }
      attendance_capacity_people: {
        Args: { p_end: string; p_start: string }
        Returns: {
          business_days: number
          chat_total_hours: number
          clients: number
          has_profile: boolean
          in_task_hours: number
          out_task_hours: number
          person_key: string
          person_label: string
          profile_id: string
          task_hours: number
        }[]
      }
      attendance_capacity_person_clients: {
        Args: { p_end: string; p_profile_id: string; p_start: string }
        Returns: {
          client_msgs: number
          company_id: string
          company_name: string
          company_number: string
          group_name: string
          hours: number
          monthly_hours: number
          pct_out_task: number
          people: number
          project_model: string
          sessions: number
          team_msgs: number
        }[]
      }
      attendance_capacity_summary: {
        Args: { p_end: string; p_start: string }
        Returns: {
          avg_monthly_h: number
          dim: string
          key: string
          median_monthly_h: number
          n_clients: number
        }[]
      }
      attendance_company_timeline: {
        Args: {
          p_company_id: string
          p_end: string
          p_profile_id: string
          p_start: string
        }
        Returns: {
          auto_closed: boolean
          client_msgs: number
          ended_at: string
          in_task: boolean
          kind: string
          minutes: number
          started_at: string
          team_msgs: number
        }[]
      }
      attendance_comparison: {
        Args: {
          p_bucket: string
          p_end: string
          p_exclude_auto: boolean
          p_start: string
        }
        Returns: {
          bucket: string
          cc_chat_minutes: number
          cc_timed_minutes: number
          company_id: string
          company_name: string
          company_number: string
          est_minutes: number
          est_out_task_minutes: number
          profile_id: string
          sessions: number
          timed_minutes: number
          user_name: string
        }[]
      }
      attendance_compute: {
        Args: {
          p_bmin: number
          p_bwin: number
          p_floor: number
          p_from: string
          p_gap: number
          p_long: number
          p_prep: number
          p_to: string
        }
        Returns: {
          broadcast_msgs: number
          client_msgs: number
          contact_id: string
          day: string
          digisac_user_id: string
          long_sessions: number
          minutes: number
          sessions: number
          team_msgs: number
        }[]
      }
      attendance_current: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          company_number: string
          started_at: string
        }[]
      }
      attendance_day_timeline: {
        Args: { p_day: string; p_profile_id: string }
        Returns: {
          auto_closed: boolean
          client_msgs: number
          company_name: string
          company_number: string
          ended_at: string
          in_task: boolean
          kind: string
          minutes: number
          started_at: string
          team_msgs: number
        }[]
      }
      attendance_is_enabled: { Args: { p_user: string }; Returns: boolean }
      attendance_params_get: {
        Args: never
        Returns: {
          broadcast_min_groups: number
          broadcast_window_seconds: number
          calibrated: boolean
          calibrated_at: string | null
          floor_minutes: number
          gap_minutes: number
          id: boolean
          long_session_minutes: number
          prep_minutes: number
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "attendance_params"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      attendance_params_save: {
        Args: {
          p_bmin: number
          p_bwin: number
          p_floor: number
          p_gap: number
          p_long: number
          p_prep: number
        }
        Returns: undefined
      }
      attendance_recompute_all: { Args: never; Returns: undefined }
      attendance_sessions_compute: {
        Args: {
          p_bmin: number
          p_bwin: number
          p_floor: number
          p_from: string
          p_gap: number
          p_long: number
          p_prep: number
          p_to: string
        }
        Returns: {
          broadcast_msgs: number
          client_msgs: number
          contact_id: string
          day: string
          digisac_user_id: string
          ended_at: string
          is_broadcast: boolean
          is_long: boolean
          minutes: number
          started_at: string
          team_msgs: number
        }[]
      }
      attendance_set_calibrated: {
        Args: { p_value: boolean }
        Returns: undefined
      }
      attendance_start: { Args: { p_company_id: string }; Returns: Json }
      attendance_stop: { Args: never; Returns: undefined }
      attendance_today_totals: {
        Args: never
        Returns: {
          company_id: string
          seconds: number
        }[]
      }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      board_area_for_role: {
        Args: { p_role: Database["public"]["Enums"]["user_role"] }
        Returns: Database["public"]["Enums"]["note_area"]
      }
      capacity_consultant_meetings: {
        Args: { p_end?: string; p_start?: string }
        Returns: {
          consultant_id: string
          meeting_seconds: number
        }[]
      }
      capacity_excluded_groups: { Args: never; Returns: string[] }
      capacity_person_meetings: {
        Args: { p_end?: string; p_person: string; p_start?: string }
        Returns: {
          auto_closed: boolean
          company_id: string
          company_name: string
          seconds: number
          started_at: string
          title: string
        }[]
      }
      churn_board: {
        Args: { p_end?: string; p_start?: string }
        Returns: {
          churn_type: string
          churned_on: string
          company_id: string
          company_name: string
          consultants: Json
          cs_note_count: number
          id: string
          lost_revenue: string
          months_contracted: number
          months_stayed: number
          mrr: string
          paused_days: number
          reason: string
          seller_name: string
        }[]
      }
      churn_reason_label: {
        Args: { p: Database["public"]["Enums"]["churn_reason"] }
        Returns: string
      }
      churn_rows: {
        Args: { p_end: string; p_start: string }
        Returns: {
          churn_type: string
          churned_on: string
          company_id: string
          company_name: string
          consultants: Json
          id: string
          lost: number
          months_contracted: number
          months_stayed: number
          mrr: number
          paused_days: number
          reason: Database["public"]["Enums"]["churn_reason"]
          seller_name: string
        }[]
      }
      churn_set_date: {
        Args: { p_date: string; p_id: string }
        Returns: undefined
      }
      churn_set_mrr: {
        Args: { p_id: string; p_text: string }
        Returns: undefined
      }
      churn_set_reason: {
        Args: {
          p_id: string
          p_reason: Database["public"]["Enums"]["churn_reason"]
        }
        Returns: undefined
      }
      churn_set_seller: {
        Args: { p_id: string; p_text: string }
        Returns: undefined
      }
      churn_summary: {
        Args: { p_end?: string; p_start?: string }
        Returns: {
          cancelados: number
          finalizados: number
          lost_revenue_total: string
          mrr_cancelados: string
          mrr_finalizados: string
          mrr_total: string
          n_motivo_nao_informado: number
          n_sem_data: number
          n_sem_mrr: number
          n_sem_periodo: number
          reasons: Json
          total: number
        }[]
      }
      client_followup: {
        Args: {
          p_desc?: boolean
          p_only_active?: boolean
          p_period_days?: number
        }
        Returns: {
          company_id: string
          company_name: string
          consultants: Json
          days_since: number
          last_contact_at: string
          last_contact_kind: string
          next_meeting_at: string
          period_listings: number
          period_meetings: number
          period_notes: number
          period_readjusts: number
          period_tasks: number
        }[]
      }
      client_portal_admin_view: { Args: { p_company: string }; Returns: Json }
      client_portal_can_preview: {
        Args: { p_company: string }
        Returns: boolean
      }
      client_portal_data: {
        Args: { p_session: string; p_token: string }
        Returns: Json
      }
      client_portal_gen_password: { Args: never; Returns: string }
      client_portal_listing_validate: {
        Args: {
          p_comment?: string
          p_event_type: string
          p_ip?: string
          p_listing_result: string
          p_session: string
          p_token: string
          p_user_agent?: string
        }
        Returns: Json
      }
      client_portal_login: {
        Args: { p_password: string; p_token: string }
        Returns: {
          result: string
          secret: string
        }[]
      }
      client_portal_meetings: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_session: string
          p_token: string
        }
        Returns: Json
      }
      client_portal_meetings_payload: {
        Args: { p_company: string; p_limit: number; p_offset: number }
        Returns: Json
      }
      client_portal_payload: { Args: { p_company: string }; Returns: Json }
      client_portal_preview: { Args: { p_company: string }; Returns: Json }
      client_portal_preview_meetings: {
        Args: { p_company: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      client_portal_preview_progress: {
        Args: { p_company: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      client_portal_progress: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_session: string
          p_token: string
        }
        Returns: Json
      }
      client_portal_progress_payload: {
        Args: { p_company: string; p_limit: number; p_offset: number }
        Returns: Json
      }
      client_portal_revoke: { Args: { p_company: string }; Returns: undefined }
      client_portal_rotate: { Args: { p_company: string }; Returns: string }
      client_portal_session_company: {
        Args: { p_session: string; p_token: string }
        Returns: string
      }
      client_portal_set: { Args: { p_company: string }; Returns: Json }
      client_portal_status: { Args: { p_company: string }; Returns: Json }
      closer_names_list: { Args: never; Returns: string[] }
      collaborator_open_task_count: {
        Args: { p_collaborator: string; p_company: string }
        Returns: number
      }
      collaborator_pending_tasks: {
        Args: { p_collaborator: string; p_end: string; p_start: string }
        Returns: {
          company_name: string
          due_at: string
          id: string
          overdue: boolean
          status: Database["public"]["Enums"]["task_status"]
          title: string
        }[]
      }
      collaborator_portfolio: {
        Args: { p_collaborator: string }
        Returns: {
          company_id: string
          company_name: string
          done: number
          due_soon: number
          in_portfolio: boolean
          overdue: number
          pending: number
          total: number
        }[]
      }
      collaborator_task_counts: {
        Args: { p_end?: string; p_start: string }
        Returns: {
          collaborator_id: string
          done: number
          total: number
        }[]
      }
      collaborator_task_facets: {
        Args: { p_collaborator: string; p_end: string; p_start: string }
        Returns: Json
      }
      collaborator_tasks_page: {
        Args: {
          p_collaborator: string
          p_company?: string
          p_creator?: string
          p_end: string
          p_limit?: number
          p_offset?: number
          p_order?: string
          p_search?: string
          p_start: string
          p_status?: string
          p_type?: string
        }
        Returns: {
          adjustment_count: number
          adjustments: Json
          company_id: string
          company_name: string
          created_by: string
          creator_avatar_path: string
          creator_name: string
          due_at: string
          finished_at: string
          from_standard: boolean
          has_origin: boolean
          id: string
          only_by_work: boolean
          status: Database["public"]["Enums"]["task_status"]
          system_generated: boolean
          task_date: string
          title: string
          total_count: number
          total_seconds: number
          type_key: string
          type_label: string
        }[]
      }
      company_activity_authors: { Args: { p_company: string }; Returns: Json }
      company_activity_categories: {
        Args: { p_company: string }
        Returns: Json
      }
      company_activity_feed: {
        Args: {
          p_author?: string
          p_categories?: string[]
          p_company: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_to?: string
          p_types?: string[]
        }
        Returns: Json
      }
      company_activity_types: { Args: { p_company: string }; Returns: Json }
      company_collaborator_summary: {
        Args: { p_company_id: string; p_end?: string; p_start: string }
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
      company_details_save:
        | {
            Args: {
              p_about: string
              p_cadence: string
              p_channels: string[]
              p_company: string
              p_ends_on: string
              p_main_pain: string
              p_project_model: string
              p_started_on: string
              p_system_used: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_about: string
              p_cadence: string
              p_channels: string[]
              p_closer_name: string
              p_company: string
              p_ends_on: string
              p_main_pain: string
              p_project_model: string
              p_started_on: string
              p_system_used: string
            }
            Returns: undefined
          }
      company_exists: { Args: { p_company: string }; Returns: boolean }
      company_meeting_hours: {
        Args: { p_company: string; p_end?: string; p_start?: string }
        Returns: {
          avatar_path: string
          base_seconds: number
          open_starts: Json
          server_now: string
          user_id: string
          user_name: string
        }[]
      }
      company_meeting_sessions: {
        Args: { p_company: string; p_end?: string; p_start?: string }
        Returns: {
          auto_closed: boolean
          origin_deleted: boolean
          people: Json
          seconds: number
          started_at: string
          started_by: string
          timer_id: string
          title: string
        }[]
      }
      company_note_counts: {
        Args: never
        Returns: {
          company_id: string
          note_count: number
        }[]
      }
      company_note_reply_counts: {
        Args: { p_company: string }
        Returns: {
          note_id: string
          reply_count: number
        }[]
      }
      company_overview: {
        Args: {
          p_company_id: string
          p_end?: string
          p_month_start: string
          p_start: string
        }
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
      company_responsible_timeline: {
        Args: { p_company: string }
        Returns: Json
      }
      company_responsibles: {
        Args: { p_company_ids: string[] }
        Returns: {
          collaborators: Json
          company_id: string
          consultants: Json
        }[]
      }
      company_revenue_insights: {
        Args: { p_company: string; p_end?: string; p_start?: string }
        Returns: Json
      }
      company_revenue_month_detail: {
        Args: { p_company: string; p_month: string }
        Returns: Json
      }
      company_revenue_overview: {
        Args: { p_company: string; p_end?: string; p_start?: string }
        Returns: Json
      }
      company_revenue_upsert: {
        Args: {
          p_company: string
          p_entries: Json
          p_month: string
          p_note: string
          p_reason?: string
        }
        Returns: undefined
      }
      company_search_match: {
        Args: { p_name: string; p_term: string; p_trade: string }
        Returns: boolean
      }
      company_task_counts: {
        Args: { p_collaborator?: string; p_end?: string; p_start: string }
        Returns: {
          company_id: string
          company_name: string
          done: number
          due_soon: number
          overdue: number
          pending: number
          total: number
        }[]
      }
      contract_duration: {
        Args: { p_ends: string; p_started: string }
        Returns: {
          months_total: number
          period_days: number
        }[]
      }
      crm_core_name: { Args: { p: string }; Returns: string }
      crm_intake_check_duplicate: {
        Args: {
          p_cnpj?: string
          p_ip?: string
          p_razao: string
          p_source?: string
        }
        Returns: Json
      }
      crm_intake_create: {
        Args: { p_ip?: string; p_payload: Json; p_source?: string }
        Returns: Json
      }
      crm_intake_refuse: {
        Args: {
          p_action: string
          p_code: string
          p_collision?: Json
          p_ip_hash: string
          p_message: string
          p_number: number
          p_payload: Json
          p_razao: string
          p_result: string
          p_source: string
        }
        Returns: Json
      }
      crm_name_number: { Args: { p: string }; Returns: number }
      crm_normalize_name: { Args: { p: string }; Returns: string }
      crm_similar_companies: {
        Args: { p_limit: number; p_min: number; p_razao: string }
        Returns: {
          group_name: string
          id: string
          name: string
          sim: number
        }[]
      }
      cs_board: {
        Args: never
        Returns: {
          cs_note_count: number
          effective_end: string
          group_id: string
          id: string
          installments: number
          meeting_on: string
          monthly_value: string
          months_total: number
          name: string
          nps_status: string
          pause_no_date: boolean
          paused_days: number
          period_days: number
          project_value: string
          responsibles: Json
          started_on: string
        }[]
      }
      cs_note_reply_counts: {
        Args: { p_company: string }
        Returns: {
          note_id: string
          reply_count: number
        }[]
      }
      cs_set_company_label: {
        Args: { p_company_id: string; p_label_id: string; p_on: boolean }
        Returns: undefined
      }
      cs_set_company_nps: {
        Args: {
          p_company_id: string
          p_status: Database["public"]["Enums"]["cs_nps_status"]
        }
        Returns: undefined
      }
      cs_set_contract_values: {
        Args: {
          p_company_id: string
          p_installments: number
          p_monthly: string
          p_total: string
        }
        Returns: undefined
      }
      cs_set_meeting_on: {
        Args: { p_company_id: string; p_date: string }
        Returns: undefined
      }
      cs_set_person_nps: {
        Args: {
          p_company_id: string
          p_status: Database["public"]["Enums"]["cs_nps_status"]
          p_user_id: string
        }
        Returns: undefined
      }
      dev_add_business_days: {
        Args: { p_from: string; p_n: number }
        Returns: string
      }
      dev_board: {
        Args: never
        Returns: {
          deadline_days: number
          deadline_forecast: string
          group_id: string
          history_count: number
          id: string
          labels: Json
          manual_paused: boolean
          name: string
          pause_reason: string
          paused_at: string
          paused_by_name: string
          running: boolean
          site_note_count: number
          started_ever: boolean
          status: string
          used_days: number
        }[]
      }
      dev_can_manage: { Args: never; Returns: boolean }
      dev_deadline_days: { Args: never; Returns: number }
      dev_easter: { Args: { p_year: number }; Returns: string }
      dev_elapsed_all: {
        Args: never
        Returns: {
          company_id: string
          used: number
        }[]
      }
      dev_elapsed_business_days: {
        Args: { p_company_id: string }
        Returns: number
      }
      dev_group_for_status: {
        Args: { p_status: Database["public"]["Enums"]["dev_status"] }
        Returns: string
      }
      dev_is_business_day: { Args: { d: string }; Returns: boolean }
      dev_move_company: {
        Args: { p_company_id: string; p_dev_group_id: string }
        Returns: undefined
      }
      dev_on_board: { Args: { p_company_id: string }; Returns: boolean }
      dev_pause_deadline: {
        Args: { p_company_id: string; p_reason: string }
        Returns: undefined
      }
      dev_resume_deadline: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      dev_row_running: {
        Args: {
          p_group_id: string
          p_manual_paused: boolean
          p_status: Database["public"]["Enums"]["dev_status"]
        }
        Returns: boolean
      }
      dev_set_status: {
        Args: {
          p_company_id: string
          p_status: Database["public"]["Enums"]["dev_status"]
        }
        Returns: undefined
      }
      dev_status_for_group: {
        Args: { p_group_id: string }
        Returns: Database["public"]["Enums"]["dev_status"]
      }
      dev_status_group_pairs: {
        Args: never
        Returns: {
          group_name: string
          status: Database["public"]["Enums"]["dev_status"]
        }[]
      }
      digisac_alert: {
        Args: { p_title: string; p_type: string }
        Returns: undefined
      }
      digisac_set_user_link: {
        Args: { p_auto?: boolean; p_profile_id: string; p_user_id: string }
        Returns: undefined
      }
      digisac_users_admin_list: {
        Args: never
        Returns: {
          digisac_name: string
          email: string
          id: string
          msgs: number
          profile_id: string
          profile_locked: boolean
          profile_name: string
        }[]
      }
      digisac_watchdog: { Args: never; Returns: undefined }
      display_name: { Args: { p_id: string }; Returns: string }
      display_names: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
          name: string
        }[]
      }
      display_profiles: {
        Args: { p_ids: string[] }
        Returns: {
          avatar_path: string
          id: string
          name: string
        }[]
      }
      effective_contract_end: { Args: { p_company: string }; Returns: string }
      entry_seconds: {
        Args: { p_ended: string; p_seconds: number; p_started: string }
        Returns: number
      }
      expire_overdue_standard_tasks: {
        Args: never
        Returns: {
          cancelled: number
          run_id: string
          skipped_open_timer: number
        }[]
      }
      followup_backfill: {
        Args: { p_from: string; p_to: string }
        Returns: number
      }
      followup_board: {
        Args: { p_month: string }
        Returns: {
          collaborators: Json
          color: string
          company_id: string
          company_name: string
          consultants: Json
          contact_color: string
          days_amarelo: number
          days_verde: number
          days_vermelho: number
          first_msg_at: string
          is_today: boolean
          last_msg_at: string
          next_meeting_at: string
          recovery_need: number
          red_since: string
          red_streak: number
          relapse_at: string
          relevant_day: string
          responsible_id: string
          responsible_name: string
        }[]
      }
      followup_company_history: {
        Args: { p_company: string; p_month: string }
        Returns: Json
      }
      followup_cron: { Args: never; Returns: number }
      followup_day_event: {
        Args: {
          p_color: string
          p_contact: string
          p_prev_color: string
          p_prev_need: number
        }
        Returns: string
      }
      followup_group_on_day: {
        Args: { p_company: string; p_day: string }
        Returns: string
      }
      followup_is_business_day: { Args: { p_day: string }; Returns: boolean }
      followup_last_closed_business_day: { Args: never; Returns: string }
      followup_last_sync: { Args: never; Returns: string }
      followup_recompute_day: { Args: { p_day: string }; Returns: number }
      followup_relevant_day: { Args: never; Returns: string }
      followup_scores_detail: {
        Args: { p_collaborator: string; p_month: string }
        Returns: {
          color: string
          company_id: string
          company_name: string
          contact_color: string
          d: string
          evento: string
          first_msg_at: string
          points: number
          recovery_need: number
        }[]
      }
      followup_scores_export: {
        Args: {
          p_collaborator?: string
          p_consultant?: string
          p_month: string
          p_recovering?: boolean
        }
        Returns: {
          color: string
          company_id: string
          company_name: string
          contact_color: string
          d: string
          finalized: boolean
          first_msg_at: string
          group_name: string
          points: number
          recovery_need: number
          responsible_id: string
          responsible_name: string
        }[]
      }
      followup_scores_month: {
        Args: {
          p_collaborator?: string
          p_consultant?: string
          p_month: string
          p_recovering?: boolean
        }
        Returns: {
          aproveitamento: number
          avatar_path: string
          client_days: number
          collaborator_id: string
          collaborator_name: string
          companies: number
          days_amarelo: number
          days_verde: number
          days_vermelho: number
          points: number
        }[]
      }
      followup_unlinked_companies: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
        }[]
      }
      generate_daily_tasks: {
        Args: { p_force?: boolean; target_date?: string }
        Returns: number
      }
      generate_template_today: {
        Args: { p_template: string }
        Returns: boolean
      }
      generate_template_today_edit: {
        Args: { p_template: string }
        Returns: string
      }
      google_audit: {
        Args: { p_action: string; p_detail?: string }
        Returns: undefined
      }
      google_connect_account: {
        Args: {
          p_access: string
          p_email: string
          p_expiry: string
          p_refresh: string
          p_scope: string
        }
        Returns: Json
      }
      google_delete_account: {
        Args: { p_revoked: boolean }
        Returns: undefined
      }
      google_enc_key: { Args: never; Returns: string }
      google_get_account: {
        Args: never
        Returns: {
          access_token: string
          google_email: string
          refresh_token: string
          scope: string
          token_expiry: string
        }[]
      }
      google_import_apply: {
        Args: { p_deletes: string[]; p_sync_token: string; p_upserts: Json }
        Returns: undefined
      }
      google_import_replace: {
        Args: {
          p_events: Json
          p_sync_token: string
          p_window_end: string
          p_window_start: string
        }
        Returns: undefined
      }
      google_mark_reconciled_if_clean: { Args: never; Returns: boolean }
      google_update_access: {
        Args: { p_access: string; p_expiry: string }
        Returns: undefined
      }
      google_upsert_account: {
        Args: {
          p_access: string
          p_email: string
          p_expiry: string
          p_refresh: string
          p_scope: string
        }
        Returns: undefined
      }
      imported_events_range: {
        Args: { p_from: string; p_to: string }
        Returns: {
          ends_at: string
          google_event_id: string
          id: string
          is_crm_meeting: boolean
          is_private: boolean
          owner_id: string
          starts_at: string
          title: string
        }[]
      }
      instance_timer_block: { Args: { p_task: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_internal_user: { Args: { p_user: string }; Returns: boolean }
      is_national_holiday: { Args: { d: string }; Returns: boolean }
      is_valid_cnpj: { Args: { p: string }; Returns: boolean }
      listing_validation_history: {
        Args: { p_listing_result: string }
        Returns: {
          at: string
          author: string
          author_type: string
          comment: string
          event_type: string
          id: string
        }[]
      }
      listing_validation_queue: {
        Args: never
        Returns: {
          at: string
          brand: string
          comment: string
          company_id: string
          company_name: string
          event_type: string
          link: string
          listing_result_id: string
          marketplace: Database["public"]["Enums"]["listing_marketplace"]
          task_id: string
        }[]
      }
      log_company_event: {
        Args: {
          p_actor?: string
          p_company: string
          p_details?: Json
          p_source?: string
          p_source_id?: string
          p_summary: string
          p_type: string
        }
        Returns: undefined
      }
      mark_listing_readjusted: {
        Args: { p_comment?: string; p_listing_result: string }
        Returns: Json
      }
      mark_validations_read: { Args: never; Returns: undefined }
      meeting_conflicts: {
        Args: {
          p_ends: string
          p_exclude?: string
          p_starts: string
          p_user_ids: string[]
        }
        Returns: {
          company_id: string
          company_name: string
          conflicting_user_ids: string[]
          ends_at: string
          meeting_id: string
          starts_at: string
          title: string
        }[]
      }
      meeting_directory: {
        Args: never
        Returns: {
          avatar_path: string
          email: string
          full_name: string
          id: string
          role: string
        }[]
      }
      meeting_is_visible: { Args: { p_meeting: string }; Returns: boolean }
      meeting_reconcile_apply: { Args: { p_id: string }; Returns: undefined }
      meeting_reconcile_dismiss: { Args: { p_id: string }; Returns: undefined }
      meeting_reconcile_enqueue: { Args: { p_ops: Json }; Returns: Json }
      meeting_reconcile_finalize: {
        Args: { p_owner: string }
        Returns: undefined
      }
      meeting_reconcile_list: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          crm_ends_at: string
          crm_meet_link: string
          crm_starts_at: string
          crm_title: string
          detected_at: string
          google_ends_at: string
          google_meet_link: string
          google_starts_at: string
          google_title: string
          google_updated_at: string
          has_timer: boolean
          id: string
          meeting_id: string
          motivo: string
          owner_auto_apply_from: string
          owner_id: string
          owner_name: string
          proposed_action: string
        }[]
      }
      meeting_reconcile_owners: {
        Args: never
        Returns: {
          auto_apply_from: string
          full_name: string
          google_email: string
          last_synced_at: string
          pending: number
          user_id: string
        }[]
      }
      meeting_timer_audit_list: {
        Args: { p_timer: string }
        Returns: {
          edited_at: string
          edited_by: string
          editor_name: string
          event_type: string
          from_company_name: string
          justification: string
          new_seconds: number
          old_seconds: number
          to_company_name: string
        }[]
      }
      meeting_timer_cron: { Args: never; Returns: number }
      meeting_timer_edit: {
        Args: { p_justification: string; p_seconds: number; p_timer: string }
        Returns: undefined
      }
      meeting_timer_finalize: { Args: { p_timer: string }; Returns: undefined }
      meeting_timer_owned: { Args: { p_timer: string }; Returns: boolean }
      meeting_timer_preempt: { Args: never; Returns: Json }
      meeting_timer_readable: { Args: { p_timer: string }; Returns: boolean }
      meeting_timer_resume: { Args: { p_timer: string }; Returns: Json }
      meeting_timer_start: {
        Args: {
          p_company_id?: string
          p_google_event_id?: string
          p_meeting_id?: string
          p_people?: string[]
        }
        Returns: Json
      }
      meeting_timer_stop: { Args: { p_timer: string }; Returns: undefined }
      meeting_timer_stop_self: { Args: never; Returns: undefined }
      meeting_timer_total_seconds: {
        Args: { p_timer: string }
        Returns: number
      }
      meeting_window_ok: {
        Args: { p_send: string; p_sstart: string }
        Returns: boolean
      }
      meetings_apply_google_sync: { Args: { p_ops: Json }; Returns: Json }
      meetings_set_sync: {
        Args: {
          p_email?: string
          p_error: string
          p_event_id?: string
          p_has_event?: boolean
          p_meet_link?: string
          p_meeting: string
          p_status: string
        }
        Returns: undefined
      }
      mentionable_users: {
        Args: { p_company: string; p_source_type: string }
        Returns: {
          avatar_path: string
          full_name: string
          id: string
        }[]
      }
      move_expired_active_to_renewal: { Args: never; Returns: number }
      my_collaborator_companies: { Args: never; Returns: string[] }
      my_consultant_companies: { Args: never; Returns: string[] }
      my_dev_companies: { Args: never; Returns: string[] }
      my_listings: {
        Args: never
        Returns: {
          brand: string
          company_id: string
          company_name: string
          date: string
          events: Json
          link: string
          listing_result_id: string
          marketplace: Database["public"]["Enums"]["listing_marketplace"]
          not_done_reason: string
          task_id: string
          task_title: string
          validation_at: string
          validation_by: string
          validation_comment: string
          validation_event: string
        }[]
      }
      my_open_meeting_timer: {
        Args: never
        Returns: {
          base_seconds: number
          company_id: string
          server_now: string
          started_at: string
          timer_id: string
          title: string
        }[]
      }
      my_traffic_companies: { Args: never; Returns: string[] }
      my_unread_total: { Args: never; Returns: number }
      my_unread_validations: { Args: never; Returns: number }
      next_business_day: { Args: { d: string }; Returns: string }
      note_has_area: {
        Args: {
          p_area: Database["public"]["Enums"]["note_area"]
          p_note: string
        }
        Returns: boolean
      }
      note_origin_area: {
        Args: { p_origin: string }
        Returns: Database["public"]["Enums"]["note_area"]
      }
      notifications_feed: {
        Args: { p_filter?: string; p_limit?: number; p_offset?: number }
        Returns: {
          actor_avatar_path: string
          actor_id: string
          actor_name: string
          body: string
          company_id: string
          company_name: string
          created_at: string
          id: string
          reachable: boolean
          read_at: string
          source_id: string
          source_type: string
          title: string
          type: string
        }[]
      }
      notifications_mark_all_read: { Args: never; Returns: undefined }
      notifications_mark_read: { Args: { p_ids: string[] }; Returns: undefined }
      notifications_unread_count: { Args: never; Returns: number }
      notify_admins_company: {
        Args: { p_company: string; p_title: string; p_type: string }
        Returns: undefined
      }
      pause_period_add: {
        Args: { p_company: string; p_ended: string; p_started: string }
        Returns: string
      }
      pause_period_delete: { Args: { p_id: string }; Returns: undefined }
      pause_period_set_dates: {
        Args: { p_ended: string; p_id: string; p_started: string }
        Returns: undefined
      }
      paused_days: {
        Args: { p_company: string; p_until: string }
        Returns: number
      }
      push_notification: {
        Args: {
          p_actor: string
          p_body: string
          p_company: string
          p_source_id: string
          p_source_type: string
          p_title: string
          p_type: string
          p_user: string
        }
        Returns: undefined
      }
      readable_meeting_timers: {
        Args: never
        Returns: {
          base_seconds: number
          company_id: string
          edited: boolean
          finalized: boolean
          google_event_id: string
          is_open: boolean
          meeting_id: string
          open_started_at: string
          server_now: string
          started_by: string
          timer_id: string
          title: string
        }[]
      }
      reassign_company_collaborator_tasks: {
        Args: { p_company: string; p_from: string; p_to: string }
        Returns: Json
      }
      recompute_attendance: {
        Args: { p_from: string; p_to: string }
        Returns: undefined
      }
      reorder_company_groups: { Args: { p_ids: string[] }; Returns: undefined }
      responsible_tracking_since: { Args: never; Returns: string }
      sales_channel_label: {
        Args: { p_channel: Database["public"]["Enums"]["sales_channel"] }
        Returns: string
      }
      schedule_conflicts: {
        Args: {
          p_ends: string
          p_exclude?: string
          p_starts: string
          p_user_ids: string[]
        }
        Returns: {
          company_name: string
          conflicting_user_ids: string[]
          ends_at: string
          ref_id: string
          source: string
          starts_at: string
          title: string
        }[]
      }
      set_companies_group: {
        Args: { p_group_id: string; p_items: Json }
        Returns: number
      }
      set_company_channels: {
        Args: { p_active: string[]; p_company: string }
        Returns: undefined
      }
      set_company_collaborators_apply: {
        Args: { p_add: string[]; p_company: string; p_remove: string[] }
        Returns: undefined
      }
      set_company_consultants: {
        Args: { p_company: string; p_ids: string[] }
        Returns: undefined
      }
      set_meeting_client_hidden: {
        Args: { p_hidden: boolean; p_meeting: string }
        Returns: undefined
      }
      set_my_meeting_response: {
        Args: { p_meeting: string; p_response: string }
        Returns: undefined
      }
      support_ticket_counts: {
        Args: never
        Returns: {
          finished_count: number
          open_count: number
        }[]
      }
      support_ticket_reply_counts: {
        Args: never
        Returns: {
          reply_count: number
          ticket_id: string
        }[]
      }
      sync_content_mentions: {
        Args: {
          p_source_id: string
          p_source_type: string
          p_user_ids: string[]
        }
        Returns: undefined
      }
      sync_standard_task: { Args: { p_standard: string }; Returns: number }
      sync_template_instances: { Args: { p_template: string }; Returns: number }
      task_auto_expired_at: { Args: { p_task: string }; Returns: string }
      task_group_stats: {
        Args: {
          p_collaborator_id?: string
          p_company_id?: string
          p_end?: string
          p_start?: string
        }
        Returns: {
          abertas: number
          atrasadas: number
          canceladas: number
          finalizadas: number
          first_date: string
          last_date: string
          seconds: number
          template_id: string
          total: number
        }[]
      }
      task_in_period: {
        Args: {
          p_due_at: string
          p_end: string
          p_start: string
          p_status: Database["public"]["Enums"]["task_status"]
        }
        Returns: boolean
      }
      task_status_counts: {
        Args: { p_collaborator?: string; p_end?: string; p_start: string }
        Returns: {
          a_fazer: number
          cancelada: number
          finalizada: number
          iniciada: number
          overdue: number
          total: number
        }[]
      }
      tasks_in_period: {
        Args: {
          p_collaborator?: string
          p_company?: string
          p_end?: string
          p_filter: string
          p_limit?: number
          p_start: string
        }
        Returns: {
          collaborator_avatar_path: string
          collaborator_email: string
          collaborator_full_name: string
          company_id: string
          company_name: string
          due_at: string
          id: string
          status: Database["public"]["Enums"]["task_status"]
          task_date: string
          template_id: string
          title: string
          total_seconds: number
        }[]
      }
      team_capacity: {
        Args: { p_end?: string; p_start?: string }
        Returns: {
          act_companies: number
          act_has_activity: boolean
          act_overdue: number
          act_pontual_done: number
          act_seconds: number
          act_seconds_diaria: number
          act_seconds_pontual: number
          avatar_path: string
          carteira_active: number
          carteira_alerta: number
          carteira_by_group: Json
          carteira_exclusive: number
          carteira_shared: number
          carteira_stalled: number
          colab_active: number
          colab_by_group: Json
          colab_out_of_portfolio: number
          has_colab_carteira: boolean
          is_executor: boolean
          meeting_seconds: number
          person_id: string
          person_name: string
        }[]
      }
      team_capacity_drilldown: {
        Args: {
          p_end?: string
          p_person: string
          p_scope: string
          p_start?: string
        }
        Returns: {
          company_id: string
          company_name: string
          days_since: number
          group_name: string
          labels: Json
          project_model: Json
          shared_with: Json
        }[]
      }
      team_capacity_task_drilldown: {
        Args: {
          p_end?: string
          p_person: string
          p_scope: string
          p_start?: string
        }
        Returns: {
          company_name: string
          ref_at: string
          seconds: number
          status: Database["public"]["Enums"]["task_status"]
          task_id: string
          title: string
        }[]
      }
      template_timer_block: { Args: { p_template: string }; Returns: string }
      time_by_collaborator: {
        Args: { p_end?: string; p_start: string }
        Returns: {
          collaborator_id: string
          seconds: number
        }[]
      }
      time_by_company: {
        Args: { p_collaborator?: string; p_end?: string; p_start: string }
        Returns: {
          company_id: string
          seconds: number
        }[]
      }
      time_by_company_category: {
        Args: { p_collaborator?: string; p_end?: string; p_start: string }
        Returns: {
          category: string
          company_id: string
          seconds: number
        }[]
      }
      time_by_company_standard: {
        Args: { p_collaborator?: string; p_end?: string; p_start: string }
        Returns: {
          company_id: string
          seconds: number
        }[]
      }
      time_by_task: {
        Args: {
          p_collaborator?: string
          p_company: string
          p_end?: string
          p_start: string
        }
        Returns: {
          seconds: number
          task_id: string
        }[]
      }
      time_by_task_category: {
        Args: {
          p_category: string
          p_collaborator?: string
          p_company: string
          p_end?: string
          p_start: string
        }
        Returns: {
          seconds: number
          task_id: string
        }[]
      }
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
      toggle_cs_note_checkbox: {
        Args: { p_html: string; p_id: string; p_token: string }
        Returns: string
      }
      toggle_cs_note_reply_checkbox: {
        Args: { p_html: string; p_id: string; p_token: string }
        Returns: string
      }
      toggle_note_checkbox: {
        Args: { p_html: string; p_id: string; p_token: string }
        Returns: string
      }
      toggle_note_reply_checkbox: {
        Args: { p_html: string; p_id: string; p_token: string }
        Returns: string
      }
      toggle_ticket_checkbox: {
        Args: { p_html: string; p_id: string; p_token: string }
        Returns: string
      }
      toggle_ticket_reply_checkbox: {
        Args: { p_html: string; p_id: string; p_token: string }
        Returns: string
      }
      traffic_board: {
        Args: never
        Returns: {
          budget: string
          ends_on: string
          focus: string
          group_id: string
          history_count: number
          id: string
          labels: Json
          manual_group_id: string
          months_total: number
          name: string
          period_days: number
          platform: string
          started_on: string
          status: string
          synced: boolean
          traffic_group_id: string
          traffic_note_count: number
        }[]
      }
      traffic_clear_manual_for: {
        Args: { p_companies: string[] }
        Returns: undefined
      }
      traffic_is_synced: { Args: { p_company_id: string }; Returns: boolean }
      traffic_move_company: {
        Args: { p_company_id: string; p_traffic_group_id: string }
        Returns: undefined
      }
      traffic_on_board: { Args: { p_company_id: string }; Returns: boolean }
      traffic_set_budget: {
        Args: { p_budget: string; p_company_id: string }
        Returns: undefined
      }
      traffic_set_focus: {
        Args: {
          p_company_id: string
          p_value: Database["public"]["Enums"]["traffic_focus"]
        }
        Returns: undefined
      }
      traffic_set_platform: {
        Args: {
          p_company_id: string
          p_value: Database["public"]["Enums"]["traffic_platform"]
        }
        Returns: undefined
      }
      traffic_set_status: {
        Args: {
          p_company_id: string
          p_value: Database["public"]["Enums"]["traffic_status"]
        }
        Returns: undefined
      }
      user_reaches_company: {
        Args: { p_company: string; p_user: string }
        Returns: boolean
      }
    }
    Enums: {
      churn_reason:
        | "erro_consultoria"
        | "erro_comercial"
        | "erro_gestao_cliente"
        | "cliente_demitido"
        | "projeto_finalizado"
        | "decisao_cliente"
        | "nao_informado"
      contract_cadence:
        | "semanal"
        | "quinzenal"
        | "semanal_quinzenal"
        | "quinzenal_semanal"
      contracted_service:
        | "mercado_livre"
        | "shopee"
        | "amazon"
        | "trafego"
        | "gestao_site"
        | "desenvolvimento_site"
      cs_nps_status:
        | "promotor"
        | "neutro"
        | "detrator"
        | "churn_erro_operacional"
        | "churn_projeto_finalizado"
      dev_status:
        | "lista_espera"
        | "aguardando_formulario"
        | "formulario_incompleto"
        | "em_desenvolvimento"
        | "entregue"
        | "pendencia_cliente"
        | "pausado"
        | "cancelado"
        | "gestao_site"
      listing_marketplace: "mercado_livre" | "shopee" | "amazon"
      note_area:
        | "ml"
        | "amz"
        | "shp"
        | "erp"
        | "site"
        | "trafego"
        | "outros"
        | "cs"
        | "comercial"
        | "diagnostico"
      project_model: "bpo" | "consultoria" | "ema"
      sales_channel: "mercado_livre" | "shopee" | "amazon" | "site_proprio"
      task_category:
        | "cadastro"
        | "precificacao"
        | "anuncio"
        | "ads"
        | "estudo"
        | "listagem"
        | "integracao"
        | "criar_conta"
      task_kind: "unica" | "diaria"
      task_status: "a_fazer" | "iniciada" | "finalizada" | "cancelada"
      template_type: "padrao" | "listagem"
      ticket_issue_type:
        | "integracao"
        | "chamado"
        | "bo_tray"
        | "bo_ml"
        | "bo_amazon"
        | "bo_shopee"
        | "bo_notas"
      ticket_status:
        | "em_andamento"
        | "parado"
        | "aguardando_cliente"
        | "aguardando_email"
        | "finalizado"
      ticket_urgency: "baixa" | "media" | "alta"
      traffic_focus: "vendas" | "whatsapp" | "whatsapp_vendas" | "negocio_local"
      traffic_platform:
        | "nao_iniciado"
        | "meta"
        | "google"
        | "google_meta"
        | "bagy"
      traffic_status:
        | "pausado"
        | "aguardando_conteudo"
        | "primeira_campanha"
        | "campanha_validada"
        | "projeto_entregue"
      user_role:
        | "admin"
        | "consultor"
        | "colaborador"
        | "pending"
        | "gestor_trafego"
        | "desenvolvedor"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      churn_reason: [
        "erro_consultoria",
        "erro_comercial",
        "erro_gestao_cliente",
        "cliente_demitido",
        "projeto_finalizado",
        "decisao_cliente",
        "nao_informado",
      ],
      contract_cadence: [
        "semanal",
        "quinzenal",
        "semanal_quinzenal",
        "quinzenal_semanal",
      ],
      contracted_service: [
        "mercado_livre",
        "shopee",
        "amazon",
        "trafego",
        "gestao_site",
        "desenvolvimento_site",
      ],
      cs_nps_status: [
        "promotor",
        "neutro",
        "detrator",
        "churn_erro_operacional",
        "churn_projeto_finalizado",
      ],
      dev_status: [
        "lista_espera",
        "aguardando_formulario",
        "formulario_incompleto",
        "em_desenvolvimento",
        "entregue",
        "pendencia_cliente",
        "pausado",
        "cancelado",
        "gestao_site",
      ],
      listing_marketplace: ["mercado_livre", "shopee", "amazon"],
      note_area: [
        "ml",
        "amz",
        "shp",
        "erp",
        "site",
        "trafego",
        "outros",
        "cs",
        "comercial",
        "diagnostico",
      ],
      project_model: ["bpo", "consultoria", "ema"],
      sales_channel: ["mercado_livre", "shopee", "amazon", "site_proprio"],
      task_category: [
        "cadastro",
        "precificacao",
        "anuncio",
        "ads",
        "estudo",
        "listagem",
        "integracao",
        "criar_conta",
      ],
      task_kind: ["unica", "diaria"],
      task_status: ["a_fazer", "iniciada", "finalizada", "cancelada"],
      template_type: ["padrao", "listagem"],
      ticket_issue_type: [
        "integracao",
        "chamado",
        "bo_tray",
        "bo_ml",
        "bo_amazon",
        "bo_shopee",
        "bo_notas",
      ],
      ticket_status: [
        "em_andamento",
        "parado",
        "aguardando_cliente",
        "aguardando_email",
        "finalizado",
      ],
      ticket_urgency: ["baixa", "media", "alta"],
      traffic_focus: ["vendas", "whatsapp", "whatsapp_vendas", "negocio_local"],
      traffic_platform: [
        "nao_iniciado",
        "meta",
        "google",
        "google_meta",
        "bagy",
      ],
      traffic_status: [
        "pausado",
        "aguardando_conteudo",
        "primeira_campanha",
        "campanha_validada",
        "projeto_entregue",
      ],
      user_role: [
        "admin",
        "consultor",
        "colaborador",
        "pending",
        "gestor_trafego",
        "desenvolvedor",
      ],
    },
  },
} as const

export type Role = Database["public"]["Enums"]["user_role"]
export type TaskKind = Database["public"]["Enums"]["task_kind"]
export type TaskCategory = Database["public"]["Enums"]["task_category"]
export type TaskStatus = Database["public"]["Enums"]["task_status"]
export type TemplateType = Database["public"]["Enums"]["template_type"]
export type ListingMarketplace = Database["public"]["Enums"]["listing_marketplace"]
export type NoteArea = Database["public"]["Enums"]["note_area"]

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
