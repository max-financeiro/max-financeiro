'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { connectGeminiAction, type ConnectState } from './actions';

type Model = { value: string; label: string; description: string };

export function ConnectGeminiForm({ models }: { models: Model[] }) {
  const [state, formAction] = useActionState<ConnectState, FormData>(connectGeminiAction, null);
  const [pending, startTransition] = useTransition();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>(models[0]?.value ?? 'gemini-flash-latest');
  const [showKey, setShowKey] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="form-label">API Key *</label>
        <div className="relative">
          <input
            name="api_key"
            type={showKey ? 'text' : 'password'}
            required
            autoComplete="off"
            placeholder="AIzaSy..."
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
          A chave é validada com uma chamada real ao Gemini. Só salva se passar.
        </p>
      </div>

      <div>
        <label className="form-label">Modelo *</label>
        <select
          name="model"
          required
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="input-field"
        >
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="form-hint">
          {models.find((m) => m.value === model)?.description}
        </p>
      </div>

      {state?.ok === false && (
        <div className="rounded-lg border border-danger-100 bg-danger-50 px-4 py-3">
          <p className="text-body-sm font-medium text-danger-900">Falha na validação</p>
          <p className="text-caption text-danger-700 mt-1">{state.error}</p>
        </div>
      )}

      {state?.ok === true && (
        <div className="rounded-lg border border-success-100 bg-success-50 px-4 py-3">
          <p className="text-body-sm font-medium text-success-900">✓ {state.message}</p>
          {state.modelDisplayName && (
            <p className="text-caption text-success-700 mt-1">
              Modelo: {state.modelDisplayName}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="submit" variant="pink" disabled={pending || !apiKey}>
          {pending ? 'Validando...' : 'Validar e conectar'}
        </Button>
      </div>
    </form>
  );
}
