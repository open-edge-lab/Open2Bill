import { CustomerDataSchema, DocumentSchema, IssuerSchema, type Document, type DocumentInput } from '../src';

// Dati FITTIZI per i test. Mai usare dati reali qui (repo pubblico).
// Caso "golden": professionista in regime ordinario con rivalsa INPS 4%
// e ritenuta d'acconto 20% (compenso 1.442,31 → netto 1.530,00).

export const issuer = IssuerSchema.parse({
  firstName: 'Mario',
  lastName: 'Rossi',
  vatNumber: '12345678903',
  taxCode: 'RSSMRA80A01H501U',
  taxRegime: 'RF01',
  address: {
    street: 'Via Roma',
    streetNumber: '1',
    postalCode: '00100',
    city: 'Roma',
    province: 'RM',
  },
  contacts: { email: 'mario.rossi@example.com' },
  payment: {
    method: 'MP05',
    bankName: 'Banca Esempio',
    iban: 'IT60X0542811101000000123456',
    dueDays: 30,
  },
  defaults: {
    vatRate: 22,
    pensionFund: { type: 'TC22', rate: 4, vatRate: 22, withholding: true, label: 'Contrib. Inps – gest. separata 4%' },
    withholding: { type: 'RT01', rate: 20, paymentReason: 'A' },
  },
});

export const customer = CustomerDataSchema.parse({
  kind: 'company',
  companyName: 'Esempio Software S.r.l.',
  vatNumber: '09876543217',
  taxCode: '09876543217',
  address: { street: 'Via delle Prove', streetNumber: '5', postalCode: '40100', city: 'Bologna', province: 'BO' },
  recipientCode: 'ABC1234',
});

export function makeDocument(overrides: Partial<DocumentInput> = {}): Document {
  return DocumentSchema.parse({
    id: 'test-doc',
    type: 'TD01',
    date: '2025-08-14',
    number: '1',
    customer,
    lines: [
      {
        description: 'Attività di progettazione e sviluppo software\n“Gestionale di esempio”',
        quantity: 1,
        unitPrice: 1442.31,
        vatRate: 22,
      },
    ],
    pensionFund: issuer.defaults.pensionFund,
    withholding: issuer.defaults.withholding,
    payment: { ...issuer.payment, dueDate: '2025-08-14' },
    ...overrides,
  });
}
