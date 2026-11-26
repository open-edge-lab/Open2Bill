# Open2Bill — regole di progetto

App per creare fatture elettroniche FatturaPA (XML FPR12) da caricare sul portale
"Fatture e Corrispettivi" dell'Agenzia delle Entrate, con PDF di cortesia da template.
Gira come app desktop (Electron) e come web app self-hosted (Fastify + React).

## Regole obbligatorie

### 1. Lingua: codice in inglese, testi in italiano

- **Tutto ciò che è codice è in inglese**: nomi di file e cartelle, funzioni, metodi,
  variabili, tipi, interfacce, costanti, route API, chiavi YAML/JSON, nomi di test,
  script npm, messaggi di commit.
- **L'italiano solo per**: testi mostrati all'utente (UI, PDF, messaggi di errore
  di validazione), commenti nel codice e nei file YAML, documentazione e guide.
- Unica eccezione: i nomi degli elementi XML e i codici FatturaPA (`DatiRitenuta`,
  `TD01`, `RF01`, `N1`, `TC22`, …) restano come da specifica, perché sono il formato
  ufficiale. Vivono solo nel builder XML e nelle tabelle dei codici.
- Usa il glossario qui sotto per tenere i nomi coerenti in tutto il progetto.

### 2. Mai dati privati nel repository

Il repository è **pubblico** (github.com/open-edge-lab/Open2Bill, AGPL-3.0).

- Dati reali (emittente, clienti, fatture emesse, XML/PDF generati, IBAN, P.IVA,
  codici fiscali, indirizzi, email/PEC) **non vanno mai committati**.
- La cartella dati reale sta **fuori dal repo**: default `~/Documents/Open2Bill`,
  oppure la variabile d'ambiente `O2B_DATA_DIR`.
- Test, fixture, esempi e documentazione usano **solo anagrafiche fittizie**.
  Gli identificativi fittizi ammessi sono elencati in
  `scripts/private-guard-allowlist.txt`.
- L'hook `.githooks/pre-commit` (`scripts/guard-private.mjs`) blocca i commit che
  contengono percorsi dati, documenti generati o identificativi reali. Non va mai
  aggirato (niente `--no-verify`). Viene attivato da `npm install` (script `prepare`).

## Glossario (italiano → nome nel codice)

| Dominio (italiano) | Codice (inglese) |
|---|---|
| emittente / cedente prestatore | `issuer` |
| cliente / cessionario committente | `customer` |
| documento, fattura, parcella | `document`, `invoice` |
| proforma | `proforma` |
| nota di credito | `creditNote` |
| riga del documento | `line` (`DocumentLine`) |
| quantità, prezzo unitario, sconto % | `quantity`, `unitPrice`, `discountPercent` |
| imponibile | `taxableAmount` |
| aliquota IVA, imposta | `vatRate`, `vatAmount` |
| natura IVA (N1…N7) | `vatNature` |
| riepilogo IVA | `vatSummary` |
| cassa previdenziale, contributo | `pensionFund`, `pensionContribution` |
| prezzi con contributo compreso (scorporo) | `pricesIncludeContribution` |
| ritenuta d'acconto | `withholding` |
| marca da bollo | `stampDuty` |
| spese escluse art.15 | `passThroughExpense` |
| totale documento | `documentTotal` |
| netto a pagare | `netPayable` |
| calcolo a ritroso (su una riga / su tutte le righe) | `reverseCalculation` / `reverseCalculationAll` |
| causale | `reason` |
| Partita IVA, codice fiscale | `vatNumber`, `taxCode` |
| denominazione, nome, cognome | `companyName`, `firstName`, `lastName` |
| sede (indirizzo) | `address` |
| codice destinatario, PEC | `recipientCode`, `pec` |
| regime fiscale | `taxRegime` |
| modalità / condizioni di pagamento, scadenza | `paymentMethod`, `paymentTerms`, `dueDate` |
| numerazione, progressivo invio | `numbering`, `transmissionSequence` |
| stato: bozza / emessa / caricata su SdI | `status`: `draft` / `issued` / `uploaded` |
| rubrica clienti, catalogo voci | `customers`, `catalog` |

## Struttura

