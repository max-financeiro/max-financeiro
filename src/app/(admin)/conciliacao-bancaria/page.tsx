import type { Metadata } from 'next';
import { ComingSoon, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Conciliação bancária' };

export default function ConciliacaoPage() {
  return (
    <div className="container-page max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Caixa"
        title="Conciliação bancária"
        description="Matching entre extrato bancário e movimentações registradas no sistema."
      />
      <ComingSoon
        sprint="Sprint 7-B"
        blockedBy="Inter API (Sprint 5)"
        features={[
          'Importação automática de extrato (Inter API Open Banking)',
          'Matching determinístico: valor + data ±5d + fornecedor/cliente',
          'IA sugere matches ambíguos (Claude/Gemini analisa descrição do extrato)',
          'Fila manual pros casos sem match — analista decide',
          'Marcação de tarifas e juros como conta-corrente',
          'Reconciliação por período fechado (não permite alterar mês conciliado)',
        ]}
      />
    </div>
  );
}
