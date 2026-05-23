import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Portal do Fornecedor',
};

export default async function PortalHomePage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { welcome } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/portal/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, full_name')
    .eq('user_id', user.id)
    .maybeSingle();

  // Sem perfil OU perfil não-supplier: convite não foi aceito (ou usuário admin
  // entrou aqui por engano). Manda pra aceitar-convite.
  if (!profile || profile.role !== 'supplier') {
    if (profile && profile.role !== 'supplier') redirect('/dashboard');
    redirect('/portal/aceitar-convite');
  }

  // Pulse rápido do fornecedor pra mostrar na home.
  const { data: supplier } = await supabase
    .from('business_partners')
    .select('id, legal_name, document, status, bank_details_last_changed_at')
    .eq('supplier_user_id', user.id)
    .maybeSingle();

  // Resumo das NFs (4 buckets de status que aparecem no portal). A RLS já
  // restringe ao próprio fornecedor — não precisa filtro extra de issuer.
  const nfCounts = { received: 0, validated: 0, linked: 0, cancelled: 0 };
  if (supplier?.document) {
    const { data: nfs } = await supabase
      .from('fiscal_documents')
      .select('status')
      .eq('issuer_document', supplier.document);
    for (const n of nfs ?? []) {
      const s = (n as { status: string }).status;
      if (s === 'received') nfCounts.received++;
      else if (s === 'validated') nfCounts.validated++;
      else if (s === 'linked_to_payable') nfCounts.linked++;
      else if (s === 'cancelled') nfCounts.cancelled++;
    }
  }

  const firstName = (profile.full_name || supplier?.legal_name || 'Fornecedor').split(' ')[0];

  return (
    <main className="min-h-screen bg-maxfem-cream">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            href="/portal"
            className="font-display text-lg font-semibold text-maxfem-pink hover:opacity-80"
          >
            Portal Maxfem
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-700">{supplier?.legal_name ?? profile.full_name}</span>
            <form action="/auth/logout" method="POST">
              <button type="submit" className="text-neutral-600 hover:text-maxfem-pink">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {welcome && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-900">
            <strong>Acesso ativado!</strong> Você agora pode enviar notas fiscais e acompanhar o
            status dos pagamentos.
          </div>
        )}

        <header>
          <h1 className="font-display text-2xl font-semibold text-maxfem-ink">
            Bem-vindo, {firstName}
          </h1>
          <p className="text-sm text-neutral-600 mt-1">
            Tudo o que você precisa pra trabalhar com a Maxfem está aqui.
          </p>
        </header>

        {/* Resumo de NFs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Recebidas" value={nfCounts.received} hint="aguardando validação" />
          <SummaryCard label="Validadas" value={nfCounts.validated} hint="CAP gerada" tone="brand" />
          <SummaryCard label="Em pagamento" value={nfCounts.linked} hint="vinculadas a CAP" />
          <SummaryCard label="Canceladas" value={nfCounts.cancelled} hint="anuladas na SEFAZ" tone="muted" />
        </div>

        {/* Ações principais */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ActionCard
            href="/portal/nf-e/enviar"
            title="Enviar NF-e"
            desc="Faça upload do XML e do boleto (PDF) — você recebe pagamento depois da validação."
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            }
            primary
          />
          <ActionCard
            href="/portal/nf-e/lista"
            title="Minhas NFs"
            desc="Veja o que você já enviou e em que status cada nota está."
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="15" y2="17" />
              </svg>
            }
          />
          <ActionCard
            href="/portal/configuracoes/dados-bancarios"
            title="Dados bancários"
            desc="Atualize sua chave PIX ou conta. Mudanças passam por uma janela de segurança de 24h."
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="6" width="18" height="13" rx="2" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <line x1="7" y1="15" x2="11" y2="15" />
              </svg>
            }
          />
        </div>

        <footer className="pt-2 text-xs text-neutral-500">
          Suporte: <a className="text-maxfem-pink hover:underline" href="mailto:financeiro@maxfem.com.br">financeiro@maxfem.com.br</a>
        </footer>
      </section>
    </main>
  );
}

// ---------- componentes locais ----------

function SummaryCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number;
  hint: string;
  tone?: 'default' | 'brand' | 'muted';
}) {
  const num =
    tone === 'brand'
      ? 'text-maxfem-pink'
      : tone === 'muted'
        ? 'text-neutral-400'
        : 'text-maxfem-ink';
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
        {label}
      </div>
      <div className={`font-display text-2xl font-semibold mt-1 ${num}`}>{value}</div>
      <div className="text-[11px] text-neutral-500 mt-1">{hint}</div>
    </div>
  );
}

function ActionCard({
  href,
  title,
  desc,
  icon,
  primary = false,
}: {
  href: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        'group block rounded-lg border p-5 transition-all',
        primary
          ? 'bg-maxfem-pink text-white border-maxfem-pink hover:opacity-95 hover:shadow-md'
          : 'bg-white text-maxfem-ink border-neutral-200 hover:border-maxfem-pink hover:shadow-sm',
      ].join(' ')}
    >
      <div
        className={[
          'inline-flex items-center justify-center w-9 h-9 rounded-md mb-3',
          primary ? 'bg-white/15 text-white' : 'bg-maxfem-pink/10 text-maxfem-pink',
        ].join(' ')}
      >
        {icon}
      </div>
      <div className="font-display text-base font-semibold">{title}</div>
      <p
        className={[
          'text-[13px] mt-1 leading-relaxed',
          primary ? 'text-white/85' : 'text-neutral-600',
        ].join(' ')}
      >
        {desc}
      </p>
      <span
        className={[
          'inline-block mt-3 text-xs font-semibold',
          primary ? 'text-white' : 'text-maxfem-pink',
        ].join(' ')}
      >
        Abrir →
      </span>
    </Link>
  );
}
