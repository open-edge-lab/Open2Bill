import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CatalogSchema,
  CustomerSchema,
  DocumentSchema,
  IssuerSchema,
  calculateTotals,
  displayName,
  seriesFor,
  slugify,
  type Catalog,
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

const STATE_SCHEMA = z.object({ transmissionCounter: z.number().int().min(0).default(0) });

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

  /** Prossimo progressivo annuale per la serie del tipo documento (fatture, note di credito, proforma). */
  async nextSequence(type: DocumentKind, year: number): Promise<number> {
    const series = seriesFor(type);
    const docs = await this.listDocuments();
    const used = docs
      .filter((d) => d.status !== 'draft' && seriesFor(d.type) === series && d.date.startsWith(String(year)))
      .map((d) => d.sequence ?? 0);
    return Math.max(0, ...used) + 1;
  }

  // ── Stato (progressivo invio) ──────────────────────────────
  /**
   * Prossimo contatore per il ProgressivoInvio. Usa il massimo tra state.yaml e i
   * documenti già emessi, così non si riusa un progressivo anche se state.yaml si perde.
   */
  async nextTransmissionCounter(): Promise<number> {
    const file = this.paths.state;
    const state = (await fileExists(file)) ? STATE_SCHEMA.parse(await readYaml(file)) : STATE_SCHEMA.parse({});
    const fromDocs = (await this.listDocuments())
      .map((d) => (d.transmissionSequence ? parseInt(d.transmissionSequence, 36) : 0))
      .filter((n) => Number.isFinite(n));
    const next = Math.max(state.transmissionCounter, ...fromDocs, 0) + 1;
    await writeYaml(file, { transmissionCounter: next }, {
      headerComment: ' Stato interno di Open2Bill (progressivo invio dei file XML). Non modificare.',
    });
    return next;
  }
}

async function listYamlFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  return entries.filter((f) => /\.ya?ml$/i.test(f)).map((f) => path.join(dir, f)).sort();
}
