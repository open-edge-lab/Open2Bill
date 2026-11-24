import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CatalogSchema,
  DOCUMENT_KINDS,
  DocumentSchema,
  validateCustomer,
  validateIssuer,
  type DocumentKind,
} from '@open2bill/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DataStore } from '../storage/data-store';
import type { DocumentService } from '../services/document-service';
import { fileExists } from '../storage/yaml-file';

// Route dell'API REST (JSON). Gli errori sono gestiti centralmente in app.ts.

export interface ApiContext {
  store: DataStore;
  documents: DocumentService;
  assetsDir: string;
  appInfo: { version: string; desktop: boolean; pdfAvailable: boolean };
}

const idParams = z.object({ id: z.string() });
const statusBody = z.object({
  status: z.enum(['issued', 'uploaded']),
  uploadedAt: z.string().optional(),
  sdiNotes: z.string().optional(),
});

export function registerApiRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { store, documents } = ctx;

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/app', async () => ({
    ...ctx.appInfo,
    dataDir: ctx.appInfo.desktop ? store.root : undefined,
    hasIssuer: await store.hasIssuer(),
  }));

  // ── Emittente ──────────────────────────────────────────────
  app.get('/api/issuer', async () => {
    const issuer = await store.getIssuer();
    return { issuer, issues: validateIssuer(issuer) };
  });

  app.put('/api/issuer', async (req) => {
    const issuer = await store.saveIssuer(req.body);
    return { issuer, issues: validateIssuer(issuer) };
  });

  // ── Clienti ────────────────────────────────────────────────
  app.get('/api/customers', async () => store.listCustomers());

  app.get('/api/customers/:id', async (req) => store.getCustomer(idParams.parse(req.params).id));

  app.post('/api/customers', async (req, reply) => {
    const customer = await store.createCustomer(req.body as Record<string, unknown>);
    reply.code(201);
    return { customer, issues: validateCustomer(customer, 'customer') };
  });

  app.put('/api/customers/:id', async (req) => {
    const customer = await store.saveCustomer(idParams.parse(req.params).id, req.body as Record<string, unknown>);
    return { customer, issues: validateCustomer(customer, 'customer') };
  });

  app.delete('/api/customers/:id', async (req, reply) => {
    await store.deleteCustomer(idParams.parse(req.params).id);
    reply.code(204);
  });

  // ── Catalogo ───────────────────────────────────────────────
  app.get('/api/catalog', async () => store.getCatalog());
  app.put('/api/catalog', async (req) => store.saveCatalog(CatalogSchema.parse(req.body)));

  // ── Documenti ──────────────────────────────────────────────
  app.get('/api/documents', async () => store.listDocumentSummaries());

  /** Nuovo documento non salvato, precompilato con i predefiniti dell'emittente. */
  app.get('/api/documents/new', async (req) => {
    const q = z
      .object({ type: z.enum(DOCUMENT_KINDS).default('TD01'), customerId: z.string().optional() })
      .parse(req.query);
    return documents.template(q.type as DocumentKind, q.customerId);
  });

  app.get('/api/documents/:id', async (req) => documents.details(idParams.parse(req.params).id));

  app.post('/api/documents', async (req, reply) => {
    const doc = await documents.createDraft(req.body);
    reply.code(201);
    return documents.details(doc.id);
  });

  app.put('/api/documents/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    await documents.updateDraft(id, req.body);
    return documents.details(id);
  });

  app.delete('/api/documents/:id', async (req, reply) => {
    await documents.deleteDraft(idParams.parse(req.params).id);
    reply.code(204);
  });

  app.post('/api/documents/:id/issue', async (req) => documents.issue(idParams.parse(req.params).id));

  app.post('/api/documents/:id/convert', async (req) => documents.convertProforma(idParams.parse(req.params).id));

  app.post('/api/documents/:id/credit-note', async (req) => documents.creditNote(idParams.parse(req.params).id));

  app.post('/api/documents/:id/duplicate', async (req) => documents.duplicate(idParams.parse(req.params).id));

  app.post('/api/documents/:id/status', async (req) => {
    const body = statusBody.parse(req.body);
    return documents.setStatus(idParams.parse(req.params).id, body.status, body);
  });

  app.post('/api/documents/:id/regenerate-pdf', async (req) =>
    documents.regeneratePdf(idParams.parse(req.params).id),
  );

  for (const kind of ['xml', 'pdf'] as const) {
    app.get(`/api/documents/:id/${kind}`, async (req, reply) => {
      const { file, fileName } = await documents.outputFile(idParams.parse(req.params).id, kind);
      const inline = (req.query as { inline?: string }).inline === '1';
      reply
        .header('Content-Type', kind === 'xml' ? 'application/xml; charset=utf-8' : 'application/pdf')
        .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`);
      return reply.send(await fs.readFile(file));
    });
  }

  // ── Anteprima e validazione (documento non ancora salvato) ─
  app.post('/api/preview/html', async (req, reply) => {
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return documents.previewHtml(req.body);
  });

  app.post('/api/preview/pdf', async (req, reply) => {
    const issuer = await store.getIssuer();
    const pdf = await documents.renderPdf(DocumentSchema.parse(req.body), issuer);
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', 'inline; filename="anteprima.pdf"');
    return reply.send(Buffer.from(pdf));
  });

  app.post('/api/validate', async (req) => documents.validate(req.body));

  // ── Template ───────────────────────────────────────────────
  /** Copia il template predefinito nella cartella dati per personalizzarlo. */
  app.post('/api/templates/customize', async (req) => {
    const { name } = z.object({ name: z.string().regex(/^[a-z0-9-]+$/).default('custom') }).parse(req.body ?? {});
    const target = path.join(store.paths.templatesDir, name);
    if (await fileExists(path.join(target, 'invoice.hbs'))) {
      return { created: false, dir: ctx.appInfo.desktop ? target : undefined };
    }
    await fs.mkdir(target, { recursive: true });
    const source = path.join(ctx.assetsDir, 'templates', 'default');
    for (const f of await fs.readdir(source)) await fs.copyFile(path.join(source, f), path.join(target, f));
    return { created: true, dir: ctx.appInfo.desktop ? target : undefined };
  });
}
