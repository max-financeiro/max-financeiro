/**
 * Validação e normalização de documentos brasileiros (CNPJ/CPF).
 *
 * Documentos no banco SEMPRE são guardados normalizados (só dígitos).
 * Apresentação faz reformatação via lib/format.ts.
 */

export type DocumentType = 'cnpj' | 'cpf' | 'foreign';

/** Remove tudo que não é dígito. */
export function normalizeDocument(input: string): string {
  return (input ?? '').replace(/\D/g, '');
}

/** Detecta tipo pelo comprimento (assumindo já normalizado). */
export function detectDocumentType(normalized: string): DocumentType | null {
  if (normalized.length === 14) return 'cnpj';
  if (normalized.length === 11) return 'cpf';
  return null;
}

/** Validação de dígitos verificadores do CNPJ. */
export function isValidCNPJ(cnpj: string): boolean {
  const d = normalizeDocument(cnpj);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false; // todos iguais

  const calc = (length: number): number => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += parseInt(d[i]!, 10) * weights[i]!;
    }
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };

  return calc(12) === parseInt(d[12]!, 10) && calc(13) === parseInt(d[13]!, 10);
}

/** Validação de dígitos verificadores do CPF. */
export function isValidCPF(cpf: string): boolean {
  const d = normalizeDocument(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const calc = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += parseInt(d[i]!, 10) * (length + 1 - i);
    }
    const rem = (sum * 10) % 11;
    return rem === 10 ? 0 : rem;
  };

  return calc(9) === parseInt(d[9]!, 10) && calc(10) === parseInt(d[10]!, 10);
}

/** Valida documento brasileiro (CNPJ ou CPF). */
export function isValidBRDocument(doc: string): boolean {
  const d = normalizeDocument(doc);
  if (d.length === 14) return isValidCNPJ(d);
  if (d.length === 11) return isValidCPF(d);
  return false;
}
