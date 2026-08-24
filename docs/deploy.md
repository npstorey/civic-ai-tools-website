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
12. [Vocabulary notes for integrators](#vocabulary-notes-for-integrators)
13. [Appendix A: first-time S3 on a public cloud](#appendix-a-first-time-s3-on-a-public-cloud)

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
# → {"signingConfigured":false}

# Migrations applied — the visibility enum lists four labels
# (published, committed, sealed, public):
docker compose exec postgres psql -U civic -d civic -c '\dT+ visibility'
```

The `psql` commands in this guide use the placeholder `civic` user and
database; substitute your own values wherever you override
`POSTGRES_USER` / `POSTGRES_DB`.

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
every CI run, so a variable that reaches this guide without reaching the
container fails the build.

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
| Notebook executor | `EXECUTOR_DRIVER` | `vercel-sandbox`, `container` | `vercel-sandbox` | `container` |

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
  microVM and needs platform auth off-deploy. `container` runs the
  prebuilt `civic-notebook-executor` image on the host's container
  runtime — which is what requires the socket mount discussed above.
  `EXECUTOR_CONTAINER_IMAGE` overrides the image tag (default
  `civic-notebook-executor:0.1.0`).

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
them, and on the built-in catalog `openai/gpt-4o` is the first:

```bash
curl -s -X POST http://127.0.0.1:3000/api/compare \
  -H 'Content-Type: application/json' \
  -d '{"query":"test","model":"openai/gpt-4o"}'
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

## Environment reference, tier by tier

The executable authority on the environment is
[`scripts/preflight-env.mjs`](../scripts/preflight-env.mjs): it checks
the **presence** (never the value) of every variable the app reads,
resolves the three driver selectors first, and tiers every other
variable against the resolved profile — so a self-hosted instance is
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
represent the compose profile explicitly. Presence is all that is
checked, never values, so fixed stand-ins do for whatever compose
supplies — and by the same token a PASS says nothing about the value:
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
stand-ins alone, it exits `1` naming exactly the thirteen operator-supplied
variables — `MODEL_API_KEY`, `SOCRATA_MCP_URL`, `PUBLISHER_SIGNING_KEY`,
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
for your driver are hard requirements of the publish path.)

**The core query path fails without:**

| Variable | Absent means |
| --- | --- |
| `MODEL_API_KEY` | Every query fails fast with the typed error above. No fallback. Its prior-era name `OPENROUTER_API_KEY` still satisfies it. |
| `MODEL_CATALOG` / `MODEL_CATALOG_PATH` | Only when `MODEL_API_BASE_URL` names something other than the built-in endpoint, or `MODEL_API_KIND=azure-openai`: the instance refuses rather than trusting a model list written for a different endpoint. Under the built-in endpoint, absence is the configured state. |
| `SOCRATA_MCP_URL` | Every data query refuses with a typed error naming this variable. No fallback — this used to default to the project's hosted endpoint, which silently routed an unconfigured instance's queries through infrastructure it does not operate. Set it to the Socrata MCP deployment this instance should query. Pointing it at another operator's endpoint (the project's hosted one included) is a real choice, but understand what it means: your users' queries route through that host's infrastructure, not yours. |

