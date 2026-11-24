// Normalizzazione dei testi per FatturaPA: lo schema ammette solo caratteri
// Basic Latin + Latin-1 Supplement e i campi sono "normalizedString" (niente a capo).

const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\u2010-\u2015\u2212]/g, "-"], // trattini tipografici e segno meno
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"], // apostrofi e virgolette singole
  [/[\u201C\u201D\u201E\u201F\u2033]/g, "\""], // virgolette doppie
  [/\u2026/g, "..."], // puntini di sospensione
  [/\u20AC/g, "EUR"], // simbolo euro
  [/[\u2022\u2023\u2043\u25E6]/g, "-"], // elenchi puntati
  [/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " "], // spazi speciali
  [/\u0152/g, "OE"],
  [/\u0153/g, "oe"],
  // lettere che non si scompongono in lettera base + accento
  [/\u0141/g, "L"],
  [/\u0142/g, "l"],
  [/\u0110/g, "D"],
  [/\u0111/g, "d"],
  [/\u0131/g, "i"],
];

/**
 * Converte un testo nei soli caratteri ammessi da FatturaPA.
 * - sostituisce i caratteri tipografici più comuni con l'equivalente ASCII;
 * - rimuove gli accenti dai caratteri fuori da Latin-1 (es. "ő" → "o");
 * - elimina ciò che resta fuori da Latin-1;
 * - trasforma gli a capo in spazi e comprime gli spazi multipli.
 */
export function toLatin1(text: string): string {
  let s = text.normalize('NFC');
  for (const [re, rep] of REPLACEMENTS) s = s.replace(re, rep);
  s = Array.from(s)
    .map((ch) => {
      if (ch.charCodeAt(0) <= 0xff) return ch;
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      return base.length > 0 && base.charCodeAt(0) <= 0xff ? base : '';
    })
    .join('');
  // caratteri di controllo (tranne tab/a capo, poi convertiti) non ammessi
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Solo Basic Latin (ASCII), per i campi String20/String10 (es. Numero documento). */
export function toBasicLatin(text: string): string {
  return toLatin1(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

/** Normalizza e tronca al limite di lunghezza del campo. */
export function latinField(text: string, maxLength: number): string {
  return truncate(toLatin1(text), maxLength);
}

export function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength).trimEnd();
}

/** Divide un testo lungo in blocchi (es. Causale: più elementi da 200 caratteri). */
export function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(' ', size);
    if (cut <= 0) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Slug in minuscolo per id e nomi di file ("Esempio Software S.r.l." → "esempio-software-s-r-l"). */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
