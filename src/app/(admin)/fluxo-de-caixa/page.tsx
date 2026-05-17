import type { Metadata } from 'next';
import { ComingSoon, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Fluxo de caixa' };

export default function FluxoDeCaixaPage() {
  return (
    <div className="container-page max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Financeiro · Operação"
        title="Fluxo de caixa"
        description="Posição realizada e projetada — saldo presente, entradas e saídas futuras."
      />
      <ComingSoon
        sprint="Sprint 8-B"
        features={[
          'Saldo atual consolidado por conta bancária e por filial',
          'Projeção diária 30/60/90 dias (CAP a pagar + CR a receber)',
          'Gráfico de evolução do caixa com marcas dos vencimentos críticos',
          'Cenários: ideal (realiza tudo) vs pessimista (atrasos típicos)',
          'Alerta de risco de saldo negativo X dias à frente',
          'Reserva por centro de custo (segregação operacional)',
        ]}
      />
    </div>
  );
}
