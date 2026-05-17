/**
 * antivirus/mock.ts
 * Provider de antivírus mock para dev/test.
 * Sempre retorna 'clean' exceto se filename contém 'EICAR' (test vector padrão).
 */

import type { IAntivirusProvider, ScanResult } from './provider';

export class MockAntivirusProvider implements IAntivirusProvider {
  async scanFile(buffer: Buffer, filename: string): Promise<ScanResult> {
    // Simula detecção do EICAR test file (padrão da indústria)
    if (filename.toUpperCase().includes('EICAR')) {
      return {
        status: 'infected',
        threat: 'EICAR-Test-File (not a real virus)',
      };
    }

    // Simula detecção se conteúdo contém string EICAR
    const content = buffer.toString('utf8', 0, Math.min(buffer.length, 1024));
    if (content.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {
      return {
        status: 'infected',
        threat: 'EICAR-Test-File (content match)',
      };
    }

    // Default: sempre limpo
    return { status: 'clean' };
  }
}
