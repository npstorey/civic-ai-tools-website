#!/usr/bin/env node
/**
 * Instance environment preflight.
 *
 * Checks the PRESENCE (never the value) of the environment variables an
 * instance of civic-ai-tools-website needs to run, and prints a grouped
 * pass/fail table. Several of these vars fail silently or with a generic
 * error when absent (DATABASE_URL, the storage credentials,
 * PUBLISHER_SIGNING_KEY, the MCP endpoints, the model key), so a one-shot
 * "is everything wired?" check removes that failure mode.
 *
 * INSTANCE-AWARE: an instance is not one fixed deployment shape. The four
 * driver-selector variables — DB_DRIVER, BLOB_DRIVER, EXECUTOR_DRIVER,
 * MODEL_API_KIND — pick which backing service each seam talks to, and which
 * OTHER variables are load-bearing follows from that choice. This script
 * resolves the selectors first, then resolves every other variable's tier
 * against them, so a self-hosted instance is neither passed while unrunnable
 * nor nagged about variables its profile will never read. See `resolveSpec`
 * below.
 *
 * SECRET HYGIENE (absolute): for every variable except the four driver
 * selectors, this script reads only whether `process.env[NAME]` is a
 * non-empty string — it never prints, logs, hashes, stores, or transmits any
 * value, not even its length. The four selectors are the sole exception and
 * are not secrets: their value space is a closed set of non-secret enum
 * literals (see DRIVER_SEAMS). Even for those, the raw string is never
 * echoed: it is matched against the known literals, and the output carries
 * only a matched literal — an unmatched selector is reported by variable
 * NAME alone. No unbounded input from the environment reaches the output,
 * which is what the "never echoed" test in the suite pins down.
 *
 * `op run` is recommended for local use so the op:// references in
 * .env.local resolve into this process's environment:
 *
 *   op run --env-file=.env.local -- node scripts/preflight-env.mjs
 *
 * Any env-injection mechanism is acceptable — CI secrets, container
 * secrets, a secret manager — as long as the values reach this process's
 * environment some other way. The one hard line: never a plaintext literal
 * in a checked-in or local dot-file.
 *
 * Exit code is 0 when every REQUIRED variable (as resolved for the selected
 * profile) is present and the selectors are all recognized; 1 otherwise, so
 * the script can gate a deploy check or a CI step. Missing RECOMMENDED or
 * OPTIONAL variables are reported but never fail the run.
 *
 * GROUPS (#195): beyond per-variable tiers, some variable sets are
 * all-or-nothing in the code — a partial set is indistinguishable from an
 * empty one at run time, so the feature silently stays off. ENV_GROUPS
 * declares those sets and a partially set group emits a WARN naming the
 * missing members. Warn-only, never a failure: each member keeps its own
 * tier above, and the group check adds the set semantics on top.
 *
 * The pure check logic (`evaluateEnv`, `resolveSpec`, `ENV_SPEC`) is exported
 * and covered by scripts/preflight-env.test.mjs (run:
 * `node --test scripts/preflight-env.test.mjs`).
 */

import { fileURLToPath } from 'node:url';

/**
 * The four driver seams. Each maps a selector variable to its closed set of
 * accepted values and the value the code substitutes when the selector is
 * unset. The defaults MUST mirror the app: src/lib/db/index.ts,
 * src/lib/storage/index.ts, src/lib/sandbox/execute.ts, src/lib/model-client.ts
 * each read `env.X || '<default>'` and throw on anything outside `values`.
 *
 * MODEL_API_KIND is a seam and not a plain row on purpose. It selects a WIRE
 * DIALECT, and which other variables are load-bearing follows from that choice
 * exactly as it does for the storage and executor seams — `azure-openai`
 * promotes MODEL_API_VERSION and MODEL_API_BASE_URL to required. The
 * alternative idiom (`requiredUnlessAllPresent`) does not fit: it DEMOTES a
 * required tier when a substitute set is present, and this is a PROMOTION
 * driven by a selector, which is what `requiredWhen` already expresses.
 *
 * These are the only variables whose VALUE this script reads (see the secret
 * hygiene note at the top): they are non-secret enum selectors, and only a
 * matched literal from `values` is ever printed.
 */
export const DRIVER_SEAMS = {
  db: { env: 'DB_DRIVER', default: 'neon-http', values: ['neon-http', 'node-postgres'] },
  blob: { env: 'BLOB_DRIVER', default: 'vercel-blob', values: ['vercel-blob', 's3'] },
  executor: { env: 'EXECUTOR_DRIVER', default: 'vercel-sandbox', values: ['vercel-sandbox', 'container'] },
  model: { env: 'MODEL_API_KIND', default: 'openai-compatible', values: ['openai-compatible', 'azure-openai'] },
};

