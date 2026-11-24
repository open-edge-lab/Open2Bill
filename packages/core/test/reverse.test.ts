import { describe, expect, it } from 'vitest';
import { reverseCalculation, reverseCalculationAll } from '../src';
import { makeDocument } from './fixtures';

describe('reverseCalculation', () => {
  const doc = makeDocument({ lines: [{ description: 'Sviluppo software', unitPrice: 0, vatRate: 22 }] });

  it('imponibile 1.500 → compenso 1.442,31', () => {
    const r = reverseCalculation(doc, 0, 'taxableTotal', 1500);
    expect(r.unitPrice).toBe('1442.31');
    expect(r.exact).toBe(true);
    expect(r.totals.pensionFund?.amount).toBe('57.69');
  });

  it('netto 1.530 → compenso 1.442,31', () => {
    const r = reverseCalculation(doc, 0, 'netPayable', '1530');
    expect(r.unitPrice).toBe('1442.31');
    expect(r.achieved).toBe('1530.00');
    expect(r.exact).toBe(true);
  });

  it('totale documento 1.830 → compenso 1.442,31', () => {
    const r = reverseCalculation(doc, 0, 'documentTotal', 1830);
    expect(r.unitPrice).toBe('1442.31');
    expect(r.exact).toBe(true);
  });

  it('con altre righe ferme risolve solo quella scelta', () => {
    const two = makeDocument({
      lines: [
        { description: 'Fisso', unitPrice: 500, vatRate: 22 },
        { description: 'Da calcolare', unitPrice: 0, vatRate: 22 },
      ],
    });
    const r = reverseCalculation(two, 1, 'taxableTotal', 2080);
    // (500 + x) × 1,04 = 2080 → x = 1500
    expect(r.unitPrice).toBe('1500.00');
    expect(r.exact).toBe(true);
  });

  it('segnala quando il valore non è raggiungibile al centesimo', () => {
    const r = reverseCalculation(doc, 0, 'netPayable', 1000.01);
    expect(Math.abs(Number(r.difference))).toBeLessThanOrEqual(0.01);
    if (!r.exact) expect(r.difference).not.toBe('0.00');
  });
});

describe('calcolo a ritroso su tutta la fattura', () => {
  const twoLines = (a: number, b: number, inclusive = false) =>
    makeDocument({
      lines: [
        { description: 'Sviluppo', unitPrice: a, vatRate: 22 },
        { description: 'Consulenza', unitPrice: b, vatRate: 22 },
      ],
      pensionFund: { ...makeDocument().pensionFund!, pricesIncludeContribution: inclusive },
    });

  it('scala tutte le prestazioni in proporzione (imponibile 1.560 con il 4%)', () => {
    const r = reverseCalculationAll(twoLines(1000, 400), 'taxableTotal', 1560);
    expect(r.unitPrices).toEqual({ 0: '1071.43', 1: '428.57' });
    expect(r.exact).toBe(true);
    expect(r.totals.taxableTotal).toBe('1560.00');
  });

  it('dal netto desiderato, lasciando ferme le spese art. 15', () => {
    const doc = makeDocument({
      lines: [
        { description: 'Sviluppo', unitPrice: 1000, vatRate: 22 },
        { description: 'Consulenza', unitPrice: 500, vatRate: 22 },
        { kind: 'passThroughExpense', description: 'Trasferta', unitPrice: 80 },
      ],
    });
    const r = reverseCalculationAll(doc, 'netPayable', 1610);
    expect(Object.keys(r.unitPrices)).toEqual(['0', '1']);
    expect(r.totals.lines[2]!.total).toBe('80.00');
    expect(r.achieved).toBe('1610.00');
    // le proporzioni tra le righe restano 2:1 (al centesimo)
    const [a, b] = [Number(r.unitPrices[0]), Number(r.unitPrices[1])];
    expect(Math.abs(a - 2 * b)).toBeLessThan(0.05);
  });

  it('con i prezzi comprensivi del 4% ritrova i prezzi lordi', () => {
    const r = reverseCalculationAll(twoLines(1000, 500, true), 'netPayable', 1530);
    expect(r.unitPrices).toEqual({ 0: '1000.00', 1: '500.00' });
    expect(r.totals.pensionFund).toMatchObject({ base: '1442.31', amount: '57.69' });
  });

  it('con una sola prestazione equivale al calcolo sulla riga', () => {
    const r = reverseCalculationAll(makeDocument(), 'netPayable', 1530);
    expect(r.unitPrices).toEqual({ 0: '1442.31' });
  });

  it('senza prezzi di partenza chiede di inserirne uno', () => {
    expect(() => reverseCalculationAll(twoLines(0, 0), 'netPayable', 1000)).toThrow(/prezzo di partenza/);
  });
});
