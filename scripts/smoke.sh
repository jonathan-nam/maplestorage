#!/usr/bin/env bash
# Bring the whole stack up locally and prove it actually works.
#
# This is the check the project has never had: the deploy pipeline has never run
# green, so until now nothing had ever started the backend against a real
# database and a real parser and confirmed the pieces fit. Every bug we found by
# reading code -- a missing env var, a container that starts before its
# dependency, a health check that does not pass -- is the kind this catches in
# 60 seconds instead of in a failed deploy.
#
#   ./scripts/smoke.sh          run it
#   ./scripts/smoke.sh --keep   leave the stack running afterwards
set -euo pipefail

# The parser is behind a compose profile so production does not deploy it. This suite parses a
# screenshot, so it very much needs it.
export COMPOSE_PROFILES=parser

cd "$(dirname "$0")/.."

KEEP="${1:-}"
SHOT="test-fixtures/inventory/untradeables sample.png"
PASS=0
FAIL=0

check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name"
    FAIL=$((FAIL + 1))
  fi
}

cleanup() {
  if [[ "$KEEP" != "--keep" ]]; then
    echo
    echo "==> tearing down"
    docker compose down -v >/dev/null 2>&1 || true
  else
    echo
    echo "stack left running (--keep). 'docker compose down -v' when you are done."
  fi
}
trap cleanup EXIT

echo "==> building and starting the stack"
docker compose up -d --build --wait 2>&1 | tail -3

echo
echo "==> checks"

# 1. Each service is up on its own terms.
check "postgres accepts connections" \
  docker compose exec -T postgres pg_isready -U sharpeyes

# The vision service publishes 8000 locally, but ask it from inside anyway: this is the check that
# the container is serving, not that the port forward works.
# from the host even with the port published. Probe it where it actually lives.
check "vision service is healthy" \
  docker compose exec -T vision python -c \
  "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"

# The JVM takes a while, and the backend has no healthcheck of its own.
echo -n "  ....  waiting for the backend"
for _ in $(seq 1 30); do
  if curl -fsS http://localhost:8080/health >/dev/null 2>&1; then break; fi
  sleep 2
done
echo -e "\r\033[K\c"
check "backend is healthy" curl -fsS http://localhost:8080/health

# 2. The wiring. This is the assertion that matters: the backend must reach the
#    vision service by name on the compose network. A compose file on separate
#    networks would pass everything above and still be wrong.
check "backend reaches vision by service name" \
  docker compose exec -T backend sh -c \
  'wget -qO- http://vision:8000/health || curl -fsS http://vision:8000/health'

# 3. The actual product: a real screenshot in, the right numbers out. POSTed from
#    inside the container, over the same loopback the backend uses.
RESULT="$(docker compose exec -T vision python - <<'PYEOF' 2>/dev/null || echo '{}'
import json, urllib.request
body = open("/screenshots/inventory/untradeables sample.png", "rb").read()
req = urllib.request.Request(
    "http://127.0.0.1:8000/parse", data=body, headers={"Content-Type": "image/png"}
)
print(urllib.request.urlopen(req).read().decode())
PYEOF
)"

read -r GOT_HUD GOT_COUNTS <<<"$(printf '%s' "$RESULT" | python3 scripts/_vision_summary.py)"

EXPECTED="blissful-fantasy-shard=6,distorted-ambition=10,echo-ancient-resolve=6,ferocious-beast-ring=9,kalos-token=21"

if [[ "$GOT_HUD" == "acornacorn/287" ]]; then
  echo "  PASS  screenshot HUD read correctly (acornacorn, level 287)"
  PASS=$((PASS + 1))
else
  echo "  FAIL  screenshot HUD: got '$GOT_HUD'"
  FAIL=$((FAIL + 1))
fi

if [[ "$GOT_COUNTS" == "$EXPECTED" ]]; then
  echo "  PASS  screenshot token counts read correctly (5 tokens)"
  PASS=$((PASS + 1))
else
  echo "  FAIL  screenshot token counts"
  echo "          expected: $EXPECTED"
  echo "          got:      $GOT_COUNTS"
  FAIL=$((FAIL + 1))
fi

# 4. The migrations ran -- an empty schema means Flyway never fired.
check "database schema was migrated" \
  docker compose exec -T postgres psql -U sharpeyes -d sharpeyes \
  -c "select 1 from token_catalog limit 1"

echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "==> $PASS/$((PASS + FAIL)) checks passed. The stack works end to end."
else
  echo "==> $FAIL of $((PASS + FAIL)) checks FAILED"
  echo
  echo "logs:"
  docker compose logs --tail 25
fi
exit "$FAIL"