/**
 * The variables the app actually reads (grepped from `process.env.*` across
 * src/, plus the two scripts/-only eval-harness knobs, marked as such).
 *
 * Tiers are declared for the DEFAULT profile (every selector unset) and then
 * resolved per instance by `resolveSpec`:
 *   - required:    the instance's load-bearing path fails without it.
 *   - recommended: a feature degrades or a fallback kicks in; not fatal.
 *   - optional:    nice-to-have / analytics / dev-only / profile-specific knob.
 * `hasFallback: true` means the code substitutes a hardcoded default (or a
 * degraded in-process path) when the var is absent, so its absence is a soft
 * note rather than a hard miss.
 *
 * Two optional fields make a tier conditional on the selected drivers. Both
 * are keyed by DRIVER_SEAMS seam name:
 *   - `onlyWhen: { <seam>: '<driver>' }` — NOT APPLICABLE under any other
 *     driver for that seam. A not-applicable entry is dropped from the report
 *     entirely rather than reported as absent: an instance must not be nagged
 *     about a variable its profile will never read.
 *   - `requiredWhen: { <seam>: '<driver>' }` — tier becomes 'required' under
 *     that driver; otherwise the declared `tier` stands.
 *
 * An orthogonal field records WHERE a value is consumed, which is what a
 * deployment needs in order to deliver it (scripts/check-compose-env.mjs reads
 * this field; it has no effect on the preflight report):
 *   - `readBy` omitted — the running server process. A container deployment
 *     delivers it in the container's environment.
 *   - `readBy: 'build'` — inlined at `next build` and unreadable afterwards
 *     (every NEXT_PUBLIC_* value). A run-time pass-through cannot change it;
 *     it must be a build argument.
 *   - `readBy: 'build-and-runtime'` — read by the server AND baked into
 *     statically prerendered pages, so it must be supplied at both times or
 *     prerendered and dynamic pages disagree. Constraint: because a build
 *     argument that is not passed can arrive as an empty string rather than
 *     absent, a variable marked either build tier must treat empty as absent.
 *   - `readBy: 'external-tool'` — not read by the app at all (an operator
 *     script or an eval harness); enumerated here for completeness only, and
 *     never something a deployment must deliver to the container.
 *
 * TWO ACCEPTED NAMES. Used by the publisher-identity set (thirteen rows) and,
 * since website#30 P1, by the model credential — MODEL_API_KEY, whose
 * prior-era spelling is OPENROUTER_API_KEY. The mechanism is the same in both
 * cases; only the rename it serves differs, so nothing below is specific to
 * the publisher prefix beyond its worked example:
 *   - `priorEraName: 'EVIDENCE_X'` — the entry's `name` is the CANONICAL
 *     `PUBLISHER_X` spelling introduced by the 2026-08-19 vocabulary
 *     settlement (Appendix J of the Typed Standards specification;
 *     civic-ai-tools#160), and the prior-era spelling is still read by the
 *     app. Presence is satisfied by EITHER name; the report shows the one that
 *     answered and warns when it was the prior-era one. The precedence rule
 *     mirrors `src/lib/publisher-env.ts` exactly — the CANONICAL name wins
 *     whenever it is DEFINED, empty string included, because empty is a value
 *     in this set (`TRUST_REGISTRY_LEGACY_URL=''` omits a URL from signed
 *     output) and a preflight that disagreed with the app's own resolver would
 *     pass a configuration the app then refuses.
 *
 * A third conditional field expresses ALTERNATIVES rather than drivers — the
 * case where two variable sets satisfy the same need and an instance picks
 * one:
 *   - `requiredUnlessAllPresent: ['A', 'B', ...]` — the entry's declared
 *     'required' tier is DEMOTED TO 'optional' when every named variable is
 *     present. Used for the sign-in providers: an instance needs *a* provider,
 *     and a complete OIDC triple satisfies that need without GitHub. Demoted
 *     to 'optional' rather than 'recommended' on purpose — for an OIDC-only
 *     instance an absent GitHub pair is a deliberate configuration choice, not
 *     a degraded feature, and 'recommended' would emit a "feature(s) will
 *     degrade" nag. Same no-nagging principle as `onlyWhen`; the entry stays
 *     listed so the operator can still see the option exists.
 *
 * CONSTRAINT: all three fields must leave the default profile untouched. With
 * no selector set (or every selector set to its default) and no alternative
 * set complete, the resolved spec is identical to the declared one, so the
 * report is byte-identical to the pre-driver-awareness output. That is why the
 * S3_* knobs stay listed under the Vercel Blob profile rather than being
 * suppressed as not-applicable — the suppression only runs in the direction
 * that the frozen default output does not cover. The same holds for the
 * GitHub pair: the demotion fires only when the OIDC triple is complete, which
 * the frozen default output does not cover either.
 */
/**
 * The generic-OIDC provider set. A complete triple is a full substitute for a
 * GitHub OAuth app, which is what the GitHub pair's `requiredUnlessAllPresent`
 * condition below is asserting. Named once so the two sides cannot drift.
 */
export const OIDC_PROVIDER_SET = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'];

