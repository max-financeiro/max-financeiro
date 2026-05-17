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
      accounts_payable: {
        Row: {
          account_id: string | null
          amount: number
          amount_paid: number
          amount_pending: number | null
          approval_level_required: string | null
          approved_at: string | null
          beneficiary_bank_details: Json | null
          boleto_barcode: string | null
          cancelled_at: string | null
          competence_date: string
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          due_date: string
          fiscal_document_id: string | null
          id: string
          issue_date: string
          notes: string | null
          organization_id: string
          payment_method: string
          pix_key: string | null
          pix_key_type: string | null
          reference_number: string | null
          rejected_at: string | null
          source: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          supplier_id: string | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          amount_paid?: number
          amount_pending?: number | null
          approval_level_required?: string | null
          approved_at?: string | null
          beneficiary_bank_details?: Json | null
          boleto_barcode?: string | null
          cancelled_at?: string | null
          competence_date: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date: string
          fiscal_document_id?: string | null
          id?: string
          issue_date: string
          notes?: string | null
          organization_id: string
          payment_method: string
          pix_key?: string | null
          pix_key_type?: string | null
          reference_number?: string | null
          rejected_at?: string | null
          source: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          supplier_id?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          amount_paid?: number
          amount_pending?: number | null
          approval_level_required?: string | null
          approved_at?: string | null
          beneficiary_bank_details?: Json | null
          boleto_barcode?: string | null
          cancelled_at?: string | null
          competence_date?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string
          fiscal_document_id?: string | null
          id?: string
          issue_date?: string
          notes?: string | null
          organization_id?: string
          payment_method?: string
          pix_key?: string | null
          pix_key_type?: string | null
          reference_number?: string | null
          rejected_at?: string | null
          source?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          supplier_id?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payable_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "business_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts_payable_attachments: {
        Row: {
          accounts_payable_id: string
          ai_extraction: Json | null
          deleted_at: string | null
          file_name: string
          id: string
          kind: string
          mime_type: string
          organization_id: string
          size_bytes: number
          source: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          accounts_payable_id: string
          ai_extraction?: Json | null
          deleted_at?: string | null
          file_name: string
          id?: string
          kind?: string
          mime_type: string
          organization_id: string
          size_bytes: number
          source?: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          accounts_payable_id?: string
          ai_extraction?: Json | null
          deleted_at?: string | null
          file_name?: string
          id?: string
          kind?: string
          mime_type?: string
          organization_id?: string
          size_bytes?: number
          source?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payable_attachments_accounts_payable_id_fkey"
            columns: ["accounts_payable_id"]
            isOneToOne: false
            referencedRelation: "accounts_payable"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_overrides: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_active: boolean
          override_type: string
          parameters: Json | null
          required_approval_level: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_active?: boolean
          override_type: string
          parameters?: Json | null
          required_approval_level: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_active?: boolean
          override_type?: string
          parameters?: Json | null
          required_approval_level?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_overrides_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_rules: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_active: boolean
          max_amount: number | null
          min_amount: number
          notes: string | null
          priority: number
          required_approval_level: string
          rule_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_active?: boolean
          max_amount?: number | null
          min_amount?: number
          notes?: string | null
          priority?: number
          required_approval_level: string
          rule_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_active?: boolean
          max_amount?: number | null
          min_amount?: number
          notes?: string | null
          priority?: number
          required_approval_level?: string
          rule_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_rules_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      bling_credentials: {
        Row: {
          access_token_encrypted: string | null
          active: boolean
          client_id: string
          client_secret_encrypted: string
          connected_at: string | null
          connected_by: string | null
          created_at: string
          expires_at: string | null
          id: string
          last_refresh_at: string | null
          organization_id: string
          refresh_locked_until: string | null
          refresh_token_encrypted: string | null
          scope: string | null
          updated_at: string
        }
        Insert: {
          access_token_encrypted?: string | null
          active?: boolean
          client_id: string
          client_secret_encrypted: string
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_refresh_at?: string | null
          organization_id: string
          refresh_locked_until?: string | null
          refresh_token_encrypted?: string | null
          scope?: string | null
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string | null
          active?: boolean
          client_id?: string
          client_secret_encrypted?: string
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_refresh_at?: string | null
          organization_id?: string
          refresh_locked_until?: string | null
          refresh_token_encrypted?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_sync_queue: {
        Row: {
          completed_at: string | null
          created_at: string
          cursor: string | null
          error_message: string | null
          id: string
          organization_id: string
          records_synced: number
          started_at: string | null
          status: string
          sync_type: string
          triggered_by: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          cursor?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          records_synced?: number
          started_at?: string | null
          status?: string
          sync_type: string
          triggered_by?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          cursor?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          records_synced?: number
          started_at?: string | null
          status?: string
          sync_type?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_sync_queue_organization_id_fkey"
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
          bank_details_last_changed_at: string | null
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
          bank_details_last_changed_at?: string | null
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
          bank_details_last_changed_at?: string | null
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
      fiscal_document_items: {
        Row: {
          cfop: string | null
          description: string
          fiscal_document_id: string
          id: string
          line_number: number | null
          ncm: string | null
          product_sku: string | null
          quantity: number | null
          taxes: Json | null
          total_price: number | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          cfop?: string | null
          description: string
          fiscal_document_id: string
          id?: string
          line_number?: number | null
          ncm?: string | null
          product_sku?: string | null
          quantity?: number | null
          taxes?: Json | null
          total_price?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          cfop?: string | null
          description?: string
          fiscal_document_id?: string
          id?: string
          line_number?: number | null
          ncm?: string | null
          product_sku?: string | null
          quantity?: number | null
          taxes?: Json | null
          total_price?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_document_items_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_documents: {
        Row: {
          access_key: string | null
          bling_invoice_id: string | null
          competence_date: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          direction: string
          document_type: string
          extracted_data: Json | null
          id: string
          issue_date: string
          issuer_document: string
          issuer_name: string
          number: string
          organization_id: string
          pdf_storage_path: string | null
          recipient_document: string
          recipient_name: string | null
          series: string | null
          source: string
          status: string
          total_amount: number
          total_discount: number | null
          total_freight: number | null
          total_taxes: number | null
          updated_at: string
          xml_storage_path: string | null
        }
        Insert: {
          access_key?: string | null
          bling_invoice_id?: string | null
          competence_date: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          direction: string
          document_type: string
          extracted_data?: Json | null
          id?: string
          issue_date: string
          issuer_document: string
          issuer_name: string
          number: string
          organization_id: string
          pdf_storage_path?: string | null
          recipient_document: string
          recipient_name?: string | null
          series?: string | null
          source: string
          status?: string
          total_amount: number
          total_discount?: number | null
          total_freight?: number | null
          total_taxes?: number | null
          updated_at?: string
          xml_storage_path?: string | null
        }
        Update: {
          access_key?: string | null
          bling_invoice_id?: string | null
          competence_date?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          direction?: string
          document_type?: string
          extracted_data?: Json | null
          id?: string
          issue_date?: string
          issuer_document?: string
          issuer_name?: string
          number?: string
          organization_id?: string
          pdf_storage_path?: string | null
          recipient_document?: string
          recipient_name?: string | null
          series?: string | null
          source?: string
          status?: string
          total_amount?: number
          total_discount?: number | null
          total_freight?: number | null
          total_taxes?: number | null
          updated_at?: string
          xml_storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gemini_credentials: {
        Row: {
          active: boolean
          api_key_encrypted: string
          connected_at: string
          connected_by: string | null
          created_at: string
          id: string
          last_validated_at: string | null
          last_validation_error: string | null
          last_validation_status: string | null
          model: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          api_key_encrypted: string
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          id?: string
          last_validated_at?: string | null
          last_validation_error?: string | null
          last_validation_status?: string | null
          model?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          api_key_encrypted?: string
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          id?: string
          last_validated_at?: string | null
          last_validation_error?: string | null
          last_validation_status?: string | null
          model?: string
          updated_at?: string
        }
        Relationships: []
      }
      idempotency_keys: {
        Row: {
          created_at: string
          endpoint: string
          expires_at: string
          id: string
          key: string
          response_body: Json | null
          response_status: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          expires_at: string
          id?: string
          key: string
          response_body?: Json | null
          response_status?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          expires_at?: string
          id?: string
          key?: string
          response_body?: Json | null
          response_status?: number | null
          user_id?: string
        }
        Relationships: []
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
      payable_approvals: {
        Row: {
          approval_step: string
          decided_at: string
          decided_by: string | null
          decided_by_role: string | null
          decision: string
          decision_notes: string | null
          id: string
          payable_id: string
        }
        Insert: {
          approval_step: string
          decided_at?: string
          decided_by?: string | null
          decided_by_role?: string | null
          decision: string
          decision_notes?: string | null
          id?: string
          payable_id: string
        }
        Update: {
          approval_step?: string
          decided_at?: string
          decided_by?: string | null
          decided_by_role?: string | null
          decision?: string
          decision_notes?: string | null
          id?: string
          payable_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payable_approvals_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "accounts_payable"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          created_at: string
          id: string
          idempotency_key: string
          payable_id: string
          payment_date: string | null
          payment_method: string
          proof_storage_path: string | null
          provider: string
          provider_error_code: string | null
          provider_error_message: string | null
          provider_request_id: string | null
          provider_status: string | null
          requested_by: string | null
          settled_at: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          payable_id: string
          payment_date?: string | null
          payment_method: string
          proof_storage_path?: string | null
          provider?: string
          provider_error_code?: string | null
          provider_error_message?: string | null
          provider_request_id?: string | null
          provider_status?: string | null
          requested_by?: string | null
          settled_at?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          payable_id?: string
          payment_date?: string | null
          payment_method?: string
          proof_storage_path?: string | null
          provider?: string
          provider_error_code?: string | null
          provider_error_message?: string | null
          provider_request_id?: string | null
          provider_status?: string | null
          requested_by?: string | null
          settled_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "accounts_payable"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          bling_data: Json | null
          bling_id: string | null
          bling_synced_at: string | null
          cost: number | null
          created_at: string
          deleted_at: string | null
          description: string | null
          gtin: string | null
          id: string
          name: string
          ncm: string | null
          organization_id: string
          price: number | null
          sku: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          bling_data?: Json | null
          bling_id?: string | null
          bling_synced_at?: string | null
          cost?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          gtin?: string | null
          id?: string
          name: string
          ncm?: string | null
          organization_id: string
          price?: number | null
          sku: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          bling_data?: Json | null
          bling_id?: string | null
          bling_synced_at?: string | null
          cost?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          gtin?: string | null
          id?: string
          name?: string
          ncm?: string | null
          organization_id?: string
          price?: number | null
          sku?: string
          unit?: string | null
          updated_at?: string
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
      rate_limit_buckets: {
        Row: {
          bucket_key: string
          expires_at: string
          id: string
          metadata: Json | null
          request_count: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          expires_at: string
          id?: string
          metadata?: Json | null
          request_count?: number
          window_start?: string
        }
        Update: {
          bucket_key?: string
          expires_at?: string
          id?: string
          metadata?: Json | null
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      stock_balances: {
        Row: {
          bling_synced_at: string
          id: string
          organization_id: string
          product_id: string
          quantity: number
          updated_at: string
          warehouse_bling_id: string | null
          warehouse_name: string
        }
        Insert: {
          bling_synced_at?: string
          id?: string
          organization_id: string
          product_id: string
          quantity?: number
          updated_at?: string
          warehouse_bling_id?: string | null
          warehouse_name?: string
        }
        Update: {
          bling_synced_at?: string
          id?: string
          organization_id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
          warehouse_bling_id?: string | null
          warehouse_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
      audit_log_view: {
        Row: {
          action: string | null
          after_state: Json | null
          before_state: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          ip_address: string | null
          occurred_at: string | null
          organization_id: string | null
          prev_hash: string | null
          row_hash: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          after_state?: Json | null
          before_state?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          ip_address?: never
          occurred_at?: string | null
          organization_id?: string | null
          prev_hash?: string | null
          row_hash?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          after_state?: Json | null
          before_state?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          ip_address?: never
          occurred_at?: string | null
          organization_id?: string | null
          prev_hash?: string | null
          row_hash?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bling_connection_status: {
        Row: {
          active: boolean | null
          connected_at: string | null
          expires_at: string | null
          last_refresh_at: string | null
          organization_id: string | null
          scope: string | null
        }
        Insert: {
          active?: boolean | null
          connected_at?: string | null
          expires_at?: string | null
          last_refresh_at?: string | null
          organization_id?: string | null
          scope?: string | null
        }
        Update: {
          active?: boolean | null
          connected_at?: string | null
          expires_at?: string | null
          last_refresh_at?: string | null
          organization_id?: string | null
          scope?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bling_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gemini_connection_status: {
        Row: {
          active: boolean | null
          connected_at: string | null
          connected_by: string | null
          id: string | null
          last_validated_at: string | null
          last_validation_error: string | null
          last_validation_status: string | null
          model: string | null
        }
        Insert: {
          active?: boolean | null
          connected_at?: string | null
          connected_by?: string | null
          id?: string | null
          last_validated_at?: string | null
          last_validation_error?: string | null
          last_validation_status?: string | null
          model?: string | null
        }
        Update: {
          active?: boolean | null
          connected_at?: string | null
          connected_by?: string | null
          id?: string | null
          last_validated_at?: string | null
          last_validation_error?: string | null
          last_validation_status?: string | null
          model?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_supplier_invitation: {
        Args: { p_code: string }
        Returns: {
          legal_name: string
          supplier_id: string
        }[]
      }
      bling_acquire_refresh_lock: {
        Args: { p_organization_id: string; p_ttl_seconds?: number }
        Returns: boolean
      }
      bling_release_refresh_lock: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      calc_required_approval_level: {
        Args: { p_payable_id: string }
        Returns: string
      }
      check_rate_limit: {
        Args: {
          p_bucket_key: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: Json
      }
      claim_idempotency_key: {
        Args: {
          p_endpoint: string
          p_key: string
          p_ttl_seconds?: number
          p_user_id: string
        }
        Returns: Json
      }
      create_bling_credentials: {
        Args: {
          p_access_token: string
          p_client_id: string
          p_client_secret: string
          p_connected_by?: string
          p_encryption_key: string
          p_expires_in_seconds: number
          p_organization_id: string
          p_refresh_token: string
          p_scope?: string
        }
        Returns: string
      }
      create_supplier_invitation: {
        Args: { p_email: string; p_supplier_id: string }
        Returns: {
          code: string
          expires_at: string
          invitation_id: string
        }[]
      }
      current_user_role: { Args: never; Returns: string }
      deactivate_gemini_credentials: { Args: never; Returns: undefined }
      decrypt_bank_field: { Args: { p_ciphertext: string }; Returns: string }
      decrypt_bling_credentials: {
        Args: { p_encryption_key: string; p_organization_id: string }
        Returns: {
          access_token: string
          client_id: string
          client_secret: string
          expires_at: string
          refresh_token: string
        }[]
      }
      decrypt_gemini_credentials: {
        Args: { p_encryption_key: string }
        Returns: {
          api_key: string
          model: string
        }[]
      }
      encrypt_bank_field: { Args: { p_plaintext: string }; Returns: string }
      generate_invitation_code: { Args: never; Returns: string }
      hash_bank_field: { Args: { p_plaintext: string }; Returns: string }
      hash_invitation_code: { Args: { p_code: string }; Returns: string }
      revoke_supplier_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      save_bling_tokens: {
        Args: {
          p_access_token: string
          p_encryption_key: string
          p_expires_in_seconds: number
          p_organization_id: string
          p_refresh_token: string
          p_scope?: string
        }
        Returns: undefined
      }
      save_gemini_credentials: {
        Args: {
          p_api_key: string
          p_connected_by?: string
          p_encryption_key: string
          p_model: string
          p_validation_error?: string
          p_validation_status: string
        }
        Returns: string
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      store_idempotency_response: {
        Args: {
          p_key: string
          p_response_body: Json
          p_response_status: number
        }
        Returns: undefined
      }
      update_supplier_bank_details: {
        Args: {
          p_account_digit?: string
          p_account_holder_doc?: string
          p_account_holder_name?: string
          p_account_number?: string
          p_agency?: string
          p_bank_code?: string
          p_changed_by_role: string
          p_encryption_key: string
          p_ip_address?: unknown
          p_pix_key?: string
          p_pix_key_type?: string
          p_reason: string
          p_supplier_id: string
          p_user_agent?: string
        }
        Returns: {
          change_log_id: string
          changed_to_new_account: boolean
          effective_at: string
          new_bank_details_id: string
        }[]
      }
      user_has_org_access: { Args: { p_org_id: string }; Returns: boolean }
      user_has_org_access_recursive: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      user_has_role: { Args: { p_roles: string[] }; Returns: boolean }
      verify_audit_hash_chain: {
        Args: never
        Returns: {
          chain_intact: boolean
          first_tamper_at: string
          first_tamper_id: string
          tampered_rows: number
          total_rows: number
          verified_rows: number
        }[]
      }
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
  public: {
    Enums: {},
  },
} as const
