import { describe, expect, it } from 'vitest';
import { sameBankDetails, withBankDetails } from '../src/document-factory';

describe('dati bancari', () => {
  it('confronta IBAN ignorando spazi e maiuscole, e i testi ignorando gli spazi ai lati', () => {
    const a = { bankName: 'Banca Esempio', iban: 'IT60X0542811101000000123456' };
    expect(sameBankDetails(a, { bankName: ' Banca Esempio ', iban: 'it60 x054 2811 1010 0000 0123 456' })).toBe(true);
    expect(sameBankDetails(a, { ...a, bankName: 'Altra Banca' })).toBe(false);
    expect(sameBankDetails(a, { ...a, beneficiary: 'Mario Rossi' })).toBe(false);
  });

  it('campo vuoto e campo assente sono la stessa cosa', () => {
    expect(sameBankDetails({ bankName: '', iban: undefined }, {})).toBe(true);
    expect(sameBankDetails(null, {})).toBe(true);
  });

  it('copia solo banca, IBAN e beneficiario', () => {
    const payment = { method: 'MP05', dueDate: '2026-12-31', bankName: 'Vecchia', iban: 'IT00A0000000000000000000000', beneficiary: 'X' };
    const updated = withBankDetails(payment, { bankName: 'Nuova', iban: 'IT00B0000000000000000000000' });
    expect(updated).toEqual({ method: 'MP05', dueDate: '2026-12-31', bankName: 'Nuova', iban: 'IT00B0000000000000000000000', beneficiary: undefined });
  });
});
