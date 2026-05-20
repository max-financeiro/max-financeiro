'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { connectInterAction, type ConnectState } from './actions';

export function ConnectInterForm() {
  const [state, formAction] = useActionState<ConnectState, FormData>(connectInterAction, null);
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [environment, setEnvironment] = useState<'producao' | 'sandbox'>('producao');
  const [certName, setCertName] = useState('');
  const [keyName, setKeyName] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  const ready = clientId.length > 0 && clientSecret.length > 0 && !!certName && !!keyName;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="form-label">Ambiente *</label>
        <select
          name="environment"
          required
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as 'producao' | 'sandbox')}
          className="input-field"
        >
          <option value="producao">Produção</option>
          <option value="sandbox">Sandbox (testes)</option>
        </select>
      </div>

      <div>
        <label className="form-label">Client ID *</label>
        <input
          name="client_id"
          type="text"
          required
          autoComplete="off"
          placeholder="UUID do app no Inter"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="input-field font-mono"
        />
      </div>

      <div>
        <label className="form-label">Client Secret *</label>
        <div className="relative">
          <input
            name="client_secret"
            type={showSecret ? 'text' : 'password'}
            required
            autoComplete="off"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            className="input-field pr-20 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowSecret((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-caption text-ink-500 hover:text-ink-900 px-2 py-1 rounded"
          >
            {showSecret ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="form-label">Certificado mTLS (.crt) *</label>
          <input
            name="cert_file"
            type="file"
            required
            accept=".crt,.pem,.cer,application/x-x509-ca-cert,application/x-pem-file"
            onChange={(e) => setCertName(e.target.files?.[0]?.name ?? '')}
            className="input-field file:mr-3 file:rounded file:border-0 file:bg-ink-100 file:px-3 file:py-1 file:text-caption file:font-medium"
          />
          {certName && <p className="form-hint text-success-700">{certName}</p>}
        </div>
        <div>
          <label className="form-label">Chave privada (.key) *</label>
          <input
            name="key_file"
            type="file"
            required
            accept=".key,.pem,application/x-pem-file,application/pkcs8"
            onChange={(e) => setKeyName(e.target.files?.[0]?.name ?? '')}
            className="input-field file:mr-3 file:rounded file:border-0 file:bg-ink-100 file:px-3 file:py-1 file:text-caption file:font-medium"
          />
          {keyName && <p className="form-hint text-success-700">{keyName}</p>}
        </div>
      </div>
      <p className="form-hint">
        Os arquivos do certificado mTLS são gerados no Internet Banking PJ do Inter, em
        Configurações → API. Ficam criptografados (pgcrypto) — nunca saem do servidor.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="form-label">Conta corrente</label>
          <input
            name="conta_corrente"
            type="text"
            autoComplete="off"
            placeholder="Opcional — só pra multi-conta"
            className="input-field font-mono"
          />
        </div>
        <div>
          <label className="form-label">Nome amigável da conta</label>
          <input
            name="account_name"
            type="text"
            autoComplete="off"
            placeholder="Ex: Inter PJ Matriz"
            className="input-field"
          />
        </div>
      </div>

      {state?.ok === false && (
        <div className="rounded-lg border border-danger-100 bg-danger-50 px-4 py-3">
          <p className="text-body-sm font-medium text-danger-900">Falha na validação</p>
          <p className="text-caption text-danger-700 mt-1">{state.error}</p>
        </div>
      )}

      {state?.ok === true && (
        <div className="rounded-lg border border-success-100 bg-success-50 px-4 py-3 space-y-1">
          <p className="text-body-sm font-medium text-success-900">{state.message}</p>
          {typeof state.balance === 'number' && (
            <p className="text-caption text-success-700">
              Saldo disponível:{' '}
              {state.balance.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          )}
          <p className="text-caption text-success-700">
            Webhook:{' '}
            {state.webhookRegistered ? 'registrado no Inter.' : 'não registrado ainda.'}
          </p>
          {state.webhookNote && (
            <p className="text-caption text-warning-700">{state.webhookNote}</p>
          )}
          <p className="text-micro text-success-700/80 font-mono break-all">{state.webhookUrl}</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="submit" variant="pink" disabled={pending || !ready}>
          {pending ? 'Validando com o Inter...' : 'Validar e conectar'}
        </Button>
      </div>
    </form>
  );
}
