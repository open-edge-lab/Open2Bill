import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatDocumentNumber,
  isValidIban,
  isValidTaxCode,
  isValidVatNumber,
  CustomerDataSchema,
  IssuerSchema,
  normalizeVatNumber,
  slugify,
  vatNumberProblem,
  toAscii,
  toBasicLatin,
  toLatin1,
  validateDocument,
} from '../src';
import { issuer, makeDocument } from './fixtures';

describe('validatori', () => {
  it('partita IVA', () => {
    expect(isValidVatNumber('12345678903')).toBe(true);
    expect(isValidVatNumber('12345678901')).toBe(false);
    expect(isValidVatNumber('1234567890')).toBe(false);
  });

  it('partita IVA con prefisso IT, spazi o punti', () => {
    expect(normalizeVatNumber(' IT 123.456.789-03 ')).toBe('12345678903');
    expect(normalizeVatNumber('it12345678903')).toBe('12345678903');
    // il prefisso si toglie solo se restano 11 cifre
    expect(normalizeVatNumber('ITALIA')).toBe('ITALIA');
    expect(isValidVatNumber('IT12345678903')).toBe(true);
    expect(vatNumberProblem('IT12345678903')).toBeNull();
    // la cifra di controllo non blocca: conta solo che le cifre siano 11
    expect(vatNumberProblem('12345678901')).toBeNull();
    expect(vatNumberProblem('IT1234567890')).toBe('format');
    expect(vatNumberProblem('1234567890A')).toBe('format');
    // nel modello si salva senza prefisso: è IdCodice nell'XML, il paese sta in vatCountry
    const customer = CustomerDataSchema.parse({
      kind: 'company',
      companyName: 'Esempio Software S.r.l.',
      vatNumber: 'IT 12345678903',
      address: { street: 'Via Esempio 1', postalCode: '40100', city: 'Bologna', province: 'BO' },
    });
    expect(customer.vatNumber).toBe('12345678903');
    expect(IssuerSchema.shape.vatNumber.parse('IT09876543217')).toBe('09876543217');
  });

  it('colore del PDF: solo esadecimale (finisce nel CSS del template)', () => {
    const pdf = IssuerSchema.shape.pdf;
    expect(pdf.parse({ accentColor: '#1F4E79' }).accentColor).toBe('#1F4E79');
    expect(pdf.parse({ accentColor: '#abc' }).accentColor).toBe('#abc');
    expect(pdf.parse({}).accentColor).toBe('#1f4e79');
    for (const bad of ['red', '#1f4e79; } body { background: url(http://example.com/x) }', 'url(x)', '#12345']) {
      expect(pdf.safeParse({ accentColor: bad }).success).toBe(false);
    }
  });

  it('codice fiscale persona fisica e numerico', () => {
    expect(isValidTaxCode('RSSMRA80A01H501U')).toBe(true);
    expect(isValidTaxCode('rssmra80a01h501u')).toBe(true);
    expect(isValidTaxCode('RSSMRA80A01H501X')).toBe(false);
    expect(isValidTaxCode('09876543217')).toBe(true);
    // numerico (soggetti diversi dalle persone fisiche): solo 11 cifre, come la partita IVA
    expect(isValidTaxCode('12345678901')).toBe(true);
    expect(isValidTaxCode('1234567890')).toBe(false);
  });

  it('un cliente con partita IVA e codice fiscale che non rispettano la cifra di controllo si può fatturare', () => {
    const customer = CustomerDataSchema.parse({
      kind: 'company',
      companyName: 'Esempio Software S.r.l.',
      vatNumber: '12345678901',
      taxCode: '12345678901',
      address: { street: 'Via Esempio 1', postalCode: '40100', city: 'Bologna', province: 'BO' },
    });
    const issues = validateDocument(makeDocument({ customer }), issuer).issues;
    expect(issues.filter((i) => i.path === 'customer.vatNumber' || i.path === 'customer.taxCode')).toEqual([]);
  });

  it('IBAN', () => {
    expect(isValidIban('IT60X0542811101000000123456')).toBe(true);
    expect(isValidIban('IT60 X054 2811 1010 0000 0123 456')).toBe(true);
    expect(isValidIban('IT61X0542811101000000123456')).toBe(false);
  });
});

