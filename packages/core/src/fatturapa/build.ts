import { create } from 'xmlbuilder2';
import { calculateTotals, type Totals } from '../calc';
import { VAT_NATURES, codeLabel } from '../codes';
import type { Address, CustomerData, Document, Issuer } from '../model';
import { fixed2, fixedRange } from '../money';
import { chunk, latinField, toBasicLatin, truncate } from '../text';
import { normalizeIban } from '../validators';
import { runSemanticChecks, type SemanticIssue } from './checks';

// Costruzione dell'XML FatturaPA (formato FPR12, fattura verso privati).
// Prima si crea un oggetto con la stessa struttura dello schema (FatturaData),
// poi si eseguono i controlli semantici e infine lo si serializza.
// L'ordine delle chiavi segue esattamente le sequenze dell'XSD VFPR12.

export const FATTURAPA_NAMESPACE = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';

type XmlNode = { [key: string]: XmlValue };
type XmlValue = string | XmlNode | XmlNode[] | string[] | undefined;

/** Struttura dati FatturaPA pronta per la serializzazione (nomi come da specifica). */
export interface FatturaData {
  header: XmlNode;
  body: XmlNode;
}

export interface BuildOptions {
  /** ProgressivoInvio: identificativo univoco dell'invio (max 10 caratteri, qui 5 alfanumerici). */
  transmissionSequence: string;
}

export interface BuildResult {
  xml: string;
  fileName: string;
  data: FatturaData;
  totals: Totals;
  issues: SemanticIssue[];
}

/** Nome file richiesto dal SdI: IT + codice trasmittente + "_" + progressivo. */
export function xmlFileName(issuer: Issuer, transmissionSequence: string): string {
  const { country, code } = transmitterId(issuer);
  return `${country}${code}_${transmissionSequence}.xml`;
}

/** Progressivo invio di 5 caratteri alfanumerici a partire da un contatore. */
export function formatTransmissionSequence(counter: number): string {
  if (!Number.isInteger(counter) || counter < 1) throw new Error('Contatore invio non valido');
  const s = counter.toString(36).toUpperCase();
  if (s.length > 5) throw new Error('Contatore invio esaurito');
  return s.padStart(5, '0');
}

function transmitterId(issuer: Issuer): { country: string; code: string } {
  if (issuer.transmitter) return { country: issuer.transmitter.country, code: issuer.transmitter.code };
  return { country: 'IT', code: (issuer.taxCode ?? issuer.vatNumber).toUpperCase() };
}

/** Rimuove le chiavi undefined (xmlbuilder2 genererebbe elementi vuoti). */
function compact<T extends XmlNode>(node: T): T {
  for (const k of Object.keys(node)) if (node[k] === undefined) delete node[k];
  return node;
}

function anagrafica(p: { companyName?: string; firstName?: string; lastName?: string; title?: string }): XmlNode {
  if (p.companyName) return { Denominazione: latinField(p.companyName, 80) };
  return compact({
    Nome: latinField(p.firstName ?? '', 60),
    Cognome: latinField(p.lastName ?? '', 60),
    Titolo: p.title ? truncate(toBasicLatin(p.title), 10) : undefined,
  });
}

function sede(a: Address): XmlNode {
  return compact({
    Indirizzo: latinField(a.street, 60),
    NumeroCivico: a.streetNumber ? truncate(toBasicLatin(a.streetNumber), 8) : undefined,
    CAP: a.postalCode.trim(),
    Comune: latinField(a.city, 60),
    Provincia: a.province ? a.province.trim().toUpperCase() : undefined,
    Nazione: a.country.toUpperCase(),
  });
}

function cessionario(c: CustomerData): XmlNode {
  return {
    DatiAnagrafici: compact({
      IdFiscaleIVA: c.vatNumber
        ? { IdPaese: c.vatCountry.toUpperCase(), IdCodice: c.vatNumber.trim().toUpperCase() }
        : undefined,
      CodiceFiscale: c.taxCode ? c.taxCode.trim().toUpperCase() : undefined,
      Anagrafica: anagrafica(c),
    }),
    Sede: sede(c.address),
  };
}

