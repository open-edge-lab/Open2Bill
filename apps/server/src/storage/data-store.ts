import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CatalogSchema,
  CustomerSchema,
  DocumentSchema,
  IssuerSchema,
  calculateTotals,
  displayName,
  NUMBERING_SERIES,
  seriesFor,
  slugify,
  type Catalog,
  type NumberingSeries,
  type Customer,
  type Document,
  type DocumentKind,
  type DocumentStatus,
  type Issuer,
} from '@open2bill/core';
import { z } from 'zod';
import { DataPaths } from './paths';
import { fileExists, readYaml, writeYaml } from './yaml-file';

// Accesso ai dati su file YAML. Tutti i metodi validano con gli schemi del core,
// così un errore di battitura nei file scritti a mano viene segnalato chiaramente.

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export class InvalidDataFileError extends Error {
  constructor(
    readonly file: string,
    readonly details: string[],
  ) {
    super(`Il file ${path.basename(file)} contiene dati non validi`);
  }
}

export interface DocumentSummary {
  id: string;
  type: DocumentKind;
  status: DocumentStatus;
  number?: string;
  date: string;
  customerName: string;
  documentTotal: string;
  netPayable: string;
  xmlFileName?: string;
  pdfFileName?: string;
  convertedToId?: string;
  sourceProformaId?: string;
}

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new InvalidDataFileError(
      file,
      result.error.issues.map((i) => `${i.path.join('.') || '(radice)'}: ${i.message}`),
    );
  }
  return result.data;
}

const lastSequence = z.number().int().min(0).optional();
const STATE_SCHEMA = z.object({
  transmissionCounter: z.number().int().min(0).default(0),
  /**
   * Ultimo numero usato per anno e serie, anche se impostato a mano (per esempio quando la
   * numerazione dell'anno è cominciata con un altro programma).
   */
  lastSequences: z
    .record(z.string(), z.object({ invoice: lastSequence, creditNote: lastSequence, proforma: lastSequence }))
    .default({}),
});
type State = z.infer<typeof STATE_SCHEMA>;

export interface SeriesSequences {
  /** Ultimo numero dei documenti emessi qui: il prossimo non può essere più basso. */
  lastIssuedHere: number;
  /** Ultimo numero usato: il più alto tra quelli emessi qui e quello salvato. */
  lastUsed: number;
}

export class DataStore {
  readonly paths: DataPaths;
  private issuerCache: { mtimeMs: number; issuer: Issuer } | null = null;

  constructor(dataDir: string) {
    this.paths = new DataPaths(path.resolve(dataDir));
  }

