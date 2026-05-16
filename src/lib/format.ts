/**
 * Helpers de formatação PT-BR.
 */

export function formatCNPJ(doc: string | null | undefined): string {
  if (!doc) return '—';
  const d = doc.replace(/\D/g, '');
  if (d.length !== 14) return doc;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatCPF(doc: string | null | undefined): string {
  if (!doc) return '—';
  const d = doc.replace(/\D/g, '');
  if (d.length !== 11) return doc;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatDocument(
  doc: string | null | undefined,
  type: 'cnpj' | 'cpf' | 'foreign' | null | undefined,
): string {
  if (!doc) return '—';
  if (type === 'cnpj') return formatCNPJ(doc);
  if (type === 'cpf') return formatCPF(doc);
  return doc;
}

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTime(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