export const ENV_SPEC = [
  // --- Core query path (every demo query depends on these) ---
  // The model endpoint is a WIRE DIALECT, not merely a base URL — see
  // src/lib/model-client.ts. MODEL_API_KIND is the `model` seam above; the
  // three rows under it are what that seam makes load-bearing.
  //
  // MODEL_API_KEY is the canonical name; OPENROUTER_API_KEY is its prior-era
  // spelling and is still read by the app (expand half — nothing flips in this
  // phase). Same two-name mechanism as the publisher set below.
  { name: 'MODEL_API_KEY', priorEraName: 'OPENROUTER_API_KEY', tier: 'required', purpose: 'LLM access — every query (no fallback)' },
  // Selector, not a setting: unset declares the OpenAI-compatible dialect.
  { name: 'MODEL_API_KIND', tier: 'optional', purpose: "Model wire dialect — 'openai-compatible' (default) or 'azure-openai' (deployment-name routing, api-key header, api-version query)", hasFallback: true },
  // Under the default dialect this is an override with a coded fallback.
  // Under `azure-openai` it is the RESOURCE ENDPOINT and there is no fallback
  // to borrow — the built-in default names a different service in a different
  // dialect — so the seam promotes it, and the promotion drops the fallback
  // claim (see resolveSpec).
  { name: 'MODEL_API_BASE_URL', tier: 'optional', purpose: 'Chat-completions endpoint — any OpenAI-compatible endpoint (default: OpenRouter); the resource endpoint when MODEL_API_KIND=azure-openai', hasFallback: true, requiredWhen: { model: 'azure-openai' } },
  // No coded default is possible: an api-version gates which request and
  // response fields the endpoint honors, so a guessed one silently changes
  // what comes back. Inert under the default dialect.
  { name: 'MODEL_API_VERSION', tier: 'optional', purpose: 'Azure OpenAI api-version query parameter (required when MODEL_API_KIND=azure-openai; ignored otherwise)', requiredWhen: { model: 'azure-openai' } },
  // Derived from MODEL_API_KIND unless declared: 'bearer' under the default
  // dialect, 'api-key' under azure-openai. 'entra' is RESERVED in the enum
  // with no code behind it — setting it is a typed refusal, not a fallback.
  { name: 'MODEL_API_AUTH', tier: 'optional', purpose: "Model auth mode — 'bearer' or 'api-key'; derived from MODEL_API_KIND when unset ('entra' is reserved, not implemented)", hasFallback: true },
  // No coded fallback (#258 C4): the fallback used to point at the reference
  // deployment's hosted endpoint, silently routing an unconfigured instance's
  // queries through infrastructure it does not operate. Absent, every data
  // query refuses with a typed error naming this variable.
  { name: 'SOCRATA_MCP_URL', tier: 'required', purpose: 'Socrata MCP endpoint (the primary data source) — every data query refuses without it (no fallback)' },

  // --- Record publish + verify (the demo centerpiece: publish → badge) ---
  { name: 'DATABASE_URL', tier: 'required', purpose: 'Record DB — publish + dashboard + detail page' },
  // Selector, not a setting: unset declares the managed serverless driver.
  // DATABASE_URL is load-bearing under BOTH drivers (neon() and pg.Pool both
  // read it), so the db seam has no tier flips — only the selector itself.
  // web#194 #5: the hazard was in a code comment, where the operator who needs
  // it cannot see it. It now renders in the report.
  { name: 'DB_DRIVER', tier: 'optional', purpose: "DB driver — 'neon-http' (default) or 'node-postgres' (any Postgres over TCP). Unset silently selects the managed serverless driver: a plain Postgres host is never reached", hasFallback: true },
  // Vercel Blob credential: not read at all off that driver (src/lib/storage/index.ts
  // dynamic-imports only the selected driver), so demanding it under s3 would
  // fail an instance that is not on Vercel.
  { name: 'BLOB_READ_WRITE_TOKEN', tier: 'required', purpose: 'Record package storage (Vercel Blob)', onlyWhen: { blob: 'vercel-blob' } },
  { name: 'BLOB_DRIVER', tier: 'optional', purpose: "Blob storage driver — 'vercel-blob' (default) or 's3' (any S3-compatible endpoint)", hasFallback: true },
  // S3-compatible storage (read only when BLOB_DRIVER=s3; see src/lib/storage/s3.ts).
  // The three credentials below are hard throws in resolveS3ConfigFromEnv
  // (s3.ts:67-69); the rest resolve to coded defaults.
  { name: 'S3_ENDPOINT', tier: 'optional', purpose: 'S3-compatible endpoint URL (BLOB_DRIVER=s3; omit for AWS S3 proper)', hasFallback: true },
  { name: 'S3_REGION', tier: 'optional', purpose: 'S3 region (BLOB_DRIVER=s3; default us-east-1)', hasFallback: true },
  { name: 'S3_BUCKET', tier: 'optional', purpose: 'S3 bucket for record-package blobs (required when BLOB_DRIVER=s3)', requiredWhen: { blob: 's3' } },
  { name: 'S3_ACCESS_KEY_ID', tier: 'optional', purpose: 'S3 access key (required when BLOB_DRIVER=s3)', requiredWhen: { blob: 's3' } },
  { name: 'S3_SECRET_ACCESS_KEY', tier: 'optional', purpose: 'S3 secret key (required when BLOB_DRIVER=s3)', requiredWhen: { blob: 's3' } },
  { name: 'S3_FORCE_PATH_STYLE', tier: 'optional', purpose: 'Path-style S3 addressing (default: on when S3_ENDPOINT is set — MinIO)', hasFallback: true },
  { name: 'S3_PUBLIC_BASE_URL', tier: 'optional', purpose: 'Public object URL base (default: endpoint/bucket path-style)', hasFallback: true },
  // --- Notebook executor (S3b P4 driver seam; executed-notebook pipeline) ---
  { name: 'EXECUTOR_DRIVER', tier: 'optional', purpose: "Notebook executor driver — 'vercel-sandbox' (default) or 'container' (host container runtime)", hasFallback: true },
  // Relevant under the container driver, inert under the sandbox driver, and
  // fallback-backed under both (container.ts:47 → DEFAULT_CONTAINER_IMAGE), so
  // it carries no condition: it is never a miss and never a nag either way.
  { name: 'EXECUTOR_CONTAINER_IMAGE', tier: 'optional', purpose: 'Executor image tag (EXECUTOR_DRIVER=container only; default civic-notebook-executor:0.1.0)', hasFallback: true },
  // Passed into every executed notebook's env by buildNotebookEnv
  // (src/lib/sandbox/execute.ts), under BOTH executor drivers — read by the
  // generated notebook's own helper functions (fetch_socrata.py,
  // fetch_data_commons.py), not by the app itself. Both degrade gracefully
  // (throttled / anonymous access) rather than hard-failing, so no tier
  // promotion and no onlyWhen condition.
  { name: 'SOCRATA_APP_TOKEN', tier: 'optional', purpose: 'Socrata app token for executed notebooks (fetch_socrata.py) — raises the anonymous per-IP rate limit; throttled but functional without it', hasFallback: true },
  { name: 'DC_API_KEY', tier: 'optional', purpose: 'Data Commons API key for executed notebooks (fetch_data_commons.py) — distinct from DATA_COMMONS_API_KEY (the chat-flow MCP key); anonymous access works for moderate volumes without it', hasFallback: true },
  // Sandbox-only: the container driver boots a local image and reads none of
  // these four (vercel-sandbox.ts:89-96 is behind the driver's dynamic import).
  { name: 'SANDBOX_SNAPSHOT_ID', tier: 'recommended', purpose: 'Prebuilt sandbox snapshot — absent, the vercel-sandbox driver falls back to a slow fresh boot + pip install', hasFallback: true, onlyWhen: { executor: 'vercel-sandbox' } },
  { name: 'VERCEL_TOKEN', tier: 'optional', purpose: 'Vercel Sandbox auth for off-platform runs (on-deploy auth is OIDC-automatic)', onlyWhen: { executor: 'vercel-sandbox' } },
  { name: 'VERCEL_TEAM_ID', tier: 'optional', purpose: 'Vercel Sandbox auth for off-platform runs (with VERCEL_TOKEN + VERCEL_PROJECT_ID)', onlyWhen: { executor: 'vercel-sandbox' } },
  { name: 'VERCEL_PROJECT_ID', tier: 'optional', purpose: 'Vercel Sandbox auth for off-platform runs (with VERCEL_TOKEN + VERCEL_TEAM_ID)', onlyWhen: { executor: 'vercel-sandbox' } },

  // The signing pair. NEITHER has a coded fallback: signing.ts has no default
  // key id, because a substituted kid would label this instance's signature
  // with another deployment's registry entry (misattribution + an
  // unverifiable record). Both halves are hard requirements of a signing instance, and
  // the SIGNING_PAIR group below adds the all-or-nothing semantics on top.
  { name: 'PUBLISHER_SIGNING_KEY', priorEraName: 'EVIDENCE_SIGNING_KEY', tier: 'required', purpose: 'Ed25519 private key — signs record packages' },
  { name: 'PUBLISHER_KEY_ID', priorEraName: 'EVIDENCE_KEY_ID', tier: 'required', purpose: 'Active signing key id (kid) — must match the trust registry; no coded default' },

  // --- Sign-in path (the rate-limit headroom option; OAuth) ---
  { name: 'NEXTAUTH_SECRET', tier: 'required', purpose: 'NextAuth session encryption' },
  // web#194 #1, ruled (sprint #30 G0 D9): STAYS `required`, and declares no
  // `hasFallback`. Three app-side reads do derive an origin when this is unset
  // — api-auth.ts from the request host, device-flow.ts from the request
  // origin then localhost, evidence/verify.ts from getEvidenceSiteOrigin() —
  // but those are REQUEST-DERIVED VALUES, not configuration: they answer "what
  // host is this request on", which is not the same question as "what origin
  // did the OAuth app register". NextAuth itself is a fourth consumer and
  // infers only from VERCEL_URL, i.e. not at all off that platform. Declaring
  // a fallback here would pass a self-hosted instance whose sign-in callbacks
  // are broken, which is the worse failure.
  { name: 'NEXTAUTH_URL', tier: 'required', purpose: 'OAuth callback base URL (must match the deploy origin) — no fallback: the app-side origins are request-derived, not configuration, and none covers the OAuth callback' },
  // The GitHub pair now GATES its provider (auth-providers.ts): with either
  // half absent the button is not rendered at all, rather than rendered
  // broken. That is what makes an honest retier possible — the pair is
  // required unless the OIDC triple is complete, because an instance needs at
  // least one working sign-in provider and OIDC is a full substitute.
  { name: 'GITHUB_CLIENT_ID', tier: 'required', purpose: 'GitHub sign-in — the pair gates the provider (required unless the OIDC triple is complete)', requiredUnlessAllPresent: OIDC_PROVIDER_SET },
  { name: 'GITHUB_CLIENT_SECRET', tier: 'required', purpose: 'GitHub sign-in — the pair gates the provider (required unless the OIDC triple is complete)', requiredUnlessAllPresent: OIDC_PROVIDER_SET },
  // Generic OIDC sign-in (optional — active only when ISSUER + CLIENT_ID +
  // CLIENT_SECRET are all present; unset, sign-in is GitHub only).
  { name: 'OIDC_ISSUER', tier: 'optional', purpose: 'Generic OIDC sign-in — issuer URL (discovery-based)' },
  { name: 'OIDC_CLIENT_ID', tier: 'optional', purpose: 'Generic OIDC sign-in — client id' },
  { name: 'OIDC_CLIENT_SECRET', tier: 'optional', purpose: 'Generic OIDC sign-in — client secret' },
  { name: 'OIDC_PROVIDER_NAME', tier: 'optional', purpose: 'OIDC sign-in button label (default "SSO")', hasFallback: true },
  // Sign-in gate (app front door). Unset/empty = open sign-in, i.e. exactly
  // the behavior before the gate existed — so it is a pure override with a
  // coded default, never load-bearing for an instance that does not want it.
  { name: 'SIGN_IN_ALLOWLIST', tier: 'optional', purpose: 'Allowlist of provider-account keys permitted to sign in (unset/empty = open)', hasFallback: true },

  // --- Host topology (app front door P3; src/lib/host-routing.ts). All four
  //     are optional with coded defaults, so none may ever fail or nag a run.
  //     What the CODED DEFAULT IS changed in #259 P3: an instance that sets
  //     none of them now serves the app surface only — the marketing routes
  //     404 and `/` hops to `/ask` — because the marketing face is the
  //     reference deployment's own website rather than part of what an
  //     instance ships. SERVE_MARKETING is the flagship "unset is correct"
  //     variable of this set: instances leave it alone, and the reference
  //     deployment sets it so its own site and its preview URLs keep serving
  //     both route groups. ---
  { name: 'APP_HOST', tier: 'optional', purpose: 'Split-host: host serving the gated app surface (unset = no host named)', hasFallback: true },
  { name: 'MARKETING_HOST', tier: 'optional', purpose: 'Split-host: host serving the marketing site — withholds the app-private routes there (unset = no host named)', hasFallback: true },
  { name: 'APP_ONLY', tier: 'optional', purpose: 'App-only instance: every host serves the gated surface even when a marketing host is named (unset = off; the default is already app-only)', hasFallback: true },
  { name: 'SERVE_MARKETING', tier: 'optional', purpose: 'Serve the marketing site on hosts matching neither APP_HOST nor MARKETING_HOST — previews, aliases, a single-host site (unset = app surface only, the portable default)', hasFallback: true },

  // --- Indexing posture (#258 E1, owner ruling G0-3; src/lib/site-indexing.ts).
  //     A pure opt-in, same shape as the host-topology set above: the coded
  //     default is the standard web default (indexable, no robots.txt
  //     disallow, no noindex metadata), so an instance that has never heard
  //     of this variable is indexable, not silently blocked. ---
  // readBy build-and-runtime: the root layout's <head> metadata bakes this
  // at `next build` for statically prerendered pages (same caveat as the
  // SITE_BRAND_* set below); the robots.txt route itself forces per-request
  // evaluation (src/app/robots.ts `dynamic = 'force-dynamic'`) and needs it
  // only at run time.
  { name: 'SITE_NOINDEX', readBy: 'build-and-runtime', tier: 'optional', purpose: "Block crawler indexing site-wide — robots.txt disallows every path and page metadata carries noindex/nofollow (unset/empty = indexable, the standard web default)", hasFallback: true },

  // --- Rate limiting (durable counter; without it, falls back to per-instance memory) ---
  // hasFallback, not a hard miss: rate-limit.ts:53-63 tests both vars and takes
  // an in-process memory store when either is absent — the instance runs, the
  // counter just stops being durable across instances and deploys. Absence is a
  // soft note so a single-node instance with no managed KV can pass preflight.
  { name: 'KV_REST_API_URL', tier: 'required', purpose: 'Durable rate-limit counter (Upstash/Vercel KV)', hasFallback: true },
  { name: 'KV_REST_API_TOKEN', tier: 'required', purpose: 'Durable rate-limit counter (Upstash/Vercel KV)', hasFallback: true },

  // --- Secondary MCP sources (not on the storyboard-3 critical path) ---
  { name: 'DATA_COMMONS_MCP_URL', tier: 'recommended', purpose: 'Data Commons MCP endpoint', hasFallback: true },
  { name: 'DATA_COMMONS_API_KEY', tier: 'recommended', purpose: 'Data Commons auth — DC tool calls fail without it' },
  { name: 'BOSTON_OPENCONTEXT_MCP_URL', tier: 'recommended', purpose: 'Boston OpenContext MCP endpoint', hasFallback: true },

  // --- Instance identity (ADR-0020: config-not-code; #258: REQUIRED for
  //     signing, never defaulted; see docs/instance-setup.md and
  //     src/lib/site-config.ts). The five identity variables below have NO
  //     coded fallback: signed output names the publisher's origin, signer,
  //     and platform agent, and with the signing pair set but any of these
  //     absent every seal/publish attempt is refused
  //     (`instance_identity_missing`). They travel with the signing pair —
  //     the "Record signing" group below carries the relationship. The
  //     remaining five are per-item overrides that DERIVE from the origin
  //     (host, registry URLs, agent URL) or the host (agent id). ---
  { name: 'PUBLISHER_SITE_ORIGIN', priorEraName: 'EVIDENCE_SITE_ORIGIN', tier: 'required', purpose: 'Instance origin — required to sign; registry URLs, platform-agent URL, notebook/bundle attribution links derive from it' },
  { name: 'PUBLISHER_SIGNER_BINDING_TIER', priorEraName: 'EVIDENCE_SIGNER_BINDING_TIER', tier: 'required', purpose: 'Envelope signer claim: bindingTier — required to sign; must match the registry entry (check #14)' },
  { name: 'PUBLISHER_SIGNER_IDENTIFIER', priorEraName: 'EVIDENCE_SIGNER_IDENTIFIER', tier: 'required', purpose: 'Envelope signer claim: identifier — required to sign; must match the registry entry (check #14)' },
  { name: 'PUBLISHER_SIGNER_DISPLAY_NAME', priorEraName: 'EVIDENCE_SIGNER_DISPLAY_NAME', tier: 'required', purpose: 'Envelope signer claim: displayName — required to sign; must match the registry entry (check #14)' },
  { name: 'PUBLISHER_PLATFORM_AGENT_TITLE', priorEraName: 'EVIDENCE_PLATFORM_AGENT_TITLE', tier: 'required', purpose: 'PROV platform-agent title + notebook attribution display name — required to sign' },
  { name: 'PUBLISHER_PUBLICATION_HOST', priorEraName: 'EVIDENCE_PUBLICATION_HOST', tier: 'optional', purpose: 'Host label override on publishes-attestations, datHere environment.host, notebook/skill-text host mentions (derives from the origin)', hasFallback: true },
  { name: 'PUBLISHER_TRUST_REGISTRY_CANONICAL_URL', priorEraName: 'EVIDENCE_TRUST_REGISTRY_CANONICAL_URL', tier: 'optional', purpose: 'Sidecar trustRegistryUrl override (defaults to origin + well-known path)', hasFallback: true },
  { name: 'PUBLISHER_TRUST_REGISTRY_LEGACY_URL', priorEraName: 'EVIDENCE_TRUST_REGISTRY_LEGACY_URL', tier: 'optional', purpose: 'Sidecar trustRegistryUrlLegacy override (empty string omits it; defaults to origin + legacy path)', hasFallback: true },
  { name: 'PUBLISHER_PLATFORM_AGENT_ID', priorEraName: 'EVIDENCE_PLATFORM_AGENT_ID', tier: 'optional', purpose: 'PROV platform-agent id inside the signed provenance graph (derives from the publication host)', hasFallback: true },
  { name: 'PUBLISHER_PLATFORM_AGENT_URL', priorEraName: 'EVIDENCE_PLATFORM_AGENT_URL', tier: 'optional', purpose: 'PROV platform-agent URL (defaults to PUBLISHER_SITE_ORIGIN)', hasFallback: true },

  // --- Instance branding (#217: chrome-only theming seam; src/lib/brand-config.ts).
  //     All optional with coded defaults: unset, the demo chrome renders
  //     byte-identically. Chrome only — nothing here is emitted inside signed
  //     output (that is the PUBLISHER_* identity set above), so these can
  //     never invalidate a package or a registry cross-check. ---
  { name: 'SITE_BRAND_NAME', readBy: 'build-and-runtime', tier: 'optional', purpose: 'Instance display name — header wordmark, page titles, citation labels (default "Civic AI Tools")', hasFallback: true },
  { name: 'SITE_BRAND_ACCENT', readBy: 'build-and-runtime', tier: 'optional', purpose: 'Accent color (#rgb/#rrggbb) — overrides the accent tokens site-wide; unset or invalid = stylesheet default', hasFallback: true },
  { name: 'SITE_BRAND_TAGLINE', readBy: 'build-and-runtime', tier: 'optional', purpose: 'Footer tagline line (default: the demo tagline)', hasFallback: true },
  { name: 'SITE_BRAND_ATTRIBUTION', readBy: 'build-and-runtime', tier: 'optional', purpose: 'Footer attribution line, plain text (unset: the demo authored attribution markup)', hasFallback: true },

  // --- Instance content sources (#241: src/lib/site-config.ts). All
  //     optional, and unset means one thing: this instance has no content
  //     source of its own. /directory then serves the shared community index
  //     with attribution; /roadmap renders as unpublished and drops out of
  //     the nav rather than showing another project's plans. ---
  { name: 'DIRECTORY_DATA_URL', readBy: 'build-and-runtime', tier: 'optional', purpose: '/directory data source — MCP-server JSON (unset: the community index, shown with attribution)', hasFallback: true },
  { name: 'ROADMAP_RAW_URL', readBy: 'build-and-runtime', tier: 'optional', purpose: '/roadmap data source — raw Markdown (unset: /roadmap says no roadmap is published and leaves the nav)', hasFallback: true },
  { name: 'ROADMAP_GITHUB_URL', readBy: 'build-and-runtime', tier: 'optional', purpose: '/roadmap "view source" link and byline label (unset: derived from ROADMAP_RAW_URL)', hasFallback: true },

  // --- Optional / feature / ops ---
  // civic-ai-tools#155 P1b: PUBLISHER_TRUST_REGISTRY_URL (prior era:
  // EVIDENCE_TRUST_REGISTRY_URL) was retired here — it fed an on-disk read
  // and HTTP-fetch fallback in src/lib/evidence/verify.ts's loadTrustRegistry
  // that P1 measured as dead code on every real call path (the build-time
  // embedded registry import always resolves first). The owner ruled to
  // retire rather than repair; the variable is no longer read anywhere.
  // WRITTEN, NEVER READ — the fourteenth variable of the settlement's shipped
  // Group A (now the thirteenth entry in this inventory, following
  // civic-ai-tools#155 P1b's retirement of PUBLISHER_TRUST_REGISTRY_URL
  // above), and the one this inventory used to miss precisely because the inventory
  // was derived from `process.env.*` reads. scripts/generate-signing-key.ts
  // emits it beside the private key so an operator has the public half to
  // publish in their trust registry; no app code loads it. Listed as
  // `external-tool` so it is enumerated for completeness without a deployment
  // ever being asked to deliver it to the container.
  { name: 'PUBLISHER_PUBLIC_KEY', priorEraName: 'EVIDENCE_PUBLIC_KEY', readBy: 'external-tool', tier: 'optional', purpose: 'Public half of the signing keypair — written by scripts/generate-signing-key.ts for the trust-registry entry; never read by the app' },
  { name: 'CIVICAITOOLS_SESSION_TOKEN', readBy: 'external-tool', tier: 'optional', purpose: 'publish-record skill (Claude Code) auth' },
  // web#194 #2: retiered from `optional`. The one scheduled job this repo
  // declares (vercel.json, `0 4 * * *` → src/app/api/cron/blob-gc/route.ts)
  // fails closed on an absent secret, so without it the sweep 401s on every
  // invocation, forever, with no operator-visible signal. The purpose text
  // also named a "portal refresh" endpoint that does not exist — blob-gc is
  // the only cron route in the tree.
  { name: 'CRON_SECRET', tier: 'recommended', purpose: 'Cron endpoint auth (orphan-blob GC, the only scheduled job) — absent, every run 401s and abandoned uploads accumulate' },
  { name: 'NEXT_PUBLIC_GA_MEASUREMENT_ID', readBy: 'build', tier: 'optional', purpose: 'Google Analytics 4' },

  // --- Tuning knobs with coded defaults (previously unenumerated; the app
  //     reads them but runs on built-in defaults when absent) ---
  { name: 'ANONYMOUS_RATE_LIMIT', tier: 'optional', purpose: 'Anonymous per-day query limit (default 10)', hasFallback: true },
  { name: 'AUTHENTICATED_RATE_LIMIT', tier: 'optional', purpose: 'Authenticated per-day query limit (default 25)', hasFallback: true },
  // Applies only on a gated instance (SIGN_IN_ALLOWLIST populated), and its
  // coded fallback is the authenticated limit itself — so unset it is not
  // merely defaulted, it is identical to the authenticated tier.
  { name: 'APP_TIER_RATE_LIMIT', tier: 'optional', purpose: 'Per-day query limit for signed-in users of a gated instance (default: AUTHENTICATED_RATE_LIMIT)', hasFallback: true },
  { name: 'TOKEN_LIMIT_PER_REQUEST', tier: 'optional', purpose: 'Streaming token budget per request (coded default)', hasFallback: true },
  { name: 'MAX_TOOL_RESULT_CHARS', tier: 'optional', purpose: 'Tool-result truncation budget (coded default)', hasFallback: true },
  { name: 'NEXT_PUBLIC_CAPTURE_TRACES', readBy: 'build', tier: 'optional', purpose: 'Dev-only BPMN trace capture toggle', hasFallback: true },
  // NEXT_PUBLIC_SOCRATA_MCP_URL is gone (#258 C5): client surfaces now read
  // the server-resolved SOCRATA_MCP_URL via McpRoutingProvider, so there is
  // no second name for the same routing decision to drift from the first.

  // --- scripts/-only (not read by the app; enumerated for completeness) ---
  { name: 'EVAL_MODELS', readBy: 'external-tool', tier: 'optional', purpose: 'Model-eval harness roster (scripts/eval-models.mjs only)', hasFallback: true },
  { name: 'EVAL_QUERIES', readBy: 'external-tool', tier: 'optional', purpose: 'Model-eval harness query set (scripts/eval-models.mjs only)', hasFallback: true },
];

