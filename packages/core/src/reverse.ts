import { type CalcInput, type Totals, calculateTotals, lineTotal } from './calc';
import { Dec, HUNDRED, ZERO, toDec } from './money';

// Calcolo a ritroso: trova il prezzo unitario di una riga che porta un totale
// del documento al valore desiderato (es. "voglio 1.500 di imponibile" → 1.442,31).

export const REVERSE_TARGETS = ['taxableTotal', 'documentTotal', 'netPayable'] as const;
export type ReverseTarget = (typeof REVERSE_TARGETS)[number];

export const REVERSE_TARGET_LABELS: Record<ReverseTarget, string> = {
  taxableTotal: 'Imponibile (compenso + contributo)',
  documentTotal: 'Totale documento',
  netPayable: 'Netto a pagare',
};

export interface ReverseResult {
  /** Prezzo unitario da impostare sulla riga (2 decimali). */
  unitPrice: string;
  /** Valore ottenuto con quel prezzo. */
  achieved: string;
  /** achieved − target (0 se esatto). */
  difference: string;
  exact: boolean;
  totals: Totals;
}

/**
 * Risolve il prezzo unitario della riga `lineIndex` (le altre righe restano ferme).
 * Il totale è lineare a meno degli arrotondamenti: si stima la soluzione con due
 * valutazioni e poi si cercano i centesimi vicini che centrano il valore esatto.
 */
export function reverseCalculation(
  input: CalcInput,
  lineIndex: number,
  target: ReverseTarget,
  targetValue: string | number,
): ReverseResult {
  const line = input.lines[lineIndex];
  if (!line) throw new Error(`Riga ${lineIndex + 1} inesistente`);

  const wanted = toDec(targetValue);
  const evaluate = (unitPrice: Dec): Totals => {
    const lines = input.lines.map((l, i) => (i === lineIndex ? { ...l, unitPrice: unitPrice.toFixed(2) } : l));
    return calculateTotals({ ...input, lines });
  };
  const metric = (t: Totals): Dec => toDec(t[target]);

  const probe = new Dec(10_000);
  const m0 = metric(evaluate(ZERO));
  const m1 = metric(evaluate(probe));
  const slope = m1.minus(m0).dividedBy(probe);
  if (slope.isZero()) throw new Error('Il valore scelto non dipende da questa riga');

  const estimate = wanted.minus(m0).dividedBy(slope).toDecimalPlaces(2);

  // Cerca nel raggio di ±5 centesimi il prezzo con lo scarto minimo (a parità, il più vicino alla stima).
  let best: { price: Dec; totals: Totals; diff: Dec } | null = null;
  for (let delta = -5; delta <= 5; delta++) {
    const price = estimate.plus(new Dec(delta).dividedBy(HUNDRED));
    if (price.isNegative()) continue;
    const totals = evaluate(price);
    const diff = metric(totals).minus(wanted);
    if (
      !best ||
      diff.abs().lt(best.diff.abs()) ||
      (diff.abs().eq(best.diff.abs()) && price.minus(estimate).abs().lt(best.price.minus(estimate).abs()))
    ) {
      best = { price, totals, diff };
    }
  }
  if (!best) throw new Error('Nessuna soluzione con importi positivi');

  return {
    unitPrice: best.price.toFixed(2),
    achieved: toDec(best.totals[target]).toFixed(2),
    difference: best.diff.toFixed(2),
    exact: best.diff.isZero(),
    totals: best.totals,
  };
}

export interface ReverseAllResult {
  /** Nuovo prezzo unitario per indice di riga (solo le prestazioni ricalcolate). */
  unitPrices: Record<number, string>;
  achieved: string;
  difference: string;
  exact: boolean;
  totals: Totals;
}

/**
 * Calcolo a ritroso su tutta la fattura: i prezzi di tutte le prestazioni si scalano in
 * proporzione (le spese art. 15 restano ferme), poi i centesimi si rifiniscono sulla riga
 * con l'importo maggiore per centrare il valore esatto.
 * Esempio: righe 1.000 + 400, imponibile desiderato 1.560 con il 4% → 1.071,43 + 428,57.
 */
export function reverseCalculationAll(
  input: CalcInput,
  target: ReverseTarget,
  targetValue: string | number,
): ReverseAllResult {
  const scalable = input.lines.flatMap((l, i) => ((l.kind ?? 'service') === 'service' ? [i] : []));
  if (scalable.length === 0) throw new Error('Non ci sono prestazioni da ricalcolare');
  if (scalable.length === 1) {
    const single = reverseCalculation(input, scalable[0]!, target, targetValue);
    return { ...single, unitPrices: { [scalable[0]!]: single.unitPrice } };
  }

  const wanted = toDec(targetValue);
  const scaled = (factor: Dec): CalcInput => ({
    ...input,
    lines: input.lines.map((l, i) =>
      scalable.includes(i) ? { ...l, unitPrice: toDec(l.unitPrice).times(factor).toDecimalPlaces(2).toFixed(2) } : l,
    ),
  });
  const metric = (t: Totals): Dec => toDec(t[target]);

  const m0 = metric(calculateTotals(scaled(ZERO)));
  const m1 = metric(calculateTotals(scaled(new Dec(1))));
  const slope = m1.minus(m0);
  if (slope.isZero()) {
    throw new Error('Per ripartire il totale su più righe serve un prezzo di partenza in almeno una prestazione');
  }
  const factor = wanted.minus(m0).dividedBy(slope);
  if (!factor.gt(0)) throw new Error('Il valore richiesto è troppo basso rispetto alle righe che non si ricalcolano');

  // Rifinitura: la riga più grande assorbe i centesimi di arrotondamento
  const base = scaled(factor);
  let largest = scalable[0]!;
  for (const i of scalable) {
    if (lineTotal(base.lines[i]!).abs().gt(lineTotal(base.lines[largest]!).abs())) largest = i;
  }
  const fine = reverseCalculation(base, largest, target, wanted.toFixed(2));

  const unitPrices: Record<number, string> = {};
  for (const i of scalable) unitPrices[i] = i === largest ? fine.unitPrice : toDec(base.lines[i]!.unitPrice).toFixed(2);
  return {
    unitPrices,
    achieved: fine.achieved,
    difference: fine.difference,
    exact: fine.exact,
    totals: fine.totals,
  };
}
