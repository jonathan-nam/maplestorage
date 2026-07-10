package com.maplestorage.backend.plugins

import com.maplestorage.backend.config.Env
import io.ktor.server.application.Application
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database

fun Application.configureDatabase() {
    val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"

    // Runs on every boot -- safe no-op when there's nothing new to apply.
    // The M1 milestone adds the first real migration (TokenCatalog seed);
    // src/main/resources/db/migration is empty until then.
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
}
