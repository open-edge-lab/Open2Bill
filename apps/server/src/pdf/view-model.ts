import {
  DOCUMENT_KIND_TITLES,
  PAYMENT_METHODS,
  PENSION_FUNDS,
  TAX_REGIMES,
  VAT_NATURES,
  codeLabel,
  displayName,
  fillLabel,
  formatAmount,
  formatItalianDate,
  formatRate,
  resolvePdfLabels,
  toDec,
  type Document,
  type Issuer,
  type PdfLabels,
  type Totals,
} from '@open2bill/core';

// Dati già formattati per il template Handlebars: il template contiene solo
// impaginazione, nessuna logica di calcolo.

export interface TotalsRow {
  label: string;
  value: string;
  kind?: 'subtotal' | 'total' | 'net' | 'muted';
}

export interface DocumentViewModel {
  labels: PdfLabels;
  accentColor: string;
  title: string;
  heading: string;
  isDraft: boolean;
  isProforma: boolean;
  isCreditNote: boolean;
  issuer: {
    name: string;
    addressLines: string[];
    taxLines: string[];
    contactLines: string[];
    taxRegime?: string;
  };
  customer: { name: string; addressLines: string[]; taxLines: string[] };
  showQuantity: boolean;
  lines: {
    description: string;
    quantity: string;
    unitPrice: string;
    vat: string;
    total: string;
    isExpense: boolean;
  }[];
  totalsRows: TotalsRow[];
  natureNotes: string[];
  payment: null | {
    method: string;
    dueDate?: string;
    iban?: string;
    bankName?: string;
    beneficiary?: string;
    amount: string;
  };
  linkedInvoiceNote?: string;
  reason?: string;
  notes?: string;
  stampDutyNote?: string;
  footer?: string;
  hasFooter: boolean;
}

function addressLines(a: Document['customer']['address']): string[] {
  const street = [a.street, a.streetNumber].filter(Boolean).join(', ');
  const city = [a.postalCode, a.city, a.province ? `(${a.province})` : ''].filter(Boolean).join(' ');
  return [street, a.country !== 'IT' ? `${city} - ${a.country}` : city].filter(Boolean);
}

/** IBAN a gruppi di 4 caratteri per la leggibilità. */
function formatIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

