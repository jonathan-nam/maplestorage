#!/bin/sh
# Puts *a* certificate where nginx expects one, so it can start.
#
# This exists because of an ordering problem Caddy did not have. nginx refuses to start when
# `ssl_certificate` names a file that is not there, and certbot cannot obtain the real certificate
# until nginx is up to answer the HTTP-01 challenge. Something has to break the cycle: a self-signed
# placeholder does, and certbot overwrites it minutes later.
#
# Runs in the certbot image, not the nginx one: nginx:1-alpine has no openssl binary, and installing
# one at container start would put an apk mirror on the boot path of the only door into the box.
#
# Idempotent. Once a real certificate exists this does nothing, which is what makes it safe to run
# on every deploy.
set -eu

DOMAIN="${API_DOMAIN:?API_DOMAIN is not set}"
LIVE="/etc/letsencrypt/live/${DOMAIN}"

if [ -f "${LIVE}/fullchain.pem" ]; then
  echo "certificate already present for ${DOMAIN}, leaving it alone"
  exit 0
fi

echo "no certificate for ${DOMAIN} yet, writing a self-signed placeholder so nginx can start"
mkdir -p "${LIVE}"

# 1 day, and deliberately so. If certbot never replaces it the site breaks quickly and loudly
# rather than serving a bad certificate for a year while nobody notices.
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout "${LIVE}/privkey.pem" \
  -out "${LIVE}/fullchain.pem" \
  -subj "/CN=${DOMAIN}" 2>/dev/null

echo "placeholder written. Browsers will refuse it, which is correct: it is not a real certificate."