/**
 * All-or-nothing variable groups (#195). Each names a set the code consumes
 * only as a complete set: with any member absent the whole set is ignored, so
 * a partially set group means the operator configured something that is not
 * in effect. For most groups that is entirely silent at run time and
 * preflight is the only place it can surface. The signing pair is the one
 * exception — it refuses loudly at run time — and is listed anyway, because
 * preflight is where the operator learns the RELATIONSHIP before a deploy
 * rather than from a refused publish afterwards. Detection is presence-only,
 * same test as everywhere else; no value is ever read or echoed.
 *
 * Fields:
 *   - members: the variable names (each must also be declared in ENV_SPEC —
 *     the test suite pins that).
 *   - feature: what stays off while the group is partial (rendered in the
 *     warning).
 *   - onlyWhen: same semantics as the ENV_SPEC field — the group is checked
 *     only when the resolved drivers match, so a profile that never reads the
 *     members is never warned about them.
 *   - note: extra caution rendered under the warning.
 */
export const ENV_GROUPS = [
  {
    name: 'Vercel Sandbox off-platform auth',
    members: ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'],
    // resolveSandboxAuthParams (src/lib/sandbox/vercel-sandbox.ts:88-96)
    // returns null unless all three are present, so a two-of-three set
    // silently downgrades to no sandbox auth — off-platform, that means
    // notebook execution cannot start.
    feature: 'off-platform sandbox auth — notebook execution fails off-deploy',
    onlyWhen: { executor: 'vercel-sandbox' },
  },
  {
    name: 'Generic OIDC sign-in',
    members: OIDC_PROVIDER_SET,
    // src/lib/auth-providers.ts activates the provider only on the full
    // triple; with any member absent the provider never appears — no error,
    // no log.
    feature: 'the OIDC provider is not offered on the sign-in screen',
    note: 'OIDC_ISSUER is identity-bearing, not just configuration: it is embedded in every OIDC user\'s stored account key, so changing or unsetting it later re-keys those users into fresh accounts.',
  },
  {
    name: 'GitHub sign-in',
    members: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    // src/lib/auth-providers.ts renders the provider only when both halves
    // are present. When the OIDC triple is complete the pair is individually
    // optional (requiredUnlessAllPresent above), so a half-set pair is
    // otherwise fully silent.
    feature: 'the GitHub provider is not offered on the sign-in screen',
  },
  {
    name: 'Record signing',
    members: [
      'PUBLISHER_SIGNING_KEY',
      'PUBLISHER_KEY_ID',
      'PUBLISHER_SITE_ORIGIN',
      'PUBLISHER_SIGNER_BINDING_TIER',
      'PUBLISHER_SIGNER_IDENTIFIER',
      'PUBLISHER_SIGNER_DISPLAY_NAME',
      'PUBLISHER_PLATFORM_AGENT_TITLE',
    ],
    // src/lib/evidence/unsigned-tier.ts: `isSigningConfigured` requires BOTH
    // custody halves (key + declared kid), and as of #258 the seal/commit
    // gate additionally requires the instance-identity set
    // (INSTANCE_IDENTITY_REQUIRED_VARS in src/lib/site-config.ts) — signed
    // output names the publisher's origin, signer, and platform agent, and
    // none of those has a coded default anymore. Key + kid + identity set
    // travel together: any member absent means every seal/publish attempt
    // is refused. Unlike the other groups this one is not silent at run
    // time — the gate refuses (`signing_key_id_missing` /
    // `instance_identity_missing`) and the banner shows — but preflight is
    // where the operator sees the RELATIONSHIP before a deploy.
    feature: 'record seal/publish stays gated off — the instance cannot sign',
    note: 'Key, key id, and the instance-identity set travel together: a key without a declared kid refuses rather than emit a kid it never declared, and a signing pair without PUBLISHER_SITE_ORIGIN, the PUBLISHER_SIGNER_* triple, and PUBLISHER_PLATFORM_AGENT_TITLE refuses rather than sign under an identity this instance never configured (docs/instance-setup.md). Each of those also answers to its prior-era EVIDENCE_* spelling.',
  },
  {
    name: 'Durable rate limiting',
    members: ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    // src/lib/rate-limit.ts requires both; with either absent the counter
    // silently falls back to per-process memory (resets on restart, not
    // shared across instances).
    feature: 'the rate-limit counter falls back to per-process memory',
  },
];

