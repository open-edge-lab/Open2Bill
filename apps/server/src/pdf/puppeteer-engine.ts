import fs from 'node:fs';
import type { Browser } from 'puppeteer-core';
import { PdfEngineUnavailableError, type PdfEngine } from './engine';

// PDF con puppeteer-core e un browser Chromium già presente nel sistema
// (niente download di Chromium). Percorso configurabile con O2B_CHROME_PATH.

const CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
  linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
};

export function findBrowserExecutable(explicit = process.env.O2B_CHROME_PATH): string | null {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  return (CANDIDATES[process.platform] ?? []).find((p) => fs.existsSync(p)) ?? null;
}

export class PuppeteerPdfEngine implements PdfEngine {
  private browser: Promise<Browser> | null = null;

  constructor(private readonly executablePath: string | null = findBrowserExecutable()) {}

  private async getBrowser(): Promise<Browser> {
    if (!this.executablePath) {
      throw new PdfEngineUnavailableError(
        'Nessun browser Chromium trovato per generare il PDF: installa Chrome/Edge/Chromium o imposta O2B_CHROME_PATH',
      );
    }
    if (!this.browser) {
      const puppeteer = await import('puppeteer-core');
      this.browser = puppeteer
        .launch({
          executablePath: this.executablePath,
          headless: true,
          args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
        })
        .catch((err: unknown) => {
          this.browser = null;
          throw err;
        });
    }
    return this.browser;
  }

  async render(html: string): Promise<Uint8Array> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.emulateMediaType('print');
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready');
      return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      const b = await this.browser.catch(() => null);
      this.browser = null;
      await b?.close();
    }
  }
}
