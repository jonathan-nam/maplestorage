#!/usr/bin/env bash
# Two accounts, an invite between them, and a check of what the second one can and cannot see.
#
# There is one real user of this app, so the whole sharing line (invite links, and everything a
# member of somebody else's party sees) has no natural way to be exercised. This walks it through
# the real HTTP routes, which is the thing the unit tests cannot do: they call the functions
# directly and never find out whether the SEQUENCE works.
#
#   ./scripts/two-user-walkthrough.sh
#
# Leaves both accounts and their data in the dev database, and makes fresh ones each run because the
# emails carry a timestamp. Fresh so each run starts from a known account rather than from whatever
# the last one left: a link can only be spent once, and a member already seated proves nothing.
#
# Needs password login, which is off by default. Both of these, or the API takes a password the
# sign-in page will not offer:
#   .env                 AUTH_PASSWORD_LOGIN=true
#   frontend/.env.local  NEXT_PUBLIC_PASSWORD_LOGIN=true
# then `docker compose up -d auth`. Discord is the only other way in, and a second Discord account
# is not worth making to test this.
set -euo pipefail

AUTH=${AUTH:-http://localhost:3001}
API=${API:-http://localhost:8080}
STAMP=$(date +%s)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say() { printf '\n=== %s\n' "$1"; }
fail() { printf '\nFAILED: %s\n' "$1" >&2; exit 1; }

# The auth container, by its compose labels rather than through `docker compose logs`.
#
# That command re-reads docker-compose.yml, which interpolates DISCORD_CLIENT_ID and so needs a .env
# the checkout it runs from may not have. A worktree does not, and the failure lands inside sign_up
# where it reads as "no verification link" rather than as a missing file. The project name is pinned
# in the compose file, so this finds the same container from anywhere.
auth_container() {
  docker ps -q \
    --filter label=com.docker.compose.project=sharpeyes \
    --filter label=com.docker.compose.service=auth | head -1
}

# An account, verified and signed in, its cookie jar left at $TMP/<slug>.cookies.
#
# Verification is not skippable even on dev: sign-in answers EMAIL_NOT_VERIFIED until it is done.
# With no RESEND_API_KEY the link is PRINTED to the auth container's logs rather than sent, so it is
# read back out of them. That is the one step here that looks like a trick and is not.
sign_up() {
  local slug=$1 email=$2 password=$3 name=$4
  curl -sS -X POST "$AUTH/api/auth/sign-up/email" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"name\":\"$name\"}" >/dev/null

  local container link
  container=$(auth_container)
  [ -n "$container" ] || fail "the auth container is not running; docker compose up -d auth"
  link=$(docker logs "$container" --tail 200 2>&1 \
    | grep -oE "http://localhost:3001/api/auth/verify-email\?token=[^ ]+" | tail -1)
  [ -n "$link" ] || fail "no verification link in the auth logs for $email"
  curl -sS -o /dev/null "$link"

  curl -sS -X POST "$AUTH/api/auth/sign-in/email" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" -c "$TMP/$slug.cookies" >/dev/null
}

# The bearer the BACKEND wants, which is not the session cookie: /api/auth/token mints a JWT the
# backend verifies against the auth service's JWKS. See frontend/lib/session-token.ts.
token_for() {
  curl -sS "$AUTH/api/auth/token" -b "$TMP/$1.cookies" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])'
}

api() {
  local slug=$1 method=$2 path=$3
  shift 3
  curl -sS -X "$method" "$API$path" -H "Authorization: Bearer $(token_for "$slug")" \
    -H 'Content-Type: application/json' "$@"
}

field() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

say "1. two accounts"
sign_up sender "walk-sender-$STAMP@example.com" "walkthrough-pw-1" "Sender"
sign_up member "walk-member-$STAMP@example.com" "walkthrough-pw-2" "Member"
echo "signed in as both"