const TIER_ORDER = ['required', 'recommended', 'optional'];

/**
 * Resolve the instance profile from the driver selectors.
 *
 * An absent or empty selector takes the seam's coded default, matching
 * `env.X_DRIVER || '<default>'` in the app. A value outside the seam's closed
 * set is what the app throws on at first use, so it is an error here too —
 * recorded by seam NAME only; the offending value is never echoed.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ drivers: Record<string, string>, errors: string[], isDefault: boolean }}
 */
export function resolveDrivers(env) {
  const drivers = {};
  const errors = [];
  for (const [seam, def] of Object.entries(DRIVER_SEAMS)) {
    const raw = env[def.env];
    const chosen = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : def.default;
    if (def.values.includes(chosen)) {
      drivers[seam] = chosen;
    } else {
      // Unknown selector: fall back to the seam's default for resolution so
      // the rest of the table still renders, and fail the run below.
      drivers[seam] = def.default;
      errors.push(def.env);
    }
  }
  const isDefault = Object.entries(DRIVER_SEAMS).every(([seam, def]) => drivers[seam] === def.default);
  return { drivers, errors, isDefault };
}

/** True when every seam named in a condition matches the resolved driver. */
function conditionMet(condition, drivers) {
  return Object.entries(condition).every(([seam, driver]) => drivers[seam] === driver);
}

