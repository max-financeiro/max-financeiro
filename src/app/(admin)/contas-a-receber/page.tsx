import type { Metadata } from 'next';
import { ComingSoon, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Contas a receber' };

export default function ContasAReceberPage() {
  return (
    <div className="container-page max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Financeiro · Operação"
        title="Contas a receber"
        description="CR: notas emitidas, prazos de recebimento, baixa contra extrato e provisão."
      />
      <ComingSoon
        sprint="Sprint 8"
        features={[
          'Listagem de CR com filtros (status, vencimento, cliente)',
          'Criação manual + importação por XML NF-e de saída',
          'Aging por cliente (vencidos / a vencer 7d / 30d / 60d+)',
          'Baixa automática ao bater com crédito no extrato bancário',
          'Cobrança automatizada via Resend (1ª lembrança 5d antes, vencimento, +7d, +15d)',
          'Régua de cobrança configurável por cliente',
          'Exportação pra contabilidade (mesma estrutura SPED da CAP)',
        ]}
      />
    </div>
  );
}
