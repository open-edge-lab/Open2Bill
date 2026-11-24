import {
  STAMP_DUTY_NATURES,
  STAMP_DUTY_THRESHOLD,
  type PaymentReasonCode,
  type PensionFundCode,
  type VatNatureCode,
  type WithholdingTypeCode,
} from './codes';
import type { DocumentKind, LineKind } from './model';
import { Dec, type DecimalInput, HUNDRED, ZERO, fixed2, percentOf, round2, sum, toDec } from './money';

// Motore di calcolo dei totali. È volutamente tollerante sugli input (stringhe vuote,
// numeri come stringhe) perché la UI lo chiama a ogni modifica del form, anche con
// dati incompleti. La validazione vera è in validate-document.ts.

export interface CalcLineInput {
  kind?: LineKind;
  description?: string;
  quantity?: DecimalInput | null;
  unit?: string | null;
  unitPrice?: DecimalInput | null;
  discountPercent?: DecimalInput | null;
  vatRate?: DecimalInput | null;
  vatNature?: VatNatureCode | null;
  withholding?: boolean;
  pensionFund?: boolean;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export interface CalcPensionFundInput {
  type: PensionFundCode;
  rate: DecimalInput;
  vatRate: DecimalInput;
  vatNature?: VatNatureCode | null;
  withholding?: boolean;
  label?: string | null;
  /**
   * I prezzi delle righe comprendono già il contributo: si scorpora una volta sul
   * totale delle righe soggette a cassa (es. 1.560 → compenso 1.500 + contributo 60).
   */
  pricesIncludeContribution?: boolean;
}

export interface CalcWithholdingInput {
  type: WithholdingTypeCode;
  rate: DecimalInput;
  paymentReason: PaymentReasonCode;
  label?: string | null;
}

export interface CalcStampDutyInput {
  amount: DecimalInput;
  chargeToCustomer?: boolean;
  label?: string | null;
}

export interface CalcInput {
  type?: DocumentKind;
  lines: CalcLineInput[];
  pensionFund?: CalcPensionFundInput | null;
  withholding?: CalcWithholdingInput | null;
  stampDuty?: CalcStampDutyInput | null;
}

export interface ComputedLine {
  /** Indice della riga nel documento; null per le righe generate (bollo addebitato). */
  index: number | null;
  generated?: 'stampDuty';
  kind: LineKind;
  description: string;
  quantity: string;
  unit?: string;
  unitPrice: string;
  discountPercent?: string;
  vatRate: string;
  vatNature?: VatNatureCode;
  /** Soggetta a ritenuta (solo se il documento ha una ritenuta). */
  withholding: boolean;
  pensionFund: boolean;
  periodStart?: string;
  periodEnd?: string;
  /** Importo della riga (al netto del contributo se i prezzi lo comprendono). */
  total: string;
  /** Solo con i prezzi comprensivi del contributo: prezzo e importo inseriti. */
  grossUnitPrice?: string;
  grossTotal?: string;
}

export interface VatSummaryRow {
  vatRate: string;
  vatNature?: VatNatureCode;
  taxableAmount: string;
  vatAmount: string;
}

export interface ComputedPensionFund {
  type: PensionFundCode;
  rate: string;
  base: string;
  amount: string;
  vatRate: string;
  vatNature?: VatNatureCode;
  withholding: boolean;
  label?: string;
  pricesIncludeContribution: boolean;
  /** Con i prezzi comprensivi: totale inserito nelle righe (compenso + contributo). */
  grossTotal?: string;
  /** Con i prezzi comprensivi: (compenso + contributo) − totale inserito, di solito 0. */
  difference?: string;
}

export interface ComputedWithholding {
  type: WithholdingTypeCode;
  rate: string;
  paymentReason: PaymentReasonCode;
  base: string;
  amount: string;
  label?: string;
}

export interface Totals {
  lines: ComputedLine[];
  /** Somma delle prestazioni (righe "service"). */
  servicesTotal: string;
  /** Somma delle spese escluse art. 15, compreso il bollo addebitato. */
  passThroughTotal: string;
  pensionFund: ComputedPensionFund | null;
  vatSummary: VatSummaryRow[];
  /** Somma degli imponibili del riepilogo (comprese le operazioni senza IVA). */
  taxableTotal: string;
  /** Imponibile soggetto a IVA (righe con aliquota > 0). */
  vatableTotal: string;
  vatTotal: string;
  withholding: ComputedWithholding | null;
  stampDuty: { amount: string; chargedToCustomer: boolean; label?: string } | null;
  /** Importi che concorrono alla soglia del bollo. */
  stampDutyBase: string;
  /** Soglia del bollo superata ma bollo non presente nel documento. */
  stampDutySuggested: boolean;
  documentTotal: string;
  netPayable: string;
}

export const DEFAULT_STAMP_DUTY_LABEL = 'Imposta di bollo';

interface WorkingLine {
  input: CalcLineInput;
  index: number | null;
  generated?: 'stampDuty';
  kind: LineKind;
  vatRate: Dec;
  vatNature?: VatNatureCode;
  withholding: boolean;
  pensionFund: boolean;
  total: Dec;
  /** Prezzo unitario netto ricavato dallo scorporo del contributo. */
  netUnitPrice?: Dec;
  /** Importo inserito, comprensivo del contributo. */
  grossTotal?: Dec;
}

/** Importo di una riga: quantità × prezzo × (1 − sconto%), arrotondato a 2 decimali. */
export function lineTotal(line: Pick<CalcLineInput, 'quantity' | 'unitPrice' | 'discountPercent'>): Dec {
  const qty = line.quantity === null || line.quantity === undefined || line.quantity === '' ? 1 : line.quantity;
  const gross = toDec(qty).times(toDec(line.unitPrice));
  const discount = toDec(line.discountPercent);
  return round2(gross.times(HUNDRED.minus(discount)).dividedBy(HUNDRED));
}

/**
 * Compenso B che, sommato al suo contributo, dà l'importo comprensivo:
 * B + round2(B × aliquota%) = lordo. Si parte da lordo / (1 + aliquota%) e si provano i
 * centesimi vicini; se nessuno torna esatto si tiene il più vicino (scarto di 1 centesimo).
 */
export function baseFromInclusiveAmount(gross: DecimalInput, rate: DecimalInput): Dec {
  const g = toDec(gross);
  const r = toDec(rate);
  const estimate = round2(g.times(HUNDRED).dividedBy(HUNDRED.plus(r)));
  let best = estimate;
  let bestDiff: Dec | null = null;
  for (const delta of [0, -1, 1, -2, 2, -3, 3]) {
    const candidate = estimate.plus(new Dec(delta).dividedBy(HUNDRED));
    const diff = candidate.plus(percentOf(candidate, r)).minus(g).abs();
    if (bestDiff === null || diff.lt(bestDiff)) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Scorporo del contributo sul totale: il compenso netto si ripartisce sulle righe in
 * proporzione al loro importo, e i centesimi di arrotondamento vanno sulla riga più
 * grande. Il prezzo unitario netto ha fino a 8 decimali (ammessi da FatturaPA), così
 * quantità × prezzo torna con l'importo della riga.
 */
function applyInclusiveContribution(lines: WorkingLine[], rate: DecimalInput): Dec {
  const gross = sum(lines.map((l) => l.total));
  const base = baseFromInclusiveAmount(gross, rate);
  const nets = lines.map((l) => (gross.isZero() ? ZERO : round2(l.total.times(base).dividedBy(gross))));
  const residual = base.minus(sum(nets));
  if (!residual.isZero() && lines.length > 0) {
    let largest = 0;
    lines.forEach((l, i) => {
      if (l.total.abs().gt(lines[largest]!.total.abs())) largest = i;
    });
    nets[largest] = nets[largest]!.plus(residual);
  }
  lines.forEach((l, i) => {
    const net = nets[i]!;
    const qty = l.input.quantity === null || l.input.quantity === undefined || l.input.quantity === '' ? 1 : l.input.quantity;
    const factor = toDec(qty).times(HUNDRED.minus(toDec(l.input.discountPercent))).dividedBy(HUNDRED);
    l.grossTotal = l.total;
    l.total = net;
    l.netUnitPrice = factor.isZero() ? ZERO : net.dividedBy(factor).toDecimalPlaces(8, Dec.ROUND_HALF_UP);
  });
  return gross;
}

function summaryKey(rate: Dec, nature?: VatNatureCode): string {
  return `${rate.toFixed(2)}|${nature ?? ''}`;
}

export function calculateTotals(input: CalcInput): Totals {
  const hasWithholding = Boolean(input.withholding);
  const pf = input.pensionFund ?? null;

  // 1. Righe (normalizzate: le spese art. 15 sono sempre N1, senza ritenuta né cassa)
  const working: WorkingLine[] = input.lines.map((line, index) => {
    const kind: LineKind = line.kind ?? 'service';
    const isExpense = kind === 'passThroughExpense';
    const vatRate = isExpense ? ZERO : toDec(line.vatRate ?? 0);
    const vatNature = isExpense ? 'N1' : vatRate.isZero() ? (line.vatNature ?? undefined) : undefined;
    return {
      input: line,
      index,
      kind,
      vatRate,
      vatNature,
      withholding: !isExpense && hasWithholding && line.withholding !== false,
      pensionFund: !isExpense && Boolean(pf) && line.pensionFund !== false,
      total: lineTotal(line),
    };
  });

  // Bollo addebitato al cliente: riga generata esclusa art. 15
  const stamp = input.stampDuty ?? null;
  if (stamp && stamp.chargeToCustomer !== false) {
    const amount = round2(stamp.amount);
    working.push({
      input: {
        kind: 'passThroughExpense',
        description: stamp.label || DEFAULT_STAMP_DUTY_LABEL,
        quantity: 1,
        unitPrice: amount,
      },
      index: null,
      generated: 'stampDuty',
      kind: 'passThroughExpense',
      vatRate: ZERO,
      vatNature: 'N1',
      withholding: false,
      pensionFund: false,
      total: amount,
    });
  }

  // 2. Cassa previdenziale (con i prezzi comprensivi, prima lo scorporo sul totale)
  let pensionFund: ComputedPensionFund | null = null;
  let pensionAmount = ZERO;
  let pensionVatRate = ZERO;
  let pensionVatNature: VatNatureCode | undefined;
  if (pf) {
    const inclusive = Boolean(pf.pricesIncludeContribution);
    const grossTotal = inclusive ? applyInclusiveContribution(working.filter((l) => l.pensionFund), pf.rate) : null;
    const base = sum(working.filter((l) => l.pensionFund).map((l) => l.total));
    pensionAmount = percentOf(base, pf.rate);
    pensionVatRate = toDec(pf.vatRate);
    pensionVatNature = pensionVatRate.isZero() ? (pf.vatNature ?? undefined) : undefined;
    pensionFund = {
      type: pf.type,
      rate: fixed2(pf.rate),
      base: fixed2(base),
      amount: fixed2(pensionAmount),
      vatRate: fixed2(pensionVatRate),
      vatNature: pensionVatNature,
      withholding: hasWithholding && pf.withholding !== false,
      label: pf.label ?? undefined,
      pricesIncludeContribution: inclusive,
      grossTotal: grossTotal ? fixed2(grossTotal) : undefined,
      difference: grossTotal ? fixed2(base.plus(pensionAmount).minus(grossTotal)) : undefined,
    };
  }

  // 3. Riepilogo IVA per aliquota/natura
  const groups = new Map<string, { rate: Dec; nature?: VatNatureCode; taxable: Dec }>();
  const addToGroup = (rate: Dec, nature: VatNatureCode | undefined, amount: Dec) => {
    const key = summaryKey(rate, nature);
    const g = groups.get(key) ?? { rate, nature, taxable: ZERO };
    g.taxable = g.taxable.plus(amount);
    groups.set(key, g);
  };
  for (const l of working) addToGroup(l.vatRate, l.vatNature, l.total);
  if (pensionFund) addToGroup(pensionVatRate, pensionVatNature, pensionAmount);

  const vatSummary: VatSummaryRow[] = [...groups.values()]
    .sort((a, b) => b.rate.comparedTo(a.rate) || (a.nature ?? '').localeCompare(b.nature ?? ''))
    .map((g) => ({
      vatRate: g.rate.toFixed(2),
      vatNature: g.nature,
      taxableAmount: fixed2(g.taxable),
      vatAmount: fixed2(percentOf(g.taxable, g.rate)),
    }));

  const taxableTotal = sum(vatSummary.map((r) => r.taxableAmount));
  const vatTotal = sum(vatSummary.map((r) => r.vatAmount));
  const vatableTotal = sum(vatSummary.filter((r) => toDec(r.vatRate).gt(0)).map((r) => r.taxableAmount));

  // 4. Ritenuta
  let withholding: ComputedWithholding | null = null;
  let withholdingAmount = ZERO;
  if (input.withholding) {
    const w = input.withholding;
    let base = sum(working.filter((l) => l.withholding).map((l) => l.total));
    if (pensionFund?.withholding) base = base.plus(pensionAmount);
    withholdingAmount = percentOf(base, w.rate);
    withholding = {
      type: w.type,
      rate: fixed2(w.rate),
      paymentReason: w.paymentReason,
      base: fixed2(base),
      amount: fixed2(withholdingAmount),
      label: w.label ?? undefined,
    };
  }

  // 5. Bollo: soglia sugli importi senza IVA
  const stampDutyBase = sum(
    working
      .filter((l) => !l.generated && l.vatRate.isZero() && l.vatNature && STAMP_DUTY_NATURES.has(l.vatNature))
      .map((l) => l.total),
  ).plus(
    pensionFund && pensionVatRate.isZero() && pensionVatNature && STAMP_DUTY_NATURES.has(pensionVatNature)
      ? pensionAmount
      : ZERO,
  );

  const documentTotal = taxableTotal.plus(vatTotal);

  return {
    lines: working.map((l) => toComputedLine(l)),
    servicesTotal: fixed2(sum(working.filter((l) => l.kind === 'service').map((l) => l.total))),
    passThroughTotal: fixed2(sum(working.filter((l) => l.kind === 'passThroughExpense').map((l) => l.total))),
    pensionFund,
    vatSummary,
    taxableTotal: fixed2(taxableTotal),
    vatableTotal: fixed2(vatableTotal),
    vatTotal: fixed2(vatTotal),
    withholding,
    stampDuty: stamp
      ? {
          amount: fixed2(stamp.amount),
          chargedToCustomer: stamp.chargeToCustomer !== false,
          label: stamp.label ?? undefined,
        }
      : null,
    stampDutyBase: fixed2(stampDutyBase),
    stampDutySuggested: !stamp && stampDutyBase.gt(STAMP_DUTY_THRESHOLD),
    documentTotal: fixed2(documentTotal),
    netPayable: fixed2(documentTotal.minus(withholdingAmount)),
  };
}

function toComputedLine(l: WorkingLine): ComputedLine {
  const i = l.input;
  const discount = toDec(i.discountPercent);
  return {
    index: l.index,
    generated: l.generated,
    kind: l.kind,
    description: i.description ?? '',
    quantity: toDec(i.quantity === null || i.quantity === undefined || i.quantity === '' ? 1 : i.quantity).toFixed(),
    unit: i.unit ?? undefined,
    unitPrice: (l.netUnitPrice ?? toDec(i.unitPrice)).toFixed(),
    discountPercent: discount.isZero() ? undefined : discount.toFixed(2),
    vatRate: l.vatRate.toFixed(2),
    vatNature: l.vatNature,
    withholding: l.withholding,
    pensionFund: l.pensionFund,
    periodStart: i.periodStart ?? undefined,
    periodEnd: i.periodEnd ?? undefined,
    total: fixed2(l.total),
    grossUnitPrice: l.netUnitPrice ? toDec(i.unitPrice).toFixed() : undefined,
    grossTotal: l.grossTotal ? fixed2(l.grossTotal) : undefined,
  };
}