/**
 * THE presence test — non-empty after trim. Every check in this script
 * (tiers, alternatives, groups) uses this one boolean; no value is read
 * beyond it.
 */
function isPresent(raw) {
  return typeof raw === 'string' && raw.trim().length > 0;
}

/** True when every named variable is present in `env`. Presence only. */
function allPresent(names, env) {
  return names.every((name) => isPresent(env[name]));
}

/** ENV_SPEC indexed by canonical name, so a group member resolves to its
 *  entry (and therefore to its two-name rule) rather than to a bare lookup. */
function specIndex(spec) {
  const byName = new Map();
  for (const s of spec) byName.set(s.name, s);
  return byName;
}

/**
 * Resolve ONE spec entry against `env`, honoring the two accepted names.
 *
 * Mirrors `src/lib/publisher-env.ts` deliberately and exactly: the canonical
 * name wins whenever it is DEFINED — empty string included — and only an
 * entirely unset canonical name falls through to the prior-era spelling. A
 * preflight that resolved differently from the app's own reader would pass a
 * configuration the app then refuses, which is worse than no preflight.
 *
 * Returns the name that ANSWERED (the canonical one when neither did), the raw
 * value for the presence test, and whether the prior-era name supplied it.
 * Nothing is echoed: the raw value is consumed by `isPresent` alone.
 *
 * @param {{ name: string, priorEraName?: string }} entry
 * @param {Record<string, string | undefined>} env
 */
