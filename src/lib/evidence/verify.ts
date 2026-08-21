// Server-side evidence verification facade.
//
// As of civic-ai-tools-website#116 WS2 the §9.2 check functions live in the
// browser-safe `verify-core/` module; this file re-exports them so every existing
// importer (the verify route, lifecycle orchestration, the trust-signal
// vocabulary, the detail page, tests) keeps importing from `@/lib/evidence/verify`
// unchanged, while the implementation is single-sourced in verify-core and cannot
// drift from the typedstandards.org browser verifier (WS3).
//
// What stays HERE (server-only, deliberately outside verify-core's browser-safe
// boundary): the trust-registry LOADER. It resolves the platform registry from
// the build-time bundled JSON. (Prior to civic-ai-tools#155 P1b this chain also
// had an on-disk read and an HTTP-fetch fallback, fed by a
// `PUBLISHER_TRUST_REGISTRY_URL` override; both were retired as dead code — see
// the loader below.) verify-core's `verifyKeyTrust` takes the registry as DATA;
// this loader is how the server obtains it. WS3's browser client obtains the
// registry by fetching the sidecar's `trustRegistryUrl` instead.

import { validateRegistry, type TrustRegistry } from './verify-core/index.ts';

// Re-export the entire browser-safe verification core: the §9.2 check functions,
// the `verifyEvidence` orchestrator, every status vocabulary, and all result
// types. This is the single source the server route and (WS3) the browser client
// both consume.
export * from './verify-core/index.ts';

// Build-time import of the checked-in trust registry — the sole source now
// (civic-ai-tools#155 P1b). It was always the most reliable of the three
// resolution steps this loader used to try: a filesystem read relies on
// `process.cwd()` resolving to a directory that actually contains the bundled
// `public/` folder, and an HTTP fetch back to our own origin is blocked by
// preview-deployment auth walls — both were retired as dead code once P1
// measured that this embedded import alone already satisfied every real call
// path. The static import has Next.js bundle the JSON into the function's
// module graph at build time so `loadTrustRegistry` can return a result
// synchronously.
import embeddedTrustRegistry from '../../../public/.well-known/evidence-public-keys.json' with { type: 'json' };

// --- Registry loader ---
//
// Module-level TTL cache around the resolution. Keeps per-request latency low
// without re-reading for every `/evidence/[slug]` page load. The verify route
// calls `loadTrustRegistry()` and passes the result into verify-core's
// `verifyKeyTrust`.
//
// civic-ai-tools#155 P1b: this used to be a three-step resolution chain
// (build-time bundled JSON → on-disk read → HTTP fetch, the last two fed by
// an optional `PUBLISHER_TRUST_REGISTRY_URL` / `EVIDENCE_TRUST_REGISTRY_URL`
// override). P1 measured that steps 2-3 are dead code on every real call
// path: `validateRegistry` accepts any well-formed `{"keys": [...]}` object
// (even an empty array), so step 1 always resolves for a checked-in registry
// file that parses at all, and neither production caller (`/verify`,
// `/commitment`) ever passed a `url`. The owner ruled to retire the override
// rather than repair it — every instance replaces the checked-in registry
// file at build time, so no instance needs the lever, and a knob that
// silently does nothing is worse than no knob. `loadTrustRegistry` now
// resolves solely from the embedded JSON import; there is no `url` parameter
// and no on-disk or network fallback. A `TrustRegistry | undefined` return
// type is kept because `validateRegistry` can still (in principle) reject a
// corrupted checked-in file — that failure mode predates and is orthogonal to
// this retirement, so callers keep handling `undefined` via verify-core's
// existing `registry_unavailable` status.

const REGISTRY_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  registry: TrustRegistry | undefined;
  expiresAt: number;
}

let registryCache: CacheEntry | undefined;

export async function loadTrustRegistry(): Promise<TrustRegistry | undefined> {
  if (registryCache && registryCache.expiresAt > Date.now()) {
    return registryCache.registry;
  }
  const resolved = validateRegistry(embeddedTrustRegistry as unknown);
  registryCache = { registry: resolved, expiresAt: Date.now() + REGISTRY_TTL_MS };
  return resolved;
}

/** For tests / rotation drills: drop the in-memory cache. */
export function clearTrustRegistryCache(): void {
  registryCache = undefined;
}
