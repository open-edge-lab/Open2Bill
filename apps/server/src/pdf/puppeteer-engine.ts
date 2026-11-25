import fs from 'node:fs';
import type { Browser, HTTPRequest, Page } from 'puppeteer-core';
import { PdfEngineUnavailableError, type PdfEngine } from './engine';

/** Tempo massimo per un PDF, avvio del browser compreso. */
const DEFAULT_RENDER_TIMEOUT_MS = 60_000;

export class PdfRenderTimeoutError extends PdfEngineUnavailableError {}

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
  private readonly timeoutMs: number;

  constructor(
    private readonly executablePath: string | null = findBrowserExecutable(),
    options: { timeoutMs?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  }

  private async getBrowser(): Promise<Browser> {
    const executablePath = this.executablePath;
    if (!executablePath) {
      throw new PdfEngineUnavailableError(
        'Nessun browser Chromium trovato per generare il PDF: installa Chrome/Edge/Chromium o imposta O2B_CHROME_PATH',
      );
    }
    if (!this.browser) {
      const puppeteer = await import('puppeteer-core');
      const launch = () =>
        puppeteer.launch({
          executablePath,
          headless: true,
          args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
          timeout: this.timeoutMs,
          // ogni comando al browser ha un tempo massimo: niente attese infinite
          protocolTimeout: this.timeoutMs,
        });
      // Edge su Windows a volte esce subito all'avvio (es. sotto carico): un secondo tentativo
      const launching: Promise<Browser> = launch()
        .catch(() => launch())
        .then((browser) => {
          // browser chiuso o andato in crash: al prossimo PDF se ne avvia uno nuovo
          browser.once('disconnected', () => {
            if (this.browser === launching) this.browser = null;
          });
          return browser;
        })
        .catch((err: unknown) => {
          if (this.browser === launching) this.browser = null;
          throw err;
        });
      this.browser = launching;
    }
    return this.browser;
  }

  async render(html: string): Promise<Uint8Array> {
    const opened: { page?: Page } = {};
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new PdfRenderTimeoutError(`Il PDF non è stato generato entro ${Math.round(this.timeoutMs / 1000)} secondi: riprova`)),
        this.timeoutMs,
      );
    });
    const work = (async () => {
      const browser = await this.getBrowser();
      opened.page = await browser.newPage();
      return this.print(opened.page, html);
    })();
    try {
      return await Promise.race([work, timedOut]);
    } catch (err) {
      if (err instanceof PdfRenderTimeoutError) {
        work.catch(() => undefined);
        // il browser è bloccato: lo chiudo, il prossimo PDF ne avvia uno nuovo
        this.kill();
      }
      throw err;
    } finally {
      clearTimeout(timer);
      await opened.page?.close().catch(() => undefined);
    }
  }

  private async print(page: Page, html: string): Promise<Uint8Array> {
    // Il documento è autosufficiente (font e logo incorporati come data: URL): niente
    // script e nessuna richiesta di rete, così un template o un dato malevolo non può
    // far contattare al browser indirizzi esterni o della rete interna (SSRF).
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request: HTTPRequest) => {
      const url = request.url();
      const decided = url.startsWith('data:') || url === 'about:blank' ? request.continue() : request.abort('blockedbyclient');
      // la pagina può chiudersi mentre la richiesta è in sospeso
      decided.catch(() => undefined);
    });
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'load', timeout: this.timeoutMs });
    await page.evaluate('document.fonts.ready');
    return page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, timeout: this.timeoutMs });
  }

  /** Chiude subito il browser, anche se non risponde. */
  private kill(): void {
    const pending = this.browser;
    this.browser = null;
    // senza attendere: se l'avvio stesso è bloccato, il browser si chiude appena parte
    void pending?.then(
      (b) => b.process()?.kill('SIGKILL'),
      () => undefined,
    );
  }

  async close(): Promise<void> {
    if (this.browser) {
      const b = await this.browser.catch(() => null);
      this.browser = null;
      await b?.close();
    }
  }
}
