import type { Metadata } from 'next';
import { ComingSoon, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Fiscal & contábil' };

export default function FiscalPage() {
  return (
    <div className="container-page max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Fiscal & contábil"
        title="Exportações e SPED"
        description="Geração dos arquivos fiscais e contábeis pro contador."
      />
      <ComingSoon
        sprint="Sprint 15+ (planejada)"
        features={[
          'SPED Fiscal (EFD-ICMS/IPI) — escrituração de NFs',
          'SPED Contribuições (EFD-Contribuições) — PIS/COFINS',
          'SPED ECD — escrituração contábil digital',
          'Exportação CSV / Excel customizado por período',
          'Layout específico Domínio (Thomson Reuters)',
          'Layout específico Contmatic',
          'Validador integrado dos arquivos antes do envio',
          'Acesso somente leitura pra perfil Contador',
        ]}
      />
    </div>
  );
}
