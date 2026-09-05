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
# emails carry a timestamp. That is not tidiness: accepting an invite requires an EMPTY account (see
# accountIsEmpty), so a reused one fails on the second run and reads like a broken invite.
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

# An account, verified and signed in, its cookie jar left at $TMP/<slug>.cookies.
#
# Verification is not skippable even on dev: sign-in answers EMAIL_NOT_VERIFIED until it is done.
# With no RESEND_API_KEY the link is PRINTED to the auth container's logs rather than sent, so it is
# read back out of them. That is the one step here that looks like a trick and is not.
sign_up() {
  local slug=$1 email=$2 password=$3 name=$4
  curl -sS -X POST "$AUTH/api/auth/sign-up/email" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"name\":\"$name\"}" >/dev/null

  local link
  link=$(docker compose logs auth --tail 200 2>&1 \
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

say "2. the SENDER picks a world"
# Every account-wide read narrows by this and a new account has not been asked yet (V74), so without
# it the sender's own screens are empty and nothing below works.
#
# The member does NOT pick one, and must not add a character either. Accepting requires a completely
# empty account (accountIsEmpty) and brings both across from the payload. Setting either first makes
# the invite refuse with "this account already has characters of its own", which is the design
# refusing to guess whether the WalkMember in the payload is the WalkMember already here.
api sender PUT /api/settings -d '{"worldType":"INTERACTIVE"}' >/dev/null
echo "sender INTERACTIVE, member left empty on purpose"

MEMBER_CHAR="WalkMember$STAMP"

say "3. the sender adds a character and a party seating them"
SENDER_CHAR=$(api sender POST /api/characters -d "{\"name\":\"WalkSender$STAMP\"}" | field '["id"]')
api sender POST /api/parties \
  -d "{\"characterId\":\"$SENDER_CHAR\",\"bossKey\":\"kalos-the-guardian\",\"members\":[\"$MEMBER_CHAR\"],\"difficulty\":\"CHAOS\"}" \
  >/dev/null
echo "Chaos Kalos, seating $MEMBER_CHAR"

say "4. the sender says whose character that is"
api sender PUT /api/people -d "{\"people\":[{\"name\":\"Walk Friend\",\"characters\":[\"$MEMBER_CHAR\"]}]}" >/dev/null
PERSON=$(api sender GET /api/people | field '[0]["id"]')
echo "Walk Friend holds $MEMBER_CHAR"

say "5. the sender makes a link"
TOKEN=$(api sender POST /api/invites -d "{\"personId\":\"$PERSON\"}" | field '["token"]')
[ -n "$TOKEN" ] && [ "$TOKEN" != "None" ] || fail "no token on the create response"
echo "token minted"

say "6. what the link says before anyone signs in"
# Unauthenticated on purpose: a landing page that demanded an account first would ask people to make
# one to find out whether they want one. No bearer here, deliberately.
curl -sS "$API/api/join/$TOKEN" | head -c 300
echo

say "7. the member accepts"
api member POST "/api/invites/$TOKEN/accept" | head -c 300
echo

say "8. the sender logs a drop into the PARTY's pool"
# Into the party, deliberately, through /api/parties/{id}/loot.
#
# The other door, POST /api/parties/loot, is the Drop Log's own form, and it records a SOLO night
# (party_loot.solo, V72): "it fell on a run with nobody else, so it divides by one seat whatever the
# pool's roster says that week". A drop logged that way lands in the party's pool but names only the
# logger as having run, so a member correctly never sees it. Getting that wrong here is what made
# this walkthrough first report "nights I was on: 0" with the data looking perfect.
PARTY=$(api sender GET /api/parties | field '[0]["id"]')
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
for party in seated:
    print("  boss:", party["bossKey"], party["difficulty"])
    print("  seats:", ", ".join(s["name"] for s in party["seats"]))
    print("  my seats:", party["mySeatIds"])
    print("  nights I was on:", len(party["nights"]))
    mine = [s for s in party["seats"] if s["id"] in party["mySeatIds"]]
    for s in mine:
        print("  bound to my character:", s["linkedCharacterId"] is not None)
PY

say "10. and what they must NOT have"
OWN=$(api member GET /api/parties | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
[ "$OWN" = "0" ] || fail "the member owns $OWN parties; accepting should copy none (membership is a seat)"
echo "0 parties of their own, which is the point of V75"

say "done"
