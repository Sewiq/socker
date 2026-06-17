#!/bin/sh
# init-letsencrypt.sh — bootstrap pierwszego certyfikatu Let's Encrypt.
#
# Działanie:
#   1. Tworzy dummy cert (samopodpisany), żeby nginx wstał z konfigiem SSL.
#   2. Uruchamia nginx.
#   3. Usuwa dummy cert.
#   4. Wywołuje certbot przez webroot (HTTP-01 challenge na :80).
#   5. Reload nginx z prawdziwym certem.
#
# Uruchom RAZ, po pierwszym `docker compose up -d --no-start`.

set -e

DOMAIN="${DOMAIN:-prostriker.online}"
EMAIL="${EMAIL_LE:?Set EMAIL_LE in .env}"
DATA_PATH="./certbot"
STAGING="${STAGING:-0}"   # 1 = staging (test), 0 = real cert

if [ ! -e "$DATA_PATH/conf/options-ssl-nginx.conf" ] || [ ! -e "$DATA_PATH/conf/ssl-dhparams.pem" ]; then
  echo "### Pobieranie zalecanych parametrów TLS ..."
  mkdir -p "$DATA_PATH/conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > "$DATA_PATH/conf/options-ssl-nginx.conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$DATA_PATH/conf/ssl-dhparams.pem"
fi

echo "### Tworzenie dummy cert dla $DOMAIN ..."
DUMMY_PATH="/etc/letsencrypt/live/$DOMAIN"
mkdir -p "$DATA_PATH/conf/live/$DOMAIN"
docker compose run --rm --entrypoint "\
  openssl req -x509 -nodes -newkey rsa:2048 -days 1\
    -keyout '$DUMMY_PATH/privkey.pem' \
    -out '$DUMMY_PATH/fullchain.pem' \
    -subj '/CN=localhost'" certbot

echo "### Start nginx z dummy certem ..."
docker compose up --force-recreate -d nginx

echo "### Usuwanie dummy cert ..."
docker compose run --rm --entrypoint "\
  rm -Rf /etc/letsencrypt/live/$DOMAIN && \
  rm -Rf /etc/letsencrypt/archive/$DOMAIN && \
  rm -Rf /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

echo "### Wnioskowanie o prawdziwy cert dla $DOMAIN ..."
STAGING_ARG=""
if [ $STAGING -ne 0 ]; then STAGING_ARG="--staging"; fi

docker compose run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $STAGING_ARG \
    --email $EMAIL \
    -d $DOMAIN -d www.$DOMAIN \
    --rsa-key-size 4096 \
    --agree-tos \
    --no-eff-email \
    --force-renewal" certbot

echo "### Reload nginx ..."
docker compose exec nginx nginx -s reload

echo ""
echo "GOTOWE. Sprawdź: https://$DOMAIN"
