'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Select client component: muda `?org=` na URL preservando outros params.
 * Auto-submit via router.push.
 */
export function OrgFilterSelect({
  orgs,
  currentOrgId,
  basePath,
}: {
  orgs: Array<{ id: string; label: string }>;
  currentOrgId: string | null;
  basePath: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = new URLSearchParams(searchParams.toString());
    if (e.target.value === 'all') {
      next.delete('org');
    } else {
      next.set('org', e.target.value);
    }
    const url = `${pathname || basePath}?${next.toString()}`;
    startTransition(() => router.push(url));
  }

  return (
    <div>
      <label className="block text-xs uppercase text-neutral-500 mb-1">Empresa</label>
      <select
        defaultValue={currentOrgId ?? 'all'}
        onChange={onChange}
        disabled={pending}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none disabled:opacity-50"
      >
        <option value="all">Todas (consolidado)</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
