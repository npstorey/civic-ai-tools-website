#!/usr/bin/env node
/**
 * Instance environment preflight.
 *
 * Checks the PRESENCE (never the value) of the environment variables an
 * instance of civic-ai-tools-website needs to run, and prints a grouped
 * pass/fail table. Several of these vars fail silently or with a generic
 * error when absent (DATABASE_URL, the storage credentials,
 * EVIDENCE_SIGNING_KEY, EVIDENCE_KEY_ID, the MCP endpoints, the model key),
 * so a one-shot "is everything wired?" check removes that failure mode.
 *
 * INSTANCE-AWARE: an instance is not one fixed deployment shape. The three
 * driver-selector variables — DB_DRIVER, BLOB_DRIVER, EXECUTOR_DRIVER — pick
 * which backing service each seam talks to, and which OTHER variables are
 * load-bearing follows from that choice. This script resolves the selectors
 * first, then resolves every other variable's tier against them, so a
 * self-hosted instance is neither passed while unrunnable nor nagged about
 * variables its profile will never read. See `resolveSpec` below.
 *
 * SECRET HYGIENE (absolute): for every variable except the three driver
 * selectors, this script reads only whether `process.env[NAME]` is a
 * non-empty string — it never prints, logs, hashes, stores, or transmits any
 * value, not even its length. The three selectors are the sole exception and
 * are not secrets: their value space is a closed set of non-secret enum
 * literals (see DRIVER_SEAMS). Even for those, the raw string is never
 * echoed: it is matched against the known literals, and the output carries
 * only a matched literal — an unmatched selector is reported by variable
 * NAME alone. No unbounded input from the environment reaches the output,
 * which is what the "never echoed" test in the suite pins down.
 *
 * Run it through 1Password so the op:// references in .env.local resolve into
 * this process's environment:
 *
 *   op run --env-file=.env.local -- node scripts/preflight-env.mjs
 *
 * Exit code is 0 when every REQUIRED variable (as resolved for the selected
 * profile) is present and the selectors are all recognized; 1 otherwise, so
 * the script can gate a deploy check or a CI step. Missing RECOMMENDED or
 * OPTIONAL variables are reported but never fail the run.
 *
 * The pure check logic (`evaluateEnv`, `resolveSpec`, `ENV_SPEC`) is exported
 * and covered by scripts/preflight-env.test.mjs (run:
 * `node --test scripts/preflight-env.test.mjs`).
 */

import { fileURLToPath } from 'node:url';

/**
 * The three driver seams. Each maps a selector variable to its closed set of
 * accepted values and the value the code substitutes when the selector is
 * unset. The defaults MUST mirror the app: src/lib/db/index.ts,
 * src/lib/storage/index.ts, src/lib/sandbox/execute.ts each read
 * `env.X_DRIVER || '<default>'` and throw on anything outside `values`.
 *
 * These are the only variables whose VALUE this script reads (see the secret
 * hygiene note at the top): they are non-secret enum selectors, and only a
 * matched literal from `values` is ever printed.
 */
