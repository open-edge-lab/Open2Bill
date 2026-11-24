import type { DocumentKind } from './model';

// Testi del PDF. Ogni etichetta si può sovrascrivere in issuer.yaml → pdf.labels.

export const DEFAULT_PDF_LABELS = {
  recipient: 'Spett.le',
  servicesTitle: 'Prestazioni professionali',
  description: 'Descrizione',
  quantity: 'Q.tà',
  unitPrice: 'Prezzo',
  vat: 'IVA',
  amount: 'Importo',
  servicesTotal: 'Imponibile',
  pensionFund: 'Contributo {fund} {rate}%',
  taxableTotal: 'Totale imponibile',
  vat_row: 'I.V.A. {rate}%',
  vat_nature_row: 'Operazioni {nature}',
  passThrough: 'Spese escluse art. 15 DPR 633/72',
  stampDuty: 'Imposta di bollo',
  documentTotal: 'Totale fattura',
  withholding: 'Ritenuta d’acconto {rate}%',
  netPayable: 'Netto da ricevere',
  paymentTitle: 'Pagamento',
  dueDate: 'Scadenza',
  iban: 'IBAN',
  bank: 'Banca',
  stampDutyNote: 'Imposta di bollo assolta in modo virtuale ai sensi del D.M. 17/06/2014',
  proformaNote: 'Fattura pro forma senza valore fiscale',
  linkedInvoice: 'Rif. fattura n. {number} del {date}',
  vatNumber: 'Partita IVA',
  taxCode: 'Cod. Fisc.',
  taxIds: 'Cod. Fisc. e P.IVA',
  pec: 'PEC',
  recipientCode: 'Codice destinatario',
} as const;

export type PdfLabelKey = keyof typeof DEFAULT_PDF_LABELS;
export type PdfLabels = Record<PdfLabelKey, string>;

export function resolvePdfLabels(overrides: Record<string, string> = {}): PdfLabels {
  return { ...DEFAULT_PDF_LABELS, ...overrides } as PdfLabels;
}

/** Sostituisce i segnaposto {nome} in un'etichetta. */
export function fillLabel(label: string, values: Record<string, string | number | undefined>): string {
  return label.replace(/\{(\w+)\}/g, (m, k: string) => (values[k] !== undefined ? String(values[k]) : m));
}

export const DOCUMENT_KIND_TITLES: Record<DocumentKind, string> = {
  TD01: 'Fattura',
  TD06: 'Parcella',
  TD04: 'Nota di credito',
  proforma: 'Fattura pro forma',
};

/** Parola usata nei nomi dei file PDF (in inglese, come il resto dei nomi file). */
export const DOCUMENT_KIND_FILE_WORDS: Record<DocumentKind, string> = {
  TD01: 'invoice',
  TD06: 'invoice',
  TD04: 'credit-note',
  proforma: 'proforma',
};

export const DOCUMENT_STATUS_LABELS = {
  draft: 'Bozza',
  issued: 'Emessa',
  uploaded: 'Caricata su SdI',
} as const;