```
packages/core/   # modello (zod), calcoli (decimal.js), validazioni, codici FatturaPA
                 #   "."           → isomorfo, usato anche dalla UI (calcoli live)
                 #   "./fatturapa" → builder XML (xmlbuilder2, solo Node: NON importarlo nella UI)
                 #   "./xsd"       → validazione XSD (xmllint-wasm, solo Node)
apps/server/     # Fastify: storage YAML, API, template PDF (Handlebars), auth
apps/web/        # React + Vite + Mantine (UI in italiano)
apps/desktop/    # Electron: avvia il server in-process e apre la UI
examples/data/   # cartella dati FITTIZIA di esempio (usata da test ed e2e)
e2e/             # test Playwright della UI
scripts/         # guard dati privati e utilità
```

## Comandi

- `npm install` — installa le dipendenze e attiva gli hook (`core.hooksPath=.githooks`)
- `npm test` — test unitari e di integrazione (Vitest, progetti core + server)
- `npm run test:e2e` — build della UI + test Playwright (usa Edge su Windows)
- `npm run typecheck` / `npm run lint`
- `npm run dev` — API su :3210 + UI Vite su :5273, dati da `O2B_DATA_DIR`
  (default: la cartella reale `~/Documents/Open2Bill`)
- `npm run dev:example` — come sopra su una copia temporanea dei dati fittizi
- `npm run desktop` — app Electron; `O2B_DATA_DIR` forza la cartella dati
- `npm run guard` — controlla i file tracciati e quelli nuovi alla ricerca di dati privati
- `.\open2bill.ps1` — pannello di controllo Windows (menu): avvio, arresto anche forzato,
  stato, log, build dell'exe. Anche da riga di comando: `start <dev|example|desktop|server>`,
  `stop [-Force] [-Yes]`, `status`, `logs <servizio>`, `build`. PID e log in
  `%TEMP%\open2bill-run`. Il file va salvato in **UTF-8 con BOM**, perché PowerShell 5.1
  senza BOM legge male le lettere accentate.
- `npm run embed-schemas -w @open2bill/core` — rigenera `schemas.generated.ts` dopo aver
  aggiornato gli XSD

## Note tecniche

- Le dipendenze runtime del core usate dal server vanno elencate anche in
  `apps/server/package.json` e `apps/desktop/package.json`: tsup tiene esterne solo le
  dipendenze dichiarate, e il bundle ESM di librerie CommonJS (es. xmlbuilder2) si rompe.
- Desktop: `asar: false`, perché xmllint-wasm avvia un worker da file.
- Sicurezza delle richieste (`apps/server/src/request-guard.ts` e `auth.ts`):
  - il login si decide sulla rotta trovata dal router (`req.routeOptions.url`), mai
    sull'URL grezzo, perché il router decodifica `%xx`. Le rotte pubbliche sono elencate
    in `PUBLIC_ROUTES`;
  - in ascolto locale si accettano solo Host di loopback, contro il DNS rebinding;
  - le modifiche da un altro sito si rifiutano confrontando Origin/Sec-Fetch-Site con
    l'Host. Per questo il proxy di Vite deve restare con `changeOrigin: false`, e nginx
    deve passare `Host $host`.
- Nella UI le query del "modello di nuovo documento" non devono stare sotto la chiave
  `['documents', …]`: invalidare i documenti dopo un salvataggio rimonterebbe l'editor.
- Gli strumenti di scrittura file possono trasformare le sequenze `\uXXXX` in caratteri
  letterali: controlla le regex con caratteri speciali (il lint `no-irregular-whitespace`
  aiuta).

## Note FatturaPA

- Schema in vigore: VFPR12 **1.2.3** (dal 01/04/2025). Dall'**11/01/2027** vale la
  1.2.4 (cambiano solo le descrizioni normative e si aggiunge `RF21`). Gli XSD stanno
  in `packages/core/schemas/`; la versione usata per la validazione si sceglie in base
  alla data di invio.
- I testi nell'XML ammettono solo caratteri Basic Latin + Latin-1 Supplement, ma il
  builder scrive **solo ASCII** (`toAscii` in `text.ts`): il visualizzatore dell'Agenzia
  delle Entrate mostra male le lettere accentate anche in un UTF-8 corretto. Le vocali
  accentate diventano vocale + apostrofo ("attività" → "attivita'"), i caratteri
  tipografici l'equivalente ASCII (es. "–" → "-"); poi si tronca ai limiti dello schema.
  Il PDF conserva il testo originale.
- Importi: sempre `decimal.js`, arrotondamento half-up a 2 decimali, mai `number`
  per i calcoli monetari.
