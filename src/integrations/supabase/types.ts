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
          {
            foreignKeyName: "asset_service_history_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
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
      building_inspections: {
        Row: {
          building_id: string
          created_at: string
          id: string
          inspected_by: string | null
          inspection_date: string | null
          report_id: string | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          building_id: string
          created_at?: string
          id?: string
          inspected_by?: string | null
          inspection_date?: string | null
          report_id?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          created_at?: string
          id?: string
          inspected_by?: string | null
          inspection_date?: string | null
          report_id?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_inspections_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_inspections_inspected_by_fkey"
            columns: ["inspected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_inspections_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_inspections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inspection_templates"
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
      building_ppm_services: {
        Row: {
          building_id: string
          contractor_id: string | null
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          recurrence: Json
          service_name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          building_id: string
          contractor_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          recurrence: Json
          service_name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          building_id?: string
          contractor_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          recurrence?: Json
          service_name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_ppm_services_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_ppm_services_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      building_role_assignments: {
        Row: {
          building_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          building_id: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          building_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_role_assignments_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_role_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      building_turnover: {
        Row: {
          annual_trading_density: number | null
          building_id: string
          cm_comment: string | null
          created_at: string
          current_month_total: number | null
          id: string
          previous_year_month_total: number | null
          report_id: string
          spend_per_head: number | null
          updated_at: string
        }
        Insert: {
          annual_trading_density?: number | null
          building_id: string
          cm_comment?: string | null
          created_at?: string
          current_month_total?: number | null
          id?: string
          previous_year_month_total?: number | null
          report_id: string
          spend_per_head?: number | null
          updated_at?: string
        }
        Update: {
          annual_trading_density?: number | null
          building_id?: string
          cm_comment?: string | null
          created_at?: string
          current_month_total?: number | null
          id?: string
          previous_year_month_total?: number | null
          report_id?: string
          spend_per_head?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_turnover_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_turnover_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: true
            referencedRelation: "reports"
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
          il_site_id: string | null
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
          il_site_id?: string | null
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
          il_site_id?: string | null
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
      calendar_tokens: {
        Row: {
          building_id: string | null
          created_at: string
          id: string
          label: string | null
          last_used_at: string | null
          revoked_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          building_id?: string | null
          created_at?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          building_id?: string | null
          created_at?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_tokens_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      capex_items: {
        Row: {
          building_id: string
          created_at: string
          estimate: number | null
          id: string
          item: string | null
          motivation: string | null
          priority: string | null
          report_id: string | null
          status: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          building_id: string
          created_at?: string
          estimate?: number | null
          id?: string
          item?: string | null
          motivation?: string | null
          priority?: string | null
          report_id?: string | null
          status?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          building_id?: string
          created_at?: string
          estimate?: number | null
          id?: string
          item?: string | null
          motivation?: string | null
          priority?: string | null
          report_id?: string | null
          status?: string | null
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "capex_items_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capex_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      category_turnover: {
        Row: {
          building_id: string
          category: string
          comment: string | null
          created_at: string
          id: string
          monthly_turnover: number | null
          rank: number | null
          report_id: string
          trading_density: number | null
          updated_at: string
        }
        Insert: {
          building_id: string
          category: string
          comment?: string | null
          created_at?: string
          id?: string
          monthly_turnover?: number | null
          rank?: number | null
          report_id: string
          trading_density?: number | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          category?: string
          comment?: string | null
          created_at?: string
          id?: string
          monthly_turnover?: number | null
          rank?: number | null
          report_id?: string
          trading_density?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_turnover_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_turnover_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          applies_to_building_types: string[] | null
          archived_at: string | null
          created_at: string | null
          description: string | null
          frequency: string
          id: string
          is_active: boolean | null
          name: string
          organization_id: string | null
          recurrence: Json | null
          responsible_role: string | null
          updated_at: string
          version: number
        }
        Insert: {
          applies_to_building_types?: string[] | null
          archived_at?: string | null
          created_at?: string | null
          description?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          name: string
          organization_id?: string | null
          recurrence?: Json | null
          responsible_role?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          applies_to_building_types?: string[] | null
          archived_at?: string | null
          created_at?: string | null
          description?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string | null
          recurrence?: Json | null
          responsible_role?: string | null
          updated_at?: string
          version?: number
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
      compliance_assessments: {
        Row: {
          assessed_at: string
          assessed_by: string | null
          building_id: string
          created_at: string
          id: string
          report_id: string
          template_id: string
          updated_at: string
        }
        Insert: {
          assessed_at?: string
          assessed_by?: string | null
          building_id: string
          created_at?: string
          id?: string
          report_id: string
          template_id: string
          updated_at?: string
        }
        Update: {
          assessed_at?: string
          assessed_by?: string | null
          building_id?: string
          created_at?: string
          id?: string
          report_id?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_assessments_assessed_by_fkey"
            columns: ["assessed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_assessments_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_assessments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: true
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_assessments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "compliance_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_responses: {
        Row: {
          assessment_id: string
          comment: string | null
          created_at: string
          id: string
          issue_id: string | null
          response: string | null
          score: number | null
          template_item_id: string
          updated_at: string
          value_text: string | null
        }
        Insert: {
          assessment_id: string
          comment?: string | null
          created_at?: string
          id?: string
          issue_id?: string | null
          response?: string | null
          score?: number | null
          template_item_id: string
          updated_at?: string
          value_text?: string | null
        }
        Update: {
          assessment_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          issue_id?: string | null
          response?: string | null
          score?: number | null
          template_item_id?: string
          updated_at?: string
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_responses_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "compliance_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_responses_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "compliance_critical_scores"
            referencedColumns: ["assessment_id"]
          },
          {
            foreignKeyName: "compliance_responses_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "compliance_scores"
            referencedColumns: ["assessment_id"]
          },
          {
            foreignKeyName: "compliance_responses_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "compliance_section_scores"
            referencedColumns: ["assessment_id"]
          },
          {
            foreignKeyName: "compliance_responses_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_responses_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "compliance_template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_template_items: {
        Row: {
          created_at: string
          group_code: string
          group_weight: number
          id: string
          is_critical: boolean
          is_scored: boolean
          item_no: string | null
          prompt: string
          response_type: string
          section_no: string
          section_title: string | null
          sort_order: number
          template_id: string
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          group_code?: string
          group_weight?: number
          id?: string
          is_critical?: boolean
          is_scored?: boolean
          item_no?: string | null
          prompt: string
          response_type?: string
          section_no: string
          section_title?: string | null
          sort_order?: number
          template_id: string
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          group_code?: string
          group_weight?: number
          id?: string
          is_critical?: boolean
          is_scored?: boolean
          item_no?: string | null
          prompt?: string
          response_type?: string
          section_no?: string
          section_title?: string | null
          sort_order?: number
          template_id?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "compliance_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "compliance_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_templates: {
        Row: {
          active: boolean
          applies_to_building_types: string[] | null
          created_at: string
          id: string
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          applies_to_building_types?: string[] | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          applies_to_building_types?: string[] | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
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
          notes: string | null
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
          notes?: string | null
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
          notes?: string | null
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
      contractor_ratings: {
        Row: {
          comment: string | null
          contractor_id: string
          created_at: string
          id: string
          issue_id: string | null
          rated_by: string | null
          rating: number
        }
        Insert: {
          comment?: string | null
          contractor_id: string
          created_at?: string
          id?: string
          issue_id?: string | null
          rated_by?: string | null
          rating: number
        }
        Update: {
          comment?: string | null
          contractor_id?: string
          created_at?: string
          id?: string
          issue_id?: string | null
          rated_by?: string | null
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "contractor_ratings_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_ratings_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: true
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_ratings_rated_by_fkey"
            columns: ["rated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contractors: {
        Row: {
          address: string | null
          company_name: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          default_trade_role: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          organization_id: string | null
          rating: number | null
          trade: string | null
          updated_at: string | null
          vat_number: string | null
        }
        Insert: {
          address?: string | null
          company_name: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          default_trade_role?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          organization_id?: string | null
          rating?: number | null
          trade?: string | null
          updated_at?: string | null
          vat_number?: string | null
        }
        Update: {
          address?: string | null
          company_name?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          default_trade_role?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          organization_id?: string | null
          rating?: number | null
          trade?: string | null
          updated_at?: string | null
          vat_number?: string | null
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
      expense_recoveries: {
        Row: {
          budget_pct_recovery: number | null
          building_id: string
          comment: string | null
          created_at: string
          date_fault_repaired: string | null
          date_fault_reported: string | null
          fault_found: string | null
          id: string
          pct_recovery: number | null
          records_uploaded: boolean | null
          report_id: string | null
          service: string | null
          updated_at: string
          ytd_expense: number | null
          ytd_recovery: number | null
        }
        Insert: {
          budget_pct_recovery?: number | null
          building_id: string
          comment?: string | null
          created_at?: string
          date_fault_repaired?: string | null
          date_fault_reported?: string | null
          fault_found?: string | null
          id?: string
          pct_recovery?: number | null
          records_uploaded?: boolean | null
          report_id?: string | null
          service?: string | null
          updated_at?: string
          ytd_expense?: number | null
          ytd_recovery?: number | null
        }
        Update: {
          budget_pct_recovery?: number | null
          building_id?: string
          comment?: string | null
          created_at?: string
          date_fault_repaired?: string | null
          date_fault_reported?: string | null
          fault_found?: string | null
          id?: string
          pct_recovery?: number | null
          records_uploaded?: boolean | null
          report_id?: string | null
          service?: string | null
          updated_at?: string
          ytd_expense?: number | null
          ytd_recovery?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_recoveries_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_recoveries_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      footfall_counts: {
        Row: {
          building_id: string
          created_at: string
          entrance: string | null
          id: string
          month_count: number | null
          prev_ytd: number | null
          recon_variance: number | null
          report_id: string | null
          source: string | null
          system_count: number | null
          ticksheet_count: number | null
          updated_at: string
          variance_pct: number | null
          ytd_count: number | null
        }
        Insert: {
          building_id: string
          created_at?: string
          entrance?: string | null
          id?: string
          month_count?: number | null
          prev_ytd?: number | null
          recon_variance?: number | null
          report_id?: string | null
          source?: string | null
          system_count?: number | null
          ticksheet_count?: number | null
          updated_at?: string
          variance_pct?: number | null
          ytd_count?: number | null
        }
        Update: {
          building_id?: string
          created_at?: string
          entrance?: string | null
          id?: string
          month_count?: number | null
          prev_ytd?: number | null
          recon_variance?: number | null
          report_id?: string | null
          source?: string | null
          system_count?: number | null
          ticksheet_count?: number | null
          updated_at?: string
          variance_pct?: number | null
          ytd_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "footfall_counts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "footfall_counts_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
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
          signature_url: string | null
          signed_at: string
          signer_id: string | null
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
          signature_url?: string | null
          signed_at?: string
          signer_id?: string | null
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
          signature_url?: string | null
          signed_at?: string
          signer_id?: string | null
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
            foreignKeyName: "form_signatures_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "form_signoff_requests_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_signoff_requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_signoff_requests_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
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
      hazard_log: {
        Row: {
          assessment_id: string
          building_id: string
          corrective_action: string | null
          created_at: string
          hazard: string | null
          id: string
          sort_order: number
          status: string | null
          updated_at: string
        }
        Insert: {
          assessment_id: string
          building_id: string
          corrective_action?: string | null
          created_at?: string
          hazard?: string | null
          id?: string
          sort_order?: number
          status?: string | null
          updated_at?: string
        }
        Update: {
          assessment_id?: string
          building_id?: string
          corrective_action?: string | null
          created_at?: string
          hazard?: string | null
          id?: string
          sort_order?: number
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hazard_log_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "compliance_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_log_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "compliance_critical_scores"
            referencedColumns: ["assessment_id"]
          },
          {
            foreignKeyName: "hazard_log_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "compliance_scores"
            referencedColumns: ["assessment_id"]
          },
          {
            foreignKeyName: "hazard_log_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "compliance_section_scores"
            referencedColumns: ["assessment_id"]
          },
          {
            foreignKeyName: "hazard_log_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_responses: {
        Row: {
          acceptable: string | null
          action_required: string | null
          applicable: boolean
          capex_estimate: number | null
          comment: string | null
          condition_rating: string | null
          created_at: string
          detail: Json
          id: string
          inspection_id: string
          next_service_due: string | null
          photo_urls: Json
          recommendation: string | null
          risk_level: string | null
          template_item_id: string
          updated_at: string
        }
        Insert: {
          acceptable?: string | null
          action_required?: string | null
          applicable?: boolean
          capex_estimate?: number | null
          comment?: string | null
          condition_rating?: string | null
          created_at?: string
          detail?: Json
          id?: string
          inspection_id: string
          next_service_due?: string | null
          photo_urls?: Json
          recommendation?: string | null
          risk_level?: string | null
          template_item_id: string
          updated_at?: string
        }
        Update: {
          acceptable?: string | null
          action_required?: string | null
          applicable?: boolean
          capex_estimate?: number | null
          comment?: string | null
          condition_rating?: string | null
          created_at?: string
          detail?: Json
          id?: string
          inspection_id?: string
          next_service_due?: string | null
          photo_urls?: Json
          recommendation?: string | null
          risk_level?: string | null
          template_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_responses_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "building_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_responses_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "inspection_template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_subitems: {
        Row: {
          building_id: string
          created_at: string
          detail: Json
          id: string
          inspection_response_id: string
          item_type: string | null
          label: string | null
          quantity: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          building_id: string
          created_at?: string
          detail?: Json
          id?: string
          inspection_response_id: string
          item_type?: string | null
          label?: string | null
          quantity?: number | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          building_id?: string
          created_at?: string
          detail?: Json
          id?: string
          inspection_response_id?: string
          item_type?: string | null
          label?: string | null
          quantity?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_subitems_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_subitems_inspection_response_id_fkey"
            columns: ["inspection_response_id"]
            isOneToOne: false
            referencedRelation: "inspection_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_template_items: {
        Row: {
          allow_na: boolean
          allows_photo: boolean
          created_at: string
          field_keys: Json
          field_set: string
          id: string
          item_label: string | null
          rating_type: string
          section_no: string | null
          section_title: string | null
          sort_order: number
          template_id: string
          updated_at: string
        }
        Insert: {
          allow_na?: boolean
          allows_photo?: boolean
          created_at?: string
          field_keys?: Json
          field_set?: string
          id?: string
          item_label?: string | null
          rating_type?: string
          section_no?: string | null
          section_title?: string | null
          sort_order?: number
          template_id: string
          updated_at?: string
        }
        Update: {
          allow_na?: boolean
          allows_photo?: boolean
          created_at?: string
          field_keys?: Json
          field_set?: string
          id?: string
          item_label?: string | null
          rating_type?: string
          section_no?: string | null
          section_title?: string | null
          sort_order?: number
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inspection_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_templates: {
        Row: {
          active: boolean
          cadence: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          cadence?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          cadence?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      issue_activity: {
        Row: {
          activity_type: string
          author_name: string | null
          comment: string | null
          created_at: string
          id: string
          issue_id: string
          mentions: string[]
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
          mentions?: string[]
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
          mentions?: string[]
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
            foreignKeyName: "issues_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
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
      leasing_waitlist: {
        Row: {
          building_id: string
          category: string | null
          comment: string | null
          contact: string | null
          created_at: string
          id: string
          optimal_size: string | null
          report_id: string | null
          trading_as: string | null
          updated_at: string
        }
        Insert: {
          building_id: string
          category?: string | null
          comment?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          optimal_size?: string | null
          report_id?: string | null
          trading_as?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          category?: string | null
          comment?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          optimal_size?: string | null
          report_id?: string | null
          trading_as?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leasing_waitlist_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leasing_waitlist_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      loadshedding_log: {
        Row: {
          building_id: string
          created_at: string
          day: string | null
          diesel_date: string | null
          diesel_litres: number | null
          hours: number | null
          id: string
          report_id: string | null
          stage: string | null
          updated_at: string
          week_no: number | null
        }
        Insert: {
          building_id: string
          created_at?: string
          day?: string | null
          diesel_date?: string | null
          diesel_litres?: number | null
          hours?: number | null
          id?: string
          report_id?: string | null
          stage?: string | null
          updated_at?: string
          week_no?: number | null
        }
        Update: {
          building_id?: string
          created_at?: string
          day?: string | null
          diesel_date?: string | null
          diesel_litres?: number | null
          hours?: number | null
          id?: string
          report_id?: string | null
          stage?: string | null
          updated_at?: string
          week_no?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loadshedding_log_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loadshedding_log_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      local_resources_contacts: {
        Row: {
          building_id: string
          contact_number: string | null
          contact_person: string | null
          created_at: string
          frequency: string | null
          id: string
          last_meeting_date: string | null
          name: string | null
          report_id: string
          resource_type: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          building_id: string
          contact_number?: string | null
          contact_person?: string | null
          created_at?: string
          frequency?: string | null
          id?: string
          last_meeting_date?: string | null
          name?: string | null
          report_id: string
          resource_type?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          building_id?: string
          contact_number?: string | null
          contact_person?: string | null
          created_at?: string
          frequency?: string | null
          id?: string
          last_meeting_date?: string | null
          name?: string | null
          report_id?: string
          resource_type?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "local_resources_contacts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "local_resources_contacts_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      masterfile_items: {
        Row: {
          building_id: string
          comment: string | null
          created_at: string
          document_id: string | null
          document_label: string | null
          id: string
          on_file: string | null
          report_id: string | null
          responsible: string | null
          updated_at: string
        }
        Insert: {
          building_id: string
          comment?: string | null
          created_at?: string
          document_id?: string | null
          document_label?: string | null
          id?: string
          on_file?: string | null
          report_id?: string | null
          responsible?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          comment?: string | null
          created_at?: string
          document_id?: string | null
          document_label?: string | null
          id?: string
          on_file?: string | null
          report_id?: string | null
          responsible?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "masterfile_items_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "masterfile_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "building_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "masterfile_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
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
      notifications: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          body: string | null
          building_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          kind: string
          read_at: string | null
          recipient_id: string
          title: string
          url: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          body?: string | null
          building_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          kind: string
          read_at?: string | null
          recipient_id: string
          title: string
          url: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          body?: string | null
          building_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          kind?: string
          read_at?: string | null
          recipient_id?: string
          title?: string
          url?: string
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
            foreignKeyName: "notifications_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      ppm_services: {
        Row: {
          building_id: string
          comment: string | null
          created_at: string
          frequency: string | null
          id: string
          months: Json
          overrides: Json
          plan_service_id: string | null
          report_id: string | null
          service_name: string
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          building_id: string
          comment?: string | null
          created_at?: string
          frequency?: string | null
          id?: string
          months?: Json
          overrides?: Json
          plan_service_id?: string | null
          report_id?: string | null
          service_name: string
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          comment?: string | null
          created_at?: string
          frequency?: string | null
          id?: string
          months?: Json
          overrides?: Json
          plan_service_id?: string | null
          report_id?: string | null
          service_name?: string
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ppm_services_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ppm_services_plan_service_id_fkey"
            columns: ["plan_service_id"]
            isOneToOne: false
            referencedRelation: "building_ppm_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ppm_services_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
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
          geotag_photos: boolean
          id: string
          issue_updates: boolean | null
          must_set_password: boolean
          onboarding_completed: boolean
          overdue_alerts: boolean | null
          phone: string | null
          show_hints: boolean
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
          geotag_photos?: boolean
          id: string
          issue_updates?: boolean | null
          must_set_password?: boolean
          onboarding_completed?: boolean
          overdue_alerts?: boolean | null
          phone?: string | null
          show_hints?: boolean
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
          geotag_photos?: boolean
          id?: string
          issue_updates?: boolean | null
          must_set_password?: boolean
          onboarding_completed?: boolean
          overdue_alerts?: boolean | null
          phone?: string | null
          show_hints?: boolean
          task_reminders?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failed_at: string | null
          id: string
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failed_at?: string | null
          id?: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failed_at?: string | null
          id?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_artifacts: {
        Row: {
          building_id: string | null
          created_at: string
          file_name: string
          file_path: string
          generated_by: string
          id: string
          kind: string
          org_id: string
          report_status: string | null
          size_bytes: number
          source_id: string | null
          status: string
          superseded_by: string | null
          version: number
        }
        Insert: {
          building_id?: string | null
          created_at?: string
          file_name: string
          file_path: string
          generated_by?: string
          id?: string
          kind: string
          org_id: string
          report_status?: string | null
          size_bytes: number
          source_id?: string | null
          status?: string
          superseded_by?: string | null
          version?: number
        }
        Update: {
          building_id?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          generated_by?: string
          id?: string
          kind?: string
          org_id?: string
          report_status?: string | null
          size_bytes?: number
          source_id?: string | null
          status?: string
          superseded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_artifacts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_artifacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_artifacts_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "report_artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      report_checklist_items: {
        Row: {
          building_id: string
          comment: string | null
          created_at: string
          id: string
          item_key: string
          report_id: string
          response: string | null
          section_key: string
          sort_order: number
          updated_at: string
          value_date: string | null
          value_text: string | null
        }
        Insert: {
          building_id: string
          comment?: string | null
          created_at?: string
          id?: string
          item_key: string
          report_id: string
          response?: string | null
          section_key: string
          sort_order?: number
          updated_at?: string
          value_date?: string | null
          value_text?: string | null
        }
        Update: {
          building_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          item_key?: string
          report_id?: string
          response?: string | null
          section_key?: string
          sort_order?: number
          updated_at?: string
          value_date?: string | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_checklist_items_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_checklist_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_narratives: {
        Row: {
          body: string | null
          building_id: string
          created_at: string
          heading: string | null
          id: string
          issue_id: string | null
          report_id: string
          section_key: string
          sort_order: number
          status_flag: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          building_id: string
          created_at?: string
          heading?: string | null
          id?: string
          issue_id?: string | null
          report_id: string
          section_key: string
          sort_order?: number
          status_flag?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          building_id?: string
          created_at?: string
          heading?: string | null
          id?: string
          issue_id?: string | null
          report_id?: string
          section_key?: string
          sort_order?: number
          status_flag?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_narratives_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_narratives_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_narratives_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          asset_manager: string | null
          author_id: string | null
          author_name: string | null
          building_id: string
          centre_manager: string | null
          cloned_from_report_id: string | null
          created_at: string
          id: string
          inspection_date: string | null
          meta: Json
          ops_manager: string | null
          organization_id: string | null
          prepared_for: string | null
          report_period: string
          report_type: string
          review_notes: string | null
          reviewed_by: string | null
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          asset_manager?: string | null
          author_id?: string | null
          author_name?: string | null
          building_id: string
          centre_manager?: string | null
          cloned_from_report_id?: string | null
          created_at?: string
          id?: string
          inspection_date?: string | null
          meta?: Json
          ops_manager?: string | null
          organization_id?: string | null
          prepared_for?: string | null
          report_period: string
          report_type: string
          review_notes?: string | null
          reviewed_by?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          asset_manager?: string | null
          author_id?: string | null
          author_name?: string | null
          building_id?: string
          centre_manager?: string | null
          cloned_from_report_id?: string | null
          created_at?: string
          id?: string
          inspection_date?: string | null
          meta?: Json
          ops_manager?: string | null
          organization_id?: string | null
          prepared_for?: string | null
          report_period?: string
          report_type?: string
          review_notes?: string | null
          reviewed_by?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_cloned_from_report_id_fkey"
            columns: ["cloned_from_report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      security_incidents: {
        Row: {
          building_id: string
          count: number | null
          created_at: string
          id: string
          incident_type: string | null
          narrative: string | null
          period: string | null
          report_id: string | null
          updated_at: string
        }
        Insert: {
          building_id: string
          count?: number | null
          created_at?: string
          id?: string
          incident_type?: string | null
          narrative?: string | null
          period?: string | null
          report_id?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          count?: number | null
          created_at?: string
          id?: string
          incident_type?: string | null
          narrative?: string | null
          period?: string | null
          report_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_incidents_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_incidents_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      service_interruptions: {
        Row: {
          building_id: string
          comment: string | null
          council_ref: string | null
          created_at: string
          date: string | null
          end_time: string | null
          id: string
          interruption_type: string | null
          report_id: string | null
          start_time: string | null
          total_hours: number | null
          updated_at: string
        }
        Insert: {
          building_id: string
          comment?: string | null
          council_ref?: string | null
          created_at?: string
          date?: string | null
          end_time?: string | null
          id?: string
          interruption_type?: string | null
          report_id?: string | null
          start_time?: string | null
          total_hours?: number | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          comment?: string | null
          council_ref?: string | null
          created_at?: string
          date?: string | null
          end_time?: string | null
          id?: string
          interruption_type?: string | null
          report_id?: string | null
          start_time?: string | null
          total_hours?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_interruptions_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_interruptions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
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
          assigned_to: string | null
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
          source_document_id: string | null
          source_ppm_id: string | null
          status: string
          task_description: string | null
          task_name: string
          template_item_id: string | null
        }
        Insert: {
          assigned_to?: string | null
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
          source_document_id?: string | null
          source_ppm_id?: string | null
          status?: string
          task_description?: string | null
          task_name: string
          template_item_id?: string | null
        }
        Update: {
          assigned_to?: string | null
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
          source_document_id?: string | null
          source_ppm_id?: string | null
          status?: string
          task_description?: string | null
          task_name?: string
          template_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_instances_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "building_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_source_ppm_id_fkey"
            columns: ["source_ppm_id"]
            isOneToOne: false
            referencedRelation: "building_ppm_services"
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
      tenant_arrears: {
        Row: {
          building_id: string
          closing_balance: number | null
          contact: string | null
          created_at: string
          deposit_held: number | null
          id: string
          report_id: string | null
          tenant_id: string | null
          trading_as: string | null
          updated_at: string
        }
        Insert: {
          building_id: string
          closing_balance?: number | null
          contact?: string | null
          created_at?: string
          deposit_held?: number | null
          id?: string
          report_id?: string | null
          tenant_id?: string | null
          trading_as?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          closing_balance?: number | null
          contact?: string | null
          created_at?: string
          deposit_held?: number | null
          id?: string
          report_id?: string | null
          tenant_id?: string | null
          trading_as?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_arrears_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_arrears_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_arrears_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "building_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_compliance: {
        Row: {
          building_id: string
          comment: string | null
          created_at: string
          electrical_coc_cert_no: string | null
          electrical_coc_date: string | null
          electrical_coc_responsibility: string | null
          evac_plan_displayed: string | null
          fire_blanket: string | null
          fire_sprinkler_3yr: string | null
          fire_sprinkler_annual: string | null
          fire_sprinkler_weekly: string | null
          flammable_liquid_cert: string | null
          food_extraction_cert: string | null
          gas_coc: string | null
          generator_dedicated: string | null
          generator_records_current: string | null
          generator_responsibility: string | null
          grease_trap_clean: string | null
          handheld_fire_current: string | null
          hvac_handover_month: string | null
          hvac_records_current: string | null
          hvac_responsibility: string | null
          id: string
          lease_clause_no: string | null
          occupancy_cert_date: string | null
          occupancy_cert_no: string | null
          ohs_risks: string | null
          period: string | null
          report_id: string | null
          smoke_detection_annual_service: string | null
          smoke_detection_dedicated: string | null
          smoke_extraction_annual_service: string | null
          smoke_extraction_dedicated: string | null
          sprinkler_dedicated: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          building_id: string
          comment?: string | null
          created_at?: string
          electrical_coc_cert_no?: string | null
          electrical_coc_date?: string | null
          electrical_coc_responsibility?: string | null
          evac_plan_displayed?: string | null
          fire_blanket?: string | null
          fire_sprinkler_3yr?: string | null
          fire_sprinkler_annual?: string | null
          fire_sprinkler_weekly?: string | null
          flammable_liquid_cert?: string | null
          food_extraction_cert?: string | null
          gas_coc?: string | null
          generator_dedicated?: string | null
          generator_records_current?: string | null
          generator_responsibility?: string | null
          grease_trap_clean?: string | null
          handheld_fire_current?: string | null
          hvac_handover_month?: string | null
          hvac_records_current?: string | null
          hvac_responsibility?: string | null
          id?: string
          lease_clause_no?: string | null
          occupancy_cert_date?: string | null
          occupancy_cert_no?: string | null
          ohs_risks?: string | null
          period?: string | null
          report_id?: string | null
          smoke_detection_annual_service?: string | null
          smoke_detection_dedicated?: string | null
          smoke_extraction_annual_service?: string | null
          smoke_extraction_dedicated?: string | null
          sprinkler_dedicated?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          building_id?: string
          comment?: string | null
          created_at?: string
          electrical_coc_cert_no?: string | null
          electrical_coc_date?: string | null
          electrical_coc_responsibility?: string | null
          evac_plan_displayed?: string | null
          fire_blanket?: string | null
          fire_sprinkler_3yr?: string | null
          fire_sprinkler_annual?: string | null
          fire_sprinkler_weekly?: string | null
          flammable_liquid_cert?: string | null
          food_extraction_cert?: string | null
          gas_coc?: string | null
          generator_dedicated?: string | null
          generator_records_current?: string | null
          generator_responsibility?: string | null
          grease_trap_clean?: string | null
          handheld_fire_current?: string | null
          hvac_handover_month?: string | null
          hvac_records_current?: string | null
          hvac_responsibility?: string | null
          id?: string
          lease_clause_no?: string | null
          occupancy_cert_date?: string | null
          occupancy_cert_no?: string | null
          ohs_risks?: string | null
          period?: string | null
          report_id?: string | null
          smoke_detection_annual_service?: string | null
          smoke_detection_dedicated?: string | null
          smoke_extraction_annual_service?: string | null
          smoke_extraction_dedicated?: string | null
          sprinkler_dedicated?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_compliance_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_compliance_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_compliance_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "building_tenants"
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
      tenant_movements: {
        Row: {
          building_id: string
          comment: string | null
          created_at: string
          first_trade_date: string | null
          id: string
          movement_type: string | null
          prelim_inspection_date: string | null
          report_id: string | null
          take_on_back_date: string | null
          tenant_id: string | null
          trading_as: string | null
          updated_at: string
          vacate_or_bo_date: string | null
        }
        Insert: {
          building_id: string
          comment?: string | null
          created_at?: string
          first_trade_date?: string | null
          id?: string
          movement_type?: string | null
          prelim_inspection_date?: string | null
          report_id?: string | null
          take_on_back_date?: string | null
          tenant_id?: string | null
          trading_as?: string | null
          updated_at?: string
          vacate_or_bo_date?: string | null
        }
        Update: {
          building_id?: string
          comment?: string | null
          created_at?: string
          first_trade_date?: string | null
          id?: string
          movement_type?: string | null
          prelim_inspection_date?: string | null
          report_id?: string | null
          take_on_back_date?: string | null
          tenant_id?: string | null
          trading_as?: string | null
          updated_at?: string
          vacate_or_bo_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_movements_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_movements_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "building_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_shop_spec: {
        Row: {
          actual_amps: string | null
          building_id: string
          ceiling_height: string | null
          ceiling_structure: string | null
          created_at: string
          db_phase: string | null
          effective_from: string | null
          floor_finish: string | null
          generator_connection: string | null
          hvac_btu: string | null
          hvac_gas: string | null
          hvac_units: string | null
          id: string
          is_current: boolean
          lease_amps: string | null
          lighting_type: string | null
          notes: string | null
          plumbing_sink: string | null
          plumbing_toilets: number | null
          roller_shutter_type: string | null
          shopfront_type: string | null
          tenant_id: string
          updated_at: string
          wall_finish: string | null
          walls: string | null
        }
        Insert: {
          actual_amps?: string | null
          building_id: string
          ceiling_height?: string | null
          ceiling_structure?: string | null
          created_at?: string
          db_phase?: string | null
          effective_from?: string | null
          floor_finish?: string | null
          generator_connection?: string | null
          hvac_btu?: string | null
          hvac_gas?: string | null
          hvac_units?: string | null
          id?: string
          is_current?: boolean
          lease_amps?: string | null
          lighting_type?: string | null
          notes?: string | null
          plumbing_sink?: string | null
          plumbing_toilets?: number | null
          roller_shutter_type?: string | null
          shopfront_type?: string | null
          tenant_id: string
          updated_at?: string
          wall_finish?: string | null
          walls?: string | null
        }
        Update: {
          actual_amps?: string | null
          building_id?: string
          ceiling_height?: string | null
          ceiling_structure?: string | null
          created_at?: string
          db_phase?: string | null
          effective_from?: string | null
          floor_finish?: string | null
          generator_connection?: string | null
          hvac_btu?: string | null
          hvac_gas?: string | null
          hvac_units?: string | null
          id?: string
          is_current?: boolean
          lease_amps?: string | null
          lighting_type?: string | null
          notes?: string | null
          plumbing_sink?: string | null
          plumbing_toilets?: number | null
          roller_shutter_type?: string | null
          shopfront_type?: string | null
          tenant_id?: string
          updated_at?: string
          wall_finish?: string | null
          walls?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_shop_spec_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_shop_spec_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "building_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_turnover: {
        Row: {
          annual_growth_pct: number | null
          annual_trading_density: number | null
          building_id: string
          comment: string | null
          coo_pct: number | null
          created_at: string
          gla: number | null
          id: string
          monthly_avg_turnover: number | null
          rank_band: string | null
          report_id: string | null
          tenant_id: string | null
          tenant_name: string | null
          updated_at: string
        }
        Insert: {
          annual_growth_pct?: number | null
          annual_trading_density?: number | null
          building_id: string
          comment?: string | null
          coo_pct?: number | null
          created_at?: string
          gla?: number | null
          id?: string
          monthly_avg_turnover?: number | null
          rank_band?: string | null
          report_id?: string | null
          tenant_id?: string | null
          tenant_name?: string | null
          updated_at?: string
        }
        Update: {
          annual_growth_pct?: number | null
          annual_trading_density?: number | null
          building_id?: string
          comment?: string | null
          coo_pct?: number | null
          created_at?: string
          gla?: number | null
          id?: string
          monthly_avg_turnover?: number | null
          rank_band?: string | null
          report_id?: string | null
          tenant_id?: string | null
          tenant_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_turnover_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_turnover_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_turnover_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "building_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      toilet_fund: {
        Row: {
          actual_banked: number | null
          bale_variance: number | null
          budget: number | null
          building_id: string
          created_at: string
          id: string
          issued_bales: number | null
          profit_per_roll: number | null
          report_id: string | null
          stock_on_hand_bales: number | null
          updated_at: string
          variance: number | null
        }
        Insert: {
          actual_banked?: number | null
          bale_variance?: number | null
          budget?: number | null
          building_id: string
          created_at?: string
          id?: string
          issued_bales?: number | null
          profit_per_roll?: number | null
          report_id?: string | null
          stock_on_hand_bales?: number | null
          updated_at?: string
          variance?: number | null
        }
        Update: {
          actual_banked?: number | null
          bale_variance?: number | null
          budget?: number | null
          building_id?: string
          created_at?: string
          id?: string
          issued_bales?: number | null
          profit_per_roll?: number | null
          report_id?: string | null
          stock_on_hand_bales?: number | null
          updated_at?: string
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "toilet_fund_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toilet_fund_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      trading_hour_breaches: {
        Row: {
          building_id: string
          comment: string | null
          created_at: string
          date: string | null
          id: string
          letter_sent_to: string | null
          report_id: string | null
          tenant_name: string | null
          time: string | null
          updated_at: string
        }
        Insert: {
          building_id: string
          comment?: string | null
          created_at?: string
          date?: string | null
          id?: string
          letter_sent_to?: string | null
          report_id?: string | null
          tenant_name?: string | null
          time?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          comment?: string | null
          created_at?: string
          date?: string | null
          id?: string
          letter_sent_to?: string | null
          report_id?: string | null
          tenant_name?: string | null
          time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trading_hour_breaches_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trading_hour_breaches_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
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
      utility_readings: {
        Row: {
          building_id: string
          category: string | null
          comment: string | null
          created_at: string
          difference: number | null
          id: string
          meter_name: string | null
          night_window: string | null
          pct_of_bulk: number | null
          reading: number | null
          report_id: string | null
          unit: string | null
          updated_at: string
          utility: string | null
        }
        Insert: {
          building_id: string
          category?: string | null
          comment?: string | null
          created_at?: string
          difference?: number | null
          id?: string
          meter_name?: string | null
          night_window?: string | null
          pct_of_bulk?: number | null
          reading?: number | null
          report_id?: string | null
          unit?: string | null
          updated_at?: string
          utility?: string | null
        }
        Update: {
          building_id?: string
          category?: string | null
          comment?: string | null
          created_at?: string
          difference?: number | null
          id?: string
          meter_name?: string | null
          night_window?: string | null
          pct_of_bulk?: number | null
          reading?: number | null
          report_id?: string | null
          unit?: string | null
          updated_at?: string
          utility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "utility_readings_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_readings_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      utility_yields: {
        Row: {
          actual_yield: number | null
          building_id: string
          comment: string | null
          created_at: string
          id: string
          pct_achieved: number | null
          predicted_yield: number | null
          report_id: string | null
          source: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          actual_yield?: number | null
          building_id: string
          comment?: string | null
          created_at?: string
          id?: string
          pct_achieved?: number | null
          predicted_yield?: number | null
          report_id?: string | null
          source?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          actual_yield?: number | null
          building_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          pct_achieved?: number | null
          predicted_yield?: number | null
          report_id?: string | null
          source?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "utility_yields_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_yields_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancies: {
        Row: {
          area: number | null
          budget_relet_rpm: number | null
          building_id: string
          comment: string | null
          created_at: string
          gross_mandate_rpm: number | null
          id: string
          report_id: string | null
          shop_no: string | null
          updated_at: string
        }
        Insert: {
          area?: number | null
          budget_relet_rpm?: number | null
          building_id: string
          comment?: string | null
          created_at?: string
          gross_mandate_rpm?: number | null
          id?: string
          report_id?: string | null
          shop_no?: string | null
          updated_at?: string
        }
        Update: {
          area?: number | null
          budget_relet_rpm?: number | null
          building_id?: string
          comment?: string | null
          created_at?: string
          gross_mandate_rpm?: number | null
          id?: string
          report_id?: string | null
          shop_no?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacancies_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacancies_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      building_month_costs: {
        Row: {
          building_id: string | null
          issues_actual: number | null
          month: string | null
          services_cost: number | null
          total: number | null
        }
        Relationships: []
      }
      compliance_critical_scores: {
        Row: {
          assessment_id: string | null
          building_id: string | null
          critical_pct: number | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_assessments_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_scores: {
        Row: {
          assessment_id: string | null
          building_id: string | null
          compliance_pct: number | null
          report_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_assessments_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_assessments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: true
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_section_scores: {
        Row: {
          assessment_id: string | null
          building_id: string | null
          section_no: string | null
          section_pct: number | null
          section_title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_assessments_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      ppm_monthly_status: {
        Row: {
          building_id: string | null
          done_on: string | null
          period_month: string | null
          ppm_service_id: string | null
          service_name: string | null
          status: string | null
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
            foreignKeyName: "task_instances_source_ppm_id_fkey"
            columns: ["ppm_service_id"]
            isOneToOne: false
            referencedRelation: "building_ppm_services"
            referencedColumns: ["id"]
          },
        ]
      }
      v_building_turnover: {
        Row: {
          annual_trading_density: number | null
          building_id: string | null
          cm_comment: string | null
          created_at: string | null
          current_month_total: number | null
          growth_pct: number | null
          id: string | null
          previous_year_month_total: number | null
          report_id: string | null
          spend_per_head: number | null
          updated_at: string | null
        }
        Insert: {
          annual_trading_density?: number | null
          building_id?: string | null
          cm_comment?: string | null
          created_at?: string | null
          current_month_total?: number | null
          growth_pct?: never
          id?: string | null
          previous_year_month_total?: number | null
          report_id?: string | null
          spend_per_head?: number | null
          updated_at?: string | null
        }
        Update: {
          annual_trading_density?: number | null
          building_id?: string | null
          cm_comment?: string | null
          created_at?: string | null
          current_month_total?: number | null
          growth_pct?: never
          id?: string | null
          previous_year_month_total?: number | null
          report_id?: string | null
          spend_per_head?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "building_turnover_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_turnover_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: true
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      app_role: { Args: never; Returns: string }
      building_insight_linker: {
        Args: { p_building_id: string }
        Returns: Json
      }
      building_members: {
        Args: { b: string }
        Returns: {
          avatar_url: string
          full_name: string
          id: string
          role: string
        }[]
      }
      can_access_building: { Args: { b: string }; Returns: boolean }
      complete_task: {
        Args: {
          p_completion_id: string
          p_notes?: string
          p_photo_urls?: Json
          p_signature_confirmed?: boolean
          p_task_instance_id: string
        }
        Returns: {
          already_completed: boolean
          completion_id: string
        }[]
      }
      delete_own_account: { Args: never; Returns: undefined }
      generate_certificate_renewal_tasks: { Args: never; Returns: number }
      generate_ppm_tasks: {
        Args: { p_building?: string; p_horizon_days?: number }
        Returns: number
      }
      generate_scheduled_tasks: {
        Args: {
          p_building?: string
          p_frequency?: string
          p_horizon_days?: number
          p_template?: string
        }
        Returns: number
      }
      is_active_user: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_admin_or_manager: { Args: never; Returns: boolean }
      legacy_frequency: { Args: { r: Json }; Returns: string }
      mark_overdue_tasks: { Args: never; Returns: number }
      postgres_fdw_disconnect: { Args: { "": string }; Returns: boolean }
      postgres_fdw_disconnect_all: { Args: never; Returns: boolean }
      postgres_fdw_get_connections: {
        Args: never
        Returns: Record<string, unknown>[]
      }
      postgres_fdw_handler: { Args: never; Returns: unknown }
      recurrence_is_valid: { Args: { r: Json }; Returns: boolean }
      recurrence_occurrences: {
        Args: { p_from: string; p_to: string; r: Json }
        Returns: string[]
      }
      report_electrical_compliance: {
        Args: { p_building_id: string }
        Returns: Json
      }
      reschedule_ppm_line: { Args: { p_line: string }; Returns: number }
      reschedule_template: {
        Args: { p_template: string }
        Returns: {
          deleted: number
          generated: number
        }[]
      }
      revoke_user_sessions: { Args: { p_user_id: string }; Returns: number }
      scheduled_due_date: {
        Args: { p_frequency: string; p_today: string }
        Returns: string
      }
      search_entities: {
        Args: { lim?: number; q: string }
        Returns: {
          building_id: string
          id: string
          kind: string
          subtitle: string
          title: string
        }[]
      }
      user_can_access_building: {
        Args: { p_building: string; p_user: string }
        Returns: boolean
      }
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
    Enums: {},
  },
} as const
