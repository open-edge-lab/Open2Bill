# Deploy web self-hosted

Open2Bill gira in un container Docker dietro nginx con HTTPS, con accesso a password unica.

## 1. Password e segreto di sessione

Sul tuo PC, dalla cartella del progetto:

```bash
npm run hash-password -w @open2bill/server
```

Sul server crea un file `.env`, che non va mai nel repository:

```
O2B_PASSWORD_HASH=scrypt$...
O2B_SESSION_SECRET=<stringa casuale lunga, es. openssl rand -base64 48>
```

## 2. Avvio con Docker

```bash
git clone https://github.com/open-edge-lab/Open2Bill.git && cd Open2Bill
cp docker-compose.example.yml docker-compose.yml
mkdir -p open2bill-data && sudo chown 1000:1000 open2bill-data   # il container gira come utente "node"
docker compose up -d --build
```

Il container ascolta solo su `127.0.0.1:3210`. I PDF si generano con il Chromium installato
nell'immagine.

Per riusare i dati della versione desktop, copia la tua cartella `Documenti/Open2Bill` in
`open2bill-data/`.

## 3. nginx + HTTPS

```nginx
server {
    server_name fatture.example.com;

    location / {
        proxy_pass http://127.0.0.1:3210;
        # Necessario: il server confronta Host e Origin per respingere le richieste da altri
        # siti. Se nginx ascolta su una porta non standard usa $http_host (porta compresa).
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 5m;
    }

    listen 443 ssl; # certificato gestito da certbot
}
```

Ottieni il certificato con `certbot --nginx -d fatture.example.com`. `O2B_TRUST_PROXY=1` (già
impostato nell'immagine) fa sì che il cookie di sessione sia `Secure` dietro HTTPS.

## 4. Backup

Tutto lo stato è nella cartella `open2bill-data/`: fatture emesse, XML, PDF e YAML. Fanne un
backup regolare, cifrato se esce dal server.
