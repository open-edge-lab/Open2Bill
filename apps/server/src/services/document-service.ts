import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DOCUMENT_KIND_FILE_WORDS,
  DocumentSchema,
  calculateTotals,
  displayName,
  documentNumberFor,
  duplicateDocument,
  invoiceToCreditNote,
  issuedDocumentId,
  newDocument,
  proformaToInvoice,
  sameBankDetails,
  slugify,
  todayIso,
  validateDocument,
  withBankDetails,
  type Document,
  type DocumentKind,
  type Issuer,
  type Totals,
  type ValidationIssue,
} from '@open2bill/core';
import { buildInvoiceXml, formatTransmissionSequence } from '@open2bill/core/fatturapa';
import { schemaVersionFor, validateInvoiceXsd } from '@open2bill/core/xsd';
import type { PdfEngine } from '../pdf/engine';
import type { TemplateRenderer } from '../pdf/template';
import { ConflictError, NotFoundError, type DataStore } from '../storage/data-store';
import { fileExists, writeFileAtomic } from '../storage/yaml-file';

// Flusso dei documenti: bozze, emissione (numero + XML + PDF), conversione
// proforma → fattura, nota di credito, stato di caricamento su SdI.

export class ValidationFailedError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super('Il documento contiene errori');
  }
}

export interface DocumentDetails {
  document: Document;
  totals: Totals;
  issues: ValidationIssue[];
}

export interface FullValidation extends DocumentDetails {
  ok: boolean;
  xsd?: { valid: boolean; version: string; errors: string[] };
}

export interface IssueResult {
  document: Document;
  warnings: string[];
}

