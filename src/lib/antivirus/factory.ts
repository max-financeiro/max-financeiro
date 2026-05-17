/**
 * antivirus/factory.ts
 * Factory para criar provider de antivírus baseado em env vars.
 */

import { CloudmersiveAntivirusProvider } from './cloudmersive';
import { MockAntivirusProvider } from './mock';
import type { IAntivirusProvider } from './provider';

/**
 * Cria provider de antivírus configurado.
 * Usa Cloudmersive se ENABLE_ANTIVIRUS=true e CLOUDMERSIVE_API_KEY presente.
 * Senão, usa Mock (sempre retorna clean exceto EICAR test file).
 */
export function createAntivirusProvider(): IAntivirusProvider {
  const enabled = process.env.ENABLE_ANTIVIRUS === 'true';
  const apiKey = process.env.CLOUDMERSIVE_API_KEY;

  if (enabled && apiKey) {
    return new CloudmersiveAntivirusProvider(apiKey);
  }

  // Fallback: Mock provider (dev/test ou antivirus desabilitado)
  return new MockAntivirusProvider();
}
