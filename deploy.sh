#!/usr/bin/env bash
#
# Deploy, from on the box. `ssh ubuntu@<static-ip>`, then `cd maplestorage && ./deploy.sh`.
#
# There is ~30 seconds of downtime while the containers restart. That is the accepted cost of one
# box: rolling deploys need somewhere to roll to.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

if [ ! -f .env ]; then
  echo "no .env. Copy .env.prod.example and fill it in (see docs/deploy.md)." >&2
  exit 1
fi

# shellcheck disable=SC1091
source .env
: "${API_DOMAIN:?set it in .env}"

echo "==> pulling"
# --ff-only: refuse to deploy a merge commit nobody has seen. If this fails, look at the box's
# checkout before forcing anything.
git pull --ff-only

echo "==> building and starting"
"${COMPOSE[@]}" up -d --build

# The real check, made from outside, through Caddy, over TLS, against the actual hostname. A
# container that is "up" proves nothing: the backend crash-loops on a missing env var, and Flyway
# migrates on every boot, so a bad migration fails here and nowhere earlier.
echo "==> waiting for https://${API_DOMAIN}/health"
for i in $(seq 1 60); do
  if curl -sf -o /dev/null --max-time 5 "https://${API_DOMAIN}/health"; then
    echo "==> healthy after ${i}s"
    "${COMPOSE[@]}" ps
    exit 0
  fi
  sleep 1
done

echo "==> NOT healthy after 60s. Last 40 lines:" >&2
"${COMPOSE[@]}" logs --tail 40 backend caddy >&2
exit 1
