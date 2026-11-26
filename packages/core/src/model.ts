import { z } from 'zod';
import {
  DOCUMENT_TYPE_CODES,
  PAYMENT_METHOD_CODES,
  PAYMENT_REASON_CODES,
  PAYMENT_TERMS_CODES,
  PENSION_FUND_CODES,
  TAX_REGIME_CODES,
  VAT_NATURE_CODES,
  WITHHOLDING_TYPE_CODES,
} from './codes';
import { normalizeVatNumber } from './validators';

// Schemi del modello dati. Le chiavi sono in inglese (vedi glossario in CLAUDE.md);
// i messaggi di errore sono in italiano perché arrivano all'utente.

// Messaggi di errore predefiniti di zod in italiano.
z.config(z.locales.it());

/** Numero accettato anche come stringa ("1442,31" o "1442.31"), per YAML e form. */
const amount = z.preprocess((v) => {
  if (typeof v === 'string') {
    const s = v.trim().replace(',', '.');
    return s === '' ? undefined : Number(s);
  }
  return v;
}, z.number({ error: 'Importo non valido' }));

const rate = amount.pipe(
  z.number().min(0, 'La percentuale non può essere negativa').max(100, 'Massimo 100%'),
);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida (AAAA-MM-GG)');

/** Testo facoltativo: la stringa vuota diventa undefined (chiave opzionale nel tipo). */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

/** Partita IVA salvata senza spazi né prefisso "IT": il paese sta in vatCountry. */
const optionalVatNumber = z
  .string()
  .transform((v) => normalizeVatNumber(v) || undefined)
  .optional();

// ── Indirizzo ────────────────────────────────────────────────
export const AddressSchema = z.object({
  street: z.string().trim().min(1, 'Indirizzo obbligatorio'),
  streetNumber: optionalText,
  postalCode: z.string().trim().min(1, 'CAP obbligatorio'),
  city: z.string().trim().min(1, 'Comune obbligatorio'),
  province: optionalText,
  country: z.string().trim().length(2).default('IT'),
});
export type Address = z.infer<typeof AddressSchema>;

// ── Impostazioni ricorrenti (riusate da emittente e documento) ──
export const PensionFundSettingsSchema = z.object({
  type: z.enum(PENSION_FUND_CODES).default('TC22'),
  rate: rate.default(4),
  vatRate: rate.default(22),
  vatNature: z.enum(VAT_NATURE_CODES).optional(),
  /** Il contributo è soggetto a ritenuta (vero per la rivalsa INPS gestione separata). */
  withholding: z.boolean().default(true),
  label: optionalText,
  /**
   * I prezzi delle righe comprendono già il contributo ("4% compreso"): si scorpora una
   * volta sul totale e nell'XML/PDF le righe vanno al netto.
   */
  pricesIncludeContribution: z.boolean().default(false),
});
export type PensionFundSettings = z.infer<typeof PensionFundSettingsSchema>;

export const WithholdingSettingsSchema = z.object({
  type: z.enum(WITHHOLDING_TYPE_CODES).default('RT01'),
  rate: rate.default(20),
  paymentReason: z.enum(PAYMENT_REASON_CODES).default('A'),
  label: optionalText,
});
export type WithholdingSettings = z.infer<typeof WithholdingSettingsSchema>;

export const StampDutySettingsSchema = z.object({
  amount: amount.default(2),
  /** Se vero, il bollo viene addebitato al cliente come riga esclusa art. 15 (N1). */
  chargeToCustomer: z.boolean().default(true),
  label: optionalText,
});
export type StampDutySettings = z.infer<typeof StampDutySettingsSchema>;

export const PaymentSettingsSchema = z.object({
  method: z.enum(PAYMENT_METHOD_CODES).default('MP05'),
  terms: z.enum(PAYMENT_TERMS_CODES).default('TP02'),
  bankName: optionalText,
  iban: optionalText,
  beneficiary: optionalText,
  /** Giorni dalla data documento per la scadenza (0 = a vista). */
  dueDays: z.number().int().min(0).max(999).default(30),
});
export type PaymentSettings = z.infer<typeof PaymentSettingsSchema>;

