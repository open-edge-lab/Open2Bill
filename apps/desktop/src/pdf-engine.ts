import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type { PdfEngine } from '@open2bill/server';

// PDF con il Chromium di Electron: nessun browser esterno da installare.

export class ElectronPdfEngine implements PdfEngine {
  async render(html: string): Promise<Uint8Array> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open2bill-pdf-'));
    const file = path.join(dir, 'document.html');
    const win = new BrowserWindow({
      show: false,
      webPreferences: { javascript: false, sandbox: true },
    });
    try {
      await fs.writeFile(file, html, 'utf8');
      await win.loadFile(file);
      const pdf = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      });
      return new Uint8Array(pdf);
    } finally {
      win.destroy();
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
