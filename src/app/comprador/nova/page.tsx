import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createBuyerRequestAction } from './actions';

const CATEGORIAS_DEFAULT = [
  'Insumos',
  'Embalagens',
  'Marketing',
  'Tráfego',
  'Serviços de TI',
  'Infraestrutura',
  'Logística',
  'Manutenção',
  'Outros',
];

export default async function NovaSolicitacaoPage() {
  const supabase = await createClient();

  const [{ data: orgs }, { data: suppliers }] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, legal_name, trade_name, type')
      .is('deleted_at', null)
      .order('legal_name'),
    supabase
      .from('business_partners')
      .select('id, legal_name, trade_name')
      .in('partner_type', ['supplier', 'both'])
      .is('deleted_at', null)
      .order('legal_name')
      .limit(500),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const default30d = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <header>
        <nav className="text-xs text-neutral-500 mb-1">
          <Link href="/comprador" className="hover:text-maxfem-pink">
            Minhas solicitações
          </Link>{' '}
          · <span>Nova</span>
        </nav>
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Nova solicitação</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Preencha os dados. O financeiro vai classificar e aprovar.
        </p>
      </header>

      <form action={createBuyerRequestAction} className="space-y-6 bg-white border border-neutral-200 rounded-lg p-6">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Empresa / filial" required>
            <select
              name="organization_id"
              required
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            >
              <option value="">— escolha —</option>
              {(orgs ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.trade_name ?? o.legal_name} {o.type !== 'group' ? `(${o.type})` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Fornecedor" required>
            <select
              name="supplier_id"
              required
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            >
              <option value="">— escolha —</option>
              {(suppliers ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.trade_name ?? s.legal_name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Valor (R$)" required>
            <input
              type="number"
              name="amount"
              step="0.01"
              min="0.01"
              required
              placeholder="0,00"
              className="w-full font-mono rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            />
          </Field>

          <Field label="Forma de pagamento" required>
            <select
              name="payment_method"
              defaultValue="pix"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            >
              <option value="pix">PIX</option>
              <option value="ted">TED</option>
              <option value="boleto">Boleto</option>
              <option value="transfer">Transferência</option>
              <option value="cash">Dinheiro</option>
            </select>
          </Field>

          <Field label="Vencimento" required>
            <input
              type="date"
              name="due_date"
              required
              defaultValue={default30d}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            />
          </Field>

          <Field label="Emissão">
            <input
              type="date"
              name="issue_date"
              defaultValue={today}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            />
          </Field>

          <Field label="Competência (qual mês imputar)">
            <input
              type="date"
              name="competence_date"
              defaultValue={today}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            />
          </Field>

          <Field label="Categoria (sugestão pro financeiro)">
            <input
              list="categorias"
              name="category"
              placeholder="ex: Insumos, Marketing..."
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            />
            <datalist id="categorias">
              {CATEGORIAS_DEFAULT.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>

        <Field label="Descrição da compra" required>
          <textarea
            name="description"
            required
            rows={3}
            placeholder="Descreva o que está sendo comprado e pra quê"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
          />
        </Field>

        <div className="flex items-center justify-between gap-3 pt-4 border-t border-neutral-200">
          <Link
            href="/comprador"
            className="text-sm text-neutral-600 hover:text-maxfem-pink"
          >
            Cancelar
          </Link>
          <div className="flex gap-2">
            <button
              type="submit"
              name="submit"
              value="0"
              className="px-4 py-2 rounded-md border border-neutral-300 text-sm font-medium hover:bg-neutral-50"
            >
              Salvar rascunho
            </button>
            <button
              type="submit"
              name="submit"
              value="1"
              className="px-4 py-2 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:bg-pink-600"
            >
              Enviar pro financeiro
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs uppercase text-neutral-500 mb-1">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}
