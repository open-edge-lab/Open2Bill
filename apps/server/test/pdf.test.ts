import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocumentSchema, calculateTotals } from '@open2bill/core';
import { DEFAULT_ASSETS_DIR } from '../src/app';
import { PuppeteerPdfEngine, findBrowserExecutable } from '../src/pdf/puppeteer-engine';
import { TemplateRenderer } from '../src/pdf/template';
import { DataStore } from '../src/storage/data-store';
import { EXAMPLES_DIR } from './helpers';

// Generazione PDF reale con un browser di sistema. Saltato se non c'è un Chromium.
// Con O2B_PDF_OUT=<cartella> salva i PDF per controllarli a occhio.

const browser = findBrowserExecutable();

describe.skipIf(!browser)('PDF reale (puppeteer-core)', () => {
  it('genera PDF di fattura e proforma', async () => {
    const store = new DataStore(EXAMPLES_DIR);
    const issuer = await store.getIssuer();
    const customer = await store.getCustomer('esempio-software-s-r-l');
    const { id: _id, ...customerData } = customer;
    const renderer = new TemplateRenderer(DEFAULT_ASSETS_DIR, EXAMPLES_DIR);
    const engine = new PuppeteerPdfEngine(browser);

    const base = {
      id: 'pdf-test',
      date: '2025-08-14',
      customer: customerData,
      lines: [
        { description: 'Progettazione e sviluppo software\n“Gestionale di esempio”', unitPrice: 1442.31, vatRate: 22 },
        { kind: 'passThroughExpense', description: 'Spese di trasferta anticipate', unitPrice: 48.5 },
      ],
      pensionFund: issuer.defaults.pensionFund,
      withholding: issuer.defaults.withholding,
      payment: { ...issuer.payment, dueDate: '2025-09-13' },
    };

    try {
      for (const [name, extra] of [
        ['invoice', { type: 'TD01', status: 'issued', number: '1' }],
        ['proforma', { type: 'proforma', status: 'issued', number: 'PF1', lines: base.lines.slice(0, 1) }],
      ] as const) {
        const doc = DocumentSchema.parse({ ...base, ...extra });
        const html = await renderer.renderHtml(doc, issuer, calculateTotals(doc));
        const pdf = await engine.render(html);
        expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.byteLength).toBeGreaterThan(10_000);
        if (process.env.O2B_PDF_OUT) {
          await fs.mkdir(process.env.O2B_PDF_OUT, { recursive: true });
          await fs.writeFile(path.join(process.env.O2B_PDF_OUT, `${name}.pdf`), pdf);
          await fs.writeFile(path.join(process.env.O2B_PDF_OUT, `${name}.html`), html);
        }
      }
    } finally {
      await engine.close();
    }
  });
});
