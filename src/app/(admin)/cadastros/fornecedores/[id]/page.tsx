import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatDocument, formatDateTime } from '@/lib/format';
import { EditarFornecedorForm } from './EditarFornecedorForm';

export const metadata: Metadata = { title: 'Fornecedor' };

type Params = { id: string };

export default async function FornecedorDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: supplier } = await supabase
    .from('business_partners')
    .select(
      'id, document_type, document, legal_name, trade_name, email, phone, address, default_payment_terms, status, uses_supplier_portal, receita_data, receita_synced_at, notes, created_at, updated_at',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!supplier) return notFound();

  const { data: bankDetails } = await supabase
    .from('supplier_bank_details')
    .select(
      'id, pix_key_type, pix_key_hash, bank_code, agency, account_hash, account_holder_name, account_holder_doc, is_active, verified_at, created_at',
    )
    .eq('supplier_id', supplier.id)
    .is('deleted_at', null)
    .eq('is_active', true)
    .maybeSingle();

  const { data: lastChange } = await supabase
    .from('supplier_bank_change_log')
    .select('id, change_type, effective_at, changed_to_new_account, occurred_at, changed_by_role, reason')
    .eq('supplier_id', supplier.id)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const address = supplier.address as Record<string, string | null> | null;

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <nav className="text-xs text-neutral-500 mb-1">
          <Link href="/cadastros/fornecedores" className="hover:text-maxfem-pink">
            Fornecedores
          </Link>{' '}
          · <span>{supplier.legal_name}</span>
        </nav>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-maxfem-ink">
              {supplier.legal_name}
            </h1>
            {supplier.trade_name && (
              <p className="text-sm text-neutral-600 mt-0.5">{supplier.trade_name}</p>
            )}
          </div>
          <StatusBadge status={supplier.status} />
        </div>
      </header>

      {/* Cabeçalho: documento + Receita snapshot */}
      <section className="bg-white border border-neutral-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Documento e situação</h2>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Field label="Documento">
            <span className="font-mono">
              {formatDocument(supplier.document, supplier.document_type as 'cnpj' | 'cpf' | 'foreign')}
            </span>
          </Field>
          <Field label="Tipo">
            {supplier.document_type === 'cnpj' ? 'CNPJ' : supplier.document_type === 'cpf' ? 'CPF' : 'Exterior'}
          </Field>
          {supplier.receita_data ? (
            <>
              <Field label="Situação cadastral">
                {(supplier.receita_data as Record<string, unknown>)?.descricao_situacao_cadastral as string ?? '—'}
              </Field>
              <Field label="CNAE principal">
                {(supplier.receita_data as Record<string, unknown>)?.cnae_fiscal_descricao as string ?? '—'}
              </Field>
            </>
          ) : (
            <Field label="Snapshot Receita">
              <span className="text-neutral-400 italic">não sincronizado</span>
            </Field>
          )}
          {supplier.receita_synced_at && (
            <Field label="Última sincronização">{formatDateTime(supplier.receita_synced_at)}</Field>
          )}
        </dl>
        {address && Object.values(address).some((v) => v) && (
          <p className="mt-3 text-sm text-neutral-700">
            <strong>Endereço:</strong>{' '}
            {[address.logradouro, address.numero, address.complemento, address.bairro, address.cidade, address.uf, address.cep]
              .filter(Boolean)
              .join(', ')}
          </p>
        )}
      </section>

      {/* Edição de campos não-críticos */}
      <section className="bg-white border border-neutral-200 rounded-lg p-5">
        <header className="mb-4">
          <h2 className="text-sm font-semibold text-maxfem-ink">Dados de contato e prazo</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Razão social, CNPJ e status são bloqueados por política. Mudança de dados bancários
            tem fluxo próprio com cooldown 24h.
          </p>
        </header>
        <EditarFornecedorForm
          supplier={{
            id: supplier.id,
            trade_name: supplier.trade_name,
            email: supplier.email,
            phone: supplier.phone,
            default_payment_terms: supplier.default_payment_terms,
            notes: supplier.notes,
          }}
        />
      </section>

      {/* Dados bancários (read-only nesta sprint; flow de update em seguida) */}
      <section className="bg-white border border-neutral-200 rounded-lg p-5">
        <header className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-maxfem-ink">Dados bancários</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Dados criptografados em repouso (pgcrypto). Hash determinístico permite detectar
              duplicidades sem decriptar.
            </p>
          </div>
        </header>

        {!bankDetails ? (
          <p className="text-sm text-neutral-500 italic">
            Nenhum dado bancário cadastrado ainda. {' '}
            <span className="text-neutral-400">(Update flow com cooldown 24h vem no próximo deploy.)</span>
          </p>
        ) : (
          <>
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {bankDetails.pix_key_type && (
                <Field label="Chave PIX">
                  <span className="text-xs text-neutral-600">
                    Tipo: <strong>{bankDetails.pix_key_type.toUpperCase()}</strong>
                  </span>
                  <span className="block text-xs text-neutral-400 font-mono mt-1">
                    hash: {bankDetails.pix_key_hash?.slice(0, 16)}…
                  </span>
                </Field>
              )}
              {bankDetails.bank_code && (
                <Field label="Conta TED">
                  <span className="block text-xs text-neutral-600">
                    {bankDetails.bank_code} · ag {bankDetails.agency}
                  </span>
                  <span className="block text-xs text-neutral-400 font-mono mt-1">
                    hash: {bankDetails.account_hash?.slice(0, 16)}…
                  </span>
                </Field>
              )}
              {bankDetails.account_holder_name && (
                <Field label="Titular">{bankDetails.account_holder_name}</Field>
              )}
              <Field label="Cadastrada em">{formatDateTime(bankDetails.created_at)}</Field>
              <Field label="Verificada em">
                {bankDetails.verified_at ? formatDateTime(bankDetails.verified_at) : <span className="text-amber-700">aguardando verificação</span>}
              </Field>
            </dl>

            {lastChange && (
              <div className="mt-4 pt-3 border-t border-neutral-100 text-xs text-neutral-600">
                <p>
                  <strong>Última alteração:</strong> {formatDateTime(lastChange.occurred_at)} por{' '}
                  <code className="text-xs">{lastChange.changed_by_role}</code>
                  {lastChange.changed_to_new_account && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800">
                      conta nova
                    </span>
                  )}
                </p>
                {new Date(lastChange.effective_at).getTime() > Date.now() && (
                  <p className="mt-1 text-amber-700">
                    Cooldown ativo até {formatDateTime(lastChange.effective_at)} —
                    pagamentos pra este fornecedor não podem usar os dados novos antes disso.
                  </p>
                )}
                {lastChange.reason && <p className="mt-1">Motivo: {lastChange.reason}</p>}
              </div>
            )}
          </>
        )}
      </section>

      {/* Metadata */}
      <footer className="text-xs text-neutral-500 space-y-0.5">
        <p>Cadastrado em {formatDateTime(supplier.created_at)}</p>
        <p>Última atualização {formatDateTime(supplier.updated_at)}</p>
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500 uppercase tracking-wider">{label}</dt>
      <dd className="text-sm text-maxfem-ink mt-0.5">{children}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    invited: 'bg-amber-100 text-amber-800',
    pending_first_login: 'bg-amber-100 text-amber-800',
    active: 'bg-green-100 text-green-800',
    suspended: 'bg-rose-100 text-rose-800',
    blocked: 'bg-rose-100 text-rose-800',
  };
  const labels: Record<string, string> = {
    invited: 'Convidado',
    pending_first_login: 'Aguardando',
    active: 'Ativo',
    suspended: 'Suspenso',
    blocked: 'Bloqueado',
  };
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${styles[status] ?? 'bg-neutral-100 text-neutral-700'}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

// Importar Cell helper duplicado removido — versão local acima
