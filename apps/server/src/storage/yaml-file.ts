import fs from 'node:fs/promises';
import path from 'node:path';
import { Document as YamlDocument, isMap, isScalar, isSeq, parseDocument, type Node } from 'yaml';

// Lettura e scrittura dei file YAML della cartella dati.
// In scrittura si aggiorna il documento esistente chiave per chiave, così i
// commenti scritti a mano dall'utente restano al loro posto.

export async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export class YamlParseError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`Errore nel file ${path.basename(file)}: ${message}`);
  }
}

export async function readYaml(file: string): Promise<unknown> {
  const text = await fs.readFile(file, 'utf8');
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new YamlParseError(file, doc.errors[0]!.message);
  return doc.toJS() ?? {};
}

/** Scrittura atomica: file temporaneo + rename, per non lasciare file a metà. */
export async function writeFileAtomic(file: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, file);
}

export interface WriteYamlOptions {
  /** Commento in testa al file (solo per i file nuovi). */
  headerComment?: string;
}

export async function writeYaml(file: string, data: unknown, options: WriteYamlOptions = {}): Promise<void> {
  let doc: YamlDocument;
  if (await fileExists(file)) {
    doc = parseDocument(await fs.readFile(file, 'utf8'));
    if (doc.errors.length > 0 || !isMap(doc.contents)) {
      doc = new YamlDocument(cleanForYaml(data));
    } else {
      mergeInto(doc, [], cleanForYaml(data));
    }
  } else {
    doc = new YamlDocument(cleanForYaml(data));
    if (options.headerComment) doc.commentBefore = options.headerComment;
  }
  await writeFileAtomic(file, doc.toString({ lineWidth: 0 }));
}

/** Rimuove undefined e null in profondità (non servono nei file). */
export function cleanForYaml(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanForYaml);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = cleanForYaml(v);
    }
    return out;
  }
  return value;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function mergeInto(doc: YamlDocument, at: (string | number)[], data: unknown): void {
  const node = at.length === 0 ? doc.contents : doc.getIn(at, true);
  if (!isPlainObject(data) || !isMap(node as Node)) {
    if (at.length === 0) doc.contents = doc.createNode(data) as typeof doc.contents;
    else setPreservingComment(doc, at, data);
    return;
  }
  const map = node as unknown as { items: { key: unknown }[] };
  const existingKeys = map.items.map((i) => (isScalar(i.key) ? String(i.key.value) : String(i.key)));
  for (const key of existingKeys) {
    if (!(key in data)) doc.deleteIn([...at, key]);
  }
  for (const [key, value] of Object.entries(data)) {
    const child = doc.getIn([...at, key], true) as Node | undefined;
    if (isPlainObject(value) && child && isMap(child)) {
      mergeInto(doc, [...at, key], value);
    } else {
      setPreservingComment(doc, [...at, key], value);
    }
  }
}

function setPreservingComment(doc: YamlDocument, at: (string | number)[], value: unknown): void {
  const existing = doc.getIn(at, true) as Node | undefined;
  if (existing && isScalar(existing) && !isPlainObject(value) && !Array.isArray(value)) {
    existing.value = value;
    return;
  }
  const created = doc.createNode(value) as Node;
  if (existing && (isScalar(existing) || isMap(existing) || isSeq(existing))) {
    created.commentBefore = existing.commentBefore;
    created.comment = existing.comment;
  }
  doc.setIn(at, created);
}
