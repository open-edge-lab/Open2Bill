#!/bin/bash
# Aggancia Open2Bill al reverse proxy del server. Da eseguire come root:
#
#   ssh root@<server> bash /opt/open2bill/deploy/setup-nginx.sh
#
# Idempotente. Serve di nuovo solo se cambia deploy/nginx/open2bill.conf.
# Richiede un server block 443 che includa /etc/nginx/apps-enabled/*.conf.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP_DIR=${APP_DIR:-/opt/open2bill}
APPS_DIR=/etc/nginx/apps-enabled

if ! grep -rqs "include /etc/nginx/apps-enabled/\*.conf" /etc/nginx/sites-enabled/; then
  echo "nessun server block include $APPS_DIR/*.conf: configura prima il server 443 condiviso" >&2
  exit 1
fi

install -d -m 0755 "$APPS_DIR"
install -m 0644 "$APP_DIR/deploy/nginx/open2bill.conf" "$APPS_DIR/open2bill.conf"

nginx -t
systemctl reload nginx
systemctl is-active nginx
echo "NGINX_OK"
