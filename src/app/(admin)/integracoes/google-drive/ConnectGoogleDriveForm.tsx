'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

const FOLDER_ID_REGEX = /\/folders\/([a-zA-Z0-9_-]+)/;

export function ConnectGoogleDriveForm() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [folderInput, setFolderInput] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  // Aceita URL completa OU só o ID
  const folderId = (() => {
    const m = folderInput.match(FOLDER_ID_REGEX);
    if (m && m[1]) return m[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(folderInput.trim())) return folderInput.trim();
    return '';
  })();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!clientId || !clientSecret) return;
    const params = new URLSearchParams({
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
    });
    if (folderId) params.set('folder_id', folderId);
    window.location.href = `/api/integracoes/google-drive/oauth/start?${params.toString()}`;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="form-label">OAuth Client ID *</label>
        <input
          type="text"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="123456789-abc.apps.googleusercontent.com"
          className="input-field font-mono"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="form-label">OAuth Client Secret *</label>
        <div className="relative">
          <input
            type={showSecret ? 'text' : 'password'}
            required
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="GOCSPX-..."
            className="input-field font-mono pr-20"
            autoComplete="off"
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

      <div>
        <label className="form-label">Pasta raiz no Drive (opcional)</label>
        <input
          type="text"
          value={folderInput}
          onChange={(e) => setFolderInput(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/... ou deixe em branco"
          className="input-field"
        />
        <p className="form-hint">
          Em branco: a app cria automaticamente a pasta
          {' '}<strong>&ldquo;Financeiro Maxfem · Backup NF-e&rdquo;</strong> em
          Meu Drive da conta que autorizar. Depois você pode arrastar pra onde
          quiser — IDs do Drive não quebram com move/rename.
        </p>
        {folderInput && !folderId && (
          <p className="text-caption text-amber-700 mt-1">
            ID não detectado na URL. Vou criar uma pasta nova em vez de usar essa.
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="submit" variant="pink" disabled={!clientId || !clientSecret}>
          Conectar com Google
        </Button>
      </div>
    </form>
  );
}
