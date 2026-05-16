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
  audit: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          after_state: Json | null
          before_state: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          occurred_at: string
          organization_id: string | null
          prev_hash: string | null
          row_hash: string
          session_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          after_state?: Json | null
          before_state?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          occurred_at?: string
          organization_id?: string | null
          prev_hash?: string | null
          row_hash: string
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          after_state?: Json | null
          before_state?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          occurred_at?: string
          organization_id?: string | null
          prev_hash?: string | null
          row_hash?: string
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      log_event: {
        Args: {
          p_action: string
          p_after_state?: Json
          p_before_state?: Json
          p_entity_id?: string
          p_entity_type: string
          p_ip_address?: unknown
          p_organization_id?: string
          p_user_agent?: string
        }
        Returns: string
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
      bank_accounts: {
        Row: {
          account_digit: string | null
          account_number: string
          account_type: string
          agency: string
          api_credentials_secret_id: string | null
          bank_code: string
          bank_name: string
          created_at: string
          deleted_at: string | null
          display_name: string | null
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          purpose: string
          updated_at: string
        }
        Insert: {
          account_digit?: string | null
          account_number: string
          account_type: string
          agency: string
          api_credentials_secret_id?: string | null
          bank_code: string
          bank_name: string
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          purpose: string
          updated_at?: string
        }
        Update: {
          account_digit?: string | null
          account_number?: string
          account_type?: string
          agency?: string
          api_credentials_secret_id?: string | null
          bank_code?: string
          bank_name?: string
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          purpose?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_partners: {
        Row: {
          address: Json | null
          created_at: string
          created_by: string | null
          default_payment_terms: number | null
          deleted_at: string | null
          document: string
          document_type: string
          email: string | null
          group_id: string
          id: string
          legal_name: string
          notes: string | null
          partner_type: string
          phone: string | null
          receita_data: Json | null
          receita_synced_at: string | null
          status: string
          supplier_user_id: string | null
          trade_name: string | null
          updated_at: string
          uses_supplier_portal: boolean
        }
        Insert: {
          address?: Json | null
          created_at?: string
          created_by?: string | null
          default_payment_terms?: number | null
          deleted_at?: string | null
          document: string
          document_type: string
          email?: string | null
          group_id: string
          id?: string
          legal_name: string
          notes?: string | null
          partner_type: string
          phone?: string | null
          receita_data?: Json | null
          receita_synced_at?: string | null
          status?: string
          supplier_user_id?: string | null
          trade_name?: string | null
          updated_at?: string
          uses_supplier_portal?: boolean
        }
        Update: {
          address?: Json | null
          created_at?: string
          created_by?: string | null
          default_payment_terms?: number | null
          deleted_at?: string | null
          document?: string
          document_type?: string
          email?: string | null
          group_id?: string
          id?: string
          legal_name?: string
          notes?: string | null
          partner_type?: string
          phone?: string | null
          receita_data?: Json | null
          receita_synced_at?: string | null
          status?: string
          supplier_user_id?: string | null
          trade_name?: string | null
          updated_at?: string
          uses_supplier_portal?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "business_partners_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_of_accounts: {
        Row: {
          account_type: string
          active: boolean
          code: string
          created_at: string
          deleted_at: string | null
          group_id: string
          id: string
          is_analytical: boolean
          level: number
          name: string
          notes: string | null
          parent_account_id: string | null
          updated_at: string
        }
        Insert: {
          account_type: string
          active?: boolean
          code: string
          created_at?: string
          deleted_at?: string | null
          group_id: string
          id?: string
          is_analytical?: boolean
          level: number
          name: string
          notes?: string | null
          parent_account_id?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: string
          active?: boolean
          code?: string
          created_at?: string
          deleted_at?: string | null
          group_id?: string
          id?: string
          is_analytical?: boolean
          level?: number
          name?: string
          notes?: string | null
          parent_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          active: boolean
          code: string
          created_at: string
          deleted_at: string | null
          description: string | null
          group_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          group_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          group_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: Json | null
          cnpj: string | null
          created_at: string
          deleted_at: string | null
          id: string
          legal_name: string
          municipal_registration: string | null
          parent_id: string | null
          state_registration: string | null
          trade_name: string | null
          type: string
          updated_at: string
        }
        Insert: {
          address?: Json | null
          cnpj?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          legal_name: string
          municipal_registration?: string | null
          parent_id?: string | null
          state_registration?: string | null
          trade_name?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          address?: Json | null
          cnpj?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          legal_name?: string
          municipal_registration?: string | null
          parent_id?: string | null
          state_registration?: string | null
          trade_name?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_bank_change_log: {
        Row: {
          change_type: string
          changed_by: string | null
          changed_by_role: string
          changed_to_new_account: boolean | null
          effective_at: string
          id: string
          ip_address: unknown
          new_account_hash: string | null
          new_data_encrypted: string | null
          new_pix_hash: string | null
          occurred_at: string
          old_account_hash: string | null
          old_data_encrypted: string | null
          old_pix_hash: string | null
          reason: string | null
          session_id: string | null
          supplier_id: string
          user_agent: string | null
        }
        Insert: {
          change_type: string
          changed_by?: string | null
          changed_by_role: string
          changed_to_new_account?: boolean | null
          effective_at?: string
          id?: string
          ip_address?: unknown
          new_account_hash?: string | null
          new_data_encrypted?: string | null
          new_pix_hash?: string | null
          occurred_at?: string
          old_account_hash?: string | null
          old_data_encrypted?: string | null
          old_pix_hash?: string | null
          reason?: string | null
          session_id?: string | null
          supplier_id: string
          user_agent?: string | null
        }
        Update: {
          change_type?: string
          changed_by?: string | null
          changed_by_role?: string
          changed_to_new_account?: boolean | null
          effective_at?: string
          id?: string
          ip_address?: unknown
          new_account_hash?: string | null
          new_data_encrypted?: string | null
          new_pix_hash?: string | null
          occurred_at?: string
          old_account_hash?: string | null
          old_data_encrypted?: string | null
          old_pix_hash?: string | null
          reason?: string | null
          session_id?: string | null
          supplier_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bank_change_log_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "business_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_bank_details: {
        Row: {
          account_digit_encrypted: string | null
          account_hash: string | null
          account_holder_doc: string | null
          account_holder_name: string | null
          account_number_encrypted: string | null
          agency: string | null
          bank_code: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          pix_key_encrypted: string | null
          pix_key_hash: string | null
          pix_key_type: string | null
          supplier_id: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          account_digit_encrypted?: string | null
          account_hash?: string | null
          account_holder_doc?: string | null
          account_holder_name?: string | null
          account_number_encrypted?: string | null
          agency?: string | null
          bank_code?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          pix_key_encrypted?: string | null
          pix_key_hash?: string | null
          pix_key_type?: string | null
          supplier_id: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          account_digit_encrypted?: string | null
          account_hash?: string | null
          account_holder_doc?: string | null
          account_holder_name?: string | null
          account_number_encrypted?: string | null
          agency?: string | null
          bank_code?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          pix_key_encrypted?: string | null
          pix_key_hash?: string | null
          pix_key_type?: string | null
          supplier_id?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bank_details_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "business_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_invitations: {
        Row: {
          attempt_count: number
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          invitation_code_hash: string
          locked_until: string | null
          resulting_user_id: string | null
          supplier_id: string
          used_at: string | null
          used_ip: unknown
          used_user_agent: string | null
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          created_by?: string | null
          email: string
          expires_at: string
          id?: string
          invitation_code_hash: string
          locked_until?: string | null
          resulting_user_id?: string | null
          supplier_id: string
          used_at?: string | null
          used_ip?: unknown
          used_user_agent?: string | null
        }
        Update: {
          attempt_count?: number
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          invitation_code_hash?: string
          locked_until?: string | null
          resulting_user_id?: string | null
          supplier_id?: string
          used_at?: string | null
          used_ip?: unknown
          used_user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invitations_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "business_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      user_org_access: {
        Row: {
          granted_at: string
          granted_by: string | null
          organization_id: string
          permissions: Json
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          organization_id: string
          permissions?: Json
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          organization_id?: string
          permissions?: Json
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_org_access_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          full_name: string
          phone: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          full_name: string
          phone?: string | null
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          phone?: string | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_role: { Args: never; Returns: string }
      decrypt_bank_field: { Args: { p_ciphertext: string }; Returns: string }
      encrypt_bank_field: { Args: { p_plaintext: string }; Returns: string }
      generate_invitation_code: { Args: never; Returns: string }
      hash_bank_field: { Args: { p_plaintext: string }; Returns: string }
      hash_invitation_code: { Args: { p_code: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      user_has_org_access: { Args: { p_org_id: string }; Returns: boolean }
      user_has_org_access_recursive: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      user_has_role: { Args: { p_roles: string[] }; Returns: boolean }
      verify_invitation_code: {
        Args: { p_code: string; p_hash: string }
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
  audit: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