**Absence disables a specific feature** (the app runs; the feature
doesn't):

| Variable(s) | Feature disabled when absent |
| --- | --- |
| `PUBLISHER_SIGNING_KEY` + `PUBLISHER_KEY_ID` + the instance-identity set (`PUBLISHER_SITE_ORIGIN`, `PUBLISHER_SIGNER_BINDING_TIER`/`_IDENTIFIER`/`_DISPLAY_NAME`, `PUBLISHER_PLATFORM_AGENT_TITLE`) | Record seal and publish. **All-or-nothing: every member is required, and none has a coded default.** With none set the instance stays in the unsigned tier (banner shows, seal and publish gated off) — and unsigned surfaces honestly *omit* instance attribution rather than substitute anyone else's. With the key set but no `PUBLISHER_KEY_ID` it refuses (`signing_key_id_missing`) rather than sign under a key id it never declared. With the pair set but the identity set incomplete it refuses (`instance_identity_missing`, naming the exact missing variables) rather than emit signed output carrying an origin, signer, or registry this instance never configured — either substitution would misattribute the publisher and fail verification. |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, and an OAuth app (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` or the `OIDC_*` set) | Sign-in — and with it the sign-in-gated notebook execution feature, the dashboard, and the higher authenticated rate limit. |
| `DATA_COMMONS_MCP_URL` + `DATA_COMMONS_API_KEY` | The Data Commons data source — its tool calls fail without the key (the hosted endpoint mandates it). `DC_API_KEY` is the separate key passed into *executed notebooks* for their own Data Commons requests. |
| `BOSTON_OPENCONTEXT_MCP_URL` | The Boston OpenContext data source. |
| `CRON_SECRET` | The scheduled blob-GC endpoint rejects every caller with 401 — orphaned uploads are never swept. Set the same value on the app and the scheduler. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Durable rate limiting — the counter falls back to per-process memory (resets on restart; not shared across instances). Fine for a single-node instance. |
| `SANDBOX_SNAPSHOT_ID` | (vercel-sandbox executor only) Prebuilt snapshot — absent, every execution pays a slow fresh boot + pip install. Not read by the container executor. |
| `SOCRATA_APP_TOKEN` | Socrata API app token passed into executed notebooks — absent, requests run anonymously against Socrata's lower rate limits. |
| `ROADMAP_RAW_URL` | `/roadmap` — absent, the page states that this instance has published no roadmap and the Roadmap link leaves the header and footer nav. An instance serves its own roadmap or none; there is no upstream fallback. |
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
`APP_ONLY` — with none set, the instance serves the app surface only:
the marketing pages 404 and `/` redirects to `/ask`. `SERVE_MARKETING`
is the one variable whose unset state is the correct state for an
instance; see [Host topology](#host-topology-optional)),
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
`MAX_TOOL_RESULT_CHARS`),
`S3_REGION` / `S3_FORCE_PATH_STYLE` / `S3_PUBLIC_BASE_URL` (coded
defaults described in the storage section), and analytics
(`NEXT_PUBLIC_GA_MEASUREMENT_ID`).

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
delivers them. A restart without `--build` does not.

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
numbered SQL under [`drizzle/`](../drizzle/). Two application paths,
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

## Object storage: configuration and rehearsal

With `BLOB_DRIVER=s3`, the storage seam works against any S3-compatible
endpoint. The contract (resolved in
[`src/lib/storage/s3.ts`](../src/lib/storage/s3.ts)):

| Variable | Required | Meaning / default |
| --- | --- | --- |
| `S3_BUCKET` | yes | Bucket for record-package objects. |
| `S3_ACCESS_KEY_ID` | yes | Access key. |
| `S3_SECRET_ACCESS_KEY` | yes | Secret key. |
| `S3_ENDPOINT` | no | Endpoint URL (e.g. `http://minio:9000`). **Omit for AWS S3 proper.** |
| `S3_REGION` | no | Default `us-east-1`. Must match where the bucket actually lives — it feeds the public URL. |
| `S3_FORCE_PATH_STYLE` | no | Default: `true` when `S3_ENDPOINT` is set (MinIO needs path-style), `false` otherwise. |
| `S3_PUBLIC_BASE_URL` | no | Public base for object URLs. Default: `<endpoint>/<bucket>` when `S3_ENDPOINT` is set, else the AWS virtual-hosted URL `https://<bucket>.s3.<region>.amazonaws.com`. |

Object URLs are handed to **browsers**, so `S3_PUBLIC_BASE_URL` must be
an address a browser can reach — not an in-network endpoint like
`http://minio:9000`. Keep its last path segment equal to `S3_BUCKET`
(the compose default does this).

Objects are world-readable by design: published record packages are
public content, and the confidentiality of a not-yet-published (sealed)
package rests on its unguessable random key, not on bucket ACLs. The
compose stack's `minio-init` applies this policy for you; on a public
cloud you apply it yourself
([Appendix A](#appendix-a-first-time-s3-on-a-public-cloud)).

### Validating a storage configuration

[`scripts/rehearse-storage-s3.mjs`](../scripts/rehearse-storage-s3.mjs)
drives four legs through the real storage seam against whatever
S3-compatible endpoint the environment provides: content-addressed
round-trip byte parity, the presigned-PUT client-upload grant (including
the policy rejections), anonymous public read, and the GC sweep run
hermetically. It refuses to run unless `BLOB_DRIVER=s3`, touches only
objects it creates, deletes them all in teardown, never prints a
credential value, and exits `0` only when all four legs pass (`2` for a
config problem — it names the variable; `1` for a failed leg).

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
- **Rate limiting:** `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash
  via the platform) make the counter durable.
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

What you are building, in plain terms:

| Thing | What it is |
| --- | --- |
| **Bucket** | A named container for files, with a globally unique name and its own permissions. |
| **Bucket policy** | JSON attached to the bucket saying who may do what. You will paste one letting anyone *read* objects, and nothing else. |
| **Service account** (AWS: IAM user) | A robot account whose access key — an ID and a secret — is what the app authenticates with. |
| **Scoped policy** | Permissions attached to that account, restricted to this one bucket. |

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
- **Block-public-access: off** — uncheck "Block all public access" and
  acknowledge. Without this the public-read policy below cannot be
  saved.
- **Encryption: the provider-managed default (AWS: SSE-S3), not
  KMS-managed keys.** This one follows ordinary security instincts
  right into a trap: under SSE-KMS, anonymous readers would need key
  decrypt permission, so public reads fail with an access error that
  looks nothing like an encryption problem.
- **Versioning and object lock: off** unless you will manage the
  interaction yourself — with versioning on, a delete leaves a delete
  marker rather than removing the object, which complicates the GC
  sweep's semantics.

### Public-read policy

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
accessible**, which is expected: published record packages are
world-readable by design, and pre-publication content is protected by
unguessable keys, not ACLs
([Object storage](#object-storage-configuration-and-rehearsal)).

### Scoped service account

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
into path-style addressing meant for MinIO-style hosts.

Then validate the whole chain before pointing the app at it:

```bash
op run --env-file=<your-env-file> -- node scripts/rehearse-storage-s3.mjs
```

`RESULT: PASS — 4/4 legs` — with the GC leg shielding exactly **one**
pre-existing object on a fresh bucket, the harness's own grant-leg
upload — means the bucket, policy, account scoping, region, and
public-URL construction are all correct. Hand the same four `S3_*`
values to your deployment and go.

[ADR-0016]: https://github.com/npstorey/civic-ai-tools/blob/main/docs/adr/0016-vcs-native-lifecycle-mapping.md
[ADR-0020]: https://github.com/npstorey/civic-ai-tools/blob/main/docs/adr/0020-instance-key-custody.md
[ADR-0023]: https://github.com/npstorey/civic-ai-tools/blob/main/docs/adr/0023-notebook-executor-driver.md
[#221]: https://github.com/npstorey/civic-ai-tools-website/issues/221
[#225]: https://github.com/npstorey/civic-ai-tools-website/issues/225
