#!/usr/bin/env bash
#
# Boots the local stack: postgres, vision and backend via compose, plus the Next dev server.
# Run by the SessionStart hook in .claude/settings.json, and safe to run by hand.
#
# Two rules it must obey, because it runs unattended on every session:
#
#   Idempotent. `docker compose up -d` is a no-op on a running stack, and the dev server is only
#   started when nothing already answers on 3000. Starting a second one would bind-fail and leave
#   a confusing log.
#
#   Never fatal. A session has to start even when Docker is down or .env is missing. Every failure
#   here is reported and swallowed, never propagated.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 0

status=()

# Compose deliberately refuses to start without CLERK_JWKS_URL (see docker-compose.yml), so a
# missing .env would fail every time. Say so once rather than failing on every session.
if [ ! -f .env ]; then
  echo '{"systemMessage":"Local stack not started: .env is missing, and compose refuses to start without CLERK_JWKS_URL."}'
  exit 0
fi

if docker compose up -d >/tmp/compose-up.log 2>&1; then
  status+=("postgres/vision/backend up")
else
  status+=("compose FAILED (see /tmp/compose-up.log)")
fi

# Is the PORT bound, not "does HTTP answer". A dev server busy recompiling holds 3000 but can take
# many seconds to reply, and an HTTP probe with any tolerable timeout reads that as "nothing there"
# and starts a second server. It does not check a pidfile either: a stale one outlives the process
# and would skip the start forever.
if (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; then
  status+=("frontend already on :3000")
else
  (cd frontend && nohup npm run dev >/tmp/next.log 2>&1 &) >/dev/null 2>&1
  status+=("frontend starting on :3000 (/tmp/next.log)")
fi

printf '{"systemMessage":"MapleStorage: %s."}\n' "$(
  IFS=';'
  echo "${status[*]}" | sed 's/;/, /g'
)"
