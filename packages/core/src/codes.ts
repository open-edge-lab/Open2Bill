// Tabelle dei codici FatturaPA (schema VFPR12 1.2.3) con descrizioni in italiano,
// usate per le select della UI e per le etichette del PDF.
// I codici sono valori ufficiali della specifica e restano invariati.

export interface CodeEntry<C extends string = string> {
  code: C;
  label: string;
}

const entries = <C extends string>(list: ReadonlyArray<readonly [C, string]>): CodeEntry<C>[] =>
  list.map(([code, label]) => ({ code, label }));

// ── Tipo documento ───────────────────────────────────────────
export const DOCUMENT_TYPE_CODES = ['TD01', 'TD06', 'TD04'] as const;
export type DocumentTypeCode = (typeof DOCUMENT_TYPE_CODES)[number];

export const DOCUMENT_TYPES = entries<DocumentTypeCode>([
  ['TD01', 'Fattura'],
  ['TD06', 'Parcella'],
  ['TD04', 'Nota di credito'],
]);

// ── Regime fiscale ───────────────────────────────────────────
export const TAX_REGIME_CODES = [
  'RF01', 'RF02', 'RF04', 'RF05', 'RF06', 'RF07', 'RF08', 'RF09', 'RF10', 'RF11',
  'RF12', 'RF13', 'RF14', 'RF15', 'RF16', 'RF17', 'RF18', 'RF19', 'RF20',
] as const;
export type TaxRegimeCode = (typeof TAX_REGIME_CODES)[number];

export const TAX_REGIMES = entries<TaxRegimeCode>([
  ['RF01', 'Ordinario'],
  ['RF02', 'Contribuenti minimi (art. 1, c. 96-117, L. 244/2007)'],
  ['RF04', 'Agricoltura e attività connesse e pesca'],
  ['RF05', 'Vendita sali e tabacchi'],
  ['RF06', 'Commercio dei fiammiferi'],
  ['RF07', 'Editoria'],
  ['RF08', 'Gestione di servizi di telefonia pubblica'],
  ['RF09', 'Rivendita di documenti di trasporto pubblico e di sosta'],
  ['RF10', 'Intrattenimenti, giochi e altre attività (D.P.R. 640/72)'],
  ['RF11', 'Agenzie di viaggi e turismo'],
  ['RF12', 'Agriturismo'],
  ['RF13', 'Vendite a domicilio'],
  ['RF14', 'Rivendita di beni usati, oggetti d’arte, d’antiquariato o da collezione'],
  ['RF15', 'Agenzie di vendite all’asta di oggetti d’arte, antiquariato o da collezione'],
  ['RF16', 'IVA per cassa P.A.'],
  ['RF17', 'IVA per cassa (art. 32-bis, D.L. 83/2012)'],
  ['RF18', 'Altro'],
  ['RF19', 'Forfettario'],
  ['RF20', 'Regime transfrontaliero di franchigia IVA (Direttiva UE 2020/285)'],
]);

// ── Natura IVA (operazioni senza imposta) ────────────────────
export const VAT_NATURE_CODES = [
  'N1', 'N2.1', 'N2.2', 'N3.1', 'N3.2', 'N3.3', 'N3.4', 'N3.5', 'N3.6', 'N4', 'N5',
  'N6.1', 'N6.2', 'N6.3', 'N6.4', 'N6.5', 'N6.6', 'N6.7', 'N6.8', 'N6.9', 'N7',
] as const;
export type VatNatureCode = (typeof VAT_NATURE_CODES)[number];

export const VAT_NATURES = entries<VatNatureCode>([
  ['N1', 'Escluse ex art. 15 DPR 633/72'],
  ['N2.1', 'Non soggette (artt. da 7 a 7-septies DPR 633/72)'],
  ['N2.2', 'Non soggette - altri casi'],
  ['N3.1', 'Non imponibili - esportazioni'],
  ['N3.2', 'Non imponibili - cessioni intracomunitarie'],
  ['N3.3', 'Non imponibili - cessioni verso San Marino'],
  ['N3.4', 'Non imponibili - operazioni assimilate alle esportazioni'],
  ['N3.5', 'Non imponibili - a seguito di dichiarazioni d’intento'],
  ['N3.6', 'Non imponibili - altre operazioni che non concorrono al plafond'],
  ['N4', 'Esenti'],
  ['N5', 'Regime del margine / IVA non esposta in fattura'],
  ['N6.1', 'Inversione contabile - rottami e materiali di recupero'],
  ['N6.2', 'Inversione contabile - oro e argento'],
  ['N6.3', 'Inversione contabile - subappalto nel settore edile'],
  ['N6.4', 'Inversione contabile - cessione di fabbricati'],
  ['N6.5', 'Inversione contabile - telefoni cellulari'],
  ['N6.6', 'Inversione contabile - prodotti elettronici'],
  ['N6.7', 'Inversione contabile - comparto edile e settori connessi'],
  ['N6.8', 'Inversione contabile - settore energetico'],
  ['N6.9', 'Inversione contabile - altri casi'],
  ['N7', 'IVA assolta in altro stato UE'],
]);

