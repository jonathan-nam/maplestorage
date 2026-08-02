#!/usr/bin/env bash
set -euo pipefail

# Debian 12+ marks the system Python "externally managed" (PEP 668), so a plain
# `pip install --user` now exits non-zero. Under `set -e` that killed this whole
# script at line 4 -- silently, since post-create output is easy to miss. The
# fallout was invisible and slow to diagnose: pre-commit never installed (so the
# repo's lint gates never ran locally) and, worse, the JDK fix further down never
# ran either, leaving Gradle broken for everyone. Nothing here is a system
# Python that matters; --break-system-packages is the right call in a container.
pip install --user --break-system-packages pre-commit
pre-commit install

# ruff backs the vision pre-commit hook, so it has to exist before anyone commits
# Python -- otherwise the hook fails on a fresh container with a confusing
# "ruff: command not found" rather than a lint error. pytest and httpx come along
# because vision/README.md tells you to run the tests and, until now, never
# installed anything you needed to.
pip install --user --break-system-packages -r vision/requirements-dev.txt

# The HUD is read with Tesseract, and the vision tests shell out to it. vision/Dockerfile
# installs it for the deployed image, but running `pytest tests/` in the container needs it
# here too -- without it 17 tests die with a Popen error that says nothing about OCR.
sudo apt-get update -qq && sudo apt-get install -y -qq tesseract-ocr

# tflint needs its AWS ruleset downloaded before it can lint anything. Without this
# the pre-commit hook fails on a fresh container with "Plugin aws not found" -- which
# reads like a broken hook rather than a missing one-time setup step.
(cd infra && tflint --init >/dev/null) || echo "tflint --init failed; run it by hand in infra/"

# The claude-code feature installs as root at image-build time, so npm's global
# @anthropic-ai/ dir ends up root-owned. npm updates a package by renaming that
# dir, so `claude update` fails with EACCES for the (non-root) remote user.
claude_pkg="$(npm -g config get prefix)/lib/node_modules/@anthropic-ai"
if [ -d "$claude_pkg" ]; then
  sudo chown -R "$(id -u):$(id -g)" "$claude_pkg"
fi

# Gradle 8.12 cannot run on JDK 25. It does not say so: ./gradlew dies with a bare
# "25.0.3" and no explanation, which is a genuinely baffling thing to meet on a fresh
# container. The JDK 25 came from the gradle-sdkman feature, which set itself as SDKMAN's
# default; that feature is now gone from devcontainer.json (it only ever existed to
# generate gradle-wrapper.jar, which has been committed since), so 25 is never installed.
#
# This block used to *repair* that by pinning the default back to 21 -- which worked only
# when post-create ran to completion, turning a permanent problem into an intermittent one.
# Verifying is better than repairing: if a future feature drags in the wrong JDK, say so
# here, loudly, rather than let ./gradlew fail with a version number three days later.
if command -v java >/dev/null 2>&1; then
  jdk="$(java -version 2>&1 | head -1 | sed -E 's/.*"([0-9]+).*/\1/')"
  if [ "$jdk" = "21" ]; then
    echo "JDK $jdk -- Gradle is happy."
  else
    cat <<WARN

  ============================================================================
  WARNING: JDK $jdk is on the PATH. Gradle 8.12 needs JDK 21 and cannot run on
  anything newer -- ./gradlew will die with a bare version number and no reason.

  Something is installing a JDK other than the pinned 21 (the gradle-sdkman
  feature used to; it has been removed). Find it, or pin around it:

      export JAVA_HOME=\$(ls -d /usr/local/sdkman/candidates/java/21.*-tem | tail -1)
  ============================================================================

WARN
  fi
fi

# gradle-wrapper.jar is committed, so ./gradlew is self-contained and needs no Gradle on the
# PATH. If it ever goes missing, regenerate it from a machine that has Gradle -- do not
# reinstall the feature that broke the JDK.
if [ ! -f backend/gradle/wrapper/gradle-wrapper.jar ]; then
  echo "WARNING: backend/gradle/wrapper/gradle-wrapper.jar is missing and cannot be rebuilt here." >&2
fi

# Where the workspace actually lives decides whether this environment works properly, so
# say so out loud rather than letting the next person rediscover it over several hours.
#
# On 9p (the Windows drive, reached from WSL2) inotify does not exist. File watching is not
# broken, it is impossible: the Next dev server never sees an edit and silently serves stale
# code, so you change something, reload, and nothing happens. Polling does not save you --
# WATCHPACK_POLLING, CHOKIDAR_USEPOLLING and TURBOPACK_FORCE_POLLING were each tried and
# each failed. The same mount is also ~18x slower for small writes (577ms vs 31ms for 300
# files), which is most of the waiting in a working session.
fs="$(stat -f -c %T /workspaces/maplestorage 2>/dev/null || echo unknown)"
if [ "$fs" = "v9fs" ] || [ "$fs" = "9p" ]; then
  cat <<'WARN'

  ============================================================================
  WARNING: this workspace is on the Windows drive (9p), not the Linux filesystem.

    * Hot reload CANNOT work. inotify does not exist on 9p. The dev server will
      serve stale code and say nothing. After every frontend edit you must kill
      it, rm -rf .next, restart, and hard-refresh the browser.

    * Everything is ~18x slower: npm, Gradle, pytest, git.

  Fix it once, from a WSL terminal on Windows:

      bash scripts/move-to-wsl.sh

  See .devcontainer/README.md.
  ============================================================================

WARN
else
  echo "Workspace filesystem: $fs -- file watching works."
fi

echo "Dev container ready. Next: cd infra && terraform init | cd backend && ./gradlew build | cd frontend && pnpm install"
