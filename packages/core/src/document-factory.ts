import type { CatalogItem, CustomerData, Document, DocumentKind, DocumentLine, Issuer } from './model';
import { addDays, todayIso } from './validators';

// Creazione di nuovi documenti a partire dai predefiniti dell'emittente,
// conversione proforma → fattura e creazione della nota di credito.

export function newDraftId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `draft-${stamp}-${rand}`;
}

export function emptyLine(issuer: Issuer): DocumentLine {
  return {
    kind: 'service',
    description: '',
    quantity: 1,
    unitPrice: 0,
    vatRate: issuer.defaults.vatRate,
    withholding: true,
    pensionFund: true,
  };
}

export function lineFromCatalog(item: CatalogItem, issuer: Issuer): DocumentLine {
  return {
    kind: item.kind,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
    vatRate: item.kind === 'passThroughExpense' ? 0 : (item.vatRate ?? issuer.defaults.vatRate),
    vatNature: item.kind === 'passThroughExpense' ? 'N1' : item.vatNature,
    withholding: item.kind === 'passThroughExpense' ? false : item.withholding,
    pensionFund: item.kind === 'passThroughExpense' ? false : item.pensionFund,
  };
}

export function passThroughExpenseLine(description = 'Spese anticipate in nome e per conto del cliente'): DocumentLine {
  return {
    kind: 'passThroughExpense',
    description,
    quantity: 1,
    unitPrice: 0,
    vatRate: 0,
    vatNature: 'N1',
    withholding: false,
    pensionFund: false,
  };
}

export function newDocument(
  issuer: Issuer,
  options: { type?: DocumentKind; customer?: CustomerData; customerId?: string; today?: string } = {},
): Document {
  const date = options.today ?? todayIso();
  const type = options.type ?? 'TD01';
  const isIndividual = options.customer?.kind === 'individual';
  return {
    id: newDraftId(),
    type,
    status: 'draft',
    date,
    customerId: options.customerId,
    customer: options.customer ?? emptyCustomer(),
    lines: [emptyLine(issuer)],
    pensionFund: issuer.defaults.pensionFund ?? null,
    withholding: isIndividual ? null : (issuer.defaults.withholding ?? null),
    stampDuty: null,
    payment: {
      ...issuer.payment,
      dueDate: addDays(date, issuer.payment.dueDays),
    },
    reason: issuer.defaults.reason,
    linkedInvoice: null,
  };
}

// ── Dati bancari ─────────────────────────────────────────────
// Il documento copia banca, IBAN e beneficiario dall'emittente quando nasce. Se poi
// cambiano in Impostazioni, le bozze che avevano quelli di prima li aggiornano;
// nell'editor si possono riprendere anche a mano.

export interface BankDetails {
  bankName?: string;
  iban?: string;
  beneficiary?: string;
}

const comparableIban = (iban?: string) => (iban ?? '').replace(/\s+/g, '').toUpperCase();
const comparableText = (text?: string) => (text ?? '').trim();

/** Stessa banca, stesso IBAN (spazi e maiuscole a parte) e stesso beneficiario. */
export function sameBankDetails(a: BankDetails | null | undefined, b: BankDetails | null | undefined): boolean {
  return (
    comparableIban(a?.iban) === comparableIban(b?.iban) &&
    comparableText(a?.bankName) === comparableText(b?.bankName) &&
    comparableText(a?.beneficiary) === comparableText(b?.beneficiary)
  );
}

/** Il pagamento con banca, IBAN e beneficiario presi da `from`; il resto non cambia. */
export function withBankDetails<T extends BankDetails>(payment: T, from: BankDetails): T {
  return { ...payment, bankName: from.bankName, iban: from.iban, beneficiary: from.beneficiary };
}

export function emptyCustomer(): CustomerData {
  return {
    kind: 'company',
    vatCountry: 'IT',
    address: { street: '', postalCode: '', city: '', country: 'IT' },
    recipientCode: '0000000',
  };
}

/** Bozza di fattura con gli stessi contenuti della proforma. */
export function proformaToInvoice(proforma: Document, today: string = todayIso()): Document {
  if (proforma.type !== 'proforma') throw new Error('Il documento non è una proforma');
  return {
    ...stripIssueData(proforma),
    id: newDraftId(),
    type: 'TD01',
    date: today,
    payment: proforma.payment
      ? { ...proforma.payment, dueDate: addDays(today, proforma.payment.dueDays) }
      : null,
    sourceProformaId: proforma.id,
  };
}

/** Bozza di nota di credito che storna integralmente la fattura indicata. */
export function invoiceToCreditNote(invoice: Document, today: string = todayIso()): Document {
  if (invoice.type !== 'TD01' && invoice.type !== 'TD06') {
    throw new Error('La nota di credito si crea da una fattura emessa');
  }
  if (!invoice.number) throw new Error('La fattura non è ancora stata emessa');
  return {
    ...stripIssueData(invoice),
    id: newDraftId(),
    type: 'TD04',
    date: today,
    linkedInvoice: { number: invoice.number, date: invoice.date },
    reason: `Storno fattura n. ${invoice.number} del ${formatItalianDate(invoice.date)}`,
    payment: invoice.payment ? { ...invoice.payment, dueDate: today } : null,
  };
}

/** Copia di un documento come nuova bozza (stesso tipo, data di oggi). */
export function duplicateDocument(doc: Document, today: string = todayIso()): Document {
  return {
    ...stripIssueData(doc),
    id: newDraftId(),
    date: today,
    payment: doc.payment ? { ...doc.payment, dueDate: addDays(today, doc.payment.dueDays) } : null,
  };
}

function stripIssueData(doc: Document): Document {
  return {
    ...doc,
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
    sourceProformaId: undefined,
    lines: doc.lines.map((l) => ({ ...l })),
  };
}

export function formatItalianDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
