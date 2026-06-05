// @typedstandards/verify-core consumer shim (civic-ai-tools-website#116 WS3).
//
// The browser-safe §9.2 verification core was extracted to the published
// @typedstandards/verify-core npm package in Phase A (its source previously lived
// in this directory, WS2). This directory is now a thin re-export layer: every
// existing importer (the verify route, the server re-export modules, the
// trust-signal vocabulary, tests) keeps importing from `@/lib/evidence/verify-core`
// and `./verify-core/*` unchanged, while the single source of truth is the
// versioned package — which therefore CANNOT drift from the typedstandards.org
// browser verifier that consumes the exact same package.
//
// Server-only concerns (the trust-registry loader using fs/path/process) stay in
// `../verify.ts`, outside this browser-safe boundary; they import the package's
// `verifyKeyTrust`/`validateRegistry` as data-driven functions.
export * from '@typedstandards/verify-core';
