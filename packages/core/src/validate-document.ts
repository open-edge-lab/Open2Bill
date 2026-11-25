import { calculateTotals, type Totals } from './calc';
import { STAMP_DUTY_THRESHOLD } from './codes';
import type { Customer, CustomerData, Document, Issuer } from './model';
import { formatAmount, toDec } from './money';
import {
  daysBetween,
  isValidEmail,
  isValidIban,
  isValidPostalCode,
  isValidProvince,
  isValidRecipientCode,
  isValidTaxCode,
  vatNumberProblem,
  todayIso,
} from './validators';

// Controlli di merito prima dell'emissione. Ogni problema ha un percorso del campo
// (per evidenziarlo nella UI) e un messaggio in italiano.

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  path: string;
  message: string;
  severity: IssueSeverity;
}

const COMMON_VAT_RATES = new Set(['0.00', '4.00', '5.00', '10.00', '22.00']);

const VAT_NUMBER_PROBLEMS = {
  format: 'deve avere 11 cifre (il prefisso IT si può omettere)',
} as const;

export function validateIssuer(issuer: Issuer): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path: `issuer.${path}`, message, severity: 'error' });
  const warn = (path: string, message: string) =>
    issues.push({ path: `issuer.${path}`, message, severity: 'warning' });

  if (issuer.vatCountry === 'IT') {
    const problem = vatNumberProblem(issuer.vatNumber);
    if (problem) err('vatNumber', `Partita IVA dell’emittente non valida: ${VAT_NUMBER_PROBLEMS[problem]}`);
  }
  if (issuer.taxCode && !isValidTaxCode(issuer.taxCode)) err('taxCode', 'Codice fiscale dell’emittente non valido');
  checkAddress(issuer.address, (p, m) => err(`address.${p}`, m), (p, m) => warn(`address.${p}`, m));
  if (issuer.payment.iban && !isValidIban(issuer.payment.iban)) err('payment.iban', 'IBAN dell’emittente non valido');
  if (issuer.contacts.email && !isValidEmail(issuer.contacts.email)) warn('contacts.email', 'Email non valida');
  return issues;
}

export function validateCustomer(customer: CustomerData | Customer, prefix = 'customer'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path: `${prefix}.${path}`, message, severity: 'error' });
  const warn = (path: string, message: string) =>
    issues.push({ path: `${prefix}.${path}`, message, severity: 'warning' });

  if (customer.kind === 'company') {
    if (!customer.companyName) err('companyName', 'Denominazione obbligatoria');
  } else if (!customer.companyName && !(customer.firstName && customer.lastName)) {
    err('lastName', 'Nome e cognome obbligatori');
  }

  if (customer.kind !== 'individual' && !customer.vatNumber) {
    err('vatNumber', 'Partita IVA obbligatoria per aziende e professionisti');
  }
  if (!customer.vatNumber && !customer.taxCode) {
    err('taxCode', 'Serve almeno la partita IVA o il codice fiscale');
  }
  if (customer.vatNumber && customer.vatCountry === 'IT') {
    const problem = vatNumberProblem(customer.vatNumber);
    if (problem) err('vatNumber', `Partita IVA non valida: ${VAT_NUMBER_PROBLEMS[problem]}`);
  }
  if (customer.taxCode && !isValidTaxCode(customer.taxCode)) err('taxCode', 'Codice fiscale non valido');

  if (customer.address.country !== 'IT') {
    err('address.country', 'I clienti esteri non sono ancora supportati');
  }
  checkAddress(customer.address, (p, m) => err(`address.${p}`, m), (p, m) => warn(`address.${p}`, m));

  if (!isValidRecipientCode(customer.recipientCode)) {
    err('recipientCode', 'Il codice destinatario deve avere 7 caratteri (lettere maiuscole e cifre)');
  }
  if (customer.pec && !isValidEmail(customer.pec)) err('pec', 'PEC non valida');
  if (customer.kind !== 'individual' && customer.recipientCode === '0000000' && !customer.pec) {
    warn(
      'recipientCode',
      'Nessun codice destinatario né PEC: la fattura sarà consegnata nell’area riservata del cliente',
    );
  }
  return issues;
}

