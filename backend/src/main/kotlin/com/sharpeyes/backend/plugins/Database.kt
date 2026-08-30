package com.sharpeyes.backend.plugins

import com.sharpeyes.backend.config.Env
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopped
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database

// Postgres is a container sharing a 2 GB box with nginx, the auth service and two backend
// replicas, and each replica holds its own pool. Keep it small rather than taking Hikari's
// default of 10 twice over.
private const val MAX_POOL_SIZE = 5

fun Application.configureDatabase() {
    val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"

    // Runs on every boot. Safe no-op when there's nothing new to apply.
    Flyway
        .configure()
        .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
        .load()
        .migrate()

    val hikariConfig =
        HikariConfig().apply {
            this.jdbcUrl = jdbcUrl
            username = Env.dbUsername
            password = Env.dbPassword
            driverClassName = "org.postgresql.Driver"
            maximumPoolSize = MAX_POOL_SIZE
            poolName = "sharpeyes-hikari"
        }
    val dataSource = HikariDataSource(hikariConfig)
    monitor.subscribe(ApplicationStopped) { dataSource.close() }

    Database.connect(datasource = dataSource)
}
