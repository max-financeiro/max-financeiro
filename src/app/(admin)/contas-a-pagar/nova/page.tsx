import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatDocument } from '@/lib/format';
import { NovaCAPForm } from './NovaCAPForm';

export const metadata: Metadata = { title: 'Nova CAP' };

export default async function NovaCAPPage() {
  const supabase = await createClient();

  // Carrega opções pros selects em paralelo
  const [branchesRes, suppliersRes, costCentersRes, accountsRes] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, legal_name, trade_name, type')
      .eq('type', 'branch')
      .is('deleted_at', null)
      .order('legal_name'),
    supabase
      .from('business_partners')
      .select('id, legal_name, trade_name, document, document_type')
      .eq('partner_type', 'supplier')
      .in('status', ['active', 'invited', 'pending_first_login'])
      .is('deleted_at', null)
      .order('legal_name'),
    supabase
      .from('cost_centers')
      .select('id, code, name')
      .eq('active', true)
      .is('deleted_at', null)
      .order('code'),
    supabase
      .from('chart_of_accounts')
      .select('id, code, name, account_type, is_analytical')
      .eq('is_analytical', true)
      .eq('active', true)
      .is('deleted_at', null)
      .in('account_type', ['expense', 'liability'])
      .order('code'),
  ]);

  const branches = (branchesRes.data ?? []).map((b) => ({
    id: b.id,
    label: b.trade_name ?? b.legal_name,
  }));

  const suppliers = (suppliersRes.data ?? []).map((s) => ({
    id: s.id,
    label: `${s.legal_name} · ${formatDocument(s.document, s.document_type as 'cnpj' | 'cpf' | 'foreign')}`,
    subtitle: s.trade_name ?? undefined,
  }));

  const costCenters = (costCentersRes.data ?? []).map((c) => ({
    id: c.id,
    label: `${c.code} — ${c.name}`,
  }));

  const accounts = (accountsRes.data ?? []).map((a) => ({
    id: a.id,
    label: `${a.code} — ${a.name}`,
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <nav className="text-xs text-neutral-500 mb-1">
          <Link href="/contas-a-pagar" className="hover:text-maxfem-pink">
            Contas a pagar
          </Link>{' '}
          · <span>Nova</span>
        </nav>
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Nova conta a pagar</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Alçada calculada automaticamente ao salvar (valor + regras + 7 overrides anti-fraude).
          Se &ldquo;auto&rdquo;: aprovada imediato. Caso contrário: aguarda aprovação pelo gestor/master.
        </p>
      </header>

      <NovaCAPForm
        branches={branches}
        suppliers={suppliers}
        costCenters={costCenters}
        accounts={accounts}
      />
    </div>
  );
}
