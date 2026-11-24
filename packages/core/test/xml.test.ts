import { describe, expect, it } from 'vitest';
import { invoiceToCreditNote, proformaToInvoice } from '../src';
import { buildInvoiceXml, formatTransmissionSequence } from '../src/fatturapa';
import { schemaVersionFor, validateInvoiceXsd } from '../src/fatturapa/xsd';
import { issuer, makeDocument } from './fixtures';

const el = (xml: string, name: string): string[] =>
  [...xml.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'g'))].map((m) => m[1]!);

describe('XML FatturaPA', () => {
  const result = buildInvoiceXml(makeDocument(), issuer, { transmissionSequence: '00001' });

  it('nome file e nessun problema semantico', () => {
    expect(result.fileName).toBe('ITRSSMRA80A01H501U_00001.xml');
    expect(result.issues).toEqual([]);
  });

  it('valido secondo lo schema ufficiale 1.2.3 e 1.2.4', async () => {
    for (const version of ['1.2.3', '1.2.4'] as const) {
      const v = await validateInvoiceXsd(result.xml, version);
      expect(v.errors).toEqual([]);
      expect(v.valid).toBe(true);
    }
  });

  it('contiene i dati del caso golden (cassa, riepilogo, ritenuta, pagamento)', () => {
    const xml = result.xml;
    expect(xml).toContain('versione="FPR12"');
    expect(el(xml, 'TipoDocumento')).toEqual(['TD01']);
    expect(el(xml, 'TipoCassa')).toEqual(['TC22']);
    expect(el(xml, 'AlCassa')).toEqual(['4.00']);
    expect(el(xml, 'ImportoContributoCassa')).toEqual(['57.69']);
    expect(el(xml, 'ImponibileCassa')).toEqual(['1442.31']);
    expect(el(xml, 'Ritenuta')).toEqual(['SI', 'SI']); // cassa + riga
    expect(el(xml, 'ImponibileImporto')).toEqual(['1500.00']);
    expect(el(xml, 'Imposta')).toEqual(['330.00']);
    expect(el(xml, 'EsigibilitaIVA')).toEqual(['I']);
    expect(el(xml, 'TipoRitenuta')).toEqual(['RT01']);
    expect(el(xml, 'ImportoRitenuta')).toEqual(['300.00']);
    expect(el(xml, 'AliquotaRitenuta')).toEqual(['20.00']);
    expect(el(xml, 'CausalePagamento')).toEqual(['A']);
    expect(el(xml, 'ImportoTotaleDocumento')).toEqual(['1830.00']);
    expect(el(xml, 'ModalitaPagamento')).toEqual(['MP05']);
    expect(el(xml, 'ImportoPagamento')).toEqual(['1530.00']);
    expect(el(xml, 'IBAN')).toEqual(['IT60X0542811101000000123456']);
    expect(el(xml, 'Descrizione')).toEqual([
      'Attività di progettazione e sviluppo software "Gestionale di esempio"',
    ]);
  });

  it('snapshot', () => {
    expect(result.xml).toMatchSnapshot();
  });

  it('spese art.15, bollo e sconto restano validi XSD', async () => {
    const doc = makeDocument({
      lines: [
        { description: 'Consulenza – fase 1', unitPrice: 800, quantity: 2, discountPercent: 5, vatRate: 22, unit: 'ore' },
        { kind: 'passThroughExpense', description: 'Spese di trasferta anticipate', unitPrice: 120.5 },
      ],
      stampDuty: { amount: 2, chargeToCustomer: true },
      reason: 'Prestazione professionale come da accordi. '.repeat(10),
    });
    const r = buildInvoiceXml(doc, issuer, { transmissionSequence: formatTransmissionSequence(37) });
    expect(r.issues).toEqual([]);
    expect(el(r.xml, 'Natura')).toEqual(['N1', 'N1', 'N1']);
    expect(el(r.xml, 'BolloVirtuale')).toEqual(['SI']);
    expect(el(r.xml, 'Causale').length).toBeGreaterThan(1);
    const v = await validateInvoiceXsd(r.xml, '1.2.3');
    expect(v.errors).toEqual([]);
  });

  it('prezzi con il 4% compreso: righe al netto, XML valido e senza scarti', async () => {
    const doc = makeDocument({
      lines: [
        { description: 'Ore di sviluppo', quantity: 3, unitPrice: 100, vatRate: 22, unit: 'ore' },
        { description: 'Consulenza', unitPrice: 1040, vatRate: 22 },
      ],
      pensionFund: { ...makeDocument().pensionFund!, pricesIncludeContribution: true },
    });
    const r = buildInvoiceXml(doc, issuer, { transmissionSequence: '00002' });
    expect(r.issues).toEqual([]);
    expect(el(r.xml, 'ImponibileCassa')).toEqual([r.totals.pensionFund!.base]);
    expect(el(r.xml, 'PrezzoTotale')).toEqual(r.totals.lines.map((l) => l.total));
    const v = await validateInvoiceXsd(r.xml, '1.2.3');
    expect(v.errors).toEqual([]);
  });

  it('nota di credito con fattura collegata, cliente con PEC', async () => {
    const credit = invoiceToCreditNote(makeDocument(), '2025-09-01');
    credit.number = 'NC1';
    credit.customer = { ...credit.customer, recipientCode: '0000000', pec: 'esempio@pec.example.com' };
    const r = buildInvoiceXml(credit, issuer, { transmissionSequence: '00002' });
    expect(el(r.xml, 'TipoDocumento')).toEqual(['TD04']);
    expect(el(r.xml, 'IdDocumento')).toEqual(['1']);
    expect(el(r.xml, 'PECDestinatario')).toEqual(['esempio@pec.example.com']);
    const v = await validateInvoiceXsd(r.xml, '1.2.3');
    expect(v.errors).toEqual([]);
  });

  it('la proforma non genera XML; diventa fattura con gli stessi contenuti', () => {
    const proforma = makeDocument({ type: 'proforma', number: 'PF1' });
    expect(() => buildInvoiceXml(proforma, issuer, { transmissionSequence: '00003' })).toThrow();
    const invoice = proformaToInvoice(proforma, '2025-08-20');
    expect(invoice.type).toBe('TD01');
    expect(invoice.number).toBeUndefined();
    expect(invoice.sourceProformaId).toBe(proforma.id);
    expect(invoice.lines).toEqual(proforma.lines);
  });

  it('progressivo invio e versione schema', () => {
    expect(formatTransmissionSequence(1)).toBe('00001');
    expect(formatTransmissionSequence(36)).toBe('00010');
    expect(schemaVersionFor('2026-11-23')).toBe('1.2.3');
    expect(schemaVersionFor('2027-01-11')).toBe('1.2.4');
  });
});
