#!/bin/sh
# Obtains the certificate if there is not a real one yet, then renews it forever.
#
# Caddy did both of these itself. This is the part of the swap that has to be owned: a renewal that
# silently stops working takes the site down 90 days later, with nothing to see in between. Check
# `docker compose logs certbot` if https ever starts failing for no apparent reason.
#
# And nothing will email you about it. Let's Encrypt ended expiration notifications on 2025-06-04, so
# CERTBOT_EMAIL below registers the account and buys no warning whatsoever. Expiry has to be watched
# from outside, by something that actually reads the certificate.
set -eu

DOMAIN="${API_DOMAIN:?API_DOMAIN is not set}"
EMAIL="${CERTBOT_EMAIL:?CERTBOT_EMAIL is not set. certonly needs one to register the account}"

# The renewal config is the honest test of "do we have a real certificate". The live/ directory is
# not: bootstrap-cert.sh puts a self-signed one there precisely so nginx can start.
# A LOOP, not one attempt. The first deploy failed here (nginx was serving the wrong config, so the
# challenge 404'd) and then fell straight through into the renew loop below, where `certbot renew`
# is a no-op because there is no renewal config to renew. That container could never obtain a
# certificate at all without being restarted by hand.
while [ ! -f "/etc/letsencrypt/renewal/${DOMAIN}.conf" ]; do
  echo "no real certificate for ${DOMAIN}, asking Let's Encrypt"

  # bootstrap-cert.sh's placeholder sits at exactly the path certbot wants, and certbot REFUSES to
  # write into a live/ directory it does not manage: "live directory exists for <domain>".
  # --force-renewal does NOT cover that, it applies to certificates certbot already manages and the
  # placeholder is not one. This used to carry that flag and the comment that went with it, and both
  # were wrong. Move the placeholder out of the way instead, and put it back below if this fails.
  rm -rf "/etc/letsencrypt/live/${DOMAIN}" "/etc/letsencrypt/archive/${DOMAIN}"

  if certbot certonly \
      --webroot --webroot-path /var/www/certbot \
      -d "${DOMAIN}" \
      --email "${EMAIL}" \
      --agree-tos --no-eff-email \
      --non-interactive; then
    break
  fi

  # Put a placeholder back, or a recreated nginx has no certificate and will not start at all.
  sh /bootstrap-cert.sh

  # 15 minutes, so four attempts an hour. Let's Encrypt allows 5 FAILED validations per hostname per
  # hour, and burning that budget leaves you waiting rather than debugging.
  echo "issuance failed, nginx is still serving the placeholder. Retrying in 15 minutes."
  sleep 900
done

# Twice a day, which is what Let's Encrypt asks for. Renewal is a no-op until 30 days before expiry,
# so this is cheap, and running often means a failure has many chances to recover before it matters.
#
# nginx is not reloaded from here: it cannot be, the process is in another container. It reloads
# itself on its own timer instead, see docker-compose.prod.yml.
while :; do
  sleep 12h
  certbot renew --webroot --webroot-path /var/www/certbot || echo "renew failed, will retry in 12h"
done
