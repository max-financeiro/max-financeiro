import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de Privacidade',
};

export default function PrivacidadePage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12 prose prose-sm">
      <h1 className="font-display text-3xl font-semibold text-maxfem-ink">
        Política de Privacidade
      </h1>
      <p className="text-sm text-neutral-600 mt-2">Versão draft · a ser revisada pelo escritório jurídico</p>

      <div className="mt-8 space-y-4 text-sm text-neutral-700 leading-relaxed">
        <p>
          O Sistema Financeiro Maxfem trata dados pessoais e financeiros sob a Lei nº 13.709/2018 (LGPD).
          Esta página será atualizada com o texto definitivo do escritório jurídico antes do go-live.
        </p>
        <p>
          <strong>Dados tratados:</strong> nome, CPF/CNPJ, email, telefone, dados bancários (criptografados em
          repouso), histórico de transações.
        </p>
        <p>
          <strong>Retenção:</strong> 5 anos após última transação (obrigação fiscal e LGPD).
        </p>
        <p>
          <strong>DPO:</strong> Anderson Mesquita (representante legal Maxfem) · dpo@maxfem.com.br
        </p>
        <p>
          <strong>Direitos do titular:</strong> acesso, correção, eliminação, portabilidade. Solicite via DPO.
        </p>
      </div>
    </main>
  );
}
