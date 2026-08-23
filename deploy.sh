#!/usr/bin/env bash
#
# Deploy, from on the box. `ssh ubuntu@<static-ip>`, then `cd sharpeyes && ./deploy.sh`.
#
# No downtime. Two backend replicas sit behind nginx, and this restarts one at a time, waiting for
# each to answer /health before touching the next.
#
# The measurement that used to be quoted here (224 requests, 0 failures across a deploy) was taken
# through Caddy, whose ACTIVE health checks pulled a restarting replica out of rotation before any
# request reached it. Open-source nginx has no active health checking, so the mechanism is now
# `proxy_next_upstream`: the first request to a restarting replica fails and is retried against the
# other one. The user should still see no error, but the guarantee is weaker and the old numbers do
# not carry over. RE-MEASURE before quoting any here again.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
REPLICAS=("backend:8080" "backend-b:8081")

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

# Images are tagged with the commit, not `latest`, so that `git checkout <old-sha> && ./deploy.sh`
# actually runs the old binary. Exported because compose interpolates it out of the environment.
IMAGE_TAG="$(git rev-parse HEAD)"
export IMAGE_TAG
echo "==> deploying ${IMAGE_TAG:0:12}"

# The images are built by CI, so a just-pushed commit may not have them yet. Waiting beats failing:
# the alternative is reading a registry 404 and guessing whether it is a build in flight or a
# workflow that never ran.
echo "==> fetching images"
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" pull --quiet 2>/dev/null; then
    break
  fi
  if [ "$i" = 30 ]; then
    echo "no images for ${IMAGE_TAG:0:12} after 5 minutes." >&2
    echo "Check the 'Publish images' workflow for this commit." >&2
    exit 1
  fi
  [ "$i" = 1 ] && echo "    not published yet, waiting for CI"
  sleep 10
done

# Waits for one replica to answer /health, asked from inside nginx, which is the one container that
# is allowed to reach them. /health only answers once Flyway has migrated, so this waits for ready
# and not merely for listening.
#
# This used to be asked from inside the parser's container, because that is where the replicas'
# ports lived. They have their own now.
await_replica() {
  local name="$1" port="$2"
  for i in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T nginx wget -q -O /dev/null "http://${name}:${port}/health" 2>/dev/null; then
      echo "    ${name} healthy after ${i}s"
      return 0
    fi
    sleep 1
  done
  echo "==> ${name} never came up. Last 40 lines:" >&2
  "${COMPOSE[@]}" logs --tail 40 "$name" >&2
  return 1
}

# Postgres first.
#
# There used to be a branch here for the parser being replaced, and it was the sharpest edge in the
# file: the replicas lived inside the parser's network namespace, so recreating it left them holding
# a namespace with nothing in it. They kept reporting `running`, the proxy got connection refused on
# both upstreams, and it never recovered on its own. It was the one deploy that cost downtime.
#
# The parser is not deployed any more and the replicas have their own network, so there is nothing
# to strand and no branch to take.
echo "==> postgres"
"${COMPOSE[@]}" up -d postgres

# Sign-in, on its own and before the replicas.
#
# One instance, no rolling, and that is fine: the backend verifies tokens offline against keys it
# cached at startup, so nothing serving the API depends on this being up. The cost of a restart is
# a few seconds in which somebody cannot START a session, not one in which sessions stop working.
echo "==> auth"
"${COMPOSE[@]}" up -d --no-deps auth

# One replica at a time. No --force-recreate: compose leaves a replica alone when nothing about it
# changed, and a deploy that restarts nothing is the correct outcome for a docs-only commit.
for replica in "${REPLICAS[@]}"; do
  name="${replica%%:*}"
  port="${replica##*:}"

  echo "==> ${name}"
  "${COMPOSE[@]}" up -d --no-deps "$name"

  # Reload nginx before waiting, not after the loop. It resolves upstream addresses when it starts
  # or reloads, and a recreated container can come back on a different one. Skip this and nginx
  # keeps proxying to an address nothing is listening on, which looks like a replica that came up
  # healthy and serves 502s anyway. Caddy re-resolved on its own; this is the replacement for that.
  "${COMPOSE[@]}" exec -T nginx nginx -s reload 2>/dev/null || true

  if ! await_replica "$name" "$port"; then
    echo "==> the other replica is still serving. Nothing further was restarted." >&2
    exit 1
  fi
done

# nginx last, and reloaded rather than restarted. The config is a bind-mounted template, so compose
# cannot see that it changed and `up -d` would leave the old one running; restarting the container
# would drop live connections for no reason. `nginx -s reload` swaps it with neither.
#
# The template is rendered by the image's entrypoint, which only runs at START-UP, so a changed
# template needs the container recreated before a reload has anything new to load. Hence up -d with
# --force-recreate rather than a bare reload.
echo "==> nginx"
"${COMPOSE[@]}" up -d --no-deps --force-recreate nginx
"${COMPOSE[@]}" exec -T nginx nginx -t
"${COMPOSE[@]}" exec -T nginx nginx -s reload

# The real check, made from outside, through nginx, over TLS, against the actual hostname. A
# container that is "up" proves nothing.
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
"${COMPOSE[@]}" logs --tail 40 backend backend-b auth nginx certbot >&2
exit 1
