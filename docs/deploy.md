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

You need:

- A host with **Docker Engine and Compose v2** (`docker compose`, not the
  legacy `docker-compose`).
- A **model API key**. The app speaks the OpenAI-compatible
  chat-completions API; by default it points at OpenRouter and reads
  `OPENROUTER_API_KEY`. Any OpenAI-compatible endpoint works via
  `MODEL_API_BASE_URL` (the key stays in `OPENROUTER_API_KEY` either
  way). Without a key the app starts and serves pages, but every query
  fails fast with an operator-actionable error (shown
  [below](#the-model-seam)).
- **Node.js ≥ 22** on the host if you want to run the preflight and
  rehearsal scripts from the checkout (recommended; the containers
  themselves don't need it).

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
  signing key is configured, so evidence commit and publish are disabled
  and any output produced here carries no cryptographic commitment.
  Signing is the go-to-production step; see the instance setup guide."*
- Evidence **commit and publish actions are gated off**, server-side and
  in the UI. An unsigned package can reach neither the `sealed` nor the
  `public` state ([ADR-0020]) — the unsigned tier is confined to local
  produce-and-inspect. This is the intended first-run state, not a
  failure: analyses run, packages can be produced and inspected, and
  signing is a deliberate later step
  ([Instance identity and signing](#instance-identity-and-signing-go-to-production)).
- Queries fail until you supply a model key (next step), with an error
  that names the missing variable.

Verify the bring-up:

```bash
# Unsigned tier, reported truthfully:
curl -s http://127.0.0.1:3000/api/evidence/signing-status
# → {"signingConfigured":false}

# Migrations applied — the visibility enum lists four labels
# (published, committed, sealed, public):
docker compose exec postgres psql -U civic -d civic -c '\dT+ visibility'
```

The `psql` commands in this guide use the placeholder `civic` user and
database; substitute your own values wherever you override
`POSTGRES_USER` / `POSTGRES_DB`.

### Supplying your environment

Configuration is run-time only — no environment file enters the image
build. Entries the compose file lists as a bare `NAME` (no value) are
pass-through: set in the container only when your environment has them,
absent otherwise. Put your values in a file of `KEY=value` lines.

A minimal first environment file (placeholders — substitute your own,
and never commit this file):

```bash
# Model access — required for every query.
OPENROUTER_API_KEY=<your-model-api-key>

# Real service passwords replacing the local-dev placeholders.
POSTGRES_PASSWORD=<generated>
S3_ACCESS_KEY_ID=<generated>
S3_SECRET_ACCESS_KEY=<generated>

# Sign-in (see the sign-in section; enables notebook execution).
NEXTAUTH_SECRET=<generated: openssl rand -base64 32>
NEXTAUTH_URL=<your public origin, e.g. https://evidence.example.org>
GITHUB_CLIENT_ID=<your OAuth app>
GITHUB_CLIENT_SECRET=<your OAuth app>
```

Anything spelled `${VAR:-default}` in the compose file is overridable
this way — the service passwords, host ports, bucket name,
`S3_PUBLIC_BASE_URL`, `APP_BIND`/`APP_PORT`, the executor image tag, the
identity variables, `NEXTAUTH_URL`, and the GC knobs — in addition to
the bare-`NAME` pass-throughs. The three driver selectors,
`S3_ENDPOINT`, and the constructed `DATABASE_URL` are hardcoded wiring:
changing those means editing the compose file, not the env file.

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
service you supply, not a container in the stack. `MODEL_API_BASE_URL`
selects any OpenAI-compatible chat-completions endpoint (default:
OpenRouter); `OPENROUTER_API_KEY` is the credential in either case.

Missing or rejected model keys **fail fast with typed errors** — there
is no silent hang to diagnose. Recognize them:

- Key missing or empty — the server logs and streams:

  > No model API key is configured: OPENROUTER_API_KEY is missing or
  > empty in the server environment. Set it (any OpenAI-compatible
  > endpoint configured via MODEL_API_BASE_URL still reads its key from
  > OPENROUTER_API_KEY) and restart the server.

  and the page shows: *"This server has no AI model API key configured,
  so queries can't run. If you operate this instance, set
  OPENROUTER_API_KEY in the server environment and restart."*

- Key present but refused upstream (HTTP 401/403 from the endpoint) —
  the page shows: *"The AI model service rejected this server's API key,
  so the query couldn't run. If you operate this instance, check that
  OPENROUTER_API_KEY is valid for the configured endpoint."*

Both are reproducible from the command line against a running stack:

```bash
curl -s -X POST http://127.0.0.1:3000/api/compare \
  -H 'Content-Type: application/json' \
  -d '{"query":"test","model":"openai/gpt-5-mini"}'
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

## Environment reference, tier by tier

The executable authority on the environment is
[`scripts/preflight-env.mjs`](../scripts/preflight-env.mjs): it checks
the **presence** (never the value) of every variable the app reads,
resolves the three driver selectors first, and tiers every other
variable against the resolved profile — so a self-hosted instance is
neither passed while unrunnable nor nagged about variables its profile
never reads. Preflight reads only the shell environment it runs in. **Run off-stack,
it cannot see what compose wires in** — the three driver selectors,
`DATABASE_URL`, and the `S3_*` set live inside `docker-compose.yml` — so
a bare `node scripts/preflight-env.mjs` reports the *default managed
profile* and fails demanding variables the compose path never uses
(`BLOB_READ_WRITE_TOKEN` among them). To preflight a compose deployment,
represent the compose profile explicitly. Presence is all that is
checked, never values, so fixed stand-ins are fine for the
compose-wired variables. From the checkout, with your own env-file
values also in the environment (exported, or through your
secret-manager wrapper):

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
stand-ins alone, it exits `1` naming exactly the six operator-supplied
variables — `OPENROUTER_API_KEY`, `EVIDENCE_SIGNING_KEY`,
`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`.

**Read preflight's "required" tier honestly.** It is the
full-production bar, not the boot bar. Nothing on the list prevents the
process from *starting* — initialization is lazy throughout — so
"required" means a load-bearing request path fails without it. In
particular, a deliberate unsigned-tier bring-up **fails preflight**,
naming `EVIDENCE_SIGNING_KEY` and the sign-in variables: that FAIL is
your remaining go-to-production to-do list, not a broken stack.

The tiers, stated plainly:

**Provided by the compose stack by construction.** You do not set these
for the compose path; they are wired between services:
`DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`, the three driver
selectors, and `EXECUTOR_CONTAINER_IMAGE`. (Off compose, they are yours:
`DATABASE_URL` plus the storage set for your driver are hard
requirements of the evidence path.)

**The core query path fails without:**

| Variable | Absent means |
| --- | --- |
| `OPENROUTER_API_KEY` | Every query fails fast with the typed error above. No fallback. |

`SOCRATA_MCP_URL` (the demo data source) has a coded fallback to the
project's hosted endpoint, so queries work without it — but they are
then leaving your infrastructure; a fully self-contained instance sets
it to its own Socrata MCP deployment.

**Absence disables a specific feature** (the app runs; the feature
doesn't):

| Variable(s) | Feature disabled when absent |
| --- | --- |
| `EVIDENCE_SIGNING_KEY` + `EVIDENCE_KEY_ID` | Evidence commit/publish — the instance stays in the unsigned tier: banner shows, seal and publish are gated off. |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, and an OAuth app (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` or the `OIDC_*` set) | Sign-in — and with it the sign-in-gated notebook execution feature, the dashboard, and the higher authenticated rate limit. |
| `DATA_COMMONS_MCP_URL` + `DATA_COMMONS_API_KEY` | The Data Commons data source — its tool calls fail without the key (the hosted endpoint mandates it). `DC_API_KEY` is the separate key passed into *executed notebooks* for their own Data Commons requests. |
| `BOSTON_OPENCONTEXT_MCP_URL` | The Boston OpenContext data source. |
| `CRON_SECRET` | The scheduled blob-GC endpoint rejects every caller with 401 — orphaned uploads are never swept. Set the same value on the app and the scheduler. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Durable rate limiting — the counter falls back to per-process memory (resets on restart; not shared across instances). Fine for a single-node instance. |
| `SANDBOX_SNAPSHOT_ID` | (vercel-sandbox executor only) Prebuilt snapshot — absent, every execution pays a slow fresh boot + pip install. Not read by the container executor. |
| `SOCRATA_APP_TOKEN` | Socrata API app token passed into executed notebooks — absent, requests run anonymously against Socrata's lower rate limits. |

**Merely overrides a default.** Everything else, including:
`MODEL_API_BASE_URL` (endpoint override), the instance-identity set
(`EVIDENCE_SITE_ORIGIN`, `EVIDENCE_SIGNER_*`, `EVIDENCE_PLATFORM_AGENT_*`,
`EVIDENCE_PUBLICATION_HOST`, the registry-URL overrides — with none set,
the demo deployment's values are emitted; see
[`docs/instance-setup.md`](instance-setup.md)), `OIDC_PROVIDER_NAME`
(button label), `SIGN_IN_ALLOWLIST` (unset or empty = open sign-in,
exactly the pre-allowlist behavior; see the sign-in section),
the host-topology set (`APP_HOST`, `MARKETING_HOST`, `APP_ONLY` — with
none set, every route serves on every host, exactly the single-host
behavior; see [Host topology](#host-topology-optional)),
rate-limit and token-budget tuning knobs
(`ANONYMOUS_RATE_LIMIT`, `AUTHENTICATED_RATE_LIMIT`,
`APP_TIER_RATE_LIMIT`, `TOKEN_LIMIT_PER_REQUEST`,
`MAX_TOOL_RESULT_CHARS`),
`S3_REGION` / `S3_FORCE_PATH_STYLE` / `S3_PUBLIC_BASE_URL` (coded
defaults described in the storage section), and analytics
(`NEXT_PUBLIC_GA_MEASUREMENT_ID`).

One build-time caveat: `NEXT_PUBLIC_*` values are inlined into client
bundles at build time. They belong to the image build, not to `docker
compose up` — a pass-through at run time cannot change them.

## Sign-in configuration

Sign-in is what unlocks the executed-notebook feature, the publisher
dashboard, and the higher authenticated rate limit. It needs three
things: a session secret, your public origin, and at least one OAuth
provider you register yourself.

Always:

| Variable | Meaning |
| --- | --- |
| `NEXTAUTH_SECRET` | Session encryption secret. Generate one: `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | Your instance's public origin (e.g. `https://evidence.example.org`). Must match what browsers actually use — OAuth callbacks are built from it. |

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

By default an instance is a single host and every route serves on it —
nothing in this section is required, and with none of the three
variables set the routing middleware passes every request through
untouched. Set them to split the public face from the gated app
surface, or to run an app-only instance with no public face at all.
The decision logic lives in `src/lib/host-routing.ts` (unit-tested;
`src/proxy.ts` is a thin adapter over it).

| Variable | Meaning |
| --- | --- |
| `APP_HOST` | The host that serves the gated app surface. On it, `/` temporarily redirects to `/evidence` (a later release mounts the signed-in query surface at `/`; the dashboard is not the target because it bounces signed-out visitors back to `/`, which would loop), the marketing pages return 404, and the dashboard, device pairing, and evidence routes all serve. |
| `MARKETING_HOST` | The host that serves the public face. On it, the marketing pages and the public evidence registry serve exactly as on a single host, and the app-private routes — `/dashboard`, `/auth/device`, `/dev/notebook-preview` — return 404. |
| `APP_ONLY` | `1` or `true`: an app-only instance. Every request on every host gets the app-surface behavior above; `APP_HOST`/`MARKETING_HOST` are ignored. For operators deploying only the gated surface, with no marketing site. |

Values are host names (`app.example.org`); a full origin
(`http://localhost:3000`) is also accepted, and matching is
case-, port-, and `www.`-insensitive. Three properties worth
internalizing:

- **Roles are claimed, never assumed.** A request on a host matching
  neither variable — a preview deployment, a health check by IP, an
  alias you have not named — is served exactly as if no topology were
  configured. That makes the rollout incremental: set `APP_HOST` first
  and verify the app host, then set `MARKETING_HOST` to switch on the
  withholding.
- **The evidence registry is dual-served on purpose.** `/evidence` and
  `/evidence/<slug>` are public product surface; published links must
  keep resolving on the public face, and the app surface serves them
  too. `/api/*`, `/.well-known/*`, and static assets likewise serve on
  every host.
- **Withholding is topology, not security.** The 404s shape which host
  presents which surface; access control is sign-in
  (`SIGN_IN_ALLOWLIST`) and the per-route session checks, which apply
  identically on every host.

Two split-host interactions to plan for: `NEXTAUTH_URL` can point at
only one host, and sessions are per-host cookies — decide which host
users sign in on (for a gated app surface, normally the app host) and
point `NEXTAUTH_URL` and your OAuth callback URLs there. The
device-pairing URL the API hands to CLI clients already follows
`APP_HOST` when it is set, since `/auth/device` is withheld on the
marketing host.

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
`EVIDENCE_SIGNING_KEY` + `EVIDENCE_KEY_ID` and the identity variables,
smoke-test a publish). Key changes after that follow
[`docs/key-rotation.md`](key-rotation.md).

Two facts worth restating from the deploy side:

- With the signing pair unset, the compose stack runs the unsigned tier
  correctly — this guide's bring-up **is** the unsigned tier. Configuring
  signing is what makes the seal/publish actions reachable.
- `EVIDENCE_SIGNING_KEY` is the most sensitive value your instance
  holds. Keep it in your secret manager; never commit it, paste it into
  an agent session, or bake it into an image.

## Object storage: configuration and rehearsal

With `BLOB_DRIVER=s3`, the storage seam works against any S3-compatible
endpoint. The contract (resolved in
[`src/lib/storage/s3.ts`](../src/lib/storage/s3.ts)):

| Variable | Required | Meaning / default |
| --- | --- | --- |
| `S3_BUCKET` | yes | Bucket for evidence objects. |
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

Objects are world-readable by design: published evidence packages are
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
[`docs/api/evidence-publish.md`](api/evidence-publish.md).

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
  `example-evidence-store`.
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
accessible**, which is expected: published evidence packages are
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