/** Serializza le operazioni che assegnano numeri, per non avere doppioni. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export class DocumentService {
  private readonly lock = new Mutex();

  constructor(
    private readonly store: DataStore,
    private readonly renderer: TemplateRenderer,
    private readonly pdfEngine: PdfEngine | null,
  ) {}

  private today(): string {
    return todayIso();
  }

  // ── Emittente ──────────────────────────────────────────────
  /**
   * Salva i dati dell'emittente. Se cambiano banca, IBAN o beneficiario, le bozze che avevano
   * quelli di prima li prendono nuovi: erano i predefiniti copiati alla creazione. Le bozze
   * con una banca scelta a mano e i documenti emessi restano come sono.
   */
  async saveIssuer(input: unknown): Promise<{ issuer: Issuer; updatedDrafts: number; issues: ValidationIssue[] }> {
    return this.lock.run(async () => {
      const previous = (await this.store.hasIssuer()) ? await this.store.getIssuer().catch(() => null) : null;
      const issuer = await this.store.saveIssuer(input);
      if (!previous || sameBankDetails(previous.payment, issuer.payment)) return { issuer, updatedDrafts: 0, issues: [] };

      let updatedDrafts = 0;
      try {
        for (const doc of await this.store.listDocuments()) {
          if (doc.status !== 'draft' || !doc.payment || !sameBankDetails(doc.payment, previous.payment)) continue;
          await this.store.saveDocument({ ...doc, payment: withBankDetails(doc.payment, issuer.payment) });
          updatedDrafts++;
        }
      } catch (err) {
        // I dati dell'emittente sono già salvati: si segnala solo che le bozze non sono state aggiornate tutte.
        const reason = err instanceof Error ? err.message : String(err);
        const issue: ValidationIssue = {
          path: 'payment',
          severity: 'warning',
          message: `Banca non aggiornata in tutte le bozze (${updatedDrafts} aggiornate): ${reason}`,
        };
        return { issuer, updatedDrafts, issues: [issue] };
      }
      return { issuer, updatedDrafts, issues: [] };
    });
  }

  // ── Bozze ──────────────────────────────────────────────────
  async template(type: DocumentKind, customerId?: string): Promise<Document> {
    const issuer = await this.store.getIssuer();
    const customer = customerId ? await this.store.getCustomer(customerId) : undefined;
    const doc = newDocument(issuer, {
      type,
      today: this.today(),
      customerId,
      customer: customer ? stripId(customer) : undefined,
    });
    return doc;
  }

  async createDraft(input: unknown): Promise<Document> {
    const base = await this.template('TD01');
    const doc = DocumentSchema.parse({ ...asObject(input), ...SERVER_ONLY_FIELDS, id: base.id, sourceProformaId: undefined });
    return this.store.saveDocument(doc);
  }

  async updateDraft(id: string, input: unknown): Promise<Document> {
    const current = await this.store.getDocument(id);
    if (current.status !== 'draft') throw new ConflictError('Un documento emesso non si può modificare');
    // il legame con la proforma lo decide solo il server (conversione)
    const doc = DocumentSchema.parse({
      ...asObject(input),
      ...SERVER_ONLY_FIELDS,
      id,
      sourceProformaId: current.sourceProformaId,
    });
    return this.store.saveDocument(doc);
  }

  async deleteDraft(id: string): Promise<void> {
    const current = await this.store.getDocument(id);
    if (current.status !== 'draft') throw new ConflictError('Un documento emesso non si può eliminare');
    await this.store.deleteDocument(id);
  }

  async details(id: string): Promise<DocumentDetails> {
    const document = await this.store.getDocument(id);
    const issuer = await this.store.getIssuer();
    const v = validateDocument(document, issuer, { today: this.today() });
    return { document, totals: v.totals, issues: document.status === 'draft' ? v.issues : [] };
  }

  /** Validazione completa: regole di merito + XML di prova validato con lo schema XSD. */
  async validate(input: unknown): Promise<FullValidation> {
    const document = DocumentSchema.parse(input);
    const issuer = await this.store.getIssuer();
    const v = validateDocument(document, issuer, { today: this.today() });
    const result: FullValidation = { document, totals: v.totals, issues: v.issues, ok: v.ok };
    if (v.ok && document.type !== 'proforma') {
      const probe = buildInvoiceXml({ ...document, number: document.number ?? '0' }, issuer, {
        transmissionSequence: '00000',
      });
      const xsd = await validateInvoiceXsd(probe.xml, schemaVersionFor(this.today()));
      result.xsd = xsd;
      for (const i of probe.issues) result.issues.push({ path: 'xml', message: `${i.code}: ${i.message}`, severity: 'error' });
      for (const e of xsd.errors) result.issues.push({ path: 'xml', message: `Schema XSD: ${e}`, severity: 'error' });
      result.ok = result.ok && probe.issues.length === 0 && xsd.valid;
    }
    return result;
  }

  // ── Emissione ──────────────────────────────────────────────
  issue(id: string): Promise<IssueResult> {
    return this.lock.run(() => this.issueLocked(id));
  }

  private async issueLocked(id: string): Promise<IssueResult> {
    const draft = await this.store.getDocument(id);
    if (draft.status !== 'draft') throw new ConflictError('Il documento è già stato emesso');
    const issuer = await this.store.getIssuer();

    const validation = validateDocument(draft, issuer, { today: this.today() });
    if (!validation.ok) throw new ValidationFailedError(validation.issues);

    const year = Number(draft.date.slice(0, 4));
    const sequence = await this.store.nextSequence(draft.type, year);
    const doc: Document = {
      ...draft,
      id: issuedDocumentId(draft.type, sequence, year),
      status: 'issued',
      sequence,
      number: documentNumberFor(issuer, draft.type, sequence, year),
      issuedAt: new Date().toISOString(),
    };
    if (await fileExists(this.store.paths.document(doc.id))) {
      throw new ConflictError(`Esiste già un documento ${doc.id}`);
    }

    const warnings: string[] = [];
    const outDir = this.store.paths.outputDir(year);

    // XML (non per le proforma)
    if (doc.type !== 'proforma') {
      const counter = await this.store.nextTransmissionCounter();
      doc.transmissionSequence = formatTransmissionSequence(counter);
      const built = buildInvoiceXml(doc, issuer, { transmissionSequence: doc.transmissionSequence });
      if (built.issues.length > 0) {
        throw new ValidationFailedError(
          built.issues.map((i) => ({ path: 'xml', message: `${i.code}: ${i.message}`, severity: 'error' as const })),
        );
      }
      const xsd = await validateInvoiceXsd(built.xml, schemaVersionFor(this.today()));
      if (!xsd.valid) {
        throw new ValidationFailedError(
          xsd.errors.map((e) => ({ path: 'xml', message: `Schema XSD: ${e}`, severity: 'error' as const })),
        );
      }
      await writeFileAtomic(path.join(outDir, built.fileName), built.xml);
      doc.xmlFileName = built.fileName;
    }

    // PDF (se il motore non è disponibile l'emissione resta valida: il PDF si rigenera dopo)
    try {
      doc.pdfFileName = await this.writePdf(doc, issuer, validation.totals);
    } catch (err) {
      warnings.push(`PDF non generato: ${(err as Error).message}`);
    }

    await this.store.saveDocument(doc);
    await this.store.deleteDocument(draft.id);

    if (doc.sourceProformaId) {
      await this.linkProforma(doc.sourceProformaId, doc.id).catch(() => undefined);
    }
    return { document: doc, warnings };
  }

  private async linkProforma(proformaId: string, invoiceId: string) {
    const proforma = await this.store.getDocument(proformaId);
    if (proforma.type !== 'proforma') return;
    await this.store.saveDocument({ ...proforma, convertedToId: invoiceId });
  }

  pdfFileNameFor(doc: Document, issuer: Issuer): string {
    const part = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const name = issuer.numbering.pdfFileName
      .replace('{year}', doc.date.slice(0, 4))
      .replace('{type}', DOCUMENT_KIND_FILE_WORDS[doc.type])
      .replace('{number}', part(doc.number ?? 'draft'))
      .replace('{customer}', slugify(displayName(doc.customer)) || 'customer');
    return `${name.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;
  }

  private async writePdf(doc: Document, issuer: Issuer, totals: Totals): Promise<string> {
    const pdf = await this.renderPdf(doc, issuer, totals);
    const fileName = this.pdfFileNameFor(doc, issuer);
    await writeFileAtomic(path.join(this.store.paths.outputDir(doc.date.slice(0, 4)), fileName), pdf);
    return fileName;
  }

  async regeneratePdf(id: string): Promise<Document> {
    const doc = await this.store.getDocument(id);
    if (doc.status === 'draft') throw new ConflictError('Le bozze non hanno un PDF salvato');
    const issuer = await this.store.getIssuer();
    const fileName = await this.writePdf(doc, issuer, calculateTotals(doc));
    return this.store.saveDocument({ ...doc, pdfFileName: fileName });
  }

  // ── Anteprima ──────────────────────────────────────────────
  async previewHtml(input: unknown): Promise<string> {
    const doc = DocumentSchema.parse(input);
    const issuer = await this.store.getIssuer();
    return this.renderer.renderHtml(doc, issuer, calculateTotals(doc));
  }

  async renderPdf(doc: Document, issuer: Issuer, totals: Totals = calculateTotals(doc)): Promise<Uint8Array> {
    if (!this.pdfEngine) throw new Error('Motore PDF non configurato');
    const html = await this.renderer.renderHtml(doc, issuer, totals);
    return this.pdfEngine.render(html);
  }

  // ── Derivati ───────────────────────────────────────────────
  async convertProforma(id: string): Promise<Document> {
    const proforma = await this.store.getDocument(id);
    if (proforma.convertedToId) throw new ConflictError('Questa proforma è già stata convertita');
    const invoice = await this.store.saveDocument(proformaToInvoice(proforma, this.today()));
    await this.store.saveDocument({ ...proforma, convertedToId: invoice.id });
    return invoice;
  }

  async creditNote(id: string): Promise<Document> {
    const invoice = await this.store.getDocument(id);
    if (invoice.status === 'draft') throw new ConflictError('La nota di credito si crea da una fattura emessa');
    return this.store.saveDocument(invoiceToCreditNote(invoice, this.today()));
  }

  async duplicate(id: string): Promise<Document> {
    const doc = await this.store.getDocument(id);
    return this.store.saveDocument(duplicateDocument(doc, this.today()));
  }

  async setStatus(id: string, status: 'issued' | 'uploaded', meta: { uploadedAt?: string; sdiNotes?: string }) {
    const doc = await this.store.getDocument(id);
    if (doc.status === 'draft') throw new ConflictError('Il documento non è ancora stato emesso');
    if (doc.type === 'proforma' && status === 'uploaded') {
      throw new ConflictError('La proforma non si carica sul Sistema di Interscambio');
    }
    return this.store.saveDocument({
      ...doc,
      status,
      uploadedAt: status === 'uploaded' ? (meta.uploadedAt ?? this.today()) : undefined,
      sdiNotes: meta.sdiNotes ?? doc.sdiNotes,
    });
  }

  /** Percorso di un file generato (XML o PDF) di un documento emesso. */
  async outputFile(id: string, kind: 'xml' | 'pdf'): Promise<{ file: string; fileName: string }> {
    const doc = await this.store.getDocument(id);
    const fileName = kind === 'xml' ? doc.xmlFileName : doc.pdfFileName;
    const unavailable = new NotFoundError(kind === 'xml' ? 'XML non disponibile' : 'PDF non disponibile');
    // Solo documenti emessi e solo nomi di file semplici: niente percorsi (es. "../issuer.yaml"),
    // anche se il file YAML del documento fosse stato modificato a mano.
    if (doc.status === 'draft' || !fileName) throw unavailable;
    if (path.basename(fileName) !== fileName || !/^[A-Za-z0-9._-]+$/.test(fileName)) throw unavailable;

    const outDir = path.resolve(this.store.paths.outputDir(doc.date.slice(0, 4)));
    const file = path.resolve(outDir, fileName);
    let real: string;
    let realDir: string;
    try {
      [real, realDir] = await Promise.all([fs.realpath(file), fs.realpath(outDir)]);
    } catch {
      throw new NotFoundError(`File ${fileName} non trovato nella cartella output`);
    }
    if (!real.startsWith(realDir + path.sep)) throw unavailable;
    return { file: real, fileName };
  }
}

/**
 * Campi che solo il server può valorizzare (all'emissione o con le azioni dedicate):
 * quelli inviati dal client vengono sempre ignorati.
 */
const SERVER_ONLY_FIELDS = {
  status: 'draft',
  number: undefined,
  sequence: undefined,
  issuedAt: undefined,
  uploadedAt: undefined,
  sdiNotes: undefined,
  transmissionSequence: undefined,
  xmlFileName: undefined,
  pdfFileName: undefined,
  convertedToId: undefined,
} as const;

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function stripId<T extends { id: string }>(value: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = value;
  return rest;
}
