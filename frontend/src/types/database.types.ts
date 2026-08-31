export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_role: Database["public"]["Enums"]["platform_role"] | null
          actor_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          organization_id: string | null
          subject_id: string | null
          subject_type: string
        }
        Insert: {
          action: string
          actor_role?: Database["public"]["Enums"]["platform_role"] | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          subject_id?: string | null
          subject_type: string
        }
        Update: {
          action?: string
          actor_role?: Database["public"]["Enums"]["platform_role"] | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          subject_id?: string | null
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          locality_id: string | null
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          locality_id?: string | null
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          locality_id?: string | null
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_creation_drafts: {
        Row: {
          city: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          display_name: string | null
          governorate: string | null
          id: string
          legal_name: string | null
          org_type: Database["public"]["Enums"]["organization_type"] | null
          organization_id: string | null
          primary_branch_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          city?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          display_name?: string | null
          governorate?: string | null
          id?: string
          legal_name?: string | null
          org_type?: Database["public"]["Enums"]["organization_type"] | null
          organization_id?: string | null
          primary_branch_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          display_name?: string | null
          governorate?: string | null
          id?: string
          legal_name?: string | null
          org_type?: Database["public"]["Enums"]["organization_type"] | null
          organization_id?: string | null
          primary_branch_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_creation_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_creation_drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      business_onboarding: {
        Row: {
          city: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          display_name: string | null
          governorate: string | null
          legal_name: string | null
          org_type: Database["public"]["Enums"]["organization_type"] | null
          organization_id: string | null
          owner_confirmed: boolean
          primary_branch_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          city?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          display_name?: string | null
          governorate?: string | null
          legal_name?: string | null
          org_type?: Database["public"]["Enums"]["organization_type"] | null
          organization_id?: string | null
          owner_confirmed?: boolean
          primary_branch_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          display_name?: string | null
          governorate?: string | null
          legal_name?: string | null
          org_type?: Database["public"]["Enums"]["organization_type"] | null
          organization_id?: string | null
          owner_confirmed?: boolean
          primary_branch_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_onboarding_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_onboarding_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_receipts: {
        Row: {
          accepted_at: string
          consent_type: Database["public"]["Enums"]["consent_type"]
          id: string
          locale: string
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          consent_type: Database["public"]["Enums"]["consent_type"]
          id?: string
          locale: string
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          consent_type?: Database["public"]["Enums"]["consent_type"]
          id?: string
          locale?: string
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          channel: Database["public"]["Enums"]["contact_channel"]
          created_at: string
          id: string
          is_primary: boolean
          is_verified: boolean
          updated_at: string
          user_id: string
          value: string
          verified_at: string | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["contact_channel"]
          created_at?: string
          id?: string
          is_primary?: boolean
          is_verified?: boolean
          updated_at?: string
          user_id: string
          value: string
          verified_at?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["contact_channel"]
          created_at?: string
          id?: string
          is_primary?: boolean
          is_verified?: boolean
          updated_at?: string
          user_id?: string
          value?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_read_state: {
        Row: {
          conversation_id: string
          id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          last_read_at: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_read_state_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_read_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          last_message_at: string | null
          requester_org_id: string
          subject_id: string
          subject_type: string
          supplier_org_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          last_message_at?: string | null
          requester_org_id: string
          subject_id: string
          subject_type: string
          supplier_org_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          last_message_at?: string | null
          requester_org_id?: string
          subject_id?: string
          subject_type?: string
          supplier_org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_requester_org_id_fkey"
            columns: ["requester_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_supplier_org_id_fkey"
            columns: ["supplier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          archived_at: string | null
          assigned_membership_id: string | null
          branch_id: string | null
          created_at: string
          created_by: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          display_name: string
          email: string | null
          email_normalized: string | null
          id: string
          locality_id: string | null
          location_summary: string | null
          organization_id: string
          preferred_language: string | null
          primary_phone: string | null
          primary_phone_e164: string | null
          source: Database["public"]["Enums"]["sales_source"] | null
          status: Database["public"]["Enums"]["customer_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_membership_id?: string | null
          branch_id?: string | null
          created_at?: string
          created_by: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          display_name: string
          email?: string | null
          email_normalized?: string | null
          id?: string
          locality_id?: string | null
          location_summary?: string | null
          organization_id: string
          preferred_language?: string | null
          primary_phone?: string | null
          primary_phone_e164?: string | null
          source?: Database["public"]["Enums"]["sales_source"] | null
          status?: Database["public"]["Enums"]["customer_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_membership_id?: string | null
          branch_id?: string | null
          created_at?: string
          created_by?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          display_name?: string
          email?: string | null
          email_normalized?: string | null
          id?: string
          locality_id?: string | null
          location_summary?: string | null
          organization_id?: string
          preferred_language?: string | null
          primary_phone?: string | null
          primary_phone_e164?: string | null
          source?: Database["public"]["Enums"]["sales_source"] | null
          status?: Database["public"]["Enums"]["customer_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_customers_assignee"
            columns: ["organization_id", "assigned_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_customers_branch"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      follow_up_tasks: {
        Row: {
          assigned_membership_id: string
          branch_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          description: string | null
          due_at: string | null
          id: string
          lead_id: string | null
          organization_id: string
          priority: Database["public"]["Enums"]["sales_priority"]
          status: Database["public"]["Enums"]["follow_up_status"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          assigned_membership_id: string
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          lead_id?: string | null
          organization_id: string
          priority?: Database["public"]["Enums"]["sales_priority"]
          status?: Database["public"]["Enums"]["follow_up_status"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          assigned_membership_id?: string
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          lead_id?: string | null
          organization_id?: string
          priority?: Database["public"]["Enums"]["sales_priority"]
          status?: Database["public"]["Enums"]["follow_up_status"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_follow_up_assignee"
            columns: ["organization_id", "assigned_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_branch"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_customer"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_lead"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_lead"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "sales_my_open_leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "follow_up_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      individual_onboarding: {
        Row: {
          consumer_budget: string | null
          consumer_city: string | null
          consumer_completed_at: string | null
          consumer_governorate: string | null
          consumer_intent: string | null
          consumer_interests: string[] | null
          created_at: string
          prof_additional_services: string[] | null
          prof_availability: string | null
          prof_city: string | null
          prof_concrete_type: Database["public"]["Enums"]["persona_type"] | null
          prof_governorate: string | null
          prof_max_travel_km: number | null
          prof_offers_remote: boolean
          prof_service_areas: string[] | null
          prof_services: string[] | null
          prof_specialization: string | null
          prof_years_experience: number | null
          professional_completed_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          consumer_budget?: string | null
          consumer_city?: string | null
          consumer_completed_at?: string | null
          consumer_governorate?: string | null
          consumer_intent?: string | null
          consumer_interests?: string[] | null
          created_at?: string
          prof_additional_services?: string[] | null
          prof_availability?: string | null
          prof_city?: string | null
          prof_concrete_type?:
            | Database["public"]["Enums"]["persona_type"]
            | null
          prof_governorate?: string | null
          prof_max_travel_km?: number | null
          prof_offers_remote?: boolean
          prof_service_areas?: string[] | null
          prof_services?: string[] | null
          prof_specialization?: string | null
          prof_years_experience?: number | null
          professional_completed_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          consumer_budget?: string | null
          consumer_city?: string | null
          consumer_completed_at?: string | null
          consumer_governorate?: string | null
          consumer_intent?: string | null
          consumer_interests?: string[] | null
          created_at?: string
          prof_additional_services?: string[] | null
          prof_availability?: string | null
          prof_city?: string | null
          prof_concrete_type?:
            | Database["public"]["Enums"]["persona_type"]
            | null
          prof_governorate?: string | null
          prof_max_travel_km?: number | null
          prof_offers_remote?: boolean
          prof_service_areas?: string[] | null
          prof_services?: string[] | null
          prof_specialization?: string | null
          prof_years_experience?: number | null
          professional_completed_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "individual_onboarding_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_membership_id: string | null
          branch_id: string | null
          closed_at: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          id: string
          lost_reason: string | null
          next_follow_up_at: string | null
          organization_id: string
          priority: Database["public"]["Enums"]["sales_priority"]
          source: Database["public"]["Enums"]["sales_source"] | null
          stage: Database["public"]["Enums"]["lead_stage"]
          status: Database["public"]["Enums"]["lead_status"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          assigned_membership_id?: string | null
          branch_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          id?: string
          lost_reason?: string | null
          next_follow_up_at?: string | null
          organization_id: string
          priority?: Database["public"]["Enums"]["sales_priority"]
          source?: Database["public"]["Enums"]["sales_source"] | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          status?: Database["public"]["Enums"]["lead_status"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          assigned_membership_id?: string | null
          branch_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          id?: string
          lost_reason?: string | null
          next_follow_up_at?: string | null
          organization_id?: string
          priority?: Database["public"]["Enums"]["sales_priority"]
          source?: Database["public"]["Enums"]["sales_source"] | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          status?: Database["public"]["Enums"]["lead_status"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_leads_assignee"
            columns: ["organization_id", "assigned_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_leads_branch"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_leads_customer"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_branch_access: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          membership_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          membership_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_branch_access_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_branch_access_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_capabilities: {
        Row: {
          capability_key: string
          created_at: string
          id: string
          membership_id: string
        }
        Insert: {
          capability_key: string
          created_at?: string
          id?: string
          membership_id: string
        }
        Update: {
          capability_key?: string
          created_at?: string
          id?: string
          membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_capabilities_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invited_by: string | null
          organization_id: string
          primary_branch_id: string | null
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          primary_branch_id?: string | null
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          primary_branch_id?: string | null
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_primary_branch_id_fkey"
            columns: ["primary_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          sender_organization_id: string
          sender_user_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_organization_id: string
          sender_user_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_organization_id?: string
          sender_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_organization_id_fkey"
            columns: ["sender_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_user_id_fkey"
            columns: ["sender_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body_key: string | null
          created_at: string
          deep_link: string
          event_type: string
          id: string
          organization_id: string | null
          params: Json
          read_at: string | null
          recipient_user_id: string
          subject_id: string | null
          subject_type: string
          title_key: string
        }
        Insert: {
          body_key?: string | null
          created_at?: string
          deep_link: string
          event_type: string
          id?: string
          organization_id?: string | null
          params?: Json
          read_at?: string | null
          recipient_user_id: string
          subject_id?: string | null
          subject_type: string
          title_key: string
        }
        Update: {
          body_key?: string | null
          created_at?: string
          deep_link?: string
          event_type?: string
          id?: string
          organization_id?: string | null
          params?: Json
          read_at?: string | null
          recipient_user_id?: string
          subject_id?: string | null
          subject_type?: string
          title_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_progress: {
        Row: {
          account_type_completed_at: string | null
          completed_at: string | null
          contact_completed_at: string | null
          created_at: string
          phone: string | null
          profile_completed_at: string | null
          selected_org_type:
            | Database["public"]["Enums"]["organization_type"]
            | null
          selected_persona: Database["public"]["Enums"]["persona_type"] | null
          selected_track: Database["public"]["Enums"]["onboarding_track"] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type_completed_at?: string | null
          completed_at?: string | null
          contact_completed_at?: string | null
          created_at?: string
          phone?: string | null
          profile_completed_at?: string | null
          selected_org_type?:
            | Database["public"]["Enums"]["organization_type"]
            | null
          selected_persona?: Database["public"]["Enums"]["persona_type"] | null
          selected_track?:
            | Database["public"]["Enums"]["onboarding_track"]
            | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type_completed_at?: string | null
          completed_at?: string | null
          contact_completed_at?: string | null
          created_at?: string
          phone?: string | null
          profile_completed_at?: string | null
          selected_org_type?:
            | Database["public"]["Enums"]["organization_type"]
            | null
          selected_persona?: Database["public"]["Enums"]["persona_type"] | null
          selected_track?:
            | Database["public"]["Enums"]["onboarding_track"]
            | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          line_total: number | null
          order_id: string
          product_name: string
          quantity: number
          unit: Database["public"]["Enums"]["product_unit"]
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total?: number | null
          order_id: string
          product_name: string
          quantity: number
          unit: Database["public"]["Enums"]["product_unit"]
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total?: number | null
          order_id?: string
          product_name?: string
          quantity?: number
          unit?: Database["public"]["Enums"]["product_unit"]
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_category_spend"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          confirmed_at: string
          created_at: string
          created_by: string
          id: string
          note: string | null
          quotation_id: string
          requester_branch_id: string | null
          requester_org_id: string
          rfq_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          supplier_org_id: string
          title: string
          total: number
          updated_at: string
          version: number
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          confirmed_at?: string
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          quotation_id: string
          requester_branch_id?: string | null
          requester_org_id: string
          rfq_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          supplier_org_id: string
          title: string
          total?: number
          updated_at?: string
          version?: number
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          confirmed_at?: string
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          quotation_id?: string
          requester_branch_id?: string | null
          requester_org_id?: string
          rfq_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          supplier_org_id?: string
          title?: string
          total?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_orders_requester_branch"
            columns: ["requester_org_id", "requester_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: true
            referencedRelation: "quotation_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: true
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_requester_org_id_fkey"
            columns: ["requester_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfq_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_supplier_org_id_fkey"
            columns: ["supplier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          phone: string | null
          primary_branch_id: string | null
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string | null
          expires_at: string
          id?: string
          invited_by?: string | null
          organization_id: string
          phone?: string | null
          primary_branch_id?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          token: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          phone?: string | null
          primary_branch_id?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_accepted_user_id_fkey"
            columns: ["accepted_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_primary_branch_id_fkey"
            columns: ["primary_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_join_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          id: string
          membership_id: string | null
          note: string | null
          organization_id: string
          requested_branch_id: string | null
          status: Database["public"]["Enums"]["affiliation_request_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          membership_id?: string | null
          note?: string | null
          organization_id: string
          requested_branch_id?: string | null
          status?: Database["public"]["Enums"]["affiliation_request_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          membership_id?: string | null
          note?: string | null
          organization_id?: string
          requested_branch_id?: string | null
          status?: Database["public"]["Enums"]["affiliation_request_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_join_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_join_requests_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_join_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_join_requests_requested_branch_id_fkey"
            columns: ["requested_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_join_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_referrals: {
        Row: {
          city: string | null
          created_at: string
          decision_reason: string | null
          description: string | null
          display_name: string | null
          governorate: string | null
          id: string
          join_request_id: string | null
          legal_name: string | null
          org_type: Database["public"]["Enums"]["organization_type"]
          organization_id: string | null
          primary_branch_name: string | null
          referred_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["referral_status"]
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          decision_reason?: string | null
          description?: string | null
          display_name?: string | null
          governorate?: string | null
          id?: string
          join_request_id?: string | null
          legal_name?: string | null
          org_type?: Database["public"]["Enums"]["organization_type"]
          organization_id?: string | null
          primary_branch_name?: string | null
          referred_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          decision_reason?: string | null
          description?: string | null
          display_name?: string | null
          governorate?: string | null
          id?: string
          join_request_id?: string | null
          legal_name?: string | null
          org_type?: Database["public"]["Enums"]["organization_type"]
          organization_id?: string | null
          primary_branch_name?: string | null
          referred_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_referrals_join_request_id_fkey"
            columns: ["join_request_id"]
            isOneToOne: false
            referencedRelation: "organization_join_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_referrals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_referrals_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_referrals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          is_verified: boolean
          locality_id: string | null
          logo_media_id: string | null
          name: string
          org_type: Database["public"]["Enums"]["organization_type"]
          primary_locale: string
          referred_by_user_id: string | null
          slug: string | null
          source: string
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          is_verified?: boolean
          locality_id?: string | null
          logo_media_id?: string | null
          name: string
          org_type: Database["public"]["Enums"]["organization_type"]
          primary_locale?: string
          referred_by_user_id?: string | null
          slug?: string | null
          source?: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          is_verified?: boolean
          locality_id?: string | null
          logo_media_id?: string | null
          name?: string
          org_type?: Database["public"]["Enums"]["organization_type"]
          primary_locale?: string
          referred_by_user_id?: string | null
          slug?: string | null
          source?: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_referred_by_user_id_fkey"
            columns: ["referred_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_role_grants: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["platform_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_role_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_role_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      points_ledger: {
        Row: {
          awarded_by_user_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          organization_id: string | null
          points_delta: number
          reason_code: string | null
          reverses_entry_id: string | null
          source_id: string
          source_type: string
          user_id: string
        }
        Insert: {
          awarded_by_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          points_delta: number
          reason_code?: string | null
          reverses_entry_id?: string | null
          source_id: string
          source_type: string
          user_id: string
        }
        Update: {
          awarded_by_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          points_delta?: number
          reason_code?: string | null
          reverses_entry_id?: string | null
          source_id?: string
          source_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "points_ledger_awarded_by_user_id_fkey"
            columns: ["awarded_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_reverses_entry_id_fkey"
            columns: ["reverses_entry_id"]
            isOneToOne: false
            referencedRelation: "points_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string | null
          category: Database["public"]["Enums"]["product_category"]
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          image_ref: string | null
          name: string
          organization_id: string
          published_at: string | null
          short_description: string | null
          sku: string | null
          status: Database["public"]["Enums"]["product_status"]
          unit: Database["public"]["Enums"]["product_unit"]
          updated_at: string
          version: number
        }
        Insert: {
          brand?: string | null
          category: Database["public"]["Enums"]["product_category"]
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          image_ref?: string | null
          name: string
          organization_id: string
          published_at?: string | null
          short_description?: string | null
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          unit: Database["public"]["Enums"]["product_unit"]
          updated_at?: string
          version?: number
        }
        Update: {
          brand?: string | null
          category?: Database["public"]["Enums"]["product_category"]
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          image_ref?: string | null
          name?: string
          organization_id?: string
          published_at?: string | null
          short_description?: string | null
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          unit?: Database["public"]["Enums"]["product_unit"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_media_id: string | null
          bio: string | null
          created_at: string
          deleted_at: string | null
          display_name: string
          headline: string | null
          id: string
          languages: string[] | null
          locality_id: string | null
          public_profile_status: Database["public"]["Enums"]["public_profile_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_media_id?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name: string
          headline?: string | null
          id?: string
          languages?: string[] | null
          locality_id?: string | null
          public_profile_status?: Database["public"]["Enums"]["public_profile_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_media_id?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string
          headline?: string | null
          id?: string
          languages?: string[] | null
          locality_id?: string | null
          public_profile_status?: Database["public"]["Enums"]["public_profile_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          activated_at: string | null
          branch_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          executing_org_id: string
          id: string
          location: string | null
          order_id: string
          requester_org_id: string
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          target_date: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          activated_at?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          executing_org_id: string
          id?: string
          location?: string | null
          order_id: string
          requester_org_id: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_date?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          activated_at?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          executing_org_id?: string
          id?: string
          location?: string | null
          order_id?: string
          requester_org_id?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_date?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_projects_branch"
            columns: ["requester_org_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_executing_org_id_fkey"
            columns: ["executing_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "order_category_spend"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "projects_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "order_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_requester_org_id_fkey"
            columns: ["requester_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_items: {
        Row: {
          created_at: string
          id: string
          line_total: number | null
          product_name: string
          quantity: number
          quotation_id: string
          rfq_item_id: string
          unit: Database["public"]["Enums"]["product_unit"]
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total?: number | null
          product_name: string
          quantity: number
          quotation_id: string
          rfq_item_id: string
          unit: Database["public"]["Enums"]["product_unit"]
          unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total?: number | null
          product_name?: string
          quantity?: number
          quotation_id?: string
          rfq_item_id?: string
          unit?: Database["public"]["Enums"]["product_unit"]
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_quotation_items_quotation"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotation_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_quotation_items_quotation"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_quotation_items_rfq_item"
            columns: ["rfq_item_id"]
            isOneToOne: false
            referencedRelation: "rfq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotation_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          created_at: string
          created_by: string
          decided_at: string | null
          decided_by: string | null
          id: string
          note: string | null
          requester_org_id: string
          rfq_id: string
          status: Database["public"]["Enums"]["quotation_status"]
          submitted_at: string | null
          subtotal: number
          supplier_org_id: string
          total: number
          updated_at: string
          validity_date: string | null
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          requester_org_id: string
          rfq_id: string
          status?: Database["public"]["Enums"]["quotation_status"]
          submitted_at?: string | null
          subtotal?: number
          supplier_org_id: string
          total?: number
          updated_at?: string
          validity_date?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          requester_org_id?: string
          rfq_id?: string
          status?: Database["public"]["Enums"]["quotation_status"]
          submitted_at?: string | null
          subtotal?: number
          supplier_org_id?: string
          total?: number
          updated_at?: string
          validity_date?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_requester_org_id_fkey"
            columns: ["requester_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfq_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_supplier_org_id_fkey"
            columns: ["supplier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_items: {
        Row: {
          created_at: string
          id: string
          note: string | null
          product_id: string | null
          product_name: string
          quantity: number
          rfq_id: string
          unit: Database["public"]["Enums"]["product_unit"]
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          product_id?: string | null
          product_name: string
          quantity: number
          rfq_id: string
          unit: Database["public"]["Enums"]["product_unit"]
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          product_id?: string | null
          product_name?: string
          quantity?: number
          rfq_id?: string
          unit?: Database["public"]["Enums"]["product_unit"]
        }
        Relationships: [
          {
            foreignKeyName: "fk_rfq_items_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_published_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_rfq_items_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_items_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfq_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_items_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      rfqs: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string
          id: string
          note: string | null
          requester_branch_id: string | null
          requester_org_id: string
          required_date: string | null
          status: Database["public"]["Enums"]["rfq_status"]
          submitted_at: string | null
          supplier_org_id: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          requester_branch_id?: string | null
          requester_org_id: string
          required_date?: string | null
          status?: Database["public"]["Enums"]["rfq_status"]
          submitted_at?: string | null
          supplier_org_id: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          requester_branch_id?: string | null
          requester_org_id?: string
          required_date?: string | null
          status?: Database["public"]["Enums"]["rfq_status"]
          submitted_at?: string | null
          supplier_org_id?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_rfqs_requester_branch"
            columns: ["requester_org_id", "requester_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "rfqs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_requester_org_id_fkey"
            columns: ["requester_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_supplier_org_id_fkey"
            columns: ["supplier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["sales_activity_type"]
          actor_membership_id: string
          branch_id: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          id: string
          lead_id: string | null
          metadata: Json
          occurred_at: string
          organization_id: string
          summary: string
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["sales_activity_type"]
          actor_membership_id: string
          branch_id?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json
          occurred_at?: string
          organization_id: string
          summary: string
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["sales_activity_type"]
          actor_membership_id?: string
          branch_id?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_sales_activity_actor"
            columns: ["organization_id", "actor_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_sales_activity_branch"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_sales_activity_customer"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_sales_activity_lead"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_sales_activity_lead"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "sales_my_open_leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sales_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_products: {
        Row: {
          created_at: string
          note: string | null
          organization_id: string
          product_id: string
          saved_by: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          organization_id: string
          product_id: string
          saved_by: string
        }
        Update: {
          created_at?: string
          note?: string | null
          organization_id?: string
          product_id?: string
          saved_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_published_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_products_saved_by_fkey"
            columns: ["saved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          id: string
          is_verified: boolean
          locale: string
          primary_account_type:
            | Database["public"]["Enums"]["persona_type"]
            | null
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          is_verified?: boolean
          locale?: string
          primary_account_type?:
            | Database["public"]["Enums"]["persona_type"]
            | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_verified?: boolean
          locale?: string
          primary_account_type?:
            | Database["public"]["Enums"]["persona_type"]
            | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      verification_documents: {
        Row: {
          created_at: string
          doc_type: string
          id: string
          storage_object_path: string | null
          verification_id: string
        }
        Insert: {
          created_at?: string
          doc_type: string
          id?: string
          storage_object_path?: string | null
          verification_id: string
        }
        Update: {
          created_at?: string
          doc_type?: string
          id?: string
          storage_object_path?: string | null
          verification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_documents_verification_id_fkey"
            columns: ["verification_id"]
            isOneToOne: false
            referencedRelation: "verifications"
            referencedColumns: ["id"]
          },
        ]
      }
      verifications: {
        Row: {
          applied_at: string | null
          created_at: string
          decided_at: string | null
          expires_at: string | null
          grants_public_listing: boolean
          id: string
          metadata: Json
          organization_id: string | null
          reason: string | null
          requested_account_type:
            | Database["public"]["Enums"]["persona_type"]
            | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["verification_status"]
          subject_type: Database["public"]["Enums"]["verification_subject"]
          submitted_at: string
          updated_at: string
          user_id: string | null
          verification_type: Database["public"]["Enums"]["verification_type"]
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          decided_at?: string | null
          expires_at?: string | null
          grants_public_listing?: boolean
          id?: string
          metadata?: Json
          organization_id?: string | null
          reason?: string | null
          requested_account_type?:
            | Database["public"]["Enums"]["persona_type"]
            | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          subject_type: Database["public"]["Enums"]["verification_subject"]
          submitted_at?: string
          updated_at?: string
          user_id?: string | null
          verification_type: Database["public"]["Enums"]["verification_type"]
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          decided_at?: string | null
          expires_at?: string | null
          grants_public_listing?: boolean
          id?: string
          metadata?: Json
          organization_id?: string | null
          reason?: string | null
          requested_account_type?:
            | Database["public"]["Enums"]["persona_type"]
            | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          subject_type?: Database["public"]["Enums"]["verification_subject"]
          submitted_at?: string
          updated_at?: string
          user_id?: string | null
          verification_type?: Database["public"]["Enums"]["verification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "verifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verifications_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      catalog_published_products: {
        Row: {
          brand: string | null
          category: Database["public"]["Enums"]["product_category"] | null
          id: string | null
          image_ref: string | null
          name: string | null
          organization_id: string | null
          published_at: string | null
          short_description: string | null
          sku: string | null
          supplier_name: string | null
          supplier_slug: string | null
          supplier_verified: boolean | null
          unit: Database["public"]["Enums"]["product_unit"] | null
        }
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_category_spend: {
        Row: {
          amount: number | null
          category: Database["public"]["Enums"]["product_category"] | null
          confirmed_at: string | null
          order_id: string | null
          requester_branch_id: string | null
          requester_org_id: string | null
          status: Database["public"]["Enums"]["order_status"] | null
          supplier_org_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_orders_requester_branch"
            columns: ["requester_org_id", "requester_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "orders_requester_org_id_fkey"
            columns: ["requester_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_supplier_org_id_fkey"
            columns: ["supplier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_list: {
        Row: {
          completed_at: string | null
          confirmed_at: string | null
          created_at: string | null
          has_project: boolean | null
          id: string | null
          item_count: number | null
          quotation_id: string | null
          requester_branch_id: string | null
          requester_name: string | null
          requester_org_id: string | null
          rfq_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["order_status"] | null
          supplier_name: string | null
          supplier_org_id: string | null
          title: string | null
          total: number | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          has_project?: never
          id?: string | null
          item_count?: never
          quotation_id?: string | null
          requester_branch_id?: string | null
          requester_name?: never
          requester_org_id?: string | null
          rfq_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["order_status"] | null
          supplier_name?: never
          supplier_org_id?: string | null
          title?: string | null
          total?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          has_project?: never
          id?: string | null
          item_count?: never
          quotation_id?: string | null
          requester_branch_id?: string | null
          requester_name?: never
          requester_org_id?: string | null
          rfq_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["order_status"] | null
          supplier_name?: never
          supplier_org_id?: string | null
          title?: string | null
          total?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_orders_requester_branch"
            columns: ["requester_org_id", "requester_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: true
            referencedRelation: "quotation_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: true
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_requester_org_id_fkey"
            columns: ["requester_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfq_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_supplier_org_id_fkey"
            columns: ["supplier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_public_directory: {
        Row: {
          id: string | null
          is_verified: boolean | null
          locality_id: string | null
          logo_media_id: string | null
          name: string | null
          org_type: Database["public"]["Enums"]["organization_type"] | null
          primary_locale: string | null
          slug: string | null
        }
        Relationships: []
      }
      profile_public_directory: {
        Row: {
          avatar_media_id: string | null
          bio: string | null
          display_name: string | null
          headline: string | null
          id: string | null
          languages: string[] | null
          locality_id: string | null
          persona: Database["public"]["Enums"]["persona_type"] | null
          service_areas: string[] | null
          services: string[] | null
          specialization: string | null
          years_experience: number | null
        }
        Relationships: []
      }
      project_list: {
        Row: {
          activated_at: string | null
          branch_id: string | null
          completed_at: string | null
          created_at: string | null
          executing_name: string | null
          executing_org_id: string | null
          id: string | null
          location: string | null
          order_id: string | null
          order_total: number | null
          requester_name: string | null
          requester_org_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"] | null
          target_date: string | null
          title: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          activated_at?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          executing_name?: never
          executing_org_id?: string | null
          id?: string | null
          location?: string | null
          order_id?: string | null
          order_total?: never
          requester_name?: never
          requester_org_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"] | null
          target_date?: string | null
          title?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          activated_at?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          executing_name?: never
          executing_org_id?: string | null
          id?: string | null
          location?: string | null
          order_id?: string | null
          order_total?: never
          requester_name?: never
          requester_org_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"] | null
          target_date?: string | null
          title?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_projects_branch"
            columns: ["requester_org_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "projects_executing_org_id_fkey"
            columns: ["executing_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "order_category_spend"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "projects_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "order_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_requester_org_id_fkey"
            columns: ["requester_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_list: {
        Row: {
          created_at: string | null
          decided_at: string | null
          id: string | null
          item_count: number | null
          requester_name: string | null
          requester_org_id: string | null
          rfq_id: string | null
          rfq_title: string | null
          status: Database["public"]["Enums"]["quotation_status"] | null
          submitted_at: string | null
          subtotal: number | null
          supplier_name: string | null
          supplier_org_id: string | null
          total: number | null
          updated_at: string | null
          validity_date: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_requester_org_id_fkey"
            columns: ["requester_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfq_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_supplier_org_id_fkey"
            columns: ["supplier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_list: {
        Row: {
          created_at: string | null
          id: string | null
          item_count: number | null
          requester_branch_id: string | null
          requester_name: string | null
          requester_org_id: string | null
          required_date: string | null
          status: Database["public"]["Enums"]["rfq_status"] | null
          submitted_at: string | null
          supplier_name: string | null
          supplier_org_id: string | null
          title: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          item_count?: never
          requester_branch_id?: string | null
          requester_name?: never
          requester_org_id?: string | null
          required_date?: string | null
          status?: Database["public"]["Enums"]["rfq_status"] | null
          submitted_at?: string | null
          supplier_name?: never
          supplier_org_id?: string | null
          title?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          item_count?: never
          requester_branch_id?: string | null
          requester_name?: never
          requester_org_id?: string | null
          required_date?: string | null
          status?: Database["public"]["Enums"]["rfq_status"] | null
          submitted_at?: string | null
          supplier_name?: never
          supplier_org_id?: string | null
          title?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_rfqs_requester_branch"
            columns: ["requester_org_id", "requester_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "rfqs_requester_org_id_fkey"
            columns: ["requester_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_supplier_org_id_fkey"
            columns: ["supplier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_follow_ups_due_today: {
        Row: {
          assigned_membership_id: string | null
          branch_id: string | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          description: string | null
          due_at: string | null
          id: string | null
          lead_id: string | null
          organization_id: string | null
          priority: Database["public"]["Enums"]["sales_priority"] | null
          status: Database["public"]["Enums"]["follow_up_status"] | null
          title: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          assigned_membership_id?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string | null
          lead_id?: string | null
          organization_id?: string | null
          priority?: Database["public"]["Enums"]["sales_priority"] | null
          status?: Database["public"]["Enums"]["follow_up_status"] | null
          title?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          assigned_membership_id?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string | null
          lead_id?: string | null
          organization_id?: string | null
          priority?: Database["public"]["Enums"]["sales_priority"] | null
          status?: Database["public"]["Enums"]["follow_up_status"] | null
          title?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_follow_up_assignee"
            columns: ["organization_id", "assigned_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_branch"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_customer"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_lead"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_lead"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "sales_my_open_leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "follow_up_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_lead_stage_counts: {
        Row: {
          lead_count: number | null
          organization_id: string | null
          stage: Database["public"]["Enums"]["lead_stage"] | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_my_open_leads: {
        Row: {
          assigned_membership_id: string | null
          branch_id: string | null
          closed_at: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          id: string | null
          lost_reason: string | null
          next_follow_up_at: string | null
          organization_id: string | null
          priority: Database["public"]["Enums"]["sales_priority"] | null
          source: Database["public"]["Enums"]["sales_source"] | null
          stage: Database["public"]["Enums"]["lead_stage"] | null
          status: Database["public"]["Enums"]["lead_status"] | null
          title: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          assigned_membership_id?: string | null
          branch_id?: string | null
          closed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          id?: string | null
          lost_reason?: string | null
          next_follow_up_at?: string | null
          organization_id?: string | null
          priority?: Database["public"]["Enums"]["sales_priority"] | null
          source?: Database["public"]["Enums"]["sales_source"] | null
          stage?: Database["public"]["Enums"]["lead_stage"] | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          title?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          assigned_membership_id?: string | null
          branch_id?: string | null
          closed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          id?: string | null
          lost_reason?: string | null
          next_follow_up_at?: string | null
          organization_id?: string | null
          priority?: Database["public"]["Enums"]["sales_priority"] | null
          source?: Database["public"]["Enums"]["sales_source"] | null
          stage?: Database["public"]["Enums"]["lead_stage"] | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          title?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_leads_assignee"
            columns: ["organization_id", "assigned_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_leads_branch"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_leads_customer"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_overdue_follow_ups: {
        Row: {
          assigned_membership_id: string | null
          branch_id: string | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          description: string | null
          due_at: string | null
          id: string | null
          lead_id: string | null
          organization_id: string | null
          priority: Database["public"]["Enums"]["sales_priority"] | null
          status: Database["public"]["Enums"]["follow_up_status"] | null
          title: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          assigned_membership_id?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string | null
          lead_id?: string | null
          organization_id?: string | null
          priority?: Database["public"]["Enums"]["sales_priority"] | null
          status?: Database["public"]["Enums"]["follow_up_status"] | null
          title?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          assigned_membership_id?: string | null
          branch_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string | null
          lead_id?: string | null
          organization_id?: string | null
          priority?: Database["public"]["Enums"]["sales_priority"] | null
          status?: Database["public"]["Enums"]["follow_up_status"] | null
          title?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_follow_up_assignee"
            columns: ["organization_id", "assigned_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_branch"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_customer"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_lead"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_follow_up_lead"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "sales_my_open_leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "follow_up_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_recent_activities: {
        Row: {
          activity_type:
            | Database["public"]["Enums"]["sales_activity_type"]
            | null
          actor_membership_id: string | null
          branch_id: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          id: string | null
          lead_id: string | null
          metadata: Json | null
          occurred_at: string | null
          organization_id: string | null
          summary: string | null
        }
        Insert: {
          activity_type?:
            | Database["public"]["Enums"]["sales_activity_type"]
            | null
          actor_membership_id?: string | null
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          id?: string | null
          lead_id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          organization_id?: string | null
          summary?: string | null
        }
        Update: {
          activity_type?:
            | Database["public"]["Enums"]["sales_activity_type"]
            | null
          actor_membership_id?: string | null
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          id?: string | null
          lead_id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          organization_id?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sales_activity_actor"
            columns: ["organization_id", "actor_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_sales_activity_branch"
            columns: ["organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_sales_activity_customer"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_sales_activity_lead"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_sales_activity_lead"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "sales_my_open_leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sales_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_product_list: {
        Row: {
          brand: string | null
          category: Database["public"]["Enums"]["product_category"] | null
          image_ref: string | null
          name: string | null
          note: string | null
          organization_id: string | null
          product_id: string | null
          saved_at: string | null
          saved_by: string | null
          short_description: string | null
          sku: string | null
          supplier_name: string | null
          supplier_org_id: string | null
          supplier_verified: boolean | null
          unit: Database["public"]["Enums"]["product_unit"] | null
        }
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["supplier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_published_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_products_saved_by_fkey"
            columns: ["saved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      activate_project: {
        Args: { p_expected_version: number; p_project_id: string }
        Returns: number
      }
      add_rfq_item: {
        Args: {
          p_note?: string
          p_product_id: string
          p_quantity: number
          p_rfq_id: string
        }
        Returns: string
      }
      add_sales_activity: {
        Args: {
          p_activity_type: Database["public"]["Enums"]["sales_activity_type"]
          p_customer_id?: string
          p_lead_id?: string
          p_metadata?: Json
          p_occurred_at?: string
          p_org_id: string
          p_summary: string
        }
        Returns: string
      }
      adjust_points: {
        Args: {
          p_organization_id?: string
          p_points_delta: number
          p_reason_code: string
          p_user_id: string
        }
        Returns: string
      }
      admin_showroom_referrals_list: {
        Args: { p_pending_only?: boolean }
        Returns: {
          city: string
          created_at: string
          decision_reason: string
          description: string
          display_name: string
          governorate: string
          id: string
          legal_name: string
          match_count: number
          match_id: string
          match_name: string
          org_type: Database["public"]["Enums"]["organization_type"]
          organization_id: string
          organization_name: string
          primary_branch_name: string
          referred_by: string
          referrer_email: string
          referrer_name: string
          referrer_persona: Database["public"]["Enums"]["persona_type"]
          reviewed_at: string
          status: Database["public"]["Enums"]["referral_status"]
        }[]
      }
      apply_account_upgrade: {
        Args: { p_verification_id: string }
        Returns: undefined
      }
      apply_organization_verification: {
        Args: { p_verification_id: string }
        Returns: undefined
      }
      assign_lead: {
        Args: {
          p_assignee_membership_id: string
          p_expected_version: number
          p_lead_id: string
        }
        Returns: number
      }
      branch_assign: {
        Args: { p_branch_id: string; p_membership_id: string }
        Returns: string
      }
      branch_unassign: {
        Args: { p_branch_id: string; p_membership_id: string }
        Returns: undefined
      }
      business_draft_save: {
        Args: {
          p_city?: string
          p_description?: string
          p_display_name?: string
          p_draft_id?: string
          p_governorate?: string
          p_legal_name?: string
          p_org_type?: Database["public"]["Enums"]["organization_type"]
          p_primary_branch_name?: string
        }
        Returns: string
      }
      business_draft_submit: { Args: { p_draft_id?: string }; Returns: string }
      business_save: {
        Args: {
          p_city?: string
          p_description?: string
          p_display_name?: string
          p_governorate?: string
          p_legal_name?: string
          p_org_type?: Database["public"]["Enums"]["organization_type"]
          p_owner_confirmed?: boolean
          p_primary_branch_name?: string
        }
        Returns: undefined
      }
      business_submit: { Args: never; Returns: string }
      cancel_follow_up: { Args: { p_follow_up_id: string }; Returns: undefined }
      cancel_order: { Args: { p_order_id: string }; Returns: undefined }
      cancel_rfq: { Args: { p_rfq_id: string }; Returns: undefined }
      complete_follow_up: {
        Args: { p_follow_up_id: string }
        Returns: undefined
      }
      complete_project: {
        Args: { p_expected_version: number; p_project_id: string }
        Returns: number
      }
      create_customer: {
        Args: {
          p_assigned_membership_id?: string
          p_branch_id?: string
          p_customer_type?: Database["public"]["Enums"]["customer_type"]
          p_display_name: string
          p_email?: string
          p_location_summary?: string
          p_org_id: string
          p_preferred_language?: string
          p_primary_phone?: string
          p_source?: Database["public"]["Enums"]["sales_source"]
        }
        Returns: string
      }
      create_follow_up: {
        Args: {
          p_assignee_membership_id: string
          p_customer_id?: string
          p_description?: string
          p_due_at?: string
          p_lead_id?: string
          p_org_id: string
          p_priority?: Database["public"]["Enums"]["sales_priority"]
          p_title: string
        }
        Returns: string
      }
      create_lead: {
        Args: {
          p_assigned_membership_id?: string
          p_branch_id?: string
          p_customer_id?: string
          p_next_follow_up_at?: string
          p_org_id: string
          p_priority?: Database["public"]["Enums"]["sales_priority"]
          p_source?: Database["public"]["Enums"]["sales_source"]
          p_title: string
        }
        Returns: string
      }
      create_order_from_quotation: {
        Args: { p_quotation_id: string }
        Returns: string
      }
      create_product: {
        Args: {
          p_brand?: string
          p_category: Database["public"]["Enums"]["product_category"]
          p_image_ref?: string
          p_name: string
          p_org_id: string
          p_short_description?: string
          p_sku?: string
          p_unit: Database["public"]["Enums"]["product_unit"]
        }
        Returns: string
      }
      create_project_from_order: {
        Args: {
          p_description?: string
          p_location?: string
          p_order_id: string
          p_start_date?: string
          p_target_date?: string
          p_title: string
        }
        Returns: string
      }
      create_quotation: {
        Args: { p_note?: string; p_rfq_id: string; p_validity_date?: string }
        Returns: string
      }
      create_rfq: {
        Args: {
          p_branch_id?: string
          p_note?: string
          p_requester_org_id: string
          p_required_date?: string
          p_supplier_org_id: string
          p_title: string
        }
        Returns: string
      }
      decide_quotation: {
        Args: {
          p_accept: boolean
          p_expected_version: number
          p_quotation_id: string
        }
        Returns: number
      }
      individual_complete_consumer: { Args: never; Returns: undefined }
      individual_save_consumer: {
        Args: {
          p_budget?: string
          p_city?: string
          p_governorate?: string
          p_intent?: string
          p_interests?: string[]
        }
        Returns: undefined
      }
      individual_save_professional: {
        Args: {
          p_additional_services?: string[]
          p_availability?: string
          p_bio?: string
          p_city?: string
          p_concrete_type: Database["public"]["Enums"]["persona_type"]
          p_governorate?: string
          p_headline?: string
          p_languages?: string[]
          p_max_travel_km?: number
          p_offers_remote?: boolean
          p_service_areas?: string[]
          p_services?: string[]
          p_specialization?: string
          p_years_experience?: number
        }
        Returns: undefined
      }
      individual_submit_professional: { Args: never; Returns: string }
      invitation_accept: { Args: { p_token: string }; Returns: string }
      invitation_create: {
        Args: {
          p_email?: string
          p_org_id: string
          p_phone?: string
          p_primary_branch_id?: string
        }
        Returns: string
      }
      invitation_lookup: {
        Args: { p_token: string }
        Returns: {
          channel: string
          contact_masked: string
          matches_caller: boolean
          organization_name: string
          status: string
        }[]
      }
      mark_all_notifications_read: {
        Args: { p_org_id?: string }
        Returns: number
      }
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      mark_notification_read: { Args: { p_id: string }; Returns: undefined }
      membership_activate: {
        Args: { p_membership_id: string }
        Returns: undefined
      }
      membership_invite: {
        Args: {
          p_org_id: string
          p_primary_branch_id?: string
          p_user_id: string
        }
        Returns: string
      }
      membership_revoke: {
        Args: { p_membership_id: string }
        Returns: undefined
      }
      membership_set_capabilities: {
        Args: { p_capabilities: string[]; p_membership_id: string }
        Returns: undefined
      }
      membership_suspend: {
        Args: { p_membership_id: string }
        Returns: undefined
      }
      my_registration_state: { Args: never; Returns: string }
      my_showroom_affiliations: {
        Args: never
        Returns: {
          branch_name: string
          created_at: string
          decided_at: string
          decision_reason: string
          is_verified: boolean
          org_type: Database["public"]["Enums"]["organization_type"]
          organization_id: string
          organization_name: string
          request_id: string
          status: Database["public"]["Enums"]["affiliation_request_status"]
          via_referral: boolean
        }[]
      }
      my_showroom_referrals: {
        Args: never
        Returns: {
          city: string
          created_at: string
          decision_reason: string
          description: string
          display_name: string
          governorate: string
          id: string
          legal_name: string
          org_type: Database["public"]["Enums"]["organization_type"]
          organization_id: string
          primary_branch_name: string
          reviewed_at: string
          status: Database["public"]["Enums"]["referral_status"]
        }[]
      }
      my_workspaces: {
        Args: never
        Returns: {
          kind: string
          name: string
          org_type: Database["public"]["Enums"]["organization_type"]
          organization_id: string
          persona: Database["public"]["Enums"]["persona_type"]
          relationship: string
        }[]
      }
      onboarding_save_contact: { Args: { p_phone: string }; Returns: undefined }
      onboarding_save_profile: {
        Args: { p_display_name: string; p_locale: string }
        Returns: undefined
      }
      onboarding_select_account_type: {
        Args: {
          p_account_type?: string
          p_track: Database["public"]["Enums"]["onboarding_track"]
        }
        Returns: undefined
      }
      open_conversation: {
        Args: { p_subject_id: string; p_subject_type: string }
        Returns: string
      }
      org_join_request_approve: {
        Args: { p_branch_id?: string; p_request_id: string }
        Returns: string
      }
      org_join_request_reject: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      org_join_requests_list: {
        Args: { p_org_id: string }
        Returns: {
          branch_id: string
          branch_name: string
          created_at: string
          decided_at: string
          decision_reason: string
          display_name: string
          email_masked: string
          note: string
          persona: Database["public"]["Enums"]["persona_type"]
          request_id: string
          status: Database["public"]["Enums"]["affiliation_request_status"]
          user_id: string
        }[]
      }
      org_members_list: {
        Args: { p_org_id: string }
        Returns: {
          accepted_at: string
          branch_ids: string[]
          capabilities: string[]
          display_name: string
          email_masked: string
          invited_at: string
          membership_id: string
          primary_account_type: Database["public"]["Enums"]["persona_type"]
          primary_branch_id: string
          status: Database["public"]["Enums"]["membership_status"]
          user_id: string
        }[]
      }
      points_balance: { Args: { p_user_id?: string }; Returns: number }
      reassign_follow_up: {
        Args: {
          p_assignee_membership_id: string
          p_expected_version?: number
          p_follow_up_id: string
        }
        Returns: undefined
      }
      record_consent: {
        Args: {
          p_locale: string
          p_types: Database["public"]["Enums"]["consent_type"][]
        }
        Returns: undefined
      }
      remove_rfq_item: { Args: { p_item_id: string }; Returns: undefined }
      reopen_follow_up: { Args: { p_follow_up_id: string }; Returns: undefined }
      request_account_upgrade: {
        Args: {
          p_requested_account_type: Database["public"]["Enums"]["persona_type"]
        }
        Returns: string
      }
      reverse_points_entry: {
        Args: { p_entry_id: string; p_reason_code: string }
        Returns: string
      }
      review_approve: {
        Args: { p_grant_public_listing?: boolean; p_verification_id: string }
        Returns: undefined
      }
      review_reject: {
        Args: { p_reason: string; p_verification_id: string }
        Returns: undefined
      }
      review_request_changes: {
        Args: { p_reason: string; p_verification_id: string }
        Returns: undefined
      }
      review_start: { Args: { p_verification_id: string }; Returns: undefined }
      save_product: {
        Args: {
          p_note?: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: undefined
      }
      send_message: {
        Args: { p_body: string; p_conversation_id: string }
        Returns: string
      }
      set_customer_ownership: {
        Args: {
          p_change_assignee?: boolean
          p_change_branch?: boolean
          p_customer_id: string
          p_expected_updated_at: string
          p_new_assignee_membership_id?: string
          p_new_branch_id?: string
        }
        Returns: undefined
      }
      set_lead_source_branch: {
        Args: {
          p_change_branch?: boolean
          p_change_source?: boolean
          p_expected_version: number
          p_lead_id: string
          p_new_branch_id?: string
          p_new_source?: Database["public"]["Enums"]["sales_source"]
          p_reassign?: boolean
          p_reassign_membership_id?: string
        }
        Returns: number
      }
      set_product_published: {
        Args: {
          p_expected_version: number
          p_product_id: string
          p_published: boolean
        }
        Returns: number
      }
      set_profile_hidden: { Args: { p_user_id: string }; Returns: undefined }
      set_quotation_item_price: {
        Args: { p_item_id: string; p_unit_price: number }
        Returns: undefined
      }
      showroom_branches: {
        Args: { p_org_id: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      showroom_directory_search: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          id: string
          is_verified: boolean
          locality_id: string
          logo_media_id: string
          name: string
          org_type: Database["public"]["Enums"]["organization_type"]
          primary_locale: string
          slug: string
        }[]
      }
      showroom_join_request_cancel: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      showroom_join_request_create: {
        Args: {
          p_branch_id?: string
          p_note?: string
          p_organization_id: string
        }
        Returns: string
      }
      showroom_referral_approve: {
        Args: { p_link_organization_id?: string; p_referral_id: string }
        Returns: string
      }
      showroom_referral_reject: {
        Args: { p_reason: string; p_referral_id: string }
        Returns: undefined
      }
      showroom_referral_save: {
        Args: {
          p_city?: string
          p_description?: string
          p_display_name?: string
          p_governorate?: string
          p_legal_name?: string
          p_primary_branch_name?: string
          p_referral_id?: string
        }
        Returns: string
      }
      showroom_referral_submit: {
        Args: { p_referral_id?: string }
        Returns: string
      }
      start_order: {
        Args: { p_expected_version: number; p_order_id: string }
        Returns: number
      }
      submit_quotation: {
        Args: { p_expected_version: number; p_quotation_id: string }
        Returns: number
      }
      submit_rfq: {
        Args: { p_expected_version: number; p_rfq_id: string }
        Returns: number
      }
      transition_lead: {
        Args: {
          p_expected_version: number
          p_lead_id: string
          p_lost_reason?: string
          p_new_stage?: Database["public"]["Enums"]["lead_stage"]
          p_new_status?: Database["public"]["Enums"]["lead_status"]
        }
        Returns: number
      }
      unsave_product: {
        Args: { p_organization_id: string; p_product_id: string }
        Returns: undefined
      }
      update_customer: {
        Args: {
          p_archive?: boolean
          p_clear_email?: boolean
          p_clear_location?: boolean
          p_clear_phone?: boolean
          p_customer_id: string
          p_display_name?: string
          p_email?: string
          p_expected_updated_at?: string
          p_location_summary?: string
          p_preferred_language?: string
          p_primary_phone?: string
          p_source?: Database["public"]["Enums"]["sales_source"]
        }
        Returns: undefined
      }
      update_follow_up: {
        Args: {
          p_clear_description?: boolean
          p_clear_due?: boolean
          p_description?: string
          p_due_at?: string
          p_expected_version?: number
          p_follow_up_id: string
          p_priority?: Database["public"]["Enums"]["sales_priority"]
          p_title?: string
        }
        Returns: undefined
      }
      update_lead_details: {
        Args: {
          p_clear_next_follow_up?: boolean
          p_customer_id?: string
          p_expected_version: number
          p_lead_id: string
          p_next_follow_up_at?: string
          p_priority?: Database["public"]["Enums"]["sales_priority"]
          p_title?: string
        }
        Returns: number
      }
      update_product: {
        Args: {
          p_brand?: string
          p_category?: Database["public"]["Enums"]["product_category"]
          p_clear_brand?: boolean
          p_clear_description?: boolean
          p_clear_sku?: boolean
          p_expected_version: number
          p_image_ref?: string
          p_name?: string
          p_product_id: string
          p_short_description?: string
          p_sku?: string
          p_unit?: Database["public"]["Enums"]["product_unit"]
        }
        Returns: number
      }
      update_quotation: {
        Args: {
          p_clear_note?: boolean
          p_clear_validity?: boolean
          p_expected_version: number
          p_note?: string
          p_quotation_id: string
          p_validity_date?: string
        }
        Returns: number
      }
      update_rfq: {
        Args: {
          p_clear_note?: boolean
          p_clear_required_date?: boolean
          p_expected_version: number
          p_note?: string
          p_required_date?: string
          p_rfq_id: string
          p_title?: string
        }
        Returns: number
      }
    }
    Enums: {
      affiliation_request_status:
        | "pending"
        | "approved"
        | "rejected"
        | "cancelled"
      consent_type: "terms" | "privacy" | "pilot"
      contact_channel: "whatsapp" | "email"
      customer_status: "active" | "archived"
      customer_type: "individual" | "company"
      follow_up_status: "open" | "completed" | "cancelled"
      invitation_status: "pending" | "accepted" | "revoked" | "expired"
      lead_stage:
        | "new"
        | "contacted"
        | "qualified"
        | "proposal_pending"
        | "decision_pending"
      lead_status: "active" | "won" | "lost" | "archived"
      membership_status: "invited" | "active" | "suspended" | "revoked"
      onboarding_track: "consumer" | "professional" | "business"
      order_status: "confirmed" | "in_progress" | "completed" | "cancelled"
      org_status:
        | "draft"
        | "pending_verification"
        | "active"
        | "suspended"
        | "archived"
      organization_type:
        | "showroom_dealer"
        | "supplier"
        | "manufacturer"
        | "importer"
        | "wholesaler"
        | "contractor_company"
        | "design_office"
      persona_type:
        | "end_consumer"
        | "engineer"
        | "interior_designer"
        | "installer_technician"
        | "contractor"
        | "sales"
        | "trainer"
        | "trainee"
      platform_role: "support" | "moderator" | "administrator"
      product_category:
        | "finishing"
        | "construction"
        | "interior_design"
        | "furnishing"
        | "supply"
        | "tools"
        | "other"
      product_status: "draft" | "published"
      product_unit:
        | "piece"
        | "box"
        | "set"
        | "meter"
        | "square_meter"
        | "linear_meter"
        | "kilogram"
        | "ton"
        | "liter"
        | "roll"
        | "bag"
        | "pack"
      project_status: "planned" | "active" | "completed"
      public_profile_status: "hidden" | "listed"
      quotation_status: "draft" | "submitted" | "accepted" | "rejected"
      referral_status: "draft" | "submitted" | "approved" | "rejected"
      rfq_status: "draft" | "submitted" | "quoted" | "closed" | "cancelled"
      sales_activity_type:
        | "note"
        | "call"
        | "meeting"
        | "follow_up"
        | "status_change"
        | "assignment_change"
      sales_priority: "low" | "normal" | "high" | "urgent"
      sales_source:
        | "referral"
        | "walk_in"
        | "phone"
        | "whatsapp"
        | "website"
        | "campaign"
        | "other"
      user_status:
        | "pending_verification"
        | "active"
        | "suspended"
        | "deactivated"
      verification_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "approved"
        | "rejected"
        | "needs_more_info"
        | "expired"
      verification_subject: "user" | "organization"
      verification_type: "identity" | "professional" | "organization"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      affiliation_request_status: [
        "pending",
        "approved",
        "rejected",
        "cancelled",
      ],
      consent_type: ["terms", "privacy", "pilot"],
      contact_channel: ["whatsapp", "email"],
      customer_status: ["active", "archived"],
      customer_type: ["individual", "company"],
      follow_up_status: ["open", "completed", "cancelled"],
      invitation_status: ["pending", "accepted", "revoked", "expired"],
      lead_stage: [
        "new",
        "contacted",
        "qualified",
        "proposal_pending",
        "decision_pending",
      ],
      lead_status: ["active", "won", "lost", "archived"],
      membership_status: ["invited", "active", "suspended", "revoked"],
      onboarding_track: ["consumer", "professional", "business"],
      order_status: ["confirmed", "in_progress", "completed", "cancelled"],
      org_status: [
        "draft",
        "pending_verification",
        "active",
        "suspended",
        "archived",
      ],
      organization_type: [
        "showroom_dealer",
        "supplier",
        "manufacturer",
        "importer",
        "wholesaler",
        "contractor_company",
        "design_office",
      ],
      persona_type: [
        "end_consumer",
        "engineer",
        "interior_designer",
        "installer_technician",
        "contractor",
        "sales",
        "trainer",
        "trainee",
      ],
      platform_role: ["support", "moderator", "administrator"],
      product_category: [
        "finishing",
        "construction",
        "interior_design",
        "furnishing",
        "supply",
        "tools",
        "other",
      ],
      product_status: ["draft", "published"],
      product_unit: [
        "piece",
        "box",
        "set",
        "meter",
        "square_meter",
        "linear_meter",
        "kilogram",
        "ton",
        "liter",
        "roll",
        "bag",
        "pack",
      ],
      project_status: ["planned", "active", "completed"],
      public_profile_status: ["hidden", "listed"],
      quotation_status: ["draft", "submitted", "accepted", "rejected"],
      referral_status: ["draft", "submitted", "approved", "rejected"],
      rfq_status: ["draft", "submitted", "quoted", "closed", "cancelled"],
      sales_activity_type: [
        "note",
        "call",
        "meeting",
        "follow_up",
        "status_change",
        "assignment_change",
      ],
      sales_priority: ["low", "normal", "high", "urgent"],
      sales_source: [
        "referral",
        "walk_in",
        "phone",
        "whatsapp",
        "website",
        "campaign",
        "other",
      ],
      user_status: [
        "pending_verification",
        "active",
        "suspended",
        "deactivated",
      ],
      verification_status: [
        "draft",
        "submitted",
        "under_review",
        "approved",
        "rejected",
        "needs_more_info",
        "expired",
      ],
      verification_subject: ["user", "organization"],
      verification_type: ["identity", "professional", "organization"],
    },
  },
} as const

