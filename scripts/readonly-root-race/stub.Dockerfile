# The stub image for drive.sh (#508): the application image's shape where the
# CI step reads it — /app/public holds a PNG, /app/.next/cache exists, the
# server runs as `node` on :3000 as PID 1 — and nothing else.
#   docker build -f stub.Dockerfile --build-arg MODE=late --build-arg DELAY_MS=700 .
ARG NODE_IMAGE=node:22-bookworm-slim
ARG DOCKER_CLI_IMAGE=docker:29-cli

FROM ${NODE_IMAGE} AS stub
WORKDIR /app
COPY stub-server.mjs ./
ARG MODE=before
ARG DELAY_MS=0
RUN mkdir -p public .next/cache \
 && node -e "require('fs').writeFileSync('public/stub.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64'))" \
 && printf '#!/bin/sh\nexec node /app/stub-server.mjs %s %s\n' "$MODE" "$DELAY_MS" > start \
 && chmod +x start \
 && chown -R node:node /app
USER node
CMD ["/app/start"]

# Where drive.sh runs the step when the host cannot: bash 5 ($EPOCHREALTIME),
# GNU date and curl, as on the ubuntu runner, plus the docker CLI.
FROM ${DOCKER_CLI_IMAGE} AS docker-cli
FROM ${NODE_IMAGE} AS driver
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends curl ca-certificates >/dev/null \
 && rm -rf /var/lib/apt/lists/*
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
