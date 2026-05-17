/**
 * antivirus/cloudmersive.ts
 * Provider de antivírus via Cloudmersive API.
 * Free tier: 800 calls/mês (suficiente pra < 30 uploads/dia).
 */

import type { IAntivirusProvider, ScanResult } from './provider';

export class CloudmersiveAntivirusProvider implements IAntivirusProvider {
  private readonly apiKey: string;
  private readonly endpoint = 'https://api.cloudmersive.com/virus/scan/file';
  private readonly timeout = 15000; // 15s (PDFs scaneados podem demorar)

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Cloudmersive API key is required');
    }
    this.apiKey = apiKey;
  }

  async scanFile(buffer: Buffer, filename: string): Promise<ScanResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const formData = new FormData();
      // Buffer -> Uint8Array pra resolver incompatibilidade BlobPart no TS strict
      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' });
      formData.append('inputFile', blob, filename);

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Apikey': this.apiKey,
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // 5xx ou rate limit → unavailable (não bloqueia upload)
        if (response.status >= 500 || response.status === 429) {
          return { status: 'unavailable' };
        }

        return {
          status: 'error',
          message: `Cloudmersive API error: ${response.status}`,
        };
      }

      const result = (await response.json()) as {
        CleanResult?: boolean;
        FoundViruses?: Array<{ VirusName?: string }>;
      };

      // Cloudmersive retorna: { CleanResult: true/false, FoundViruses?: [...] }
      if (result.CleanResult === false && (result.FoundViruses?.length ?? 0) > 0) {
        const threats = (result.FoundViruses ?? [])
          .map((v) => v.VirusName ?? 'unknown')
          .join(', ');
        return {
          status: 'infected',
          threat: threats,
        };
      }

      return { status: 'clean' };
    } catch (error) {
      // Timeout ou erro de rede → unavailable (não bloqueia upload)
      const e = error as { name?: string; code?: string };
      if (e.name === 'AbortError' || e.code === 'ECONNREFUSED') {
        return { status: 'unavailable' };
      }

      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
