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

// Lettere di Latin-1 che non si scompongono in lettera base + accento, e simboli comuni.
const LATIN1_TO_ASCII: ReadonlyArray<readonly [RegExp, string]> = [
  [/\u00DF/g, 'ss'],
  [/\u00C6/g, 'AE'],
  [/\u00E6/g, 'ae'],
  [/\u00D8/g, 'O'],
  [/\u00F8/g, 'o'],
  [/\u00D0/g, 'D'],
  [/\u00F0/g, 'd'],
  [/\u00DE/g, 'Th'],
  [/\u00FE/g, 'th'],
  [/[\u00B0\u00BA]/g, '.'], // "n°" → "n."
  [/\u00AA/g, 'a'],
  [/[\u00AB\u00BB]/g, '"'],
  [/[\u00B4`]/g, "'"], // accento usato come apostrofo
  [/\u00D7/g, 'x'],
  [/\u00F7/g, '/'],
  [/\u00B1/g, '+/-'],
  [/\u00B9/g, '1'],
  [/\u00B2/g, '2'],
  [/\u00B3/g, '3'],
  [/\u00BC/g, '1/4'],
  [/\u00BD/g, '1/2'],
  [/\u00BE/g, '3/4'],
  [/\u00B5/g, 'u'],
  [/\u00A7/g, 'par.'],
  [/\u00A9/g, '(c)'],
  [/\u00AE/g, '(r)'],
  [/\u00A3/g, 'GBP'],
  [/\u00B7/g, '.'],
];

/**
 * Testo per l'XML FatturaPA: solo caratteri ASCII. Lo schema ammetterebbe anche Latin-1, ma
 * il visualizzatore dell'Agenzia delle Entrate mostra male le lettere accentate di un file
 * UTF-8 corretto. Si scrive quindi come in italiano senza accenti: vocale + apostrofo
 * ("attività" → "attivita'", "perché" → "perche'"); le altre lettere perdono l'accento
 * ("Muñoz" → "Munoz"). Il PDF di cortesia conserva il testo originale.
 */
export function toAscii(text: string): string {
  let s = toLatin1(text)
    .normalize('NFD')
    .replace(/([AEIOUaeiou])[\u0300\u0301]/g, "$1'")
    .replace(/[\u0300-\u036F]/g, '');
  for (const [re, rep] of LATIN1_TO_ASCII) s = s.replace(re, rep);
  return s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
}

/** Testo per un campo dell'XML: solo ASCII (vedi toAscii) e tagliato al limite del campo. */
export function latinField(text: string, maxLength: number): string {
  return truncate(toAscii(text), maxLength);
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
