# Record commitment API (`GET /api/records/<hash|slug>/commitment`)

The commitment endpoint is the **public proof sidecar** for a published record package. It returns the spec §9.2.1 *commitment view* — the package hash, the signature envelope, and the public-log proofs (RFC 3161 timestamp, Rekor entry + inclusion proof), plus the signed envelope claims and pointers to the package blob and the publisher's trust registry.

It exists so a third party can resolve a package's proofs and **verify it independently** — client-side, against public infrastructure — rather than trusting a civicaitools.org-rendered verdict. The view is *self-describing*: it carries `packageUrl` (the canonical blob) and `trustRegistryUrl` (the publisher's key registry), so a single `hash → commitment` lookup bootstraps the entire verification.

It is the read-only counterpart to the write path documented in [`records-publish.md`](./records-publish.md), and the WS1 deliverable of [civic-ai-tools-website#116](https://github.com/npstorey/civic-ai-tools-website/issues/116) (the standalone third-party verifier).

**Status:** protocol version `0.1.0`. Fields are added backwards-compatibly; absent optional fields are omitted (never emitted as `null`).

> **Renamed 2026-08-19 — nothing an existing integration does stops working.**
> The vocabulary settlement (Appendix J of the
> [Typed Standards specification](https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/typed-standards-specification.md);
> [civic-ai-tools#160](https://github.com/npstorey/civic-ai-tools/issues/160))
> made `records` canonical here. `GET /api/records/<hash|slug>/commitment` is
> the canonical path and `GET /api/evidence/<hash|slug>/commitment` is a
> **permanent alias** serving the identical handler — every deep link already
> in the wild keeps resolving. The one field that changed spelling is the
> version key: see `protocolVersion` below, which is dual-era.

---

## Request

```
GET /api/records/<identifier>/commitment        # canonical
GET /api/evidence/<identifier>/commitment       # permanent alias, identical response
```

`<identifier>` is **auto-detected**:

| Form | Match | Resolution |
|------|-------|------------|
| **Hash** | 64 lowercase/uppercase hex chars (`/^[0-9a-f]{64}$/i`) — the base-package hash | Looks up by `basePackageHash`. See *hash → row ambiguity* below. |
| **Slug** | anything else | Looks up by the unique `slug`. Unambiguous. |

- **No authentication.** The proofs are public, read-only, and credential-free.
- **Method:** `GET` (and `OPTIONS` for CORS preflight). No request body.
- **Caching:** `Cache-Control: public, max-age=60, s-maxage=60`. The proofs are immutable for a given hash, but lifecycle state (withdrawal/reinstatement) can change after publish, so the window is short.

### CORS

The endpoint is **CORS-open** (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`). The proofs are public and the verifier is forkable / anyone-can-run ([ADR-0013](https://github.com/npstorey/civic-ai-tools/blob/main/docs/adr/0013-verification-rendering-delegation.md) / open-questions Q47), so access is open rather than restricted to a single origin.

The two other resources a cross-origin verifier must fetch are already CORS-open (verified 2026-06-04): the **Vercel Blob** package object (`access-control-allow-origin: *`) and the **trust registry** at both `/.well-known/typed-publisher.json` (canonical) and `/.well-known/evidence-public-keys.json` (legacy).

### Self-contained bundle (`?inline=1`)

By default the commitment is a lightweight **pointer**: it carries `packageUrl` and `trustRegistryUrl`, and a verifier fetches those two resources to complete verification.

Pass **`?inline=1`** (also `?inline` / `?inline=true`; `?inline=0` / `?inline=false` are off) to get a **self-contained bundle** — the same commitment view, plus:

| Field | Inlined value |
|-------|---------------|
| `package` | the full canonical package JSON (otherwise fetched from `packageUrl`) |
| `trustRegistry` | the publisher's trust registry document, with its `generatedAt` as-of date (otherwise fetched from `trustRegistryUrl`) |

The RFC 3161 timestamp, the Rekor entry body + inclusion proof, and the signed lifecycle attestation chain are **already inline** in the default view, so an `?inline=1` response needs **zero network** to verify: the client-side verifier recomputes the hash, signature, content fingerprint, key trust (against the inlined registry — surfaced with the snapshot's as-of date and an online-recheck affordance), the RFC 3161 chain, the Rekor Merkle inclusion, and the lifecycle chain, all offline (`#119` Q15). Save the response to a file and verify it anywhere, later, with no connectivity.

Trade-off: the inline form is larger (it embeds the whole package), so the default stays the lightweight pointer. Both forms cache separately (the cache key includes the query string).

---

## Response (`200`)

A JSON object — the commitment view. Always-present fields:

| Field | Source | Notes |
|-------|--------|-------|
| `protocolVersion` | constant | `"0.1.0"`. **Dual-era key** (spec §8.8.1 / Appendix J): commitment views minted before this publisher's 2026-08-19 cutover carry the same value under the prior-era key `evidenceProtocolVersion`, which stays valid **forever** — it is frozen inside bundles already exported to readers' disks. A conformant verifier MUST accept either key; this publisher now emits `protocolVersion` alone, never both. Because a commitment view is assembled at read time and is not itself a signed artifact, a record published long before the settlement is served today under the new key while the package it points at keeps its prior-era identifiers. |
| `packageHash` | DB `basePackageHash` | Hex SHA-256 of the canonical envelope; the content node's nodeId. |
| `packageUrl` | DB `basePackageStorageKey` | Public, content-addressable Vercel Blob URL (`…/evidence-packages/<hash>.json`). The verifier fetches this to recompute the hash and verify the signature. |
| `captureMethod` | DB `captureMethod` | Signed capture-method label (ADR-0003), or `null`. Shown next to the signature: *signed ≠ verbatim ≠ correct*. |
| `contentProfile` | DB `contentProfile` | `"datHere"` or `"default"` (absent column ⇒ `"default"`). |
| `trustRegistryUrl` | constant | **Canonical** `/.well-known/typed-publisher.json` (ADR-0012). New clients SHOULD resolve keys from here. |
| `trustRegistryUrlLegacy` | constant | Byte-identical legacy `/.well-known/evidence-public-keys.json`, emitted alongside for older clients. |
| `subjectTitle` | DB `title` | Public title. |
| `subjectSummary` | DB `summary` | Public, citation-ready summary. |

Conditionally-present fields (omitted when absent):

| Field | Source | Present when |
|-------|--------|--------------|
| `signature` | DB `basePackageSignature` (parsed) | `{ signature, publicKey, algorithm, kid }`. Carried **verbatim**. `algorithm` is load-bearing — an independent verify-core MUST dispatch `ed25519` vs `ed25519ph` on it. `kid` is the registry lookup handle; both `algorithm` and `kid` may be absent on packages signed via a pre-kid / plain-Ed25519 path. |
| `rfc3161Timestamp` | DB | Base64 RFC 3161 timestamp token. |
| `rekorEntryId` | DB | Sigstore Rekor transparency-log entry id. |
| `rekorInclusionProof` | DB | JSON-stringified Merkle inclusion proof, stored at publish time. |
| `producerProfile` | package blob | Envelope §8.1.1 producer-profile label. |
| `type` | package blob | Two-family node type (`content/<noun>/v<N>`); absence ⇒ `content/analysis/v1`. |
| `signer` | package blob | **Envelope §8.5 signer claim** `{ bindingTier, identifier, displayName, verifiedAt? }` — the subject of verify check #14. Distinct from `signerIdentity` below. |
| `contentHash` | package blob | Multihash digest set (§8.2), e.g. `{ "sha256": "…" }`. |
| `contentCanonicalization` | package blob | Canonicalization-rule URI (§8.2). |
| `signerIdentity` | DB `users` | The publishing user's **public GitHub identity** `{ provider: "github", providerId, displayName, profileUrl }` — *informational*. `providerId` is the public GitHub user id, **not** an internal DB id. |
| `lifecycle` | DB lifecycle columns | Present only when the package has lifecycle history (see below). |

> **`signer` vs `signerIdentity`.** These are two different things and must not be conflated. `signer` is the *envelope-side* identity claim that the signature commits to — a verifier treats `signer.identifier` as the check-#14 subject. `signerIdentity` is the *publishing user's* public GitHub identity, surfaced for human context only. A verifier MUST NOT use the GitHub identity as the signature subject.

> **Envelope fields and the blob.** `producerProfile` / `type` / `signer` / `contentHash` / `contentCanonicalization` come from the canonical package JSON, which the endpoint fetches best-effort. If the blob is briefly unreachable, these are omitted but the DB-sourced proofs (hash, signature, timestamp, Rekor) are still served — and a verifier re-derives the envelope fields from the package it fetches itself via `packageUrl`. Pre-v0.1 (legacy) packages simply don't carry them, and read calm rather than failed.

### Lifecycle

`lifecycle` is present only when the package has been withdrawn at some point:

```jsonc
{
  "status": "withdrawn",          // "withdrawn" if currently withdrawn, else "active" (reinstated)
  "withdrawnAt": "2026-06-02T12:00:00.000Z",
  "withdrawnReason": "…",         // present if the publisher gave one
  "reinstatedAt": "…",            // present if later reinstated
  "reinstatedReason": "…"
}
```

A never-withdrawn package omits `lifecycle` entirely. The state is derived from the record row's lifecycle columns, which the withdraw/reinstate routes dual-write alongside the signed `attestation/*` node — the same columns are already public via `/api/records/list` and the detail page. Independent verification of the *signed lifecycle attestation chain itself* (not just the state) is tracked under WS2 / [#119](https://github.com/npstorey/civic-ai-tools-website/issues/119).

> **Withdrawn packages are served, not 404'd.** A withdrawn package's base signature still verifies — withdrawal is a separate, separately-signed action. Independent verification must work on it, so the endpoint returns the full commitment with the `lifecycle` state attached.

---

## Errors

| Status | When |
|--------|------|
| `404 { "error": "Record not found" }` | No row matches the identifier, or the row is not public (`isPublic = false`). |
| `404 { "error": "No published record package for this identifier" }` | The row exists but never completed publishing (no `basePackageHash`) — nothing to commit to. |

Both message strings were reworded on 2026-08-19 by the vocabulary settlement (they previously read "Evidence not found" and "No published evidence package for this identifier"). The status codes and the conditions that produce them are unchanged; a client discriminating on the message text should discriminate on the status code instead.

All error responses also carry the CORS headers.

---

## Hash → row ambiguity

Re-publishing the same package under a different title creates a **second `evidence_records` row with the same `basePackageHash`** (the table name is a recorded exemption under Appendix J — database names never cross the wire) (the immutable blob is identical, possibly with a separate signing run). Because the signature is over the hash, *any* matching row's proofs verify.

- The **hash form** returns the **canonical (first / oldest-created)** matching row, ordered by `createdAt` ascending.
- The **slug form** is unambiguous (the slug is unique).

A verifier that needs a specific publication should use the slug form; for pure cryptographic verification of the bytes, any matching row is equivalent.

---

## What a verification result means

The commitment view supplies the *inputs* to verification; the verdict is computed by the verifier (client-side). A successful verification asserts **integrity** (bytes unaltered since signing), **publisher identity** (the signature traces to a key the declared publisher lists as authorized), **timestamp** (an independent TSA recorded the signature), and **public record** (the signature is in the Rekor transparency log). It does **not** assert **correctness** — whether the analysis is right, unbiased, or complete. See `civic-ai-tools/docs/trust-and-evidence.md`.

---

## Example

```bash
# By hash (canonical match)
curl https://civicaitools.org/api/records/ef1a431c16bf00262bb4e706b0870617fd44bd5d0d3828f9885bd6aefea9a1ba/commitment

# By slug (unambiguous)
curl https://civicaitools.org/api/records/noise-trends-in-nyc-last-tuesday-ef1a43/commitment

# The prior-era segment serves the identical response, permanently:
curl https://civicaitools.org/api/evidence/noise-trends-in-nyc-last-tuesday-ef1a43/commitment
```

---

## Change log

- **2026-08-19** — **Vocabulary settlement** (Appendix J of the [Typed Standards specification](https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/typed-standards-specification.md); anchor [civic-ai-tools#160](https://github.com/npstorey/civic-ai-tools/issues/160)). `GET /api/records/<hash|slug>/commitment` becomes the canonical path, with `GET /api/evidence/<hash|slug>/commitment` a **permanent alias** serving the identical handler — no deep link stops resolving. The version key becomes `protocolVersion`; views minted earlier carry `evidenceProtocolVersion` and both are valid forever, so a conformant verifier MUST accept either. This publisher emits the canonical key alone on newly minted views, for old and new records alike, because a commitment view is assembled at read time and is not a signed artifact. The two `404` message strings were reworded to the settlement vocabulary (status codes and conditions unchanged). This document was renamed `evidence-commitment.md` → `records-commitment.md`, with the old filename kept as a permanent stub. Not renamed: the `evidence_records` table, the `evidence-packages/` blob prefix, the signing kid, and the legacy trust-registry path — all recorded exemptions in Appendix J.
- **2026-06-04** — Initial endpoint. Extracted and generalized `buildCommitmentView` from the notebook bundle route into `src/lib/evidence/commitment.ts`; added the public, CORS-open `GET /api/evidence/<hash|slug>/commitment`. WS1 of #116.
- **2026-06-08** — Added the opt-in `?inline=1` self-contained bundle (inlines `package` + the stamped `trustRegistry`) so the commitment verifies with zero network — the verifier reaches `fullyOffline`. Default form unchanged. #119 Q15a.
