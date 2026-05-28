'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { connectResendAction, type ConnectState } from './actions';

export function ConnectResendForm({ defaultTestEmail }: { defaultTestEmail: string }) {
  const [state, formAction] = useActionState<ConnectState, FormData>(connectResendAction, null);
  const [pending, startTransition] = useTransition();
  const [apiKey, setApiKey] = useState('');
  const [fromEmail, setFromEmail] = useState('Financeiro Maxfem <financeiro@financeiromaxfem.com.br>');
  const [replyTo, setReplyTo] = useState('');
  const [testEmail, setTestEmail] = useState(defaultTestEmail);
  const [showKey, setShowKey] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="form-label">API Key Resend *</label>
        <div className="relative">
          <input
            name="api_key"
            type={showKey ? 'text' : 'password'}
            required
            autoComplete="off"
            placeholder="re_..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="input-field pr-20 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-caption text-ink-500 hover:text-ink-900 px-2 py-1 rounded"
          >
            {showKey ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        <p className="form-hint">
          Pegue em{' '}
          <a
            href="https://resend.com/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-pink-700 hover:underline"
          >
            resend.com/api-keys
          </a>
          . A chave é validada com um email de teste real antes de salvar.
        </p>
      </div>

      <div>
        <label className="form-label">Email &ldquo;from&rdquo; *</label>
        <input
          name="from_email"
          type="text"
          required
          placeholder='Financeiro Maxfem <financeiro@financeiromaxfem.com.br>'
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          className="input-field"
        />
        <p className="form-hint">
          O domínio do &ldquo;from&rdquo; precisa estar verificado (DKIM + SPF) no Resend.
          Aceita formatos <code className="text-caption">email@dominio</code> ou
          {' '}<code className="text-caption">Nome &lt;email@dominio&gt;</code>.
        </p>
      </div>

      <div>
        <label className="form-label">Reply-to (opcional)</label>
        <input
          name="reply_to"
          type="email"
          placeholder="financeiro@maxfem.com.br"
          value={replyTo}
          onChange={(e) => setReplyTo(e.target.value)}
          className="input-field"
        />
        <p className="form-hint">
          Quando o destinatário responder ao email, vai pra esse endereço.
          Default: o próprio &ldquo;from&rdquo;.
        </p>
      </div>

      <div>
        <label className="form-label">Email de teste *</label>
        <input
          name="test_email"
          type="email"
          required
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          className="input-field"
        />
        <p className="form-hint">
          Vamos mandar 1 email pra esse endereço antes de salvar a credencial.
          Se não chegar (ou Resend rejeitar), nada é gravado.
        </p>
      </div>

      {state?.ok === false && (
        <div className="rounded-lg border border-danger-100 bg-danger-50 px-4 py-3">
          <p className="text-body-sm font-medium text-danger-900">Falha na validação</p>
          <p className="text-caption text-danger-700 mt-1 whitespace-pre-wrap">{state.error}</p>
        </div>
      )}

      {state?.ok === true && (
        <div className="rounded-lg border border-success-100 bg-success-50 px-4 py-3">
          <p className="text-body-sm font-medium text-success-900">✓ {state.message}</p>
          {state.testMessageId && (
            <p className="text-caption text-success-700 mt-1 font-mono">
              Resend ID: {state.testMessageId}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="submit"
          variant="pink"
          disabled={pending || !apiKey || !fromEmail || !testEmail}
        >
          {pending ? 'Testando + salvando...' : 'Testar e conectar'}
        </Button>
      </div>
    </form>
  );
}
