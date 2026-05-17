'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { updateBankDetails, type State } from './actions';

const UI_VERSION = 'portal-bank-v1-2026-05-17';

export default function DadosBancariosPage() {
  const [state, formAction] = useActionState<State, FormData>(updateBankDetails, null);
  const [pending, startTransition] = useTransition();

  const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null);
  const [lastChangeDate, setLastChangeDate] = useState<Date | null>(null);

  // Form controlado (evita reset em re-render após Server Action)
  const [pixKeyType, setPixKeyType] = useState<'cpf' | 'cnpj' | 'email' | 'phone' | 'random' | ''>('');
  const [pixKey, setPixKey] = useState('');
  const [holderName, setHolderName] = useState('');
  const [holderDoc, setHolderDoc] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    const fetchLastChange = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: supplier } = await supabase
        .from('business_partners')
        .select('legal_name, bank_details_last_changed_at')
        .eq('supplier_user_id', user.id)
        .maybeSingle();

      if (supplier?.legal_name) setHolderName(supplier.legal_name);

      if (supplier?.bank_details_last_changed_at) {
        const lastChange = new Date(supplier.bank_details_last_changed_at);
        setLastChangeDate(lastChange);
        const diffHours = (Date.now() - lastChange.getTime()) / 3_600_000;
        const remaining = Math.max(0, 24 - diffHours);
        if (remaining > 0) setCooldownRemaining(Math.ceil(remaining));
      }
    };
    void fetchLastChange();
  }, []);

  const blocked = cooldownRemaining !== null && cooldownRemaining > 0;
  const isError = state && state.ok === false;
  const isSuccess = state && state.ok === true;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-pink-600 mb-2">Dados Bancários</h1>
      <p className="text-xs text-neutral-400 font-mono mb-6">UI: {UI_VERSION}</p>

      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg mb-6">
        <p className="font-medium">Segurança anti-fraude</p>
        <p className="text-sm mt-1">
          Mudanças em dados bancários levam 24h para serem aplicadas. Você receberá um email de
          confirmação antes da efetivação.
        </p>
        {blocked && (
          <p className="text-sm mt-2 font-medium">
            Você poderá alterar novamente em ~{cooldownRemaining} hora(s).
          </p>
        )}
        {lastChangeDate && (
          <p className="text-xs mt-1 text-yellow-700">
            Última alteração: {lastChangeDate.toLocaleString('pt-BR')}
          </p>
        )}
      </div>

      {isSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6">
          <p className="font-medium">Solicitação registrada.</p>
          <p className="text-sm mt-1">A nova chave será efetivada em 24h.</p>
        </div>
      )}

      {isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          <p className="font-medium">Não foi possível salvar</p>
          <p className="text-sm mt-1">{state.error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <fieldset disabled={blocked || pending} className="space-y-5">
          <div>
            <label htmlFor="account_holder_name" className="block text-sm font-medium text-neutral-700 mb-1">
              Titular da conta *
            </label>
            <input
              id="account_holder_name"
              name="account_holder_name"
              type="text"
              required
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-4 py-2"
            />
            <p className="text-xs text-neutral-500 mt-1">
              Deve ser o mesmo nome/razão social do fornecedor.
            </p>
          </div>

          <div>
            <label htmlFor="account_holder_doc" className="block text-sm font-medium text-neutral-700 mb-1">
              CPF/CNPJ do titular *
            </label>
            <input
              id="account_holder_doc"
              name="account_holder_doc"
              type="text"
              required
              value={holderDoc}
              onChange={(e) => setHolderDoc(e.target.value.replace(/\D/g, ''))}
              maxLength={14}
              placeholder="Apenas dígitos"
              className="w-full border border-neutral-300 rounded-lg px-4 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="pix_key_type" className="block text-sm font-medium text-neutral-700 mb-1">
                Tipo de chave PIX *
              </label>
              <select
                id="pix_key_type"
                name="pix_key_type"
                required
                value={pixKeyType}
                onChange={(e) => setPixKeyType(e.target.value as typeof pixKeyType)}
                className="w-full border border-neutral-300 rounded-lg px-4 py-2"
              >
                <option value="">Selecione...</option>
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">Email</option>
                <option value="phone">Celular</option>
                <option value="random">Aleatória</option>
              </select>
            </div>
            <div>
              <label htmlFor="pix_key" className="block text-sm font-medium text-neutral-700 mb-1">
                Chave PIX *
              </label>
              <input
                id="pix_key"
                name="pix_key"
                type="text"
                required
                value={pixKey}
                onChange={(e) => setPixKey(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg px-4 py-2"
              />
            </div>
          </div>

          <div>
            <label htmlFor="reason" className="block text-sm font-medium text-neutral-700 mb-1">
              Motivo da alteração *
            </label>
            <textarea
              id="reason"
              name="reason"
              required
              minLength={8}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: mudança de banco, encerramento de conta antiga..."
              className="w-full border border-neutral-300 rounded-lg px-4 py-2"
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-pink-600 text-white px-4 py-3 rounded-lg hover:bg-pink-700 disabled:opacity-50 transition-colors font-medium"
          >
            {pending ? 'Enviando...' : 'Solicitar alteração'}
          </button>
        </fieldset>
      </form>
    </div>
  );
}
