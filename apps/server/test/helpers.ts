import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ServerOptions } from '../src/app';
import type { PdfEngine } from '../src/pdf/engine';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXAMPLES_DIR = path.resolve(here, '..', '..', '..', 'examples', 'data');

/** Motore PDF finto: restituisce l'HTML ricevuto dentro un "PDF" riconoscibile. */
export class FakePdfEngine implements PdfEngine {
  rendered: string[] = [];
  async render(html: string): Promise<Uint8Array> {
    this.rendered.push(html);
    return new TextEncoder().encode(`%PDF-FAKE\n${html.length}`);
  }
}

/** Cartella dati temporanea copiata dagli esempi fittizi. */
export async function makeTempDataDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open2bill-test-'));
  await fs.cp(EXAMPLES_DIR, dir, { recursive: true });
  return dir;
}

export async function makeTestServer(options: Partial<ServerOptions> = {}) {
  const dataDir = options.dataDir ?? (await makeTempDataDir());
  const pdfEngine = new FakePdfEngine();
  const server = await createServer({ dataDir, pdfEngine, ...options });
  return { ...server, dataDir, pdfEngine };
}
