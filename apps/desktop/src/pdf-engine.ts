import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, session } from 'electron';
import type { PdfEngine } from '@open2bill/server';

// PDF con il Chromium di Electron: nessun browser esterno da installare.
//
// La finestra nascosta usa una sessione separata, solo in memoria, in cui ogni richiesta
// di rete è bloccata: il documento è autosufficiente (font e logo come data: URL), quindi
// un template o un dato malevolo non può far leggere file locali o contattare indirizzi
// esterni o della rete interna.

const PDF_PARTITION = 'open2bill-pdf'; // senza "persist:": niente su disco

export class ElectronPdfEngine implements PdfEngine {
  /** URL dei documenti in corso di stampa: le uniche richieste ammesse oltre ai data: URL. */
  private readonly allowed = new Set<string>();
  private guarded = false;

  private pdfSession() {
    const ses = session.fromPartition(PDF_PARTITION);
    if (!this.guarded) {
      ses.webRequest.onBeforeRequest((details, callback) => {
        const ok = details.url.startsWith('data:') || this.allowed.has(details.url);
        callback({ cancel: !ok });
      });
      this.guarded = true;
    }
    return ses;
  }

  async render(html: string): Promise<Uint8Array> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open2bill-pdf-'));
    const file = path.join(dir, 'document.html');
    const url = pathToFileURL(file).href;
    const win = new BrowserWindow({
      show: false,
      webPreferences: { javascript: false, sandbox: true, session: this.pdfSession() },
    });
    this.allowed.add(url);
    try {
      await fs.writeFile(file, html, 'utf8');
      await win.loadURL(url);
      const pdf = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      });
      return new Uint8Array(pdf);
    } finally {
      this.allowed.delete(url);
      win.destroy();
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
