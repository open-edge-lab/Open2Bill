import { toDec } from '../money';
import type { FatturaData } from './build';

// Controlli semantici che replicano gli scarti più frequenti del Sistema di
// Interscambio (codici 004xx), eseguiti sui dati prima della serializzazione.
// Servono come rete di sicurezza contro errori del motore di calcolo.

export interface SemanticIssue {
  /** Codice di errore SdI corrispondente (se esiste). */
  code: string;
  message: string;
}

type Node = Record<string, unknown>;

const asArray = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : v ? [v as Node] : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const key = (rate: unknown, nature: unknown) => `${toDec(str(rate) ?? '0').toFixed(2)}|${str(nature) ?? ''}`;

export function runSemanticChecks(data: FatturaData): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });

  const generali = (data.body.DatiGenerali as Node).DatiGeneraliDocumento as Node;
  const beniServizi = data.body.DatiBeniServizi as Node;
  const linee = asArray(beniServizi.DettaglioLinee);
  const riepilogo = asArray(beniServizi.DatiRiepilogo);
  const casse = asArray(generali.DatiCassaPrevidenziale);
  const ritenute = asArray(generali.DatiRitenuta);

  // 00400 / 00401: natura obbligatoria con aliquota 0, vietata con aliquota > 0
  linee.forEach((l, i) => {
    const zero = toDec(str(l.AliquotaIVA) ?? '0').isZero();
    if (zero && !l.Natura) add('00400', `Riga ${i + 1}: aliquota IVA 0 senza natura`);
    if (!zero && l.Natura) add('00401', `Riga ${i + 1}: natura indicata con aliquota IVA diversa da 0`);
  });
  casse.forEach((c) => {
    const zero = toDec(str(c.AliquotaIVA) ?? '0').isZero();
    if (zero && !c.Natura) add('00413', 'Cassa previdenziale: aliquota IVA 0 senza natura');
    if (!zero && c.Natura) add('00414', 'Cassa previdenziale: natura indicata con aliquota IVA diversa da 0');
  });

  // 00411 / 00415: ritenuta indicata su righe o cassa senza blocco DatiRitenuta
  if (ritenute.length === 0) {
    if (linee.some((l) => l.Ritenuta === 'SI')) add('00411', 'Righe soggette a ritenuta senza DatiRitenuta');
    if (casse.some((c) => c.Ritenuta === 'SI')) add('00415', 'Cassa soggetta a ritenuta senza DatiRitenuta');
  }

  // 00419 / 00422: riepilogo coerente con righe e cassa
  const expected = new Map<string, ReturnType<typeof toDec>>();
  const addExpected = (k: string, amount: string | undefined) =>
    expected.set(k, (expected.get(k) ?? toDec(0)).plus(toDec(amount ?? '0')));
  linee.forEach((l) => addExpected(key(l.AliquotaIVA, l.Natura), str(l.PrezzoTotale)));
  casse.forEach((c) => addExpected(key(c.AliquotaIVA, c.Natura), str(c.ImportoContributoCassa)));

  const riepilogoKeys = new Set(riepilogo.map((r) => key(r.AliquotaIVA, r.Natura)));
  for (const k of expected.keys()) {
    if (!riepilogoKeys.has(k)) add('00419', `Manca il riepilogo per aliquota/natura ${k.replace('|', ' ')}`);
  }

  let taxableSum = toDec(0);
  let vatSum = toDec(0);
  for (const r of riepilogo) {
    const k = key(r.AliquotaIVA, r.Natura);
    const imponibile = toDec(str(r.ImponibileImporto) ?? '0');
    const imposta = toDec(str(r.Imposta) ?? '0');
    taxableSum = taxableSum.plus(imponibile);
    vatSum = vatSum.plus(imposta);
    const exp = expected.get(k) ?? toDec(0);
    if (!exp.minus(imponibile).abs().lte('0.01')) {
      add('00422', `Riepilogo ${k.replace('|', ' ')}: imponibile ${imponibile.toFixed(2)} ≠ somma righe ${exp.toFixed(2)}`);
    }
    const expVat = imponibile.times(toDec(str(r.AliquotaIVA) ?? '0')).dividedBy(100);
    if (!expVat.minus(imposta).abs().lte('0.01')) {
      add('00421', `Riepilogo ${k.replace('|', ' ')}: imposta ${imposta.toFixed(2)} non coerente`);
    }
  }

  // Totale documento e importo da pagare (controlli di coerenza interni)
  const totale = toDec(str(generali.ImportoTotaleDocumento) ?? '0');
  if (!totale.eq(taxableSum.plus(vatSum))) {
    add('TOT', `Totale documento ${totale.toFixed(2)} diverso da imponibili + imposte`);
  }
  const ritenuta = ritenute.reduce((acc, r) => acc.plus(toDec(str(r.ImportoRitenuta) ?? '0')), toDec(0));
  for (const p of asArray(data.body.DatiPagamento)) {
    for (const d of asArray(p.DettaglioPagamento)) {
      const importo = toDec(str(d.ImportoPagamento) ?? '0');
      if (!importo.eq(totale.minus(ritenuta))) {
        add('PAG', `Importo pagamento ${importo.toFixed(2)} diverso da totale − ritenuta`);
      }
    }
  }

  return issues;
}
