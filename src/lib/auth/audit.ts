/**
 * Helper pra inserir entrada no audit log a partir de Server Actions / Route Handlers.
 *
 * Usa a função `audit.log_event` no Postgres que automaticamente:
 *  - Lê auth.uid() da sessão atual
 *  - Calcula prev_hash da última linha
 *  - Calcula row_hash SHA256 desta linha (hash chain WORM)
 *
 * Toda ação sensível deve chamar isto. Falhas são logadas mas NÃO bloqueiam
 * a operação principal (audit é best-effort do ponto de vista do user; do
 * ponto de vista de compliance é critical mas a tabela é resiliente).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
// SERVICE_ROLE: audit.log_event é restrito a service_role (P2-05) — o client
// do usuário não pode mais chamá-lo. O id da sessão é repassado como
// p_user_id pra preservar a atribuição do evento.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';

export type AuditEvent = {
  action: string; // 'login.success', 'payment.requested', 'supplier.bank_changed', ...
  entityType: string; // 'auth.users', 'accounts_payable', 'supplier_bank_details', ...
  entityId?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  organizationId?: string;
};

// Tipo permissivo — funções utilitárias aceitam qualquer SupabaseClient
// independente da Database genérica.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

export async function logAuditEvent(supabase: AnySupabase, event: AuditEvent): Promise<void> {
  try {
    const headersList = await headers();
    // Prefere headers do edge (não falsificáveis pelo cliente). XFF cru só é
    // confiável atrás de proxy reverso — fica como último fallback.
    const ip =
      headersList.get('cf-connecting-ip') ??
      headersList.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ??
      headersList.get('x-real-ip') ??
      headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      undefined;
    const userAgent = headersList.get('user-agent') ?? undefined;

    // Atribuição: id da sessão do usuário (service_role não tem auth.uid()).
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await (getAdminClient() as unknown as AnySupabase).schema('audit').rpc('log_event', {
      p_action: event.action,
      p_entity_type: event.entityType,
      p_entity_id: event.entityId,
      p_before_state: event.beforeState,
      p_after_state: event.afterState,
      p_organization_id: event.organizationId,
      p_ip_address: ip,
      p_user_agent: userAgent,
      p_user_id: user?.id ?? null,
    });
  } catch (err) {
    // Não bloqueia o fluxo principal — só loga
    console.error('[audit] Falha ao registrar evento:', err);
  }
}
