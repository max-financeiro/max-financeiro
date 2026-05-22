/**
 * inter/statement.ts — comprovante de pagamento via API do Banco Inter.
 *
 * O Inter NÃO expõe um endpoint de comprovante por transação. O único
 * documento PDF oficial é o **extrato do dia** em
 *   GET /banking/v2/extrato/exportar?dataInicio=X&dataFim=X
 * que (com Accept: application/json) devolve `{ "pdf": "<base64>" }`.
 *
 * Como o PIX/boleto liquida no mesmo dia, o extrato da data de liquidação
 * É o comprovante oficial — contém a transação do pagamento. É isso que
 * anexamos na CAP como `kind='receipt', source='inter'`.
 *
 * Roda apenas no servidor.
 */
import 'server-only';
import { Buffer } from 'node:buffer';
import { loadInterCredentials } from './credentials';
import { fetchInterToken, interApiRequest, interBaseUrl } from './client';
import { InterApiError } from './errors';

/** `%PDF-` — assinatura de arquivo PDF válido. */
function isPdf(buf: Buffer): boolean {
  return buf.length > 4 && buf.toString('ascii', 0, 5) === '%PDF-';
}

/**
 * Baixa o extrato (comprovante) do Inter no intervalo informado.
 * Datas no formato `YYYY-MM-DD`. Retorna o PDF como Buffer.
 *
 * Lança `InterApiError` se não houver credencial ou a resposta não for
 * um PDF válido.
 */
export async function getInterStatementPdf(
  startDate: string,
  endDate: string,
): Promise<Buffer> {
  const creds = await loadInterCredentials();
  if (!creds) {
    throw new InterApiError(0, 'Banco Inter não configurado', 'NOT_CONFIGURED');
  }

  const baseUrl = interBaseUrl(creds.environment);
  const mtls = { certPem: creds.certPem, keyPem: creds.keyPem };

  const token = await fetchInterToken({
    baseUrl,
    mtls,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  });

  const resp = await interApiRequest<{ pdf?: string }>({
    baseUrl,
    mtls,
    accessToken: token.accessToken,
    contaCorrente: creds.contaCorrente,
    method: 'GET',
    path: `/banking/v2/extrato/exportar?dataInicio=${encodeURIComponent(
      startDate,
    )}&dataFim=${encodeURIComponent(endDate)}`,
  });

  if (!resp?.pdf) {
    throw new InterApiError(0, 'Inter não retornou o PDF do extrato', 'INTER_UNAVAILABLE');
  }

  const pdf = Buffer.from(resp.pdf, 'base64');
  if (!isPdf(pdf)) {
    throw new InterApiError(0, 'Conteúdo retornado pelo Inter não é um PDF válido', 'UNKNOWN');
  }
  return pdf;
}
