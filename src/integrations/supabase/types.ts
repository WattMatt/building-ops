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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      asset_service_history: {
        Row: {
          asset_id: string
          contractor_id: string | null
          cost: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          next_service_date: string | null
          notes: string | null
          performed_by: string | null
          service_date: string
          service_type: string | null
        }
        Insert: {
          asset_id: string
          contractor_id?: string | null
          cost?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          next_service_date?: string | null
          notes?: string | null
          performed_by?: string | null
          service_date: string
          service_type?: string | null
        }
        Update: {
          asset_id?: string
          contractor_id?: string | null
          cost?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          next_service_date?: string | null
          notes?: string | null
          performed_by?: string | null
          service_date?: string
          service_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_service_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "building_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      building_assets: {
        Row: {
          building_id: string
          category: string | null
          condition_rating: number | null
          created_at: string | null
          expected_lifespan_years: number | null
          id: string
          installation_date: string | null
          last_service_date: string | null
          location: string | null
          manufacturer: string | null
          model: string | null
          name: string
          next_service_date: string | null
          notes: string | null
          photo_url: string | null
          purchase_date: string | null
          purchase_price: number | null
          replacement_cost: number | null
          serial_number: string | null
          status: string | null
          warranty_expiry: string | null
          warranty_provider: string | null
        }
        Insert: {
          building_id: string
          category?: string | null
          condition_rating?: number | null
          created_at?: string | null
          expected_lifespan_years?: number | null
          id?: string
          installation_date?: string | null
          last_service_date?: string | null
          location?: string | null
          manufacturer?: string | null
          model?: string | null
          name: string
          next_service_date?: string | null
          notes?: string | null
          photo_url?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          replacement_cost?: number | null
          serial_number?: string | null
          status?: string | null
          warranty_expiry?: string | null
          warranty_provider?: string | null
        }
        Update: {
          building_id?: string
          category?: string | null
          condition_rating?: number | null
          created_at?: string | null
          expected_lifespan_years?: number | null
          id?: string
          installation_date?: string | null
          last_service_date?: string | null
          location?: string | null
          manufacturer?: string | null
          model?: string | null
          name?: string
          next_service_date?: string | null
          notes?: string | null
          photo_url?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          replacement_cost?: number | null
          serial_number?: string | null
          status?: string | null
          warranty_expiry?: string | null
          warranty_provider?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "building_assets_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      building_documents: {
        Row: {
          building_id: string
          created_at: string | null
          document_type: string | null
          expiry_date: string | null
          file_url: string | null
          id: string
          issue_date: string | null
          issuing_authority: string | null
          name: string
          notes: string | null
          reference_number: string | null
          uploaded_by: string | null
        }
        Insert: {
          building_id: string
          created_at?: string | null
          document_type?: string | null
          expiry_date?: string | null
          file_url?: string | null
          id?: string
          issue_date?: string | null
          issuing_authority?: string | null
          name: string
          notes?: string | null
          reference_number?: string | null
          uploaded_by?: string | null
        }
        Update: {
          building_id?: string
          created_at?: string | null
          document_type?: string | null
          expiry_date?: string | null
          file_url?: string | null
          id?: string
          issue_date?: string | null
          issuing_authority?: string | null
          name?: string
          notes?: string | null
          reference_number?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "building_documents_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      building_notes: {
        Row: {
          building_id: string
          category: string | null
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          is_pinned: boolean | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          building_id: string
          category?: string | null
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_pinned?: boolean | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          building_id?: string
          category?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_pinned?: boolean | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "building_notes_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      building_tenants: {
        Row: {
          area: string | null
          building_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          escalation_percentage: number | null
          fit_out_notes: string | null
          id: string
          is_active: boolean | null
          lease_end: string | null
          lease_start: string | null
          lease_type: string | null
          make_good_clause: string | null
          monthly_rent: number | null
          name: string | null
          shop_name: string | null
          shop_number: string | null
          unit_number: string | null
        }
        Insert: {
          area?: string | null
          building_id: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          escalation_percentage?: number | null
          fit_out_notes?: string | null
          id?: string
          is_active?: boolean | null
          lease_end?: string | null
          lease_start?: string | null
          lease_type?: string | null
          make_good_clause?: string | null
          monthly_rent?: number | null
          name?: string | null
          shop_name?: string | null
          shop_number?: string | null
          unit_number?: string | null
        }
        Update: {
          area?: string | null
          building_id?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          escalation_percentage?: number | null
          fit_out_notes?: string | null
          id?: string
          is_active?: boolean | null
          lease_end?: string | null
          lease_start?: string | null
          lease_type?: string | null
          make_good_clause?: string | null
          monthly_rent?: number | null
          name?: string | null
          shop_name?: string | null
          shop_number?: string | null
          unit_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "building_tenants_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      buildings: {
        Row: {
          address: string | null
          avatar_color: string | null
          building_type: string | null
          city: string | null
          council_details: Json | null
          created_at: string | null
          electrical_authority: Json | null
          emergency_contacts: Json | null
          id: string
          latitude: number | null
          logo_position: string | null
          logo_url: string | null
          longitude: number | null
          meter_reading_company: Json | null
          name: string
          organization_id: string | null
          professional_team: Json | null
          timezone: string | null
          updated_at: string | null
          utility_tariffs: Json | null
        }
        Insert: {
          address?: string | null
          avatar_color?: string | null
          building_type?: string | null
          city?: string | null
          council_details?: Json | null
          created_at?: string | null
          electrical_authority?: Json | null
          emergency_contacts?: Json | null
          id?: string
          latitude?: number | null
          logo_position?: string | null
          logo_url?: string | null
          longitude?: number | null
          meter_reading_company?: Json | null
          name: string
          organization_id?: string | null
          professional_team?: Json | null
          timezone?: string | null
          updated_at?: string | null
          utility_tariffs?: Json | null
        }
        Update: {
          address?: string | null
          avatar_color?: string | null
          building_type?: string | null
          city?: string | null
          council_details?: Json | null
          created_at?: string | null
          electrical_authority?: Json | null
          emergency_contacts?: Json | null
          id?: string
          latitude?: number | null
          logo_position?: string | null
          logo_url?: string | null
          longitude?: number | null
          meter_reading_company?: Json | null
          name?: string
          organization_id?: string | null
          professional_team?: Json | null
          timezone?: string | null
          updated_at?: string | null
          utility_tariffs?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "buildings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          applies_to_building_types: string[] | null
          created_at: string | null
          description: string | null
          frequency: string
          id: string
          is_active: boolean | null
          name: string
          organization_id: string | null
          responsible_role: string | null
        }
        Insert: {
          applies_to_building_types?: string[] | null
          created_at?: string | null
          description?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          name: string
          organization_id?: string | null
          responsible_role?: string | null
        }
        Update: {
          applies_to_building_types?: string[] | null
          created_at?: string | null
          description?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string | null
          responsible_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_documents: {
        Row: {
          contractor_id: string
          document_name: string
          document_type: string
          expiry_date: string | null
          file_url: string | null
          id: string
          is_verified: boolean | null
          uploaded_at: string | null
        }
        Insert: {
          contractor_id: string
          document_name: string
          document_type: string
          expiry_date?: string | null
          file_url?: string | null
          id?: string
          is_verified?: boolean | null
          uploaded_at?: string | null
        }
        Update: {
          contractor_id?: string
          document_name?: string
          document_type?: string
          expiry_date?: string | null
          file_url?: string | null
          id?: string
          is_verified?: boolean | null
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_documents_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      contractors: {
        Row: {
          company_name: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          organization_id: string | null
          rating: number | null
          trade: string | null
          updated_at: string | null
        }
        Insert: {
          company_name: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          organization_id?: string | null
          rating?: number | null
          trade?: string | null
          updated_at?: string | null
        }
        Update: {
          company_name?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          organization_id?: string | null
          rating?: number | null
          trade?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          building_id: string | null
          created_at: string | null
          form_data: Json | null
          form_name: string
          form_template_id: string | null
          form_type: string | null
          id: string
          photo_urls: Json | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          signoff_status: string
          status: string | null
          submitted_by: string | null
          updated_at: string | null
        }
        Insert: {
          building_id?: string | null
          created_at?: string | null
          form_data?: Json | null
          form_name: string
          form_template_id?: string | null
          form_type?: string | null
          id?: string
          photo_urls?: Json | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          signoff_status?: string
          status?: string | null
          submitted_by?: string | null
          updated_at?: string | null
        }
        Update: {
          building_id?: string | null
          created_at?: string | null
          form_data?: Json | null
          form_name?: string
          form_template_id?: string | null
          form_type?: string | null
          id?: string
          photo_urls?: Json | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          signoff_status?: string
          status?: string | null
          submitted_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      form_signoff_requests: {
        Row: {
          active: boolean
          assigned_by: string | null
          assigned_to: string
          created_at: string
          decline_reason: string | null
          due_at: string | null
          id: string
          instructions: string | null
          mode: string
          reminded_at: string | null
          sequence_order: number
          status: string
          submission_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          assigned_by?: string | null
          assigned_to: string
          created_at?: string
          decline_reason?: string | null
          due_at?: string | null
          id?: string
          instructions?: string | null
          mode?: string
          reminded_at?: string | null
          sequence_order?: number
          status?: string
          submission_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          assigned_by?: string | null
          assigned_to?: string
          created_at?: string
          decline_reason?: string | null
          due_at?: string | null
          id?: string
          instructions?: string | null
          mode?: string
          reminded_at?: string | null
          sequence_order?: number
          status?: string
          submission_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_signoff_requests_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_signatures: {
        Row: {
          confirmation_text: string
          id: string
          ip_address: string | null
          method: string
          notes: string | null
          request_id: string
          signed_at: string
          signature_url: string | null
          signer_id: string
          submission_id: string
          typed_name: string | null
          user_agent: string | null
        }
        Insert: {
          confirmation_text: string
          id?: string
          ip_address?: string | null
          method: string
          notes?: string | null
          request_id: string
          signed_at?: string
          signature_url?: string | null
          signer_id: string
          submission_id: string
          typed_name?: string | null
          user_agent?: string | null
        }
        Update: {
          confirmation_text?: string
          id?: string
          ip_address?: string | null
          method?: string
          notes?: string | null
          request_id?: string
          signed_at?: string
          signature_url?: string | null
          signer_id?: string
          submission_id?: string
          typed_name?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_signatures_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "form_signoff_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_signatures_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_activity: {
        Row: {
          activity_type: string
          author_name: string | null
          comment: string | null
          created_at: string
          id: string
          issue_id: string
          new_value: string | null
          old_value: string | null
          photo_urls: Json | null
          user_id: string | null
        }
        Insert: {
          activity_type: string
          author_name?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          issue_id: string
          new_value?: string | null
          old_value?: string | null
          photo_urls?: Json | null
          user_id?: string | null
        }
        Update: {
          activity_type?: string
          author_name?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          issue_id?: string
          new_value?: string | null
          old_value?: string | null
          photo_urls?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issue_activity_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issues: {
        Row: {
          actual_cost: number | null
          assigned_to: string | null
          building_id: string
          category: string | null
          contractor_id: string | null
          corrective_action: string | null
          created_at: string | null
          deadline: string | null
          description: string
          estimated_cost: number | null
          first_response_at: string | null
          id: string
          photo_urls: Json | null
          priority: string
          reported_by: string
          resolved_at: string | null
          responsibility: string | null
          sla_breached_at: string | null
          sla_target_hours: number | null
          status: string
          task_instance_id: string | null
          title: string
        }
        Insert: {
          actual_cost?: number | null
          assigned_to?: string | null
          building_id: string
          category?: string | null
          contractor_id?: string | null
          corrective_action?: string | null
          created_at?: string | null
          deadline?: string | null
          description: string
          estimated_cost?: number | null
          first_response_at?: string | null
          id?: string
          photo_urls?: Json | null
          priority?: string
          reported_by: string
          resolved_at?: string | null
          responsibility?: string | null
          sla_breached_at?: string | null
          sla_target_hours?: number | null
          status?: string
          task_instance_id?: string | null
          title: string
        }
        Update: {
          actual_cost?: number | null
          assigned_to?: string | null
          building_id?: string
          category?: string | null
          contractor_id?: string | null
          corrective_action?: string | null
          created_at?: string | null
          deadline?: string | null
          description?: string
          estimated_cost?: number | null
          first_response_at?: string | null
          id?: string
          photo_urls?: Json | null
          priority?: string
          reported_by?: string
          resolved_at?: string | null
          responsibility?: string | null
          sla_breached_at?: string | null
          sla_target_hours?: number | null
          status?: string
          task_instance_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "issues_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_task_instance_id_fkey"
            columns: ["task_instance_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      media_attachments: {
        Row: {
          caption: string | null
          captured_at: string | null
          captured_by: string | null
          created_at: string | null
          deleted_at: string | null
          file_size_bytes: number | null
          file_type: string | null
          id: string
          is_after_image: boolean | null
          is_before_image: boolean | null
          latitude: number | null
          longitude: number | null
          original_filename: string | null
          public_url: string | null
          record_id: string
          record_type: string
          storage_path: string
        }
        Insert: {
          caption?: string | null
          captured_at?: string | null
          captured_by?: string | null
          created_at?: string | null
          deleted_at?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          is_after_image?: boolean | null
          is_before_image?: boolean | null
          latitude?: number | null
          longitude?: number | null
          original_filename?: string | null
          public_url?: string | null
          record_id: string
          record_type: string
          storage_path: string
        }
        Update: {
          caption?: string | null
          captured_at?: string | null
          captured_by?: string | null
          created_at?: string | null
          deleted_at?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          is_after_image?: boolean | null
          is_before_image?: boolean | null
          latitude?: number | null
          longitude?: number | null
          original_filename?: string | null
          public_url?: string | null
          record_id?: string
          record_type?: string
          storage_path?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          logo_url: string | null
          name: string | null
          primary_color: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          name?: string | null
          primary_color?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          name?: string | null
          primary_color?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          daily_digest: boolean | null
          deactivated: boolean
          email: string | null
          email_notifications: boolean | null
          full_name: string | null
          id: string
          issue_updates: boolean | null
          must_set_password: boolean
          overdue_alerts: boolean | null
          phone: string | null
          task_reminders: boolean | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          daily_digest?: boolean | null
          deactivated?: boolean
          email?: string | null
          email_notifications?: boolean | null
          full_name?: string | null
          id: string
          issue_updates?: boolean | null
          must_set_password?: boolean
          overdue_alerts?: boolean | null
          phone?: string | null
          task_reminders?: boolean | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          daily_digest?: boolean | null
          deactivated?: boolean
          email?: string | null
          email_notifications?: boolean | null
          full_name?: string | null
          id?: string
          issue_updates?: boolean | null
          must_set_password?: boolean
          overdue_alerts?: boolean | null
          phone?: string | null
          task_reminders?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      task_completions: {
        Row: {
          completed_by: string
          created_at: string | null
          id: string
          notes: string | null
          photo_urls: Json | null
          signature_confirmed: boolean | null
          task_instance_id: string
        }
        Insert: {
          completed_by: string
          created_at?: string | null
          id?: string
          notes?: string | null
          photo_urls?: Json | null
          signature_confirmed?: boolean | null
          task_instance_id: string
        }
        Update: {
          completed_by?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          photo_urls?: Json | null
          signature_confirmed?: boolean | null
          task_instance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_completions_task_instance_id_fkey"
            columns: ["task_instance_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      task_instances: {
        Row: {
          building_id: string
          category: string | null
          completed_at: string | null
          completed_by: string | null
          completion_notes: string | null
          created_at: string | null
          due_date: string
          frequency: string
          id: string
          photo_urls: Json | null
          requires_photo: boolean | null
          requires_signature: boolean | null
          responsible_role: string | null
          signature_url: string | null
          status: string
          task_description: string | null
          task_name: string
          template_item_id: string | null
        }
        Insert: {
          building_id: string
          category?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string | null
          due_date: string
          frequency?: string
          id?: string
          photo_urls?: Json | null
          requires_photo?: boolean | null
          requires_signature?: boolean | null
          responsible_role?: string | null
          signature_url?: string | null
          status?: string
          task_description?: string | null
          task_name: string
          template_item_id?: string | null
        }
        Update: {
          building_id?: string
          category?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string | null
          due_date?: string
          frequency?: string
          id?: string
          photo_urls?: Json | null
          requires_photo?: boolean | null
          requires_signature?: boolean | null
          responsible_role?: string | null
          signature_url?: string | null
          status?: string
          task_description?: string | null
          task_name?: string
          template_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_instances_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      template_items: {
        Row: {
          category: string | null
          display_order: number | null
          id: string
          requires_photo: boolean | null
          requires_signature: boolean | null
          responsible_party: string | null
          task_description: string | null
          task_name: string
          template_id: string
        }
        Insert: {
          category?: string | null
          display_order?: number | null
          id?: string
          requires_photo?: boolean | null
          requires_signature?: boolean | null
          responsible_party?: string | null
          task_description?: string | null
          task_name: string
          template_id: string
        }
        Update: {
          category?: string | null
          display_order?: number | null
          id?: string
          requires_photo?: boolean | null
          requires_signature?: boolean | null
          responsible_party?: string | null
          task_description?: string | null
          task_name?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_documents: {
        Row: {
          created_at: string | null
          document_name: string
          document_type: string
          expiry_date: string | null
          file_name: string | null
          file_size: number | null
          file_url: string | null
          id: string
          issue_date: string | null
          notes: string | null
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          document_name: string
          document_type: string
          expiry_date?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          issue_date?: string | null
          notes?: string | null
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          document_name?: string
          document_type?: string
          expiry_date?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          issue_date?: string | null
          notes?: string | null
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "building_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_buildings: {
        Row: {
          building_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          building_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          building_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_buildings_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          building_id: string | null
          role: string
          user_id: string
        }
        Insert: {
          building_id?: string | null
          role?: string
          user_id: string
        }
        Update: {
          building_id?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_role: { Args: never; Returns: string }
      can_access_building: { Args: { b: string }; Returns: boolean }
      delete_own_account: { Args: never; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      is_admin_or_manager: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