export function resolveEnvName(entry, env) {
  const canonical = env[entry.name];
  if (typeof canonical === 'string') {
    return { name: entry.name, raw: canonical, viaPriorEra: false };
  }
  if (typeof entry.priorEraName === 'string') {
    const priorEra = env[entry.priorEraName];
    if (typeof priorEra === 'string') {
      return { name: entry.priorEraName, raw: priorEra, viaPriorEra: true };
    }
  }
  return { name: entry.name, raw: undefined, viaPriorEra: false };
}

/**
 * Detect partially set all-or-nothing groups (#195). A group whose
 * `onlyWhen` condition the resolved drivers do not meet is skipped entirely
 * (its members are not read by that profile). A group with zero members
 * present is deliberately not configured; a complete group is in effect;
 * anything in between is the silent-failure case this check exists for.
 *
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, string>} drivers
 * @param {typeof ENV_GROUPS} [groups]
 * @returns {{ name: string, feature: string, note?: string, total: number, present: string[], missing: string[] }[]}
 */
export function evaluateGroups(env, drivers, groups = ENV_GROUPS, spec = ENV_SPEC) {
  const byName = specIndex(spec);
  // A member counts as present under EITHER of its accepted names; a member
  // that is MISSING is named canonically, because the warning tells an
  // operator what to set and the prior-era spelling is the one being retired.
  const memberPresent = (name) =>
    isPresent(resolveEnvName(byName.get(name) ?? { name }, env).raw);
  const partial = [];
  for (const g of groups) {
    if (g.onlyWhen && !conditionMet(g.onlyWhen, drivers)) continue;
    const present = g.members.filter(memberPresent);
    if (present.length === 0 || present.length === g.members.length) continue;
    partial.push({
      name: g.name,
      feature: g.feature,
      note: g.note,
      total: g.members.length,
      present,
      missing: g.members.filter((name) => !memberPresent(name)),
    });
  }
  return partial;
}

/**
 * Resolve the declared spec against an instance profile: drop entries the
 * profile will never read, promote entries the profile makes load-bearing, and
 * demote entries whose need another present variable set already satisfies.
 *
 * With every selector at its default and no alternative set complete this is
 * the identity transform on ENV_SPEC (see the CONSTRAINT note on ENV_SPEC),
 * which is what keeps the default profile's report byte-identical. `env`
 * therefore defaults to `{}`: a caller that passes only drivers gets exactly
 * the driver-aware behavior it got before alternatives existed.
 *
 * @param {Record<string, string>} drivers
 * @param {typeof ENV_SPEC} [spec]
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ applicable: typeof ENV_SPEC, notApplicable: typeof ENV_SPEC }}
 */
export function resolveSpec(drivers, spec = ENV_SPEC, env = {}) {
  const applicable = [];
  const notApplicable = [];
  for (const s of spec) {
    if (s.onlyWhen && !conditionMet(s.onlyWhen, drivers)) {
      notApplicable.push(s);
      continue;
    }
    const promoted = s.requiredWhen && conditionMet(s.requiredWhen, drivers);
    if (promoted) {
      // The promotion also drops any `hasFallback` claim. A driver that makes
      // a variable load-bearing is by definition a driver the coded fallback
      // does not cover — MODEL_API_BASE_URL's fallback is an OpenAI-compatible
      // gateway, which is the wrong service in the wrong dialect for
      // MODEL_API_KIND=azure-openai. Left in place, the row would land in the
      // soft `requiredOnFallback` bucket and the run would PASS a
      // configuration the app refuses at the first request. No pre-existing
      // row carries both fields, so this is inert for every profile that
      // shipped before the model seam.
      const promotedEntry = { ...s, tier: 'required' };
      delete promotedEntry.hasFallback;
      applicable.push(promotedEntry);
      continue;
    }
    // An alternative set covers this variable's need: demote rather than
    // suppress, so the option stays visible without being nagged about.
    const demoted = s.requiredUnlessAllPresent && allPresent(s.requiredUnlessAllPresent, env);
    applicable.push(demoted ? { ...s, tier: 'optional' } : s);
  }
  return { applicable, notApplicable };
}

/**
 * Pure presence evaluation. Reads only whether each value is a non-empty
 * string (the driver selectors excepted — see resolveDrivers); returns no
 * values. `ok` is true iff every required var resolved for this profile is
 * present and every selector is recognized.
 *
 * @param {Record<string, string | undefined>} env
 * @param {typeof ENV_SPEC} [spec]
 */
