FROM maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /app
COPY pom.xml .
RUN mvn dependency:resolve dependency:resolve-plugins -q

COPY src ./src

FROM builder AS runner
ENTRYPOINT ["sh", "-c", "timeout -s TERM -k 30 300 mvn gatling:test -Dgatling.resultsFolder=/opt/gatling/results; exit $?"]
