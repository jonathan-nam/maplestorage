#!/bin/sh
# Obtains the certificate if there is not a real one yet, then renews it forever.
#
# Caddy did both of these itself. This is the part of the swap that has to be owned: a renewal that
# silently stops working takes the site down 90 days later, with nothing to see in between. Check
# `docker compose logs certbot` if https ever starts failing for no apparent reason.
set -eu

DOMAIN="${API_DOMAIN:?API_DOMAIN is not set}"
EMAIL="${CERTBOT_EMAIL:?CERTBOT_EMAIL is not set. Let's Encrypt sends expiry warnings there}"

# The renewal config is the honest test of "do we have a real certificate". The live/ directory is
# not: bootstrap-cert.sh puts a self-signed one there precisely so nginx can start.
if [ ! -f "/etc/letsencrypt/renewal/${DOMAIN}.conf" ]; then
  echo "no real certificate for ${DOMAIN}, asking Let's Encrypt"

  # --force-renewal because live/ already holds the self-signed placeholder, and without it certbot
  # sees a certificate and declines. Not a re-issue: there is nothing real to re-issue yet.
  certbot certonly \
    --webroot --webroot-path /var/www/certbot \
    -d "${DOMAIN}" \
    --email "${EMAIL}" \
    --agree-tos --no-eff-email \
    --non-interactive \
    --force-renewal || echo "issuance FAILED, nginx is still serving the placeholder"
fi

# Twice a day, which is what Let's Encrypt asks for. Renewal is a no-op until 30 days before expiry,
# so this is cheap, and running often means a failure has many chances to recover before it matters.
#
# nginx is not reloaded from here: it cannot be, the process is in another container. It reloads
# itself on its own timer instead, see docker-compose.prod.yml.
while :; do
  sleep 12h
  certbot renew --webroot --webroot-path /var/www/certbot || echo "renew failed, will retry in 12h"
done
