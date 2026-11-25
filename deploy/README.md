# Demo su un server con nginx condiviso

Open2Bill in un container, con i **dati fittizi** di `examples/data`, pubblicato da nginx
sotto `https://<server>/open2bill/` accanto ad altre app. Per un'installazione vera, con i tuoi
dati, segui [docs/deploy.md](../docs/deploy.md).

```
browser ──https──▶ nginx (443) ── location /open2bill/ ──▶ 127.0.0.1:8086 ──▶ container :3210
```

- Il prefisso `/open2bill/` è compilato negli asset della UI (`VITE_BASE`, in
  `docker-compose.demo.yml`) e tolto da nginx (barra finale in `proxy_pass`): se lo cambi,
  cambia **entrambi**.
- nginx inoltra `Host $http_host`: il server confronta Origin e Host, e `$host` perde la porta.
- I dati stanno in `demo-data/` sul server, **fuori dall'immagine e fuori dal repository**.
  Solo dati fittizi: la demo è raggiungibile da altri.

## Prima installazione

Sul server, come root:

```bash
install -d -o <utente> -g <utente> /opt/open2bill
```

Dal PC, in Git Bash nella cartella del progetto: password di accesso e segreto di sessione.

```bash
npm run hash-password -w @open2bill/server     # stampa O2B_PASSWORD_HASH=scrypt$...
```

Sul server crea `/opt/open2bill/.env` (permessi 600), con l'hash **tra apici singoli**,
perché contiene `$`:

```
O2B_PASSWORD_HASH='scrypt$...'
O2B_SESSION_SECRET='<openssl rand -base64 48>'
```

## Aggiornamento (anche la prima volta)

Si spediscono solo i file che git conosce (tracciati e nuovi non ignorati): niente
`node_modules`, build, `.env` o file ignorati come PDF e XML generati.

```bash
git ls-files -z -co --exclude-standard | tar czf - --null -T - --ignore-failed-read | \
  ssh <utente>@<server> \
  "cd /opt/open2bill && tar xzf - && \
   ( [ -d demo-data ] || cp -r examples/data demo-data ) && \
   docker compose -f deploy/docker-compose.demo.yml up -d --build"
```

La prima volta `demo-data/` si crea dalla copia di `examples/data`; gli aggiornamenti non la
toccano. Per azzerare la demo: `rm -rf demo-data && cp -r examples/data demo-data` e riavvia il
container.

nginx, solo la prima volta o se cambia `deploy/nginx/open2bill.conf`:

```bash
ssh root@<server> bash /opt/open2bill/deploy/setup-nginx.sh
```

## Verifiche

```bash
curl -k https://<server>/open2bill/api/health      # {"ok":true}
curl -k https://<server>/open2bill/ | grep assets   # gli asset puntano a /open2bill/assets/...
ssh <utente>@<server> "docker logs open2bill --tail 50"
```

Dopo il login prova anche, dalla UI, l'anteprima di un documento e "Scarica PDF di prova":
il primo PDF avvia Chromium nel container e richiede qualche secondo.
