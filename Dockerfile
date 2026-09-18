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
# Configuration is RUN-time wherever it can be: no environment file ever
# enters the build context (see .dockerignore). The exception is the set of
# values Next.js reads at build and inlines — those arrive as named build
# args, declared on the builder stage below and nowhere else.

ARG NODE_IMAGE=node:22-bookworm-slim
# Static docker CLI, copied into the runtime layer for EXECUTOR_DRIVER=container.
ARG DOCKER_CLI_IMAGE=docker:29-cli
# WHICH RUNTIME BASE `runner` IS BUILT FROM, and with it whether this image
# carries the docker CLI at all (#444). Two values, both stages declared below:
#
#   runtime-with-docker-cli     (default) the reference image, unchanged
#   runtime-without-docker-cli  no docker binary in any layer, and the
#                               docker-cli stage stays outside the build
#                               graph — nothing pulls DOCKER_CLI_IMAGE
#
#   docker build --build-arg RUNTIME_BASE=runtime-without-docker-cli .
#
# The binary has exactly one reader, EXECUTOR_DRIVER=container
# (src/lib/sandbox/container.ts), which needs a daemon socket the deployment
# has to hand over. On a platform that offers no socket the binary is dead
# weight and one more thing an image scanner flags, so the off value is the
# one to build there. docs/deploy.md says which executor settings need it.
#
# This is a global ARG on purpose: it is consumed by a FROM, and only an ARG
# ahead of the first FROM is in scope there. It is NOT a compose `build.args`
# entry — nothing the app reads is configured by it, and the coverage guard in
# scripts/check-compose-env.mjs would then require a matching ARG inside the
# stage that runs `next build`, which is not where a FROM reads it.
ARG RUNTIME_BASE=runtime-with-docker-cli

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

# BUILD-TIME CONFIGURATION. Two kinds, and neither can be supplied at run
# time — hence args rather than container environment:
#
#   NEXT_PUBLIC_*    inlined into the emitted bundles by Next.js. A run-time
#                    value cannot change them; there is nothing left to read.
#   read at both     read on the server, but ALSO baked into statically
#   times            prerendered pages: the branding set and the footer's
#                    repo and sponsor lines, the default portal, the content
#                    sources, and the indexing posture. docker-compose.yml
#                    passes these in both places so prerendered and dynamic
#                    pages agree.
#
# Docker hands a build argument only to a stage that declares it, and says
# nothing when none does: a name in docker-compose.yml's `build.args` with no
# ARG below never reaches `next build`. scripts/check-compose-env.mjs fails on
# exactly that, and on a build-time variable in its inventory with no ARG
# here (#434: six had none).
#
# An ARG left unpassed stays unset, so an operator who configures none of
# them builds exactly the image this file built before they existed. Nothing
# secret may be added here: build args are readable in image history.
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ARG NEXT_PUBLIC_CAPTURE_TRACES
ARG SITE_BRAND_NAME
ARG SITE_BRAND_ACCENT
ARG SITE_BRAND_TAGLINE
ARG SITE_BRAND_ATTRIBUTION
ARG SITE_BRAND_REPO_URL
ARG SITE_SPONSOR_NAME
ARG SITE_SPONSOR_URL
ARG SITE_SPONSOR_PREFIX
ARG SITE_DEFAULT_PORTAL
ARG DIRECTORY_DATA_URL
ARG ROADMAP_RAW_URL
ARG ROADMAP_GITHUB_URL
ARG SITE_NOINDEX

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
# TWO RUNTIME BASES, and RUNTIME_BASE above picks which one `runner` is built
# FROM. They differ by one instruction — the docker CLI — and everything the
# two share lives in the first, so that AT THE DEFAULT the instruction
# sequence `runner` inherits is exactly the sequence this file produced before
# the switch existed: WORKDIR, ENV, then the CLI. Same instructions in the
# same order means the same layers in the same order.
FROM ${NODE_IMAGE} AS runtime-without-docker-cli
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

FROM ${DOCKER_CLI_IMAGE} AS docker-cli

# EXECUTOR_DRIVER=container shells out to `docker` (src/lib/sandbox/
# container.ts). The CLI is inert on its own — it needs a daemon socket,
# which the deployment decides to hand over or withhold. See the header of
# docker-compose.yml for what handing it over costs.
FROM runtime-without-docker-cli AS runtime-with-docker-cli
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

# The runtime stage proper. Its base is the variable; everything below it is
# not. `COPY --from=builder` here is load-bearing beyond the copy itself:
# scripts/check-compose-env.mjs walks the stages the compose target needs and
# fails if none of them runs `next build`. `FROM ${RUNTIME_BASE}` resolves to
# no declared stage for that walk, so this COPY is the edge that keeps the
# builder stage — and the build-argument coverage check over it — reachable.
FROM ${RUNTIME_BASE} AS runner

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
