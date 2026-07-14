#!/usr/bin/env bash
#
# Nightly pg_dump to S3. Runs from cron on the box (see docs/deploy.md).
#
# The database is a container on a single box, so this bucket and the daily Lightsail snapshot are
# the whole durability story. The failure this script is written against is not "the dump errors",
# it is "the dump silently succeeds and is empty", and three months later that is the only copy you
# have. So it refuses to upload something implausibly small, and it verifies the object landed.
#
# An untested backup is a file you believe is a backup. Rehearse the restore (docs/deploy.md).
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source .env
: "${BACKUP_BUCKET:?set it in .env}"
: "${DB_USERNAME:?}"
: "${DB_NAME:=maplestorage}"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

# UTC, sortable, and it never collides: two dumps in the same second would be the same dump.
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="/tmp/maplestorage-${stamp}.sql.gz"

trap 'rm -f "$dump"' EXIT

"${COMPOSE[@]}" exec -T postgres pg_dump -U "$DB_USERNAME" "$DB_NAME" | gzip >"$dump"

# A gzipped dump of even an empty schema is comfortably over 1 KB. Anything under that means
# pg_dump wrote nothing and the pipe swallowed the error, which is exactly the silent failure this
# guard exists for. Better to page than to overwrite a good backup with an empty one.
size=$(stat -c %s "$dump")
if [ "$size" -lt 1024 ]; then
  echo "dump is only ${size} bytes. Refusing to upload it." >&2
  exit 1
fi

# `cp` checksums the object against what S3 stored and fails if they disagree, so a zero exit here
# means the bytes arrived intact. It is NOT re-read afterwards to confirm: this box's credentials
# are PutObject-only, on purpose, so it cannot read or delete the backups it writes. Verifying the
# backups is a job for a machine that is allowed to read them, which is the restore rehearsal in
# docs/deploy.md, done from your laptop.
aws s3 cp "$dump" "s3://${BACKUP_BUCKET}/$(basename "$dump")"

echo "backed up $(basename "$dump") (${size} bytes)"
