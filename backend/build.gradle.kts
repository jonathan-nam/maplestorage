// Dependency versions current as of scaffolding (2026-07) -- double-check for
// newer patch releases once the dev container is up and a real build is possible.
val ktorVersion = "3.5.0"
val exposedVersion = "1.0.0"
val flywayVersion = "12.3.0"
val postgresDriverVersion = "42.7.4"
val kotlinxSerializationVersion = "1.8.0"
val logbackVersion = "1.5.12"
val hikariVersion = "6.2.1"
val anthropicVersion = "2.48.0"

plugins {
    kotlin("jvm") version "2.4.0"
    kotlin("plugin.serialization") version "2.4.0"
    id("io.ktor.plugin") version "3.5.0"
    id("org.jlleitschuh.gradle.ktlint") version "12.1.2"
    id("io.gitlab.arturbosch.detekt") version "1.23.7"
}

group = "com.maplestorage"
version = "0.1.0"

application {
    mainClass.set("com.maplestorage.backend.ApplicationKt")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("io.ktor:ktor-server-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-serialization-kotlinx-json:$ktorVersion")
    implementation("io.ktor:ktor-server-auth:$ktorVersion")
    implementation("io.ktor:ktor-server-auth-jwt:$ktorVersion")
    implementation("com.auth0:jwks-rsa:0.22.1") // JWKS fetch/cache for verifying Clerk-issued JWTs
    implementation("io.ktor:ktor-server-call-logging:$ktorVersion")
    implementation("io.ktor:ktor-server-status-pages:$ktorVersion")
    implementation("io.ktor:ktor-server-cors:$ktorVersion")
    implementation("io.ktor:ktor-client-core:$ktorVersion")
    implementation("io.ktor:ktor-client-cio:$ktorVersion")
    implementation("io.ktor:ktor-client-content-negotiation:$ktorVersion")

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:$kotlinxSerializationVersion")

    implementation("org.jetbrains.exposed:exposed-core:$exposedVersion")
    implementation("org.jetbrains.exposed:exposed-jdbc:$exposedVersion")
    implementation("org.jetbrains.exposed:exposed-kotlin-datetime:$exposedVersion")
    implementation("org.jetbrains.exposed:exposed-json:$exposedVersion")
    implementation("org.postgresql:postgresql:$postgresDriverVersion")
    implementation("com.zaxxer:HikariCP:$hikariVersion")

    implementation("org.flywaydb:flyway-core:$flywayVersion")
    implementation("org.flywaydb:flyway-database-postgresql:$flywayVersion")

    // Official Anthropic SDK -- structured outputs via outputConfig(Class),
    // not hand-rolled HTTP or forced tool-use.
    implementation("com.anthropic:anthropic-java:$anthropicVersion")

    implementation("ch.qos.logback:logback-classic:$logbackVersion")

    detektPlugins("io.gitlab.arturbosch.detekt:detekt-formatting:1.23.7")

    testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
    testImplementation("io.ktor:ktor-client-mock:$ktorVersion")
    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(21)
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(files("$rootDir/detekt.yml"))
}

ktlint {
    version.set("1.3.1")
}

tasks.test {
    useJUnitPlatform()
}
