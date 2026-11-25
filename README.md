# Open2Bill

Fatturazione elettronica semplice per professionisti italiani: compili la fattura, Open2Bill
calcola i totali (anche a ritroso dal netto che vuoi ricevere), genera l'**XML FatturaPA** da
caricare sul portale *Fatture e Corrispettivi* dell'Agenzia delle Entrate e un **PDF** di
cortesia da un template modificabile.

Funziona come **app desktop** (Electron, Windows) e come **web app self-hosted** con login.

## Cosa fa

- Fattura (TD01), parcella (TD06), nota di credito (TD04) e **proforma** convertibile in fattura.
- Righe con quantità, prezzo, sconto, IVA o natura (N1…N7).
- **Cassa previdenziale**, es. rivalsa INPS gestione separata 4%, soggetta a ritenuta. I prezzi delle righe possono essere già comprensivi del 4%: il contributo si scorpora una volta sul totale (1.560 → compenso 1.500 + contributo 60).
- **Ritenuta d'acconto** (RT01/RT02, causale CU).
- **Spese escluse art. 15** (N1) e **marca da bollo virtuale**, con avviso automatico sopra 77,47 €.
- **Calcolo a ritroso**: clicchi sul netto (o sull'imponibile o sul totale), scrivi l'importo desiderato e ottieni il compenso. Per esempio, netto 1.530 → compenso 1.442,31. Con più righe ricalcola tutte le prestazioni in proporzione, oppure solo la riga scelta.
- XML validato con gli **schemi XSD ufficiali** (VFPR12 1.2.3, e 1.2.4 dall'11/01/2027) e con i controlli di coerenza più comuni del SdI.
- Rubrica clienti, catalogo voci, numerazione annuale, stato "caricata su SdI".
- Dati in **file YAML** leggibili e modificabili a mano.

## Dati e privacy

La cartella dati sta **fuori dal repository**: di default è `Documenti/Open2Bill`, oppure la
indichi con `O2B_DATA_DIR`. Contiene:

```
issuer.yaml           # i tuoi dati di emittente e i valori predefiniti
customers/*.yaml      # rubrica clienti
catalog.yaml          # voci ricorrenti
documents/<anno>/     # documenti emessi (documents/drafts/ per le bozze)
output/<anno>/        # XML da caricare sul SdI e PDF
templates/<nome>/     # template PDF personalizzati (facoltativo)
auth.yaml             # solo web: password cambiata da Impostazioni (hash, non in chiaro)
```

`examples/data/` contiene una cartella dati **fittizia** da usare come modello. Il repository ha
un hook pre-commit (`scripts/guard-private.mjs`) che blocca i commit con dati reali: P.IVA,
codici fiscali, IBAN, cartelle dati, XML e PDF generati.

## Sviluppo

Requisiti: Node 22+. Su Windows i PDF in modalità web usano Edge o Chrome già installati.

```bash
npm install                     # attiva anche l'hook anti-dati-privati
npm run dev                     # API su :3210 + UI su http://localhost:5273 (dati da O2B_DATA_DIR)
npm run dev:example             # come sopra, ma sui dati fittizi di examples/data
npm test                        # test unitari e di integrazione (Vitest)
npm run test:e2e                # test end-to-end della UI (Playwright)
npm run typecheck && npm run lint
npm run guard                   # controlla che nel repo non ci siano dati privati
```

### Pannello di controllo (Windows)

`open2bill.ps1` raccoglie le operazioni di tutti i giorni in un menu:

- avvio di sviluppo (dati reali o di esempio), app desktop o server di produzione;
- arresto dei servizi avviati dal menu, oppure arresto forzato di ogni processo di
  Open2Bill, compresi gli orfani e l'app installata;
- stato di servizi, porte e processi, con i log;
- compilazione dell'installer `.exe`.

```powershell
.\open2bill.ps1                 # menu interattivo
.\open2bill.ps1 start dev       # oppure: example, desktop, server
.\open2bill.ps1 status
.\open2bill.ps1 stop            # -Force per l'arresto forzato, -Yes senza conferme
.\open2bill.ps1 build
```

I servizi girano in background, senza finestra: chiudere il terminale non li ferma.
Log e PID stanno in `%TEMP%\open2bill-run`, fuori dal repository.

### App desktop

```bash
npm run desktop                 # avvia l'app Electron
npm run dist:win                # crea l'installer Windows in apps/desktop/release
```

L'app avvia il server interno su `127.0.0.1`, su una porta casuale e protetto da un token
generato a ogni avvio. I PDF si generano con il Chromium di Electron.

### Web self-hosted

Vedi [docs/deploy.md](docs/deploy.md).

## Struttura

| Cartella | Contenuto |
|---|---|
| `packages/core` | Modello (zod), calcoli (decimal.js), XML FatturaPA, validazioni. Gira sia nel browser sia in Node. |
| `apps/server` | Fastify: API, storage YAML, template PDF (Handlebars), autenticazione |
| `apps/web` | Interfaccia React + Mantine |
| `apps/desktop` | Electron |

## Licenza

AGPL-3.0. I font IBM Plex sono distribuiti con licenza SIL OFL 1.1. Gli schemi XSD sono quelli
ufficiali pubblicati su fatturapa.gov.it e dal W3C.