describe('testi e formati', () => {
  it('normalizza i caratteri non ammessi da FatturaPA', () => {
    expect(toLatin1('Contrib. Inps – gest. separata 4%')).toBe('Contrib. Inps - gest. separata 4%');
    expect(toLatin1('“Assistente”\nvirtuale…')).toBe('"Assistente" virtuale...');
    expect(toLatin1('Attività però è così')).toBe('Attività però è così');
    expect(toLatin1('Łódź 10€')).toBe('Lódz 10EUR'); // ó è Latin-1: resta
    expect(toBasicLatin('Città')).toBe('Citta');
  });

  it('testo per l’XML: solo ASCII, vocali accentate con apostrofo', () => {
    expect(toAscii('Attività però è così, perché più')).toBe("Attivita' pero' e' cosi', perche' piu'");
    expect(toAscii('È PIÙ CITTÀ')).toBe("E' PIU' CITTA'");
    expect(toAscii('Muñoz Müller Ça')).toBe('Munoz Muller Ca');
    expect(toAscii('n° 3 «prova» 10€ – ½ kg ×2')).toBe('n. 3 "prova" 10EUR - 1/2 kg x2');
    expect(toAscii('Straße Æsir')).toBe('Strasse AEsir');
    expect(toAscii('Łódź')).toBe("Lo'dz");
    // ogni carattere è ASCII stampabile
    expect(toAscii('àèéìòù ÀÈÉÌÒÙ ñç ü ß § © ° ¿¡')).toMatch(/^[\x20-\x7E]*$/);
  });

  it('importi all’italiana', () => {
    expect(formatAmount('1442.31')).toBe('1.442,31');
    expect(formatAmount(57.69)).toBe('57,69');
    expect(formatAmount('1830')).toBe('1.830,00');
  });

  it('numerazione', () => {
    expect(formatDocumentNumber('{n}', 7, 2025)).toBe('7');
    expect(formatDocumentNumber('PF{n:3}/{yyyy}', 7, 2025)).toBe('PF007/2025');
    expect(formatDocumentNumber('{yy}-{n}', 12, 2026)).toBe('26-12');
  });

  it('slug', () => {
    expect(slugify('Esempio Software S.r.l.')).toBe('esempio-software-s-r-l');
  });
});

describe('validateDocument', () => {
  it('il caso golden è valido', () => {
    const v = validateDocument(makeDocument(), issuer, { today: '2025-08-14' });
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('segnala natura mancante, data futura, nota di credito senza fattura collegata', () => {
    const doc = makeDocument({
      type: 'TD04',
      date: '2025-09-01',
      lines: [{ description: 'Esente', unitPrice: 100, vatRate: 0 }],
    });
    const v = validateDocument(doc, issuer, { today: '2025-08-14' });
    const paths = v.issues.filter((i) => i.severity === 'error').map((i) => i.path);
    expect(paths).toContain('lines.0.vatNature');
    expect(paths).toContain('date');
    expect(paths).toContain('linkedInvoice');
    expect(v.ok).toBe(false);
  });

  it('niente ritenuta ai privati', () => {
    const doc = makeDocument({
      customer: {
        kind: 'individual',
        firstName: 'Laura',
        lastName: 'Bianchi',
        taxCode: 'BNCLRA85M41F205C',
        address: { street: 'Via Verdi', postalCode: '20100', city: 'Milano', province: 'MI' },
      },
    });
    const v = validateDocument(doc, issuer, { today: '2025-08-14' });
    expect(v.issues.map((i) => i.path)).toContain('withholding');
  });

  it('avvisa quando serve il bollo', () => {
    const doc = makeDocument({
      pensionFund: null,
      withholding: null,
      lines: [{ description: 'Esente', unitPrice: 100, vatRate: 0, vatNature: 'N4' }],
    });
    const v = validateDocument(doc, issuer, { today: '2025-08-14' });
    expect(v.issues).toContainEqual(expect.objectContaining({ path: 'stampDuty', severity: 'warning' }));
  });
});
