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
      companies: {
        Row: {
          created_at: string
          created_by: string | null
          group_id: string | null
          id: string
          name: string
          updated_at: string
          whatsapp_contact_id: string | null
          whatsapp_group_name: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          group_id?: string | null
          id?: string
          name: string
          updated_at?: string
          whatsapp_contact_id?: string | null
          whatsapp_group_name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          group_id?: string | null
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
          {
            foreignKeyName: "companies_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "company_groups"
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
      company_groups: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          position: number
        }
        Insert: {
          color: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          position: number
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_groups_created_by_fkey"
            columns: ["created_by"]
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
      company_message_reads: {
        Row: {
          company_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_message_reads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_message_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_messages: {
        Row: {
          author_id: string | null
          author_type: string
          body: string
          client_ip_hash: string | null
          client_session_id: string | null
          client_user_agent: string | null
          company_id: string
          created_at: string
          id: string
        }
        Insert: {
          author_id?: string | null
          author_type: string
          body: string
          client_ip_hash?: string | null
          client_session_id?: string | null
          client_user_agent?: string | null
          company_id: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string | null
          author_type?: string
          body?: string
          client_ip_hash?: string | null
          client_session_id?: string | null
          client_user_agent?: string | null
          company_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
          last_full_sync_at: string | null
          last_synced_at: string | null
          sync_token: string | null
          updated_at: string
          user_id: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          last_full_sync_at?: string | null
          last_synced_at?: string | null
          sync_token?: string | null
          updated_at?: string
          user_id: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          last_full_sync_at?: string | null
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
          highlight: boolean
          id: string
          name: string
          text_color: string
        }
        Insert: {
          bg_color?: string
          created_at?: string
          created_by?: string | null
          highlight?: boolean
          id?: string
          name: string
          text_color?: string
        }
        Update: {
          bg_color?: string
          created_at?: string
          created_by?: string | null
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
      meetings: {
        Row: {
          client_hidden: boolean
          company_id: string
          created_at: string
          created_by: string
          description: string | null
          ends_at: string
          google_calendar_id: string | null
          google_event_id: string | null
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
          google_event_id?: string | null
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
          google_event_id?: string | null
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
      support_ticket_replies: {
        Row: {
          attachments: Json
          author_id: string
          body_html: string
          created_at: string
          edited_at: string | null
          id: string
          ticket_id: string
        }
        Insert: {
          attachments?: Json
          author_id: string
          body_html: string
          created_at?: string
          edited_at?: string | null
          id?: string
          ticket_id: string
        }
        Update: {
          attachments?: Json
          author_id?: string
          body_html?: string
          created_at?: string
          edited_at?: string | null
          id?: string
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
      admin_delete_meeting: { Args: { p_meeting: string }; Returns: undefined }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      client_followup: {
        Args: { p_desc?: boolean; p_period_days?: number }
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
      client_portal_message_send: {
        Args: {
          p_body: string
          p_ip?: string
          p_session: string
          p_token: string
          p_user_agent?: string
        }
        Returns: Json
      }
      client_portal_messages: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_session: string
          p_token: string
        }
        Returns: Json
      }
      client_portal_messages_since: {
        Args: { p_after: string; p_session: string; p_token: string }
        Returns: Json
      }
      client_portal_payload: { Args: { p_company: string }; Returns: Json }
      client_portal_preview: { Args: { p_company: string }; Returns: Json }
      client_portal_preview_meetings: {
        Args: { p_company: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      client_portal_preview_messages: {
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
      collaborator_task_counts: {
        Args: { p_start: string }
        Returns: {
          collaborator_id: string
          done: number
          total: number
        }[]
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
      company_task_counts: {
        Args: { p_collaborator?: string; p_start: string }
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
      entry_seconds: {
        Args: { p_ended: string; p_seconds: number; p_started: string }
        Returns: number
      }
      generate_daily_tasks: { Args: { target_date?: string }; Returns: number }
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
          id: string
          is_private: boolean
          owner_id: string
          starts_at: string
          title: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
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
      message_inbox: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          last_at: string
          last_author: string
          last_author_type: string
          last_body: string
          unread: number
        }[]
      }
      my_collaborator_companies: { Args: never; Returns: string[] }
      my_consultant_companies: { Args: never; Returns: string[] }
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
      my_unread_messages: { Args: never; Returns: number }
      my_unread_total: { Args: never; Returns: number }
      my_unread_validations: { Args: never; Returns: number }
      reorder_company_groups: { Args: { p_ids: string[] }; Returns: undefined }
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
        Args: { p_company_ids: string[]; p_group_id: string }
        Returns: number
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
      sync_standard_task: { Args: { p_standard: string }; Returns: number }
      sync_template_instances: { Args: { p_template: string }; Returns: number }
      task_group_stats: {
        Args: {
          p_collaborator_id?: string
          p_company_id?: string
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
      task_status_counts: {
        Args: { p_collaborator?: string; p_start: string }
        Returns: {
          a_fazer: number
          cancelada: number
          finalizada: number
          iniciada: number
          overdue: number
          total: number
        }[]
      }
      time_by_collaborator: {
        Args: { p_start: string }
        Returns: {
          collaborator_id: string
          seconds: number
        }[]
      }
      time_by_company: {
        Args: { p_collaborator?: string; p_start: string }
        Returns: {
          company_id: string
          seconds: number
        }[]
      }
      time_by_task: {
        Args: { p_collaborator?: string; p_company: string; p_start: string }
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
    }
    Enums: {
      listing_marketplace: "mercado_livre" | "shopee" | "amazon"
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
