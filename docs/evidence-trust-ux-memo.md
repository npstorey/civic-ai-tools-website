<!-- v1 — 2026-05-29 — Evidence trust UX memo. Bounded DTPR evaluation (both dimensions) + a sequenced UI/UX plan for the evidence trust-communication surfaces. Direction approved; net-new issues A–F (§4) to be filed under the "Evidence trust UX" milestone, which also holds the folded #88–93 / #96 / #86. Companion: docs/evidence-detail-ux-memo.md. -->

# Evidence trust UX — design memo

**Scope:** A coherent UI/UX pass over the evidence "trust-communication" surfaces — the verify panel, the sandbox / executed-notebook publish flow, and chat ↔ evidence-page render consistency — preceded by a bounded evaluation of DTPR as a possible design language.
**Status:** Direction approved. Net-new issues A–F (§4) to be filed under the **Evidence trust UX** milestone; the existing ProvenanceChain cluster (#88–93) plus #96 and #86 are folded into the same milestone.
**Constraint docs:** [`design-principles.md`](./design-principles.md) (cited by principle number, not re-derived); [`trust-and-evidence.md`](https://github.com/npstorey/civic-ai-tools/blob/main/docs/trust-and-evidence.md); the Typed Standards Specification §8.6 / §8.10 / §9; [`evidence-detail-ux-memo.md`](./evidence-detail-ux-memo.md) (the companion memo that already specced surface #3).
**Audience:** Civic technologists, government data workers, journalists, students, maintainers — and future planning / implementation chats.

---

## 0. Why this memo

The reference implementation now matches the consolidated Typed Standards Specification: the full envelope-field cohort is wired through the packager, verify library, bundle, and detail page. With the data layer settled, two gaps remain on the UI side: (1) a cluster of trust-communication surfaces needs a *coherent* pass rather than piecemeal patches, and (2) the verify API now runs many more checks than the detail-page panel surfaces. Before planning the surfaces, we evaluated **DTPR (Digital Trust for Places & Routines)** — it could have defined the design language. It does, but only on one of two dimensions.

## 1. DTPR fit assessment

**What DTPR is (verified against the current standard, 2026-05).** DTPR — stewarded by Helpful Places, originated at Sidewalk Labs, CC BY 4.0 (icons partly derived from Material Icons, Apache 2.0) — is a transparency standard for **data collection in the built environment**. Three components: (1) a **taxonomy** of 8 categories — *Accountable* (2 values), *Purpose* (23), *Technology* (51 sensor/device types), *Data Type* (7), *Processing* (23), *Access* (9), *Retention* (2), *Storage* (7); (2) a schema-pinned **icon visual language** (the "DTPR for AI" release composes 36×36 SVGs via a shape × symbol × variant pipeline, served by a REST API + an MCP server); (3) the **Data Chain**, a "nutrition label" hierarchical model stringing taxonomy elements into a legible *who's-accountable → why → what tech → what data → how processed → who can access → how long → where* story, encountered by the public via signage → QR → detail page.

The conceptual parallel is real (both DTPR and this project make a complex provenance/transparency story legible to civic non-experts), but the two evaluation dimensions split sharply.

### 1(a). UI / design-language — adopt the method, not the assets

DTPR is a strong design-language reference, and most of what it offers **corroborates and operationalizes `design-principles.md`** rather than introducing anything foreign — exactly what you want from an external standard (it is conservative, field-tested, and civic-audience-validated; "novelty is not a goal" stays intact).

Four patterns transfer:

| DTPR pattern | Maps onto | Application here |
|---|---|---|
| Nutrition-label / Data Chain (glanceable row → consistent detail) | Principle 5 (glance → narrative → click) + Principle 8 (collapse / expose) | Corroborates the ProvenanceChain redesign; extends the same shape to the **verify panel**. |
| Controlled, schema-pinned icon vocabulary + composition rules | Principle 3 (no false precision) + accessibility | Replace `EvidenceActions`' ad-hoc emoji (`✅ / ❌ / ➖`) with a small, consistent, `aria`-labeled SVG trust-signal set defined once. |
| Plain-language pairing (icon + standardized short description) | Principle 5 (narrative bridge) + Principle 9 (user language) | The fix for intimidating status codes (`content_hash_mismatch`, `producerProfile_bundle_unresolved`, `signer_identity_mismatch`). |
| Calm, neutral, informative disclosure stance (legibility, not fear) | Principle 1 (disclosure ≠ validation) | The design-language answer to the load-bearing requirement that legacy packages' many non-`ok`-but-normal statuses read **calm**, not as failures. |

**Do not adopt:** the taxonomy vocabulary (sensor / place domain), the icon glyphs (cameras, microphones), the physical-signage model, and — a guardrail — DTPR's **"Accountable entity"** framing. DTPR's "accountable" implies an operator vouching for a deployment; on an evidence page that risks reading as platform endorsement of analysis correctness, a direct Principle 1 violation. We keep the project's signer / identity-binding / disclosure-not-validation framing.

**Call:** adopt three DTPR *disciplines* — (1) a controlled trust-signal icon + label vocabulary, (2) plain-language pairing for every status, (3) the calm-disclosure stance. Build our own glyphs; pull no DTPR assets or vocabulary. This is the design direction carried into §3.

### 1(b). Taxonomy / ontology — do not adopt now; register as a deferred adapter candidate

DTPR's taxonomy describes **physical-world data *collection*** (this camera collects identifiable video, processed by an AI system, stored locally, retained 30 days). The ontology-assembly arc (open-questions Q41–Q44; the ontology bill-of-materials + ROBOT assembly, `civic-ai-tools#84`) concerns the **analytical-production-process + claim/evidence** layer, anchored on PROV-O (in use), EARL, P-Plan, DCAT, SKOS plus the bespoke Typed Standards claim shapes (§8.11) and QEC sub-ontology (§7.5).

Facet by facet, DTPR covers nothing the named anchors don't cover better:

- **Accountable / Purpose / Technology** → a sensor operator + device. The project's data-provenance layer → a dataset / portal source + AI agent (PROV-O agents). Thin adjacency, zero shared terms, different referents.
- **Processing** (Aggregated, AI System, Differential privacy, K-Anonymity…) → privacy-protection methods on *collected* data. The project's method layer (Q42 EARL / P-Plan method-soundness, §8.11 derivation) → *analytical* method fitness. No clean SKOS map.
- **Access / Retention / Storage** → flat static disclosure labels. The project's §8.10 `locatedAt` / lifecycle / retention-asymmetry → *signed attestation nodes*, a richer model; a SKOS map would be lossy and backwards.

**Call:** do **not** add DTPR to the BOM as core or as a committed institutional-adapter vocabulary. It is a *different layer* (built-environment data-collection disclosure), not a claim/evidence vocabulary. The one genuine adopter pathway — a city already running DTPR signage that wants to connect *"the sensor that collected this data"* to *"the analysis built on it"* via a SKOS bridge from DTPR `Accountable` / `Purpose` / `Technology` into the data-source provenance layer — is real but **not a present need**. It is registered as a flagged, deferred adapter candidate in **open-questions Q45** (cross-linked from Q41, noted on #84), gated on such an adopter. Adopting it now would be the "spec growth without an adopter" the [Xanadu doctrine](https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/xanadu-doctrine.md) prevents.

**On the Xanadu gate:** evaluating DTPR is well-grounded (real standard; Helpful Places is an adopter-vector) — that gate is satisfied and this assessment is the output. But "adopter-vector for *evaluation*" ≠ "adopter need for *spec growth*": dimension (a) needs no spec change (gate trivially met), while dimension (b) would grow the spec with no present adopter (gate unmet → defer).

## 2. Disposition

- **Dimension (a)** is not an open question — it is resolved into the design spine of this pass (§3).
- **Dimension (b)** is open-questions **Q45** (Open / Deferred, Xanadu-gated), cross-linked to Q41 (parent) and #84 (BOM). It is deliberately **not** a GitHub issue — with no adopter, the registry's promotion criteria are unmet.

## 3. Design direction — the trust-signal spine

One idea threads all three surfaces: a shared **trust-signal vocabulary** in which every verification / provenance status renders as `{ severity-tier, controlled icon, plain-language one-liner }`, defined once and reused. This is the keystone that makes the pass coherent rather than piecemeal; surfaces #1 and #3 both consume it, and it operationalizes the load-bearing requirement that **legacy (pre-v0.1) packages read calm**.

The critical primitive is a **severity taxonomy** mapping every verify-library status code into a tier so that "not `ok`" does not mean "broken":

| Tier | Reads as | Example status codes (verify library / spec §9.2) |
|---|---|---|
| **Verified** | green / affirmative | `hashMatch:true`, `signatureValid:true`, keyTrust `active`, type `ok`, signer `ok`, captureMethod-vocab `ok` |
| **Normal / informational** (calm, *not* a warning) | neutral plain-language explainer | `implicit` type, `no_signer` skip, `legacy_relabeled`, `legacy_embedded`, `producerProfile_bundle_unresolved`, absent timestamp / Rekor on pre-v0.1, lifecycle `legacy-columns`, `notebookProvenance: skeleton` |
| **Attention** | amber, explains what's unconfirmed | `unknown_canonicalization_rule`, `unknown_type`, `registry_unavailable` |
| **Alarm** | red, genuine integrity failure | `hashMatch:false`, `signatureValid:false`, `content_hash_mismatch`, `signer_identity_mismatch`, keyTrust `revoked` / `deprecated_invalid` |

The hardest line is in content-hash verification: `legacy_relabeled` is **Normal** (it applies to every pre-v0.1 package) while `content_hash_mismatch` is **Alarm** — the same check, opposite tiers. Getting that split right is the core of the calm requirement.

## 4. Milestone + net-new issues (A–F)

**Milestone: "Evidence trust UX."** Groups the net-new issues below and the already-filed ProvenanceChain cluster + publish-completion issue (§5). The issues below have no existing GitHub issue; the drafts are filing-ready.

### A — Trust-signal vocabulary + calm-status taxonomy *(foundation)*
- **Dependency:** none — ships first. Keystone for B / C / D and feeds #92.
- **Scope:** a short design note defining the §3 severity table for *every* verify-library status code plus `notebookProvenance`; a small, accessible, `aria`-labeled SVG trust-signal icon set (in-house, DTPR-discipline-informed — not DTPR glyphs); a shared `<TrustSignal tier icon label detail/>` component. No verification-behavior change.
- **Acceptance:** design note merged; `<TrustSignal>` plus the status → tier / icon / copy map, unit-tested for total coverage of the §9.2 status codes.
- **Refs:** `design-principles.md` P1 / P3 / P5 / P9; spec §9.2. Coordinates with #92.

### B — Verify panel: calm baseline + captureMethod adjacency *(verify panel, part 1)*
- **Dependency:** A.
- **Scope:** re-skin the existing `EvidenceActions` checks (`hashMatch`, `signatureValid`, `keyTrust`, `hasTimestamp`, `rekorVerified`) onto `<TrustSignal>`; render `keyTrust: legacy_embedded` and an absent timestamp / Rekor on pre-v0.1 packages as **Normal**, not failure. **Move the `captureMethod` label adjacent to the signature verdict** (spec §8.6 / §9.2 check 11: "signed ≠ verbatim"), out of the page-level "Captured via" row.
- **Acceptance:** a pre-v0.1 package shows zero red / amber on the default view; captureMethod renders inside the verify panel beside the signature verdict.
- **Refs:** `EvidenceActions.tsx`; spec §8.6, §9.2 #11; `civic-ai-tools#63` (threat model by capture method).

### C — Verify panel: surface typed-standards envelope checks *(verify panel, part 2)*
- **Dependency:** A, B.
- **Scope:** render verify-library checks #12 `typeResolution`, #14 `signerIdentity`, #15 `captureMethodVocab` via `<TrustSignal>`. `implicit` type and `producerProfile_bundle_unresolved` → **Normal** (calm copy); `signer_identity_mismatch` → **Alarm**; `unknown_type` → **Attention**. Surface `notebookProvenance` (skeleton / executed) as an honest Normal-tier label here (per open-questions Q31); coordinates with E.
- **Acceptance:** all three checks visible and tier-correct; legacy packages stay calm; an identity mismatch is unmistakable; skeleton vs. executed is labeled honestly.
- **Refs:** `verify.ts` (`resolvePackageType`, `checkSignerIdentity`, `checkCaptureMethodVocab`); spec §9.2 #12 / #14 / #15; Q31.

### D — Verify panel: surface content-integrity checks *(verify panel, part 3)*
- **Dependency:** A, B. Parallel with C.
- **Scope:** render verify-library checks #3 `contentCanonicalization` and #4 `contentHash` via `<TrustSignal>` with the load-bearing split: `legacy_relabeled` / `implicit` → **Normal**; `unknown_canonicalization_rule` / `unresolved_rule` → **Attention**; `content_hash_mismatch` → **Alarm**. Fold in blob-reference integrity (check #9).
- **Acceptance:** `legacy_relabeled` reads calm; a synthetic `content_hash_mismatch` fixture reads as an unambiguous alarm; canonicalization + blob-ref status legible to a non-expert.
- **Refs:** `verify.ts` (`resolveContentCanonicalization`, `verifyContentHash`, `verifyPackageBlobRefs`); spec §9.2 #3 / #4 / #9.

### E — Publish from an executed-notebook (signed-sandbox) session *(publish flow)*
- **Dependency:** confirm at implementation time that the packager / `POST /api/evidence` already accept executed packages (the executed-notebook architecture plan's publish-time trigger was dropped, so this UI is genuinely unbuilt).
- **The gap (sharper than "missing button"):** `QueryForm.tsx` exposes an **"Execute in a signed sandbox"** toggle; the backend (`/api/query-notebook`, Vercel Sandbox), the chat renderer (`ChatNotebookOutput`), and `notebookProvenance: 'executed'` stamping all exist — but `PublishEvidenceDialog.tsx` **hardcodes `captureMethod: 'chat-flow-stream'` and regenerates a *skeleton* notebook** via `generateNotebook(...)`, discarding the executed artifact, its `org.civicaitools.execution` extension, the `sandboxId` / `executedAt`, and the `executed` discriminator. Publishing an executed session therefore silently downgrades it to a skeleton chat-flow package — a trust-communication bug.
- **Scope:** (1) carry the executed notebook + execution extension + `notebookProvenance: 'executed'` + the correct captureMethod through `PublishEvidenceDialog` when the session was sandbox-executed; (2) add a publish affordance on the executed-notebook view (`ChatNotebookOutput` is currently view-only). Honest labeling per Q31.
- **Acceptance:** publishing a sandbox-executed session yields a package whose captureMethod / `notebookProvenance` reflect execution; the verify panel (C) shows "executed"; no skeleton downgrade.
- **Refs:** `PublishEvidenceDialog.tsx`, `QueryForm.tsx`, `buildChatEvidenceView.ts`, `/api/query-notebook`; ADR-0005, Q31. Pairs with #86.

### F — Shared analysis-body renderer for chat ↔ evidence detail *(render consistency)*
- **Dependency:** #96 (removes the output truncation + adds multi-turn verbatim); pairs with #89.
- **The divergence (verified):** chat renders via `RenderingCellOutputs` (MIME dispatch) + `ReactMarkdown`; the legacy detail page renders its answer section via `ReactMarkdown(pkg.output)`, and `ProvenanceChain` truncates output to 2000 characters.
- **Scope:** extract one shared renderer (markdown + notebook cell outputs) used by *both* the chat stream view and the evidence detail page, so the two provably cannot drift. No new rendering behavior beyond unification.
- **Acceptance:** the same analysis renders identically in chat and on its evidence page; a multi-turn / >2000-character output is not truncated on either.
- **Refs:** `RenderingCellOutputs.tsx`, `ChatNotebookOutput.tsx`, `ProvenanceChain.tsx`, the detail page's answer section. Depends on #96; coordinates with #89.

## 5. Existing issues folded into the milestone (reference, not re-specced)

All currently carry no milestone — a clean grouping.

- **Render-consistency backbone** (fully specced in [`evidence-detail-ux-memo.md`](./evidence-detail-ux-memo.md)): **#88** bridge fix → **#89** core redesign → **#90** density → **#91** fold graph + reorder → **#92** language audit (consumes **A**) → **#93** narration-at-package-time memo.
- **Publish completion UX:** **#86** (View / Share buttons) — pairs with **E**, independent of it.
- **Ontology dimension:** `civic-ai-tools#84` / open-questions Q41–44 — carries the DTPR deferred-adapter note (§2, Q45).

*(Issue numbers above are `npstorey/civic-ai-tools-website` except #84 / Q-numbers, which are `npstorey/civic-ai-tools`.)*

## 6. Sequencing & dependencies

```
Wave 0 (foundation):   A  ───────────────┐
                                          │ (feeds)
Wave 1:   B (verify calm + captureMethod) │   E (publish-from-executed)   #88 (bridge)
            │                             ▼
Wave 2:   ├─ C (type/signer/vocab) ──┐   #92 (language audit)   #89 (chain redesign)   #96 (truncation/multi-turn)
            └─ D (canon/hash/blobRef)─┘                                                        │
Wave 3:        (verify panel complete)    F (shared renderer) ◄── depends #96, pairs #89
               #90, #91 (follow #89)      #86 (completion UX, pairs E)
```

- **Critical path / start here:** **A** — small (design note + one component + a mapping table); everything trust-signal depends on it.
- **Parallelizable immediately:** **E** and **#88** (independent of A).
- Each issue is independently shippable; explicitly not a single overhaul.

## 7. Related committed artifacts

- DTPR ontology dimension → open-questions **Q45** (Open / Deferred, Xanadu-gated), cross-linked from Q41 and noted on #84.
- Companion memo for the render-consistency surface → [`evidence-detail-ux-memo.md`](./evidence-detail-ux-memo.md).
- Trust-signaling semantics that govern how verdicts must read → [`trust-and-evidence.md`](https://github.com/npstorey/civic-ai-tools/blob/main/docs/trust-and-evidence.md) and `design-principles.md`.
