#!/usr/bin/env node
/**
 * Demo-day environment preflight.
 *
 * Checks the PRESENCE (never the value) of the environment variables the
 * civic-ai-tools-website needs in production, and prints a grouped pass/fail
 * table. Built for the demo dry-run: several of these vars fail silently or
 * with a generic error when absent (DATABASE_URL, BLOB_READ_WRITE_TOKEN,
 * EVIDENCE_SIGNING_KEY, EVIDENCE_KEY_ID, the MCP endpoints, the model key),
 * so a one-shot "is everything wired?" check removes that failure mode.
 *
 * SECRET HYGIENE (absolute): this script only reads whether
 * `process.env[NAME]` is a non-empty string. It never prints, logs, hashes,
 * stores, or transmits any value — not even its length. The output is a
 * present/absent table keyed by variable NAME only.
 *
 * Run it through 1Password so the op:// references in .env.local resolve into
 * this process's environment:
 *
 *   op run --env-file=.env.local -- node scripts/preflight-env.mjs
 *
 * Exit code is 0 when every REQUIRED variable is present and 1 otherwise, so
 * the script can gate a deploy check or a CI step. Missing RECOMMENDED or
 * OPTIONAL variables are reported but never fail the run.
 *
 * The pure check logic (`evaluateEnv`, `ENV_SPEC`) is exported and covered by
 * scripts/preflight-env.test.mjs (run: `node --test scripts/preflight-env.test.mjs`).
 */

import { fileURLToPath } from 'node:url';

/**
 * The variables the app actually reads (grepped from `process.env.*` across
 * src/). Tiers:
 *   - required:    the demo's load-bearing path fails without it.
 *   - recommended: a feature degrades or a fallback kicks in; not fatal.
 *   - optional:    nice-to-have / non-demo / analytics / dev-only.
 * `hasFallback: true` means the code substitutes a hardcoded default when the
 * var is absent, so its absence is a soft note rather than a hard miss.
 */
export const ENV_SPEC = [
  // --- Core query path (every demo query depends on these) ---
  { name: 'OPENROUTER_API_KEY', tier: 'required', purpose: 'LLM access — every query (no fallback)' },
  { name: 'SOCRATA_MCP_URL', tier: 'required', purpose: 'Socrata MCP endpoint (the demo data source)', hasFallback: true },

  // --- Evidence publish + verify (the demo centerpiece: publish → badge) ---
  { name: 'DATABASE_URL', tier: 'required', purpose: 'Evidence DB — publish + dashboard + detail page' },
  { name: 'BLOB_READ_WRITE_TOKEN', tier: 'required', purpose: 'Evidence package storage (Vercel Blob)' },
  { name: 'EVIDENCE_SIGNING_KEY', tier: 'required', purpose: 'Ed25519 private key — signs evidence packages' },
  { name: 'EVIDENCE_KEY_ID', tier: 'required', purpose: 'Active signing key id (kid) — must match the trust registry' },

  // --- Sign-in path (the rate-limit headroom option; OAuth) ---
  { name: 'NEXTAUTH_SECRET', tier: 'required', purpose: 'NextAuth session encryption' },
  { name: 'NEXTAUTH_URL', tier: 'required', purpose: 'OAuth callback base URL (must match the deploy origin)' },
  { name: 'GITHUB_CLIENT_ID', tier: 'required', purpose: 'GitHub sign-in (raises the per-user rate limit)' },
  { name: 'GITHUB_CLIENT_SECRET', tier: 'required', purpose: 'GitHub sign-in (raises the per-user rate limit)' },

  // --- Rate limiting (durable counter; without it, falls back to per-instance memory) ---
  { name: 'KV_REST_API_URL', tier: 'required', purpose: 'Durable rate-limit counter (Upstash/Vercel KV)' },
  { name: 'KV_REST_API_TOKEN', tier: 'required', purpose: 'Durable rate-limit counter (Upstash/Vercel KV)' },

  // --- Secondary MCP sources (not on the storyboard-3 critical path) ---
  { name: 'DATA_COMMONS_MCP_URL', tier: 'recommended', purpose: 'Data Commons MCP endpoint', hasFallback: true },
  { name: 'DATA_COMMONS_API_KEY', tier: 'recommended', purpose: 'Data Commons auth — DC tool calls fail without it' },
  { name: 'BOSTON_OPENCONTEXT_MCP_URL', tier: 'recommended', purpose: 'Boston OpenContext MCP endpoint', hasFallback: true },

  // --- Optional / feature / ops ---
  { name: 'EVIDENCE_TRUST_REGISTRY_URL', tier: 'optional', purpose: 'External trust-registry override', hasFallback: true },
  { name: 'CIVICAITOOLS_SESSION_TOKEN', tier: 'optional', purpose: 'publish-evidence skill (Claude Code) auth' },
  { name: 'CRON_SECRET', tier: 'optional', purpose: 'Cron endpoint auth (blob-gc, portal refresh)' },
  { name: 'NEXT_PUBLIC_GA_MEASUREMENT_ID', tier: 'optional', purpose: 'Google Analytics 4' },
];

const TIER_ORDER = ['required', 'recommended', 'optional'];

/**
 * Pure presence evaluation. Reads only whether each value is a non-empty
 * string; returns no values. `ok` is true iff every required var is present.
 *
 * @param {Record<string, string | undefined>} env
 * @param {typeof ENV_SPEC} [spec]
 */
export function evaluateEnv(env, spec = ENV_SPEC) {
  const rows = spec.map((s) => {
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

  const missingRequired = rows.filter((r) => r.tier === 'required' && !r.present);
  const missingRecommended = rows.filter((r) => r.tier === 'recommended' && !r.present);

  return { rows, missingRequired, missingRecommended, ok: missingRequired.length === 0 };
}

/** Status token for a row. Pure; no values involved. */
function statusToken(row) {
  if (row.present) return 'PASS   ';
  if (row.tier === 'required') return 'MISSING';
  if (row.hasFallback) return 'fallbk ';
  return 'absent ';
}

/** Render the table as a string (so it is testable / not coupled to stdout). */
export function renderReport(result) {
  const lines = [];
  lines.push('');
  lines.push('  civic-ai-tools-website — environment preflight');
  lines.push('  (presence only; no values are read or shown)');
  lines.push('');

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
  } else {
    lines.push(`  RESULT: FAIL — ${result.missingRequired.length} required variable(s) missing:`);
    for (const r of result.missingRequired) lines.push(`            - ${r.name}`);
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
