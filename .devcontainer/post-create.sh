#!/usr/bin/env bash
set -euo pipefail

pip install --user pre-commit
pre-commit install

# Gradle wrapper jar is a binary the scaffolding couldn't generate by hand --
# bootstrap it once here using the gradle-sdkman feature's CLI. After this,
# ./gradlew is self-contained and the gradle-sdkman feature is no longer needed.
if [ ! -f backend/gradle/wrapper/gradle-wrapper.jar ]; then
  (cd backend && gradle wrapper --gradle-version 8.12)
fi

echo "Dev container ready. Next: cd infra && terraform init | cd backend && ./gradlew build | cd frontend && npm install"
