/**
 * anti-xxe.ts
 * Pré-validações de segurança contra ataques XXE (XML External Entity).
 * Bloqueia XMLs suspeitos antes do parsing.
 */

export interface XXECheckResult {
  safe: boolean;
  reason?: string;
}

/**
 * Verifica se XML contém vetores de ataque XXE ou payloads maliciosos.
 * @param xmlString - Conteúdo do XML como string
 * @returns Objeto indicando se é seguro fazer parse + razão se bloqueado
 */
export function preCheckXXE(xmlString: string): XXECheckResult {
  const size = Buffer.byteLength(xmlString, 'utf8');

  // 1. Limite de tamanho (XMLs NF-e reais < 500KB, fôlego até 5MB)
  if (size > 5 * 1024 * 1024) {
    return { safe: false, reason: 'XML excede 5MB (limite de segurança)' };
  }

  // 2. Bloqueia ENTITY declarations (vetor principal de XXE)
  if (/<!ENTITY/i.test(xmlString)) {
    return { safe: false, reason: 'XML contém <!ENTITY (XXE bloqueado)' };
  }

  // 3. Bloqueia DOCTYPE com SYSTEM ou PUBLIC (external entities)
  if (/<!DOCTYPE[^>]*\b(SYSTEM|PUBLIC)\b/i.test(xmlString)) {
    return {
      safe: false,
      reason: 'XML contém DOCTYPE com entidades externas (XXE bloqueado)'
    };
  }

  // 4. Bloqueia script tags (paranoia — não deveria existir em NF-e legítima)
  if (/<script/i.test(xmlString)) {
    return { safe: false, reason: 'XML contém tag <script> (payload rejeitado)' };
  }

  // 5. Bloqueia javascript: e data: URIs
  if (/javascript:|data:text\/html/i.test(xmlString)) {
    return { safe: false, reason: 'XML contém URI suspeita (payload rejeitado)' };
  }

  // 6. Bloqueia referências a files locais (file://)
  if (/file:\/\//i.test(xmlString)) {
    return { safe: false, reason: 'XML contém referência file:// (bloqueado)' };
  }

  // XML passou nas verificações
  return { safe: true };
}