export function buildViewModel(doc: Document, issuer: Issuer, totals: Totals): DocumentViewModel {
  const labels = resolvePdfLabels(issuer.pdf.labels);
  const title = DOCUMENT_KIND_TITLES[doc.type];
  const isDraft = doc.status === 'draft';
  const numberPart = doc.number ? `n. ${doc.number}` : 'BOZZA';
  const heading = `${title} ${numberPart} del ${formatItalianDate(doc.date)}`;

  // Emittente
  const issuerTax: string[] = [];
  if (issuer.taxCode && issuer.taxCode !== issuer.vatNumber) issuerTax.push(`${labels.taxCode}: ${issuer.taxCode}`);
  issuerTax.push(`${labels.vatNumber}: ${issuer.vatNumber}`);
  const contactLines = [issuer.contacts.email, issuer.contacts.pec ? `${labels.pec}: ${issuer.contacts.pec}` : undefined, issuer.contacts.phone].filter(
    (v): v is string => Boolean(v),
  );

  // Cliente
  const c = doc.customer;
  const customerTax: string[] = [];
  if (c.vatNumber && c.taxCode && c.vatNumber === c.taxCode) {
    customerTax.push(`${labels.taxIds}: ${c.vatNumber}`);
  } else {
    if (c.taxCode) customerTax.push(`${labels.taxCode}: ${c.taxCode}`);
    if (c.vatNumber) customerTax.push(`${labels.vatNumber}: ${c.vatNumber}`);
  }

  // Righe
  const showQuantity = totals.lines.some((l) => !toDec(l.quantity).eq(1) || Boolean(l.unit) || Boolean(l.discountPercent));
  const lines = totals.lines.map((l) => ({
    description: l.description,
    quantity: `${formatRate(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`,
    unitPrice: `${formatAmount(l.unitPrice)}${l.discountPercent ? ` −${formatRate(l.discountPercent)}%` : ''}`,
    vat: l.vatNature ? l.vatNature : `${formatRate(l.vatRate)}%`,
    total: formatAmount(l.total),
    isExpense: l.kind === 'passThroughExpense',
  }));

  // Totali, nello stesso ordine della proforma tradizionale
  const rows: TotalsRow[] = [];
  const pf = totals.pensionFund;
  rows.push({ label: labels.servicesTotal, value: formatAmount(totals.servicesTotal) });
  if (pf) {
    const fund = pf.type === 'TC22' ? 'INPS' : codeLabel(PENSION_FUNDS, pf.type);
    rows.push({ label: pf.label || fillLabel(labels.pensionFund, { fund, rate: formatRate(pf.rate) }), value: formatAmount(pf.amount) });
    rows.push({
      label: labels.taxableTotal,
      value: formatAmount(toDec(totals.servicesTotal).plus(pf.amount)),
      kind: 'subtotal',
    });
  }
  for (const r of totals.vatSummary) {
    if (r.vatNature) continue;
    rows.push({ label: fillLabel(labels.vat_row, { rate: formatRate(r.vatRate) }), value: formatAmount(r.vatAmount) });
  }
  const stampLine = totals.lines.find((l) => l.generated === 'stampDuty');
  const expenses = toDec(totals.passThroughTotal).minus(stampLine ? stampLine.total : 0);
  if (expenses.gt(0)) rows.push({ label: labels.passThrough, value: formatAmount(expenses) });
  if (stampLine) rows.push({ label: totals.stampDuty?.label || labels.stampDuty, value: formatAmount(stampLine.total) });

  const totalLabel = doc.type === 'TD01' ? labels.documentTotal : `Totale ${title.toLowerCase()}`;
  rows.push({ label: totalLabel, value: formatAmount(totals.documentTotal), kind: 'total' });
  if (totals.withholding) {
    rows.push({
      label: totals.withholding.label || fillLabel(labels.withholding, { rate: formatRate(totals.withholding.rate) }),
      value: formatAmount(totals.withholding.amount),
    });
    rows.push({ label: labels.netPayable, value: formatAmount(totals.netPayable), kind: 'net' });
  }

  const natureNotes = totals.vatSummary
    .filter((r) => r.vatNature && r.vatNature !== 'N1')
    .map((r) => `${r.vatNature} - ${codeLabel(VAT_NATURES, r.vatNature)}: ${formatAmount(r.taxableAmount)} €`);

  const p = doc.payment;
  return {
    labels,
    accentColor: issuer.pdf.accentColor,
    title,
    heading,
    isDraft,
    isProforma: doc.type === 'proforma',
    isCreditNote: doc.type === 'TD04',
    issuer: {
      name: displayName(issuer),
      addressLines: addressLines(issuer.address),
      taxLines: issuerTax,
      contactLines,
      taxRegime: issuer.taxRegime !== 'RF01' ? `Regime fiscale: ${codeLabel(TAX_REGIMES, issuer.taxRegime)}` : undefined,
    },
    customer: { name: displayName(c), addressLines: addressLines(c.address), taxLines: customerTax },
    showQuantity,
    lines,
    totalsRows: rows,
    natureNotes,
    payment: p
      ? {
          method: codeLabel(PAYMENT_METHODS, p.method),
          dueDate: p.dueDate ? formatItalianDate(p.dueDate) : undefined,
          iban: p.iban ? formatIban(p.iban) : undefined,
          bankName: p.bankName,
          beneficiary: p.beneficiary,
          amount: formatAmount(totals.netPayable),
        }
      : null,
    linkedInvoiceNote: doc.linkedInvoice
      ? fillLabel(labels.linkedInvoice, { number: doc.linkedInvoice.number, date: formatItalianDate(doc.linkedInvoice.date) })
      : undefined,
    reason: doc.reason,
    notes: doc.notes,
    stampDutyNote: totals.stampDuty ? labels.stampDutyNote : undefined,
    footer: issuer.pdf.footer,
    hasFooter: Boolean(totals.stampDuty || issuer.pdf.footer),
  };
}
