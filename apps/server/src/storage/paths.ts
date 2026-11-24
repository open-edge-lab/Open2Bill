import path from 'node:path';

// Struttura della cartella dati (vedi README):
//   issuer.yaml, catalog.yaml, state.yaml
//   customers/<id>.yaml
//   documents/drafts/<id>.yaml, documents/<anno>/<id>.yaml
//   output/<anno>/<file xml e pdf>
//   templates/<nome>/invoice.hbs + style.css (facoltativi, sovrascrivono quelli inclusi)

export class DataPaths {
  constructor(readonly root: string) {}

  get issuer() {
    return path.join(this.root, 'issuer.yaml');
  }
  get catalog() {
    return path.join(this.root, 'catalog.yaml');
  }
  get state() {
    return path.join(this.root, 'state.yaml');
  }
  get customersDir() {
    return path.join(this.root, 'customers');
  }
  customer(id: string) {
    return path.join(this.customersDir, `${safeId(id)}.yaml`);
  }
  get documentsDir() {
    return path.join(this.root, 'documents');
  }
  get draftsDir() {
    return path.join(this.documentsDir, 'drafts');
  }
  /** Le bozze stanno in drafts/, i documenti emessi nella cartella dell'anno. */
  document(id: string) {
    const safe = safeId(id);
    if (safe.startsWith('draft-')) return path.join(this.draftsDir, `${safe}.yaml`);
    const year = safe.slice(0, 4);
    if (!/^\d{4}$/.test(year)) throw new Error(`Id documento non valido: ${id}`);
    return path.join(this.documentsDir, year, `${safe}.yaml`);
  }
  outputDir(year: string | number) {
    return path.join(this.root, 'output', String(year));
  }
  get templatesDir() {
    return path.join(this.root, 'templates');
  }
}

/** Impedisce path traversal negli id che arrivano dalle URL. */
export function safeId(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(id)) throw new InvalidIdError(id);
  return id;
}

export class InvalidIdError extends Error {
  constructor(id: string) {
    super(`Id non valido: ${id}`);
  }
}