/**
 * Nature per cui l'importo concorre alla soglia della marca da bollo (77,47 €):
 * operazioni escluse, non soggette, esenti e non imponibili (escluse le cessioni
 * intracomunitarie). È un suggerimento per l'utente, non un vincolo.
 */
export const STAMP_DUTY_NATURES: ReadonlySet<VatNatureCode> = new Set<VatNatureCode>([
  'N1', 'N2.1', 'N2.2', 'N3.1', 'N3.4', 'N3.5', 'N3.6', 'N4',
]);

/** Soglia oltre la quale è dovuta la marca da bollo da 2,00 €. */
export const STAMP_DUTY_THRESHOLD = '77.47';
export const STAMP_DUTY_AMOUNT = '2.00';

// ── Cassa previdenziale ──────────────────────────────────────
export const PENSION_FUND_CODES = [
  'TC01', 'TC02', 'TC03', 'TC04', 'TC05', 'TC06', 'TC07', 'TC08', 'TC09', 'TC10', 'TC11',
  'TC12', 'TC13', 'TC14', 'TC15', 'TC16', 'TC17', 'TC18', 'TC19', 'TC20', 'TC21', 'TC22',
] as const;
export type PensionFundCode = (typeof PENSION_FUND_CODES)[number];

export const PENSION_FUNDS = entries<PensionFundCode>([
  ['TC01', 'Cassa forense (avvocati)'],
  ['TC02', 'Cassa dottori commercialisti'],
  ['TC03', 'Cassa geometri'],
  ['TC04', 'Inarcassa (ingegneri e architetti)'],
  ['TC05', 'Cassa nazionale del notariato'],
  ['TC06', 'Cassa ragionieri e periti commerciali'],
  ['TC07', 'ENASARCO'],
  ['TC08', 'ENPACL (consulenti del lavoro)'],
  ['TC09', 'ENPAM (medici)'],
  ['TC10', 'ENPAF (farmacisti)'],
  ['TC11', 'ENPAV (veterinari)'],
  ['TC12', 'ENPAIA (impiegati dell’agricoltura)'],
  ['TC13', 'Fondo impiegati imprese di spedizione e agenzie marittime'],
  ['TC14', 'INPGI (giornalisti)'],
  ['TC15', 'ONAOSI (orfani sanitari)'],
  ['TC16', 'CASAGIT (giornalisti)'],
  ['TC17', 'EPPI (periti industriali)'],
  ['TC18', 'EPAP (pluricategoriale)'],
  ['TC19', 'ENPAB (biologi)'],
  ['TC20', 'ENPAPI (infermieri)'],
  ['TC21', 'ENPAP (psicologi)'],
  ['TC22', 'INPS'],
]);

// ── Ritenuta ─────────────────────────────────────────────────
export const WITHHOLDING_TYPE_CODES = ['RT01', 'RT02', 'RT03', 'RT04', 'RT05', 'RT06'] as const;
export type WithholdingTypeCode = (typeof WITHHOLDING_TYPE_CODES)[number];

export const WITHHOLDING_TYPES = entries<WithholdingTypeCode>([
  ['RT01', 'Ritenuta d’acconto persone fisiche'],
  ['RT02', 'Ritenuta d’acconto persone giuridiche'],
  ['RT03', 'Contributo INPS'],
  ['RT04', 'Contributo ENASARCO'],
  ['RT05', 'Contributo ENPAM'],
  ['RT06', 'Altro contributo previdenziale'],
]);

export const PAYMENT_REASON_CODES = [
  'A', 'B', 'C', 'D', 'E', 'G', 'H', 'I', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z', 'L1', 'M1', 'M2', 'O1', 'V1', 'ZO',
] as const;
export type PaymentReasonCode = (typeof PAYMENT_REASON_CODES)[number];