export const DRIVER_SEAMS = {
  db: { env: 'DB_DRIVER', default: 'neon-http', values: ['neon-http', 'node-postgres'] },
  blob: { env: 'BLOB_DRIVER', default: 'vercel-blob', values: ['vercel-blob', 's3'] },
  executor: { env: 'EXECUTOR_DRIVER', default: 'vercel-sandbox', values: ['vercel-sandbox', 'container'] },
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
 * CONSTRAINT: both fields must leave the default profile untouched. With no
 * selector set (or every selector set to its default) the resolved spec is
 * identical to the declared one, so the report is byte-identical to the
 * pre-driver-awareness output. That is why the S3_* knobs stay listed under
 * the Vercel Blob profile rather than being suppressed as not-applicable —
 * the suppression only runs in the direction that the frozen default output
 * does not cover.
 */
export const ENV_SPEC = [
  // --- Core query path (every demo query depends on these) ---
  { name: 'OPENROUTER_API_KEY', tier: 'required', purpose: 'LLM access — every query (no fallback)' },
  { name: 'MODEL_API_BASE_URL', tier: 'optional', purpose: 'Chat-completions endpoint override — any OpenAI-compatible endpoint (default: OpenRouter)', hasFallback: true },
  { name: 'SOCRATA_MCP_URL', tier: 'required', purpose: 'Socrata MCP endpoint (the demo data source)', hasFallback: true },

  // --- Evidence publish + verify (the demo centerpiece: publish → badge) ---
  { name: 'DATABASE_URL', tier: 'required', purpose: 'Evidence DB — publish + dashboard + detail page' },
  // Selector, not a setting: unset declares the managed serverless driver.
  // DATABASE_URL is load-bearing under BOTH drivers (neon() and pg.Pool both
  // read it), so the db seam has no tier flips — only the selector itself.
  { name: 'DB_DRIVER', tier: 'optional', purpose: "DB driver — 'neon-http' (default) or 'node-postgres' (any Postgres over TCP)", hasFallback: true },
  // Vercel Blob credential: not read at all off that driver (src/lib/storage/index.ts
  // dynamic-imports only the selected driver), so demanding it under s3 would
  // fail an instance that is not on Vercel.
  { name: 'BLOB_READ_WRITE_TOKEN', tier: 'required', purpose: 'Evidence package storage (Vercel Blob)', onlyWhen: { blob: 'vercel-blob' } },
  { name: 'BLOB_DRIVER', tier: 'optional', purpose: "Blob storage driver — 'vercel-blob' (default) or 's3' (any S3-compatible endpoint)", hasFallback: true },
  // S3-compatible storage (read only when BLOB_DRIVER=s3; see src/lib/storage/s3.ts).
  // The three credentials below are hard throws in resolveS3ConfigFromEnv
  // (s3.ts:67-69); the rest resolve to coded defaults.
  { name: 'S3_ENDPOINT', tier: 'optional', purpose: 'S3-compatible endpoint URL (BLOB_DRIVER=s3; omit for AWS S3 proper)', hasFallback: true },
  { name: 'S3_REGION', tier: 'optional', purpose: 'S3 region (BLOB_DRIVER=s3; default us-east-1)', hasFallback: true },
  { name: 'S3_BUCKET', tier: 'optional', purpose: 'S3 bucket for evidence blobs (required when BLOB_DRIVER=s3)', requiredWhen: { blob: 's3' } },
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
  // Sandbox-only: the container driver boots a local image and reads none of
  // these four (vercel-sandbox.ts:89-96 is behind the driver's dynamic import).
  { name: 'SANDBOX_SNAPSHOT_ID', tier: 'recommended', purpose: 'Prebuilt sandbox snapshot — absent, the vercel-sandbox driver falls back to a slow fresh boot + pip install', hasFallback: true, onlyWhen: { executor: 'vercel-sandbox' } },
  { name: 'VERCEL_TOKEN', tier: 'optional', purpose: 'Vercel Sandbox auth for off-platform runs (on-deploy auth is OIDC-automatic)', onlyWhen: { executor: 'vercel-sandbox' } },
  { name: 'VERCEL_TEAM_ID', tier: 'optional', purpose: 'Vercel Sandbox auth for off-platform runs (with VERCEL_TOKEN + VERCEL_PROJECT_ID)', onlyWhen: { executor: 'vercel-sandbox' } },
  { name: 'VERCEL_PROJECT_ID', tier: 'optional', purpose: 'Vercel Sandbox auth for off-platform runs (with VERCEL_TOKEN + VERCEL_TEAM_ID)', onlyWhen: { executor: 'vercel-sandbox' } },

  { name: 'EVIDENCE_SIGNING_KEY', tier: 'required', purpose: 'Ed25519 private key — signs evidence packages' },
  { name: 'EVIDENCE_KEY_ID', tier: 'required', purpose: 'Active signing key id (kid) — must match the trust registry', hasFallback: true }, // signing.ts: `EVIDENCE_KEY_ID || DEFAULT_KEY_ID`; the default mirrors the registry's active kid

  // --- Sign-in path (the rate-limit headroom option; OAuth) ---
  { name: 'NEXTAUTH_SECRET', tier: 'required', purpose: 'NextAuth session encryption' },
  { name: 'NEXTAUTH_URL', tier: 'required', purpose: 'OAuth callback base URL (must match the deploy origin)' },
  { name: 'GITHUB_CLIENT_ID', tier: 'required', purpose: 'GitHub sign-in (raises the per-user rate limit)' },
  { name: 'GITHUB_CLIENT_SECRET', tier: 'required', purpose: 'GitHub sign-in (raises the per-user rate limit)' },
  // Generic OIDC sign-in (optional — active only when ISSUER + CLIENT_ID +
  // CLIENT_SECRET are all present; unset, sign-in is GitHub only).
  { name: 'OIDC_ISSUER', tier: 'optional', purpose: 'Generic OIDC sign-in — issuer URL (discovery-based)' },
  { name: 'OIDC_CLIENT_ID', tier: 'optional', purpose: 'Generic OIDC sign-in — client id' },
  { name: 'OIDC_CLIENT_SECRET', tier: 'optional', purpose: 'Generic OIDC sign-in — client secret' },
  { name: 'OIDC_PROVIDER_NAME', tier: 'optional', purpose: 'OIDC sign-in button label (default "SSO")', hasFallback: true },

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

  // --- Instance identity (ADR-0020: config-not-code; see docs/instance-setup.md
  //     and src/lib/site-config.ts). All optional: with none set, every surface
  //     emits the demo deployment's historical values byte-identically. An
  //     instance sets EVIDENCE_SITE_ORIGIN (+ the signer set) and every derived
  //     surface follows; the rest are per-item overrides for split hosts. ---
  { name: 'EVIDENCE_SITE_ORIGIN', tier: 'optional', purpose: 'Instance origin — registry URLs, verify fallback, platform-agent URL, notebook/bundle attribution links derive from it', hasFallback: true },
  { name: 'EVIDENCE_PUBLICATION_HOST', tier: 'optional', purpose: 'Host label on publishes-attestations, datHere environment.host, notebook/skill-text host mentions', hasFallback: true },
  { name: 'EVIDENCE_TRUST_REGISTRY_CANONICAL_URL', tier: 'optional', purpose: 'Sidecar trustRegistryUrl override (defaults to origin + well-known path)', hasFallback: true },
  { name: 'EVIDENCE_TRUST_REGISTRY_LEGACY_URL', tier: 'optional', purpose: 'Sidecar trustRegistryUrlLegacy override (empty string omits it)', hasFallback: true },
  { name: 'EVIDENCE_SIGNER_BINDING_TIER', tier: 'optional', purpose: 'Envelope signer claim: bindingTier — must match the registry entry (check #14)', hasFallback: true },
  { name: 'EVIDENCE_SIGNER_IDENTIFIER', tier: 'optional', purpose: 'Envelope signer claim: identifier — must match the registry entry (check #14)', hasFallback: true },
  { name: 'EVIDENCE_SIGNER_DISPLAY_NAME', tier: 'optional', purpose: 'Envelope signer claim: displayName — must match the registry entry (check #14)', hasFallback: true },
  { name: 'EVIDENCE_PLATFORM_AGENT_ID', tier: 'optional', purpose: 'PROV platform-agent id inside the signed provenance graph', hasFallback: true },
  { name: 'EVIDENCE_PLATFORM_AGENT_TITLE', tier: 'optional', purpose: 'PROV platform-agent title + notebook attribution display name', hasFallback: true },
  { name: 'EVIDENCE_PLATFORM_AGENT_URL', tier: 'optional', purpose: 'PROV platform-agent URL (defaults to EVIDENCE_SITE_ORIGIN when set)', hasFallback: true },

  // --- Optional / feature / ops ---
  { name: 'EVIDENCE_TRUST_REGISTRY_URL', tier: 'optional', purpose: 'External trust-registry override', hasFallback: true },
  { name: 'CIVICAITOOLS_SESSION_TOKEN', tier: 'optional', purpose: 'publish-evidence skill (Claude Code) auth' },
  { name: 'CRON_SECRET', tier: 'optional', purpose: 'Cron endpoint auth (blob-gc, portal refresh)' },
  { name: 'NEXT_PUBLIC_GA_MEASUREMENT_ID', tier: 'optional', purpose: 'Google Analytics 4' },

  // --- Tuning knobs with coded defaults (previously unenumerated; the app
  //     reads them but runs on built-in defaults when absent) ---
  { name: 'ANONYMOUS_RATE_LIMIT', tier: 'optional', purpose: 'Anonymous per-day query limit (default 10)', hasFallback: true },
  { name: 'AUTHENTICATED_RATE_LIMIT', tier: 'optional', purpose: 'Authenticated per-day query limit (default 25)', hasFallback: true },
  { name: 'TOKEN_LIMIT_PER_REQUEST', tier: 'optional', purpose: 'Streaming token budget per request (coded default)', hasFallback: true },
  { name: 'MAX_TOOL_RESULT_CHARS', tier: 'optional', purpose: 'Tool-result truncation budget (coded default)', hasFallback: true },
  { name: 'NEXT_PUBLIC_CAPTURE_TRACES', tier: 'optional', purpose: 'Dev-only BPMN trace capture toggle', hasFallback: true },
  { name: 'NEXT_PUBLIC_SOCRATA_MCP_URL', tier: 'optional', purpose: 'Client-side Socrata MCP URL for notebook output links', hasFallback: true },

  // --- scripts/-only (not read by the app; enumerated for completeness) ---
  { name: 'EVAL_MODELS', tier: 'optional', purpose: 'Model-eval harness roster (scripts/eval-models.mjs only)', hasFallback: true },
  { name: 'EVAL_QUERIES', tier: 'optional', purpose: 'Model-eval harness query set (scripts/eval-models.mjs only)', hasFallback: true },
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
 * Resolve the declared spec against an instance profile: drop entries the
 * profile will never read, and promote entries the profile makes load-bearing.
 *
 * With every selector at its default this is the identity transform on
 * ENV_SPEC (see the CONSTRAINT note on ENV_SPEC), which is what keeps the
 * default profile's report byte-identical.
 *
 * @param {Record<string, string>} drivers
 * @param {typeof ENV_SPEC} [spec]
 * @returns {{ applicable: typeof ENV_SPEC, notApplicable: typeof ENV_SPEC }}
 */
export function resolveSpec(drivers, spec = ENV_SPEC) {
  const applicable = [];
  const notApplicable = [];
  for (const s of spec) {
    if (s.onlyWhen && !conditionMet(s.onlyWhen, drivers)) {
      notApplicable.push(s);
      continue;
    }
    const promoted = s.requiredWhen && conditionMet(s.requiredWhen, drivers);
    applicable.push(promoted ? { ...s, tier: 'required' } : s);
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
  const { applicable, notApplicable } = resolveSpec(drivers, spec);

  const rows = applicable.map((s) => {
    const raw = env[s.name];
    const present = typeof raw === 'string' && raw.trim().length > 0;
    return {
      name: s.name,
      tier: s.tier,
      purpose: s.purpose,
      hasFallback: Boolean(s.hasFallback),
      present,
    };
  });

  // A required var with a coded fallback (`hasFallback`) is NOT a hard miss when
  // absent — the app substitutes a built-in default (e.g. signing.ts uses
  // DEFAULT_KEY_ID for EVIDENCE_KEY_ID). It is surfaced separately so the
  // default's continued correctness (e.g. the kid still matching the trust
  // registry across a key rotation) can be confirmed, without failing the run.
  const missingRequired = rows.filter((r) => r.tier === 'required' && !r.present && !r.hasFallback);
  const requiredOnFallback = rows.filter((r) => r.tier === 'required' && !r.present && r.hasFallback);
  const missingRecommended = rows.filter((r) => r.tier === 'recommended' && !r.present);

  return {
    rows,
    missingRequired,
    requiredOnFallback,
    missingRecommended,
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
