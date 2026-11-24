// Motore di conversione HTML → PDF. Due implementazioni:
// - puppeteer-core con un Chrome/Edge/Chromium già installato (server web);
// - printToPDF di Electron (app desktop, vedi apps/desktop).

export interface PdfEngine {
  render(html: string): Promise<Uint8Array>;
  close?(): Promise<void>;
}

export class PdfEngineUnavailableError extends Error {}
