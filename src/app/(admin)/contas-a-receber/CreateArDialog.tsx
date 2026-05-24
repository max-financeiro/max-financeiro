'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createArAction, type ActionState } from './actions';

export function CreateArDialog({
  empresas,
  customers,
}: {
  empresas: Array<{ id: string; label: string }>;
  customers: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const dueDefault = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r: ActionState = await createArAction(null, fd);
      if (r?.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(r?.error ?? 'Erro desconhecido');
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:opacity-90"
      >
        + Nova conta a receber
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="bg-white rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto p-6">
            <header className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-semibold text-maxfem-ink">
                Nova conta a receber
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-neutral-500 hover:text-neutral-700 text-xl leading-none"
                aria-label="Fechar"
              >
                ×
              </button>
            </header>

            <form onSubmit={onSubmit} className="space-y-3">
              <Field label="Empresa (filial Maxfem)" required>
                <select name="organization_id" required defaultValue="" className="input-field">
                  <option value="" disabled>
                    Selecionar...
                  </option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Cliente" hint="opcional — pode ser preenchido depois">
                <select name="customer_id" defaultValue="" className="input-field">
                  <option value="">— sem cliente vinculado —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Valor (R$)" required>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    name="amount"
                    required
                    placeholder="0,00"
                    className="input-field"
                  />
                </Field>
                <Field label="Forma de recebimento">
                  <select name="receive_method" defaultValue="" className="input-field">
                    <option value="">—</option>
                    <option value="pix">PIX</option>
                    <option value="ted">TED</option>
                    <option value="boleto">Boleto</option>
                    <option value="credit_card">Cartão</option>
                    <option value="cash">Dinheiro</option>
                    <option value="transfer">Transferência</option>
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Data de emissão" required>
                  <input type="date" name="issue_date" required defaultValue={today} className="input-field" />
                </Field>
                <Field label="Vencimento" required>
                  <input type="date" name="due_date" required defaultValue={dueDefault} className="input-field" />
                </Field>
              </div>

              <Field label="Descrição">
                <input
                  type="text"
                  name="description"
                  maxLength={500}
                  placeholder="ex: Lote de vendas Yampi 24/05"
                  className="input-field"
                />
              </Field>

              <Field label="Observações">
                <textarea name="notes" rows={2} maxLength={2000} className="input-field" />
              </Field>

              {error && (
                <div className="bg-rose-50 border border-rose-200 rounded p-2 text-sm text-rose-800">
                  {error}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={pending}
                  className="flex-1 bg-maxfem-pink text-white px-4 py-2 rounded-md font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? 'Criando...' : 'Criar conta a receber'}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 rounded-md border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-neutral-700 mb-1">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-neutral-500 font-normal ml-1">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}
