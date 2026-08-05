# syntax=docker/dockerfile:1

# Application image. Multi-stage: dependencies → standalone build → runtime.
#
# Targets:
#   runner   (default) the Next.js standalone server — `node server.js`
#   migrate            one-shot `drizzle-kit migrate` against DATABASE_URL
#
# Build:
#   docker build -t civic-app:dev .
#   docker build -t civic-app-migrate:dev --target migrate .
#
# Configuration is RUN-time only (see .dockerignore): no environment file
# ever enters the build context.

ARG NODE_IMAGE=node:22-bookworm-slim
# Static docker CLI, copied into the runtime layer for EXECUTOR_DRIVER=container.
ARG DOCKER_CLI_IMAGE=docker:29-cli

# --- dependencies ----------------------------------------------------------
# package.json engines require Node >=22; the base image pins the major.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build:standalone` = BUILD_STANDALONE=1 next build (which flips
# next.config.ts to `output: 'standalone'`) followed by the runtime-read
# asset check. The check is part of the build command on purpose: standalone
# file tracing can drop node:fs-read files silently, and a successful build
# that ships without them fails only later, in front of a user.
RUN npm run build:standalone

# --- migrate ---------------------------------------------------------------
# The builder stage already carries drizzle-kit (a devDependency), the
# drizzle/ migration folder, and drizzle.config.ts, so the migrator is that
# stage with a different command. One-shot: applies pending migrations
# against DATABASE_URL and exits.
FROM builder AS migrate
CMD ["npx", "drizzle-kit", "migrate"]

# --- runtime ---------------------------------------------------------------
FROM ${DOCKER_CLI_IMAGE} AS docker-cli

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# EXECUTOR_DRIVER=container shells out to `docker` (src/lib/sandbox/
# container.ts). The CLI is inert on its own — it needs a daemon socket,
# which the deployment decides to hand over or withhold. See the header of
# docker-compose.yml for what handing it over costs.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

# Standalone output carries its own traced node_modules and server.js.
# `public/` and `.next/static` are copied explicitly per the Next.js
# standalone contract (they are served from disk, not traced).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# ISR revalidation writes here at runtime.
RUN mkdir -p .next/cache && chown -R node:node .next

# sharp powers the image optimizer, which `images.remotePatterns` in
# next.config.ts puts on the serving path. It arrives as a dependency of
# next (not a direct one) and is carried in by standalone tracing — a chain
# with two links that could break independently. Resolving AND running it
# here turns a silent runtime degradation into a failed image build.
RUN node -e "const s=require('sharp'); s({create:{width:8,height:8,channels:3,background:'#000'}}).png().toBuffer().then(b=>{if(!b.length)throw new Error('empty encode');console.log('sharp',s.versions.sharp,'libvips',s.versions.vips,'ok',b.length,'bytes')})"

# Unprivileged by default. A deployment that mounts the docker socket must
# override this (compose does, with the security note that goes with it).
USER node
EXPOSE 3000
CMD ["node", "server.js"]
