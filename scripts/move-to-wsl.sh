#!/usr/bin/env bash
# Move this repo off the Windows drive and onto the WSL2 Linux filesystem.
#
# RUN THIS FROM A WSL TERMINAL ON WINDOWS -- not from inside the dev container.
#
#     find /mnt/c/Users -maxdepth 5 -type d -name maplestorage 2>/dev/null   # find it
#     bash /mnt/c/.../maplestorage/scripts/move-to-wsl.sh
#
# Why:
#
#   The repo currently lives on the Windows C: drive, which WSL reaches over 9p
#   (`stat -f -c %T` reports v9fs). Two things follow, and both have cost real hours:
#
#     * 9p does not support inotify, so file watching CANNOT work. The Next dev server
#       never sees an edit and silently serves stale code -- "the UI looks the same"
#       three times over. Polling does not rescue it: WATCHPACK_POLLING,
#       CHOKIDAR_USEPOLLING and TURBOPACK_FORCE_POLLING were all tried and all failed.
#
#     * 9p is ~18x slower for small writes than the Linux filesystem (measured: 577ms
#       vs 31ms for 300 files). That tax lands on npm, Gradle, pytest and git.
#
#   Moving to ext4 fixes both. It is the standard WSL2 recommendation and it is the
#   single highest-leverage change available to this dev environment.
#
# This copies rather than clones, so uncommitted work, .env files and your branch state
# all come with it. It does NOT delete the original -- verify the new one first.

set -euo pipefail

if [[ -f /.dockerenv ]]; then
    echo "This must run from WSL on Windows, not from inside the dev container." >&2
    echo "The whole point is to reach the Linux filesystem the container cannot see." >&2
    exit 1
fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$HOME/projects/maplestorage}"

if [[ "$SRC" != /mnt/* ]]; then
    echo "Source is already on the Linux filesystem ($SRC) -- nothing to do." >&2
    exit 0
fi

echo "  from: $SRC   ($(stat -f -c %T "$SRC"))"
echo "  to:   $DEST"
echo

if [[ -e "$DEST" ]]; then
    echo "$DEST already exists. Move or delete it first." >&2
    exit 1
fi
mkdir -p "$(dirname "$DEST")"

# Everything except what is rebuilt anyway. node_modules over 9p would take an age and
# be wrong for the new platform regardless.
echo "Copying (this reads from the slow filesystem once, and never again)..."
rsync -a --info=progress2 \
    --exclude 'node_modules/' \
    --exclude '.next/' \
    --exclude '.next-prod/' \
    --exclude 'build/' \
    --exclude '.gradle/' \
    --exclude '__pycache__/' \
    --exclude '.terraform/' \
    "$SRC/" "$DEST/"

echo
echo "  copied.  $(stat -f -c %T "$DEST")  <- ext4 means inotify works and the I/O tax is gone"
echo

# The gitignored files that matter are the reason this copies instead of cloning.
for f in backend/.env frontend/.env.local infra/backend.hcl .vscode/settings.json; do
    if [[ -f "$DEST/$f" ]]; then
        echo "  carried over: $f"
    elif [[ -f "$SRC/$f" ]]; then
        echo "  !! MISSING:   $f  -- copy it by hand" >&2
    fi
done

cat <<EOF

Next:

  1.  cd "$DEST" && code .
  2.  VS Code: "Reopen in Container".
  3.  Inside the new container, confirm the fix:

          stat -f -c %T /workspaces/maplestorage      # want ext4/overlay, NOT v9fs

      Then hot reload works and you can stop hard-refreshing.

  4.  The container's own home is not carried over, so once:

          aws configure          # ~/.aws
          gh auth login          # ~/.config/gh

  5.  Once you are happy, delete the old copy on the Windows drive:

          rm -rf "$SRC"

      Leave it until then -- two copies of a repo is a good way to commit to the wrong one.
EOF
