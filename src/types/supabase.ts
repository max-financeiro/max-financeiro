/**
 * Tipos gerados do Supabase.
 *
 * Regenerar com:
 *   npm run db:types
 *
 * (executa `supabase gen types typescript --linked`)
 *
 * Este arquivo NUNCA deve ser editado à mão — só gerado.
 * Placeholder aqui até linkar o projeto local com `supabase link --project-ref aizoevovzuvrcvntpzft`
 * e rodar `npm run db:types`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          parent_id: string | null;
          type: 'group' | 'company' | 'branch';
          legal_name: string;
          trade_name: string | null;
          cnpj: string | null;
          state_registration: string | null;
          municipal_registration: string | null;
          address: Json | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          parent_id?: string | null;
          type: 'group' | 'company' | 'branch';
          legal_name: string;
          trade_name?: string | null;
          cnpj?: string | null;
          state_registration?: string | null;
          municipal_registration?: string | null;
          address?: Json | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['organizations']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'organizations_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      user_profiles: {
        Row: {
          user_id: string;
          full_name: string;
          role: 'master' | 'financial_manager' | 'financial_analyst' | 'accountant_readonly' | 'supplier';
          phone: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          user_id: string;
          full_name: string;
          role: 'master' | 'financial_manager' | 'financial_analyst' | 'accountant_readonly' | 'supplier';
          phone?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['user_profiles']['Insert']>;
        Relationships: [];
      };
      user_org_access: {
        Row: {
          user_id: string;
          organization_id: string;
          permissions: Json;
          granted_by: string | null;
          granted_at: string;
          revoked_at: string | null;
        };
        Insert: {
          user_id: string;
          organization_id: string;
          permissions?: Json;
          granted_by?: string | null;
          granted_at?: string;
          revoked_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['user_org_access']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      user_has_org_access: {
        Args: { p_org_id: string };
        Returns: boolean;
      };
      user_has_org_access_recursive: {
        Args: { p_org_id: string };
        Returns: boolean;
      };
      current_user_role: {
        Args: Record<string, never>;
        Returns: string;
      };
      user_has_role: {
        Args: { p_roles: string[] };
        Returns: boolean;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
