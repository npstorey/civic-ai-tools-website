# Explore and define Civic Claim Vocabulary domain extensions portfolio

**Repo:** civic-ai-tools (where Civic Claim Vocabulary source-of-truth docs live; the portfolio doc lands in `docs/architecture/`)
**Labels:** future-work, civic-claim-vocabulary, extensions, design, infrastructure, low-priority
**Estimated effort:** S (design/scoping document; not implementation)
**Blocks:** any specific Civic Claim Vocabulary domain-extension implementation; any cross-package corpus operation that relies on typed domain claims

## Problem

The Civic Claim Vocabulary is the project-specific controlled vocabulary of typed claim shapes for evidence packages. The architectural design — captured in the v0.1 draft spec at `civic-ai-tools/docs/architecture/civic-claim-vocabulary-draft-spec.md` and shown as a node in `civic-ai-tools/docs/architecture/end-state-vision.md` §5 (claims vocabulary family) — is that the core stays small and stable, and **domain extensions** (per use case) are governed separately and can evolve at their own pace. A claim conforms to the Civic Claim Vocabulary + zero or more domain extensions. The spec's §6 sketches an extension mechanism (subclassing `ccv:Claim`, declaring a namespace, publishing SHACL shapes, optional inclusion in a registry at `civicaitools.org/vocabulary-registry`) but **no domain extensions exist today** — the entire extension layer is speculative.

Several public standards are candidates for the first extensions, but the project has not articulated:

1. The criteria a candidate must meet before promotion from "research" to "designed."
2. The relative priority and rationale across candidates.
3. The relationship between domain extensions and cross-cutting controlled vocabularies (notably the ISO 37120 / 37122 / 37123 / 30182 Smart Cities portfolio, which is paywalled but whose indicator names are public).
4. The governance model — how extensions are proposed, reviewed, versioned, retired.

Without this scaffolding, the first time a real package needs a typed domain claim, the project has no surface against which to make a defensible call about which standard to align with, what the extension should look like, or who else should see the proposal before it lands.

## Proposed approach

A short design document at `civic-ai-tools/docs/architecture/civic-claim-vocabulary-extensions-portfolio.md` covering four sections:

1. **Promotion criteria.** What a candidate must satisfy to move from "candidate" to "designed":
   - A real evidence package needs it (Xanadu test).
   - The reference standard is mature (≥1 stable major version, broad adoption, public schema).
   - Cross-city or cross-publisher comparability is a concrete benefit, not a hypothetical.
   - At least one external collaborator or stakeholder has expressed interest (or filed a `guidance-quality` issue surfacing the need).

2. **Ranked candidate list with rationale.** Initial set, drawn from the most-queried civic data types and the most-referenced public standards:
   - **Open311** — open standard for service-request data, widely adopted across US and international cities. Free, well-documented, immediate cross-city comparability. Aligns with the most-queried civic data type. Strongest candidate for the first domain extension.
   - **GFOA standards / Open Fiscal Data Package (OFDP)** — structured fiscal data standards. Useful because budget claims are the highest-stakes civic claim type and structured comparability is most needed there.
   - **GTFS / GTFS-Realtime** — global transit standard. Easy adoption, immediate cross-city comparability.
   - **OpenAQ** — global air-quality data aggregator with stable schema.
   - **HUD / NYC PLUTO / Boston parcel data** — housing and land-use, but no single dominant cross-city standard. Defer until a canonical alignment target emerges.
   - **HL7 FHIR** — clinical data standard; environmental and population health are messier. Probably defer.

3. **Cross-cutting vocabularies (ISO 37120 portfolio).** ISO 37120 (city services indicators), 37122 (smart city indicators), 37123 (resilient cities), and ISO/IEC 30182 (reference architecture) are paywalled (~$200/copy for ISO 37120), but the indicator names and concepts are public. **Recommended approach: treat the ISO 37120 portfolio as a cross-cutting controlled vocabulary that domain extensions reference, not as a domain extension itself.** A Civic Claim Vocabulary domain extension can reference indicator names without redistributing the protected text. This unlocks international comparability without licensing risk and without inflating the extension portfolio.

4. **Governance model.** How extensions are proposed, reviewed, versioned, and retired:
   - Proposal as a `roadmap-change` issue or a dedicated `civic-claim-vocabulary-extension` template, with the promotion criteria as required fields.
   - Lightweight review by maintainer plus any named domain stakeholders.
   - Versioning per the spec's §6.3 governance model (minor: 30-day public-comment, major: 90-day plus migration guide).
   - All extension versions remain resolvable at versioned URIs forever — explicit in the spec.
   - Inclusion in the registry at `civicaitools.org/vocabulary-registry` is informational and does not confer endorsement.
   - Retirement: deprecation path (no removal, only marking as superseded), with the new extension or core change carrying the migration burden.

