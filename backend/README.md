# backend

Ktor + Exposed + Flyway, running against Postgres.

## Local dev

```bash
# 1. Start a local Postgres (data persists in a named volume across restarts)
docker compose -f docker-compose.yml up -d

# 2. Copy the env template and adjust CLERK_JWKS_URL for your own Clerk dev instance
cp .env.example .env

# 3. Export the vars into your shell, then run/test/build as usual --
#    this covers ./gradlew run, ./gradlew test, a directly-run fat jar, and
#    IDE debug launches uniformly, unlike a Gradle-only or direnv-only loader.
set -a && source .env && set +a

./gradlew run
```

On boot, `configureDatabase()` runs Flyway migrations automatically (`src/main/resources/db/migration/`) before the app starts serving requests -- no separate migrate step needed.

Tear down the local Postgres (keeping the data volume) with `docker compose -f docker-compose.yml down`, or wipe it entirely with `docker compose -f docker-compose.yml down -v`.

## Tests

`./gradlew test` expects the same `DB_*` env vars as above to be exported (a real Postgres, not a mock) -- start the compose Postgres first.
