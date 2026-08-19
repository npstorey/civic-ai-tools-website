<!-- v1 — 2026-06-02 — Trust-signal vocabulary + calm-status taxonomy (Evidence trust UX #110, Wave 0). Defines the four severity tiers and assigns one to EVERY verify-library status value plus notebookProvenance, resolves every judgment call, and records three deliberate deviations from the issue brief. Source of truth for src/lib/evidence/trust-signal.ts and src/components/evidence/TrustSignal.tsx. No verification-behavior change; not wired into any live panel (that is #111). -->
<!-- v2 — 2026-06-04 — legacy_embedded copy P7-decoupled to match code (PR #118, commit e032a01, pending merge): label → "Signed with an embedded key (not in the trust registry)"; the detail no longer asserts the signature verified (that is check #2's axis — the registry line speaks only to key trust). Motivated by a live contradiction on the withdrawn da9246 package, whose plain-Ed25519 signature hit a since-fixed Ed25519/Ed25519ph false negative in verify.ts (same PR). Docs-only sync; no tier or verification-behavior change. See §5 #10. -->


# Trust-signal vocabulary + calm-status taxonomy

**Scope:** The severity taxonomy that turns each evidence verify-library status into a calm, plain-language signal — `{ tier, icon, one-liner }` — defined once and reused across the trust-communication surfaces (the verify panel and the provenance surfaces). This note assigns a tier to **every** status the verify route emits, plus `notebookProvenance`, and resolves every judgment call.

**Status:** Foundation (Evidence trust UX milestone, Wave 0 / issue #110). This note + `src/lib/evidence/trust-signal.ts` + `src/components/evidence/TrustSignal.tsx` ship together. **No verification behavior changes**, and the component is **not wired into any live panel** — that is #111.

**Constraint docs (cited, not re-derived):** [`evidence-trust-ux-memo.md`](./evidence-trust-ux-memo.md) §3 (the trust-signal spine); [`design-principles.md`](./design-principles.md) P1 (disclosure ≠ validation), P3 (no false precision), P5 (narrative bridge), P7 (orthogonal axes), P9 (user language); the Typed Standards Specification [§9.2](https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/typed-standards-specification.md) (the 15-check verification list).

---

## 1. What this is, and what it is not

The reference verifier now runs many more checks than the detail-page verify panel surfaces, and several of those checks return statuses that are **"not `ok`" but entirely expected** — every pre-v0.1 (legacy) package produces a fistful of them. Rendered naively, a legacy package would look like a wall of failures. It is not: it is an older-format package that verifies exactly as it should.

The fix is a shared **trust-signal vocabulary**: every verification status maps to one of four **severity tiers**, a controlled icon, and a plain-language one-liner. This note is the taxonomy; `trust-signal.ts` is its machine-readable form; `<TrustSignal>` is the presentational primitive. The keystone requirement (§3) is that **legacy packages read calm**.

**In scope (#110):** the tier taxonomy, the mapping library, the coverage test, and the component. **Out of scope (→ #111):** wiring `<TrustSignal>` into `EvidenceActions.tsx`, changing any check logic, and removing the existing `✅ / ❌ / ➖` `VerifyCheck`.

---

## 2. The four tiers

| Tier | Reads as | Color token | Icon | Meaning |
|---|---|---|---|---|
| **Verified** | green, affirmative | `--success` `#008A02` | check | An affirmative check passed. |
| **Normal** | neutral, calm, informational | `--text-muted` `#757575` | info (`i`) | "Not `ok`" but **expected**. The home of every legacy/back-compat status. **Not a warning.** |
| **Attention** | amber | `--warning` (→ `--caution` `#FFB320`) | warning (`!` triangle) | Something **unconfirmed / unrecognized** — not proven-bad. "Look closer." |
| **Alarm** | red | `--error` `#EC131E` | error (`!` octagon) | A **genuine integrity failure** — altered content, a forged signature, a revoked key. |

The line that matters most is **Normal vs Attention vs Alarm**. Normal is calm (an expected state). Attention is amber (we could not confirm something). Alarm is red (something is provably wrong). Getting a status into the right one of those three is the whole job.

Per **P1 (disclosure ≠ validation)**, none of these tiers say anything about whether the *analysis is correct*. "Verified" means a cryptographic or structural check passed — it never means "the answer is right."

---

## 3. The load-bearing requirement: legacy packages read calm

A pre-v0.1 (legacy) package must show **zero red and zero amber** on the default view. It legitimately produces these statuses, all of which are **Normal** or **Verified**:

| Check | Legacy status | Tier |
|---|---|---|
| #1 envelope integrity | `hashMatch: true` | Verified |
| #2 signature | `signatureValid: true` (embedded key) | Verified |
| #3 canonicalization | `implicit` | Normal |
| #4 content hash | `legacy_relabeled` | **Normal** |
| #5 key trust | `legacy_embedded` | **Normal** |
| #7 timestamp | `hasTimestamp: false` | Normal |
| #8 Rekor | `rekorVerified: null` | Normal |
| #9 BlobRefs | `blobRefsVerified: null` | Normal |
| #10 lifecycle | `active` / source `none` | Normal |
| #12 type | `implicit` | Normal |
| #14 signer identity | `no_signer` | Normal |
| #15 captureMethod vocab | `no_capture_method` | Normal |
| notebookProvenance | `skeleton` | Normal |

The hardest split is **content-hash (#4)**: `legacy_relabeled` (every pre-v0.1 package) is **Normal**, while `content_hash_mismatch` (off-log content altered after signing) is **Alarm** — the same check, opposite tiers. The coverage test (`trust-signal.test.ts`) asserts both this split and that the full synthetic-legacy status set above tiers all-calm.

**The calm requirement applies to SIGNED legacy packages only.** A fully **unsigned** package (no signature envelope at all — `signatureValid: null` co-occurring with `keyTrust: null`) is a different case, deliberately elevated in S3a P3 per ADR-0020 §Consequences guard 2 ("mandatory labeling"): `NO_SIGNING_KEY_SIGNAL` is tiered **Attention**, and the #113 overall glance renders a dedicated `UNSIGNED_PACKAGE_SIGNAL` ("Unsigned package — no cryptographic commitment", Attention) instead of the calm all-clear. Attention, never Alarm — the unsigned dev tier is a legitimate producer state (ADR-0020 §B), but it must be surfaced prominently wherever the package appears, never silently.

---

## 4. Complete status → tier map

Ordered by spec §9.2 check number. "Copy" is the glanceable one-liner; the library also carries a one-sentence `detail` (omitted here for brevity — see `trust-signal.ts`). User language throughout (P9); disclosure, never validation (P1); no invented precision (P3).

### #1 Envelope integrity — `hashMatch: boolean`
| Status | Tier | Copy |
|---|---|---|
| `true` | Verified | Contents unchanged since signing |
| `false` | **Alarm** | Contents changed since signing |

### #2 Signature mathematics — `signatureValid: boolean \| null`
| Status | Tier | Copy |
|---|---|---|
| `true` | Verified | Valid cryptographic signature |
| `false` | **Alarm** | Signature does not verify |
| `null` | Normal | Not signed |

### #3 Content canonicalization — `contentCanonicalization.status`
| Status | Tier | Copy |
|---|---|---|
| `ok` | Verified | Canonicalization rule recognized |
| `implicit` | Normal | Canonicalization inferred (earlier-format package) |
| `unknown_canonicalization_rule` | Attention | Unrecognized canonicalization rule |

### #4 Content hash — `contentHash.status` (the load-bearing split)
| Status | Tier | Copy |
|---|---|---|
| `ok` | Verified | Content matches its fingerprint |
| `legacy_relabeled` | **Normal** | Earlier-format content fingerprint |
| `content_hash_mismatch` | **Alarm** | Content does not match its fingerprint |
| `unresolved_rule` | Attention | Content hash not recomputed (unknown rule) |
| `contentHash_no_supported_algorithm` | Attention | Content hash uses an unsupported algorithm |

### #5 Trust-registry verdict — `keyTrust.status`
| Status | Tier | Copy |
|---|---|---|
| `active` | Verified | Signed with an active registered key |
| `deprecated_valid` | Normal | Signed before the key was rotated out |
| `deprecated_invalid` | **Alarm** | Signed after the key was rotated out |
| `revoked` | **Alarm** | Signed with a revoked key |
| `unknown_key` | Attention | Signing key not in the trust registry |
| `registry_unavailable` | Attention | Trust registry could not be reached |
| `legacy_embedded` | Normal | Signed with an embedded key (not in the trust registry) |
| `null` (unsigned package) | **Attention** | No signing key *(`NO_SIGNING_KEY_SIGNAL`; elevated from Normal in S3a P3 per ADR-0020 guard 2 — see the note in §3)* |

### #7 Timestamp — `hasTimestamp: boolean`
| Status | Tier | Copy |
|---|---|---|
| `true` | Verified | Timestamped |
| `false` | Normal | No timestamp |

### #8 Transparency log (Rekor) — `rekorVerified: boolean \| null`
| Status | Tier | Copy |
|---|---|---|
| `true` | Verified | Recorded in a public transparency log |
| `false` | Attention | Transparency-log entry not confirmed |
| `null` | Normal | Not in a transparency log |

### #9 BlobRef integrity — `blobRefsVerified: boolean \| null`
| Status | Tier | Copy |
|---|---|---|
| `true` | Verified | Referenced content verified |
| `false` | **Alarm** | Referenced content failed verification |
| `null` | Normal | No referenced content |

**#9 per-reference failure reasons** (`blobRefs[].reason`, from `BlobRefVerifyReason`) — each a sub-explanation of an Alarm:
| Reason | Tier | Copy |
|---|---|---|
| `invalid_ref` | Alarm | Malformed content reference |
| `fetch_failed` | Alarm | Referenced content could not be retrieved |
| `size_mismatch` | Alarm | Referenced content is the wrong size |
| `hash_mismatch` | Alarm | Referenced content does not match its fingerprint |

### #10 Lifecycle — `lifecycle.status`, `lifecycle.source`, per-attestation
| Status | Tier | Copy |
|---|---|---|
| `status: active` | Normal | Active |
| `status: withdrawn` | Normal | Withdrawn by the publisher |
| `source: attestation-chain` | Verified | Lifecycle confirmed from signed transitions |
| `source: legacy-columns` | Normal | Lifecycle from earlier-format records |
| `source: none` | Normal | No lifecycle changes |
| per-attestation `signatureValid: false` | **Alarm** | Lifecycle event signature does not verify |
| per-attestation `nodeIdMatches: false` | **Alarm** | Lifecycle event has been altered |
| per-attestation `signerMatchesTarget: false` | Normal | Lifecycle event from a different signer |
| per-attestation `hasTimestamp / hasRekor: false` | Normal | (supplementary) |

Whether lifecycle is surfaced **in the verify panel at all** is left open for #111: it is a separate axis from cryptographic integrity (**P7**), and the detail-page withdrawal banner already gives it prominence. Tiered here for completeness.

### #11 captureMethod LABEL — `metadata.captureMethod`
**Not a tier.** A signature-covered *label* describing how the bytes were captured (spec §9.2 #11 — "signed ≠ verbatim"). Rendered as a neutral informational label adjacent to the signature verdict (#111). `trust-signal.ts` provides plain-language readings in `CAPTURE_METHOD_LABELS` (`chat-flow-stream`, `claude-code-jsonl-readback`, `claude-code-self-report`).

### #12 Type resolution — `typeResolution.status`
| Status | Tier | Copy |
|---|---|---|
| `ok` | Verified | Node type recognized |
| `implicit` | Normal | Node type inferred (earlier-format package) |
| `unknown_type` | Attention | Unrecognized node type |

### #14 Signer identity — `signerIdentity.status`
| Status | Tier | Copy |
|---|---|---|
| `ok` | Verified | Signer identity matches the registry |
| `signer_identity_mismatch` | **Alarm** | Signer identity does not match the registry |
| `no_signer` | Normal | No stated signer (earlier-format package) |
| `no_registry_identity` | Normal | Registry has no identity for this key |

### #15 captureMethod vocabulary — `captureMethodVocab.status`
| Status | Tier | Copy |
|---|---|---|
| `ok` | Verified | Capture method recognized for this profile |
| `captureMethod_unknown` | Attention | Capture method not recognized for this profile |
| `producerProfile_bundle_unresolved` | Normal | Producer profile not resolved |
| `no_capture_method` | Normal | No capture method (earlier-format package) |

### notebookProvenance — `metadata.extensions["org.civicaitools.notebook"].provenance`
| Value | Tier | Copy |
|---|---|---|
| `executed` | Normal | Executed in a signed sandbox |
| `skeleton` | Normal | Skeleton notebook (not executed) |

Both readings are honest and calm (per [open-questions Q31](https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/open-questions.md)). `executed` is the only value emitted today; `skeleton` is reserved (no code path writes it yet).

---

## 5. Resolved judgment calls

Each `⚖` from the issue brief, resolved with rationale. The guiding distinction: **Alarm** is reserved for a *positive assertion of badness* (content altered, signature forged, registry says "do not trust"); **Attention** is for the *absence of a confirmation* (an unrecognized identifier, an unreachable check); **Normal** is for an *expected back-compat state*.

1. **`captureMethod_unknown` → Attention** *(the sharpest call).* Spec §9.2 #15 says this "rejects the node." But the tier governs how the **signal reads**, not whether the node passes conformance — and #110 changes no verification behavior. The captureMethod label is **signature-covered**, so an unrecognized value is not an *alteration* (an alteration trips #1/#4 → Alarm); it is an unrecognized identifier, structurally identical to `unknown_canonicalization_rule` (#3) and `unknown_type` (#12), both Attention. Amber correctly says "look closer" without crying Alarm over a vocabulary this verifier simply does not recognize.

2. **`rekorVerified: false` → Attention** (not Alarm). The verify route collapses "Rekor unreachable" and "Rekor entry contradicts the package" into one boolean. The common cause is a transient outage, and Rekor is a *supplementary* transparency log, not the package's content. Amber, not red. *(If the route is later refined to distinguish an entry that contradicts the package, that case should escalate to Alarm.)*

3. **`keyTrust.deprecated_valid` → Normal.** `verified: true` — the signature is valid under preventive rotation (signed before the key was deprecated). It is not a fresh active-key Verified, but it is not a concern; Normal carries the rotation context calmly (**P7** — don't hide the deprecation behind a green check).

4. **`keyTrust.unknown_key` → Attention** (not Alarm). An unknown key is the *absence* of a trust assertion, not a positive distrust. Contrast `revoked` / `deprecated_invalid`, where the registry *positively asserts* the key should not be trusted → Alarm. Absence-of-trust = Attention; positive-distrust = Alarm.

5. **`contentHash_no_supported_algorithm` → Attention.** The fingerprint lists only algorithms this verifier cannot compute, so it cannot be confirmed (paralleling `unresolved_rule`). Unconfirmed, not altered.

6. **`signerIdentity.no_registry_identity` → Normal.** A legacy registry entry predating identity binding; the cross-check is skipped. A back-compat degradation, like `no_signer`.

7. **`captureMethodVocab.no_capture_method` → Normal.** Pre-ADR-0003 packages carry no captureMethod. Neutral, like an absent timestamp.

8. **Lifecycle per-attestation falses — split, not uniform.** `signatureValid: false` and `nodeIdMatches: false` are integrity of the *event itself* → a forged or altered transition → **Alarm**. But `signerMatchesTarget: false` is **Normal** — see deviation (b) below.

9. **Lifecycle surfaced in the verify panel?** Open for #111 (see §4 #10). Tiered here for completeness.

10. **`keyTrust.legacy_embedded` is key-trust-only (P7) — it must not assert signature validity.** This line speaks solely to the registry dimension: an embedded signing key that is not listed in the trust registry, so the registry cannot vouch for it. It must **not** claim the signature verified — that is check #2's axis. `legacyEmbeddedKeyTrust()` returns its verdict *without re-verifying*, so the earlier copy ("its signature verified against its embedded key") created a live contradiction on a real package: the withdrawn `da9246`, whose plain-Ed25519 signature read as a #2 failure — a since-fixed Ed25519/Ed25519ph false negative in `verifySignature` (PR #118) — while #5 calmly asserted the signature had verified. Decoupling the copy keeps the two axes orthogonal and prevents the contradiction recurring on any future no-kid package whose signature genuinely fails. Shipped strings (`trust-signal.ts`, e032a01): label *"Signed with an embedded key (not in the trust registry)"*; detail *"The signature uses an embedded public key that is not listed in our published trust registry, so the registry cannot vouch for it."* (The label also drops "Signed before the trust registry existed", which misread as a temporal claim — `legacy_embedded` means "embedded key, no registry kid", which includes recent packages signed before kid storage, not only genuinely-old ones.)

### Deviations from the issue brief (flagged)

Three places where I diverged from the brief's leans, each with rationale:

- **(a) `--nyc-warning` aliased to `--nyc-caution`, not added as a fresh amber.** The brief said *"NO amber token exists — ADD `--nyc-warning`."* In fact `globals.css` already ships `--nyc-caution: #FFB320` in the NYC palette. Rather than introduce a second amber hex, I added `--nyc-warning: var(--nyc-caution);` — a semantically-named token (what the brief wanted) sourced from the existing design-system amber, so the Attention tier stays in lockstep with the palette.

- **(b) `signerMatchesTarget: false` → Normal, not Alarm.** The brief grouped this with the integrity falses (Alarm, marked `⚖`). But a non-signer-matched attestation is a **legitimately-surfaced third-party event**: per spec §8.10.3 (retention asymmetry) it is shown but does **not** move the publisher's status, and the existing `verify.ts` test (`resolveLifecycleFromChain: non-signer-matched withdraws does NOT move status`) confirms this is designed behavior, not tampering. Tiering it Alarm would cry foul over a feature. → Normal.

- **(c) Icons are stroke-outline, not the suggested `fill="currentColor"` filled glyphs.** The brief suggested filled glyphs "per house convention (the download icon)." A *filled* set with the inner `i` / `!` marks that make tiers distinguishable **without relying on color** (an accessibility requirement) needs even-odd knock-out paths. Four **stroked silhouettes** — check / circle / triangle / octagon — are hand-authored, coherent, crisp at 16px, and give four distinct shapes. The accessibility win (shape + color + aria, never color alone) outweighs matching the one existing filled glyph.

### Checks not tiered at runtime

Spec checks **#6** (`metadata.signingKeyId` consistency) and **#13** (`nodeId` cross-check) are **not** emitted as discrete status fields by today's verify route (it returns `nodeId` only as a recomputed hash string). Their tiers are **reserved here** — a mismatch on either → **Alarm** — but they have no runtime entry in `trust-signal.ts`, and the coverage test asserts only the codes the route actually emits. When #6/#13 gain discrete statuses, add their maps and tests.

---

## 6. The icon set

Four in-house, `aria-labeled`, inline-SVG glyphs — one per tier. No icon dependency, **no DTPR assets** (the memo's guardrail). Severity is conveyed three independent ways so it never depends on color alone:

| Tier | Glyph (silhouette) | `aria-label` |
|---|---|---|
| Verified | checkmark | "Verified" |
| Normal | circle + `i` (info) | "Informational" |
| Attention | triangle + `!` (warning) | "Attention" |
| Alarm | octagon + `!` (error) | "Alarm" |

The four outer shapes (check / circle / triangle / octagon) are distinct without color, supporting colorblind and screen-reader users. The shapes follow convergent severity-icon prior art (the design principles say *novelty is not a goal* — follow convention). They live in `TrustSignal.tsx`; the tier → glyph/color/aria mapping is `TIER_META` in `trust-signal.ts`.

---

## 7. Implementation map

| Artifact | Path | Role |
|---|---|---|
| This note | `docs/trust-signal-vocabulary.md` | The taxonomy + resolved judgment calls (source of truth). |
| Vocabulary library | `src/lib/evidence/trust-signal.ts` | `TrustTier`, `TIER_META`, the per-check `*_SIGNALS` maps, resolver helpers (`resolveSignature`, `resolveRekor`, …), `CAPTURE_METHOD_LABELS`, `NOTEBOOK_PROVENANCE_SIGNALS`. Pure data — type-only upstream imports, so client-safe. |
| Coverage test | `src/lib/evidence/trust-signal.test.ts` | Proves total coverage of the emitted status codes, the load-bearing splits, and the synthetic-legacy all-calm guarantee. |
| Component | `src/components/evidence/TrustSignal.tsx` | Presentational `<TrustSignal tier label detail? icon? />`; the four glyphs; consumes `TIER_META`. |
| Amber token | `src/app/globals.css` | `--warning` (→ `--caution`). |

**How total coverage holds by construction.** Each verify-library status union was refactored (behavior-preservingly) into a source-of-truth const-array, e.g. `KEY_TRUST_STATUSES` with `type KeyTrustStatus = typeof KEY_TRUST_STATUSES[number]`. The signal maps are typed `Record<KeyTrustStatus, …>`, so a status added upstream fails the compile until it is tiered here; the coverage test iterates the same arrays at runtime as a belt-and-suspenders and to assert the load-bearing tier *values*. The array and the map cannot drift.

**Downstream (#111).** The verify route already returns checks #3 / #4 / #10 / #12 / #14 / #15 / blobRefs, but the local `VerifyResult` interface in `EvidenceActions.tsx` declares only five of them. #111 widens that consumer type, swaps the `✅/❌/➖` `VerifyCheck` for `<TrustSignal>`, and decides what (lifecycle, captureMethod label) renders where.