The design document is the deliverable. Implementation of any specific extension happens later, one at a time, each with its own ADR + acceptance criteria.

## Scope

**In:**
- Design document at `civic-ai-tools/docs/architecture/civic-claim-vocabulary-extensions-portfolio.md`.
- Promotion criteria + ranked candidate list with rationale.
- Recommended approach for the ISO 37120 portfolio as cross-cutting controlled vocabulary.
- Governance model (proposal, review, versioning, retirement, registry).
- Public discussion threads on the top 1–2 candidate extensions (Open311, fiscal) so external collaborators can weigh in before any implementation.
- A pointer in the ROADMAP §5 Later (or successor section) to this portfolio doc as the canonical scope answer for typed-claims domain coverage.

**Out:**
- Actually implementing any domain extension. That happens later, one extension at a time, gated on the promotion criteria.
- Authoring the registry web surface at `civicaitools.org/vocabulary-registry`. The spec provides for it; a separate website-side issue tracks the build-out when the first extension is real.
- Adopting any framework that re-fragments the Civic Claim Vocabulary core (FHIR, DCAT-AP, etc.) as the project's identity. The portfolio is additive; the core stays stable.
- Resolving the underlying spec questions in the draft (`civic-ai-tools/docs/architecture/civic-claim-vocabulary-draft-spec.md` §9) — those are core-level questions and are upstream of this work.

## Acceptance criteria

- Design document committed at `civic-ai-tools/docs/architecture/civic-claim-vocabulary-extensions-portfolio.md`.
- Promotion criteria are concrete and falsifiable (a candidate either meets them or does not).
- Ranked list includes at minimum the candidates above with rationale, and explicitly names which would be the first one promoted to "designed" status when conditions are met.
- ISO 37120 portfolio approach is documented including the public-naming-vs-paywalled-text distinction.
- Governance model integrates with existing project governance (`ROADMAP.md` §8, `.github/ISSUE_TEMPLATE/roadmap-change.md`, ADR log).
- Public discussion threads opened for Open311 and one other candidate (fiscal or transit) inviting external feedback. Threads remain open until a real package needs that extension.

## Dependencies

- **Resolution of `civic-ai-tools/docs/architecture/end-state-vision.md` §Open questions item #5 — claims.jsonld implementation timing.** If `claims.jsonld` is deferred entirely, the extension portfolio is also deferred. If it ships in any form, this portfolio doc becomes the scoping surface for downstream extension work.
- **A stable v1.0 of the Civic Claim Vocabulary core.** The current `civic-ai-tools/docs/architecture/civic-claim-vocabulary-draft-spec.md` is v0.1 draft and explicitly not normative. Extensions presuppose a stable core. This document can be drafted against the v0.1 surface but should not be merged until the core has at least passed initial review.

## Risk

- **Speculative spec growth.** Domain extensions are exactly the kind of forward-design that the Xanadu test is meant to prevent. Mitigation: this issue commits to *design-only*. No extension is implemented before a real package needs it. The promotion criteria are the gating mechanism.
- **Vocabulary lock-in.** Choosing Open311 as the first extension implicitly privileges the Open311 conceptualization of service requests. Mitigation: reuse the spec's principle (Section 2.1 — "Build on existing standards, do not replace them"). Extension authors who want to use a different standard in a domain Open311 covers must explain why; the registry can list multiple extensions per domain with `owl:sameAs` cross-references (per spec §8.3).
- **Governance overhead.** A heavy proposal-review-version process discourages the first extension from being filed at all. Mitigation: keep the governance model lightweight; `roadmap-change` and an ADR are the maximum process for v1, and are themselves lightweight.

## Reproducible at

- Draft spec: `civic-ai-tools/docs/architecture/civic-claim-vocabulary-draft-spec.md` (v0.1 draft, April 2026; promoted from `civic-ai-tools-project/temp/` to a tracked location 2026-05-01).
- Existing project governance: `ROADMAP.md` §8, `civic-ai-tools/.github/ISSUE_TEMPLATE/roadmap-change.md`, `civic-ai-tools/docs/adr/`.
- Cross-package context: `civic-ai-tools/docs/research-agenda.md` Question 8 (modular research objects from evidence artifacts) and Question 9 (discoverability across accumulated evidence) both depend on typed claims existing.
- Related issue: this portfolio doc + a future first-extension implementation together resolve `civic-ai-tools/docs/architecture/end-state-vision.md` §5 (claims vocabulary family) from research to designed.
