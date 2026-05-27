/**
 * ai/classify-account.ts — sugere chart_of_accounts pra AP/AR usando Claude.
 *
 * Estratégia:
 *   1. Carrega o plano de contas do grupo (só contas analíticas — folha)
 *   2. Pega few-shot examples: últimos N lançamentos JÁ classificados do
 *      mesmo tipo (AP ou AR) — ensina o modelo o padrão da Maxfem
 *   3. Monta prompt com: descrição, fornecedor/cliente, valor, plano,
 *      exemplos resolvidos
 *   4. Claude Haiku 4.5 (rápido + barato — clas­sificação não exige Opus)
 *   5. Output JSON { account_code, confidence, reasoning }
 *
 * Custos: ~$0.001 por classificação (Haiku 4.5). Pra processar 100
 * lançamentos = ~R$ 0,50.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_FEW_SHOT = 8;

export type DocKind = 'ap' | 'ar';

export interface ClassifyInput {
  groupId: string;
  kind: DocKind;
  /** Descrição livre do documento (description). */
  description: string;
  /** Nome do fornecedor (AP) ou cliente (AR). Opcional. */
  partnerName?: string | null;
  /** CPF/CNPJ. Opcional. */
  partnerDocument?: string | null;
  /** Valor — ajuda a desambiguar (taxa vs venda, etc). */
  amount?: number;
}

export interface ClassifySuggestion {
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_analytical: boolean;
}

interface FewShotExample {
  description: string;
  partner: string | null;
  amount: number | string;
  account_code: string;
  account_name: string;
}

/**
 * Função principal — orquestra DB + LLM. Best-effort: nunca throws,
 * retorna confidence=low + accountId=null em qualquer erro.
 */
export async function classifyAccount(
  admin: Admin,
  input: ClassifyInput,
): Promise<ClassifySuggestion> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fallback('ANTHROPIC_API_KEY ausente');
  }

  // 1. Plano de contas do grupo — só receita (AR) ou despesa (AP), analíticas
  const targetType = input.kind === 'ar' ? 'revenue' : 'expense';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accountsRaw } = await (admin as any)
    .from('chart_of_accounts')
    .select('id, code, name, account_type, is_analytical')
    .eq('group_id', input.groupId)
    .eq('account_type', targetType)
    .eq('active', true)
    .is('deleted_at', null)
    .order('code');
  const accounts = (accountsRaw ?? []) as AccountRow[];
  // Prefere analíticas; se não houver, usa qualquer
  const analytical = accounts.filter((a) => a.is_analytical);
  const candidates = analytical.length > 0 ? analytical : accounts;

  if (candidates.length === 0) {
    return fallback('Plano de contas vazio pro tipo ' + targetType);
  }

  // 2. Few-shot: lançamentos do mesmo tipo já classificados (account_id NOT NULL)
  let fewShot: FewShotExample[] = [];
  if (input.kind === 'ap') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('accounts_payable')
      .select('description, amount, business_partners!supplier_id(legal_name, trade_name), chart_of_accounts!account_id(code, name)')
      .not('account_id', 'is', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(MAX_FEW_SHOT * 3); // pega mais e filtra
    fewShot = (data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r: any) => r.chart_of_accounts && r.description)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => ({
        description: r.description,
        partner: r.business_partners?.trade_name || r.business_partners?.legal_name || null,
        amount: r.amount,
        account_code: r.chart_of_accounts.code,
        account_name: r.chart_of_accounts.name,
      }))
      .slice(0, MAX_FEW_SHOT);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('accounts_receivable')
      .select('description, amount, business_partners!customer_id(legal_name, trade_name), chart_of_accounts!account_id(code, name)')
      .not('account_id', 'is', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(MAX_FEW_SHOT * 3);
    fewShot = (data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r: any) => r.chart_of_accounts && r.description)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => ({
        description: r.description,
        partner: r.business_partners?.trade_name || r.business_partners?.legal_name || null,
        amount: r.amount,
        account_code: r.chart_of_accounts.code,
        account_name: r.chart_of_accounts.name,
      }))
      .slice(0, MAX_FEW_SHOT);
  }

  // 3. Prompt
  const planoText = candidates
    .map((a) => `${a.code} - ${a.name}`)
    .join('\n');
  const examplesText = fewShot.length > 0
    ? '\n\nExemplos JÁ classificados pela Maxfem:\n' + fewShot
        .map((e) => `- "${e.description}"${e.partner ? ` (${e.partner})` : ''} | R$ ${Number(e.amount).toFixed(2)} → ${e.account_code} ${e.account_name}`)
        .join('\n')
    : '';

  const docContext = [
    `Descrição: "${input.description}"`,
    input.partnerName ? `${input.kind === 'ap' ? 'Fornecedor' : 'Cliente'}: ${input.partnerName}` : null,
    input.partnerDocument ? `Documento: ${input.partnerDocument}` : null,
    input.amount !== undefined ? `Valor: R$ ${Number(input.amount).toFixed(2)}` : null,
  ].filter(Boolean).join('\n');

  const systemPrompt = `Você classifica lançamentos financeiros da Maxfem (e-commerce de saúde íntima feminina) no plano de contas. Responda APENAS com JSON válido no formato:
{"account_code": "X.X.XX", "confidence": "high"|"medium"|"low", "reasoning": "uma frase curta em PT-BR"}

Regras:
- O account_code DEVE ser um código que existe no plano fornecido. Não invente.
- Se nenhuma conta do plano fizer sentido pro lançamento, devolva "account_code": null.
- confidence "high" quando há match óbvio com descrição + exemplos resolvidos.
- confidence "medium" quando é razoável mas tem ambiguidade.
- confidence "low" quando você está chutando.`;

  const userPrompt = `Plano de contas (${targetType === 'revenue' ? 'RECEITAS' : 'DESPESAS'}):
${planoText}
${examplesText}

Lançamento a classificar:
${docContext}

Responda só o JSON.`;

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Extrai JSON do response
    const textBlock = resp.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return fallback('Resposta sem texto');
    }
    const raw = textBlock.text.trim();
    // Tira possíveis markdown fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed: { account_code: string | null; confidence: string; reasoning: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return fallback(`JSON inválido: ${cleaned.slice(0, 100)}`);
    }

    if (!parsed.account_code) {
      return {
        accountId: null,
        accountCode: null,
        accountName: null,
        confidence: 'low',
        reasoning: parsed.reasoning || 'Nenhuma conta apropriada',
      };
    }

    // Resolve code → id
    const match = candidates.find((a) => a.code === parsed.account_code);
    if (!match) {
      return fallback(`Code "${parsed.account_code}" não está no plano`);
    }

    const confidence: 'high' | 'medium' | 'low' =
      parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
        ? parsed.confidence
        : 'low';

    return {
      accountId: match.id,
      accountCode: match.code,
      accountName: match.name,
      confidence,
      reasoning: parsed.reasoning || '—',
    };
  } catch (err) {
    return fallback(`LLM erro: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function fallback(reasoning: string): ClassifySuggestion {
  return {
    accountId: null,
    accountCode: null,
    accountName: null,
    confidence: 'low',
    reasoning,
  };
}
