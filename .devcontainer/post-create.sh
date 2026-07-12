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

# devcontainer.json pins the java feature to 21, but the gradle-sdkman
# feature installs its own JDK (25) afterward and sets it as SDKMAN's
# default, silently overriding that -- and Gradle 8.12's embedded Kotlin DSL
# compiler can't even parse "25.0.3" as a version string (crashes with
# IllegalArgumentException on any ./gradlew invocation run outside Docker,
# where the Dockerfile's own JDK 21 base image masks the issue). Force it
# back explicitly rather than relying on feature install order.
# SDKMAN's own scripts read several variables without defaults ($ZSH_VERSION,
# $sdkman_debug_mode), which trips `set -u` -- both in sdkman-init.sh and inside
# the `sdk` function itself. So nounset stays off for this whole block. Without
# it the script aborted before `sdk` ever ran, and the JDK fix below silently
# never happened even once the pip failure above was fixed.
set +u
source "/usr/local/sdkman/bin/sdkman-init.sh"

# Resolve the installed 21.x rather than pinning the patch version -- the java
# feature bumps it, and a stale pin here fails the same silent way.
jdk21="$(basename "$(ls -d /usr/local/sdkman/candidates/java/21.*-tem | sort -V | tail -1)")"
sdk default java "$jdk21"
set -u

echo "JDK set to $jdk21 (Gradle cannot run on the JDK 25 that gradle-sdkman installs)"

# Gradle wrapper jar is a binary the scaffolding couldn't generate by hand --
# bootstrap it once here using the gradle-sdkman feature's CLI. After this,
# ./gradlew is self-contained and the gradle-sdkman feature is no longer needed.
if [ ! -f backend/gradle/wrapper/gradle-wrapper.jar ]; then
  (cd backend && gradle wrapper --gradle-version 8.12)
fi

echo "Dev container ready. Next: cd infra && terraform init | cd backend && ./gradlew build | cd frontend && npm install"