export function buildFatturaData(doc: Document, issuer: Issuer, options: BuildOptions): { data: FatturaData; totals: Totals } {
  if (doc.type === 'proforma') throw new Error('La proforma non genera XML FatturaPA');
  if (!doc.number) throw new Error('Il documento non ha ancora un numero');

  const totals = calculateTotals(doc);
  const customer = doc.customer;
  const usePec = customer.recipientCode === '0000000' && Boolean(customer.pec);

  const header: XmlNode = {
    DatiTrasmissione: compact({
      IdTrasmittente: { IdPaese: transmitterId(issuer).country, IdCodice: transmitterId(issuer).code },
      ProgressivoInvio: options.transmissionSequence,
      FormatoTrasmissione: 'FPR12',
      CodiceDestinatario: customer.recipientCode,
      PECDestinatario: usePec ? customer.pec : undefined,
    }),
    CedentePrestatore: compact({
      DatiAnagrafici: compact({
        IdFiscaleIVA: { IdPaese: issuer.vatCountry.toUpperCase(), IdCodice: issuer.vatNumber.trim() },
        CodiceFiscale: issuer.taxCode ? issuer.taxCode.trim().toUpperCase() : undefined,
        Anagrafica: anagrafica(issuer),
        RegimeFiscale: issuer.taxRegime,
      }),
      Sede: sede(issuer.address),
      Contatti:
        issuer.contacts.phone || issuer.contacts.email
          ? compact({
              Telefono: issuer.contacts.phone ? truncate(toBasicLatin(issuer.contacts.phone), 12) : undefined,
              Email: issuer.contacts.email,
            })
          : undefined,
    }),
    CessionarioCommittente: cessionario(customer),
  };

  const datiGeneraliDocumento: XmlNode = compact({
    TipoDocumento: doc.type,
    Divisa: 'EUR',
    Data: doc.date,
    Numero: truncate(toBasicLatin(doc.number), 20),
    DatiRitenuta: totals.withholding
      ? [
          {
            TipoRitenuta: totals.withholding.type,
            ImportoRitenuta: totals.withholding.amount,
            AliquotaRitenuta: totals.withholding.rate,
            CausalePagamento: totals.withholding.paymentReason,
          },
        ]
      : undefined,
    DatiBollo: totals.stampDuty ? { BolloVirtuale: 'SI', ImportoBollo: totals.stampDuty.amount } : undefined,
    DatiCassaPrevidenziale: totals.pensionFund
      ? [
          compact({
            TipoCassa: totals.pensionFund.type,
            AlCassa: totals.pensionFund.rate,
            ImportoContributoCassa: totals.pensionFund.amount,
            ImponibileCassa: totals.pensionFund.base,
            AliquotaIVA: totals.pensionFund.vatRate,
            Ritenuta: totals.pensionFund.withholding ? 'SI' : undefined,
            Natura: totals.pensionFund.vatNature,
          }),
        ]
      : undefined,
    ImportoTotaleDocumento: totals.documentTotal,
    Causale: doc.reason ? chunk(latinField(doc.reason, 1000), 200) : undefined,
  });

  const datiGenerali: XmlNode = compact({
    DatiGeneraliDocumento: datiGeneraliDocumento,
    DatiFattureCollegate:
      doc.type === 'TD04' && doc.linkedInvoice
        ? [{ IdDocumento: truncate(toBasicLatin(doc.linkedInvoice.number), 20), Data: doc.linkedInvoice.date }]
        : undefined,
  });

  const dettaglioLinee: XmlNode[] = totals.lines.map((l, i) =>
    compact({
      NumeroLinea: String(i + 1),
      Descrizione: latinField(l.description, 1000) || '-',
      Quantita: fixedRange(l.quantity),
      UnitaMisura: l.unit ? truncate(toBasicLatin(l.unit), 10) : undefined,
      DataInizioPeriodo: l.periodStart,
      DataFinePeriodo: l.periodEnd,
      PrezzoUnitario: fixedRange(l.unitPrice),
      ScontoMaggiorazione: l.discountPercent
        ? [{ Tipo: 'SC', Percentuale: fixed2(l.discountPercent) }]
        : undefined,
      PrezzoTotale: l.total,
      AliquotaIVA: l.vatRate,
      Ritenuta: l.withholding ? 'SI' : undefined,
      Natura: l.vatNature,
    }),
  );

  const datiRiepilogo: XmlNode[] = totals.vatSummary.map((r) =>
    compact({
      AliquotaIVA: r.vatRate,
      Natura: r.vatNature,
      ImponibileImporto: r.taxableAmount,
      Imposta: r.vatAmount,
      EsigibilitaIVA: r.vatNature ? undefined : 'I',
      RiferimentoNormativo: r.vatNature ? latinField(codeLabel(VAT_NATURES, r.vatNature), 100) : undefined,
    }),
  );

  const payment = doc.payment;
  const datiPagamento: XmlNode[] | undefined = payment
    ? [
        {
          CondizioniPagamento: payment.terms,
          DettaglioPagamento: [
            compact({
              Beneficiario: payment.beneficiary ? latinField(payment.beneficiary, 200) : undefined,
              ModalitaPagamento: payment.method,
              DataScadenzaPagamento: payment.dueDate,
              ImportoPagamento: totals.netPayable,
              IstitutoFinanziario: payment.bankName ? latinField(payment.bankName, 80) : undefined,
              IBAN: payment.iban ? normalizeIban(payment.iban) : undefined,
            }),
          ],
        },
      ]
    : undefined;

  const body: XmlNode = compact({
    DatiGenerali: datiGenerali,
    DatiBeniServizi: { DettaglioLinee: dettaglioLinee, DatiRiepilogo: datiRiepilogo },
    DatiPagamento: datiPagamento,
  });

  return { data: { header, body }, totals };
}

export function serializeFatturaData(data: FatturaData): string {
  const root = {
    'p:FatturaElettronica': {
      '@versione': 'FPR12',
      '@xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
      '@xmlns:p': FATTURAPA_NAMESPACE,
      '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      '@xsi:schemaLocation': `${FATTURAPA_NAMESPACE} Schema_VFPR12.xsd`,
      FatturaElettronicaHeader: data.header,
      FatturaElettronicaBody: data.body,
    },
  };
  return create({ version: '1.0', encoding: 'UTF-8' }, root).end({ prettyPrint: true, indent: '  ' });
}

/** Costruisce l'XML, esegue i controlli semantici e restituisce anche il nome file. */
export function buildInvoiceXml(doc: Document, issuer: Issuer, options: BuildOptions): BuildResult {
  const { data, totals } = buildFatturaData(doc, issuer, options);
  const issues = runSemanticChecks(data);
  return {
    xml: serializeFatturaData(data),
    fileName: xmlFileName(issuer, options.transmissionSequence),
    data,
    totals,
    issues,
  };
}
