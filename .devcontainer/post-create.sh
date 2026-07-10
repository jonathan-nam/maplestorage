#!/usr/bin/env bash
set -euo pipefail

pip install --user pre-commit
pre-commit install

# devcontainer.json pins the java feature to 21, but the gradle-sdkman
# feature installs its own JDK (25) afterward and sets it as SDKMAN's
# default, silently overriding that -- and Gradle 8.12's embedded Kotlin DSL
# compiler can't even parse "25.0.3" as a version string (crashes with
# IllegalArgumentException on any ./gradlew invocation run outside Docker,
# where the Dockerfile's own JDK 21 base image masks the issue). Force it
# back explicitly rather than relying on feature install order.
source "/usr/local/sdkman/bin/sdkman-init.sh"
sdk default java 21.0.11-tem

# Gradle wrapper jar is a binary the scaffolding couldn't generate by hand --
# bootstrap it once here using the gradle-sdkman feature's CLI. After this,
# ./gradlew is self-contained and the gradle-sdkman feature is no longer needed.
if [ ! -f backend/gradle/wrapper/gradle-wrapper.jar ]; then
  (cd backend && gradle wrapper --gradle-version 8.12)
fi

echo "Dev container ready. Next: cd infra && terraform init | cd backend && ./gradlew build | cd frontend && npm install"
