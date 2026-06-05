// Content-addressable blob references for evidence package fields (spec §9.2
// check #9).
//
// As of civic-ai-tools-website#116 WS2 the implementation lives in the
// browser-safe `verify-core/blob-ref.ts` (the SHA-256 backend swapped to
// `@noble/hashes`; the network fetch is injected, defaulting to the universal
// `globalThis.fetch`). This file re-exports it so the packager, the verifier, the
// detail-page renderer, and the orphan-GC cron — server and the typedstandards.org
// browser client (WS3) — share one implementation. Server callers keep calling
// `verifyBlobRef(ref)` / `verifyBlobRef(ref, { signal })`; the default fetcher is
// read at call time, so existing tests that stub `globalThis.fetch` are honored.
export * from './verify-core/blob-ref.ts';