say "2. both pick a world, and the member starts using their account"
# Every account-wide read narrows by the world and a new account has not been asked yet (V74).
#
# The member is deliberately NOT empty here. Accepting used to require an empty account and refused
# after the button was pressed, which hit exactly the people keen enough to have signed up and added
# a character first. Their own character stays, and the payload's is bound to rather than duplicated.
api sender PUT /api/settings -d '{"worldType":"INTERACTIVE"}' >/dev/null
api member PUT /api/settings -d '{"worldType":"INTERACTIVE"}' >/dev/null
api member POST /api/characters -d "{\"name\":\"WalkTheirOwn$STAMP\"}" >/dev/null
echo "both INTERACTIVE, member already has WalkTheirOwn$STAMP"

MEMBER_CHAR="WalkMember$STAMP"

say "3. the sender adds characters and two parties on the same boss"
SENDER_CHAR=$(api sender POST /api/characters -d "{\"name\":\"WalkSender$STAMP\"}" | field '["id"]')
SENDER_ALT=$(api sender POST /api/characters -d "{\"name\":\"WalkSenderAlt$STAMP\"}" | field '["id"]')
# Two seats for them, one of which the sender has wrong. The member confirms only the real one.
WRONG_CHAR="WalkNotTheirs$STAMP"
# One boss at one difficulty, run on two of the member's characters. That is two configs wearing a
# single label, which is the shape the landing page used to render as the same line twice: only
# whose seat it is tells them apart. Seventeen of these is what the real account looks like.
PARTY=$(api sender POST /api/parties \
  -d "{\"characterId\":\"$SENDER_CHAR\",\"bossKey\":\"kalos-the-guardian\",\"members\":[\"$MEMBER_CHAR\",\"$WRONG_CHAR\"],\"difficulty\":\"CHAOS\"}" \
  | field '["id"]')
api sender POST /api/parties \
  -d "{\"characterId\":\"$SENDER_ALT\",\"bossKey\":\"kalos-the-guardian\",\"members\":[\"WalkTheirOwn$STAMP\"],\"difficulty\":\"CHAOS\"}" \
  >/dev/null
echo "two Chaos Kalos parties: $MEMBER_CHAR in one, WalkTheirOwn$STAMP in the other"

say "4. the sender says whose characters those are"
api sender PUT /api/people -d "{\"people\":[{\"name\":\"Walk Friend\",\"characters\":[\"$MEMBER_CHAR\",\"$WRONG_CHAR\",\"WalkTheirOwn$STAMP\"]}]}" >/dev/null
PERSON=$(api sender GET /api/people | field '[0]["id"]')
echo "Walk Friend holds all three names, one of which the sender has wrong"

say "5. the sender makes a link"
TOKEN=$(api sender POST /api/invites -d "{\"personId\":\"$PERSON\"}" | field '["token"]')
[ -n "$TOKEN" ] && [ "$TOKEN" != "None" ] || fail "no token on the create response"
echo "token minted"

say "6. what the link says before anyone signs in"
# Unauthenticated on purpose: a landing page that demanded an account first would ask people to make
# one to find out whether they want one. No bearer here, deliberately.
curl -sS "$API/api/join/$TOKEN" | head -c 300
echo

say "7. the link names each party by boss AND by seat, then the member confirms two of three"
curl -sS "$API/api/join/$TOKEN" > "$TMP/preview.json"
python3 - "$TMP/preview.json" <<'PY'
import json, sys

p = json.load(open(sys.argv[1]))
print("  offers characters:", ", ".join(p["characters"]))
for q in p["parties"]:
    print(f"  party: {q['difficulty'] or ''} {q['bossName']} ({q['characterName']})".strip())

if len(p["parties"]) != 2:
    raise SystemExit(f"FAILED: expected 2 parties on the link, got {len(p['parties'])}")

# The bit worth having a walkthrough for. Both configs are the same words, so a page that named
# only the boss would print one line twice and read as a bug rather than as two parties.
labels = {(q["bossName"], q["difficulty"]) for q in p["parties"]}
if len(labels) != 1:
    raise SystemExit(f"FAILED: the two parties were meant to share a label, got {labels}")

