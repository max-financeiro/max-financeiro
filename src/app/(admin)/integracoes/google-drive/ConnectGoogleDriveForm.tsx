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
    if (!clientId || !clientSecret || !folderId) return;
    const params = new URLSearchParams({
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      folder_id: folderId,
    });
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
        <label className="form-label">Pasta raiz no Drive *</label>
        <input
          type="text"
          required
          value={folderInput}
          onChange={(e) => setFolderInput(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/1yZBC... ou só o ID"
          className="input-field"
        />
        <p className="form-hint">
          Cole a URL inteira ou só o ID. Detectamos automaticamente. Pastas YYYY/MM
          serão criadas aqui dentro sob demanda.
        </p>
        {folderInput && !folderId && (
          <p className="text-caption text-rose-700 mt-1">
            ID não detectado. Cole a URL completa ou um ID de 20+ chars alfanuméricos.
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="submit"
          variant="pink"
          disabled={!clientId || !clientSecret || !folderId}
        >
          Conectar com Google
        </Button>
      </div>
    </form>
  );
}
