#!/usr/bin/env node
// Guardia anti-dati-privati per un repository PUBBLICO.
//
// Uso:
//   node scripts/guard-private.mjs                  → file in stage (hook pre-commit)
//   node scripts/guard-private.mjs --all            → tutti i file tracciati e quelli nuovi non ignorati
//   node scripts/guard-private.mjs --message <file> → messaggio di commit (hook commit-msg)
//
// Blocca:
//   1. percorsi che non devono mai finire nel repo (cartelle dati, XML/PDF generati, .env…);
//   2. identificativi reali letti dalla cartella dati vera (O2B_DATA_DIR oppure
//      ~/Documents/Open2Bill: emittente, clienti e documenti) e dal file locale
//      .private-patterns (non versionato). Nomi e indirizzi si confrontano anche ignorando
//      maiuscole, spazi, punteggiatura e forma societaria ("ACME SRL" = "Acme S.r.l." = "acme");
//   3. qualsiasi codice fiscale, IBAN italiano o partita IVA con checksum valido che
//      NON sia nella lista dei valori fittizi (scripts/private-guard-allowlist.txt).
//
// Nessuna dipendenza esterna: deve funzionare anche prima di `npm install`.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = git(['rev-parse', '--show-toplevel']).trim();
const checkAll = process.argv.includes('--all');

// ── 1. Percorsi vietati ──────────────────────────────────────
const isExample = (p) => p.startsWith('examples/data/') || /(^|\/)test\/fixtures\//.test(p);
const forbiddenPathRules = [
  { re: /(^|\/)(data|output|documents|customers)\//, why: 'cartella dati' },
  { re: /(^|\/)(issuer|catalog|state)\.ya?ml$/, why: 'file dati YAML' },
  { re: /\.(pdf|p7m)$/i, why: 'documento PDF/firmato' },
  { re: /(^|\/)IT[0-9A-Z]{11,16}_[0-9A-Za-z]{1,5}\.xml$/i, why: 'fattura XML generata' },
  { re: /(^|\/)\.env(\.(?!example$).*)?$/, why: 'file .env' },
  { re: /(^|\/)\.private-patterns$/, why: 'pattern privati locali' },
  { re: /\.(local|private)\.[^/]+$/, why: 'file locale/privato' },
];

// ── 2. Identificativi reali (letterali) ──────────────────────
const SENSITIVE_KEYS = [
  'vatNumber', 'taxCode', 'iban', 'email', 'pec', 'phone',
  'companyName', 'lastName', 'recipientCode', 'street',
];
const IGNORED_VALUES = new Set(['0000000', 'XXXXXXX', 'IT', 'EUR']);
// Chiavi i cui valori si cercano anche in forma "normalizzata" (vedi normalizeText)
const NAME_KEYS = new Set(['companyName', 'lastName', 'street']);
const LEGAL_FORM = /[\s,.]*\b(s\.?\s?r\.?\s?l\.?(\s?s\.?)?|s\.?\s?p\.?\s?a\.?|s\.?\s?a\.?\s?s\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?p\.?\s?a\.?|s\.?\s?s\.?)\s*$/i;

// Solo lettere e cifre minuscole, senza accenti: "Acme S.r.l." → "acmesrl"
function normalizeText(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function realDataDirs() {
  const dirs = [];
  if (process.env.O2B_DATA_DIR) dirs.push(process.env.O2B_DATA_DIR);
  dirs.push(path.join(os.homedir(), 'Documents', 'Open2Bill'));
  return [...new Set(dirs)].filter((d) => fs.existsSync(d));
}

function extractYamlValues(file) {
  const out = [];
  const keyRe = new RegExp(String.raw`^\s*(?:-\s*)?(${SENSITIVE_KEYS.join('|')})\s*:\s*(.+?)\s*$`);
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(keyRe);
    if (!m) continue;
    let value = m[2].replace(/\s+#.*$/, '').trim();
    value = value.replace(/^["']|["']$/g, '').trim();
    if (value.length >= 4 && !IGNORED_VALUES.has(value)) out.push({ key: m[1], value });
  }
  return out;
}

function yamlFilesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return yamlFilesIn(p);
    return /\.ya?ml$/i.test(entry.name) ? [p] : [];
  });
}

// I documenti contano: un cliente inserito al volo vive solo dentro la fattura.
function collectPrivateLiterals() {
  const literals = new Set();
  const normalized = new Set();
  const patternsFile = path.join(repoRoot, '.private-patterns');
  if (fs.existsSync(patternsFile)) {
    for (const raw of fs.readFileSync(patternsFile, 'utf8').split(/\r?\n/)) {
      const v = raw.trim();
      if (v && !v.startsWith('#') && v.length >= 4) literals.add(v);
    }
  }
  for (const dir of realDataDirs()) {
    const files = ['issuer.yaml', 'issuer.yml'].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
    files.push(...yamlFilesIn(path.join(dir, 'customers')), ...yamlFilesIn(path.join(dir, 'documents')));
    for (const f of files) {
      for (const { key, value } of extractYamlValues(f)) {
        literals.add(value);
        if (key === 'vatNumber' || key === 'taxCode') {
          // anche senza prefisso di paese e separatori: "IT 012.345..." → "012345..."
          const bare = value.replace(/[\s.-]/g, '').replace(/^[A-Z]{2}(?=\d{11}$)/i, '');
          if (bare.length >= 11) literals.add(bare);
        }
        if (!NAME_KEYS.has(key)) continue;
        for (const variant of [value, value.replace(LEGAL_FORM, '')]) {
          const n = normalizeText(variant);
          if (n.length >= 6) normalized.add(n);
        }
      }
    }
  }
  return { literals: [...literals], normalized: [...normalized] };
}

// ── 3. Rilevatori generici con checksum ──────────────────────
const allowlist = new Set(
  readIfExists(path.join(repoRoot, 'scripts', 'private-guard-allowlist.txt'))
    .split(/\r?\n/)
    .map((l) => l.trim().toUpperCase())
    .filter((l) => l && !l.startsWith('#')),
);

const CF_ODD = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
function isValidTaxCode(cf) {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = cf[i];
    const n = /[0-9]/.test(c) ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 65;
    sum += i % 2 === 0 ? CF_ODD[n] : n;
  }
  return String.fromCharCode(65 + (sum % 26)) === cf[15];
}

