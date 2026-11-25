// Validatori di identificativi fiscali e formati italiani.

const TAX_CODE_ODD = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
];

/** Partita IVA italiana: 11 cifre con cifra di controllo (algoritmo di Luhn modificato). */
/**
 * Partita IVA come va salvata e scritta nell'XML: senza spazi, punti o trattini e senza
 * il prefisso "IT" (il paese è un campo a parte, vatCountry). "IT 012.345" → "012345".
 */
export function normalizeVatNumber(value: string): string {
  return value
    .replace(/[\s.-]/g, '')
    .toUpperCase()
    .replace(/^IT(?=\d{11}$)/, '');
}

/**
 * Cosa non va in una partita IVA italiana: null se va bene. Si controlla solo che abbia
 * 11 cifre, non la cifra di controllo: un utente ha confermato valida una partita IVA che
 * non la rispetta, e un errore qui bloccherebbe l'emissione. Che esista lo controlla lo SdI.
 */
export function vatNumberProblem(value: string): 'format' | null {
  return /^\d{11}$/.test(normalizeVatNumber(value)) ? null : 'format';
}

/** Cifra di controllo della partita IVA. Non si usa per bloccare (vedi vatNumberProblem). */
export function isValidVatNumber(value: string): boolean {
  const v = normalizeVatNumber(value);
  if (!/^\d{11}$/.test(v)) return false;
  let total = 0;
  for (let i = 0; i < 10; i++) {
    let d = v.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  }
  return (10 - (total % 10)) % 10 === v.charCodeAt(10) - 48;
}

/**
 * Codice fiscale: 16 caratteri per le persone fisiche (con carattere di controllo,
 * omocodie comprese) oppure 11 cifre per i soggetti diversi. Per questi, spesso uguali alla
 * partita IVA, si controllano solo le cifre, come per la partita IVA (vedi vatNumberProblem).
 */
export function isValidTaxCode(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (/^\d{11}$/.test(v)) return true;
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(v)) {
    return false;
  }
  let total = 0;
  for (let i = 0; i < 15; i++) {
    const c = v[i]!;
    const n = c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 65;
    total += i % 2 === 0 ? TAX_CODE_ODD[n]! : n;
  }
  return String.fromCharCode(65 + (total % 26)) === v[15];
}

const IBAN_LENGTHS: Record<string, number> = { IT: 27, SM: 27, DE: 22, FR: 27, ES: 24, CH: 21, AT: 20, BE: 16, NL: 18 };

/** IBAN: controllo mod 97 e lunghezza per i paesi più comuni. */
export function isValidIban(value: string): boolean {
  const v = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  const expected = IBAN_LENGTHS[v.slice(0, 2)];
  if (expected && v.length !== expected) return false;
  const rearranged = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of rearranged) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return rem === 1;
}

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export const isValidPostalCode = (v: string): boolean => /^\d{5}$/.test(v.trim());
export const isValidProvince = (v: string): boolean => /^[A-Z]{2}$/.test(v.trim());
/** Codice destinatario SdI: 7 caratteri per i privati (6 per la PA). */
export const isValidRecipientCode = (v: string): boolean => /^[A-Z0-9]{7}$/.test(v.trim());
export const isValidEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Giorni interi tra due date ISO (b − a). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Data ISO di oggi nel fuso locale (AAAA-MM-GG). */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Somma giorni a una data ISO. */
export function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
