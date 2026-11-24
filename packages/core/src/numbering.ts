import type { DocumentKind, Issuer } from './model';

// Numerazione dei documenti: progressivo annuale separato per fatture (TD01/TD06),
// note di credito (TD04) e proforma.

export type NumberingSeries = 'invoice' | 'creditNote' | 'proforma';

export function seriesFor(type: DocumentKind): NumberingSeries {
  if (type === 'proforma') return 'proforma';
  if (type === 'TD04') return 'creditNote';
  return 'invoice';
}

/**
 * Applica il formato di numerazione.
 * Segnaposto: {n} numero, {n:3} numero con zeri a sinistra, {yyyy} anno, {yy} anno a 2 cifre.
 */
export function formatDocumentNumber(format: string, sequence: number, year: number): string {
  return format
    .replace(/\{n(?::(\d+))?\}/g, (_m, pad?: string) => String(sequence).padStart(pad ? Number(pad) : 0, '0'))
    .replace(/\{yyyy\}/g, String(year))
    .replace(/\{yy\}/g, String(year).slice(-2));
}

export function documentNumberFor(issuer: Issuer, type: DocumentKind, sequence: number, year: number): string {
  return formatDocumentNumber(issuer.numbering[seriesFor(type)], sequence, year);
}

/** Id stabile dei documenti emessi: "2025-invoice-0001". */
export function issuedDocumentId(type: DocumentKind, sequence: number, year: number): string {
  const series = seriesFor(type) === 'creditNote' ? 'credit-note' : seriesFor(type);
  return `${year}-${series}-${String(sequence).padStart(4, '0')}`;
}