function isValidVatNumber(v) {
  if (/^(\d)\1{10}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = v.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === v.charCodeAt(10) - 48;
}

function isValidIban(iban) {
  const s = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of s) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return rem === 1;
}

const detectors = [
  {
    name: 'codice fiscale',
    re: /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/g,
    valid: isValidTaxCode,
  },
  { name: 'IBAN', re: /\bIT\d{2}[A-Z]\d{10}[0-9A-Z]{12}\b/g, valid: isValidIban },
  { name: 'partita IVA', re: /(?<![\d.,-])\d{11}(?![\d.,])/g, valid: isValidVatNumber },
];

// ── Scansione ────────────────────────────────────────────────
const SKIP_CONTENT = [/(^|\/)package-lock\.json$/, /^scripts\/private-guard-allowlist\.txt$/, /\.xsd$/];

const messageIdx = process.argv.indexOf('--message');
const messageFile = messageIdx > 0 ? process.argv[messageIdx + 1] : null;

const files = messageFile
  ? []
  : checkAll
    ? git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
    : git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);

const { literals, normalized } = collectPrivateLiterals();
const problems = [];

// Ogni sorgente da controllare: { name, text }
const sources = [];
if (messageFile) {
  sources.push({ name: 'messaggio di commit', text: readIfExists(messageFile) });
}
for (const file of files) {
  if (!isExample(file)) {
    for (const rule of forbiddenPathRules) {
      if (rule.re.test(file)) problems.push(`${file}: percorso vietato (${rule.why})`);
    }
  }
  if (SKIP_CONTENT.some((re) => re.test(file))) continue;
  const buf = checkAll ? readFileBuffer(path.join(repoRoot, file)) : gitBuffer(['show', `:${file}`]);
  if (!buf || buf.includes(0)) continue; // binario o non leggibile
  sources.push({ name: file, text: buf.toString('utf8') });
}

for (const { name, text } of sources) {
  text.split(/\r?\n/).forEach((line, idx) => {
    const where = `${name}:${idx + 1}`;
    const upper = line.toUpperCase();
    const compact = upper.replace(/\s+/g, '');
    for (const lit of literals) {
      const u = lit.toUpperCase();
      if (upper.includes(u) || (/^[A-Z0-9]{11,}$/.test(u.replace(/\s+/g, '')) && compact.includes(u.replace(/\s+/g, '')))) {
        problems.push(`${where}: contiene un dato reale (${mask(lit)})`);
      }
    }
    const lineNormalized = normalizeText(line);
    for (const n of normalized) {
      if (lineNormalized.includes(n)) problems.push(`${where}: contiene un nome o indirizzo reale (${mask(n)})`);
    }
    for (const d of detectors) {
      for (const m of upper.matchAll(d.re)) {
        const v = m[0];
        if (!allowlist.has(v) && d.valid(v)) {
          problems.push(`${where}: ${d.name} valido non fittizio (${mask(v)})`);
        }
      }
    }
  });
}

if (problems.length) {
  console.error('\n✖ Open2Bill guard: trovati possibili dati privati. Commit bloccato.\n');
  for (const p of [...new Set(problems)]) console.error('  - ' + p);
  console.error(
    '\nI dati reali vanno solo nella cartella dati fuori dal repo.' +
      '\nSe un identificativo è davvero fittizio, aggiungilo a scripts/private-guard-allowlist.txt.\n',
  );
  process.exit(1);
}
if (checkAll) console.log(`✔ Open2Bill guard: ${files.length} file controllati, nessun dato privato.`);

// ── utilità ──────────────────────────────────────────────────
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd: process.cwd(), maxBuffer: 256 * 1024 * 1024 });
}
function gitBuffer(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }
}
function readFileBuffer(p) {
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}
function readIfExists(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}
function mask(v) {
  return v.length <= 4 ? '****' : v.slice(0, 2) + '…' + '*'.repeat(Math.min(6, v.length - 2));
}
