import fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';
import type { Document, Issuer, Totals } from '@open2bill/core';
import { fileExists } from '../storage/yaml-file';
import { buildViewModel } from './view-model';

// Rendering del documento in HTML autonomo (CSS e font incorporati), usato sia
// per l'anteprima nella UI sia per generare il PDF.
//
// Template: <cartella dati>/templates/<nome>/invoice.hbs (+ style.css) se esiste,
// altrimenti quello incluso in assets/templates/<nome>, altrimenti "default".

const FONT_FILES: { file: string; family: string; weight: number; style: 'normal' | 'italic' }[] = [
  { file: 'ibm-plex-sans-latin-400-normal.woff2', family: 'Plex Sans', weight: 400, style: 'normal' },
  { file: 'ibm-plex-sans-latin-400-italic.woff2', family: 'Plex Sans', weight: 400, style: 'italic' },
  { file: 'ibm-plex-sans-latin-500-normal.woff2', family: 'Plex Sans', weight: 500, style: 'normal' },
  { file: 'ibm-plex-sans-latin-600-normal.woff2', family: 'Plex Sans', weight: 600, style: 'normal' },
  { file: 'ibm-plex-mono-latin-400-normal.woff2', family: 'Plex Mono', weight: 400, style: 'normal' },
];

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export class TemplateRenderer {
  private fontCss: string | null = null;
  private compiled = new Map<string, { mtimeMs: number; fn: Handlebars.TemplateDelegate; css: string }>();
  private readonly hbs = Handlebars.create();

  constructor(
    private readonly assetsDir: string,
    private readonly dataDir: string,
  ) {
    this.hbs.registerHelper('nl2br', (text: unknown) => {
      const escaped = Handlebars.escapeExpression(String(text ?? ''));
      return new Handlebars.SafeString(escaped.replace(/\r?\n/g, '<br>'));
    });
    this.hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  }

  /** Cartelle in cui cercare il template, in ordine di priorità. */
  private async resolveTemplateDir(name: string): Promise<string> {
    const candidates = [
      path.join(this.dataDir, 'templates', name),
      path.join(this.assetsDir, 'templates', name),
      path.join(this.assetsDir, 'templates', 'default'),
    ];
    for (const dir of candidates) {
      if (await fileExists(path.join(dir, 'invoice.hbs'))) return dir;
    }
    throw new Error('Template PDF non trovato');
  }

  private async loadTemplate(name: string) {
    const dir = await this.resolveTemplateDir(name);
    const hbsFile = path.join(dir, 'invoice.hbs');
    const cssFile = path.join(dir, 'style.css');
    const stat = await fs.stat(hbsFile);
    const cssStat = await fs.stat(cssFile).catch(() => null);
    const mtimeMs = stat.mtimeMs + (cssStat?.mtimeMs ?? 0);
    const cached = this.compiled.get(dir);
    if (cached && cached.mtimeMs === mtimeMs) return cached;
    const fn = this.hbs.compile(await fs.readFile(hbsFile, 'utf8'), { strict: false });
    const css = cssStat ? await fs.readFile(cssFile, 'utf8') : '';
    const entry = { mtimeMs, fn, css };
    this.compiled.set(dir, entry);
    return entry;
  }

  private async getFontCss(): Promise<string> {
    if (this.fontCss !== null) return this.fontCss;
    const rules: string[] = [];
    for (const f of FONT_FILES) {
      const file = path.join(this.assetsDir, 'fonts', f.file);
      if (!(await fileExists(file))) continue;
      const b64 = (await fs.readFile(file)).toString('base64');
      rules.push(
        `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};` +
          `src:url(data:font/woff2;base64,${b64}) format('woff2');}`,
      );
    }
    this.fontCss = rules.join('\n');
    return this.fontCss;
  }

  private async getLogo(issuer: Issuer): Promise<string | undefined> {
    if (!issuer.pdf.logo) return undefined;
    const file = path.resolve(this.dataDir, issuer.pdf.logo);
    // il logo deve stare nella cartella dati
    if (!file.startsWith(path.resolve(this.dataDir))) return undefined;
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()];
    if (!mime || !(await fileExists(file))) return undefined;
    return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
  }

  async renderHtml(doc: Document, issuer: Issuer, totals: Totals): Promise<string> {
    const template = await this.loadTemplate(issuer.pdf.template);
    const vm = buildViewModel(doc, issuer, totals);
    return template.fn({
      ...vm,
      css: template.css,
      fontCss: await this.getFontCss(),
      logo: await this.getLogo(issuer),
    });
  }
}
