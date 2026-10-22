# Self-hosted deployment guide

This guide takes an operator with infrastructure of their own from
`git clone` to a running, correctly configured instance of this
application: the app, a Postgres database, S3-compatible object storage,
a notebook executor, and a scheduler sidecar. The primary path is
`docker compose` — the configuration in this repository's
[`docker-compose.yml`](../docker-compose.yml), which has been exercised
end to end. A [managed-platform deployment](#managed-platform-deployment)
(Vercel-style) is covered in its own section; it uses the same code with
different drivers.

The guide is ordered the way a first deployment actually proceeds:

1. [Before you start](#before-you-start) — prerequisites, including one
   that is easy to miss.
2. [Quick bring-up: the unsigned tier](#quick-bring-up-the-unsigned-tier)
   — a first instance with no key material at all.
3. [The three driver decisions](#the-three-driver-decisions) — the
   selectors every other variable's necessity follows from.
4. [Environment reference, tier by tier](#environment-reference-tier-by-tier)
   — what is truly required, what disables a feature, what merely
   overrides a default.
5. [Sign-in configuration](#sign-in-configuration) — your own OAuth
   application.
6. [Host topology](#host-topology-optional) — optional: split the
   public face from the gated app surface, or run app-only.
7. [Database and migrations](#database-and-migrations) — including the
   fork/existing-database path.
8. [Instance identity and signing](#instance-identity-and-signing-go-to-production)
   — the go-to-production step (linked, not duplicated).
9. [Object storage: configuration and rehearsal](#object-storage-configuration-and-rehearsal)
10. [Scheduler and background jobs](#scheduler-and-background-jobs)
11. [Managed-platform deployment](#managed-platform-deployment)
12. [Tool names across sources](#tool-names-across-sources) — the naming
    contract a fork follows when it adds a data source.
13. [Vocabulary notes for integrators](#vocabulary-notes-for-integrators)
14. [Appendix A: first-time S3 on a public cloud](#appendix-a-first-time-s3-on-a-public-cloud)

## Before you start

**You are deploying the application.** The marketing pages at
civicaitools.org — the home page, `/about`, `/explore`, `/learn`,
`/project`, `/roadmap`, `/directory`, and the talk decks under `/talks` —
are the reference project's own website. They are not part of an
instance. An instance that configures nothing serves the app surface and
withholds those pages ([Host topology](#host-topology-optional)); the
files stay in your checkout so it remains cleanly `git pull`-able, and
they simply do not serve. Everything that names or funds *this* project
in the shared chrome — brand name, tagline, attribution, source-repo
link, sponsor acknowledgment — is instance configuration with no default,
so an unconfigured instance renders none of it rather than the reference
deployment's ([Branding and theming](#branding-and-theming-chrome-only)).

You need:

- A host with **Docker Engine and Compose v2** (`docker compose`, not the
  legacy `docker-compose`).
- A **model API key**, in `MODEL_API_KEY`. The app speaks two wire
  dialects: the OpenAI-compatible chat-completions API (the default,
  pointed at OpenRouter unless you say otherwise) and a deployment-routed
  one. `MODEL_API_BASE_URL` selects the endpoint and `MODEL_API_KIND`
  selects the dialect; the key stays in `MODEL_API_KEY` either way, and
  `OPENROUTER_API_KEY` is that variable's prior-era name, still read.
  Without a key the app starts and serves pages, but every query
  fails fast with an operator-actionable error (shown
  [below](#the-model-seam)).
- **Node.js ≥ 22** on the host if you want to run the preflight and
  rehearsal scripts from the checkout (recommended; the containers
  themselves don't need it).

**Nothing to arrange for fonts.** The two typefaces are self-hosted from
`src/fonts/` (SIL OFL 1.1, provenance in that directory's README) as of
[#225], so no build path — the compose bring-up's image build below, a
bare `next build`, or the standalone build — reaches Google Fonts. It is
worth stating only because it *was* a prerequisite here: a
restricted-egress build environment needs no allowance for
`fonts.googleapis.com`, and a build failing behind one is not a font
problem. Changing the typefaces still means editing the
`next/font/local` calls in `src/app/layout.tsx`; making them an
instance-configuration knob is tracked in [#221].

> **Sign-in prerequisite — read before bring-up.** The notebook/query
> execution feature (executed-sandbox mode: generate a Jupyter notebook,
> run it against live data, sign the execution record) is enabled only
> for **signed-in users**. Sign-in on your instance requires your own
> OAuth application — a GitHub OAuth app or any standard OIDC provider —
> plus `NEXTAUTH_SECRET` and `NEXTAUTH_URL`. None of that blocks the
> quick bring-up below, but until it is configured your instance's core
> feature is visible and not usable. Full setup is in
> [Sign-in configuration](#sign-in-configuration); plan for it.

No signing key material is needed to start. A first instance runs in the
**unsigned tier** by design, which is where we begin.

## Quick bring-up: the unsigned tier

The compose file wires the whole self-hosted profile: the app
(`DB_DRIVER=node-postgres`, `BLOB_DRIVER=s3`, `EXECUTOR_DRIVER=container`),
Postgres 17, MinIO with a one-shot bucket-init, a one-shot migration
runner, and a scheduler sidecar. Every value baked into the file is a
neutral local-development placeholder; your own values arrive by
environment file later.

```bash
git clone https://github.com/npstorey/civic-ai-tools-website.git
cd civic-ai-tools-website

# Build the notebook-executor image once (and again after any pinned-
# version change). The app's container driver runs notebooks in it.
# A cold build spends several minutes in pip installs with little
# visible progress — that is normal, not a hang.
docker compose --profile build-only build executor-image

# Bring the stack up. This runs in the foreground; add -d to detach,
# or keep a second terminal for the verification commands below.
docker compose up --build
```

First bring-up builds the app image (a full Next.js standalone build)
and pulls the service images; expect several minutes. When it settles:
`postgres` and `minio` are healthy, `minio-init` and `migrate` have run
once and exited `0`, `app` reports healthy, and `gc-cron` is looping.
The app listens on `http://127.0.0.1:3000`, **bound to loopback
deliberately** (see the security note below). The compose file publishes
the port on the IPv4 loopback address specifically, so commands in this
guide use `127.0.0.1` throughout; a browser's `localhost` normally
reaches it too.

What you will see, and why it is correct:

- A **"Running unsigned" banner** on every page: *"Running unsigned — no
  signing key is configured, so record seal and publish are disabled
  and any output produced here carries no cryptographic commitment.
  Signing is the go-to-production step; see the instance setup guide."*
- **Seal and publish actions are gated off**, server-side and
  in the UI. An unsigned package can reach neither the `sealed` nor the
  `public` state ([ADR-0020]) — the unsigned tier is confined to local
  produce-and-inspect. This is the intended first-run state, not a
  failure: analyses run, packages can be produced and inspected, and
  signing is a deliberate later step
  ([Instance identity and signing](#instance-identity-and-signing-go-to-production)).
- Queries fail until you supply a model key and a data-source endpoint
  (next step), with an error that names the missing variable
  (`MODEL_API_KEY` / `SOCRATA_MCP_URL` — neither has a fallback).

Verify the bring-up:

```bash
# Unsigned tier, reported truthfully:
curl -s http://127.0.0.1:3000/api/records/signing-status
# → {"signingConfigured":false,"sealOnly":false}

# Migrations applied — the visibility enum lists four labels
# (published, committed, sealed, public):
docker compose exec postgres psql -U civic -d civic -c '\dT+ visibility'
```

The `psql` commands in this guide use the placeholder `civic` user and
database; substitute your own values wherever you override
`POSTGRES_USER` / `POSTGRES_DB`.

### Health probe

A deployment platform that watches a fixed path for liveness should be
pointed at:

- **Probe path:** `/api/health`
- **Probe port:** `3000`
- **Alternate path:** `/health`

Both paths are the same handler, so they answer identically; use the
alternate where a platform fixes its probe at the root and offers no
setting to move it. Either returns `200` with `{"status":"ok"}`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health
# → 200
```

Two properties to rely on:

- **The port is the container's**, not the published one. The image
  listens on `3000` (`EXPOSE 3000` in the `Dockerfile`); `APP_PORT`
  changes only which host port compose maps onto it, and a platform that
  probes the container directly never sees `APP_PORT`. The healthcheck in
  `docker-compose.yml` probes this same path, and a test fails if the
  path named here and the one in that file disagree.
- **It is liveness, not readiness.** The route reads no database, no
  object store, no model endpoint, no data-source server, and no
  environment variable — it answers `200` on an instance with nothing
  configured at all. So a failure means this process is not serving, and
  never that a dependency is slow. That is deliberate: a liveness probe
  wired to a dependency gets the container killed and restarted for
  someone else's outage. There is no dependency-readiness route; if you
  need one, the tier and driver reporting in the sections below is what
  it would be built from.

### Read-only root filesystem

A platform that mounts every application container's root filesystem
read-only and supplies writable paths as mounts needs exactly one path
from this image:

- **Writable path:** `/app/.next/cache`

Everything else may be read-only. The application writes nothing to its
own container filesystem — notebook files are written into the executor
session, never here — so that one path is the framework's, not the
app's: Next.js keeps its optimised-image cache under
`/app/.next/cache/images` and its incremental-regeneration cache
alongside it. The `Dockerfile` creates the directory and hands it to the
runtime user for exactly this reason.

**The mount must be writable by the runtime user.** The image runs as
`node`, uid 1000 (`USER node`), and a `tmpfs` mount arrives `root`-owned
at mode `0755` by default — writable by nobody else. Give it a mode the
runtime user can write, or the mount is present and useless:

```bash
docker run --read-only --tmpfs /app/.next/cache:rw,mode=1777 civic-app:dev
```

`docker-compose.yml` demonstrates the same shape on the `app` service —
`read_only: true` plus one `tmpfs` mount at that path — and
`scripts/image-variant-and-readonly-root.test.mjs` reads this path back
out of this document and compares it with the compose mount, so the two
cannot drift apart.

**What withholding the mount costs, measured on the built image.** It
degrades; it does not break. With the root read-only and no mount at
all, the container starts, `/api/health` answers `200`, and every page
renders. An optimised-image request (`/_next/image`) also still answers
`200`: the optimiser encodes the image and serves it, and only then
fails to store it. What you get instead is one
`Failed to write image to cache … mkdir '/app/.next/cache/images'` and
one unhandled rejection in the container log **per image request**, and
every request re-encodes from scratch — a permanent cache miss on the
serving path. With the mount, the same requests log nothing and the
cache fills. CI runs the built image both ways on every pull request, so
the paragraph above is a measurement rather than a claim.

Nothing else in the image was observed writing: with that one mount in
place, a read-only container serving the health route, the marketing
pages and image requests logs no filesystem write failure at all. If
your deployment finds a second path, it is a finding worth filing — this
document names one because one is what the measurement found.

### Supplying your environment

Put your values in one file of `KEY=value` lines and hand it to compose;
that single file feeds both the running container and the image build.
No environment file enters the build *context* — the build reads only
the named arguments listed in the compose file's `build.args`.

A minimal first environment file (placeholders — substitute your own,
and never commit this file):

```bash
# Model access — required for every query. `OPENROUTER_API_KEY` is this
# variable's prior-era name and still works; set one, not both.
MODEL_API_KEY=<your-model-api-key>

# Primary data source — required for every data query; no fallback. Set
# it to the Socrata MCP deployment this instance should query. Pointing
# it at another operator's endpoint means your users' queries route
# through that host's infrastructure, not yours.
SOCRATA_MCP_URL=<your-socrata-mcp-endpoint>

# Rate limiting — required for every query; no fallback. The per-day
# request counter is stored under keys derived from this secret and the
# date, so no stored key carries a reader's address or account id.
RATE_LIMIT_SECRET=<generated: openssl rand -base64 32>

# Real credentials replacing the compose file's placeholders. The S3
# pair is both the app's access key AND MinIO's root user/password —
# docker-compose.yml wires one to the other — so leaving them unset
# runs your object store on values published in this repository.
POSTGRES_PASSWORD=<generated>
S3_ACCESS_KEY_ID=<generated>
S3_SECRET_ACCESS_KEY=<generated>

# Sign-in (see the sign-in section; enables notebook execution).
# NEXTAUTH_URL is the origin your browser actually uses, not the one you
# intend to have. On the loopback bring-up above that is
# http://localhost:3000; change it to your public origin when the
# instance is reachable there, and register your OAuth app's callback
# against whichever origin is current.
NEXTAUTH_SECRET=<generated: openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
GITHUB_CLIENT_ID=<your OAuth app>
GITHUB_CLIENT_SECRET=<your OAuth app>
```

While you are on the loopback bring-up, browse to the same spelling
`NEXTAUTH_URL` carries — `http://localhost:3000`, not
`http://127.0.0.1:3000`. Both reach this server, but they are different
origins to a browser and the sign-in round-trip is built from the one in
the variable. Setting `NEXTAUTH_URL` to a public origin you have not
stood up yet is the trap this ordering avoids: the instance comes up
perfectly healthy and advertises callback URLs nothing can reach, with
nothing warning you (see [Sign-in
configuration](#sign-in-configuration) for the one-command check).

**How a value reaches the app.** Every variable in this guide is spelled
one of three ways in `docker-compose.yml`, and the spelling tells you
what your env file can do with it:

| Spelling | What it means | Examples |
| --- | --- | --- |
| bare `NAME:` | Pass-through. Set in the container only when your environment has it, **absent otherwise** — which matters, because for several variables absence is the configured state, not a missing value. | the model-endpoint set (`MODEL_API_KEY` and its prior-era `OPENROUTER_API_KEY`, `MODEL_API_KIND`, `MODEL_API_BASE_URL`, `MODEL_API_VERSION`, `MODEL_API_AUTH`, `MODEL_CATALOG`, `MODEL_CATALOG_PATH`), `SOCRATA_MCP_URL`, the signing pair, `NEXTAUTH_SECRET`, the OAuth credentials, `CRON_SECRET`, `SIGN_IN_ALLOWLIST`, `ROADMAP_RAW_URL`, the host-topology trio, the registry-URL overrides, the branding set, the tuning knobs |
| `${NAME:-default}` | Overridable, with a working local default if you say nothing. | the Postgres and object-store credentials (`POSTGRES_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — placeholder defaults you are expected to replace), host ports, bucket name, `S3_PUBLIC_BASE_URL`, `APP_BIND` / `APP_PORT`, the executor image tag, the identity variables that carry a local default, `NEXTAUTH_URL`, the GC knobs |
| a literal value | Hardcoded wiring. Changing it means editing the compose file, not your env file. | the three driver selectors, `S3_ENDPOINT`, the constructed `DATABASE_URL` |

There is no fourth category. A variable this guide documents but the
compose file does not list would be inert on this path — set it, restart,
and nothing happens, with no error to debug. That was a real fourth
category once — the branding set, the content sources, host topology and
the tuning knobs were all documented here and none of them were listed
there. `scripts/check-compose-env.mjs` now compares the compose file
against the app's own variable inventory (`scripts/preflight-env.mjs`) on
every CI run, so a variable the inventory declares but the compose file
does not deliver fails the build. The inventory is checked in turn against
the code: `scripts/env-reads-declared.test.mjs` derives every variable the
app reads and fails on one the inventory does not declare. Before that
second check existed, a variable missing from both files passed the first
— the footer's repo link and the three sponsor variables sat in that gap
until civic-ai-tools-website#434.

**Build time versus run time.** Most variables are read by the running
server and arrive through the container's environment. A few are read at
`next build` instead: `NEXT_PUBLIC_*` values are inlined into the emitted
bundles, and the branding and content-source variables are additionally
baked into statically prerendered pages. Those appear under the app
service's `build.args` as well, resolved from the same env file, so:

```bash
docker compose --env-file /path/to/your.env up -d --build
```

supplies both sides at once. A change to a build-time value takes effect
on the next build, not on the next restart — `--build` is what makes that
one command rather than two.

> **Reset the dev volumes before switching to your own passwords.**
> Postgres reads `POSTGRES_PASSWORD` only when its data volume is first
> initialized — and the bare bring-up above already initialized it with
> the placeholder password. Starting again with a changed password does
> **not** rotate it; it produces a stack that fails halfway up: the
> `migrate` service exits 1
> (`service "migrate" didn't complete successfully: exit 1`), the
> Postgres log shows
> `FATAL: password authentication failed for user "civic"`, and the app
> never starts. Neither error names the cause. At this stage the volumes
> hold nothing but placeholder-initialized dev data, so the reset is
> free — and the same applies to any later `POSTGRES_*` change: those
> values take effect at volume initialization, never on restart.
>
> `down -v` discards MinIO's volume alongside Postgres's, which makes
> this the clean moment to move `S3_ACCESS_KEY_ID` /
> `S3_SECRET_ACCESS_KEY` off their placeholders too: MinIO takes that
> pair as its root credentials, and starting from an empty store beats
> reasoning about rotating them against an initialized one.

```bash
docker compose down -v   # discard the placeholder-initialized volumes
docker compose --env-file /path/to/your.env up -d
```

Many operators keep this file free of literal secrets by storing values
in a secret manager and injecting them at start time (for example the
1Password CLI: `op run --env-file=<file> -- docker compose up`, with
`op://` references in the file). That is one operator convention, not a
product requirement — any equivalent works.

### Security note: the executor's socket mount

`EXECUTOR_DRIVER=container` executes notebooks by shelling out to
`docker`, so the compose file gives the app container the host's
container-runtime socket (`/var/run/docker.sock`) and runs it as root.
**Socket access is equivalent to root on the host**: anything able to
talk to that daemon can start a privileged container, bind-mount the
host filesystem, and step outside the container boundary. The isolation
the executor provides to notebooks does not extend to the app service
itself.

Consequences, as shipped:

- The app's port is **loopback-bound by default**. Publish it wider
  (`APP_BIND=0.0.0.0`, or better, a reverse proxy) only after weighing
  what the socket mount means for this host. Do not expose the port to
  an untrusted network as-is.
- Run this configuration only on a host you already trust the
  application with.
- A deployment that does not execute notebooks can remove the
  `user: "root"` and socket-volume lines from the `app` service
  together — they exist solely for the container executor.

The avoidance path is a future third executor driver ([ADR-0023]
territory: an HTTP runner that owns the runtime and exposes only
"execute this notebook", leaving the app with no socket at all). Until
that exists, the mount is the mechanism and this notice is the
mitigation.

### What the executor image pins, and who it runs as

The executor image (`docker/executor/Dockerfile`, tag
`civic-notebook-executor:0.2.0`) pins the packages the tables below
name, and those pins are single-sourced in the repository rather than
written in the Dockerfile; everything else it installs resolves at build
time:

| Table | Source | Contents |
| --- | --- | --- |
| Scientific stack | `src/lib/notebook-author/prompt.ts` (`PINNED_LIBRARIES`) | `pandas`, `requests`, `numpy`, `matplotlib` |
| Notebook tooling | `src/lib/sandbox/driver.ts` (`EXECUTOR_TOOLING_PACKAGES`) | `jupyter`, `ipykernel`, `nbformat`, `nbconvert` |
| Python runtime | `src/lib/notebook-author/prompt.ts` (`PYTHON_RUNTIME_VERSION`) | the default of `PYTHON_IMAGE`, the base image |

Both tables feed the container image, the managed-sandbox snapshot
(`scripts/build-sandbox-snapshot.ts`) and the fresh-sandbox pip fallback,
so the two executors install the same versions of the packages the
tables name, and pip resolves everything else separately for each. A
build of this image on 2026-09-18 resolved `nbclient` 0.11.0,
`jupyter_client` 8.10.0 and `traitlets` 5.16.1, where the reference
deployment's snapshot holds 0.10.4, 8.8.0 and 5.15.0.
`src/lib/sandbox/executor-pins.test.ts` asserts version equality against
the Dockerfile — a name-only check would pass against no version at all.
The tooling pins matter because an executed notebook's bytes come out of
`nbformat` and `nbconvert` and go into a signed package: unpinned, two
builds on different days can sign different bytes for the same inputs.
Transitive dependencies (`jupyter-core`, `jupyter-client`, `nbclient`,
`traitlets`) are resolved by pip at build time and are **not** pinned —
byte-for-byte reproducibility across distant build dates needs a fully
resolved lock, which this image does not yet carry.

The image runs notebooks as the unprivileged user `notebook` (uid 10001)
with `HOME=/home/notebook` and `WORKDIR=/tmp`; the driver stages the
notebook under `/tmp`, which that user can write. matplotlib's font cache
is warmed at build time **after** the `USER` switch, so the first run in a
fresh container does not rebuild it — a cache built under root's home is
not read by `notebook`. At matplotlib 3.9.2 a rebuild logs `generated new
fontManager` at INFO, which at default log levels reaches nothing; a
notebook that configures logging puts that line on cell stderr, and cell
stderr is part of the executed-notebook bytes, which are signed. The warm
removes the rebuild either way.

This is the executor container. The `app` service still runs as root with
the socket mount described above; that is a separate posture and the
section above is its notice.

### Building the image without the docker CLI

The runtime image carries a static `docker` binary at
`/usr/local/bin/docker`. Exactly one thing reads it:
`EXECUTOR_DRIVER=container`, which executes notebooks by shelling out to
it (`src/lib/sandbox/container.ts`). Every other executor setting leaves
it untouched:

| `EXECUTOR_DRIVER` | Needs `/usr/local/bin/docker` |
| --- | --- |
| `container` | Yes — and a container-runtime socket to talk to |
| `vercel-sandbox` (the default) | No |
| unset | No (the default is `vercel-sandbox`) |

On a platform that offers no socket to hand over, the binary can never
be used: it is dead weight in the runtime image and one more component
for an image scanner to flag. Build it out with one build argument:

```bash
docker build --build-arg RUNTIME_BASE=runtime-without-docker-cli -t civic-app:dev .
```

`RUNTIME_BASE` is a global `ARG` in the `Dockerfile` naming the stage the
runtime stage is built from. It takes two values:

| Value | Result |
| --- | --- |
| `runtime-with-docker-cli` (default) | The reference image, unchanged |
| `runtime-without-docker-cli` | No `docker` binary in any layer; the `docker-cli` stage stays outside the build graph, so `DOCKER_CLI_IMAGE` is never pulled |

It is a build argument, not an environment variable: it selects a stage
and is read at build time only, so it does not appear in the environment
reference below and is not passed through `docker-compose.yml`'s
`build.args`. Changing it takes effect on the next build.

Set it to `runtime-without-docker-cli` and your instance can no longer
run `EXECUTOR_DRIVER=container` — the driver reports the CLI as
unavailable at first use, which is the honest failure for an image that
does not carry it. CI builds both variants on every pull request and
checks that the off variant starts and serves the health route, so the
variant cannot rot.

### Building behind a registry mirror

With no build argument, both images pull their bases from Docker Hub, the
application image installs its dependencies from the npm registry, and the
notebook image installs its pinned packages from PyPI. A build host that
reaches none of them can pull through a mirror instead. Each of those
downloads is named by a build argument, so neither Dockerfile needs an
edit:

| Image | Build argument | Default | What it names |
| --- | --- | --- | --- |
| Application (`Dockerfile`) | `NODE_IMAGE` | `node:22-bookworm-slim` | The base of the dependency, build and runtime stages |
| Application | `DOCKER_CLI_IMAGE` | `docker:29-cli` | The image the `docker` binary is copied from; not pulled at `RUNTIME_BASE=runtime-without-docker-cli` |
| Application | `NPM_CONFIG_REGISTRY` | Unset: npm uses registry.npmjs.org | The registry `npm ci` installs from, in the dependency stage |
| Notebook (`docker/executor/Dockerfile`) | `PYTHON_IMAGE` | `python:3.13-slim-bookworm` | The base of both targets |
| Notebook | `PIP_INDEX_URL` | Unset: pip uses PyPI | The package index both `pip install` runs read, in the default target and in `lambda` |

```bash
docker build \
  --build-arg NODE_IMAGE=registry.example.internal/library/node:22-bookworm-slim \
  --build-arg DOCKER_CLI_IMAGE=registry.example.internal/library/docker:29-cli \
  --build-arg NPM_CONFIG_REGISTRY=https://registry.example.internal/npm/ \
  -t civic-app:dev .

docker build \
  --build-arg PYTHON_IMAGE=registry.example.internal/library/python:3.13-slim-bookworm \
  --build-arg PIP_INDEX_URL=https://registry.example.internal/pypi/simple/ \
  -t civic-notebook-executor:0.2.0 docker/executor
```

Add `--target lambda` to the second command for the Lambda image. CI
builds both images with no build argument, so the defaults stay the tested
reference.

- **The same images.** A mirror's copy must be the image the default
  names. The notebook image's Python version is pinned
  (`PYTHON_RUNTIME_VERSION`), and `npm test` checks the default, not the
  value you pass; `node --experimental-strip-types
  scripts/executor-image-check.mjs pins --image <tag>` checks a built
  image's Python version and pins.
- **The index.** `PIP_INDEX_URL` is pip's own setting, so the mirror must
  serve PyPI's simple API and every version the image installs. Unset, or
  set to an empty value, pip uses PyPI. With this argument alone pip
  accepts an HTTPS index whose certificate the base image trusts, or a
  loopback address. It ignores a plain-HTTP index at any other address,
  and an index behind a private certificate authority needs that
  certificate in the build; neither case is covered yet.
- **The registry.** `NPM_CONFIG_REGISTRY` is npm's own setting, so the
  mirror must serve the npm registry's API and every version the lockfile
  pins. The lockfile records each package at registry.npmjs.org; with the
  argument set, `npm ci` fetches every one of them from the mirror instead,
  and checks each against the lockfile's integrity hash. Unset, or set to
  an empty value, npm uses registry.npmjs.org. npm also sends its audit
  request to the mirror; a mirror that refuses it does not fail the build.
  Measured with npm 10.9.8, the base image's, against a plain-HTTP registry
  on a loopback address. A registry behind a private certificate authority
  needs that certificate in the build, which is not covered yet.
- **No credentials in a build argument.** Build arguments are recorded in
  the image's history: `docker history --no-trunc` shows the
  `PIP_INDEX_URL` and `NPM_CONFIG_REGISTRY` values on every `RUN` after
  their declaration. An index or registry that requires authentication is
  out of scope for now; a build secret is the shape it would take.
- **No frontend image.** Neither Dockerfile has a `# syntax=` line, so the
  builder's built-in frontend parses both and nothing else is pulled. On a
  host that already holds a base tag, that frontend builds from the stored
  copy rather than asking the registry again (measured on Docker 29.4);
  `--pull` resolves the tag again.
- **One fetch inside `next build`.** The `/directory` page is prerendered
  from the community index at raw.githubusercontent.com, or from
  `DIRECTORY_DATA_URL` when that is set. A build that cannot reach it
  still succeeds: it prerenders the snapshot bundled with this codebase
  and logs `[Directory] Failed to fetch the configured source, using
  bundled snapshot`. With the network cut after the dependency stage, the
  build and runtime stages completed, and this was the only failed fetch
  the build log reported.

`scripts/build-behind-mirror.test.mjs` fails when either Dockerfile gains
an image pull, a `pip install` or an `npm ci` that no build argument
redirects.

## Usable, not just built

The instance above came up correctly and can still leave you with no
reachable way to run a query. Three gates sit between "the containers are
healthy" and "a person can ask it something," each documented on its own,
nowhere named together — and they gate differently, so ruling one out tells
you nothing about the other two.

| Surface | What gates it | Variable | What you see when it's missing |
| --- | --- | --- | --- |
| `/explore` | An unnamed host takes the `app` role, and that role withholds the marketing route group (`resolveHostRole`, `src/lib/host-routing.ts:394`; withheld by `decidePathAction`, `:503`) | `SERVE_MARKETING` | `404` |
| `/` | Same host-role gate; the `app` role redirects root to `/ask` instead of serving the marketing home page (`decidePathAction`, `src/lib/host-routing.ts:501`, returning `APP_ROOT_ACTION`, defined at `:200`) | `SERVE_MARKETING` | `307` redirect to `/ask` |
| `/ask` and the executed-notebook path behind it | No session, and no OAuth provider configured to start one (`src/app/(app)/ask/AskSignInPanel.tsx:112-116`) | An auth provider — the GitHub pair or the OIDC triple (see [Sign-in configuration](#sign-in-configuration)) | *"This instance has no sign-in provider configured, so there is no way to sign in here yet."* |
| Any query | No model credential (`src/lib/streaming.ts:244`) | `MODEL_API_KEY` | *"This server has no AI model API key configured, so queries can't run…"* |

The two query surfaces are gated by different mechanisms — `/explore` by
routing, `/ask` by a session — which is the fact worth internalizing: an
instance with no sign-in provider still has a working, anonymous query
surface at `/explore` once `SERVE_MARKETING` is set, and an instance serving
the full marketing site still shows `/ask` a sign-in prompt with no button
until a provider is configured.

[`scripts/preflight-env.mjs`](../scripts/preflight-env.mjs) reports this
same mapping, in the same words, under a **Query surfaces** block on every
run (informational — it never fails the run, the way the rest of the report
does not fail on an absent optional variable):

- `/explore` — reachable on an unnamed host only if `SERVE_MARKETING` is set (unset: 404)
- `/` — reachable on an unnamed host only if `SERVE_MARKETING` is set (unset: redirects to `/ask`)
- `/ask` and the executed-notebook path — reachable only with a sign-in provider configured (none: the sign-in panel with no provider)
- any query — reachable only with `MODEL_API_KEY` set (unset: the no-key error)

## The three driver decisions

An instance is not one fixed deployment shape. Three selector variables
pick which backing service each seam talks to, and **which other
variables are load-bearing follows from that choice**. The defaults are
the managed-platform profile; the compose file sets all three to the
self-hosted values for you. Decide these first.

| Seam | Variable | Values | Default | Compose sets |
| --- | --- | --- | --- | --- |
| Database | `DB_DRIVER` | `neon-http`, `node-postgres` | `neon-http` | `node-postgres` |
| Blob storage | `BLOB_DRIVER` | `vercel-blob`, `s3` | `vercel-blob` | `s3` |
| Notebook executor | `EXECUTOR_DRIVER` | `vercel-sandbox`, `container`, `lambda`, `none` | `vercel-sandbox` | `container` |

A selector set to anything outside its value set fails loudly at first
use (and fails the preflight). What the defaults hide:

- **`DB_DRIVER` — the deployment-critical one.** The default,
  `neon-http`, speaks Neon's serverless HTTP protocol. It **silently
  never reaches a plain Postgres server over TCP** — an operator who
  points `DATABASE_URL` at ordinary Postgres without setting
  `DB_DRIVER=node-postgres` gets a driver that cannot connect, not an
  error naming the mismatch. Any non-Neon Postgres needs
  `DB_DRIVER=node-postgres`. `DATABASE_URL` is load-bearing under both
  drivers.
- **`BLOB_DRIVER`.** The default, `vercel-blob`, requires the
  platform-issued `BLOB_READ_WRITE_TOKEN` and only makes sense on that
  platform. `s3` works against any S3-compatible endpoint (AWS S3,
  MinIO, R2, …) via the `S3_*` set
  ([Object storage](#object-storage-configuration-and-rehearsal)).
- **`EXECUTOR_DRIVER`.** The default, `vercel-sandbox`, boots a managed
  microVM and needs platform auth off-deploy. It is written against
  `@vercel/sandbox` 3.x (`SANDBOX_SDK_MAJOR` in `src/lib/sandbox/driver.ts`).
  Each run creates a one-use sandbox (`persistent: false`), so stopping it
  snapshots nothing; 3.x sandboxes are persistent unless told otherwise. A
  record's `sandboxId` is that sandbox's name, which the executor sets:
  `nbexec-` followed by 32 lowercase hex digits (128 random bits), such as
  `nbexec-1b0e34e0b531296ff94b86be48e2e0b7`. Under 1.x it was an `sbx_…` id.
  The field is a string either way. `container` runs the
  prebuilt `civic-notebook-executor` image on the host's container
  runtime — which is what requires the socket mount discussed above.
  `EXECUTOR_CONTAINER_IMAGE` overrides the image tag (default
  `civic-notebook-executor:0.2.0`). `lambda` sends each notebook to an
  AWS Lambda function built from the same Dockerfile, for a platform that
  offers no container-runtime socket (see [The Lambda
  executor](#the-lambda-executor)). `none` declares that the instance
  runs no notebooks at all (next section). An unset `EXECUTOR_DRIVER`
  is not that declaration: it is `vercel-sandbox`.

### An instance that runs no notebooks (`EXECUTOR_DRIVER=none`)

Set `EXECUTOR_DRIVER=none` on an instance with no notebook executor.
Without it, `/ask` starts in notebook mode and every question there ends
in an error after the model has already answered: the unset driver is
`vercel-sandbox`, which the route tries and which cannot start there.

**What a reader sees.** On both pages that offer notebook mode, `/ask`
and the home page, the response-mode control under Advanced options
shows the notebook option disabled, with the reason beside it: "Not
offered on this site: it does not run notebooks, so questions are
answered in standard mode." This holds signed in or not; a signed-out
reader is not asked to sign in for a mode that signing in would not turn
on. `/ask` starts in standard mode, including for a reader whose
session had stored a notebook choice; the stored choice is kept, not
erased.

**What the route answers.** `POST /api/query-notebook` answers **501**
with a JSON body `{"error": "…", "code": "notebooks_not_offered"}`; a
client matches on the code, `notebooks_not_offered`, not on the text. It
does so first, before it reads the request body, before any model call,
and before the rate limiter is charged, so a refused request costs the
caller nothing. The form never sends one under `none`; this is the
answer to a page loaded before the setting changed, or to a direct API
call. A page loaded before the change shows the generic error copy.

**What `none` does not do.** It does not change standard mode, or
anything else that does not execute a notebook. A standard-mode answer
can still be downloaded as a notebook file, unexecuted, as on any
instance. Replay of a published record, publishing, and
reading records that carry an executed notebook are unchanged. It is not
a default-mode setting either: an instance with an executor cannot use
it to start `/ask` in standard mode. And it does not stop
`scripts/executor-parity.mjs`, which sets its own driver for each leg.

**Where the value is read.** At run time by the route and by `/ask`,
which renders per request. The home page is prerendered, so its form
follows the value `next build` saw: set `EXECUTOR_DRIVER` in the build
environment as well, as `SITE_PORTAL_LOCKED` is
([Branding and theming](#branding-and-theming-chrome-only) explains the
two arrival times). The Dockerfile declares it as a build argument, and
`docker-compose.yml` passes the same literal it runs with (`container`);
change both together.

**Preflight** accepts `none`, and drops every variable only notebook
execution reads: the container and Lambda settings, both timeouts,
`SOCRATA_APP_TOKEN` and `DC_API_KEY` (passed into a notebook, never read
by the app), and the sandbox-only variables. If execution is reached
anyway, it refuses with an `ExecutorSettingError` naming
`EXECUTOR_DRIVER`, and no driver is loaded.

### Executor settings

Every setting below is optional, and unset (or blank) means the behaviour the
executor had before the setting existed. The compose file passes each one
through bare, so a variable your env file does not set stays unset. Under
`EXECUTOR_DRIVER=none` none of them is read.

A value is checked before the executor starts anything. A value that is not
of its setting's shape is refused at the first notebook run, not corrected:
the run fails with an `ExecutorSettingError` naming the variable, the server
log names that class, and the reader sees the usual notebook-failure message
with its reference id.

**Timeouts, for every driver:**

| Variable | Unset | What it sets |
| --- | --- | --- |
| `EXECUTOR_SESSION_TIMEOUT_S` | `180` | The session cap: the wall-clock limit on the whole run, including the sandbox or container start, staging, every cell and read-back. A run past it is stopped and fails. Whole seconds, 1 to 86400. |
| `EXECUTOR_CELL_TIMEOUT_S` | `120` | The per-cell limit, handed to nbconvert as `--ExecutePreprocessor.timeout`. Whole seconds, 1 to 86400. |

The session cap must be greater than the per-cell limit; a cap at or below it
is refused. The cap also covers the start and the read-back, so a cap at the
per-cell limit would stop a notebook before its slowest permitted cell could
finish. Leave a margin for the start: a cold container or sandbox takes
seconds, not milliseconds. Under `vercel-sandbox` the cap is the sandbox's own
timeout, and the platform bounds that by your plan's maximum.

**The container executor (`EXECUTOR_DRIVER=container`):**

| Variable | Unset | What it sets |
| --- | --- | --- |
| `EXECUTOR_CONTAINER_CLI` | `docker` | The CLI every invocation spawns: a name found on `PATH`, or a path. Any CLI that takes `run -d --rm`, `exec -i`, `exec -e NAME` and `kill` as `docker` does (`podman` does). |
| `EXECUTOR_CONTAINER_MEMORY` | no limit | `docker run --memory`, for example `2g`. |
| `EXECUTOR_CONTAINER_CPUS` | no limit | `docker run --cpus`, for example `1.5`. |
| `EXECUTOR_CONTAINER_PIDS_LIMIT` | the runtime's default | `docker run --pids-limit`: the most processes a notebook can start. |
| `EXECUTOR_CONTAINER_NETWORK` | the runtime's default network | `docker run --network`: the network each notebook container joins, for example one whose only way out is your egress proxy. A notebook fetches its data live, so a network with no route to the data portal fails every notebook. |
| `EXECUTOR_CONTAINER_USER` | the image's user, uid `10001` | `docker run --user`. Any other user cannot write the image's matplotlib cache, and matplotlib then writes a warning into the notebook's output, which is signed. So when this is set, the driver also sets `MPLCONFIGDIR=/tmp/matplotlib` and first copies the image's warm cache there (`/home/notebook/.config/matplotlib`). Measured on the reference image: a notebook's output is then the same under any user. With an image of your own whose cache is elsewhere, the copy finds nothing and the cache starts cold. That produces no warning, but a notebook that logs at INFO shows a "generated new fontManager" line. |
| `EXECUTOR_CONTAINER_RUNTIME` | the runtime's default | `docker run --runtime`, for example `runsc` for gVisor. The runtime must be installed on the host. |
| `EXECUTOR_CONTAINER_HARDENED` | off | `1` or `true` adds `--cap-drop ALL --security-opt no-new-privileges` to `docker run`. `0` or `false` leaves it off. The notebook needs no Linux capability. |

The flags go between `--rm` and the image, in the order above. No setting
takes free-form arguments, and a value that starts with `-` or contains
whitespace is refused, so no setting can add an argument of its own. The CLI
inherits the app's environment, so its own variables (`DOCKER_HOST`,
`DOCKER_CONTEXT`, `CONTAINER_HOST` for podman) apply as they would in a
shell.

No value the notebook receives is put on a command line. The notebook's own
variables (`SOCRATA_APP_TOKEN`, `DC_API_KEY`) and the proxy variables reach
the container as `docker exec -e NAME`, with the value in the CLI's
environment, so `ps` on the host or in the app container never shows them.

There is no read-only-root setting yet. Measured: under a read-only root the
image's matplotlib cache cannot be written, and a notebook that imports
matplotlib gains the same warning in its signed output. A read-only root also
leaves no writable path to copy the cache to until `/tmp` is mounted
writable, so it needs its own change.

### The Lambda executor

`EXECUTOR_DRIVER=lambda` runs each notebook in one synchronous invoke of an
AWS Lambda function. The function's image is the `lambda` target of
`docker/executor/Dockerfile`: the container executor's image, with the same
pins, plus the AWS runtime interface client (`awslambdaric`) and the handler
(`docker/executor/lambda/handler.py`). The app sends the notebook, the
nbconvert command and the Python-version probe exactly as it runs them under
the other drivers. The handler runs them as given, and the executed notebook
comes back in the response.

**The app's side:**

| Variable | Unset | What it sets |
| --- | --- | --- |
| `EXECUTOR_LAMBDA_FUNCTION` | required under this driver | The function, by name or ARN, optionally with `:qualifier` (an alias or version). |
| `EXECUTOR_LAMBDA_REGION` | the AWS SDK's own region, `AWS_REGION`, which ECS sets | The function's region. With neither set, the first notebook run refuses and names both. |

- **Credentials:** the AWS SDK's default chain; on ECS, the task role.
- **Permission:** the task role needs `lambda:InvokeFunction` on the
  function's ARN, and on the qualified ARN when a qualifier is named.
  Nothing else.
- **Endpoint:** the invoke goes to `lambda.<region>.amazonaws.com`, through
  your egress proxy when one is configured (see the proxy table's
  `EXECUTOR_DRIVER=lambda` row). To reach it through a VPC interface endpoint
  instead, name the host in `NO_PROXY`. The SDK's own
  `AWS_ENDPOINT_URL_LAMBDA` points it at another endpoint. A synchronous
  invoke carries no bytes until the function ends, so through a proxy that
  closes idle tunnels sooner than your longest notebook, use the endpoint.
- **One attempt:** a failed invoke is not retried, because a retry would run
  the notebook again against live data.
- **The data-portal tokens:** `SOCRATA_APP_TOKEN` and `DC_API_KEY` are **set
  on the function, not the app**. The app never sends them, whatever its own
  environment carries, and the handler adds them from the function's
  environment. A credential's value never appears in a notebook output, a
  stream event or a record: the handler removes both values, raw, URL-encoded
  and JSON-escaped, from the executed notebook and from the stderr it returns,
  and leaves `[NAME removed]` in their place; the app removes any value it also
  holds before it streams or packages a notebook. The handler's half is in the
  function image, so an instance on `lambda` gets it only when it rebuilds and
  redeploys that image.
- **The record:** a record's `sandboxId` is the invoke response's request id
  (the `x-amzn-requestid` header), which the function's code cannot write.
  That it equals the `RequestId` in the function's `START` line is expected
  and not yet measured, because the emulator CI runs under sends no such
  header. Check it on your first deployment.

**The function's side:**

- **The image.** Build it for the architecture you configure the function
  with, and push it to a registry Lambda reads (Amazon ECR):

  ```bash
  docker build --platform linux/amd64 --target lambda \
    -t civic-notebook-executor-lambda:0.2.0 docker/executor
  ```

  CI builds and checks this target on amd64
  (`scripts/lambda-image-check.mjs`).
- **The execution model.** Use standard Lambda. Lambda Managed Instances run
  several invocations in one environment at once, and each notebook's run
  assumes it has its environment to itself.
- **Timeout.** At least `EXECUTOR_SESSION_TIMEOUT_S` plus 15 s (195 s at the
  defaults), and at most Lambda's 900 s. The handler stops
  nbconvert at the session cap and answers with a timeout. The app waits the
  cap plus 15 s for that answer.
- **Memory.** Not measured here: the other drivers set no memory limit of
  their own, so there is no figure to carry over. 2048 MB is a starting
  point; measure your notebooks' `Max Memory Used` in the `REPORT` lines and
  adjust. `/tmp` holds only the run's notebook and cache, so the default
  512 MB of ephemeral storage is enough.
- **Environment.** `SOCRATA_APP_TOKEN` and `DC_API_KEY`, when you use them.
  When the function runs in a VPC, set your egress proxy on the function as
  well (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`). The handler passes all of
  these to the notebook, which fetches its data live from the portal: a
  function with no route to the portal fails every notebook. It also passes
  the certificate settings `SSL_CERT_FILE`, `SSL_CERT_DIR`,
  `REQUESTS_CA_BUNDLE` and `CURL_CA_BUNDLE` when they are set and not
  empty, whether on the function or in the image (see the next item). Of
  the rest of the function's environment, only `PATH` and `LANG` reach the
  notebook.
- **A proxy that inspects TLS.** Such a proxy answers every HTTPS request
  with a certificate of its own, signed by its own CA, and a notebook that
  does not trust that CA fails every fetch. Build the function's image from
  the one above, adding your proxy's CA certificate (PEM, in a file whose
  name ends in `.crt`):

  <!-- lambda-image-check: ca recipe -->
  ```dockerfile
  FROM <your-registry>/civic-notebook-executor-lambda:0.2.0
  USER root
  COPY proxy-ca.crt /usr/local/share/ca-certificates/proxy-ca.crt
  RUN update-ca-certificates
  USER notebook
  ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
      REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
  ```

  `update-ca-certificates` writes one bundle holding the image's public
  roots and your CA, and both variables name that bundle. The notebook's
  fetch helpers use `requests`, which reads its own bundle unless
  `REQUESTS_CA_BUNDLE` names another; `SSL_CERT_FILE` covers Python's `ssl`
  and `urllib`. Point either variable at a file holding only your CA and
  every site the proxy does not inspect fails, because the variable
  replaces the default roots rather than adding to them. CI builds this
  block as written (`scripts/lambda-image-check.mjs ca`). It generates a
  throwaway CA and runs a notebook under the emulator that fetches, with
  `requests` and with `urllib`, from a TLS origin that CA signed. The same
  notebook on the image without the CA fails both fetches on the
  certificate. The same recipe with `FROM` the container image serves
  `EXECUTOR_DRIVER=container` (set `EXECUTOR_CONTAINER_IMAGE` to it):
  `docker exec` gives the notebook the image's `ENV`, so the app needs no
  setting of its own. The app's own requests need
  [`NODE_EXTRA_CA_CERTS`](#a-proxy-that-inspects-tls).
- **Permissions: none, unless the function runs in a VPC.** Give the
  execution role no permissions. Measured under the runtime emulator: code
  in a notebook, which the model writes, can read the function's
  environment, the role's temporary credentials included. Scrubbing the
  notebook's environment does not prevent that. The only grant to consider
  is `logs:CreateLogStream` and `logs:PutLogEvents` on the function's own
  log group, if you want its log lines in CloudWatch, and then notebook code
  can write log events too. The handler writes nothing to the log: no event,
  notebook, traceback or token. CI checks this under the emulator by running
  a failing notebook with decoy tokens set, then reading the whole log for
  them.
- **A function in a VPC.** The following is AWS's documentation, not
  measured here ([Giving Lambda functions access to resources in an Amazon
  VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html),
  read 2026-09-25). Lambda needs six actions on the execution role, on all
  resources, to create and delete the network interfaces the function uses:
  `ec2:CreateNetworkInterface`, `ec2:DescribeNetworkInterfaces`,
  `ec2:DescribeSubnets`, `ec2:DeleteNetworkInterface`,
  `ec2:AssignPrivateIpAddresses` and `ec2:UnassignPrivateIpAddresses`. AWS
  says the function's code is implicitly granted them too, so notebook code
  could call those EC2 APIs. AWS's recommended remedy is a deny statement
  on the same role that applies only to calls made by the function's code,
  not to Lambda's own. List these six actions yourself rather than
  attaching the managed policy `AWSLambdaVPCAccessExecutionRole`: that
  policy also grants the three `logs:` actions on every resource, which
  lets notebook code write to any log group, not just the function's own.
  The deny statement, as AWS gives it, with your function's ARN:

  ```json
  {
    "Effect": "Deny",
    "Action": [
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeSubnets",
      "ec2:DetachNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses"
    ],
    "Resource": ["*"],
    "Condition": {
      "ArnEquals": {
        "lambda:SourceFunctionArn": ["arn:aws:lambda:<region>:<account>:function:<name>"]
      }
    }
  }
  ```

  Per AWS ([Using source function ARN to control function access
  behavior](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html)):
  Lambda adds the condition key `lambda:SourceFunctionArn` to calls made
  from inside the execution environment, and not to its own calls that
  create network interfaces, which is why the deny stops the code and not
  the service. Use the function's unqualified ARN: AWS
  says the key does not support versions or aliases. Keep the six actions
  on the role after the function is created, because AWS says Lambda uses
  them to delete the network interfaces later. Not measured here: any of
  the above on a real function, and whether credentials copied out of the
  function carry the key when used elsewhere.
- **A proxy address with a user or password** set on the function is
  readable by notebook code, the same as the tokens. Prefer one without.

**What the handler guarantees between runs.** Lambda reuses an environment
across invocations, and `/tmp` and any process a run left behind survive into
the next one. A reset after a crash or timeout does not clear `/tmp` either.
So before each response goes out, and again at the start of each run, the
handler kills every process the function's user owns except its own, then
empties `/tmp`. CI drives this under the emulator: one run leaves a file, a
detached process, and a process that waits and then calls the Runtime API
for the next event. The next two runs see none of it, and each gets its own
response.

What the handler cannot prevent: during its own run, notebook code can reach
the Runtime API and replace that run's response. That is the control the code
already has over its own output. A record's `sandboxId` does not come from the
response.

**Output size.** A synchronous invoke returns at most 6 MB, and the executed
notebook travels base64-encoded, so about 4.7 MB of notebook fits. The largest
executed notebook measured on the reference deployment is 23 KB. Over the
limit, the run fails with a `LambdaResponseTooLargeError` naming the size.

### The model seam

The model endpoint is a seam too, but external by design — a network
service you supply, not a container in the stack. It is a **wire dialect**
rather than only a URL: `MODEL_API_KIND` picks `openai-compatible` (the
default) or `azure-openai`, which routes by deployment name, authenticates
with an `api-key` header and carries an api-version. `MODEL_API_BASE_URL`
selects the endpoint — under the default dialect any OpenAI-compatible
chat-completions endpoint, and under `azure-openai` the resource endpoint.
`MODEL_API_KEY` is the credential in every case; `OPENROUTER_API_KEY` is
its prior-era name and is still read, canonical winning whenever it is
defined.

Against any endpoint other than the built-in default the instance also
requires a **model catalog** (`MODEL_CATALOG`, or `MODEL_CATALOG_PATH` for
a file — setting both is refused). The built-in list names public slugs of
the default endpoint, which against yours may name nothing or name
something else. Wiring an instance to your own endpoint end to end,
including what to check in the resulting signed bytes, is
[`docs/instance-setup.md` §5](instance-setup.md#5-point-the-instance-at-a-model-endpoint).

A **reasoning model** — a GPT-5-series deployment, for one — also needs its
catalog entry to say how it is asked. Such a model takes its token limit only
as `max_completion_tokens`, and on Chat Completions it refuses tools unless
`reasoning_effort` is `none`, so without the two fields every query fails at
its first model call. `reasoningEffort` is sent as `reasoning_effort` on every
request to that model and recorded on the signed trace; `tokenLimitParameter`
names the limit, and when absent follows `reasoningEffort`. An entry with
neither sends exactly what it always did. Values and the rule:
[`docs/instance-setup.md` §5.2](instance-setup.md#52-the-catalog).

**Whether the endpoint's providers may train on your readers' questions is
an account setting, and the app cannot read it.** An endpoint that routes
to several providers may offer an account-level option that refuses every
provider whose own policy allows training on inputs. The built-in default
endpoint does: in its account's privacy settings, opting out of training
stops it routing to providers that train, with separate settings for paid
and free models, and the setting has no bearing on the endpoint's own
handling of prompts (its provider-logging page, read 2026-10-17). The app
sends no request field for this and has no way to read the account, so
nothing it shows or signs (preflight, a record, any page) can report the
setting. The operator states it, alongside the endpoint it applies to.

Missing, rejected, and rate-limited model keys **fail fast with typed
errors** — there is no silent hang to diagnose. Recognize them:

- Key missing or empty — the server logs and streams:

  > No model API key is configured: MODEL_API_KEY is missing or empty in
  > the server environment (its prior-era name OPENROUTER_API_KEY is still
  > accepted and was not set either). Set MODEL_API_KEY and restart the
  > server; whichever endpoint MODEL_API_BASE_URL names reads its key from
  > it.

  and the page shows: *"This server has no AI model API key configured,
  so queries can't run. If you operate this instance, set MODEL_API_KEY
  in the server environment and restart."*

- Key present but refused upstream (HTTP 401/403 from the endpoint) —
  the page shows: *"The AI model service rejected this server's API key,
  so the query couldn't run. If you operate this instance, check that the
  key in MODEL_API_KEY — or in its still-accepted prior-era name
  OPENROUTER_API_KEY — is valid for the endpoint this instance is
  configured to call."*

- Endpoint rate-limiting this server (HTTP 429 from the endpoint) — the
  page shows: *"The AI model service is limiting how many requests this
  server can make right now, so this query couldn't run. This is not your
  own daily limit — please try again shortly."* **This is not the app's
  own per-day request limiter**, which also answers 429 but is about one
  reader's allowance; the two are separate kinds precisely so a reader is
  never told they exhausted a budget they never touched. The server log
  names the wire dialect on this one, because quota on a deployment-routed
  endpoint is per-model and per-region.

All three are reproducible from the command line against a running stack.
Use a model id this instance actually offers — `GET /api/models` lists
them, and on the built-in catalog `anthropic/claude-haiku-5.5` is the first:

```bash
curl -s -X POST http://127.0.0.1:3000/api/compare \
  -H 'Content-Type: application/json' \
  -d '{"query":"test","model":"anthropic/claude-haiku-5.5"}'
```

With no key configured this returns HTTP 503 carrying the
`model_not_configured` message above as JSON. With a key the endpoint
refuses, it returns HTTP 502 and the raw upstream rejection:

```json
{"error":"401 User not found.","code":"model_auth_rejected"}
```

— which is also what appears in server logs and API responses. The text
after the status code is the upstream endpoint's own message and varies
(a malformed key value, for example, yields
`401 Missing Authentication header`).

Those two are the only typed cases: the classifier maps a missing
credential and an upstream 401/403, and everything else — including a
model id the endpoint does not recognize — falls through to a plain
HTTP 500 carrying the raw message. Hence the id above; a stale one turns
this reproduction into a different error than the one you came to see.

### Hosted sources

Most data sources are servers the instance calls at a configured address. A
**hosted source** is one the instance runs itself: a publisher-bundled MCP
server that speaks stdio only. The router (`@typedstandards/civic-typed-router`
0.6.x) pins four, each published by BetaNYC, by version together with the
commit the registry states for that version. Each is off unless its own
switch is `sandbox`.

| Source | Pinned package | Switch | The one host its sandbox may reach | Key | First creation, then a resume |
|---|---|---|---|---|---|
| NYC Charter, Laws and Rules | `@betanyc/nyc-charter-laws-rules` 0.3.1 | `NYC_CHARTER_HOSTING` | none (`deny-all`) | none | 7.7 s with `npm ci`, then 3.8 s (a local process, 2026-10-16 and 17) |
| NYC Checkbook | `@betanyc/nyc-checkbook-mcp` 1.6.3 | `NYC_CHECKBOOK_HOSTING` | `www.checkbooknyc.com` | none | bridge ready 5.9 s after a first creation (the router's probe, a local process, 2026-10-20); on preview, and a resume: to be timed at R8 G9 |
| NYC City Record | `@betanyc/nyc-record-mcp` 1.1.0 | `NYC_RECORD_HOSTING` | `data.cityofnewyork.us` | none | bridge ready 5.7 s after a first creation (the same probe); on preview, and a resume: to be timed at R8 G9 |
| NYS Open Legislation | `@betanyc/nys-openlegislation-mcp` 2.4.0 | `NYS_LEGISLATION_HOSTING` | `legislation.nysenate.gov` | `NYS_LEGISLATION_API_KEY`, sent in the request URL | not yet timed: it needs the key; on preview at R8 G9 |

- **The host that answered 403.** Checkbook NYC's own pages answered HTTP 403
  to a page read (the router's census, 2026-10-18), so the source's privacy
  row links the City Comptroller's policy instead, and its publisher warns that
  the host's firewall blocks bursts of requests. Whether the host serves
  requests from a sandbox at all is decided by the first call from preview.
- **Where the key travels.** State legislation's server sends the key in the
  request URL (the query string) of every call to `legislation.nysenate.gov`.
  The app puts the key in that one sandbox's environment when it creates the
  sandbox, beside the bridge token, and the bridge hands the server that one
  variable beyond the SDK's default environment; no other sandbox gets it.
  With the switch set and the key unset the source is not configured: it is
  offered to no run, its calls are refused naming the key, and one log line
  names the key. No sandbox is created for it.
- **Fixed at creation.** The key, like the bridge token, is fixed when the
  sandbox is created, and the preview sandbox is shared across branches (see
  "One secret per environment, not per branch" below). So a key change means
  deleting that source's sandbox, by its name, in that environment.

**What runs where.**

- The pinned package runs in a Vercel Sandbox the app creates, one per hosted
  source, pinned version and deployment environment. The sandbox is named
  `civic-src-<environment>-<alias>__<version>`, with each `.` in the version
  written as `_`, for example `civic-src-production-nyc_charter__0_3_1`. The
  environment is `VERCEL_ENV` (`production`, `preview` or `development`), or
  `local` off the platform. It is in the name because a project's preview and
  production deployments share one sandbox scope and hold different secrets.
  The name is an operator fact for the function log; no record carries it.
- Inside the sandbox, a small bridge (`src/lib/mcp/hosting/bridge-source.ts`,
  written into the sandbox when it is created) runs the package's one command
  over stdio and serves it over Streamable HTTP on one exposed port. It is
  built on `@modelcontextprotocol/server` and `@modelcontextprotocol/client`,
  pinned exactly. Toward the app it is a modern, sessionless MCP server, and
  the app's client finds it modern.
- The app resolves the sandbox's address on every call, from the sandbox
  handle. The address is never configured and never kept (a resumed sandbox
  may answer at a new one).

**Who holds what.** The operator holds `SOURCE_BRIDGE_SECRET`, one instance
secret. Each sandbox holds one token: HMAC-SHA256 of its name under the
secret. The token is given to the sandbox as an environment value when the
sandbox is created, and the app sends it as `Authorization: Bearer` on each
request. The bridge compares it in constant time and answers 401 to a missing
or wrong token, on every path. The stdio server itself is not given the token.

**The idle window and the wake.**

- A sandbox's session times out after the idle window, 10 minutes
  (`DEFAULT_IDLE_WINDOW_MS` in `src/lib/mcp/hosting/lifecycle.ts`; an option of
  the lifecycle, not an environment variable). Each call that meets a live
  bridge restarts the window without growing it: the session is extended only
  by what it lacks of one window. A call that reaches no bridge does not
  restart it. A source left idle stops by itself, keeps one snapshot, and the
  next call resumes it. Measured from a local process on 2026-10-16:
  - a first creation, which installs the pin and the bridge, took 11.8 s with
    `npm install`, and 7.7 s with `npm ci` from the committed lockfiles
    (2026-10-17);
  - a resume took 3.8 s;
  - a call to a running source added about 0.1 s.
- The wake has its own deadline, 30 seconds (`DEFAULT_WAKE_DEADLINE_MS`). Each
  exchange's 45-second deadline starts after the wake. A wake that misses its
  deadline fails the call as the source being unavailable. Its work is not
  cancelled: the platform call and any install keep running in that process
  while the process lives. Whether it completes is not measured, locally or
  on a Vercel Function; on a Function nothing keeps the instance alive for it
  (the app does not use `waitUntil`). Until it does, a call from
  another process finds the sandbox `running` with no bridge ready, polls
  `/health` until its own deadline, and fails as unavailable. A creation whose
  install never finished leaves no completion marker: the next resume deletes
  that sandbox by name, and the call after it creates the sandbox again.
- A bridge that dies inside a running session is handled two ways, depending
  on whether the calling process has already seen that session ready:
  - In a process that has seen it ready, the failed call finds the dead
    bridge. The app then asks `/health` once. If the bridge does not answer,
    the app starts it again once and retries the call once. The bridge binds
    its port before it reports ready, and a second bridge on a bound port
    exits (`EADDRINUSE`), so a restart never runs two bridges on one port. If
    the bridge cannot be started again, the call fails as unavailable and the
    idle window is not restarted, so the session stops by itself. Nothing on
    this path deletes the sandbox.
  - In a process that has not seen it ready, the call polls `/health` until
    its own wake deadline and fails as unavailable, without starting the
    bridge: from there a missing bridge cannot be told apart from another
    process's install or start still in flight, and starting one could race
    it. On Vercel every new function instance is such a process. That call
    does not restart the idle window either.
  Measured from a local process on 2026-10-17, with the bridge killed in a
  session that process had seen ready (the first case above):
  - the app before this change: the call failed (`502 Bad Gateway` from the
    sandbox's address) and still extended the session by 85 s;
  - this change: the call answered in 1.0 s, with one bridge running after
    it;
  - with the bridge's program moved away, so it could not start: the call
    failed as unavailable in 0.8 s and the session's expiry did not move.
    Once the program was put back, the next call answered in 1.4 s.
- Two calls at once from different function instances make one sandbox: the
  platform refuses the second create by name, and that call waits for the
  first one's bridge.

**The allowlist.** While the sandbox installs, it may reach only
`registry.npmjs.org`. Then the manifest's outbound list is applied. For NYC
Charter that list is empty, so the policy is `deny-all`: the server serves
the index bundled in its package and reaches no host. For each of the other
three it is the one host in the table above. **The policy filters
what starts, not what is running.** A process that already holds a
connection keeps it. So revoking a running source's reach means stopping its
sandbox, not changing its policy.

**Honest failure.** When the sandbox cannot be reached — a refused token, a
platform error, a wake past its deadline — the call is recorded as failed
with kind `unavailable`. The model is told the source is unavailable, and
the reader is told the data source could not be reached. That is never
reported as data that came back empty.

**Rotating the secret.** A sandbox keeps its token for its whole life. So
rotating `SOURCE_BRIDGE_SECRET` means deleting each hosted source's sandbox,
by its name, in each environment you rotate. Until then its bridge answers
401 and every call fails as unavailable. The next call after the delete
creates a sandbox with a token from the new secret.

**One secret per environment, not per branch.** The name carries the
environment, not the branch, so every preview deployment shares
`civic-src-preview-<alias>__<version>`. If one preview branch sets its own
branch-scoped `SOURCE_BRIDGE_SECRET`, the sandbox holds the token of
whichever branch created it, and every other branch's calls get 401 and fail
as unavailable. Set the preview secret once for all preview branches.
Otherwise, delete the preview sandbox by its name before a branch with a
different secret is tried.

**The installed tree is closed.** The sandbox installs the pin and the bridge
with `npm ci --ignore-scripts`, from two lockfiles committed in
`src/lib/mcp/hosting/lockfiles.generated.ts` (one for the pinned package, one
for the bridge's two packages). `npm ci` installs exactly the lockfile's tree,
or fails, so every sandbox of one pin runs the same code down to its last
dependency, and no package's install script runs. The lockfiles are a module,
bundled into the deployment, not files read at run time.
`src/lib/mcp/hosting/lockfiles.test.ts` checks that each lockfile's root is
exactly the pin (or `BRIDGE_PACKAGES`), that every entry carries an
`integrity` and resolves from `registry.npmjs.org`, and that the tree is closed.

**A pin move** (a router release that moves the hosting field's `version`, or
a change to `BRIDGE_PACKAGES`):

1. Re-generate the lockfiles and commit them with the move:

   ```sh
   node --experimental-strip-types scripts/generate-hosted-lockfiles.ts
   ```

   It resolves each `package.json` against the public registry with
   `npm install --package-lock-only --ignore-scripts` in a temporary
   directory and writes the module. It needs the network and no credential.
   `npm test` fails until it has been run.
2. The new version changes the sandbox's name, so the next call creates a new
   sandbox. The old one is deleted by the pin move's owner step, or left to
   expire, about 44 days after its last use (its snapshot expires 30 days
   after last use).

**Setting it up (preview first, then production):**

```sh
printf '%s' sandbox | vercel env add NYC_CHARTER_HOSTING preview
openssl rand -hex 32 | vercel env add SOURCE_BRIDGE_SECRET preview
```

The secret goes through the pipe and is never shown, typed or written to a
file. Use a different secret per environment.

Each other source's switch is set the same way (`NYC_CHECKBOOK_HOSTING`,
`NYC_RECORD_HOSTING`, `NYS_LEGISLATION_HOSTING`). State legislation also needs
`NYS_LEGISLATION_API_KEY`, piped into `vercel env add` from wherever the key
is kept, never typed on a command line, and set once for all preview branches.

**What a hosted source's record states.** A record of a run that offered
a hosted source states it in four places, each derived from the manifest
entry and none configured:

- `sourcesOffered`: `{ "sourceId": "nyc-charter", "alias": "nyc_charter",
  "reason": "configured" }` (with the switch unset, `not-configured`);
- `mcpServers` (the environment block, and the trace's `analysis.mcp_servers`):
  the package it ran, by purl, after the addressed servers:
  `{ "url": "pkg:npm/%40betanyc/nyc-charter-laws-rules@0.3.1", "name": "nyc-charter" }`.
  A hosted source has no configured address, and its sandbox's address lives
  for one session, so the record names what ran rather than where;
- `components[]`: the entry's `id` and the version it pins, the package
  version and the first 12 hex digits of its commit in semver build-metadata
  form: `{ "id": "@betanyc/nyc-charter-laws-rules@https://github.com/BetaNYC/nyc-charter-laws-rules", "version": "0.3.1+b784cb763ec0" }`.
  It carries no guidance hash: the source contributes no prompt text;
- each call: the exposed name (`nyc_charter__get_section`), the upstream name
  (`get_section`), the alias and the entry's `id` as the server identity.

The sandbox's name and address appear in no record. A consistency
attestation keys a hosted source's call by its exposed name
(`nyc_charter__search:{…}`), so a search of one source never matches a
search of another with the same arguments; the three earlier sources keep
the keys they had.

**The settings this host reads**, all of them:

| Setting | Read by | What it does |
|---|---|---|
| `NYC_CHARTER_HOSTING`, `NYC_CHECKBOOK_HOSTING`, `NYC_RECORD_HOSTING`, `NYS_LEGISLATION_HOSTING` | `src/lib/mcp/registry.ts` (`readMcpEnvFromProcess`) | `sandbox` offers that source; anything else leaves it off |
| `NYS_LEGISLATION_API_KEY` | `src/lib/mcp/registry.ts` (`hostedSourceKeyEnv`) | State legislation's key, into its sandbox at creation; unset with the switch on, the source is not configured |
| `SOURCE_BRIDGE_SECRET` | `src/lib/mcp/hosting/token.ts` | the instance secret each sandbox's token derives from |
| `VERCEL_ENV` | `src/lib/hosting-environment.ts` (`hostingEnvironment`, which `lifecycle.ts` re-exports) | the environment in the sandbox's name, and the usage table's `environment` column; `local` when unset |
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` | `src/lib/sandbox/vercel-sandbox.ts` (`resolveSandboxAuthParams`) | off-platform sandbox authentication, all three or none; on the platform, OIDC |
| `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` | `src/lib/sandbox/vercel-sandbox.ts` (`proxyAwareSandboxFetch`) | the sandbox API calls leave through the instance's proxy, as the executor's do |

Inside the sandbox the bridge reads one more, `SOURCE_BRIDGE_TOKEN`, which
the app sets at creation and no operator sets. The idle window
(`DEFAULT_IDLE_WINDOW_MS`, 10 minutes) and the wake deadline
(`DEFAULT_WAKE_DEADLINE_MS`, 30 seconds) are constants of the lifecycle, not
settings. The lockfiles are generated by
`scripts/generate-hosted-lockfiles.ts` (above).

**The cost shape.** A sandbox runs only while it serves calls: it stops by
itself one idle window after the last call, and a stopped sandbox costs its
one snapshot's storage. Each creation installs from the registry once (about
8 s and 136 MiB of installed packages, measured locally for scale); each resume
starts the bridge again (about 3.5-3.8 s). The lockfiles add about 54 KB to
the deployment.

**What it needs, and where it does not apply.**

- Hosting a source needs Vercel Sandbox, with the same authentication as the
  `vercel-sandbox` executor: OIDC on the platform, the
  `VERCEL_TOKEN`/`VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID` trio off it.
- The preflight therefore checks the two variables only under the
  `vercel-sandbox` executor profile, where that authentication is delivered.
  On other profiles it does not check them.
- A compose instance cannot host a source as its compose file stands: the
  compose file delivers neither the two variables nor the sandbox
  authentication.

## Environment reference, tier by tier

The executable authority on the environment is
[`scripts/preflight-env.mjs`](../scripts/preflight-env.mjs): it checks
the **presence** of every variable the app reads — and prints no
value, ever — resolves the four driver selectors first, and tiers every
other variable against the resolved profile — so a self-hosted instance is
neither passed while unrunnable nor nagged about variables its profile
never reads. It also warns when an **all-or-nothing variable group** is
only partially set — the Vercel Sandbox auth trio, either sign-in
provider's credential set, the KV pair, and the signing pair. For all
but the last, the code consumes the set only complete, so a partial set
is indistinguishable from an empty one at run time and the feature
silently stays off; the warning names the missing members. The signing
pair is the loud exception: a key with no key id refuses seal and
publish and says so on every page rather than degrading quietly (the
table below has the detail).

Preflight reads only the shell environment it runs in. **Run off-stack,
it cannot see what compose wires in** — the three driver selectors,
`DATABASE_URL`, and the `S3_*` set live inside `docker-compose.yml` — so
a bare `node scripts/preflight-env.mjs` reports the *default managed
profile* and fails demanding variables the compose path never uses
(`BLOB_READ_WRITE_TOKEN` among them). To preflight a compose deployment,
represent the compose profile explicitly. Presence is what is
checked — no value is ever printed — so fixed stand-ins do for whatever
compose supplies, with **one exception**: `MODEL_API_BASE_URL` is
compared against the built-in default, because an endpoint that is not
the default needs a `MODEL_CATALOG` and the app refuses the query
without one. Give that variable its real value (or leave it unset for
the built-in endpoint); a stand-in would tier the catalog rows wrongly.
By the same token a PASS says nothing about the values it never read:
`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` pass on a placeholder
exactly as they pass on a real credential (see the tier notes below).
From the checkout, with your own env-file values also in the
environment (exported, or through your secret-manager wrapper):

```bash
DB_DRIVER=node-postgres BLOB_DRIVER=s3 EXECUTOR_DRIVER=container \
DATABASE_URL=wired-by-compose \
S3_BUCKET=wired-by-compose \
S3_ACCESS_KEY_ID=wired-by-compose \
S3_SECRET_ACCESS_KEY=wired-by-compose \
node scripts/preflight-env.mjs
```

The report then opens with the resolved profile and drops what that
profile never reads:

```
  PROFILE: db=node-postgres  blob=s3  executor=container
  (5 variable(s) not applicable to this profile — omitted)
```

(the five: `BLOB_READ_WRITE_TOKEN`, `SANDBOX_SNAPSHOT_ID`, and the three
`VERCEL_*` sandbox-auth variables). Exit code `0` means every required
variable for the profile is present; `1` otherwise. Run with the
stand-ins alone, it exits `1` naming exactly the fourteen operator-supplied
variables — `MODEL_API_KEY`, `SOCRATA_MCP_URL`, `RATE_LIMIT_SECRET`, `PUBLISHER_SIGNING_KEY`,
`PUBLISHER_KEY_ID`, the instance-identity set (`PUBLISHER_SITE_ORIGIN`,
`PUBLISHER_SIGNER_BINDING_TIER`, `PUBLISHER_SIGNER_IDENTIFIER`,
`PUBLISHER_SIGNER_DISPLAY_NAME`, `PUBLISHER_PLATFORM_AGENT_TITLE` — see
[Instance identity and signing](#instance-identity-and-signing-go-to-production)),
`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`.

**Read preflight's "required" tier honestly.** It is the
full-production bar, not the boot bar. Nothing on the list prevents the
process from *starting* — initialization is lazy throughout — so
"required" means a load-bearing request path fails without it. In
particular, a deliberate unsigned-tier bring-up **fails preflight**,
naming both halves of the signing pair and the sign-in variables: that
FAIL is your remaining go-to-production to-do list, not a broken stack.

The tiers, stated plainly:

**Wired by the compose stack.** Preflight's verdict on these is already
satisfied on the compose path with nothing in your env file — but wired
is not the same as handled, and the group splits two ways:

- *Constructed or literal — not yours without editing the compose file:*
  `DATABASE_URL`, `S3_ENDPOINT`, the three driver selectors.
- *Wired to a default your env file may override:* `S3_BUCKET`,
  `S3_PUBLIC_BASE_URL`, `EXECUTOR_CONTAINER_IMAGE` — and
  `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`, which you should.

**The object-store credentials are the one pair here that is a security
decision, not a convenience.** Their defaults are placeholders published
in this repository, and the compose file hands the same two values to
MinIO as its root user and password — so they are simultaneously the
app's access key and the object store's administrator login. An instance
that never sets them is serving record storage on credentials anyone
can read out of the repo: full administrative access for anything that
can reach the MinIO port. Set them in your env file (the template above
does) before that port is reachable by anything you do not control, and
prefer setting them before first bring-up — see the volume-reset note in
[Supplying your environment](#supplying-your-environment).

(Off compose, all of these are yours: `DATABASE_URL` plus the storage set
for your driver are hard requirements of the publish path. For `s3` that
set is `S3_BUCKET` plus the key pair, or `S3_BUCKET` alone where the
platform provides a role; see
[Credentials](#credentials-a-key-pair-or-the-sdks-default-chain).)

**The core query path fails without:**

| Variable | Absent means |
| --- | --- |
| `MODEL_API_KEY` | Every query fails fast with the typed error above. No fallback. Its prior-era name `OPENROUTER_API_KEY` still satisfies it. |
| `MODEL_CATALOG` / `MODEL_CATALOG_PATH` | Only when `MODEL_API_BASE_URL` names something other than the built-in endpoint, or `MODEL_API_KIND=azure-openai`: the instance refuses rather than trusting a model list written for a different endpoint. Under the built-in endpoint, absence is the configured state. |
| `RATE_LIMIT_SECRET` | Every query refuses, and so does the allowance read behind the request-limit banner (`/api/rate-limit`): a 503 (on `/api/compare-stream`, an error event per panel) with `code: "rate_limit_not_configured"` and a message naming this variable, before anything is counted, before any data source is asked and before any model call. `POST /api/query-notebook` under `EXECUTOR_DRIVER=none` still answers its 501 first. No fallback, and no key is ever derived from a default. **What it protects:** the per-day counter is stored under `rate:<segment>:<date>`, where the segment is HMAC-SHA256 of the reader's address (anonymous) or account id (signed in) under a day key, and the day key is HMAC-SHA256 of this secret and the date. No stored key carries the address or the account id, and a reader's segment changes every day, so a key read out of the counter store is no lasting handle on a reader. **The trade, stated:** anyone holding this secret can re-derive which stored key belongs to a given address on a given day; rotating it mid-day restarts that day's counts, because every key changes; and counter keys stored before this version, which carry the address or account id as written, are not rewritten but expire within 48 hours, the counter's own expiry (the in-process fallback store does not outlive the restart a deploy makes). Generate it once and set it through a pipe (`openssl rand -base64 32 \| vercel env add RATE_LIMIT_SECRET <environment>`), never on a command line. Environments that share one counter store share counts only when they share this value. Preflight checks presence only. It is never logged and appears in no record. |
| `SOCRATA_MCP_URL` | Every data query refuses with a typed error naming this variable. No fallback — this used to default to the project's hosted endpoint, which silently routed an unconfigured instance's queries through infrastructure it does not operate. Set it to the Socrata MCP deployment this instance should query. Pointing it at another operator's endpoint (the project's hosted one included) is a real choice, but understand what it means: your users' queries route through that host's infrastructure, not yours. **What it makes a signed record say:** for a run this instance makes (`captureMethod: "chat-flow-stream"`), the value exactly as set (not normalised: a bare host stays a bare host, with no `/mcp` appended) is the Socrata source agent's `civic:serverUrl` in the provenance graph, and under the datHere profile the `socrata` entry of `extensions["org.civicaitools.environment"].mcpServers`. All three MCP addresses are recorded as configured, so a deployment that points one at a container-internal name (a sibling service reached as `http://socrata-mcp:8000`, say) publishes that name in its signed records. A record of a run made elsewhere (a `claude-code-*` capture) takes no address from this instance's configuration. The addresses are the ones the RUN had: each query route writes them onto its trace (`analysis.mcp_servers`) when it runs, and the record states those, so a record published after a configuration change still names the values its run used (#495; a trace made before that change carried no such list, and its record names the values configured when it is packaged). |

**Absence disables a specific feature** (the app runs; the feature
doesn't):

| Variable(s) | Feature disabled when absent |
| --- | --- |
| `PUBLISHER_SIGNING_KEY` + `PUBLISHER_KEY_ID` + the instance-identity set (`PUBLISHER_SITE_ORIGIN`, `PUBLISHER_SIGNER_BINDING_TIER`/`_IDENTIFIER`/`_DISPLAY_NAME`, `PUBLISHER_PLATFORM_AGENT_TITLE`) | Record seal and publish. **All-or-nothing: every member is required, and none has a coded default.** With none set the instance stays in the unsigned tier (banner shows, seal and publish gated off) — and unsigned surfaces honestly *omit* instance attribution rather than substitute anyone else's. With the key set but no `PUBLISHER_KEY_ID` it refuses (`signing_key_id_missing`) rather than sign under a key id it never declared. With the pair set but the identity set incomplete it refuses (`instance_identity_missing`, naming the exact missing variables) rather than emit signed output carrying an origin, signer, or registry this instance never configured — either substitution would misattribute the publisher and fail verification. |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, and an OAuth app (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` or the `OIDC_*` set) | Sign-in — and with it the sign-in-gated notebook execution feature, the dashboard, and the higher authenticated rate limit. |
| `DATA_COMMONS_MCP_URL` + `DATA_COMMONS_API_KEY` | The Data Commons data source — its tool calls fail without the key (the hosted endpoint mandates it). `DC_API_KEY` is the separate key passed into *executed notebooks* for their own Data Commons requests. **What the address makes a signed record say:** for a run this instance makes, the value as set, or when unset the coded default (Google's public endpoint, in `src/lib/mcp/registry.ts`), is the `data-commons` entry of the datHere `mcpServers` list on every record, and the Data Commons agent's `civic:serverUrl` on a record whose run called a Data Commons tool. The record's `dataSources` entry for Data Commons keeps the packaging library's fixed portal value, that same public endpoint, whatever this is set to. The key is never recorded. |
| `BOSTON_OPENCONTEXT_MCP_URL` | The Boston OpenContext data source, which is opt-in. There is no coded default: unset (empty or whitespace-only counts as unset), the source is absent from every run — the model is not offered its six `boston__ckan__` tools, the system prompt carries none of its guidance (no Boston OpenContext block, preamble entry, citation instruction or line in the one-portal section), no request is sent to it, and no record lists it. A call to one of its tools anyway, such as a replay of a record that used them, is refused before anything is sent and recorded as a rejected call (`not_configured`). The public endpoint at `data-mcp.boston.gov` refuses every request that carries no bearer token, and this app sends none, so set this only to an OpenContext deployment that answers without one. **What it makes a signed record say:** set, for a run this instance makes, the value as set is the `boston-opencontext` entry of the datHere `mcpServers` list on every record, and the Boston OpenContext agent's `civic:serverUrl` on a record whose run called one of its tools; unset, the list has no `boston-opencontext` entry. |
| `NYC_CHARTER_HOSTING` | The hosted NYC Charter, Laws and Rules source, which is opt-in ([Hosted sources](#hosted-sources)). Only `sandbox` (trimmed) switches it on: the app runs the pinned package in a Vercel Sandbox it creates and offers the model its five `nyc_charter__` tools. Unset, the source is absent from every run: no tools, no guidance, no request, no sandbox. A call to one of its tools anyway, such as a replay, is refused before anything is sent and recorded as a rejected call (`not_configured`), naming this variable. Any other value leaves it off, and the preflight refuses the value, naming the variable and `sandbox`. Checked by the preflight only under the `vercel-sandbox` executor profile. **What it makes a signed record say, with it unset:** each record's `sourcesOffered` carries `{ "sourceId": "nyc-charter", "alias": "nyc_charter", "reason": "not-configured" }`. **With it set:** `configured`, the package by purl in `mcpServers`, and its pinned version (`0.3.1+b784cb763ec0`) in `components[]` ([Hosted sources](#hosted-sources)). |
| `NYC_CHECKBOOK_HOSTING` | The hosted NYC Checkbook source, which is opt-in ([Hosted sources](#hosted-sources)). Only `sandbox` (trimmed) switches it on: the app runs the pinned package in a Vercel Sandbox it creates, allowed to reach `www.checkbooknyc.com` only, and offers the model its ten `nyc_checkbook__` tools. Unset, the source is absent from every run: no tools, no guidance, no request, no sandbox. A call to one of its tools anyway is refused before anything is sent and recorded as a rejected call (`not_configured`), naming this variable. Any other value leaves it off, and the preflight refuses the value. Checked by the preflight only under the `vercel-sandbox` executor profile. A reader's first consent takes it as Ask first. **What it makes a signed record say, with it unset:** each record's `sourcesOffered` carries `{ "sourceId": "nyc-checkbook", "alias": "nyc_checkbook", "reason": "not-configured" }`. **With it set:** `configured`, the package by purl in `mcpServers`, and its pinned version (`1.6.3+f013a276e37e`) in `components[]`. |
| `NYC_RECORD_HOSTING` | The hosted NYC City Record source, which is opt-in ([Hosted sources](#hosted-sources)). Only `sandbox` (trimmed) switches it on: the app runs the pinned package in a Vercel Sandbox it creates, allowed to reach `data.cityofnewyork.us` only, and offers the model its seven `nyc_record__` tools. Unset, the source is absent from every run, and a call to one of its tools is refused naming this variable, as for the other switches. Any other value leaves it off, and the preflight refuses the value. Checked by the preflight only under the `vercel-sandbox` executor profile. A reader's first consent takes it as On. **With it unset:** `sourcesOffered` carries `{ "sourceId": "nyc-record", "alias": "nyc_record", "reason": "not-configured" }`. **With it set:** `configured`, the package by purl in `mcpServers`, and `1.1.0+6c52a5353381` in `components[]`. |
| `NYS_LEGISLATION_HOSTING` | The hosted NYS Open Legislation source, which is opt-in ([Hosted sources](#hosted-sources)). Only `sandbox` (trimmed) switches it on, and only with `NYS_LEGISLATION_API_KEY` set: the app runs the pinned package in a Vercel Sandbox it creates, allowed to reach `legislation.nysenate.gov` only, and offers the model its 24 `nys_legislation__` tools. Unset, or set with the key unset, the source is absent from every run, and a call to one of its tools is refused naming the switch (or, with the switch set, the key). Any other value leaves it off, and the preflight refuses the value. Checked by the preflight only under the `vercel-sandbox` executor profile. A reader's first consent takes it as Ask first. **With it unset:** `sourcesOffered` carries `{ "sourceId": "nys-legislation", "alias": "nys_legislation", "reason": "not-configured" }`. **With it set and the key set:** `configured`, the package by purl in `mcpServers`, and `2.4.0+cc069c46d52b` in `components[]`. |
| `NYS_LEGISLATION_API_KEY` | The key State legislation's server sends to the New York State Senate's Open Legislation API (registered at the Senate's page). Required when `NYS_LEGISLATION_HOSTING=sandbox`, and read by the preflight for presence only; unread otherwise. It goes into that one source's sandbox environment when the sandbox is created, beside the bridge token, and the server sends it in the request URL of every call to `legislation.nysenate.gov`. It is never logged, hashed or recorded. With the switch set and the key unset the source is not configured, and one log line names this variable. Set it through a pipe, never on a command line, once for all preview branches (the preview sandbox is shared). Changing it means deleting that source's sandbox ([Hosted sources](#hosted-sources)). |
| `SOURCE_BRIDGE_SECRET` | The instance secret each hosted source's bridge token derives from (HMAC-SHA256 of the sandbox's name). Required when any hosted source's switch (`NYC_CHARTER_HOSTING`, `NYC_CHECKBOOK_HOSTING`, `NYC_RECORD_HOSTING`, `NYS_LEGISLATION_HOSTING`) is `sandbox`; unread otherwise. Set it through a pipe (`openssl rand -hex 32 \| vercel env add SOURCE_BRIDGE_SECRET <environment>`), never on a command line, and use a different one per environment. It is never logged and appears in no record. Rotating it means deleting each hosted source's sandbox ([Hosted sources](#hosted-sources)). |
| `CRON_SECRET` | The scheduled blob-GC endpoint rejects every caller with 401 — orphaned uploads are never swept. Set the same value on the app and the scheduler. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Durable rate limiting — the counter falls back to per-process memory (resets on restart; not shared across instances). Fine for a single-node instance. Also needed by the consent pause: without the pair, a question cannot stop to ask about a source set to Ask first, and that source is not used ([The consent pause](#the-consent-pause)). |
| `SANDBOX_SNAPSHOT_ID` | (vercel-sandbox executor only) Prebuilt snapshot — absent, every execution pays a slow fresh boot + pip install. Not read by the container executor. A snapshot built under `@vercel/sandbox` 1.x boots under 3.x: measured on 2026-10-16 with 3.5.1, it booted Python 3.13.1 with the pinned stack importable. |
| `SOCRATA_APP_TOKEN` | Socrata API app token passed into executed notebooks — absent, requests run anonymously against Socrata's lower rate limits. Its value, and `DC_API_KEY`'s, never appears in a notebook output, a stream event or a record: both are removed by value (raw, URL-encoded and JSON-escaped, each replaced by `[NAME removed]`) from every executed notebook before it is streamed and from every notebook a publish request submits before the package is built. Under `EXECUTOR_DRIVER=lambda` the function's handler does the removal, so an instance on `lambda` gets it only when it rebuilds and redeploys its function image. |
| `EXECUTOR_DRIVER` set to `none` | Notebook mode, deliberately: the instance runs no notebooks. Unset is not this; unset is `vercel-sandbox`. The query form on `/ask` and the home page shows the notebook option disabled with its reason, signed in or not, and `/ask` starts in standard mode. `POST /api/query-notebook` answers 501, `code: "notebooks_not_offered"`, before the body is read, before any model call and before the rate limiter is charged. Standard mode is unchanged. Read at build and at run time: the prerendered home page follows the build's value. See [An instance that runs no notebooks](#an-instance-that-runs-no-notebooks-executor_drivernone). |
| `ROADMAP_RAW_URL` | `/roadmap` — absent, the page states that this instance has published no roadmap and the Roadmap link leaves the header and footer nav. An instance serves its own roadmap or none; there is no upstream fallback. |
| `SITE_DEFAULT_PORTAL` | The default portal a query runs against when the reader picks none. Absent, a run carries **no** default: the query form's "All portals" entry is what an unqualified question uses, the model names its own portal on each call, and every surface that would have named one omits it instead — the trace records no run-level portal, and a downloaded notebook's cover states only the portals its own calls named. Nothing breaks and nothing refuses (unless `SITE_PORTAL_LOCKED`, below, is on); the instance simply asserts no portal it was not told about. Set it to the open-data host this deployment is built around, as a bare hostname with no scheme (the same shape the `portal` tool argument takes). It has no coded fallback for the reason `SOCRATA_MCP_URL` has none: the value it replaced was one deployment's own city, written into the routes and components, and it reached the root span of a trace a publish carries into a signed record. **An instance fronting one portal sets this and the Socrata MCP server's `DATA_PORTAL_URL` to that same portal** (this one takes the bare host, the server's the URL, `https://<host>`). They are two defaults, not one: this is the portal a run names, and the server's is the portal that answers any call naming none — every `socrata__search` (`search` on the server), which takes no portal argument, and every `socrata__fetch` by a bare dataset id. Set to different portals, one run can name one portal while those calls are answered from another; with the server's unset, those calls are refused one at a time, and the run records each as a rejected call. |
| `SITE_PORTAL_LOCKED` | The one-portal switch, for Socrata portals. Absent, or anything but `1`/`true`, it is off and nothing above changes: a request may name any portal, and `SITE_DEFAULT_PORTAL` is only a default. **On, `SITE_DEFAULT_PORTAL` is the only Socrata portal this instance queries.** A query request (`/api/compare`, `/api/compare-stream`, `/api/query-notebook`) whose body names no portal, or `""`, runs on the configured portal; one naming that portal in any case or spacing runs on it too; one naming any other portal is refused with a 400 whose `error` names both portals. With the switch on and `SITE_DEFAULT_PORTAL` unset, every query is refused before the rate limiter and the skill fetch: the server log names `SITE_DEFAULT_PORTAL`, and the reader is shown the generic error copy (preflight marks `SITE_DEFAULT_PORTAL` required whenever the switch is on). Inside a run, a `socrata__get_data` call the model makes naming another portal (through `portal` or its alias `domain`), and a `socrata__fetch` whose identifier or URL names another portal, are refused before they are sent and recorded as rejected calls, and so are the same calls under the bare names `get_data` and `fetch` (both spellings are read; see [Tool names across sources](#tool-names-across-sources)): the record keeps the attempt, marked failed, and lists neither that dataset nor that portal among the sources accessed. The Socrata tool descriptions and the system prompt stop inviting other Socrata portals, and the query form drops its portal picker and its two cross-city examples. **What the switch does not govern:** `socrata__search` (`search`), which takes no portal argument and is answered by whichever portal the Socrata MCP server is configured for, and a `socrata__fetch` by a bare dataset id, which that server resolves the same way — so set the server's `DATA_PORTAL_URL` to the same portal (see the row above); code an executed notebook runs, including code written by the model (the switch governs the calls the model makes through its tools, not what a notebook cell requests); replay of a published record, which runs on the portal the record's own calls named, whether or not the record predates the switch; and the other data sources (Data Commons, and Boston OpenContext where `BOSTON_OPENCONTEXT_MCP_URL` configures it, which fronts the City of Boston's own open-data portal), which are separate servers taking no Socrata portal and stay callable with the switch on. Read at build and at run time, like `SITE_DEFAULT_PORTAL`: pass it in both places on a container build. |
| `ANSWER_LAYOUT` / `ANSWER_LAYOUT_PATH` / `ANSWER_LAYOUT_URL` | The answer view's default layout: the order of its parts, and of the sections behind its "Learn more" disclosure, on the comparison, the executed run and the record page. Absent, every surface renders the built-in `answer-first` v1, the payload of the specification's §8.14.1 example; the reader can switch to the built-in `envelope-order` v1 for the session with the toggle at the foot of the view, which reads "Shown under layout <name> v<N>". **Three forms:** `ANSWER_LAYOUT` holds the layout as a JSON document, the seven `content/layout/v1` payload fields (`name`, `version`, `appliesTo`, `order`, `disclosure`, `steps`, `rendererVersion`); `ANSWER_LAYOUT_PATH` names a file holding the same document; `ANSWER_LAYOUT_URL` names a published layout node: the URL of a node document, the commitment view with the signed `content/layout/v1` package inline that `scripts/publish-layout.ts` writes (see [Publishing the instance's default layout node](#publishing-the-instances-default-layout-node)). The node is fetched once per server process, when the server starts and when `next build` runs, parsed strictly (a repeated member name is refused) and verified: the package must recompute to its node id, its signature must verify, its type must resolve to `content/layout/v1`, and its key must be trusted by this instance's own trust registry or, failing that, by the registry the document declares, fetched over `https:` only. For the URL form, the registry check therefore proves only that the node's own declared registry holds its key (unless this instance's registry already does), so the trust decision is the URL the operator sets. Its seven fields are then taken as a configured layout's are. A node that fails any of these, or a URL that does not answer, is refused with the verifier's status: `next build` fails, and every page rendered at request time refuses, as for a malformed document; the instance never falls back to the built-in. Setting the URL beside either document form, or both document forms, is refused. A configured layout becomes the default and is offered first, beside the two built-ins; one that reuses a built-in's name and version with other fields is refused. Each layout is checked by building an unsigned layout node from it with the packaging library's builder, so it is accepted exactly when the builder accepts it, and refused with the builder's message, naming the variable. A part name the view does not know renders nothing, and the server logs one line naming it. **Which fields take effect in this release:** `name` and `version` (the foot line and the toggle), `order`, `disclosure.order`, `disclosure.label` and `disclosure.openByDefault`. `appliesTo`, `rendererVersion`, `steps.placement` and `steps.openByDefault` are checked and accepted, and do nothing yet: the layout applies to every record whatever its content profile, and the steps render in place and open. A part or section a layout does not name renders at its place in `answer-first`, so no part is dropped. **Read at build and at run time**, because the root layout resolves it for every page and the home page is prerendered: the home page follows the value `next build` saw, request-time pages the running server's. Pass it in both places on a container build (the compose file does). **A malformed setting is not a fallback:** `next build` fails at the first page it prerenders, and every page rendered at request time refuses (API routes do not render the layout), each with the message; a setting made malformed only at run time leaves the prerendered pages on the build's value. Prefer `ANSWER_LAYOUT` on a container build: `ANSWER_LAYOUT_PATH` must name a file readable where `next build` runs (in the image, a file in the build context that `.dockerignore` keeps, at its path under `/app`) and, at the same path, by the running server, which the runtime image does not carry unless the operator mounts it. **An instance sets its own in one line**, for example `ANSWER_LAYOUT='{"name":"my-order","version":1,"appliesTo":["default","datHere"],"order":["status","answer","steps","sources","citation","disclosure","actions"],"disclosure":{"label":"Learn more about how this analysis was produced","order":["A","B","C","D","E","G","signers","attestations","verification"],"openByDefault":false},"steps":{"placement":"beside","openByDefault":true},"rendererVersion":"answer-view/1"}'`. A layout changes no record's bytes: it is not stored in a record, and a record carries no reference to it. **The layout a record was published under:** a signing instance names its default layout node as `layoutNodeId` on every record's publication attestation (`attestation/publishes/v1`, spec §8.10.1) and in that attestation's row: with `ANSWER_LAYOUT_URL` set, the URL node; with no setting, a committed node under `public/.well-known/layouts/` whose fields equal `answer-first` v1's and which this instance's own signing key signed (the key derived from `PUBLISHER_SIGNING_KEY` and the kid `PUBLISHER_KEY_ID`, not the signer claim or the registry); with `ANSWER_LAYOUT` or `ANSWER_LAYOUT_PATH` set, or no such node, none, and the attestation is the one built before layouts were named. The record page says "Published under layout <name> v<N>; shown under layout <name> v<M>" when the attestation names a node the site holds under another name or version than the one shown, and adds "This site does not hold the layout this record was published under." when it names one the site does not hold. |
| `SOURCE_ROUTING` | In-loop routing ([In-loop routing](#in-loop-routing)). Unset, or `all-sources`, the first request carries the guidance and the tools of every source the run is offered, as every run did before the variable existed, and the record has no `routing` or `definitionHash` key. `in-loop` sends a directory and one tool, `load_source`, and a source's guidance and tools after the model loads it. Any other value runs as `all-sources`, and the server logs one line naming the variable and its two values, never the value. The preflight refuses such a value, naming both. |
| `SITE_SEAL_ONLY` | The seal-only switch, for an instance that seals records and never makes one public. Absent, or anything but `1`/`true` (any case, surrounding spaces ignored), it is off and nothing changes. **On, the public state is unavailable on this instance.** `POST /api/records` refuses a request for it with a `403` whose `code` is `seal_only` and whose reason names `"sealed"` as the value the instance accepts: `visibility: "public"`, its legacy alias `"published"`, and a body that omits `visibility`, which asks for the public state by default. `"sealed"` (and its alias `"committed"`) works as before. `POST /api/records/:slug/publish`, which promotes a sealed record to public, is refused with the same code. Both refusals come before anything is stored, signed or written, and the promotion's comes before the record is looked up, so it says nothing about whether a record exists. The publish dialog shows its "Publish now" choice disabled, with the reason in place of its description, and the dashboard shows Publish on a sealed record disabled with the reason rather than hiding it. **Records already public stay public and readable:** publication is not reversible (spec §8.10.3), so the switch governs what happens next and changes nothing already published; an instance that must hold no public record sets it before its first publish. Read at run time only, by the two publish routes, the signing-status route the dialog asks, and the dashboard page: pass it to the running server (the compose app service passes it through). It is not a build arg. |
| `SITE_BRAND_NAME`, `SITE_BRAND_TAGLINE`, `SITE_BRAND_ATTRIBUTION`, `SITE_BRAND_REPO_URL`, `SITE_SPONSOR_NAME` | The chrome surfaces that would *name, credit, or fund a deployment*. Absent, each one renders nothing rather than the reference deployment's version of it — page titles drop their brand suffix, citations name no publisher, the header wordmark reads "Home", and the footer's tagline, attribution, repo link and sponsor line are simply not there. Nothing breaks; the site is anonymous until you name it. See [Branding and theming](#branding-and-theming-chrome-only). |

**Merely overrides a default.** Everything else, including:
`MODEL_API_BASE_URL` (endpoint override), the *derived* identity
overrides (`PUBLISHER_PUBLICATION_HOST`, the two emit-side registry-URL
overrides `PUBLISHER_TRUST_REGISTRY_CANONICAL_URL` /
`PUBLISHER_TRUST_REGISTRY_LEGACY_URL`,
`PUBLISHER_PLATFORM_AGENT_ID`, `PUBLISHER_PLATFORM_AGENT_URL` — each
derives from the required identity set above when unset: host and URLs
from the origin, the agent id from the host; the *required* identity set
itself is in the disable-when-absent table, not here — see
[`docs/instance-setup.md`](instance-setup.md)),
`SITE_BRAND_ACCENT` and `SITE_SPONSOR_URL`/`SITE_SPONSOR_PREFIX`
(a palette and a preposition are not identity claims, so those three do
have defaults; the rest of the chrome set is in the disable-when-absent
table above — see [Branding and
theming](#branding-and-theming-chrome-only) below), `OIDC_PROVIDER_NAME`
(button label), `SIGN_IN_ALLOWLIST` (unset or empty = open sign-in,
exactly the pre-allowlist behavior; see the sign-in section),
the host-topology set (`APP_HOST`, `MARKETING_HOST`, `SERVE_MARKETING`,
`APP_ONLY` — `SERVE_MARKETING` is the one variable whose unset state is
the correct state for an instance; see [Usable, not just
built](#usable-not-just-built) for what an unset topology gates and
[Host topology](#host-topology-optional) for the full variable set),
`SITE_NOINDEX` (unset/empty = indexable, the standard web default; see
[Indexing](#indexing-optional)),
the remaining content-source overrides (`DIRECTORY_DATA_URL`,
`ROADMAP_GITHUB_URL` — with `DIRECTORY_DATA_URL` unset, `/directory`
serves the shared community index with attribution; `ROADMAP_GITHUB_URL`
is derived from `ROADMAP_RAW_URL` when unset. `ROADMAP_RAW_URL` itself is
in the disable-when-absent table above, not here; see
[Content sources](#content-sources-directory-and-roadmap)),
rate-limit and token-budget tuning knobs
(`ANONYMOUS_RATE_LIMIT`, `AUTHENTICATED_RATE_LIMIT`,
`APP_TIER_RATE_LIMIT`, `TOKEN_LIMIT_PER_REQUEST`,
`MAX_TOOL_RESULT_CHARS` — read on the streaming query path only; the
replay and `/api/compare` callers pass a fixed 50,000, so setting this
variable does not change what they feed the model (website#358)),
`S3_REGION` / `S3_FORCE_PATH_STYLE` / `S3_PUBLIC_BASE_URL` (coded
defaults described in the storage section),
the two signing-service addresses (`TIMESTAMP_AUTHORITY_URL`,
`TRANSPARENCY_LOG_URL` — unset, each request goes to the public service
it has always gone to; see [Outbound destinations the signing leg
needs](#outbound-destinations-the-signing-leg-needs) for both defaults,
what they are for, and what substituting one does not buy you),
the three egress-proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`,
`NO_PROXY` — unset, no dispatcher is installed and every request leaves
by the path it always did; see [Outbound traffic through an egress
proxy](#outbound-traffic-through-an-egress-proxy) for which outbound
kinds honour them, which do not, and why loopback is always exempt),
and page analytics (`NEXT_PUBLIC_ANALYTICS_SERVICE`,
`NEXT_PUBLIC_ANALYTICS_ID`, and the prior-era
`NEXT_PUBLIC_GA_MEASUREMENT_ID` — unset, no tag; see
[Analytics](#analytics-optional)).

**Retired:** `PUBLISHER_TRUST_REGISTRY_URL` (prior era:
`EVIDENCE_TRUST_REGISTRY_URL`) used to sit in this list — the verify-side
consume override, distinct from the two emit-side registry-URL overrides
above. civic-ai-tools#155 P1 measured the HTTP fetch it fed as dead code on
every real call path, and civic-ai-tools#155 P1b retired the variable and
that fetch outright. See
[`docs/key-rotation.md`](key-rotation.md#environment-variables) for the
full history.

One build-time caveat: `NEXT_PUBLIC_*` values are inlined into client
bundles at build time, so a run-time pass-through cannot change them —
they belong to the image build. On the compose path that is not a second
mechanism to arrange: they are declared as `build.args` and resolved from
the same env file, so `docker compose --env-file … up -d --build`
delivers them. A restart without `--build` does not. The analytics
variables are among them: a tag appears, changes or goes away only at the
next build, on the compose path and on a hosted platform alike.

### Branding and theming (chrome only)

These variables rebrand the site chrome — and only the chrome. Nothing
here touches an emitted record package: the values that name your instance
*inside signed packages* are the `PUBLISHER_*` set
([`docs/instance-setup.md`](instance-setup.md)), and the two sets are
read independently so a chrome change can never invalidate a package or
a registry cross-check. They resolve in
[`src/lib/brand-config.ts`](../src/lib/brand-config.ts), except the
sponsor line, which is in
[`src/lib/site-config.ts`](../src/lib/site-config.ts).

**Unset names nobody** (civic-ai-tools-website#259). Every value here
that could name, credit, or fund a deployment has *no default*: unset,
the surface renders nothing rather than the reference deployment's
version of it. Until #259 these fell back to civicaitools.org's own
strings on a byte-parity argument, which held while the marketing face
and the app were one deployment and stopped holding the moment an
unconfigured instance served the app surface on its own. The reference
deployment now sets them explicitly like any other instance.

| Variable | Meaning | Unset |
| --- | --- | --- |
| `SITE_BRAND_NAME` | Display name in chrome: the header wordmark, the page `<title>`s, and the "… Record Package" citation labels. Prose *about* the reference project (the About/Project pages) is content, not chrome, and does not follow this variable. | Page titles drop their brand suffix, citations name no publisher, and the header wordmark reads "Home" — a navigation label, not a name. |
| `SITE_BRAND_ACCENT` | Accent color as `#rgb`/`#rrggbb`. Overrides the accent tokens (`--accent` and companions in `src/app/globals.css`) via one inline style on `<html>`; every accent-colored surface follows. The darker hover and lighter fill companions are derived from this one value. Invalid values are ignored — the stylesheet default renders. Semantic status colors (success green, caution amber, error red) are governed by `docs/design-principles.md` and are deliberately NOT themable. | The stylesheet default renders (`#103FEF`). A palette is not an identity claim, so this one still has a default. |
| `SITE_BRAND_TAGLINE` | The footer's first identity line, and the default page description. | No tagline line, and no `<meta name="description">` default. |
| `SITE_BRAND_ATTRIBUTION` | The footer's attribution line, as plain text — who runs this deployment. | No attribution line at all. |
| `SITE_BRAND_REPO_URL` | Where the footer's "GitHub" link points — *your* source repository. | No repo link. It is a contribution funnel, and sending your users into another project's issue tracker helps nobody. |
| `SITE_SPONSOR_NAME` | A sponsor acknowledgment in the footer and on `/about`: "{prefix} {name}." | No sponsor line. |
| `SITE_SPONSOR_URL` | Where the sponsor's name links. | The name renders unlinked. |
| `SITE_SPONSOR_PREFIX` | Wording in front of the name. | `Fiscally sponsored by` — generic phrasing that names a *relationship*, and only ever renders beside a name you configured. |

Set these **in the build environment as well as at run time**.
Statically prerendered pages bake their chrome at `next build` (the
same server-side seam behavior as the host-topology variables), while
dynamic pages read the runtime environment — with the variables present
in both, every page agrees. On the compose path that is one file and one
command: they appear in both the app service's `build.args` and its
`environment`, resolved from your `--env-file`, so a bring-up with
`--build` supplies both sides at once
([Build time versus run time](#supplying-your-environment)). None of
these are `NEXT_PUBLIC_*`, and none may become so: client inlining is
exactly what would break runtime container configuration for the dynamic
pages.

The favicon is a file, not a variable: replace
[`src/app/favicon.ico`](../src/app/favicon.ico) in your checkout (the
App Router serves it at `/favicon.ico`) and rebuild.

### Content sources (directory and roadmap)

These three variables tell the two content pages where *your* content
lives. All are resolved in
[`src/lib/site-config.ts`](../src/lib/site-config.ts), and unset means
one thing only: this instance has no content source of its own
(civic-ai-tools-website#241). No variable here falls back to another
project's roadmap, and the reference deployment at civicaitools.org sets
them explicitly like any other instance.

| Variable | Meaning | Unset |
| --- | --- | --- |
| `DIRECTORY_DATA_URL` | `/directory` data source — a JSON array matching the `McpServerEntry[]` shape in [`src/lib/mcp/directory-data.ts`](../src/lib/mcp/directory-data.ts). | The page serves the shared community index (the civic-ai-tools hub repo's `data/mcp-servers.json`) with a visible line attributing it to that project. |
| `ROADMAP_RAW_URL` | `/roadmap` data source — raw Markdown. | `/roadmap` says this site has not published a roadmap, and the Roadmap link leaves the header and footer nav. |
| `ROADMAP_GITHUB_URL` | Where `/roadmap`'s "Renders from …" byline links. | Derived from `ROADMAP_RAW_URL` — a GitHub raw URL resolves to its file page. The byline's visible label is derived from whichever URL it links to, so label and link cannot drift apart. |

**Why the two pages differ.** A curated index of public MCP servers is a
shared community resource: it is useful to any instance, so an
unconfigured `/directory` keeps serving it and says whose it is. A
roadmap is first-person — "our plans" — so another project's roadmap
under your brand is wrong even when attributed, and an unconfigured
`/roadmap` presents none. The route stays reachable and explains how to
configure it; only the nav entry disappears.

If your directory source cannot be fetched, the page falls back to the
`directory-fallback.json` snapshot checked into this codebase and says
so. That snapshot is a copy of the community index, so an instance that
wants nothing upstream in its directory should supply both its own
`DIRECTORY_DATA_URL` and its own snapshot.

Set these **in the build environment as well as at run time**: both
pages prerender with 1-hour ISR, so a change takes effect on the next
build or revalidation, not immediately. As with the branding set,
compose passes them at both times from your one `--env-file` when you
bring the stack up with `--build`.

These three are content, not chrome or publisher identity: unlike the
branding set above they only change what `/directory` and `/roadmap` fetch
and link to, and unlike the `PUBLISHER_*` set they are never emitted inside
a signed record package.

### Consent surfaces (optional)

Two settings the consent card, the Sources panel, the dashboard's Sources tab,
`/api/flows` and the privacy page read (#632 W3; see
[Consent and the flows statement](#consent-and-the-flows-statement)). Both
are this instance's own: a fork fills in its own, or leaves them unset.

| Variable | Meaning | Unset |
| --- | --- | --- |
| `SITE_DEPLOYMENT_GUIDE_URL` | The public address of the guide a reader follows to run this whole system on their own computer, with their own model and data sources. Each consent surface links it after the local-only offer, and `/api/flows` carries it as `links.deploymentGuide`. | Each surface says "This site does not name a deployment guide.", and `/api/flows` carries that sentence as `links.deploymentGuideOmitted`. The preflight lists it absent under OPTIONAL and refuses nothing. |
| `SITE_OPERATOR_STATES_NO_TRAINING` | `1` or `true`: this operator states that the model endpoint is set to send questions only to providers that do not train on them. The card's endpoint row and the privacy page's "The model endpoint" section then say so, as the operator's statement, and say the site cannot read that setting. It covers training only, never retention. Set it only if your endpoint account is set that way. | Nothing is said about the endpoint's providers: the card's endpoint row stays as derived ("for this site's operator to state"), and the privacy page has no "The model endpoint" section. |

### Analytics (optional)

Two variables choose a page-analytics service. Both are read at build.

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_ANALYTICS_SERVICE` | `google-analytics` or `plausible`. |
| `NEXT_PUBLIC_ANALYTICS_ID` | The id the service gave this site. For `google-analytics`, the GA4 measurement id (`G-…`). For `plausible`, the site's script key (`pa-…`), shown in the site's settings with its installation snippet; it names the script file. It is not the site's domain: only the vendor's older script took a domain. |

**Unset means none.** With neither set, the root layout renders no
analytics tag, and no reader's browser is asked to contact any analytics
service. Set both or neither. One without the other renders nothing, and so
does a service outside the two above. Preflight
(`node scripts/preflight-env.mjs`) names either problem: an unknown service
fails the run, naming the variable and the accepted values without printing
what was set, and half of the pair is reported as an incomplete group.
Empty counts as unset for both names.

**What each renders**, on every page the root layout renders, loaded once
the page is interactive:

- `google-analytics`: the Google tag from
  `https://www.googletagmanager.com/gtag/js?id=<id>` and its initializer.
- `plausible`: the vendor's snippet, an async script from
  `https://plausible.io/js/<id>.js` and a two-line initializer (read
  2026-10-17 from the vendor's installation instructions).

**What each collects, whether it sets a cookie, and where the data goes.**
Read 2026-09-20 from each vendor's own privacy and data-policy pages. A
vendor can change these; read its current pages before you choose.

| Service | What it collects | Identifier | Cookie | Where the data goes |
| --- | --- | --- | --- | --- |
| `google-analytics` | Events, user agent, referrer; optional cross-device signals | A client id in a first-party cookie, not rotated | Yes: `_ga`, two-year default | Google, US |
| `plausible` (the vendor's cloud) | Page views, referrer, derived device, goals | A hash of a daily salt, the domain, the IP address and the user agent; the salt is deleted every 24 hours | None, and no local storage | The vendor, an Estonian company; EU-hosted |

**Published-record URLs carry title words.** A tag reports the address of
every page it loads on, and a record's address is
`/records/{title-slug}-{hash}`: up to 80 characters of the record's title,
lower-cased, then a short hash of its package
([`src/app/api/evidence/route.ts`](../src/app/api/evidence/route.ts)). So
the words of every published record's title that a reader opens reach the
analytics service with that page view.

**The prior-era variable.** `NEXT_PUBLIC_GA_MEASUREMENT_ID` was the one
analytics variable before these two, and it is still read, as its own
variable and not as an alias. When both new names are empty, a non-empty
`NEXT_PUBLIC_GA_MEASUREMENT_ID` means `google-analytics` with that id, so
an instance that set it keeps its tag with nothing to change. When either
new name is set, the new pair alone decides, and the prior-era id is not
read. To move to the pair, set `NEXT_PUBLIC_ANALYTICS_SERVICE` to
`google-analytics` and `NEXT_PUBLIC_ANALYTICS_ID` to the same id.

**A change needs a rebuild.** All three are inlined at `next build`, so a
run-time value changes nothing. On the compose path they are `build.args`,
delivered by `docker compose --env-file … up -d --build`; on a hosted
platform, set them in the build environment and redeploy.

The app shows no consent notice for either service. Whether one is needed
depends on the service and on where the readers are, and is the operator's
to decide.

## Sign-in configuration

Sign-in is what unlocks the executed-notebook feature, the publisher
dashboard, and the higher authenticated rate limit. It needs three
things: a session secret, your public origin, and at least one OAuth
provider you register yourself.

Always:

| Variable | Meaning |
| --- | --- |
| `NEXTAUTH_SECRET` | Session encryption secret. Generate one: `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | The origin browsers actually use — OAuth callbacks are built from it, so it tracks where the instance is reachable *now*, not where it is going. On the loopback bring-up that is `http://localhost:3000` (also the compose default); it becomes your public origin (e.g. `https://records.example.org`) when the instance is served from one. |

Then one (or both) of:

**GitHub OAuth app.** Register an OAuth application with your GitHub
account (Settings → Developer settings → OAuth Apps). Set its
authorization callback URL to:

```
<your origin>/api/auth/callback/github
```

and supply `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. The provider
appears only when both are set — with either half absent, the GitHub
button is simply not rendered rather than rendered broken, and preflight
demotes the pair from required to optional once the OIDC triple below is
complete (an instance needs *a* working provider, not this one).

**Generic OIDC provider.** Any provider that supports standard OIDC
discovery (`/.well-known/openid-configuration`) works — an enterprise
IdP, Keycloak, etc. The provider appears only when all three of
`OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` are set;
`OIDC_PROVIDER_NAME` labels the sign-in button (default "SSO"). Register
the client with redirect URI:

```
<your origin>/api/auth/callback/oidc
```

The flow requests `openid profile email` scopes and uses PKCE + state.

Treat `OIDC_ISSUER` as **identity-bearing, not just configuration**: the
issuer URL is embedded in every OIDC user's stored account key
(`oidc:{issuer}:{sub}` — the same string the allowlist matches), so
changing or unsetting it later silently re-keys every OIDC user into a
fresh database row on their next sign-in. Existing allowlist entries
stop matching, and each user's earlier activity stays bound to the old
row. Pick the issuer value once, before real users sign in.

**Restricting who may sign in (optional allowlist).** By default any
account the active provider authenticates may sign in. To gate an
instance, set `SIGN_IN_ALLOWLIST` to the permitted provider-account
keys — the same strings the users table stores: the GitHub numeric
account id for GitHub sign-ins, `oidc:{issuer}:{sub}` for OIDC
sign-ins. Entries are separated by commas and/or whitespace, so a
multi-line value in a secret manager works as well as a one-line list.
Unset or empty means open — an instance that has never heard of the
variable behaves exactly as before the gate existed. A refused account
gets NextAuth's built-in Access Denied page and leaves no user row
behind. On a gated instance, signed-in users draw their daily quota
from `APP_TIER_RATE_LIMIT` instead of `AUTHENTICATED_RATE_LIMIT`; its
default is the authenticated limit itself, so leaving it unset changes
nothing.

Before any browser test, check what the instance advertises:

```bash
curl -s http://127.0.0.1:3000/api/auth/providers
```

It lists each active provider with the exact `signinUrl` and
`callbackUrl` the instance built from `NEXTAUTH_URL` — and the OIDC
provider appears only when all three `OIDC_*` variables are set, so a
half-configured provider shows up here as simply missing. One caveat to
internalize: a wrong `NEXTAUTH_URL` produces a perfectly *healthy*
instance advertising unreachable callback URLs — nothing warns; this
endpoint is where it becomes visible.

Then verify by completing a sign-in round-trip in a browser against your
deployed origin — a misconfigured `NEXTAUTH_URL` typically surfaces as a
callback-URL mismatch error from the provider. Signed-in users are
recorded in the instance's own database on first sign-in.

## Host topology (optional)

**Every variable in this section is optional. An instance that sets none
of them serves the app surface only** — the marketing pages return 404
and `/` redirects to `/ask`. That is the portable default, and for most
instances it is also the finished configuration: nothing here needs to be
set at all.

The marketing site — the home page, `/about`, `/explore`, `/learn`,
`/project`, `/roadmap`, `/directory`, and the talk decks under `/talks` —
is the reference deployment's own website, not part of what an instance
is expected to publish. It is
withheld by **configuration, never by deleting files**, so your instance
stays cleanly `git pull`-able from upstream; the pages remain in the tree
and simply do not serve.

Set the variables below to serve that marketing face anyway, or to split
it onto a separate host from the gated app surface. The decision logic
lives in `src/lib/host-routing.ts` (unit-tested; `src/proxy.ts` is a thin
adapter over it).

| Variable | Required? | Meaning |
| --- | --- | --- |
| `APP_HOST` | Optional — unset means no host is named | The host that serves the gated app surface. On it, `/` redirects (307) to `/ask` — the signed-in query surface — the marketing pages return 404, and `/ask`, the dashboard, device pairing, and the record routes all serve. |
| `MARKETING_HOST` | Optional — unset means no host is named | The host that serves the public face. On it, the marketing pages and the public record registry serve exactly as on a single host, and the app-private routes — `/ask`, `/dashboard`, `/auth/device`, `/dev/notebook-preview` — return 404. |
| `SERVE_MARKETING` | Optional — **leave it unset** | `1` or `true`: hosts matching *neither* variable above serve everything, marketing pages included. Unset, those hosts get the app surface only. Governs unnamed hosts and nothing else: a host you *have* named behaves identically either way. |
| `APP_ONLY` | Optional — rarely needed | `1` or `true`: every request on every host gets the app-surface behavior, and `APP_HOST`/`MARKETING_HOST` are ignored entirely. Redundant with the default unless you have named a marketing host and want to override it. |

`SERVE_MARKETING` is the one variable here whose **unset state is the
correct state for an instance**. It exists for the reference deployment
and for anyone deliberately republishing the marketing pages; if you are
standing up your own instance, do not set it, and the marketing site
stays withheld with no further action.

Values for the two host variables are host names (`app.example.org`); a
full origin (`http://localhost:3000`) is also accepted, and matching is
case-, port-, and `www.`-insensitive. Four properties worth
internalizing:

- **Named hosts claim their role; unnamed hosts take the default.** A
  host you named behaves exactly as its row above says, and nothing else
  changes that. A request on a host matching *neither* variable — a
  preview deployment, a health check by IP, an alias you have not named —
  gets the app surface, unless `SERVE_MARKETING` says otherwise. This
  reverses the previous behavior, under which an unnamed host was served
  exactly as if no topology were configured, so it changes what an
  **incremental rollout** looks like. The sequence is now:

  1. Set `SERVE_MARKETING=1` **first**. Every host you have not named
     keeps serving everything, which is what makes the following steps
     verifiable one at a time.
  2. Set `APP_HOST` and verify the app host in isolation — the apex is
     still unnamed, so it is unaffected.
  3. Set `MARKETING_HOST` to switch on the withholding there, and verify
     the split.
  4. Decide about `SERVE_MARKETING`. Keep it if you want preview
     deployments and unnamed aliases to serve the full site; drop it to
     have every host but the two you named behave as the app surface.

  Skipping step 1 is not dangerous, but it means the apex starts
  withholding its marketing pages the moment you deploy, before you have
  had a chance to verify anything on the app host.
- **The record registry is dual-served on purpose.** `/records` and
  `/records/<slug>` — together with their permanent prior-era aliases
  `/evidence` and `/evidence/<slug>` (spec Appendix J) — are public
  product surface; published links must keep resolving on the public
  face, and the app surface serves them too. `/api/*`, `/.well-known/*`, and static assets likewise serve on
  every host.
- **Withholding is topology, not security.** The 404s shape which host
  presents which surface; access control is sign-in
  (`SIGN_IN_ALLOWLIST`) and the per-route session checks, which apply
  identically on every host. `/ask` is the visible case: a signed-out
  visitor gets a sign-in prompt there rather than a redirect, on any
  host that serves it.
- **The chrome follows the routing.** Whether the instance serves a
  marketing surface at all is derived from these same variables, so the
  header nav's marketing links, the footer funnels, and the app
  surface's "Public site" exit link hide themselves on an instance that
  serves no marketing face, rather than pointing at pages that would
  404. Nothing extra to configure — but it does mean that setting
  `SERVE_MARKETING` changes the chrome as well as the routing, in step
  with each other.

Two notes on host spellings. A request that matches a configured host but
spells it with the other `www.` form is 307-redirected to the spelling
you configured (`/api/*` and `/.well-known/*` are exempt, so cross-origin
verifier fetches are never broken by a redirect). Unnamed hosts are never
steered anywhere, since there is no configured spelling for them to be
steered toward — that holds under the app-surface default just as it did
when unnamed hosts passed through. And a follow-up worth recording rather
than doing now: **if indexing is ever enabled on a host that has aliases,
add `<link rel=canonical>` at that point.** No `rel=canonical` work is
warranted while `SITE_NOINDEX` is set, since search-engine
canonicalization is moot for a site that disallows crawling outright.

Two split-host interactions to plan for: `NEXTAUTH_URL` can point at
only one host, and sessions are per-host cookies — decide which host
users sign in on (for a gated app surface, normally the app host) and
point `NEXTAUTH_URL` and your OAuth callback URLs there. The
device-pairing URL the API hands to CLI clients already follows
`APP_HOST` when it is set, since `/auth/device` is withheld on the
marketing host.

Two split-host behaviors follow automatically from the same variables
(no additional configuration):

- **Same-origin writes work from both hosts.** Browser POSTs that guard
  with an Origin check (device approval, token revocation) accept any of
  the instance's own origins — `NEXTAUTH_URL`, `APP_HOST`,
  `MARKETING_HOST` — not just `NEXTAUTH_URL`, so approving a device from
  the app host works even when `NEXTAUTH_URL` names the marketing host.
  With no topology set the accepted origin is `NEXTAUTH_URL` alone,
  exactly as before.
- **The marketing header is session-aware.** `GET /api/session-status`
  returns `{"signedIn":…}` — a boolean, never user data — and grants
  CORS to exactly one origin: the configured marketing origin. After
  hydration the marketing host's header probes it (silently; any
  failure keeps the signed-out control) and shows "Open app →" instead
  of "Sign in" for a visitor who already has a session on the app host.
  With no marketing origin configured the endpoint emits no CORS
  headers at all and no probe ever fires.

## Indexing (optional)

By default an instance is indexable — no `robots.txt` disallow, no noindex
page metadata — the standard web default. Every instance used to hardcode
the opposite: a permanent `Disallow: /` and `robots: { index: false, follow:
false }`, undocumented, with no way to opt in (#258 finding E1, owner ruling
G0-3). One variable now controls it.

| Variable | Meaning |
| --- | --- |
| `SITE_NOINDEX` | `1` or `true`: this instance blocks crawler indexing. `robots.txt` (`src/app/robots.ts`) disallows every path for every user agent, and the root layout's page metadata (`src/app/layout.tsx`) carries `index: false, follow: false`. Unset/empty: `robots.txt` explicitly allows every path and no robots metadata renders at all. |

Both surfaces resolve through one shared, unit-tested core
([`src/lib/site-indexing.ts`](../src/lib/site-indexing.ts)) so they cannot
disagree — there is no way for `robots.txt` to allow indexing while the page
metadata says otherwise, or vice versa. This is chrome/ops configuration,
like the host-topology and branding sets above: it is never emitted into
signed record output, and no signing or verification path reads it.

`robots.txt` is a dynamic metadata route, not a static file — a static
`public/robots.txt` would shadow the route entirely, which is why the old
one was deleted rather than left in place. It forces per-request evaluation
(`export const dynamic = 'force-dynamic'`) specifically so the platform
reads the live server environment on every request rather than caching a
build-time snapshot of whichever value `SITE_NOINDEX` happened to hold at
build.

The page metadata half does not have that option — it is baked at `next
build` for every statically prerendered page, the same build-time-plus-
runtime caveat documented in [Branding and
theming](#branding-and-theming-chrome-only) and in [Environment reference,
tier by tier](#environment-reference-tier-by-tier)'s "One build-time
caveat" note for `NEXT_PUBLIC_*` values above (this variable is not
`NEXT_PUBLIC_*`, but the same "prerendered pages bake it, dynamic pages
read it live" split applies). Set `SITE_NOINDEX` **in the build environment
as well as at run time** if you want the page metadata to agree with
`robots.txt` on every route, including statically prerendered ones. On the
compose path that is the usual one-file, one-command story: `SITE_NOINDEX`
appears in both the app service's `build.args` and its `environment`,
resolved from your `--env-file`, so `docker compose --env-file … up -d
--build` supplies both sides at once.

## Database and migrations

Schema migrations are ordinary [Drizzle](https://orm.drizzle.team)
numbered SQL under [`drizzle/`](../drizzle/). Three application paths,
same files:

- **Compose path (automatic).** Every `docker compose up` runs the
  one-shot `migrate` service — `drizzle-kit migrate` against the stack's
  `DATABASE_URL` — *before* the app starts (the app `depends_on` its
  successful completion). First boot therefore always runs on a fully
  migrated schema, and re-running is safe: applied migrations are
  skipped.

- **Direct path (fork operators, external databases).** From the
  checkout — after a one-time `npm install`, so the repository-pinned
  `drizzle-kit` is what executes — with `DATABASE_URL` pointing at your
  database:

  ```bash
  npx drizzle-kit migrate
  ```

  Run it before first app boot, and again after pulling a version that
  adds migrations.

- **Its own container (managed platforms).** The image already carries
  the target: `docker build --target migrate .` produces a one-shot
  container whose command is `npx drizzle-kit migrate`
  ([`Dockerfile`](../Dockerfile), the `migrate` stage). It is the build
  stage with a different command, so it needs no separate image, no
  separate build and no separate version — the migrator and the service
  are the same artefact.

  Run it as an ordinary container with one variable set:

  ```bash
  docker run --rm -e DATABASE_URL=postgres://… ghcr.io/you/civic-app-migrate:TAG
  ```

  **`DATABASE_URL` is the only variable it reads.** No signing key, no
  object store, no model endpoint: this container does one thing.

### Migrations as their own container

The third path above is what a managed platform wants, and it is worth
stating what such a platform has to express, because the property the
pattern depends on is not "the migrator ran" but "the migrator
*finished*, successfully, first."

- **An additional container in the same unit of deployment**, built from
  this repository's `migrate` target, carrying the same image tag as the
  service container.
- **Ordered before the service container**, with the service gated on
  the migrator's **successful completion** — not merely on its having
  started. Platforms spell this differently (a container that must run
  to completion first, or a dependency condition on the other container
  in the same unit); the deployment has to express whichever of those it
  offers. Compose expresses the same thing with
  `depends_on: { migrate: { condition: service_completed_successfully } }`,
  which is [`docker-compose.yml`](../docker-compose.yml)'s `app` service
  today.
- **Nothing else.** No shared volume, no ordering with the database
  beyond the database being reachable, no second image.

**Gating on successful completion is meaningful, measured.** Driven on
2026-09-20 against the image's `migrate` target, run as one bare
container against a throwaway PostgreSQL 17 — no compose file, no
`depends_on`, no other service:

| What was given | Container exit |
| --- | --- |
| A reachable database | `0`, and 17 rows in `drizzle.__drizzle_migrations` read back from the database |
| A wrong password | `1` |
| An unreachable host | `1` |
| `DATABASE_URL` unset | `1`, naming the missing parameter |

A second run against the already-migrated database also exited `0` and
left the journal at 17 rows, which is the property a platform that
re-runs the migrator on **every** deploy depends on.

**The read-back rule still applies, and it is not a formality.** The
run above selected drizzle-kit's `pg` driver, on which the failures
above are loud. A database reached through a serverless driver is the
case where a clean exit is *not* proof that anything was applied —
[`docs/db-migrations.md`](db-migrations.md) carries that trapdoor and
the query that surfaces it. Read the schema back from the database after
a migrating deploy, whichever path applied it.

### The visibility-rename pair: `0014` + `0015`

Two migrations implement the visibility-label rename (`committed` →
`sealed`, `published` → `public`, per [ADR-0016] §A) and deserve a note
because an operator migrating an **existing** database runs through
them:

- [`0014_add_sealed_public_visibility.sql`](../drizzle/0014_add_sealed_public_visibility.sql)
  widens the enum with the two new labels. Idempotent
  (`ADD VALUE IF NOT EXISTS`); rewrites no rows.
- [`0015_flip_visibility_to_sealed_public.sql`](../drizzle/0015_flip_visibility_to_sealed_public.sql)
  rewrites existing rows onto the new labels and moves the column
  default to `'public'`. Idempotent (`WHERE`-guarded updates — a second
  run matches zero rows).

They are two files **necessarily**: PostgreSQL's
`ALTER TYPE … ADD VALUE` cannot have its new label *used* in the same
transaction that adds it, and each migration file runs as its own
transaction. Do not merge or reorder them. The legacy labels stay
declared in the enum forever (Postgres cannot drop an enum value without
a type rebuild, which was declined) — seeing four labels is correct.

Verify after migrating — do not trust a tool's exit status alone:

```bash
docker compose exec postgres psql -U civic -d civic -c '\dT+ visibility'
# → four labels: published, committed, sealed, public

docker compose exec postgres psql -U civic -d civic -c '\d evidence_records'
# → visibility column default 'public'::visibility
```

A database with pre-rename rows should additionally run the
count-preservation check in the header comment of `0015` (visibility
label counts before vs. after: no rows remain on the legacy labels, the
grand total unchanged).

### The consent table: `0017`

[`0017_source_consents.sql`](../drizzle/0017_source_consents.sql) creates
`source_consents`, the store for a signed-in reader's consent (see
[Consent and the flows statement](#consent-and-the-flows-statement)): one
row per account, every column `NOT NULL`.

| Column | Type | Holds |
|---|---|---|
| `user_id` | `uuid`, primary key | the account (`users.id`); deleting the account deletes the row |
| `states` | `jsonb` | per source id, the state (`on`, `ask-first`, `off`) and the calendar date it was given |
| `flows_hash` | `text` | the hash of the flows statement the reader was shown |
| `flows_statement` | `jsonb` | that statement, which the re-ask rule compares with the one in force |
| `consented_at` | `timestamptz` | when the consent was first given |
| `updated_at` | `timestamptz` | when a state last changed |

It is written with `CREATE TABLE IF NOT EXISTS` and its foreign key inline,
by hand, so the owner-run `psql` application and a fork's `drizzle-kit
migrate` are both safe on a database that already has it (the file's header
says why). Apply it **before** the deploy that reads it: after, every
signed-in session with an account row fails its consent read (on the consent
endpoint and on every question). Verify with
`\d source_consents`, never the tool's exit status alone
([`docs/db-migrations.md`](db-migrations.md)).

### The usage table: `0018`

[`0018_usage_counts.sql`](../drizzle/0018_usage_counts.sql) creates
`usage_counts`, the usage counter: how many questions the site answered,
per day and per kind of run. Each run a query route starts adds one to the
row for its combination of the eight key columns; every column is
`NOT NULL`, and the primary key `usage_counts_pkey` covers the first eight.

| Column | Type | Holds |
|---|---|---|
| `day` | `date` | the UTC date when the run ended |
| `environment` | `text` | where the run was counted: `production`, `preview` or `development` (the platform's `VERCEL_ENV`), `local` off the platform, `other` for any other value the platform sets |
| `surface` | `text` | the route: `compare-stream`, `query-notebook` or `compare` |
| `signed_in` | `boolean` | whether the reader was signed in |
| `model` | `text` | the model's declared id, from this instance's catalog |
| `outcome` | `text` | `complete` or `error` |
| `sources_offered` | `text` | the source ids the run was offered, sorted and comma-joined, `''` for none |
| `sources_used` | `text` | the source ids with at least one call that answered, in the same form; a refused or failed call is not use |
| `count` | `integer` | how many runs ended with this combination |

Nothing in it identifies a reader: every value comes from a closed set
(`src/lib/usage/count.ts`), and no account, network address or question text
reaches a column. A request refused before its run (validation,
configuration, consent, the rate limit) is not counted. Nothing in the app
reads the table; it is written only, after each answer has been sent, so a
write that fails (logged as `[usage] write failed` with the error's class)
never changes the answer. On `/api/compare`, a call that answers after the
run's no-data half has already failed is not counted as used.

The `environment` column keeps each environment's rows apart. An instance
whose previews share production's `DATABASE_URL` gets their rows in the same
table, marked `preview`; a read of production's use takes the
`production` rows only.

It is written with `CREATE TABLE IF NOT EXISTS` and its key inline, by hand,
for the same two application paths as `0017`. Apply it **before** the deploy
that writes it: after, each run's write fails and is logged, and the answer is
unchanged, but those runs go uncounted. Verify with `\d usage_counts`: nine
columns, every one not null, and `usage_counts_pkey` over the eight key
columns in the table's order. To reverse it, run
`DROP TABLE IF EXISTS usage_counts`, which loses the counts only.

## Consent and the flows statement

**Enforced since #632 W3.** The gate is on (`CONSENT_GATE_ENFORCED` in
`src/lib/sources/consent-enforced.ts`, a constant and not a setting), and
every surface that sends a question asks the reader first: the home page,
`/explore` and `/ask` show the consent card before the first question, and
replay's dialog shows it when the replay route refuses. W2 shipped the gate
off, because no surface could yet ask.

**What the gate does.** This site asks a reader once, before the first
question, whether it may send the question onward, and stores the answer;
nothing is sent anywhere before it, the model endpoint included (design
§4.4). The server enforces it: the four routes that send a question —
`/api/compare-stream`, `/api/compare`, `/api/query-notebook` and
`/api/evidence/<slug>/replay` (with its `/api/records/<slug>/replay` alias) —
refuse a question with no consent in force, after their own configuration
refusals and before the rate limiter counts anything. `/api/compare-stream`
answers with an `error` event per panel whose `code` is `consent_required`;
the other three answer HTTP 403 with
`{ error, code: "consent_required", flowsVersion, reask }`. A consent in
force whose reader has no source On (every configured source Off or Ask
first) is refused the same way with `code: "no_sources_on"`, before the
model is called, and its reader text points to the Sources panel.

**The surfaces.** The consent card lists every recipient from `/api/flows`
with what it says it keeps; **Allow** stores each configured source's
manifest default (`consentDefault`, On for every source today) and sends the
question, **Not now** sends nothing. The Sources panel, beside the question
box on the home page, `/ask` and `/explore`, sets each source On, Ask first
or Off and withdraws the consent; for a signed-in account kept in the
database it also links the dashboard's Sources tab, which shows the states,
the dates and the flows version, and withdraws too. The two settings these
surfaces read are in the environment reference
([Consent surfaces](#consent-surfaces-optional)).

**What a reader consents to: `/api/flows`.** `GET /api/flows` serves the
flows statement, derived when asked from this instance's configuration, the
router manifest's hosting variants and postures, and the dated constants in
`src/lib/flows/statement.ts`: every recipient by role and host (the model
endpoint, the hosting platform's function logs, sign-in, analytics, the
notebook executor), what each receives, and what each holder says it keeps,
with the page and the date it was read, or "not stated"; then each configured
source with its hosting variant, publisher, freshness and posture. It calls no
source. Its body is RFC 8785 canonical JSON, and its SHA-256 is the
statement's hash: the **flows version** a consent refers to, and the `hash` a
record's `composition.flowsStatement` carries, beside
the address and the statement's `date` (the latest read date it carries, never the day it is
served). The statement also carries a base `version` over the instance-level
recipients, and each source a `version` of its own.
[`docs/flows-changelog.md`](flows-changelog.md) is the dated log of what the
statement has said.

**Where a consent is kept.** A session whose account has a database row
(the session's `dbId`) keeps its consent in the `source_consents` table
(`0017_source_consents.sql`, above) and reads the row only. Any other
session, anonymous or signed in, keeps it in the cookie
`civic-source-consent`: host-only, `HttpOnly`, `SameSite=Lax`, `Path=/`, and
a session cookie (it ends with the browser session). It is `Secure` when the
request reached the site over https: the request's own scheme, or the
`x-forwarded-proto` header a platform or load balancer sets (its first
value). Over plain `http` it is left out, on `localhost` and on any other
host, because a browser keeps a `Secure` cookie only from a secure origin;
with it, a reader's consent on a plain-http instance would never stick and
every question there would be refused. The write and the revoke set it the
same way. The cookie
holds a format version, the statement's base version, and per source its
state, the calendar date it was given and that source's own version; never an
account id, a network address or anything else that identifies a reader.
Only the consent endpoint below writes either store; the consent card, the
Sources panel and the dashboard's Sources tab call it.

**The consent endpoint: `/api/sources/consent`.** `GET` reports the consent
in force and the current flows version, and sets no cookie. `PUT` with
`{ states: { <source id>: "on" | "ask-first" | "off" }, flowsVersion }`
stores the states; it answers 400 naming any id this instance does not
configure, and 409 with the current version when `flowsVersion` is stale, so
the surface reads the statement again. `PATCH` with `{ flowsVersion }` dismisses
a row's notices (below). `DELETE` revokes: the row is deleted, or the cookie
expired, and the next question is asked again. This is the only
boundary that accepts source ids: a question's run takes
its selection — configured sources that are On — from the store, never from
the request, and a configured source with no stored state (one added after the
reader consented) is Ask first, and is not offered.

**What re-asks.** A signed-in reader's row keeps the
statement it was given against, and each question compares it with the
statement in force. A
recipient added, a posture that keeps more (none, then metadata, then content,
or a longer stated retention), or a changed arrangement (a recipient's host,
where it runs, what it receives or who holds its logs) re-asks everyone; the
same change to one source's own row, or a change of that source's hosting
variant, re-asks for that source. A recipient or source removed, or a posture
that keeps less, notifies and does not re-ask; a newly configured source
re-asks nothing. A notice is shown to a reader whose consent is kept on an
account: `GET /api/sources/consent` returns the row's `notices` (one line per
change since the statement the row holds, dated by the row's `updatedAt`),
the Sources panel and the dashboard's Sources tab show them, and dismissing
(`PATCH`) saves the statement in force on the row. Changes are not announced
ahead; they take effect when deployed, and the dated change log records
them. A change to or from a posture that cannot be ranked ("not
stated", "as the operator states") re-asks. The anonymous cookie holds the
versions only, so any change to a version it holds re-asks. In this version a
re-ask is `consent_required` for the whole question, naming what is re-asked
(`reask: { base, sources }`); a source is never silently dropped.

A record states the reader's own state for each source: `selected` for On,
`reader-off` for Off, `not-consented` for Ask first or no state, and the
flows statement in force (`composition.flowsStatement`). Records published
while the gate was off (before #632 W3) carry the reasons they carried then
(`configured`, `not-configured`) and no flows statement: on new records
`configured` became `selected`.

## Behind a load balancer

A load balancer closes a connection that carries no bytes for its idle
timeout; an application load balancer's default is 60 s (AWS's
documentation). You do not need to know that value, or change it, for the
streamed answers. Two settings make that hold.

- **Streamed answers carry a keep-alive.** `/api/query-notebook` and
  `/api/compare-stream` answer with Server-Sent Events, and both can be
  silent for minutes: a model turn that picks a tool is not streamed, a tool
  call can take 45 s, and a notebook run takes up to the session cap (plus
  15 s under the lambda driver, 195 s at the defaults). From the moment the
  stream opens until it closes, each route writes an SSE comment line
  (`: keepalive`) every 15 s, so the balancer sees bytes every 15 s. The
  event-stream format ignores comment lines and the app's client never passes
  one to the page, so a keep-alive never enters a record.
  `src/app/api/sse-keepalive.test.ts` drives both routes through a silent
  model turn and a 195 s notebook run. An intermediary whose idle timeout is
  under 15 s still cuts these streams.
- **The server holds idle connections longer than the balancer.** The image
  sets `KEEP_ALIVE_TIMEOUT=620000` (milliseconds), which the standalone
  server applies to every connection. Node's own default is 5 s. A balancer
  that reuses a connection the server has just closed answers 502, which is
  why AWS says to set the application's idle timeout larger than the
  balancer's. 620 s is larger than any idle timeout up to 10 minutes. To
  change it, set the variable in the container's environment, and keep it
  above the balancer's idle timeout. `scripts/keep-alive-timeout.test.mjs`
  fails if the image stops setting it or the installed Next stops reading it.

**Requests that answer once.** `/api/records/<slug>/replay`,
`/api/records/<slug>/evaluate`, `/api/records/generate-summary` and
`/api/compare` send nothing until they finish, so a keep-alive cannot reach
them. A replay re-runs a record's analysis, up to 20 model turns, and can take
longer than 60 s. When one outlasts the balancer's idle timeout, the reader
gets a gateway error after the model calls have been paid for. If your readers
use the attestation dialog's checks, set the balancer's idle timeout above
your longest replay until
[#533](https://github.com/npstorey/civic-ai-tools-website/issues/533) changes
these routes.

## Outbound traffic through an egress proxy

On a network where outbound traffic must leave through a proxy, set the
conventional three. The app honours them for the outbound kinds the
table below marks **yes**; the kinds it marks **no** leave by a
transport these variables do not reach, and the paragraphs under the
table say what each one needs instead. **Unset is the reference
configuration:** with none of them set,
no dispatcher is installed at all and every request leaves by the path
and to the host it did before this existed.

```bash
HTTP_PROXY=http://proxy.internal:3128
HTTPS_PROXY=http://proxy.internal:3128
NO_PROXY=minio,postgres,.internal.example
```

The lower-case spellings (`http_proxy`, `https_proxy`, `no_proxy`) are
read too and win when both are set, matching curl and the rest of the
convention. Set one spelling, not both.

**Why this needs code at all.** Node's built-in `fetch` does not read
these variables. Measured on the image's Node (22): with `HTTP_PROXY`
set and `NO_PROXY` unset, a request goes straight to the origin —
`origin hits: 1, proxy hits: 0` — and `NODE_USE_ENV_PROXY=1` changes
nothing, because that flag arrives in a later Node than this image
carries. [`src/lib/outbound-proxy.ts`](../src/lib/outbound-proxy.ts)
installs one `undici` dispatcher at server start,
[`src/lib/signin-proxy.ts`](../src/lib/signin-proxy.ts) routes the
sign-in leg, which that dispatcher cannot reach, and
[`src/lib/sandbox/vercel-sandbox.ts`](../src/lib/sandbox/vercel-sandbox.ts)
routes the sandbox API calls, which pass a dispatcher of their own.
`scripts/outbound-proxy.test.mjs`
drives a request through a loopback proxy and reads it back there for
the signing services, the model endpoint, the MCP servers, the S3 object
store, verification's blob read, the rate-limit counter, the sign-in
provider leg and the sandbox API. The other "yes" rows call the same
global `fetch` and are not driven separately. The managed-sandbox row is
also driven through a whole sandbox session, offline, and the suite
fails if that row and the measured behaviour disagree.

### Loopback is always exempt

`localhost`, `127.0.0.1` and `[::1]` never go through the proxy,
whatever you set. `NO_PROXY` is **added** to that set, not substituted
for it — so a signing stub, a local MCP server or a sidecar on the same
host keeps working the moment you turn a proxy on, and you do not have
to remember it.

**An in-network service reached by NAME is not loopback.** In the
compose stack the app reaches its object store at `http://minio:9000`
and its database at `postgres:5432`. Those names belong in your
`NO_PROXY`, or the object store's traffic is sent to the egress proxy.
The same holds for a rate-limit KV store reached by an in-network name
(`KV_REST_API_URL`). The database is unaffected either way (see the
table's `DB_DRIVER=node-postgres` row).

### What the proxy carries, and what it cannot

| Outbound kind | Leaves through | Honours the proxy variables |
| --- | --- | --- |
| Model endpoint | the `openai` SDK (`src/lib/model-client.ts`) | yes |
| MCP servers | `fetch` (`src/lib/mcp/client.ts`) | yes |
| Object store, `BLOB_DRIVER=vercel-blob` | `fetch` (`src/lib/storage/vercel-blob.ts`) | yes |
| Object store, `BLOB_DRIVER=s3` | the AWS SDK (`src/lib/storage/s3.ts`) | yes — see below |
| Signing services | `fetch` (`src/lib/evidence/signing.ts`) | yes |
| Verification's read of a blob-referenced field | `fetch`, in `@typedstandards/verify-core` | yes |
| Directory and roadmap content sources | `fetch` | yes |
| Rate-limit counter, `KV_REST_API_URL` set | `fetch`, in `@vercel/kv`'s client `@upstash/redis` (`src/lib/rate-limit.ts`, and the consent pause's entries, `src/lib/sources/decision.ts`) | yes |
| Sign-in provider (GitHub / OIDC) discovery, token and userinfo calls | `node:http(s)`, in the sign-in library's `openid-client` | yes — see below |
| Database, `DB_DRIVER=neon-http` | `fetch` | yes |
| Database, `DB_DRIVER=node-postgres` | a raw TCP socket (`pg`) | **no** |
| Notebook execution, `EXECUTOR_DRIVER=vercel-sandbox` | `fetch`, in `@vercel/sandbox`, to `https://vercel.com/api`, through a proxy-aware dispatcher the driver hands the SDK (`src/lib/sandbox/vercel-sandbox.ts`) | yes — see below |
| Hosted source (`<SOURCE>_HOSTING=sandbox`): its sandbox's lifecycle | `fetch`, in `@vercel/sandbox`, to `https://vercel.com/api`, through the same proxy-aware dispatcher the executor uses (`src/lib/mcp/hosting/lifecycle.ts`, reusing `src/lib/sandbox/vercel-sandbox.ts`) | yes |
| Hosted source: the MCP exchange with its bridge | `fetch`, to the sandbox's `*.vercel.run` address (`src/lib/mcp/client.ts`) | yes |
| Notebook execution, `EXECUTOR_DRIVER=container` | the app: the container-runtime socket on the host. The notebook's own requests: the executor container, on the runtime's default network (`src/lib/sandbox/container.ts`) | the socket: **no** — it is not network traffic. The notebook's requests: yes — see below |
| Notebook execution, `EXECUTOR_DRIVER=lambda` | the app: the AWS SDK's Lambda client, to `lambda.<region>.amazonaws.com` (`src/lib/sandbox/lambda.ts`). The notebook's own requests: the function, from wherever it runs | the invoke: yes, as the S3 driver's calls do, with the fetch transport's header timeout raised to the session cap. The notebook's requests: the **function's** proxy variables, set on the function — see [The Lambda executor](#the-lambda-executor) |

**The database row and the container executor's socket leg are not gaps
to close.** An HTTP proxy variable governs HTTP; a Postgres connection is
a TCP stream that no `HTTP_PROXY` describes, and the app drives the
container executor through a socket on the host rather than over the
network at all. Reaching a database through a proxy is a network-level
arrangement (a tunnel, a sidecar, a route), not an application setting.

**The container executor passes the variables into the notebook
container.** Under `EXECUTOR_DRIVER=container`, with a proxy configured,
every `docker exec` of a notebook session passes `HTTP_PROXY`,
`HTTPS_PROXY` and `NO_PROXY`, each under both spellings, so the
notebook's own requests (to a data portal, say) use your proxy whichever
spelling a client inside reads: curl reads only `http_proxy`, Python
reads both. The values are the ones the app resolves for itself: the
lower-case spelling wins, and when only `HTTP_PROXY` is set, the
container is given it as `HTTPS_PROXY` too, so its https requests use it
as the app's own do (curl and Python would not fall back on their own).
They are passed by name only
(`-e HTTP_PROXY`), with each value in the environment of the `docker`
process, so no proxy value appears on a command line. With the variables
unset, every `docker` invocation is exactly what it was before this
existed. The vercel-sandbox driver passes nothing: a managed sandbox runs
on the provider's network.

- **`NO_PROXY` inside the container** is the same composed list:
  `localhost`, `127.0.0.1` and `[::1]` first, then yours. Inside the
  container, loopback is the container's own, not the app's.
- **The proxy must be reachable from the container runtime's default
  network.** The executor container is started by the host's runtime,
  on its default network, not on the compose network. A proxy on the
  app's loopback (`http://127.0.0.1:3128`) or at a compose service name
  (`http://proxy:3128`) is not reachable from there: the first names the
  container itself, the second does not resolve. Use an address the
  host's containers can reach.
- **A proxy address carrying a user or password is refused.** Passed
  into the container, it would sit in the environment of the notebook's
  own code. So if `HTTP_PROXY` or `HTTPS_PROXY` (either spelling) carries
  one, the session is refused before any container starts, with a
  `ContainerProxyUserinfoError` that names the variable and never its
  value. The reader sees the notebook-failure message with a reference;
  the server log line carries that reference and the error class. Use a
  proxy that authorizes this host by network rather than by password.
- **The `docker` CLI's own connection to the runtime is unchanged.** The
  default is a unix socket, which the proxy variables do not govern.
  Measured with a local runtime on its default unix socket, `HTTP_PROXY`
  pointed at a loopback listener, and a whole session run: the listener
  received no connection.

**The sign-in row is a "yes", reached a different way.** next-auth's
provider leg runs through `openid-client`, which calls `node:http(s)`
directly: driven against a loopback server with both counted, discovery
came out `{fetch: 0, nodeHttp: 1}`. No global `fetch` dispatcher can
govern that transport, so this leg is routed at the library's own
per-URL transport seam instead, which tunnels to the destination through
your proxy with `CONNECT`. **You configure nothing extra for it:** the
same three variables, the same exempt set. `NO_PROXY` exempts a provider
host on this path exactly as it does on every other, and with the three
variables unset the leg goes where it went before, by the transport it
used before. `scripts/outbound-proxy.test.mjs` drives both of its legs —
discovery and the token exchange, which reach the library at different
places — through a loopback proxy, and asserts that this path and the
`fetch` path exempt the same destinations rather than checking each on
its own terms.

**The managed-sandbox executor row is a "yes", reached through the
SDK's own seam.** Under `EXECUTOR_DRIVER=vercel-sandbox`, the default,
every call that creates, drives, reads from or stops a sandbox goes to
`https://vercel.com/api` through `@vercel/sandbox`. That SDK calls
`fetch` but passes its own `undici` agent as each request's dispatcher
(built with no body timeout, which long command-output streams rely on),
and an explicit dispatcher overrides the global one. So with a proxy
configured, the driver hands the SDK a `fetch` that replaces that agent
with a proxy-aware dispatcher built from the same three variables and the
same exempt set as every other row, **also with no body timeout**. The
sandbox API is reached with `CONNECT vercel.com:443` through
`HTTPS_PROXY` (or `HTTP_PROXY` when only that is set), and `NO_PROXY`
exempts a host here exactly as it does on every other path. **You
configure nothing extra for it.** With the three variables unset the SDK
is called exactly as before, with its own agent, and no dispatcher is
built. Separately, refreshing an expired OIDC token from a local Vercel
CLI login (a development path) calls `https://api.vercel.com` and, when
the login itself has expired, `https://vercel.com`, both through the
global `fetch`, which also honours the variables. The notebook's own
code runs inside the sandbox, on the provider's network, and its
requests are not this instance's traffic. An instance that executes no
notebooks makes none of these calls. The snapshot build script
(`scripts/build-sandbox-snapshot.ts`) is an operator tool that calls the
SDK directly rather than through this driver, and does not take this
path. `scripts/outbound-proxy.test.mjs` runs a whole sandbox session
through the real driver against the installed SDK, offline, and fails
if any request of it carries a dispatcher other than the proxy-aware
one, if that dispatcher loses the zero body timeout, or if it stops
reaching a loopback proxy as `CONNECT vercel.com:443`.

**The S3 driver changes transport when a proxy is set.** The AWS SDK's
default Node transport speaks `node:http(s)`, which a `fetch`
dispatcher cannot govern — so with a proxy configured, and only then,
the S3 client is given the SDK's own `fetch` transport instead. Same
requests, same bucket, same signatures; a different socket underneath.
With the variables unset the driver keeps the SDK default, unchanged.

**A proxy that closes idle connections.** Two outbound requests carry no
bytes until their answer is ready. A model turn that picks a tool is one
request to the model endpoint that stays silent until the model answers. A
notebook invoke under `EXECUTOR_DRIVER=lambda` stays silent for up to the
session cap plus 15 s (195 s at the defaults). A proxy that closes a tunnel
idle for less time than that cuts the request. For the invoke, a VPC
interface endpoint for Lambda named in `NO_PROXY` takes it off the proxy
entirely (see [The Lambda executor](#the-lambda-executor)).

**Nothing signed moves.** A proxy changes how a request travels, not
what is recorded: no field of a signed package, and no envelope hash,
is a function of the route a request took.

**A proxy URL can carry a credential** (`http://user:pass@proxy`). The
app never prints these values — it logs only the variable NAMES it
honoured — and you should keep them in your secret manager like any
other credential. Under `EXECUTOR_DRIVER=container` such an address is
refused (see the container executor above).

### A proxy that inspects TLS

A proxy that inspects TLS answers every HTTPS request with a certificate
of its own, signed by its own CA. Until the app trusts that CA, every
"yes" row in the table above fails certificate validation. Give Node the
CA with `NODE_EXTRA_CA_CERTS`, a path to a PEM file inside the app's
container, for example from an image built on the app's:

```dockerfile
FROM <your-registry>/civic-app:<tag>
COPY proxy-ca.crt /app/proxy-ca.crt
ENV NODE_EXTRA_CA_CERTS=/app/proxy-ca.crt
```

- **It adds to Node's own roots**; it does not replace them, so public
  hosts the proxy does not inspect still verify.
- **Node reads the file once, when it starts.** A changed file needs a
  restart.
- **A file Node cannot read does not stop it.** Node prints
  `Warning: Ignoring extra certs from …` and starts without the CA, and
  every request through the proxy then fails validation. Check the app's
  first log lines after setting it.

Measured on this repository's Node 22 against a loopback proxy that
terminates TLS with a throwaway CA: with the variable unset, the global
`fetch` path, the sign-in tunnel and the AWS SDK's `fetch` transport (the
Lambda and S3 clients under a proxy) each refused the proxy's certificate
(`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). With it set, all three were answered
through the proxy. With it naming a missing file, Node printed the warning
and all three refused again. The drive is a one-off, not a test in this
repository.

The notebook's own requests do not run in the app's process. Under
`EXECUTOR_DRIVER=lambda` and `EXECUTOR_DRIVER=container`, give the
executor image your CA as [the Lambda executor](#the-lambda-executor)
describes. Under `vercel-sandbox` the notebook runs on the provider's
network, not through your proxy.

## Instance identity and signing (go to production)

Signing is the go-to-production step: keygen → trust registry →
environment. It is deliberately **not** duplicated here —
[`docs/instance-setup.md`](instance-setup.md) is the canonical
walkthrough (generate an Ed25519 keypair outside any AI-agent session,
pick a kid, publish your `/.well-known` trust registry, set
`PUBLISHER_SIGNING_KEY` + `PUBLISHER_KEY_ID` and the identity variables,
smoke-test a publish). Key changes after that follow
[`docs/key-rotation.md`](key-rotation.md).

Two facts worth restating from the deploy side:

- With the signing pair unset, the compose stack runs the unsigned tier
  correctly — this guide's bring-up **is** the unsigned tier (instance
  attribution is then honestly omitted from unsigned surfaces, never
  defaulted). Configuring signing is what makes the seal/publish actions
  reachable, and it takes the **whole set**: the key, the key id, and the
  instance-identity variables (`PUBLISHER_SITE_ORIGIN`, the
  `PUBLISHER_SIGNER_*` triple, `PUBLISHER_PLATFORM_AGENT_TITLE`). An
  instance with a key but no `PUBLISHER_KEY_ID` refuses to publish rather
  than sign under an undeclared key id; one with the pair but an
  incomplete identity set refuses (`instance_identity_missing`, naming
  the exact missing variables) rather than emit signed output under an
  identity it never configured.
- `PUBLISHER_SIGNING_KEY` is the most sensitive value your instance
  holds. Keep it in your secret manager; never commit it, paste it into
  an agent session, or bake it into an image.

### Outbound destinations the signing leg needs

Everything in this table is what an operator hands to whoever runs their
egress allowlist. Three destinations, two hosts, all HTTPS on 443. Each
row names the variable that moves it, so an instance that cannot reach a
default — or runs its own service — changes the address rather than
opening a hole.

| Destination (default) | Method | What reaches it | When | Variable |
| --- | --- | --- | --- | --- |
| `https://freetsa.org/tsr` | POST | An RFC 3161 `TimeStampReq` over the package hash — a hash, never package content | Every seal, publish, withdrawal, reinstatement, adversarial-eval attestation and attestation backfill | `TIMESTAMP_AUTHORITY_URL` |
| `https://rekor.sigstore.dev/api/v1/log/entries` | POST | A `hashedrekord` proposal: the package hash, the signature over it, and the instance's **public** key | The same operations, when a signing key is configured | `TRANSPARENCY_LOG_URL` |
| `https://rekor.sigstore.dev/api/v1/log/entries/{entryId}` | GET | An entry id, to read back an entry this instance already published | Only when an operator runs `scripts/backfill-rekor-entry-body.ts` by hand; never on a request path | `TRANSPARENCY_LOG_URL` (the id is appended to it) |

**Blocking a destination degrades; it does not break.** Both calls are
best-effort by construction and each catches everything and returns
null: a blocked or slow timestamp authority yields a record published
without a timestamp token, a blocked log yields a record published with
no log entry. The publish itself still succeeds, and the failure is a
server-side `console.warn`. Nothing here is a credential: what leaves
the instance is a hash, a signature and a public key.

**Unset is the reference configuration.** With both variables absent,
each request goes to the address in the table, character for character —
that is what [`src/lib/evidence/signing.ts`](../src/lib/evidence/signing.ts)
holds as its defaults and what `signing-addresses.test.ts` pins. Setting
one is a deliberate act; an empty value is read as unset.

**Verification needs no allowlist entry of its own.** Reading a record
back verifies stored bytes — the package, the signature, the timestamp
token, the log entry body and its inclusion proof are all held by this
instance — so the verify route contacts neither service. The one
network call verification can make is to *your own* object store, to
resolve a package stored by reference.

**What pointing these at your own services does and does not do.** The
app submits to whatever address you configure — that part is entirely
under your control. Verification is not: the verifier in this codebase
and in the browser client pins its trust anchors, the FreeTSA root and
the Rekor log keys, as defaults that nothing overrides
(`verifyRfc3161Timestamp(token, hash, anchors = FREETSA_ROOT_ANCHORS)`
and `verifyRekorInclusion(body, proof, anchors = REKOR_LOG_ANCHORS)` in
`@typedstandards/verify-core`; this app's verify route passes neither).
So a token from a substitute authority is reported against the pinned
root as `untrusted_root`, and a checkpoint from a substitute log as
`checkpoint_unknown_anchor`. Both are **reported, not thrown** — the
publish succeeds and the record is served — but the timestamp and
inclusion signals read as unverified-against-the-pinned-anchors, not as
verified. Configurable trust anchors are a specification question and
are not implemented here. Today, substituting either service is for an
instance that cannot reach the defaults, not a way to have a record
verify against a service of your own.


### Publishing the instance's default layout node

An instance can publish the layout its pages render by default as a signed
`content/layout/v1` node (spec §8.14), so a reader can verify which layout a
record was published under apart from this host. The reference deployment
publishes its own; a fork that signs publishes its own the same way, under
its own key, and never copies another instance's node file (a node signed by
another key is not named, see the `ANSWER_LAYOUT` row above).

`scripts/publish-layout.ts` builds the node from the built-in `answer-first`
v1's seven fields and nothing else, signs it through this repository's
signing module, and requests the RFC 3161 timestamp and the transparency-log
entry from the addresses in the table above. It reads the signing set this
section names (`PUBLISHER_SIGNING_KEY`, `PUBLISHER_KEY_ID`, the
`PUBLISHER_SIGNER_*` triple, and `PUBLISHER_SITE_ORIGIN` or
`PUBLISHER_TRUST_REGISTRY_CANONICAL_URL`), plus `TIMESTAMP_AUTHORITY_URL`
and `TRANSPARENCY_LOG_URL` when set. Run it in your own terminal with those
injected, never in an agent session:

    op run --env-file=<file> -- node --experimental-strip-types scripts/publish-layout.ts
    op run --env-file=<file> -- node --experimental-strip-types scripts/publish-layout.ts --apply

- **The dry run (the default)** builds and signs the node in memory,
  requests the timestamp, checks that the signing key is the active key your
  published trust registry carries for your kid, and verifies the built node
  in process. It makes no transparency-log request (a log entry is permanent)
  and writes no file. The node id it prints never ships: the real run builds
  a new node.
- **The real run (`--apply`)** goes in this order: the timestamp, the same
  checks, the log, the files. It writes nothing unless both the timestamp and
  the log entry came back, and a key that does not match your registry stops
  it before the log. It writes three files:
  `public/.well-known/layouts/<nodeId>.json` (the node document, which the
  published `@typedstandards/cli` verifies: `npx @typedstandards/cli verify
  --input <file>`), `public/.well-known/layouts/<nodeId>.proofs.json` (the
  timestamp token and the log entry, which the cli's input does not take),
  and `src/lib/answer-layout/committed-nodes.ts` (one import added, so the
  next build includes the node). Commit exactly those three paths and
  deploy: from that deploy on, every publication attestation names the node.
  Node files are never removed, so every id ever named stays resolvable.

The site reads committed nodes through that build-time import, never from
disk at run time. Each file is served as a static file at
`/.well-known/layouts/<nodeId>.json`, a path the app's host
canonicalization and its proxy both exempt, as they exempt the rest of
`/.well-known` (see [Host topology](#host-topology-optional)).

**Cross-origin reads of `/.well-known`.** This repository sets no CORS
header on any static file, the layout nodes and the trust registry
included. A browser verifier on another origin that fetches these files
needs `access-control-allow-origin` from the server in front of your
instance; a server-side or command-line verifier does not. The reference
deployment's hosting platform sends `access-control-allow-origin: *` on
static responses on its own; a self-hosted instance that wants
browser verification from other origins adds the header in its own proxy.
This is the first operator note on CORS for `/.well-known`; whether an
instance is made browser-verifiable is a question for all of `/.well-known`.


## Object storage: configuration and rehearsal

With `BLOB_DRIVER=s3`, the storage seam works against any S3-compatible
endpoint. The contract (resolved in
[`src/lib/storage/s3.ts`](../src/lib/storage/s3.ts)):

| Variable | Required | Meaning / default |
| --- | --- | --- |
| `S3_BUCKET` | yes | Bucket for record-package objects. |
| `S3_ACCESS_KEY_ID` | both or neither | Access key. Set it with `S3_SECRET_ACCESS_KEY`, or leave both unset and the AWS SDK's default chain supplies the credentials ([below](#credentials-a-key-pair-or-the-sdks-default-chain)). |
| `S3_SECRET_ACCESS_KEY` | both or neither | Secret key. Set it with `S3_ACCESS_KEY_ID`, or leave both unset. |
| `S3_ENDPOINT` | no | Endpoint URL (e.g. `http://minio:9000`). **Omit for AWS S3 proper.** |
| `S3_REGION` | no | Default `us-east-1`. Must match where the bucket actually lives — it feeds the public URL. |
| `S3_FORCE_PATH_STYLE` | no | Default: `true` when `S3_ENDPOINT` is set (MinIO needs path-style), `false` otherwise. |
| `S3_PUBLIC_BASE_URL` | no | Public base for object URLs. Default: `<endpoint>/<bucket>` when `S3_ENDPOINT` is set, else the AWS virtual-hosted URL `https://<bucket>.s3.<region>.amazonaws.com`. |

Each stored object's URL, built from `S3_PUBLIC_BASE_URL`, is what the
database records for it, and the driver maps that URL back to the
object's key on every read. Keep its last path segment equal to
`S3_BUCKET` (the compose default does this), and do not change it once
records exist: a stored URL outside the current base is fetched over
plain HTTP instead of through the S3 API.

### Credentials: a key pair or the SDK's default chain

**Both keys set:** every request signs with that pair. This is the
compose stack's path, which hands the same pair to MinIO as its root
user, and nothing about it has changed.

**Neither key set:** the driver builds its S3 client with no
credentials, and the AWS SDK's default chain resolves them, as it does
for the [Lambda executor](#the-lambda-executor). The chain tries, in
order: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (with
`AWS_SESSION_TOKEN`) in the environment, SSO, the shared config and
credentials files, a credential process, web identity, then the
container credentials endpoint (on ECS, the task role) and the instance
metadata endpoint (on EC2, the instance profile). On a platform that
provides role access, this is how an instance runs with no long-lived
key pair: attach the bucket's scoped policy to that role
([Appendix A](#role-alternative-no-access-key)) and set neither key.

**Exactly one key set is refused.** The driver throws at its first use,
naming the missing key, and [preflight](#environment-reference-tier-by-tier)
fails naming it too. An empty value counts as unset.

When the driver is built (once per server process), it logs one line
naming the source in use, never a value:

```
[storage:s3] credential source: the S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY key pair
[storage:s3] credential source: the AWS SDK default chain (S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY unset)
```

The second line says that the chain is in use, not which of its sources
answered. A chain that finds nothing fails at the first storage request
with `Could not load credentials from any providers`.

**Presigned uploads under a role.** The client-upload grant is a
presigned PUT valid for one hour. Signed with temporary credentials,
the URL carries the credential's session token
(`X-Amz-Security-Token`) and stops working when that credential
expires, even when that comes before the hour. AWS documents this: "If
you created a presigned URL using a temporary credential, the URL
expires when the credential expires"
([Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)).
Before it signs, the SDK replaces a credential that has under five
minutes left, so a grant normally gets at least five minutes and at most
the hour. A client that uploads soon after its grant is unaffected; one
that holds a grant and uploads later can be refused with `ExpiredToken`,
and should request a new grant. With the key pair, the full hour holds.

### Two bucket choices

**Public bucket (the default, unchanged).** Objects are world-readable:
published record packages are public content, and the confidentiality
of a not-yet-published (sealed) package rests on its unguessable random
key, not on bucket ACLs. Object URLs reach browsers and third parties —
a public record's signed `locatedAt` attestation and its commitment's
`packageUrl` name them, and some pages fetch them directly — so
`S3_PUBLIC_BASE_URL` must be an address a browser can reach, not an
in-network endpoint like `http://minio:9000`. The compose stack's
`minio-init` applies the public-read policy for you; on a public cloud
you apply it yourself
([Appendix A](#appendix-a-first-time-s3-on-a-public-cloud)).

**Private bucket.** No anonymous read: only the app's own identity (the
service account its key pair belongs to, or its role) reads objects, and
readers get record content through the app. The
record page's Download goes through `GET /api/records/:slug/package`,
which applies the record's read gate (a sealed record is its creator's
alone) and serves the stored object's bytes unchanged. Requirements and
consequences:

- **Public publishing must be off: set `SITE_SEAL_ONLY=1`.** A public
  record's signed `locatedAt` attestation and its commitment's
  `packageUrl` name the storage URL as the place anyone can fetch the
  package. On a private bucket that URL refuses every third party, so a
  record made public there would assert a location nobody can read.
  With the setting on, both publish routes refuse the public state, and
  every new record is sealed.
- **Records already public keep URLs that stop resolving.** Switching an
  existing instance's bucket to private does not change any signed
  record: each public record's `locatedAt` and commitment still name its
  storage URL, and from then on that URL refuses anonymous readers. The
  app still serves those records to anyone, through its pages and the
  package route, but a third party following the signed location, such
  as an independent verifier resolving the commitment's `packageUrl`,
  can no longer fetch the package. Keep the bucket public if those
  records must stay independently resolvable.
- **`S3_PUBLIC_BASE_URL` still matters**, as the address the database
  records and the driver maps back to keys (above). It need not be
  reachable from a browser.
- **Known gap** (follow-up: #558). One surface still fetches storage
  URLs anonymously and fails on a private bucket:
  - **Blob references.** A package's `output`, `trace` or skill text
    stored under `evidence-refs/` through the upload-token flow: the
    record page cannot show that content, and the integrity check
    reports the reference as not retrievable. This reaches only records
    published through the API with uploaded blob references; the app's
    own pages never call the upload flow.

  Attestation details are served through the app: the record page
  reads each attestation's package from
  `/api/records/:slug/attestations/:id/package`, gated as its record is
  (#559).
- **The compose stack is public-only.** Its `minio-init` applies the
  public-read policy on every start; a private bucket is for an object
  store you provision yourself
  ([Appendix A, private variant](#private-variant-no-public-read)).

### Validating a storage configuration

[`scripts/rehearse-storage-s3.mjs`](../scripts/rehearse-storage-s3.mjs)
drives four legs through the real storage seam against whatever
S3-compatible endpoint the environment provides: content-addressed
round-trip byte parity, the presigned-PUT client-upload grant (including
the policy rejections), anonymous read (served on a public bucket,
refused on a private one), and the GC sweep run hermetically. It refuses
to run unless `BLOB_DRIVER=s3`, touches only objects it creates, deletes
them all in teardown, never prints a credential value, and exits `0`
only when all four legs pass (`2` for a config problem — it names the
variable; `1` for a failed leg).

It takes credentials as the driver does
([Credentials](#credentials-a-key-pair-or-the-sdks-default-chain)): the
key pair when both keys are set, the SDK's default chain when neither
is. On the role alternative, run it where the chain resolves to the
identity the deployment will use, such as a task on the same platform
with the same role, and its config line reads
`credential source: AWS SDK default chain`.

Run it from the checkout (it imports the repository's dependencies —
run `npm install` once first) against your real bucket, injecting
values via your secret manager (shown here with the 1Password wrapper —
one convention, not a requirement):

```bash
op run --env-file=<your-env-file> -- node scripts/rehearse-storage-s3.mjs
```

Or with the environment already exported, plainly:

```bash
node scripts/rehearse-storage-s3.mjs
```

In the GC leg, a clean run on a dedicated bucket prints

```
shielding 1 pre-existing object(s) under evidence-refs/ (marked referenced)
```

— exactly one, twice (once per sweep). The one object is the harness's
**own** accepted upload from the grant leg, which lands under the GC
prefix before the sweep leg runs, so the count is never zero on a
passing run. A larger count means the bucket holds objects the harness
did not create: every such object is shielded from deletion and the run
can still pass, but you are no longer observing the sweep on a
dedicated bucket. The expected end state is
`RESULT: PASS — 4/4 legs`.

**On a private bucket, run it with `--private-bucket`.**

```bash
op run --env-file=<your-env-file> -- node scripts/rehearse-storage-s3.mjs --private-bucket
```

Legs 1 and 3 fetch an object's public URL anonymously. With the flag,
those four checks assert that the read is refused (`401` or `403`, and
the stored bytes not served): leg 1's `public-URL fetch refused
(private bucket)` and `public-URL response does not serve the stored
bytes (private bucket)`, and leg 3's `package: anonymous fetch of public
URL refused (private bucket)` and `granted upload: anonymous fetch of
public URL refused (private bucket)`. Every other check is the same in
both modes: each reads and writes through the app's identity or a
presigned URL, or reads nothing (leg 3's URL-to-key mappings). The
expected end state is again `RESULT: PASS — 4/4 legs`.

Each mode fails on the other kind of bucket, so the run also checks the
bucket itself. Without the flag, a private bucket fails those four
checks under their public-bucket names (`public-URL fetch succeeds`,
`public-URL bytes sha256-identical`, `package: anonymous fetch of public
URL succeeds`, `granted upload: anonymous fetch of public URL succeeds`)
and the run ends `RESULT: FAIL — 2/4 leg(s) failed (runId=…)`. With the
flag, a bucket that still serves anonymous reads fails them the same
way.

The same harness validates the compose stack's own MinIO (loopback
endpoint, compose placeholder values), and the file's header comment
carries a fully disposable MinIO self-verification recipe. Note the
recipe binds `127.0.0.1:9000` — the same port the compose stack's MinIO
publishes — so stop the stack first or change the port.

## Scheduler and background jobs

One recurring job exists: orphan-blob garbage collection
(`GET /api/cron/blob-gc`), a plain bearer-authenticated endpoint that
sweeps abandoned uploads older than a grace window. Any scheduler can
drive it; the compose stack ships a `gc-cron` sidecar that calls it
daily with `Authorization: Bearer $CRON_SECRET`.

Set the **same** `CRON_SECRET` on both the app and the scheduler.
Unset, the endpoint rejects every call with 401 — the stack runs, but
orphaned uploads are never swept and the sidecar logs
`{"error":"Unauthorized"} (http 401)` on each attempt. `GC_ENDPOINT`
and `GC_INTERVAL_SECONDS` tune the sidecar; a managed deployment keeps
its platform cron instead (`vercel.json`).

## Managed-platform deployment

The driver defaults *are* the managed profile: `neon-http` +
`vercel-blob` + `vercel-sandbox` is how the reference deployment runs on
Vercel with its marketplace services. Deploying there (or to an
equivalent platform) is the same codebase with a different environment —
a section's worth of differences, not a parallel guide:

- **Drivers:** leave all three selectors unset (or set to their
  defaults).
- **Database:** `DATABASE_URL` pointing at a Neon (serverless HTTP)
  Postgres. The same migrations apply, via the direct path
  (`npx drizzle-kit migrate`) or your CI.
- **Storage:** `BLOB_READ_WRITE_TOKEN` (platform-issued) instead of the
  `S3_*` set.
- **Executor:** on-deploy sandbox auth is OIDC-automatic; set
  `SANDBOX_SNAPSHOT_ID` to a prebuilt snapshot
  (`npm run sandbox:build-snapshot`) or every execution pays a slow
  fresh boot. `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID`
  are only for off-platform runs against the sandbox API.
- **Rate limiting:** `RATE_LIMIT_SECRET` is required in every
  environment that serves queries (see the core query path table);
  `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash via the platform)
  make the counter durable.
- **Scheduler:** platform cron per `vercel.json`, authenticated with the
  same `CRON_SECRET` mechanism.
- **Everything else is identical:** the model seam, sign-in, the signing
  pair and identity variables, and the unsigned-tier behavior all work
  exactly as described above. The preflight resolves this as the default
  profile and reports accordingly.

### Ops note: sandbox snapshot expiry

Vercel Sandbox's platform default expires a snapshot **30 days after its
last use**. `scripts/build-sandbox-snapshot.ts` already opts out of that
(`sandbox.snapshot({ expiration: 0 })` — `0` is the platform's documented
sentinel for "never expire"), so a snapshot built via
`npm run sandbox:build-snapshot` shouldn't be on that clock at all. The
residual risk is a `SANDBOX_SNAPSHOT_ID` that came from somewhere else —
hand-built without an equivalent no-expiration flag, or predating this
override.

**Recognize it:** neither `execute.ts` nor `vercel-sandbox.ts` catches a
failed snapshot boot, so a lapsed snapshot is more likely to surface as an
outright execution failure at the sandbox-boot step than as a merely slow
one. Check proactively with the Sandbox CLI:
`sandbox snapshots get $SANDBOX_SNAPSHOT_ID` (`created` = healthy,
`deleted` = expired/removed).

**Refresh:** `npm run sandbox:build-snapshot`, then set the printed id on
`SANDBOX_SNAPSHOT_ID` in both Vercel scopes.

**Keep-warm:** not worth automating at the current volume (roughly one
published run a month), and less useful here than usual — the
`expiration: 0` override already removes the 30-day timer for anything the
script built, so a scheduled keep-warm job would mostly be insuring
against the residual-risk case above, not the general platform behavior.
Left manual: rebuild on a sandbox-boot failure, or whenever pinned library
versions change (which already forces a rebuild). Revisit if run volume or
the failure mode changes.

## In-loop routing

`SOURCE_ROUTING` sets how a question's data sources reach the model. It takes two values.

- `all-sources` is the default, and applies when the variable is unset. The first request carries the guidance and the tools of every configured source the reader has set to On. This is what every run sent before the setting existed.
- `in-loop` sends a short directory and one tool, `load_source`, on the first request. The directory has one line per source: its alias, what it covers and how current its data is. The model calls `load_source` with an alias. The next request carries that source's guidance in its system prompt and its tools in its tools array. The directory and `load_source` stay on every request, so the model can load another source later.

Any other value runs as `all-sources`, and the server logs one line naming the variable and its two values. The preflight refuses such a value and names both.

The directory follows the reader's settings ("Consent and the flows statement"). A source set to Off is not listed. Loading a source set to Ask first sends nothing to it until the reader answers: the two streaming routes stop to ask ([The consent pause](#the-consent-pause)), and the JSON route and replay record `declined`. While the consent gate is off, every configured source counts as On.

The `load_source` result is one line of plain text with no JSON in it. A loaded source's guidance never travels in a tool result. It arrives in the next request's system prompt. Listing a source in the directory contacts nothing. Loading Socrata asks its server for its guidance, and loading Data Commons or Boston OpenContext asks that server for its instructions, as composing the prompt does under `all-sources`.

**What a record states.** A record of an `in-loop` run carries two more keys in its composition block. They are `routing` (`in-loop` and the router's version) and `definitionHash`. Each `load_source` call is a span with its outcome: `loaded`, `declined`, `no-answer`, `unavailable` or `not-offered`. The record's components are the loaded sources and the router. Its tool definitions are the last request's tools. A record of an `all-sources` run has neither key. Leaving the variable unset, or setting it to `all-sources`, changes nothing in it.

**Models.** Every model in the catalog gets `load_source`. There is no per-model switch.

On 2026-10-19 (run `2026-10-19-quote-184845`), each model was sent one source's guidance through OpenRouter, in two shapes. It was asked to quote the guidance's first line and last sentence.

- S1: the guidance inside the `load_source` result. This site does not send this shape.
- S2: the guidance in the next request's system prompt. This is the shape `in-loop` sends.

| Model | Shape | Source | HTTP | Prompt tokens | First line found | Final sentence found | Verdict |
|---|---|---|---|---|---|---|---|
| anthropic/claude-haiku-5.5@low | S1 | socrata | 200 | 14232 | yes | yes | PASS |
| anthropic/claude-haiku-5.5@low | S1 | data_commons | 200 | 6582 | yes | yes | PASS |
| anthropic/claude-haiku-5.5@low | S2 | socrata | 200 | 14298 | yes | yes | PASS |
| anthropic/claude-haiku-5.5@low | S2 | data_commons | 200 | 6657 | yes | yes | PASS |
| anthropic/claude-sonnet-5.5@medium | S1 | socrata | 200 | 14232 | yes | yes | PASS |
| anthropic/claude-sonnet-5.5@medium | S1 | data_commons | 200 | 6582 | yes | yes | PASS |
| anthropic/claude-sonnet-5.5@medium | S2 | socrata | 200 | 14298 | yes | yes | PASS |
| anthropic/claude-sonnet-5.5@medium | S2 | data_commons | 200 | 6657 | yes | yes | PASS |
| anthropic/claude-opus-5.5@medium | S1 | socrata | 200 | 14232 | yes | yes | PASS |
| anthropic/claude-opus-5.5@medium | S1 | data_commons | 200 | 6582 | yes | yes | PASS |
| anthropic/claude-opus-5.5@medium | S2 | socrata | 200 | 14298 | yes | yes | PASS |
| anthropic/claude-opus-5.5@medium | S2 | data_commons | 200 | 6657 | yes | yes | PASS |
| google/gemini-3.5-flash-lite | S1 | socrata | 200 | 2177 | no | no | FAIL |
| google/gemini-3.5-flash-lite | S1 | data_commons | 200 | 4101 | no | yes | FAIL |
| google/gemini-3.5-flash-lite | S2 | socrata | 200 | 9458 | yes | no | FAIL |
| google/gemini-3.5-flash-lite | S2 | data_commons | 200 | 4138 | yes | no | FAIL |
| google/gemini-3.8-flash@medium | S1 | socrata | 200 | 2177 | no | no | FAIL |
| google/gemini-3.8-flash@medium | S1 | data_commons | 200 | 4101 | yes | yes | PASS |
| google/gemini-3.8-flash@medium | S2 | socrata | 200 | 9458 | yes | yes | PASS |
| google/gemini-3.8-flash@medium | S2 | data_commons | 200 | 4138 | yes | yes | PASS |

This site's catalog lists no Google model. An operator who adds one with `MODEL_CATALOG` or `MODEL_CATALOG_PATH` should read these rows. Gemini 3.8 Flash quoted both sources whole in S2. In S1 it said Socrata's result held only a JSON object. Its request counted 2,177 prompt tokens there, against 14,232 on the Anthropic models. Gemini 3.5 Flash Lite failed all four cases. In S2 it found each first line but not the last sentence. Not measured: a data tool's result that mixes prose and JSON (#646).

### The consent pause

When the model loads a source the reader set to Ask first, a run on `/api/compare-stream` or `/api/query-notebook` stops to ask the reader. This happens only under `SOURCE_ROUTING=in-loop`. Under `all-sources`, the default, no question stops.

- **The entry.** The server writes `consent-decision:<key>` to the key-value store that `KV_REST_API_URL` and `KV_REST_API_TOKEN` name, through the same client the rate limiter uses (`src/lib/sources/decision.ts`). The key is 128 random bits. The entry holds the source's id. For a signed-in reader on an instance with a database, it also holds a reader code: HMAC-SHA256 of the account's database id, keyed by `RATE_LIMIT_SECRET` under the pause's own label, never the limiter's. The id itself is never stored. The entry expires 600 seconds (10 minutes) after it is written, and an answer does not extend it (`SET … XX KEEPTTL`).
- **The event.** Only once that write has succeeded, the stream carries a `consent_pause` progress event with the key, the source's entry in the flows statement, the hosts it may reach and the statement's links. The reader's card shows it in the run's steps and in the Sources panel's row for that source.
- **The hold.** The run reads the entry every 500 ms for at most 60 seconds, and holds at most 120 seconds per run and once per source. The card posts the answer to `POST /api/sources/consent/decision` as `{ key, decision }`. `allow` turns that one source On in the reader's consent (the account's row, or the session cookie), and the load goes on as an On source's does. `not-now` changes nothing, and the load records `declined`. No answer in time records `no-answer`.
- **The decision route** answers 404 for a key the store does not hold, 409 for one already answered, 403 for a key minted under another account, and 503 when the store fails or `RATE_LIMIT_SECRET` is unset. An anonymous reader's key is the only check.
- **With no store**, because either variable is unset or a store write fails, the run does not stop: the event says so (`holds: false`), the load records `no-answer` at once, and the card says the source can be turned On in the panel for the next question. There is no in-memory fallback: a pause and its answer can reach different server instances.
- **Who never stops.** `/api/compare`, the JSON route, holds no stream, and replay asks no reader: an Ask-first load there records `declined`.
- **The record.** The key, the reader code and the answer reach no span and no record. A record states the load's outcome, and the load span's duration includes the time the run waited.

## Tool names across sources

The model sees one flat list of tools gathered from several MCP servers, and a
tool's name is the only key a model call carries. Two servers that declare the
same name — the Socrata server's `search` and another server's `search` — could
not both be offered if names were passed through as the servers declare them.
So every tool is offered under its source's **alias**: `<alias>__<upstream
name>`. This is a contract a fork follows when it adds a source, and it is
fixed in hub ADR-0032 (tool naming across sources) and the
`@typedstandards/civic-typed-router` README.

**The eleven tools this codebase offers:**

| Source | Alias | Names the model is offered |
|---|---|---|
| Socrata | `socrata` | `socrata__get_data`, `socrata__search`, `socrata__fetch` |
| Google Data Commons | `data_commons` | `data_commons__search_indicators`, `data_commons__get_observations` |
| Boston OpenContext | `boston` | `boston__ckan__search_datasets`, `boston__ckan__get_dataset`, `boston__ckan__query_data`, `boston__ckan__get_schema`, `boston__ckan__execute_sql`, `boston__ckan__aggregate_data` |

Boston OpenContext's own `ckan__` prefix stays inside the upstream name. The
longest of the eleven is `data_commons__search_indicators`, 31 characters.

### The rule

These are design §6's seven points as ADR-0032 restates them, with the later
rulings folded in:

1. **Three layers.** A source has a global **identity** (its MCP Registry name
   where it is published there; otherwise its package name and repository
   address — the manifest entry's `id`), an operator-chosen **alias** unique
   within one deployment, and model-facing **tool names**
   `<alias>__<upstream tool name>`.
2. **Applied by this app at the registry boundary,** in the tools array and
   the prompt, and reversed on dispatch. The server is always called by its
   own name: `socrata__get_data` goes out on the wire as `get_data`. No
   publisher is asked to rename anything.
3. **64 characters from `[A-Za-z0-9_-]`,** the bound the model APIs impose,
   which is tighter than the MCP specification's own. A name that would break
   the bound or the character set is **normalized, not refused**: each
   out-of-set character becomes `_`, and an over-long name is cut to 55
   characters and ends in `_` and an eight-character hash of the name it came
   from, the same on every run. Both names are kept in the dispatch map.
4. **Startup fails loudly** on an ill-formed alias, an alias or a source id
   two entries share, or two tools whose exposed names collide after
   normalizing — never a silent last-write-wins. The router package runs these
   checks when its router is built, so a manifest that fails them stops the
   app before it serves anything.
5. **The record states both names.** A call is recorded under the name the
   model called; its trace span adds the upstream name (`tool.upstream_name`),
   the alias (`mcp.alias`), the source (`mcp.source`) and the server's
   identity (`mcp.server.id`), so no reader has to resolve an alias, and a fork
   may rename its aliases freely.
6. **It is a fork-facing contract,** stated here, in ADR-0032 and in the
   router package's README.
7. **The eleven existing tools are renamed under the same rule.** Every record
   made before the rename names them bare (`get_data`), every record made
   after names them aliased (`socrata__get_data`), and every reader in this
   codebase — replay, both notebook generators, the record page's operation
   types and data sources, the tool-call identity a consistency attestation
   keys on — reads both spellings by the upstream name.

Four rules complete it:

- A name starts with a letter or an underscore; every exposed name matches
  `^[A-Za-z_][A-Za-z0-9_-]{0,63}$`.
- An alias contains no `__`, starts with a letter or an underscore, holds only
  `[A-Za-z0-9_-]`, and is at most 32 characters, so every exposed name keeps
  room for its tool's own name. Two sources never share an alias.
- Dispatch goes through a map built at startup, from each exposed name to its
  source, alias and upstream name — **never by splitting a name**, because an
  upstream name may itself hold `__` (`ckan__search_datasets`).
- Per call, the record holds the exposed name, the upstream name, the alias and
  the server identity.

### The dispatch rule

A model can still call a bare name: one it read in a tool result (servers name
their own tools in their answers, and this app does not rewrite tool results),
or one at a place in a server's guidance the rewrite below does not reach. So:

- an exposed name resolves by the map;
- **a bare upstream name is accepted when exactly one offered source has it,**
  and goes to that source;
- **a bare name two or more offered sources have is refused before any request
  is made,** and the model is told every aliased form it could call instead.
  The reader sees the generic error copy and the record states the call as
  failed (`unknown`); the refusal's own text reaches neither;
- a name whose source this instance does not configure is refused naming the
  variable that would configure it, in either spelling, as before;
- a name no source has is refused.

### How text names a tool

- **Text the router package owns** — the prompt frame, the three civic
  guidance blocks, the one-portal section, and every tool and parameter
  description — names each tool through the view it is composed in, so the
  aliased text is exact and mechanically reversible. Where `search` or `fetch`
  is an English word ("a web search", "fetch the next page"), it stays a word.
- **Text a source sends** — the guidance the Socrata server serves, and a
  server's initialize instructions — gets the **anchored rewrite**, scoped to
  that source's own tool names: an exact backtick, bold or double-quoted token,
  an exact markdown table cell, or an item of a `Tools:` list is renamed, and
  nothing else changes. A name at no anchor stays as the server wrote it (the
  Socrata guidance has two: a fenced `Tool: get_data` line and the header cell
  "get_data coverage"); the dispatch rule above covers a model that calls it.

### Adding a source

A fork adds a source with **one manifest entry** in the router package's shape:

- `id` — the source's global identity;
- `alias` — the prefix of every name the model is offered for its tools;
- `sourceId` — the key it is routed, traced and recorded under;
- `displayName`;
- `description` — one line written for routing: what the source covers, for
  which places, and what it cannot do;
- `freshness` — one line on how current its data is (model-facing, so no
  citation; put that in `freshnessSource`);
- its configuration (the address variable, and whether it is required or
  optional), its tool schemas, its routing list of tool names, and its
  guidance.

The router builds the aliased tools, the composed prompt and the dispatch map
from that entry; the startup checks refuse an entry whose names cannot be
exposed. On the app side the source also needs its server in
`src/lib/mcp/registry.ts` (its address, headers, and the alias and identity it
takes from the manifest) and its address in `MCP_SOURCE_ADDRESS_FIELD`.

## Vocabulary notes for integrators

If you build against your instance's API, three vocabulary facts prevent
wrong turns:

- **Visibility states are `sealed` and `public` — only.** `sealed` is
  signed + timestamped + transparency-logged but unlisted content;
  `public` adds the publication attestation pair and served content.
  (Older spellings are accepted as input aliases for compatibility;
  everything the API *emits* uses the current vocabulary.)
- **Unsigned is a signing status, not a third visibility value.** An
  unsigned package precedes the signed lifecycle entirely and can reach
  neither state ([ADR-0020]).
- **`visibility` and `listed` are orthogonal axes.** `visibility` is
  content disclosure; `listed` is whether *this host* shows the record
  in its own index. They may legitimately disagree —
  `{"visibility": "sealed", "listed": true}` is not a contradiction.
  `isPublic` survives in responses as a read-back alias of `listed`;
  prefer `listed`.

The integrator-facing API contract, including the publish endpoint,
bundle export, and the full lifecycle semantics, is
[`docs/api/records-publish.md`](api/records-publish.md).

## Appendix A: first-time S3 on a public cloud

Provisioning object storage for this app, written for an operator who
has never used a cloud object store. The walkthrough uses AWS S3
console naming; any S3-compatible provider has equivalents for each
piece. Budget well under an hour.

The walkthrough builds the **public bucket**, the default
([Two bucket choices](#two-bucket-choices)); the
[private variant](#private-variant-no-public-read) below lists the
steps that differ. It authenticates the app with a service account's
access key; on a platform that provides a role, the
[role alternative](#role-alternative-no-access-key) needs no key.

What you are building, in plain terms:

| Thing | What it is |
| --- | --- |
| **Bucket** | A named container for files, with a globally unique name and its own permissions. |
| **Bucket policy** | JSON attached to the bucket saying who may do what. For a public bucket you paste one letting anyone *read* objects, and nothing else; a private bucket has none. |
| **Service account** (AWS: IAM user) | A robot account whose access key — an ID and a secret — is what the app authenticates with. |
| **Role** (the alternative) | An identity the platform running the app provides (on ECS, the task role; on EC2, the instance profile). The app takes its short-lived credentials from the AWS SDK's default chain and holds no access key. |
| **Scoped policy** | Permissions attached to that account (or role), restricted to this one bucket. |

### Two constraints this app's driver imposes

Both fail confusingly if missed, and both are properties of the driver
(`src/lib/storage/s3.ts`), not of the cloud provider:

1. **No dots in the bucket name** (when `S3_ENDPOINT` is unset). The
   driver builds virtual-hosted public URLs —
   `https://<bucket>.s3.<region>.amazonaws.com` — and a dotted name
   breaks the TLS certificate, so public reads die with an encryption
   error rather than a permissions one. Use lowercase and hyphens only.
2. **`S3_REGION` must match where the bucket actually lives.** It feeds
   that same URL and defaults to `us-east-1`; omitting it while creating
   the bucket elsewhere points at a real host that isn't yours.

### Create the bucket

In the S3 console, create a bucket with:

- **Type: general purpose**, in the **global namespace** (variants like
  express/directory buckets and account-regional namespaces are
  addressed differently — the driver's URL construction does not exist
  for them).
- **Name:** lowercase, hyphens, no dots — e.g.
  `example-record-store`.
- **Object ownership: ACLs disabled** (public access comes from the
  bucket policy, not per-object ACLs).
- **Block-public-access: off** for the public bucket — uncheck "Block
  all public access" and acknowledge. Without this the public-read
  policy below cannot be saved. (The private variant leaves it on.)
- **Encryption: the provider-managed default (AWS: SSE-S3), not
  KMS-managed keys.** This one follows ordinary security instincts
  right into a trap: under SSE-KMS, anonymous readers would need key
  decrypt permission, so public reads fail with an access error that
  looks nothing like an encryption problem.
- **Versioning and object lock: off** unless you will manage the
  interaction yourself — with versioning on, a delete leaves a delete
  marker rather than removing the object, which complicates the GC
  sweep's semantics.

### Public-read policy (public bucket only)

Bucket → Permissions → Bucket policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    }
  ]
}
```

This grants reading of objects only — anonymous users still cannot
list, upload, or delete. The console then badges the bucket **publicly
accessible**, which is expected for the public bucket: its published
record packages are world-readable by design, and pre-publication
content is protected by unguessable keys, not ACLs
([Two bucket choices](#two-bucket-choices)).

### Private variant: no public read

For the private bucket
([Two bucket choices](#two-bucket-choices)), every step above and below
is the same except these:

- **Block-public-access: on** — leave "Block all public access" checked,
  the console default.
- **No bucket policy.** Skip the public-read policy; the scoped service
  account (or role) below is the only reader. The console does not badge
  the bucket publicly accessible.
- **Encryption:** SSE-S3 remains the simple choice. SSE-KMS works here,
  because no anonymous reader is involved, provided the service account
  (or role) is also allowed to use the key.
- **`SITE_SEAL_ONLY=1`** on the deployment, before it serves anyone:
  a private bucket requires public publishing off.
- **Rehearse with `--private-bucket`**, which asserts that legs 1 and 3's
  anonymous reads are refused; see
  [Validating a storage configuration](#validating-a-storage-configuration).

### Scoped service account

(On a platform that provides a role, read
[Role alternative](#role-alternative-no-access-key) first: you attach
the policy below to the role and create no account or key.)

Create a service account (AWS: IAM → Users → Create user, no console
access, attach nothing), then attach an inline policy scoped to this
bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AppObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    },
    {
      "Sid": "AppList",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME"
    }
  ]
}
```

The bucket is named **twice**, once with `/*` and once without — not a
typo. In the S3 permission model the bucket and the objects in it are
different resources: listing acts on the bucket, reading and writing act
on objects.

Create an access key for the account (AWS: Security credentials →
Create access key → "Application running outside AWS"). The secret is
shown **once** — store it in your secret manager immediately. If lost,
delete the key and mint another rather than hunting for a recovery.

### Role alternative: no access key

If the platform that runs the app provides a role (on ECS, the task
role; on EC2, an instance profile), skip the service account and its
access key. Attach the same scoped policy above to that role instead,
and set neither `S3_ACCESS_KEY_ID` nor `S3_SECRET_ACCESS_KEY`. The
driver then takes the role's short-lived credentials from the AWS SDK's
default chain, and its startup line reads `credential source: the AWS
SDK default chain` ([Credentials](#credentials-a-key-pair-or-the-sdks-default-chain)).
Two things differ from a key pair: there is no long-lived secret to
store or rotate, and a presigned upload URL lives no longer than the
role session it was signed under, which can be less than its hour.

### Wire it up and rehearse

Store the values in your secret manager and reference them from an
environment file — placeholders only on disk, `chmod 600`, never
committed. With the 1Password convention that file looks like:

```bash
BLOB_DRIVER=s3
S3_BUCKET=op://<vault-id>/<item>/bucket
S3_ACCESS_KEY_ID=op://<vault-id>/<item>/access-key-id
S3_SECRET_ACCESS_KEY=op://<vault-id>/<item>/password
S3_REGION=us-east-1
```

(Use the vault **ID**, not its name — IDs survive renames and avoid
fragile references. Any other secret manager's injection mechanism works
the same way.) For AWS proper, omit `S3_ENDPOINT` and
`S3_PUBLIC_BASE_URL` entirely — setting the endpoint flips the driver
into path-style addressing meant for MinIO-style hosts. On the role
alternative, leave out both key lines: the file holds no secret at all.

Then validate the whole setup before pointing the app at it (on the
role alternative, from where the role applies; see
[Validating a storage configuration](#validating-a-storage-configuration)):

```bash
op run --env-file=<your-env-file> -- node scripts/rehearse-storage-s3.mjs
```

`RESULT: PASS — 4/4 legs` — with the GC leg shielding exactly **one**
pre-existing object on a fresh bucket, the harness's own grant-leg
upload — means the bucket, policy, account or role scoping, region, and
public-URL construction are all correct. Hand the same `S3_*` values
(four with a key pair, two on the role alternative) to your deployment
and go. On the private variant, add `--private-bucket`; the expected end
state is the same `RESULT: PASS — 4/4 legs`, with legs 1 and 3 asserting
that their anonymous reads are refused.

[ADR-0016]: https://github.com/npstorey/civic-ai-tools/blob/main/docs/adr/0016-vcs-native-lifecycle-mapping.md
[ADR-0020]: https://github.com/npstorey/civic-ai-tools/blob/main/docs/adr/0020-instance-key-custody.md
[ADR-0023]: https://github.com/npstorey/civic-ai-tools/blob/main/docs/adr/0023-notebook-executor-driver.md
[#221]: https://github.com/npstorey/civic-ai-tools-website/issues/221
[#225]: https://github.com/npstorey/civic-ai-tools-website/issues/225
