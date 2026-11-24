import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { registerAuth, type AuthConfig } from './auth';
import { registerRequestGuards } from './request-guard';
import { PdfEngineUnavailableError, type PdfEngine } from './pdf/engine';
import { PuppeteerPdfEngine } from './pdf/puppeteer-engine';
import { TemplateRenderer } from './pdf/template';
import { registerApiRoutes } from './routes/api';
import { DocumentService, ValidationFailedError } from './services/document-service';
import { ConflictError, DataStore, InvalidDataFileError, NotFoundError } from './storage/data-store';
import { InvalidIdError } from './storage/paths';
import { YamlParseError, fileExists } from './storage/yaml-file';

export interface ServerOptions {
  /** Cartella dati reale (fuori dal repository). */
  dataDir: string;
  /** Cartella degli asset (template, font). Default: apps/server/assets. */
  assetsDir?: string;
  /** Build della UI da servire come SPA (null = solo API). */
  webDir?: string | null;
  /** Motore PDF. Default: puppeteer-core con un browser di sistema. */
  pdfEngine?: PdfEngine | null;
  auth?: AuthConfig;
  logger?: boolean;
  desktop?: boolean;
  trustProxy?: boolean;
  /**
   * Il server ascolta solo in locale (default: sì): rifiuta gli Host diversi da
   * localhost/127.0.0.1/::1, contro il DNS rebinding. Va disattivato dietro un proxy pubblico.
   */
  localOnly?: boolean;
  version?: string;
}

export interface Open2BillServer {
  app: FastifyInstance;
  store: DataStore;
  documents: DocumentService;
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** Da src/ (sviluppo) o da dist/ (build) la cartella assets è un livello sopra. */
export const DEFAULT_ASSETS_DIR = path.resolve(here, '..', 'assets');

export async function createServer(options: ServerOptions): Promise<Open2BillServer> {
  const assetsDir = options.assetsDir ?? DEFAULT_ASSETS_DIR;
  const store = new DataStore(options.dataDir);
  await store.init();

  const pdfEngine = options.pdfEngine === undefined ? new PuppeteerPdfEngine() : options.pdfEngine;
  const renderer = new TemplateRenderer(assetsDir, store.root);
  const documents = new DocumentService(store, renderer, pdfEngine);

  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.trustProxy ?? false,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(fastifyCookie);
  registerRequestGuards(app, { localOnly: options.localOnly ?? true });
  registerAuth(app, options.auth ?? { mode: 'none' });

  app.setErrorHandler((err: FastifyError | Error, _req, reply) => {
    if (err instanceof ValidationFailedError) {
      return reply.code(422).send({ error: 'validation_failed', message: err.message, issues: err.issues });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'invalid_input',
        message: 'Dati non validi',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, severity: 'error' })),
      });
    }
    if (err instanceof InvalidDataFileError) {
      return reply.code(409).send({ error: 'invalid_data_file', message: err.message, details: err.details, file: path.basename(err.file) });
    }
    if (err instanceof YamlParseError) return reply.code(409).send({ error: 'yaml_error', message: err.message });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: 'not_found', message: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: 'conflict', message: err.message });
    if (err instanceof InvalidIdError) return reply.code(400).send({ error: 'invalid_id', message: err.message });
    if (err instanceof PdfEngineUnavailableError) {
      return reply.code(503).send({ error: 'pdf_unavailable', message: err.message });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: 'bad_request', message: err.message });
    reply.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Errore interno del server' });
  });

  registerApiRoutes(app, {
    store,
    documents,
    assetsDir,
    appInfo: {
      version: options.version ?? '0.1.0',
      desktop: options.desktop ?? false,
      pdfAvailable: Boolean(pdfEngine),
    },
  });

  // UI: file statici + fallback SPA
  if (options.webDir && (await fileExists(path.join(options.webDir, 'index.html')))) {
    await app.register(fastifyStatic, { root: options.webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found', message: 'Risorsa non trovata' });
    });
  }

  app.addHook('onClose', async () => {
    await pdfEngine?.close?.();
  });

  return { app, store, documents };
}
