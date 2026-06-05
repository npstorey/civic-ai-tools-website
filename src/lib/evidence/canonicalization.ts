// Canonicalization + hashing core (spec §8.2, §8.3.1, §12.3).
//
// As of civic-ai-tools-website#116 WS2 the implementation lives in the
// browser-safe `verify-core/canonicalization.ts` (the SHA-256 backend swapped
// from `node:crypto` to `@noble/hashes`; RFC 8785 JCS via `canonicalize` reused
// verbatim). This file re-exports it so the packager (producer), the attestation
// builder, and the verifier — across both the server and the typedstandards.org
// browser client (WS3) — stay on a single implementation. A package re-verifies
// to the exact hash it was published under regardless of where the check runs;
// the digests are byte-identical to the prior Node implementation.
export * from './verify-core/canonicalization.ts';