seats = sorted(q["characterName"] for q in p["parties"])
if len(set(seats)) != 2:
    raise SystemExit(f"FAILED: the seats do not tell the two apart: {seats}")
print("  one label, two seats:", ", ".join(seats))
PY
api member POST "/api/invites/$TOKEN/accept" \
  -d "{\"characters\":[\"$MEMBER_CHAR\",\"WalkTheirOwn$STAMP\"]}" | head -c 200
echo

say "8. the sender logs a drop into the PARTY's pool"
# Into the party, deliberately, through /api/parties/{id}/loot.
#
# The other door, POST /api/parties/loot, is the Drop Log's own form, and it records a SOLO night
# (party_loot.solo, V72): "it fell on a run with nobody else, so it divides by one seat whatever the
# pool's roster says that week". A drop logged that way lands in the party's pool but names only the
# logger as having run, so a member correctly never sees it. Getting that wrong here is what made
# this walkthrough first report "nights I was on: 0" with the data looking perfect.
# The party id came off the create response, not off '[0]' of the list: two configs on one boss
# come back in no order worth relying on, and dropping the grindstone into the wrong one would
# leave the member correctly seeing nothing.
api sender POST "/api/parties/$PARTY/loot" \
  -d '{"dropKey":"grindstone-of-faith","bossKey":"kalos-the-guardian"}' >/dev/null
echo "grindstone into the party pool"

say "9. what the member can now see"
api member GET /api/parties/seated > "$TMP/seated.json"
python3 - "$TMP/seated.json" <<'PY'
import json, sys

seated = json.load(open(sys.argv[1]))
if not seated:
    print("NOTHING: the member sees no shared party")
    raise SystemExit(1)
if len(seated) != 2:
    raise SystemExit(f"FAILED: expected a seat in both configs, got {len(seated)}")
for party in seated:
    print("  boss:", party["bossKey"], party["difficulty"])
    print("  seats:", ", ".join(s["name"] for s in party["seats"]))
    print("  my seats:", party["mySeatIds"])
    print("  nights I was on:", len(party["nights"]))
    mine = [s for s in party["seats"] if s["id"] in party["mySeatIds"]]
    for s in mine:
        print("  bound to my character:", s["linkedCharacterId"] is not None)

# What the Shared with you list files each card under. Two configs on one boss belong under two
# different headings, so a null here or a repeat would collapse them back into one wall.
held = [
    s["linkedCharacterId"]
    for party in seated
    for s in party["seats"]
    if s["id"] in party["mySeatIds"]
]
if None in held:
    raise SystemExit("FAILED: a seat of mine binds no character, so it can be filed under none")
if len(set(held)) != 2:
    raise SystemExit(f"FAILED: both configs came back under one character of mine: {held}")
print("  filed under 2 characters of mine, which is what the grouping reads")

# The seat the sender got wrong is in the first party's roster and must have been left alone.
wrong = [s for party in seated for s in party["seats"] if "WalkNotTheirs" in s["name"]]
if not wrong:
    raise SystemExit("FAILED: the mis-spelled seat vanished; this run proves nothing about it")
if any(s["linkedCharacterId"] for s in wrong):
    raise SystemExit("FAILED: the unticked seat was bound to a character anyway")
print("  the seat the sender got wrong binds nobody")
PY

say "10. and what they must NOT have"
OWN=$(api member GET /api/parties | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
[ "$OWN" = "0" ] || fail "the member owns $OWN parties; accepting should copy none (membership is a seat)"
echo "0 parties of their own, which is the point of V75"

CHARS=$(api member GET /api/characters | python3 -c 'import json,sys; print(",".join(sorted(c["name"] for c in json.load(sys.stdin))))')
case "$CHARS" in
  *WalkTheirOwn*) echo "kept the character they had before accepting: $CHARS" ;;
  *) fail "the member lost their own character: $CHARS" ;;
esac
case "$CHARS" in
  *WalkNotTheirs*) fail "took a character the member never confirmed: $CHARS" ;;
  *) echo "did not take the one they left unticked" ;;
esac

say "done"
