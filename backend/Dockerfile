# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app

COPY gradlew gradlew.bat build.gradle.kts settings.gradle.kts gradle.properties detekt.yml ./
COPY gradle ./gradle
RUN chmod +x gradlew && ./gradlew --version

COPY src ./src
RUN ./gradlew buildFatJar --no-daemon

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
RUN useradd --system --create-home appuser
COPY --from=build /app/build/libs/*-all.jar app.jar
USER appuser

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
