/**
 * antivirus/provider.ts
 * Interface abstrata para providers de antivírus.
 */

export interface IAntivirusProvider {
  /**
   * Escaneia um arquivo em busca de malware.
   * @param buffer - Conteúdo do arquivo como Buffer
   * @param filename - Nome do arquivo (pra context)
   * @returns Resultado do scan
   */
  scanFile(buffer: Buffer, filename: string): Promise<ScanResult>;
}

export type ScanResult =
  | { status: 'clean' }
  | { status: 'infected'; threat: string }
  | { status: 'error'; message: string }
  | { status: 'unavailable' };  // fallback quando serviço fora
