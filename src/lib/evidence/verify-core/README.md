# verify-core

The portable, browser-safe evidence verification core. Factored out in
civic-ai-tools-website#116 **WS2** so the §9.2 check suite runs **identically** on
civicaitools.org (server) and the future typedstandards.org browser verifier
(WS3) — one implementation, so a tampered package fails the same way in both.

## Browser-safety contract

This directory is **dependency-free of Node built-ins**. An ESLint
`no-restricted-imports` rule (scoped to `src/lib/evidence/verify-core/**`, see
`eslint.config.mjs`) forbids `node:crypto` / `fs` / `path` / `process` / `crypto`
and any `node:*` import, so a future Node-only import fails CI rather than the
browser at runtime.

- **Hashing** — `@noble/hashes` (SHA-256/512), not `node:crypto`. Digests are
  byte-identical to the prior Node implementation.
- **Signatures** — `@noble/curves` Ed25519 / Ed25519ph, with the #111 algorithm
  dispatch preserved. Raw key bytes come from a fixed-prefix SPKI slice, not
  `crypto.createPublicKey`.
- **Canonicalization** — RFC 8785 JCS via `canonicalize` (already pure).
- **No `Buffer`** — `atob` + `Uint8Array` + `TextDecoder` + `@noble/hashes/utils`.
- **Network is injected** — every check that touches the network takes a
  `FetchLike` (defaulting to `globalThis.fetch`, read at call time). The server
  injects its `fetch`, the browser injects `window.fetch`, tests inject a mock.
  Fetchers must issue **plain GETs with no custom request headers** (a custom
  header triggers a CORS preflight that can fail against civicaitools.org's
  canonical-host 307).

## Inputs / consumers

- **Server route** (`/api/evidence/[slug]/verify`) adapts its DB row to
  `VerifyInput` and calls `verifyEvidence`, supplying its loaded trust registry,
  its `fetch`, and — to preserve its output — its server-deeper lifecycle
  resolution (the signed attestation chain).
- **WS3 browser client** will wire the WS1 commitment sidecar
  (`buildCommitmentView`) straight into `VerifyInput` (the shapes are aligned)
  and fetch the registry from the sidecar's `trustRegistryUrl`.

## Check depth (v1 — matches the current server)

Fully client-side: #1 envelope hash, #2 signature, #3 canonicalization, #4 content
hash, #5 key trust, #6 kid consistency, #9 blob refs, #12 type, #13 nodeId, #14
signer identity, #15 captureMethod vocab. **Presence** only for #7 (RFC 3161).
**Hash-parity** only for #8 (Rekor). **State** depth for #10 (lifecycle) in the
portable path. The deeper offline crypto — TSA-chain verification, Rekor
Merkle-inclusion, independent lifecycle-chain verification, and the authoritative
Q15 bundle-mode test — is the **#119** fast-follow.

## Extraction to `@typedstandards/verify-core`

Structured for it: no app imports, own types (`types.ts`), an `index.ts` barrel.
The actual publish + the second consumer land in **WS3** when typedstandards.org
exists (Xanadu — no publish infra until a real second consumer needs it). The
server modules (`verify.ts`, `canonicalization.ts`, `profiles.ts`, `blob-ref.ts`,
`signing.ts`, `attestation.ts`) re-export **from** here, never the reverse.
