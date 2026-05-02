# Publish outbound Croissant metadata on every evidence page

**Repo:** civic-ai-tools-website (primary — evidence pages are served here)
**Labels:** future-work, croissant, discoverability, network-effect, infrastructure, medium-priority
**Estimated effort:** M (design + reference implementation + crawler-discovery validation)
**Blocks:** evidence-package discoverability through external dataset crawlers; soft-de-facto-standard adoption by other publishers (Boston, datHere, third parties)

## Problem

Croissant (MLCommons, currently v1.1) plays one role in the project's architecture today: characterizing **inbound** datasets — the package's `data-sources.json` references or embeds Croissant 1.1 metadata for whatever was queried (M2 PROV-O Croissant 1.1 hooks shipped per `ROADMAP.md` Day 2 / 2026-04-13). This makes the package's data-source provenance machine-readable.

A second role is now under consideration: **outbound** metadata, where every published evidence page carries a Croissant metadata file at a well-known location, making the package itself discoverable through dataset crawlers (Hugging Face, Kaggle, CKAN, Schema.org-aware search engines). See `civic-ai-tools/docs/architecture/end-state-vision.md` §1 L3 ("Note on Croissant's dual role in L3") and §Open questions item #8 — Croissant outbound metadata.

ROADMAP.md §5 Later already names Croissant as a potential **emitter-side extension** (per `civic-ai-tools/docs/research/landscape-analysis.md` §7). This issue makes that line of work concrete.