  get root(): string {
    return this.paths.root;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.paths.customersDir, { recursive: true });
    await fs.mkdir(this.paths.draftsDir, { recursive: true });
  }

  // ── Emittente ──────────────────────────────────────────────
  async hasIssuer(): Promise<boolean> {
    return fileExists(this.paths.issuer);
  }

  /** Legge issuer.yaml (con cache per data di modifica: le modifiche a mano si vedono subito). */
  async getIssuer(): Promise<Issuer> {
    const file = this.paths.issuer;
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      throw new NotFoundError('Manca il file issuer.yaml con i dati dell’emittente');
    }
    if (this.issuerCache && this.issuerCache.mtimeMs === stat.mtimeMs) return this.issuerCache.issuer;
    const issuer = parseOrThrow(IssuerSchema, await readYaml(file), file);
    this.issuerCache = { mtimeMs: stat.mtimeMs, issuer };
    return issuer;
  }

  async saveIssuer(data: unknown): Promise<Issuer> {
    const issuer = parseOrThrow(IssuerSchema, data, this.paths.issuer);
    await writeYaml(this.paths.issuer, issuer, {
      headerComment: ' Dati dell’emittente (cedente/prestatore). Puoi modificare questo file a mano.',
    });
    this.issuerCache = null;
    return issuer;
  }

  // ── Clienti ────────────────────────────────────────────────
  async listCustomers(): Promise<Customer[]> {
    const files = await listYamlFiles(this.paths.customersDir);
    const out: Customer[] = [];
    for (const f of files) {
      const id = path.basename(f, path.extname(f));
      const raw = (await readYaml(f)) as Record<string, unknown>;
      out.push(parseOrThrow(CustomerSchema, { ...raw, id }, f));
    }
    return out.sort((a, b) => displayName(a).localeCompare(displayName(b), 'it'));
  }

  async getCustomer(id: string): Promise<Customer> {
    const file = this.paths.customer(id);
    if (!(await fileExists(file))) throw new NotFoundError('Cliente non trovato');
    const raw = (await readYaml(file)) as Record<string, unknown>;
    return parseOrThrow(CustomerSchema, { ...raw, id }, file);
  }

  async createCustomer(data: Record<string, unknown>): Promise<Customer> {
    const base = slugify(displayName(data as { companyName?: string; firstName?: string; lastName?: string })) || 'cliente';
    let id = base;
    for (let i = 2; await fileExists(this.paths.customer(id)); i++) id = `${base}-${i}`;
    return this.saveCustomer(id, data);
  }

  async saveCustomer(id: string, data: Record<string, unknown>): Promise<Customer> {
    const file = this.paths.customer(id);
    const customer = parseOrThrow(CustomerSchema, { ...data, id }, file);
    const { id: _id, ...rest } = customer;
    await writeYaml(file, rest);
    return customer;
  }

  async deleteCustomer(id: string): Promise<void> {
    const file = this.paths.customer(id);
    if (!(await fileExists(file))) throw new NotFoundError('Cliente non trovato');
    await fs.rm(file);
  }

  // ── Catalogo ───────────────────────────────────────────────
  async getCatalog(): Promise<Catalog> {
    const file = this.paths.catalog;
    if (!(await fileExists(file))) return { items: [] };
    return parseOrThrow(CatalogSchema, await readYaml(file), file);
  }

  async saveCatalog(data: unknown): Promise<Catalog> {
    const catalog = parseOrThrow(CatalogSchema, data, this.paths.catalog);
    await writeYaml(this.paths.catalog, catalog, {
      headerComment: ' Voci ricorrenti da inserire velocemente nei documenti.',
    });
    return catalog;
  }

  // ── Documenti ──────────────────────────────────────────────
  async getDocument(id: string): Promise<Document> {
    const file = this.paths.document(id);
    if (!(await fileExists(file))) throw new NotFoundError('Documento non trovato');
    const raw = (await readYaml(file)) as Record<string, unknown>;
    return parseOrThrow(DocumentSchema, { ...raw, id }, file);
  }

  async saveDocument(doc: Document): Promise<Document> {
    const parsed = parseOrThrow(DocumentSchema, doc, this.paths.document(doc.id));
    const totals = calculateTotals(parsed);
    const { id: _id, ...rest } = parsed;
    // Lo snapshot dei totali serve solo a chi apre il file: in lettura vengono ricalcolati.
    await writeYaml(this.paths.document(parsed.id), {
      ...rest,
      totals: {
        taxableTotal: totals.taxableTotal,
        vatTotal: totals.vatTotal,
        documentTotal: totals.documentTotal,
        withholding: totals.withholding?.amount,
        netPayable: totals.netPayable,
      },
    });
    return parsed;
  }

  async deleteDocument(id: string): Promise<void> {
    const file = this.paths.document(id);
    if (!(await fileExists(file))) throw new NotFoundError('Documento non trovato');
    await fs.rm(file);
  }

  async listDocuments(): Promise<Document[]> {
    const dirs = await fs.readdir(this.paths.documentsDir, { withFileTypes: true }).catch(() => []);
    const docs: Document[] = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      for (const f of await listYamlFiles(path.join(this.paths.documentsDir, d.name))) {
        const id = path.basename(f, path.extname(f));
        const raw = (await readYaml(f)) as Record<string, unknown>;
        docs.push(parseOrThrow(DocumentSchema, { ...raw, id }, f));
      }
    }
    return docs.sort((a, b) => b.date.localeCompare(a.date) || (b.sequence ?? 0) - (a.sequence ?? 0));
  }

  async listDocumentSummaries(): Promise<DocumentSummary[]> {
    return (await this.listDocuments()).map((doc) => {
      const totals = calculateTotals(doc);
      return {
        id: doc.id,
        type: doc.type,
        status: doc.status,
        number: doc.number,
        date: doc.date,
        customerName: displayName(doc.customer),
        documentTotal: totals.documentTotal,
        netPayable: totals.netPayable,
        xmlFileName: doc.xmlFileName,
        pdfFileName: doc.pdfFileName,
        convertedToId: doc.convertedToId,
        sourceProformaId: doc.sourceProformaId,
      };
    });
  }

  // ── Numerazione ────────────────────────────────────────────
  /** Numeri usati nell'anno, per serie (fatture, note di credito, proforma). */
  async sequences(year: number): Promise<Record<NumberingSeries, SeriesSequences>> {
    const [state, docs] = await Promise.all([this.readState(), this.listDocuments()]);
    const saved = state.lastSequences[String(year)] ?? {};
    const entries = NUMBERING_SERIES.map((series) => {
      const lastIssuedHere = Math.max(
        0,
        ...docs
          .filter((d) => d.status !== 'draft' && seriesFor(d.type) === series && d.date.startsWith(String(year)))
          .map((d) => d.sequence ?? 0),
      );
      return [series, { lastIssuedHere, lastUsed: Math.max(lastIssuedHere, saved[series] ?? 0) }] as const;
    });
    return Object.fromEntries(entries) as Record<NumberingSeries, SeriesSequences>;
  }

  /** Prossimo progressivo annuale per la serie del tipo documento. */
  async nextSequence(type: DocumentKind, year: number): Promise<number> {
    return (await this.sequences(year))[seriesFor(type)].lastUsed + 1;
  }

  /** Salva l'ultimo numero usato di una serie (impostato a mano: può anche scendere). */
  async setLastSequence(series: NumberingSeries, year: number, last: number): Promise<void> {
    const state = await this.readState();
    const key = String(year);
    state.lastSequences[key] = { ...state.lastSequences[key], [series]: last };
    await this.writeState(state);
  }

  /** Dopo un'emissione: l'ultimo numero usato sale, se serve. */
  async recordSequence(type: DocumentKind, year: number, sequence: number): Promise<void> {
    const state = await this.readState();
    const key = String(year);
    const series = seriesFor(type);
    const current = state.lastSequences[key]?.[series] ?? 0;
    if (sequence <= current) return;
    state.lastSequences[key] = { ...state.lastSequences[key], [series]: sequence };
    await this.writeState(state);
  }

  // ── Stato (progressivo invio) ──────────────────────────────
  /**
   * Prossimo contatore per il ProgressivoInvio. Usa il massimo tra state.yaml e i
   * documenti già emessi, così non si riusa un progressivo anche se state.yaml si perde.
   */
  async nextTransmissionCounter(): Promise<number> {
    const state = await this.readState();
    const fromDocs = (await this.listDocuments())
      .map((d) => (d.transmissionSequence ? parseInt(d.transmissionSequence, 36) : 0))
      .filter((n) => Number.isFinite(n));
    const next = Math.max(state.transmissionCounter, ...fromDocs, 0) + 1;
    await this.writeState({ ...state, transmissionCounter: next });
    return next;
  }

  private async readState(): Promise<State> {
    const file = this.paths.state;
    return STATE_SCHEMA.parse((await fileExists(file)) ? await readYaml(file) : {});
  }

  /** Scrive lo stato intero: writeYaml toglie le chiavi assenti, quindi mai solo una parte. */
  private async writeState(state: State): Promise<void> {
    await writeYaml(this.paths.state, state, {
      headerComment: ' Stato interno di Open2Bill (progressivo invio e numerazione). Non modificare a mano.',
    });
  }
}

async function listYamlFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  return entries.filter((f) => /\.ya?ml$/i.test(f)).map((f) => path.join(dir, f)).sort();
}
