'use client';

import { useTransition, useState } from 'react';
import { Button } from '@/components/ui';
import { disconnectGoogleDriveAction } from './actions';

export function DisconnectGoogleDriveButton() {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handle() {
    if (!confirm('Desconectar Google Drive? Backups param até reconectar.')) return;
    setErr(null);
    startTransition(async () => {
      const r = await disconnectGoogleDriveAction();
      if (r?.ok === false) setErr(r.error);
    });
  }

  return (
    <div className="text-right">
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={handle}>
        {pending ? 'Desconectando…' : 'Desconectar'}
      </Button>
      {err && <p className="text-caption text-danger-700 mt-2 max-w-xs">{err}</p>}
    </div>
  );
}