The two roles are independent. Adopting outbound Croissant requires no change to the inbound use, and works whether the package format stays single-blob (today) or moves to multi-file (post-resolution of `civic-ai-tools/docs/architecture/end-state-vision.md` §Open questions item #1 — package format).

The strategic case: discoverability through existing dataset crawlers without building any custom indexing infrastructure. A soft de-facto standard for "published as evidence" that adjacent projects (Boston OpenContext, datHere, anyone publishing their own evidence packages) can adopt to become discoverable in the same surfaces. A real network effect — the metadata pattern propagates without centralized coordination. Strategically, this positions evidence packages as first-class members of the open-data ecosystem rather than a parallel publishing format.

The "soft de-facto standard" framing here overlaps with the broader question of external-publisher adoption posture (see `civic-ai-tools/docs/evidence-protocol-fork.md` Path B and `civic-ai-tools/docs/architecture/end-state-vision.md` §Open questions item #7 — producer-type scope). This issue does not resolve that question; it makes one concrete contribution that's compatible with whichever way the broader question lands.

## Proposed approach

A design document plus reference implementation, in three deliverables:

1. **Schema mapping.** A document at `civic-ai-tools-website/docs/api/croissant-outbound.md` covering the field mapping from evidence-package metadata to Croissant. Outbound use leans on Croissant's general Schema.org-inherited fields rather than the dataset-specific structural fields:
   - `name`, `description`, `citation`, `license`, `creator`, `dateCreated`, `distribution`, `sameAs`, `keywords`, `url`
   - The published evidence page URL is the canonical `url`.
   - The package SHA-256 is included in `sameAs` (or a similar identity field) as a content-addressable identifier.
   - Skill-guidance hash and signing-key id (`kid`) are included as `keywords` or as Schema.org-style additional properties — to be decided in the design doc.
   - **Honesty about the dataset-shape mismatch.** Croissant 1.1's data model assumes the entity is a dataset (with `recordSet`, `distribution`, column-level schemas). An evidence package isn't quite that shape. Document this as an explicit "shape gap" section: which Croissant fields are populated meaningfully, which are populated minimally (or omitted), and why. This honesty is itself part of the standard the project would want other publishers to adopt.

2. **Well-known location.** Decide and document the URL pattern. Candidates:
   - `<package-url>/croissant.json` — clean, content-adjacent. Requires routing on the website.
   - `<package-url>.croissant.json` — sibling-file pattern, may be friendlier to dumb crawlers.
   - `<package-url>` itself with a `<link rel="alternate" type="application/ld+json+croissant">` or a `<script type="application/ld+json">` block embedding Croissant inline, and a separate `.json` URL for the same payload — covers both crawler styles.
   The well-known-location decision is **loosely** dependent on `civic-ai-tools/docs/architecture/end-state-vision.md` §Open questions item #1 — package format: if the package becomes multi-file, the location may live alongside other package artifacts; if it stays single-blob, the location is purely a website concern. Scoping can proceed today against the current single-blob format with a documented migration path.

3. **Crawler-discovery validation.** Test that real dataset crawlers index pages via the published metadata. At minimum:
   - Submit one published package to Hugging Face's dataset index using the Croissant metadata.
   - Verify that Schema.org-aware search engines (Google Dataset Search) pick up the metadata on the public page.
   - If feasible, test Kaggle and CKAN-aware crawlers.
   - Document what worked, what didn't, and what the next-step refinements are.

4. **Adoption guidance for other publishers.** A short section in the design doc covering how Boston OpenContext, datHere, or other publishers of evidence-style packages could adopt the same outbound-metadata pattern to become discoverable in the same surfaces. This is what gives the work network-effect leverage rather than just civicaitools.org-specific gain.

## Scope

**In:**
- Design document at `civic-ai-tools-website/docs/api/croissant-outbound.md` covering the field-mapping, well-known-location decision, dataset-shape-mismatch honesty section, and adoption guidance for external publishers.
- Reference implementation that emits Croissant outbound metadata for every published package.
- Crawler-discovery validation against at minimum Hugging Face and Google Dataset Search.
- Documentation updates linking the new metadata surface from `civic-ai-tools-website/docs/api/evidence-publish.md` and the README.

**Out:**
- Changing the **inbound** use of Croissant (data-sources.json characterization). That's already partially built, governed by the M2 PROV-O work, and unaffected by this issue.
- Building a custom indexer or search surface on civicaitools.org. The whole point of this work is to use existing crawler infrastructure rather than build new infrastructure.
- Migrating to a multi-file package format. That depends on `civic-ai-tools/docs/architecture/end-state-vision.md` §Open questions item #1 — package format and is a separate decision.
- Schema.org `Claim` / `ClaimReview` integration. That intersects with the typed-claims layer (the Civic Claim Vocabulary) and is governed by `civic-ai-tools/docs/architecture/civic-claim-vocabulary-draft-spec.md` §9 Open Question 5; it does not belong in this issue.

## Acceptance criteria

- Design document committed at `civic-ai-tools-website/docs/api/croissant-outbound.md`.
- Reference implementation deployed for at least one published evidence page.
- The package's outbound Croissant metadata validates against the Croissant 1.1 schema (using MLCommons' validator).
- Confirmation that at least one external dataset crawler (Hugging Face Dataset Search OR Google Dataset Search) indexes the page via the Croissant metadata. If both fail despite valid metadata, the design doc documents what the crawler-side gap was and what the next experiment is.
- Adoption guidance for external publishers is included in the design doc (≤2 pages, with a worked example).
- README and `evidence-publish.md` reference the outbound-Croissant surface.

## Dependencies

- `civic-ai-tools/docs/architecture/end-state-vision.md` §Open questions item #1 — package format resolved enough to determine the well-known URL pattern. Loose dependency: scoping can proceed today; the well-known-location decision can be revisited if the package format moves to multi-file.
- The existing inbound-Croissant work (M2 PROV-O Croissant 1.1 hooks) is preserved and not changed by this issue.
- No external service contracts change. Signing, RFC-3161, Rekor, trust-registry paths are unaffected.

## Risk

- **Dataset-shape mismatch.** Croissant 1.1 assumes the entity is a dataset; evidence packages are closer to `schema:CreativeWork` or `schema:SoftwareApplication`-output. Mitigation: lean on Schema.org-inherited fields, document the gap honestly in the design doc, and propose the gap as a Croissant-side issue if and when MLCommons takes input on the next version.
- **Crawler indexing turns out to be non-deterministic or slow.** Hugging Face and Google Dataset Search may take days to weeks to index, or may require specific submission flows. Mitigation: include crawler-discovery validation in the acceptance criteria but allow for "documented next experiment" as an alternative if first-pass indexing fails — the design doc captures the loop.
- **Outbound Croissant becomes a publisher's burden.** If every external publisher must hand-craft Croissant metadata, adoption stalls. Mitigation: emit metadata mechanically from the existing package fields. Adoption guidance points at the reference implementation as a template, not at hand-crafted metadata.

## Reproducible at

- Inbound Croissant precedent: M2 PROV-O work shipped per `ROADMAP.md` Day 2 / 2026-04-13 (`civic-ai-tools-website` packager + PROV-O builder).
- Existing evidence-package extension architecture: `civic-ai-tools-website#54` (reverse-DNS keys `org.civicaitools.*`).
- Croissant context in landscape: `civic-ai-tools/docs/research/landscape-analysis.md` §7 (Croissant two-sided framing) and §0 component 1 (discoverability of data to AI systems).
- Strategic context: `civic-ai-tools/docs/research-agenda.md` Question 9 (discoverability across accumulated evidence).
- Public-facing API doc to update: `civic-ai-tools-website/docs/api/evidence-publish.md`.