function checkAddress(
  address: { street: string; postalCode: string; city: string; province?: string; country: string },
  err: (path: string, message: string) => void,
  warn: (path: string, message: string) => void,
) {
  if (address.country !== 'IT') return;
  if (!isValidPostalCode(address.postalCode)) err('postalCode', 'Il CAP deve avere 5 cifre');
  if (!address.province) warn('province', 'Provincia mancante');
  else if (!isValidProvince(address.province)) err('province', 'Sigla provincia di 2 lettere maiuscole');
}

export interface DocumentValidation {
  issues: ValidationIssue[];
  totals: Totals;
  /** Vero se non ci sono errori bloccanti. */
  ok: boolean;
}

export function validateDocument(
  doc: Document,
  issuer: Issuer,
  options: { today?: string } = {},
): DocumentValidation {
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, severity: 'error' });
  const warn = (path: string, message: string) => issues.push({ path, message, severity: 'warning' });
  const isProforma = doc.type === 'proforma';
  const today = options.today ?? todayIso();

  issues.push(...validateIssuer(issuer));
  const customerIssues = validateCustomer(doc.customer);
  // Per la proforma servono solo i dati anagrafici minimi.
  issues.push(...(isProforma ? customerIssues.filter((i) => i.severity === 'error' && !/recipientCode|pec/.test(i.path)) : customerIssues));

  // Date
  if (daysBetween(today, doc.date) > 0) {
    err('date', 'La data del documento non può essere futura');
  } else if (!isProforma && doc.status === 'draft' && daysBetween(doc.date, today) > 12) {
    warn('date', 'Sono passati più di 12 giorni dalla data: per la fattura immediata l’invio è tardivo');
  }

  // Righe
  if (doc.lines.length === 0) err('lines', 'Inserisci almeno una riga');
  doc.lines.forEach((line, i) => {
    const p = `lines.${i}`;
    if (!line.description.trim()) err(`${p}.description`, 'Descrizione obbligatoria');
    if (toDec(line.quantity).lte(0)) err(`${p}.quantity`, 'La quantità deve essere maggiore di zero');
    if (toDec(line.unitPrice).isNegative()) err(`${p}.unitPrice`, 'Il prezzo non può essere negativo');
    if (line.kind === 'service') {
      const rate = toDec(line.vatRate).toFixed(2);
      if (rate === '0.00' && !line.vatNature) err(`${p}.vatNature`, 'Con IVA 0% indica la natura dell’operazione');
      if (!COMMON_VAT_RATES.has(rate)) warn(`${p}.vatRate`, `Aliquota IVA insolita (${rate}%)`);
    }
  });

  // Cassa
  if (doc.pensionFund) {
    if (toDec(doc.pensionFund.rate).lte(0)) err('pensionFund.rate', 'Aliquota della cassa non valida');
    if (toDec(doc.pensionFund.vatRate).isZero() && !doc.pensionFund.vatNature) {
      err('pensionFund.vatNature', 'Con IVA 0% sul contributo indica la natura');
    }
  }

  const totals = calculateTotals(doc);

  // Ritenuta
  if (doc.withholding) {
    if (doc.customer.kind === 'individual') {
      err('withholding', 'Ai clienti privati non si applica la ritenuta d’acconto');
    }
    const anySubject = doc.lines.some((l) => l.kind === 'service' && l.withholding);
    if (!anySubject) err('withholding', 'Ritenuta attiva ma nessuna riga è soggetta a ritenuta');
  }

  // Bollo
  if (totals.stampDutySuggested) {
    warn(
      'stampDuty',
      `Importi senza IVA per ${formatAmount(totals.stampDutyBase)} € (oltre ${formatAmount(STAMP_DUTY_THRESHOLD)} €): serve la marca da bollo da 2,00 €`,
    );
  }

  // Nota di credito
  if (doc.type === 'TD04' && !doc.linkedInvoice) {
    err('linkedInvoice', 'La nota di credito deve indicare la fattura collegata');
  }

  // Pagamento
  if (doc.payment?.method === 'MP05' && !doc.payment.iban) {
    warn('payment.iban', 'Pagamento con bonifico senza IBAN');
  }
  if (doc.payment?.iban && !isValidIban(doc.payment.iban)) err('payment.iban', 'IBAN non valido');

  if (toDec(totals.documentTotal).lte(0)) err('lines', 'Il totale del documento deve essere maggiore di zero');

  return { issues, totals, ok: !issues.some((i) => i.severity === 'error') };
}
