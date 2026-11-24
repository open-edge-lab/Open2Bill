// Entry point lato server (@open2bill/core/fatturapa): costruzione dell'XML FatturaPA.
// È separato dall'index principale perché xmlbuilder2 dipende da moduli Node
// e non deve finire nel bundle della UI.
export {
  buildInvoiceXml,
  buildFatturaData,
  serializeFatturaData,
  xmlFileName,
  formatTransmissionSequence,
  FATTURAPA_NAMESPACE,
  type BuildOptions,
  type BuildResult,
  type FatturaData,
} from './build';
export { runSemanticChecks, type SemanticIssue } from './checks';