/** Causale pagamento della ritenuta (come da modello CU). */
export const PAYMENT_REASONS = entries<PaymentReasonCode>([
  ['A', 'Prestazioni di lavoro autonomo rientranti nell’esercizio abituale di arte o professione'],
  ['B', 'Utilizzazione economica di opere dell’ingegno da parte dell’autore o inventore'],
  ['C', 'Utili da contratti di associazione in partecipazione con apporto di solo lavoro'],
  ['D', 'Utili spettanti ai soci promotori e fondatori'],
  ['E', 'Levata di protesti cambiari'],
  ['G', 'Indennità per cessazione di attività sportiva professionale'],
  ['H', 'Indennità per cessazione di rapporti di agenzia'],
  ['I', 'Indennità per cessazione da funzioni notarili'],
  ['L', 'Utilizzazione economica di opere dell’ingegno da parte di soggetto diverso dall’autore'],
  ['M', 'Prestazioni di lavoro autonomo non esercitate abitualmente'],
  ['N', 'Indennità e compensi per attività sportive dilettantistiche'],
  ['O', 'Prestazioni occasionali senza iscrizione alla gestione separata'],
  ['P', 'Compensi a non residenti per l’uso di attrezzature'],
  ['Q', 'Provvigioni ad agente o rappresentante monomandatario'],
  ['R', 'Provvigioni ad agente o rappresentante plurimandatario'],
  ['S', 'Provvigioni a commissionario'],
  ['T', 'Provvigioni a mediatore'],
  ['U', 'Provvigioni per procacciamento d’affari'],
  ['V', 'Provvigioni per vendita porta a porta e ambulante di giornali'],
  ['W', 'Corrispettivi per contratti d’appalto'],
  ['X', 'Canoni a società o enti residenti (art. 26-quater)'],
  ['Y', 'Canoni da società o enti residenti'],
  ['Z', 'Titolo diverso dai precedenti'],
  ['L1', 'Redditi da opere dell’ingegno acquisite a titolo gratuito'],
  ['M1', 'Redditi da obblighi di fare, non fare o permettere'],
  ['M2', 'Prestazioni occasionali con iscrizione alla gestione separata'],
  ['O1', 'Obblighi di fare, non fare o permettere, senza iscrizione alla gestione separata'],
  ['V1', 'Redditi da attività commerciali non esercitate abitualmente'],
  ['ZO', 'Titolo diverso dai precedenti (altro)'],
]);

// ── Pagamento ────────────────────────────────────────────────
export const PAYMENT_METHOD_CODES = [
  'MP01', 'MP02', 'MP03', 'MP04', 'MP05', 'MP06', 'MP07', 'MP08', 'MP09', 'MP10', 'MP11', 'MP12',
  'MP13', 'MP14', 'MP15', 'MP16', 'MP17', 'MP18', 'MP19', 'MP20', 'MP21', 'MP22', 'MP23',
] as const;
export type PaymentMethodCode = (typeof PAYMENT_METHOD_CODES)[number];

export const PAYMENT_METHODS = entries<PaymentMethodCode>([
  ['MP01', 'Contanti'],
  ['MP02', 'Assegno'],
  ['MP03', 'Assegno circolare'],
  ['MP04', 'Contanti presso Tesoreria'],
  ['MP05', 'Bonifico'],
  ['MP06', 'Vaglia cambiario'],
  ['MP07', 'Bollettino bancario'],
  ['MP08', 'Carta di pagamento'],
  ['MP09', 'RID'],
  ['MP10', 'RID utenze'],
  ['MP11', 'RID veloce'],
  ['MP12', 'RIBA'],
  ['MP13', 'MAV'],
  ['MP14', 'Quietanza erario'],
  ['MP15', 'Giroconto su conti di contabilità speciale'],
  ['MP16', 'Domiciliazione bancaria'],
  ['MP17', 'Domiciliazione postale'],
  ['MP18', 'Bollettino di c/c postale'],
  ['MP19', 'SEPA Direct Debit'],
  ['MP20', 'SEPA Direct Debit CORE'],
  ['MP21', 'SEPA Direct Debit B2B'],
  ['MP22', 'Trattenuta su somme già riscosse'],
  ['MP23', 'PagoPA'],
]);

export const PAYMENT_TERMS_CODES = ['TP01', 'TP02', 'TP03'] as const;
export type PaymentTermsCode = (typeof PAYMENT_TERMS_CODES)[number];

export const PAYMENT_TERMS = entries<PaymentTermsCode>([
  ['TP01', 'Pagamento a rate'],
  ['TP02', 'Pagamento completo'],
  ['TP03', 'Anticipo'],
]);

/** Etichetta leggibile di un codice, o il codice stesso se sconosciuto. */
export function codeLabel(table: ReadonlyArray<CodeEntry>, code: string | undefined | null): string {
  if (!code) return '';
  return table.find((e) => e.code === code)?.label ?? code;
}
