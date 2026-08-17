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
// the build-time bundled JSON → on-disk read → HTTP fetch, using `fs` / `path` /
// `process.env`. verify-core's `verifyKeyTrust` takes the registry as DATA; this
// loader is how the server obtains it. WS3's browser client obtains the registry
// by fetching the sidecar's `trustRegistryUrl` instead.

import { promises as fs } from 'fs';
import path from 'path';
import { validateRegistry, type TrustRegistry } from './verify-core/index.ts';
import { getEvidenceSiteOrigin } from '../site-config.ts';

// Re-export the entire browser-safe verification core: the §9.2 check functions,
// the `verifyEvidence` orchestrator, every status vocabulary, and all result
// types. This is the single source the server route and (WS3) the browser client
// both consume.
export * from './verify-core/index.ts';

// Build-time import of the checked-in trust registry. This is the most reliable
// source on Vercel: a filesystem read relies on `process.cwd()` resolving to a
// directory that actually contains the bundled `public/` folder, and an HTTP
// fetch back to our own origin is blocked by preview-deployment auth walls. The
// static import has Next.js bundle the JSON into the function's module graph at
// build time so `loadTrustRegistry` can return a result synchronously.
import embeddedTrustRegistry from '../../../public/.well-known/evidence-public-keys.json' with { type: 'json' };

// --- Registry loader ---
//
// Module-level TTL cache around the resolution chain. Keeps per-request latency
// low without re-reading for every `/evidence/[slug]` page load. The verify route
// calls `loadTrustRegistry()` and passes the result into verify-core's
// `verifyKeyTrust`.

const REGISTRY_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  registry: TrustRegistry | undefined;
  expiresAt: number;
}

const registryCache: Map<string, CacheEntry> = new Map();

/** Resolve the URL for the platform trust registry. Can be overridden via
 *  `EVIDENCE_TRUST_REGISTRY_URL` for previews or local dev. The fallback
 *  tail is the instance's configured origin (ADR-0020), then the reference
 *  origin literal — the VERIFY path's historical resolution, deliberately
 *  byte-identical across #258 (which removed identity defaults from
 *  signing/emission paths only; this resolution's defects are a separate
 *  charter). In practice the HTTP fetch this URL feeds is the last resort
 *  behind the bundled and on-disk registries below. */
export function getTrustRegistryUrl(): string {
  const override = process.env.EVIDENCE_TRUST_REGISTRY_URL;
  if (override) return override;
  const site =
    process.env.NEXTAUTH_URL ||
    getEvidenceSiteOrigin() ||
    'https://civicaitools.org';
  return `${site.replace(/\/$/, '')}/.well-known/evidence-public-keys.json`;
}

/** Filesystem location of the registry within the Next.js build output. */
const REGISTRY_PUBLIC_PATH = path.join('public', '.well-known', 'evidence-public-keys.json');

export async function loadTrustRegistry(
  url: string = getTrustRegistryUrl(),
): Promise<TrustRegistry | undefined> {
  const cached = registryCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.registry;
  }
  // Resolution order:
  //   1. Build-time bundled JSON (always present in the deploy artifact)
  //   2. On-disk read (dev server, tests running from project root)
  //   3. HTTP fetch (external verifiers / cross-origin)
  // The HTTP path exists for external adopters; our own verify route should never
  // need it because the bundled import is authoritative.
  const resolved =
    validateRegistry(embeddedTrustRegistry as unknown) ??
    (await readTrustRegistryFromDisk()) ??
    (await fetchTrustRegistry(url));
  registryCache.set(url, { registry: resolved, expiresAt: Date.now() + REGISTRY_TTL_MS });
  return resolved;
}

/** For tests / rotation drills: drop the in-memory cache. */
export function clearTrustRegistryCache(): void {
  registryCache.clear();
}

async function readTrustRegistryFromDisk(): Promise<TrustRegistry | undefined> {
  try {
    const localPath = path.join(process.cwd(), REGISTRY_PUBLIC_PATH);
    const json = await fs.readFile(localPath, 'utf-8');
    return validateRegistry(JSON.parse(json));
  } catch (err) {
    // Not all runtimes have the file at the expected path (e.g. unit tests run
    // from a different cwd). Silently fall through so callers can still try the
    // HTTP URL.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[verify] Failed to read trust registry from disk:', err instanceof Error ? err.message : err);
    }
    return undefined;
  }
}

async function fetchTrustRegistry(url: string): Promise<TrustRegistry | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[verify] Trust registry fetch returned ${res.status}`);
      return undefined;
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) {
      // Vercel preview protection returns an HTML auth wall with 200 OK. Refuse
      // to treat that as the registry.
      console.warn(`[verify] Trust registry fetch returned unexpected content-type "${ct}"`);
      return undefined;
    }
    return validateRegistry(await res.json());
  } catch (err) {
    console.warn('[verify] Trust registry fetch failed:', err instanceof Error ? err.message : err);
    return undefined;
  }
}
