#!/usr/bin/env bash
#
# Move everything one account owns onto a different user id.
#
#   ./scripts/reassign-user.sh <old-id> <new-id>
#
# Written for the move off Clerk. The old id was Clerk's; signing in with Discord mints a new one,
# and the account's characters, parties and ledger would otherwise stay attached to an id nobody
# can sign in as. See reassign-user.sql for how, and why it reads the table list from the catalog
# rather than a list somebody has to remember to update.
#
# Prints what each account holds before and after, because "it worked" and "it moved nothing" look
# identical otherwise.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <old-user-id> <new-user-id>" >&2
  echo >&2
  echo "The new id is the one the auth service minted. Find it after signing in once:" >&2
  echo "  docker compose exec -T postgres psql -U maplestorage -d maplestorage \\" >&2
  echo "    -c 'select id, email from \"auth_user\";'" >&2
  exit 1
fi

OLD="$1"
NEW="$2"
cd "$(dirname "$0")/.."

PSQL=(docker compose exec -T postgres psql -U maplestorage -d maplestorage)

counts() {
  "${PSQL[@]}" -qtA -v id="$1" <<'SQL'
SELECT 'characters=' || (SELECT count(*) FROM characters WHERE user_id = :'id')
    || ' parties='   || (SELECT count(*) FROM party      WHERE user_id = :'id')
    || ' people='    || (SELECT count(*) FROM person     WHERE user_id = :'id')
    || ' shots='     || (SELECT count(*) FROM screenshots WHERE user_id = :'id');
SQL
}

echo "before:"
echo "  old $OLD  $(counts "$OLD")"
echo "  new $NEW  $(counts "$NEW")"
echo

"${PSQL[@]}" -v ON_ERROR_STOP=1 -v old_id="$OLD" -v new_id="$NEW" -f - < scripts/reassign-user.sql

echo
echo "after:"
echo "  new $NEW  $(counts "$NEW")"
