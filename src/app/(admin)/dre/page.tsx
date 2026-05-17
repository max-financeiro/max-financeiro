import type { Metadata } from 'next';
import { ComingSoon, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'DRE gerencial' };

export default function DRePage() {
  return (
    <div className="container-page max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Relatórios"
        title="DRE gerencial"
        description="Demonstração de Resultado do Exercício — visão gerencial por competência."
      />
      <ComingSoon
        sprint="Sprint 9"
        features={[
          'DRE comparativo mês a mês (último ano)',
          'DRE por filial e por centro de custo',
          'Resultado bruto, operacional, financeiro e líquido',
          'Drilldown de cada linha → CAPs/CRs que compõem o valor',
          'Exportação Excel/CSV com formato pronto pra contador',
          'Comparação real vs orçado (quando módulo de planejamento entrar)',
        ]}
      />
    </div>
  );
}
