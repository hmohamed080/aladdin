export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
            referencedRelation: "organization_public_directory"
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
            referencedRelation: "organization_public_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
            referencedRelation: "organization_public_directory"
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
            referencedRelation: "organization_public_directory"
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
            referencedRelation: "organization_public_directory"
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
            referencedRelation: "organization_public_directory"
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
          org_type: Database["public"]["Enums"]["account_type"]
          primary_locale: string
          slug: string | null
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
          org_type: Database["public"]["Enums"]["account_type"]
          primary_locale?: string
          slug?: string | null
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
          org_type?: Database["public"]["Enums"]["account_type"]
          primary_locale?: string
          slug?: string | null
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
            referencedRelation: "organization_public_directory"
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
      users: {
        Row: {
          created_at: string
          id: string
          is_verified: boolean
          locale: string
          primary_account_type: Database["public"]["Enums"]["account_type"]
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          is_verified?: boolean
          locale?: string
          primary_account_type?: Database["public"]["Enums"]["account_type"]
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_verified?: boolean
          locale?: string
          primary_account_type?: Database["public"]["Enums"]["account_type"]
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
            | Database["public"]["Enums"]["account_type"]
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
            | Database["public"]["Enums"]["account_type"]
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
            | Database["public"]["Enums"]["account_type"]
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
            referencedRelation: "organization_public_directory"
            referencedColumns: ["id"]
          },
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
      organization_public_directory: {
        Row: {
          id: string | null
          is_verified: boolean | null
          locality_id: string | null
          logo_media_id: string | null
          name: string | null
          org_type: Database["public"]["Enums"]["account_type"] | null
          primary_locale: string | null
          slug: string | null
        }
        Insert: {
          id?: string | null
          is_verified?: boolean | null
          locality_id?: string | null
          logo_media_id?: string | null
          name?: string | null
          org_type?: Database["public"]["Enums"]["account_type"] | null
          primary_locale?: string | null
          slug?: string | null
        }
        Update: {
          id?: string | null
          is_verified?: boolean | null
          locality_id?: string | null
          logo_media_id?: string | null
          name?: string | null
          org_type?: Database["public"]["Enums"]["account_type"] | null
          primary_locale?: string | null
          slug?: string | null
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
        }
        Relationships: []
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
            referencedRelation: "organization_public_directory"
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
            referencedRelation: "organization_public_directory"
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
            referencedRelation: "organization_public_directory"
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
            referencedRelation: "organization_public_directory"
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
            referencedRelation: "organization_public_directory"
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
    }
    Functions: {
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
      apply_account_upgrade: {
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
      cancel_follow_up: { Args: { p_follow_up_id: string }; Returns: undefined }
      complete_follow_up: {
        Args: { p_follow_up_id: string }
        Returns: undefined
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
      reassign_follow_up: {
        Args: { p_assignee_membership_id: string; p_follow_up_id: string }
        Returns: undefined
      }
      reopen_follow_up: { Args: { p_follow_up_id: string }; Returns: undefined }
      request_account_upgrade: {
        Args: {
          p_requested_account_type: Database["public"]["Enums"]["account_type"]
        }
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
      set_profile_hidden: { Args: { p_user_id: string }; Returns: undefined }
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
      update_customer: {
        Args: {
          p_archive?: boolean
          p_customer_id: string
          p_display_name?: string
          p_email?: string
          p_location_summary?: string
          p_preferred_language?: string
          p_primary_phone?: string
          p_source?: Database["public"]["Enums"]["sales_source"]
        }
        Returns: undefined
      }
      update_follow_up: {
        Args: {
          p_clear_due?: boolean
          p_description?: string
          p_due_at?: string
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
    }
    Enums: {
      account_type:
        | "end_consumer"
        | "installer_technician"
        | "engineer"
        | "interior_designer"
        | "showroom_dealer"
        | "supplier"
        | "manufacturer"
        | "importer"
        | "wholesaler"
        | "sales"
        | "contractor"
        | "trainer"
        | "trainee"
      contact_channel: "whatsapp" | "email"
      customer_status: "active" | "archived"
      customer_type: "individual" | "company"
      follow_up_status: "open" | "completed" | "cancelled"
      lead_stage:
        | "new"
        | "contacted"
        | "qualified"
        | "proposal_pending"
        | "decision_pending"
      lead_status: "active" | "won" | "lost" | "archived"
      membership_status: "invited" | "active" | "suspended" | "revoked"
      org_status:
        | "draft"
        | "pending_verification"
        | "active"
        | "suspended"
        | "archived"
      platform_role: "support" | "moderator" | "administrator"
      public_profile_status: "hidden" | "listed"
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
  public: {
    Enums: {
      account_type: [
        "end_consumer",
        "installer_technician",
        "engineer",
        "interior_designer",
        "showroom_dealer",
        "supplier",
        "manufacturer",
        "importer",
        "wholesaler",
        "sales",
        "contractor",
        "trainer",
        "trainee",
      ],
      contact_channel: ["whatsapp", "email"],
      customer_status: ["active", "archived"],
      customer_type: ["individual", "company"],
      follow_up_status: ["open", "completed", "cancelled"],
      lead_stage: [
        "new",
        "contacted",
        "qualified",
        "proposal_pending",
        "decision_pending",
      ],
      lead_status: ["active", "won", "lost", "archived"],
      membership_status: ["invited", "active", "suspended", "revoked"],
      org_status: [
        "draft",
        "pending_verification",
        "active",
        "suspended",
        "archived",
      ],
      platform_role: ["support", "moderator", "administrator"],
      public_profile_status: ["hidden", "listed"],
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

