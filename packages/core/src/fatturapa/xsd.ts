import { validateXML } from 'xmllint-wasm';
import { XSD_VFPR12_1_2_3, XSD_VFPR12_1_2_4, XSD_XMLDSIG } from './schemas.generated';

// Validazione XSD con libxml2 compilato in WebAssembly (nessuna dipendenza nativa).
// Entry point separato (@open2bill/core/xsd) per non includere il wasm nella UI.

export type SchemaVersion = '1.2.3' | '1.2.4';

/** Dall'11/01/2027 è in vigore lo schema 1.2.4 (specifiche tecniche 1.5). */
export const SCHEMA_1_2_4_FROM = '2027-01-11';

/** Versione dello schema valida alla data di invio (default: oggi). */
export function schemaVersionFor(sendDate: string = new Date().toISOString().slice(0, 10)): SchemaVersion {
  return sendDate >= SCHEMA_1_2_4_FROM ? '1.2.4' : '1.2.3';
}

export interface XsdResult {
  valid: boolean;
  version: SchemaVersion;
  errors: string[];
}

export async function validateInvoiceXsd(xml: string, version: SchemaVersion = schemaVersionFor()): Promise<XsdResult> {
  const schema = version === '1.2.4' ? XSD_VFPR12_1_2_4 : XSD_VFPR12_1_2_3;
  const result = await validateXML({
    xml: [{ fileName: 'invoice.xml', contents: xml }],
    schema: [{ fileName: 'Schema_VFPR12.xsd', contents: schema }],
    preload: [{ fileName: 'xmldsig-core-schema.xsd', contents: XSD_XMLDSIG }],
  });
  return {
    valid: result.valid,
    version,
    errors: result.errors.map((e) => e.message ?? e.rawMessage),
  };
}
