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
          cost: number | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          next_service_date: string | null
          notes: string | null
          performed_by: string | null
          service_date: string
          service_type: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          cost?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          next_service_date?: string | null
          notes?: string | null
          performed_by?: string | null
          service_date: string
          service_type: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          cost?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          next_service_date?: string | null
          notes?: string | null
          performed_by?: string | null
          service_date?: string
          service_type?: string
          updated_at?: string
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
          created_at: string
          details: Json | null
          entity_id: string
          entity_type: string
          id: string
          ip_address: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      building_assets: {
        Row: {
          building_id: string
          category: string
          created_at: string
          id: string
          installation_date: string | null
          last_service_date: string | null
          location: string | null
          manufacturer: string | null
          model: string | null
          name: string
          next_service_date: string | null
          notes: string | null
          serial_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          building_id: string
          category: string
          created_at?: string
          id?: string
          installation_date?: string | null
          last_service_date?: string | null
          location?: string | null
          manufacturer?: string | null
          model?: string | null
          name: string
          next_service_date?: string | null
          notes?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          building_id?: string
          category?: string
          created_at?: string
          id?: string
          installation_date?: string | null
          last_service_date?: string | null
          location?: string | null
          manufacturer?: string | null
          model?: string | null
          name?: string
          next_service_date?: string | null
          notes?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
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
      building_checklist_items: {
        Row: {
          building_id: string
          created_at: string
          created_by: string | null
          frequency: string
          id: string
          is_active: boolean | null
          requires_photo: boolean | null
          requires_signature: boolean | null
          responsible_role: string
          task_description: string | null
          task_name: string
          updated_at: string
        }
        Insert: {
          building_id: string
          created_at?: string
          created_by?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          requires_photo?: boolean | null
          requires_signature?: boolean | null
          responsible_role?: string
          task_description?: string | null
          task_name: string
          updated_at?: string
        }
        Update: {
          building_id?: string
          created_at?: string
          created_by?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          requires_photo?: boolean | null
          requires_signature?: boolean | null
          responsible_role?: string
          task_description?: string | null
          task_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_checklist_items_building_id_fkey"
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
          created_at: string
          document_type: string
          expiry_date: string | null
          file_url: string | null
          id: string
          issue_date: string | null
          issuing_authority: string | null
          name: string
          notes: string | null
          reference_number: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          building_id: string
          created_at?: string
          document_type: string
          expiry_date?: string | null
          file_url?: string | null
          id?: string
          issue_date?: string | null
          issuing_authority?: string | null
          name: string
          notes?: string | null
          reference_number?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          building_id?: string
          created_at?: string
          document_type?: string
          expiry_date?: string | null
          file_url?: string | null
          id?: string
          issue_date?: string | null
          issuing_authority?: string | null
          name?: string
          notes?: string | null
          reference_number?: string | null
          updated_at?: string
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
          created_at: string
          created_by: string
          id: string
          is_pinned: boolean | null
          title: string
          updated_at: string
        }
        Insert: {
          building_id: string
          category?: string | null
          content: string
          created_at?: string
          created_by: string
          id?: string
          is_pinned?: boolean | null
          title: string
          updated_at?: string
        }
        Update: {
          building_id?: string
          category?: string | null
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          is_pinned?: boolean | null
          title?: string
          updated_at?: string
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
          created_at: string
          id: string
          is_active: boolean | null
          lease_end_date: string | null
          lease_start_date: string | null
          notes: string | null
          shop_name: string
          shop_number: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          building_id: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          lease_end_date?: string | null
          lease_start_date?: string | null
          notes?: string | null
          shop_name: string
          shop_number: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          building_id?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          lease_end_date?: string | null
          lease_start_date?: string | null
          notes?: string | null
          shop_name?: string
          shop_number?: string
          updated_at?: string
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
          address: string
          city: string
          council_details: Json | null
          created_at: string
          electrical_authority: Json | null
          emergency_contacts: Json | null
          id: string
          latitude: number | null
          logo_position: string | null
          logo_url: string | null
          longitude: number | null
          meter_reading_company: Json | null
          name: string
          organization_id: string
          professional_team: Json | null
          statutory_certificates: Json | null
          timezone: string
          updated_at: string
          utility_tariffs: Json | null
        }
        Insert: {
          address: string
          city?: string
          council_details?: Json | null
          created_at?: string
          electrical_authority?: Json | null
          emergency_contacts?: Json | null
          id?: string
          latitude?: number | null
          logo_position?: string | null
          logo_url?: string | null
          longitude?: number | null
          meter_reading_company?: Json | null
          name: string
          organization_id: string
          professional_team?: Json | null
          statutory_certificates?: Json | null
          timezone?: string
          updated_at?: string
          utility_tariffs?: Json | null
        }
        Update: {
          address?: string
          city?: string
          council_details?: Json | null
          created_at?: string
          electrical_authority?: Json | null
          emergency_contacts?: Json | null
          id?: string
          latitude?: number | null
          logo_position?: string | null
          logo_url?: string | null
          longitude?: number | null
          meter_reading_company?: Json | null
          name?: string
          organization_id?: string
          professional_team?: Json | null
          statutory_certificates?: Json | null
          timezone?: string
          updated_at?: string
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
          created_at: string
          description: string | null
          frequency: Database["public"]["Enums"]["task_frequency"]
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          responsible_role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          frequency: Database["public"]["Enums"]["task_frequency"]
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          responsible_role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          frequency?: Database["public"]["Enums"]["task_frequency"]
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          responsible_role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
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
      form_submissions: {
        Row: {
          building_id: string | null
          created_at: string
          form_data: Json
          form_name: string
          form_template_id: string
          id: string
          photo_urls: string[] | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_by: string
          updated_at: string
        }
        Insert: {
          building_id?: string | null
          created_at?: string
          form_data?: Json
          form_name: string
          form_template_id: string
          id?: string
          photo_urls?: string[] | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by: string
          updated_at?: string
        }
        Update: {
          building_id?: string | null
          created_at?: string
          form_data?: Json
          form_name?: string
          form_template_id?: string
          id?: string
          photo_urls?: string[] | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string
          updated_at?: string
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
      issues: {
        Row: {
          assigned_to: string | null
          building_id: string
          corrective_action: string | null
          created_at: string
          deadline: string | null
          description: string
          id: string
          photo_urls: string[] | null
          priority: Database["public"]["Enums"]["issue_priority"]
          reported_by: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["issue_status"]
          task_instance_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          building_id: string
          corrective_action?: string | null
          created_at?: string
          deadline?: string | null
          description: string
          id?: string
          photo_urls?: string[] | null
          priority?: Database["public"]["Enums"]["issue_priority"]
          reported_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["issue_status"]
          task_instance_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          building_id?: string
          corrective_action?: string | null
          created_at?: string
          deadline?: string | null
          description?: string
          id?: string
          photo_urls?: string[] | null
          priority?: Database["public"]["Enums"]["issue_priority"]
          reported_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["issue_status"]
          task_instance_id?: string | null
          title?: string
          updated_at?: string
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
      organizations: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          id: string
          logo_url: string | null
          name: string
          phone: string | null
          primary_color: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          name: string
          phone?: string | null
          primary_color?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          phone?: string | null
          primary_color?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          daily_digest: boolean | null
          email: string
          email_notifications: boolean | null
          full_name: string | null
          id: string
          issue_updates: boolean | null
          overdue_alerts: boolean | null
          phone: string | null
          task_reminders: boolean | null
          theme_preference: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          daily_digest?: boolean | null
          email: string
          email_notifications?: boolean | null
          full_name?: string | null
          id: string
          issue_updates?: boolean | null
          overdue_alerts?: boolean | null
          phone?: string | null
          task_reminders?: boolean | null
          theme_preference?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          daily_digest?: boolean | null
          email?: string
          email_notifications?: boolean | null
          full_name?: string | null
          id?: string
          issue_updates?: boolean | null
          overdue_alerts?: boolean | null
          phone?: string | null
          task_reminders?: boolean | null
          theme_preference?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      task_completions: {
        Row: {
          completed_at: string
          completed_by: string
          created_at: string
          id: string
          notes: string | null
          photo_urls: string[] | null
          signature_confirmed: boolean | null
          task_instance_id: string
        }
        Insert: {
          completed_at?: string
          completed_by: string
          created_at?: string
          id?: string
          notes?: string | null
          photo_urls?: string[] | null
          signature_confirmed?: boolean | null
          task_instance_id: string
        }
        Update: {
          completed_at?: string
          completed_by?: string
          created_at?: string
          id?: string
          notes?: string | null
          photo_urls?: string[] | null
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
          created_at: string
          due_date: string
          frequency: Database["public"]["Enums"]["task_frequency"]
          id: string
          requires_photo: boolean | null
          requires_signature: boolean | null
          responsible_role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["task_status"]
          task_description: string | null
          task_name: string
          template_item_id: string | null
          updated_at: string
        }
        Insert: {
          building_id: string
          created_at?: string
          due_date: string
          frequency: Database["public"]["Enums"]["task_frequency"]
          id?: string
          requires_photo?: boolean | null
          requires_signature?: boolean | null
          responsible_role: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["task_status"]
          task_description?: string | null
          task_name: string
          template_item_id?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          created_at?: string
          due_date?: string
          frequency?: Database["public"]["Enums"]["task_frequency"]
          id?: string
          requires_photo?: boolean | null
          requires_signature?: boolean | null
          responsible_role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["task_status"]
          task_description?: string | null
          task_name?: string
          template_item_id?: string | null
          updated_at?: string
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
          created_at: string
          display_order: number
          id: string
          requires_photo: boolean | null
          requires_signature: boolean | null
          responsible_party: string | null
          task_description: string | null
          task_name: string
          template_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          requires_photo?: boolean | null
          requires_signature?: boolean | null
          responsible_party?: string | null
          task_description?: string | null
          task_name: string
          template_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
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
          created_at: string
          document_type: string
          expiry_date: string | null
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          issue_date: string | null
          name: string
          notes: string | null
          tenant_id: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          document_type: string
          expiry_date?: string | null
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          issue_date?: string | null
          name: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          document_type?: string
          expiry_date?: string | null
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          issue_date?: string | null
          name?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
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
      user_building_assignments: {
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
            foreignKeyName: "user_building_assignments_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_building_access: {
        Args: { _building_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tenant_access: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      is_admin_or_manager: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "manager" | "user" | "reviewer"
      issue_priority: "low" | "medium" | "high" | "critical"
      issue_status: "open" | "in_progress" | "resolved" | "escalated"
      task_frequency: "daily" | "weekly" | "monthly" | "quarterly" | "annually"
      task_status: "pending" | "completed" | "overdue" | "issue_logged"
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
      app_role: ["admin", "manager", "user", "reviewer"],
      issue_priority: ["low", "medium", "high", "critical"],
      issue_status: ["open", "in_progress", "resolved", "escalated"],
      task_frequency: ["daily", "weekly", "monthly", "quarterly", "annually"],
      task_status: ["pending", "completed", "overdue", "issue_logged"],
    },
  },
} as const
