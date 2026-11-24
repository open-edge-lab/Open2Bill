// Genera src/fatturapa/schemas.generated.ts con gli XSD ufficiali come stringhe,
// così la validazione funziona ovunque (node, bundle Electron, test) senza leggere file.
//
// Gli XSD in ../schemas/ sono quelli ufficiali scaricati da fatturapa.gov.it
// (Schema_VFPR12) e dal W3C (xmldsig-core-schema). L'import dello schema di firma
// viene riscritto per puntare al file locale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.join(here, '..', 'schemas');
const outFile = path.join(here, '..', 'src', 'fatturapa', 'schemas.generated.ts');

const read = (name) =>
  fs
    .readFileSync(path.join(schemasDir, name), 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');

const localDsig = (xsd) =>
  xsd.replace(
    /schemaLocation="http:\/\/www\.w3\.org\/TR\/2002\/REC-xmldsig-core-20020212\/xmldsig-core-schema\.xsd"/,
    'schemaLocation="xmldsig-core-schema.xsd"',
  );

const out = `// File generato da scripts/embed-schemas.mjs: non modificare a mano.
/* eslint-disable */
export const XSD_VFPR12_1_2_3 = ${JSON.stringify(localDsig(read('Schema_VFPR12_v1.2.3.xsd')))};
export const XSD_VFPR12_1_2_4 = ${JSON.stringify(localDsig(read('Schema_VFPR12_v1.2.4.xsd')))};
export const XSD_XMLDSIG = ${JSON.stringify(read('xmldsig-core-schema.xsd'))};
`;

fs.writeFileSync(outFile, out);
console.log(`Scritto ${path.relative(process.cwd(), outFile)}`);