// ── Emittente (issuer.yaml) ──────────────────────────────────
export const IssuerSchema = z
  .object({
    companyName: optionalText,
    firstName: optionalText,
    lastName: optionalText,
    title: optionalText,
    vatCountry: z.string().length(2).default('IT'),
    vatNumber: z.string().transform(normalizeVatNumber).pipe(z.string().min(1, 'Partita IVA obbligatoria')),
    taxCode: optionalText,
    taxRegime: z.enum(TAX_REGIME_CODES).default('RF01'),
    address: AddressSchema,
    contacts: z
      .object({
        phone: optionalText,
        email: optionalText,
        pec: optionalText,
        /** Il proprio codice destinatario SDI: non va nell'XML, si stampa sul PDF se c'è. */
        recipientCode: z
          .string()
          .trim()
          .toUpperCase()
          .transform((v) => (v === '' ? undefined : v))
          .optional(),
      })
      .prefault({}),
    /** Trasmittente: di default il codice fiscale (o la P.IVA) dell'emittente. */
    transmitter: z.object({ country: z.string().length(2).default('IT'), code: z.string() }).optional(),
    payment: PaymentSettingsSchema.prefault({}),
    defaults: z
      .object({
        vatRate: rate.default(22),
        /** Cassa previdenziale proposta nei nuovi documenti (null/assente = nessuna). */
        pensionFund: PensionFundSettingsSchema.nullable().optional(),
        /** Ritenuta proposta nei nuovi documenti (null/assente = nessuna). */
        withholding: WithholdingSettingsSchema.nullable().optional(),
        stampDuty: StampDutySettingsSchema.prefault({}),
        /** Testo standard della causale. */
        reason: optionalText,
      })
      .prefault({}),
    numbering: z
      .object({
        /** Formati: {n} numero, {n:3} numero con zeri, {yyyy} anno, {yy} anno a 2 cifre. */
        invoice: z.string().default('{n}'),
        creditNote: z.string().default('NC{n}'),
        proforma: z.string().default('PF{n}'),
        /** Nome dei PDF generati. Segnaposto: {year} {type} {number} {customer}. */
        pdfFileName: z.string().default('{year}-{type}-{number}_{customer}'),
      })
      .prefault({}),
    pdf: z
      .object({
        template: z.string().default('default'),
        /** Percorso del logo relativo alla cartella dati. */
        logo: optionalText,
        // Finisce nel CSS del template: solo colori esadecimali, niente testo arbitrario
        accentColor: z
          .string()
          .trim()
          .regex(/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i, 'Colore non valido: usa il formato #1f4e79')
          .default('#1f4e79'),
        footer: optionalText,
        /** Etichette personalizzabili del blocco totali (vedi DEFAULT_PDF_LABELS). */
        labels: z.record(z.string(), z.string()).default({}),
      })
      .prefault({}),
  })
  .superRefine((v, ctx) => {
    if (!v.companyName && !(v.firstName && v.lastName)) {
      ctx.addIssue({
        code: 'custom',
        path: ['companyName'],
        message: 'Indica la denominazione oppure nome e cognome',
      });
    }
  });
export type Issuer = z.infer<typeof IssuerSchema>;
export type IssuerInput = z.input<typeof IssuerSchema>;

// ── Cliente (customers/<id>.yaml) ────────────────────────────
export const CUSTOMER_KINDS = ['company', 'professional', 'individual'] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

const customerShape = {
  /** azienda, professionista con P.IVA, privato (solo codice fiscale). */
  kind: z.enum(CUSTOMER_KINDS).default('company'),
  companyName: optionalText,
  firstName: optionalText,
  lastName: optionalText,
  vatCountry: z.string().length(2).default('IT'),
  vatNumber: optionalVatNumber,
  taxCode: optionalText,
  address: AddressSchema,
  /** Codice destinatario SdI (7 caratteri). "0000000" se si usa la PEC o se privato. */
  recipientCode: z.string().trim().toUpperCase().default('0000000'),
  pec: optionalText,
  email: optionalText,
  notes: optionalText,
};

export const CustomerDataSchema = z.object(customerShape);
export type CustomerData = z.infer<typeof CustomerDataSchema>;

