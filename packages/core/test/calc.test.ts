import { describe, expect, it } from 'vitest';
import { baseFromInclusiveAmount, calculateTotals, lineTotal } from '../src';
import { makeDocument } from './fixtures';

describe('calculateTotals', () => {
  it('caso golden: compenso 1.442,31 con INPS 4%, IVA 22%, ritenuta 20%', () => {
    const t = calculateTotals(makeDocument());
    expect(t.servicesTotal).toBe('1442.31');
    expect(t.pensionFund).toMatchObject({ type: 'TC22', base: '1442.31', amount: '57.69', rate: '4.00' });
    expect(t.taxableTotal).toBe('1500.00');
    expect(t.vatSummary).toEqual([{ vatRate: '22.00', vatNature: undefined, taxableAmount: '1500.00', vatAmount: '330.00' }]);
    expect(t.vatTotal).toBe('330.00');
    expect(t.documentTotal).toBe('1830.00');
    expect(t.withholding).toMatchObject({ type: 'RT01', base: '1500.00', amount: '300.00', paymentReason: 'A' });
    expect(t.netPayable).toBe('1530.00');
    expect(t.stampDutySuggested).toBe(false);
  });

  it('le spese art. 15 sono escluse da cassa, ritenuta e IVA', () => {
    const doc = makeDocument({
      lines: [
        { description: 'Consulenza', unitPrice: 1000, vatRate: 22 },
        { kind: 'passThroughExpense', description: 'Marca da bollo', unitPrice: 16, vatRate: 22, withholding: true },
      ],
    });
    const t = calculateTotals(doc);
    expect(t.pensionFund?.base).toBe('1000.00');
    expect(t.pensionFund?.amount).toBe('40.00');
    expect(t.withholding?.base).toBe('1040.00');
    expect(t.withholding?.amount).toBe('208.00');
    expect(t.passThroughTotal).toBe('16.00');
    expect(t.vatSummary).toEqual([
      { vatRate: '22.00', vatNature: undefined, taxableAmount: '1040.00', vatAmount: '228.80' },
      { vatRate: '0.00', vatNature: 'N1', taxableAmount: '16.00', vatAmount: '0.00' },
    ]);
    expect(t.documentTotal).toBe('1284.80');
    expect(t.netPayable).toBe('1076.80');
    const expense = t.lines[1]!;
    expect(expense).toMatchObject({ vatRate: '0.00', vatNature: 'N1', withholding: false, pensionFund: false });
  });

  it('senza cassa e senza ritenuta', () => {
    const t = calculateTotals(makeDocument({ pensionFund: null, withholding: null }));
    expect(t.pensionFund).toBeNull();
    expect(t.withholding).toBeNull();
    expect(t.taxableTotal).toBe('1442.31');
    expect(t.vatTotal).toBe('317.31');
    expect(t.documentTotal).toBe('1759.62');
    expect(t.netPayable).toBe('1759.62');
    expect(t.lines[0]?.withholding).toBe(false);
  });

  it('cassa non soggetta a ritenuta (es. casse professionali)', () => {
    const t = calculateTotals(
      makeDocument({ pensionFund: { type: 'TC04', rate: 4, vatRate: 22, withholding: false } }),
    );
    expect(t.withholding?.base).toBe('1442.31');
    expect(t.withholding?.amount).toBe('288.46');
  });

  it('più aliquote e righe con sconto', () => {
    const t = calculateTotals(
      makeDocument({
        pensionFund: null,
        withholding: null,
        lines: [
          { description: 'A', quantity: 3, unitPrice: 33.333, vatRate: 22 },
          { description: 'B', quantity: 2, unitPrice: 50, discountPercent: 10, vatRate: 10 },
          { description: 'C', unitPrice: 100, vatRate: 0, vatNature: 'N4' },
        ],
      }),
    );
    expect(t.lines.map((l) => l.total)).toEqual(['100.00', '90.00', '100.00']);
    expect(t.vatSummary.map((r) => [r.vatRate, r.vatNature, r.taxableAmount, r.vatAmount])).toEqual([
      ['22.00', undefined, '100.00', '22.00'],
      ['10.00', undefined, '90.00', '9.00'],
      ['0.00', 'N4', '100.00', '0.00'],
    ]);
    expect(t.documentTotal).toBe('321.00');
    expect(t.stampDutySuggested).toBe(true);
    expect(t.stampDutyBase).toBe('100.00');
  });

  it('bollo addebitato al cliente diventa una riga N1', () => {
    const t = calculateTotals(
      makeDocument({
        pensionFund: null,
        withholding: null,
        lines: [{ description: 'Servizio esente', unitPrice: 500, vatRate: 0, vatNature: 'N4' }],
        stampDuty: { amount: 2, chargeToCustomer: true },
      }),
    );
    expect(t.lines).toHaveLength(2);
    expect(t.lines[1]).toMatchObject({ generated: 'stampDuty', total: '2.00', vatNature: 'N1', index: null });
    expect(t.documentTotal).toBe('502.00');
    expect(t.stampDutySuggested).toBe(false);
    expect(t.stampDuty).toEqual({ amount: '2.00', chargedToCustomer: true, label: undefined });
  });

  it('bollo a carico dell’emittente: nessuna riga aggiunta', () => {
    const t = calculateTotals(
      makeDocument({
        pensionFund: null,
        withholding: null,
        lines: [{ description: 'Servizio esente', unitPrice: 500, vatRate: 0, vatNature: 'N4' }],
        stampDuty: { amount: 2, chargeToCustomer: false },
      }),
    );
    expect(t.lines).toHaveLength(1);
    expect(t.documentTotal).toBe('500.00');
  });

  it('arrotondamenti half-up', () => {
    expect(lineTotal({ quantity: 1, unitPrice: '0.005' }).toFixed(2)).toBe('0.01');
    expect(lineTotal({ quantity: 3, unitPrice: '0.335' }).toFixed(2)).toBe('1.01');
    const t = calculateTotals({
      lines: [{ description: 'x', unitPrice: '10.25', vatRate: 22 }],
    });
    // 10,25 × 22% = 2,255 → 2,26
    expect(t.vatTotal).toBe('2.26');
  });

  it('tollera input incompleti dalla UI', () => {
    const t = calculateTotals({ lines: [{ description: '', unitPrice: '', quantity: '', vatRate: '' }] });
    expect(t.documentTotal).toBe('0.00');
  });
});

