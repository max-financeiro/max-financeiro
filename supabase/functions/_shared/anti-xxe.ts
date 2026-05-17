/**
 * _shared/anti-xxe.ts
 * Versão Deno da lib anti-XXE para uso em Edge Functions.
 */

export interface XXECheckResult {
  safe: boolean;
  reason?: string;
}

export function preCheckXXE(xmlString: string): XXECheckResult {
  const encoder = new TextEncoder();
  const size = encoder.encode(xmlString).length;

  if (size > 5 * 1024 * 1024) {
    return { safe: false, reason: 'XML excede 5MB (limite de segurança)' };
  }

  if (/<!ENTITY/i.test(xmlString)) {
    return { safe: false, reason: 'XML contém <!ENTITY (XXE bloqueado)' };
  }

  if (/<!DOCTYPE[^>]*\b(SYSTEM|PUBLIC)\b/i.test(xmlString)) {
    return {
      safe: false,
      reason: 'XML contém DOCTYPE com entidades externas (XXE bloqueado)'
    };
  }

  if (/<script/i.test(xmlString)) {
    return { safe: false, reason: 'XML contém tag <script> (payload rejeitado)' };
  }

  if (/javascript:|data:text\/html/i.test(xmlString)) {
    return { safe: false, reason: 'XML contém URI suspeita (payload rejeitado)' };
  }

  if (/file:\/\//i.test(xmlString)) {
    return { safe: false, reason: 'XML contém referência file:// (bloqueado)' };
  }

  return { safe: true };
}