export const CustomerSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Id non valido'),
  ...customerShape,
});
export type Customer = z.infer<typeof CustomerSchema>;
export type CustomerInput = z.input<typeof CustomerSchema>;

// ── Righe ────────────────────────────────────────────────────
export const LINE_KINDS = ['service', 'passThroughExpense'] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export const DocumentLineSchema = z.object({
  /** service = prestazione/cessione; passThroughExpense = spesa esclusa art. 15 (N1). */
  kind: z.enum(LINE_KINDS).default('service'),
  description: z.string().trim().min(1, 'Descrizione obbligatoria'),
  quantity: amount.default(1),
  unit: optionalText,
  unitPrice: amount,
  discountPercent: rate.optional(),
  vatRate: rate.default(22),
  vatNature: z.enum(VAT_NATURE_CODES).optional(),
  /** Riga soggetta a ritenuta d'acconto. */
  withholding: z.boolean().default(true),
  /** Riga che concorre alla base della cassa previdenziale. */
  pensionFund: z.boolean().default(true),
  periodStart: isoDate.optional(),
  periodEnd: isoDate.optional(),
});
export type DocumentLine = z.infer<typeof DocumentLineSchema>;
export type DocumentLineInput = z.input<typeof DocumentLineSchema>;

// ── Catalogo voci (catalog.yaml) ─────────────────────────────
export const CatalogItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(LINE_KINDS).default('service'),
  description: z.string().trim().min(1),
  quantity: amount.default(1),
  unit: optionalText,
  unitPrice: amount.default(0),
  vatRate: rate.optional(),
  vatNature: z.enum(VAT_NATURE_CODES).optional(),
  withholding: z.boolean().default(true),
  pensionFund: z.boolean().default(true),
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const CatalogSchema = z.object({ items: z.array(CatalogItemSchema).default([]) });
export type Catalog = z.infer<typeof CatalogSchema>;

// ── Documento ────────────────────────────────────────────────
export const DOCUMENT_KINDS = [...DOCUMENT_TYPE_CODES, 'proforma'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_STATUSES = ['draft', 'issued', 'uploaded'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DocumentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(DOCUMENT_KINDS).default('TD01'),
  status: z.enum(DOCUMENT_STATUSES).default('draft'),
  /** Numero assegnato all'emissione (es. "1", "PF3"). */
  number: optionalText,
  /** Progressivo numerico nell'anno, per la numerazione. */
  sequence: z.number().int().positive().optional(),
  date: isoDate,
  /** Riferimento alla rubrica; i dati veri sono copiati in `customer`. */
  customerId: optionalText,
  customer: CustomerDataSchema,
  lines: z.array(DocumentLineSchema).min(1, 'Inserisci almeno una riga'),
  pensionFund: PensionFundSettingsSchema.nullable().default(null),
  withholding: WithholdingSettingsSchema.nullable().default(null),
  /** Marca da bollo virtuale (null = assente). */
  stampDuty: StampDutySettingsSchema.nullable().default(null),
  payment: PaymentSettingsSchema.extend({ dueDate: isoDate.optional() }).nullable().default(null),
  /** Causale (FatturaPA). */
  reason: optionalText,
  /** Note libere: solo PDF, non finiscono nell'XML. */
  notes: optionalText,
  /** Fattura collegata (obbligatoria per la nota di credito TD04). */
  linkedInvoice: z.object({ number: z.string().min(1), date: isoDate }).nullable().default(null),
  sourceProformaId: optionalText,
  convertedToId: optionalText,
  issuedAt: optionalText,
  uploadedAt: optionalText,
  sdiNotes: optionalText,
  transmissionSequence: optionalText,
  xmlFileName: optionalText,
  pdfFileName: optionalText,
});
export type Document = z.infer<typeof DocumentSchema>;
export type DocumentInput = z.input<typeof DocumentSchema>;

/** Nome visualizzato di un soggetto (cliente o emittente). */
export function displayName(p: { companyName?: string; firstName?: string; lastName?: string }): string {
  if (p.companyName) return p.companyName;
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

export function isProforma(doc: Pick<Document, 'type'>): boolean {
  return doc.type === 'proforma';
}
