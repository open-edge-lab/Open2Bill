import Decimal from 'decimal.js';

// Istanza dedicata: arrotondamento commerciale (half-up), precisione ampia.
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;

export type DecimalInput = Dec | number | string;

export const ZERO = new Dec(0);
export const HUNDRED = new Dec(100);

export function toDec(value: DecimalInput | null | undefined): Dec {
  if (value === null || value === undefined || value === '') return ZERO;
  if (value instanceof Dec) return value;
  // Accetta anche la virgola decimale all'italiana ("1.442,31" non è supportato: solo "1442,31").
  const v = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  return new Dec(v);
}

/** Arrotonda a 2 decimali con half-up (regola usata per importi e imposte). */
export function round2(value: DecimalInput): Dec {
  return toDec(value).toDecimalPlaces(2, Dec.ROUND_HALF_UP);
}

/** Percentuale: amount × rate / 100, arrotondato a 2 decimali. */
export function percentOf(amount: DecimalInput, rate: DecimalInput): Dec {
  return round2(toDec(amount).times(toDec(rate)).dividedBy(HUNDRED));
}

export function sum(values: Iterable<DecimalInput>): Dec {
  let total = ZERO;
  for (const v of values) total = total.plus(toDec(v));
  return total;
}

/** Stringa con esattamente 2 decimali e punto decimale ("1442.31"), formato FatturaPA. */
export function fixed2(value: DecimalInput): string {
  return round2(value).toFixed(2);
}

/** Stringa con da `min` a `max` decimali (es. quantità e prezzi unitari FatturaPA). */
export function fixedRange(value: DecimalInput, min = 2, max = 8): string {
  const d = toDec(value).toDecimalPlaces(max, Dec.ROUND_HALF_UP);
  const [intPart, fracPart = ''] = d.toFixed().split('.');
  let frac = fracPart.replace(/0+$/, '');
  if (frac.length < min) frac = frac.padEnd(min, '0');
  return `${intPart}.${frac}`;
}

// useGrouping 'always': in it-IT il separatore delle migliaia altrimenti compare solo da 10.000.
const euroFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
} as Intl.NumberFormatOptions);

/** Formato italiano per il PDF e la UI: "1.442,31". */
export function formatAmount(value: DecimalInput): string {
  return euroFormatter.format(round2(value).toNumber());
}

/** Formato italiano per percentuali: "22", "4", "20,5". */
export function formatRate(value: DecimalInput): string {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(toDec(value).toNumber());
}
