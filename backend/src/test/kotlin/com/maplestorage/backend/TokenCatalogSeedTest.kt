package com.maplestorage.backend

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.TokenCatalog
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private const val EXPECTED_TOKEN_COUNT = 6

// Exercises the real Flyway + Exposed path against a real Postgres (DB_*
// env vars -- same contract as docker-compose.yml locally and the
// postgres service in backend-verify.yml's CI job), which also serves as
// an implicit "migrations actually apply cleanly" check on every run.
// Automates PLAN.md's "after M1" verification bullet.
class TokenCatalogSeedTest {
    @Test
    fun `token catalog is seeded with all 6 tokens`() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"

        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()

        Database.connect(
            url = jdbcUrl,
            driver = "org.postgresql.Driver",
            user = Env.dbUsername,
            password = Env.dbPassword,
        )

        val rows = transaction { TokenCatalog.selectAll().toList() }

        assertEquals(EXPECTED_TOKEN_COUNT, rows.size)
        rows.forEach { row ->
            assertTrue(
                row[TokenCatalog.iconRefKey] != null,
                "Expected iconRefKey to be set for ${row[TokenCatalog.name]}",
            )
        }
    }
}