export function evaluateEnv(env, spec = ENV_SPEC) {
  const { drivers, errors: driverErrors, isDefault } = resolveDrivers(env);
  const { applicable, notApplicable } = resolveSpec(drivers, spec, env);

  const rows = applicable.map((s) => {
    const resolved = resolveEnvName(s, env);
    return {
      // The name that ANSWERED — so an instance still on the prior-era
      // spelling sees the variable it actually set, not one it did not.
      name: resolved.name,
      // The name to set from here on; drives the deprecation notice below.
      canonicalName: s.name,
      viaPriorEra: resolved.viaPriorEra,
      tier: s.tier,
      purpose: s.purpose,
      hasFallback: Boolean(s.hasFallback),
      present: isPresent(resolved.raw),
    };
  });

  // A required var with a coded fallback (`hasFallback`) is NOT a hard miss when
  // absent — the app substitutes a built-in default or a degraded in-process
  // path (e.g. rate-limit.ts falls back to a per-process counter without the
  // KV pair). It is surfaced separately so the fallback's continued
  // acceptability can be confirmed, without failing the run.
  const missingRequired = rows.filter((r) => r.tier === 'required' && !r.present && !r.hasFallback);
  const requiredOnFallback = rows.filter((r) => r.tier === 'required' && !r.present && r.hasFallback);
  // web#194 #6: `hasFallback` excludes a recommended row from the degraded-
  // feature nag for the same reason it softens a required one — the code
  // substitutes a built-in default, so the feature is not degraded, it is
  // running on the coded value. Without the filter the report named
  // DATA_COMMONS_MCP_URL and BOSTON_OPENCONTEXT_MCP_URL as degraded features
  // when both have working defaults.
  const missingRecommended = rows.filter((r) => r.tier === 'recommended' && !r.present && !r.hasFallback);
  const partialGroups = evaluateGroups(env, drivers, ENV_GROUPS, spec);
  // Variables supplied under a prior-era name. Warn-only and never a failure:
  // both spellings work, and the expand half of the settlement exists exactly
  // so that an instance mid-rename is a working instance.
  const deprecatedNames = rows.filter((r) => r.viaPriorEra);

  return {
    rows,
    missingRequired,
    requiredOnFallback,
    missingRecommended,
    // All-or-nothing groups only partially set (#195). Warn-only by design:
    // a partial group never flips `ok` — each member's own tier already
    // governs pass/fail, and the group adds the set semantics on top.
    partialGroups,
    deprecatedNames,
    // Profile context. `notApplicable` is deliberately NOT rendered as rows:
    // an instance must not be told about variables its profile never reads.
    profile: { drivers, isDefault },
    notApplicable: notApplicable.map((s) => s.name),
    driverErrors,
    ok: missingRequired.length === 0 && driverErrors.length === 0,
  };
}

/** Status token for a row. Pure; no values involved. */
function statusToken(row) {
  if (row.present) return 'PASS   ';
  // A coded fallback applies whether the var is required or optional: an absent
  // var with a hardcoded default is running on that default, not missing.
  if (row.hasFallback) return 'fallbk ';
  if (row.tier === 'required') return 'MISSING';
  return 'absent ';
}

/** Render the table as a string (so it is testable / not coupled to stdout). */
export function renderReport(result) {
  const lines = [];
  lines.push('');
  lines.push('  civic-ai-tools-website — environment preflight');
  lines.push('  (presence only; no values are read or shown)');
  lines.push('');

  // Profile banner, printed ONLY for a non-default profile so the default
  // instance's report stays byte-identical. Values shown are matched literals
  // from DRIVER_SEAMS, never raw environment input.
  if (result.profile && !result.profile.isDefault) {
    const pairs = Object.keys(DRIVER_SEAMS).map((seam) => `${seam}=${result.profile.drivers[seam]}`);
    lines.push(`  PROFILE: ${pairs.join('  ')}`);
    if (result.notApplicable && result.notApplicable.length > 0) {
      lines.push(`  (${result.notApplicable.length} variable(s) not applicable to this profile — omitted)`);
    }
    lines.push('');
  }

  const nameWidth = Math.max(...result.rows.map((r) => r.name.length));

  for (const tier of TIER_ORDER) {
    const tierRows = result.rows.filter((r) => r.tier === tier);
    if (tierRows.length === 0) continue;
    lines.push(`  ${tier.toUpperCase()}`);
    for (const r of tierRows) {
      lines.push(`    [${statusToken(r)}] ${r.name.padEnd(nameWidth)}  ${r.purpose}`);
    }
    lines.push('');
  }

  if (result.ok) {
    lines.push('  RESULT: PASS — all required variables present.');
  } else if (result.missingRequired.length > 0) {
    lines.push(`  RESULT: FAIL — ${result.missingRequired.length} required variable(s) missing:`);
    for (const r of result.missingRequired) lines.push(`            - ${r.name}`);
  } else {
    lines.push('  RESULT: FAIL — unrecognized driver selection.');
  }
  // Selector set to a value outside its closed set: the app throws on it at
  // first use, so preflight must not pass. Named, never echoed.
  if (result.driverErrors && result.driverErrors.length > 0) {
    lines.push(`  ERROR: ${result.driverErrors.length} driver selector(s) set to an unrecognized value:`);
    for (const name of result.driverErrors) {
      const seam = Object.values(DRIVER_SEAMS).find((d) => d.env === name);
      lines.push(`            - ${name} (expected one of: ${seam.values.join(', ')})`);
    }
  }
  // Partially set all-or-nothing groups (#195): louder than a NOTE because
  // the operator configured something that is silently not in effect, but
  // never a failure — the members' own tiers govern pass/fail. Only names
  // are printed, never values.
  if (result.partialGroups && result.partialGroups.length > 0) {
    lines.push(`  WARN: ${result.partialGroups.length} all-or-nothing variable group(s) partially set — a partial group leaves its feature silently off:`);
    for (const g of result.partialGroups) {
      lines.push(`            - ${g.name}: ${g.present.length} of ${g.total} present; off until all ${g.total} are set. Missing: ${g.missing.join(', ')}`);
      lines.push(`              (while partial: ${g.feature})`);
      if (g.note) lines.push(`              Note: ${g.note}`);
    }
  }
  // Prior-era variable names still in use (civic-ai-tools#160 P3). A NOTE,
  // not a WARN and never a failure: the value reached the app, the instance
  // works, and the rename is the operator's to schedule. It is reported at all
  // because the alternative — silence — leaves an operator to discover the new
  // names from a release note, and because this list is exactly the work the
  // eventual removal will require.
  if (result.deprecatedNames && result.deprecatedNames.length > 0) {
    lines.push(
      `  NOTE: ${result.deprecatedNames.length} variable(s) supplied under a prior-era name.`,
    );
    lines.push('        Both spellings work today; the prior-era one is removed at a future');
    lines.push('        major version (2026-08-19 vocabulary settlement):');
    for (const r of result.deprecatedNames) {
      lines.push(`            - ${r.name} → rename to ${r.canonicalName}`);
    }
  }
  if (result.requiredOnFallback && result.requiredOnFallback.length > 0) {
    lines.push(`  NOTE: ${result.requiredOnFallback.length} required variable(s) absent but running on a built-in fallback (confirm the default is still correct):`);
    for (const r of result.requiredOnFallback) lines.push(`            - ${r.name}`);
  }
  if (result.missingRecommended.length > 0) {
    lines.push(`  NOTE: ${result.missingRecommended.length} recommended variable(s) absent (feature(s) will degrade):`);
    for (const r of result.missingRecommended) lines.push(`            - ${r.name}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Entry point when run directly (not when imported by the test). */
function main() {
  const result = evaluateEnv(process.env);
  process.stdout.write(renderReport(result));
  process.exitCode = result.ok ? 0 : 1;
}

// Run main() only when invoked as a script, not when imported.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