describe('prezzi con il contributo compreso (scorporo sul totale)', () => {
  const inclusive = { ...makeDocument().pensionFund!, pricesIncludeContribution: true };

  it('caso golden: 1.500 con il 4% compreso → compenso 1.442,31 + 57,69', () => {
    const t = calculateTotals(
      makeDocument({ lines: [{ description: 'Sviluppo', unitPrice: 1500, vatRate: 22 }], pensionFund: inclusive }),
    );
    expect(t.lines[0]).toMatchObject({ unitPrice: '1442.31', total: '1442.31', grossUnitPrice: '1500', grossTotal: '1500.00' });
    expect(t.pensionFund).toMatchObject({ base: '1442.31', amount: '57.69', grossTotal: '1500.00', difference: '0.00' });
    expect(t.taxableTotal).toBe('1500.00');
    expect(t.vatTotal).toBe('330.00');
    expect(t.documentTotal).toBe('1830.00');
    expect(t.withholding?.amount).toBe('300.00');
    expect(t.netPayable).toBe('1530.00');
  });

  it('il contributo si calcola una volta sul totale e il compenso si ripartisce sulle righe', () => {
    const t = calculateTotals(
      makeDocument({
        lines: [
          { description: 'Sviluppo', unitPrice: 1040, vatRate: 22 },
          { description: 'Consulenza', unitPrice: 520, vatRate: 22 },
        ],
        pensionFund: inclusive,
      }),
    );
    expect(t.lines.map((l) => l.total)).toEqual(['1000.00', '500.00']);
    expect(t.pensionFund).toMatchObject({ base: '1500.00', amount: '60.00', grossTotal: '1560.00', difference: '0.00' });
  });

  it('i centesimi di arrotondamento vanno sulla riga più grande', () => {
    const t = calculateTotals(
      makeDocument({
        lines: [
          { description: 'A', unitPrice: 100, vatRate: 22 },
          { description: 'B', unitPrice: 100, vatRate: 22 },
          { description: 'C', unitPrice: 100, vatRate: 22 },
        ],
        pensionFund: inclusive,
      }),
    );
    // 300 / 1,04 = 288,46 di compenso: 96,15 × 3 = 288,45, il centesimo in più va sulla prima
    expect(t.lines.map((l) => l.total)).toEqual(['96.16', '96.15', '96.15']);
    expect(t.pensionFund).toMatchObject({ base: '288.46', amount: '11.54', difference: '0.00' });
  });

  it('con quantità e sconto il prezzo unitario netto ha fino a 8 decimali e torna con l’importo', () => {
    const t = calculateTotals(
      makeDocument({
        lines: [{ description: 'Ore', quantity: 3, unitPrice: 100, discountPercent: 10, vatRate: 22 }],
        pensionFund: inclusive,
      }),
    );
    const line = t.lines[0]!;
    expect(line.grossTotal).toBe('270.00');
    expect(line.total).toBe(t.pensionFund!.base);
    expect(line.unitPrice).toMatch(/^\d+\.\d{1,8}$/);
    expect(lineTotal({ quantity: 3, unitPrice: line.unitPrice, discountPercent: 10 }).toFixed(2)).toBe(line.total);
  });

  it('righe escluse dalla cassa e spese art. 15 non vengono scorporate', () => {
    const t = calculateTotals(
      makeDocument({
        lines: [
          { description: 'Sviluppo', unitPrice: 1040, vatRate: 22 },
          { description: 'Licenza', unitPrice: 200, vatRate: 22, pensionFund: false },
          { kind: 'passThroughExpense', description: 'Trasferta', unitPrice: 50 },
        ],
        pensionFund: inclusive,
      }),
    );
    expect(t.lines.map((l) => l.total)).toEqual(['1000.00', '200.00', '50.00']);
    expect(t.lines[1]!.grossTotal).toBeUndefined();
    expect(t.pensionFund).toMatchObject({ base: '1000.00', amount: '40.00' });
  });

  it('compenso dal lordo: sceglie i centesimi che tornano esatti', () => {
    for (const gross of ['1500', '1560', '300', '100', '10', '0.26', '12345.67']) {
      const base = baseFromInclusiveAmount(gross, 4);
      const back = base.plus(base.times(4).dividedBy(100).toDecimalPlaces(2));
      expect(back.minus(gross).abs().lte(0.01)).toBe(true);
    }
    expect(baseFromInclusiveAmount('1560', 4).toFixed(2)).toBe('1500.00');
  });
});
