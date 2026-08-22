# Use attestations as the implementation path for upstream-evidence references

**Repo:** civic-ai-tools (Open Evidence Standard spec); civic-ai-tools-website (attestation infrastructure)
**Labels:** future-work, evidence-system, attestations, infrastructure, medium-priority
**Estimated effort:** M (architectural reframe + ADR + spec restructure; may fold into 006)
**Blocks:** any cross-package corroboration or citation-graph work
**Tracks:** [Open Question #12](../../../../civic-ai-tools/docs/architecture/open-questions.md) — Attestations as the implementation path for upstream-evidence references. **May fold into [issue 006](006-typed-claims-as-attestation-reframe.md)** if the typed-claims-as-attestation work produces an ADR general enough to cover this case too.

## Problem

The Open Evidence Standard currently has a §12 reserving space for `upstream-evidence.json` — an optional companion file declaring relationships between evidence packages: `derived_from`, `compares_to`, `extends`, `replicates`, `contradicts`, `evaluates`. Cross-package citation graphs, meta-analysis, and adversarial-evaluation chains all depend on this layer.

The attestation infrastructure (Open Evidence Standard §15) already supports signed artifacts that comment on a previously-published package, including `evaluation` (an attestation that says "I evaluated this package against rubric R and got result X"). (Attestation packages recorded before signing was enforced carry no signature and are labeled unsigned; the signing path is `lib/evidence/attestation-signing.ts`.) Extending that to "I evaluate this package against the package at hash Y, with relationship R" is a small step.

The insight: **upstream-evidence references may not need a separate file format — they may be a kind of attestation.** Specifically, an attestation kind that carries a relationship vocabulary (`derived_from`, `compares_to`, `extends`, `replicates`, `contradicts`, `evaluates`) and a target-package hash. The attestation infrastructure already handles signing (via `lib/evidence/attestation-signing.ts`, with packages recorded before it labeled unsigned rather than retroactively signed), linkage by hash, lifecycle, and rendering; reusing it avoids duplicating that infrastructure for upstream-evidence.

If the reframe works, it eliminates `upstream-evidence.json` as a planned package companion file and replaces it with extending the attestation-kind enum to include relationship attestations.

## Proposed approach

Three deliverables, parallel in shape to issue 006.

1. **Assessment.** Compare the upstream-evidence relationship vocabulary against the attestation infrastructure:
   - Does each relationship kind (`derived_from`, `compares_to`, `extends`, `replicates`, `contradicts`, `evaluates`) fit cleanly as a signed-attestation-with-target-package?
   - Is the directionality the same? (Attestations point from attester to package; upstream-evidence references point from one package to another.)
   - Are there relationships that need bidirectional or multi-target shape that single-target attestations don't support?
   - Does the attestation rendering surface (the detail page) accommodate displaying the relationship structurally?

2. **ADR + spec restructure.** If the assessment confirms the reframe:
   - An ADR (or a section in the ADR from issue 006 if folded) recording the decision.
   - Open Evidence Standard §12 collapses or becomes a forward to §15 (attestations).
   - Open Evidence Standard §15 gains relationship attestation kinds. The vocabulary may be the existing six (`derived_from`, etc.) or a refined set if the assessment surfaces issues.
   - Open-questions registry Q12 moves to Resolution log.

3. **Implementation guidance.** Whether the new relationship attestation kinds get implemented now or deferred per Open Question #5 — the reframe doesn't require implementation; it just changes the planned shape.

## Relationship to issue 006

Issue 006 (`006-typed-claims-as-attestation-reframe.md`) tracks the parallel question for typed claims. Both issues share the insight that attestations are the unifying frame for "things you can say *about* a package":

- **Issue 006:** typed claims as attestations. The attestation says *this is what the analysis claims*.
- **Issue 007 (this):** upstream-evidence references as attestations. The attestation says *this package is in relationship R with package X*.

The two could share a single ADR. The decision on whether to fold is left to the drafter of 006 (or whoever picks up both):

- **If folded:** 007's content moves into 006's ADR scope; 006's title and acceptance criteria expand; this file gets a closing note pointing at 006 and stays in the directory as a record of the question; the open-questions registry Q12 entry points at 006's resolution.
- **If not folded:** 007 proceeds independently with its own ADR. The two ADRs cross-reference each other.

The folding decision should be made during the assessment phase. If the property-by-property work in 006 turns up that typed claims and upstream-evidence are structurally identical attestations, fold. If they're structurally different (e.g. typed claims need translation-method metadata that upstream-evidence references don't), keep separate.

## Scope

**In:**
- Assessment (per §Proposed approach step 1).
- ADR + spec restructure (separately or folded into 006).
- Implementation guidance.

**Out:**
- Implementing relationship attestations (downstream of Open Question #5 + the reframe).
- The typed-claims-as-attestation reframe (issue 006).
- Building cross-package citation-graph or meta-analysis surfaces (downstream of implementation).

## Acceptance criteria

- Assessment committed (as a section in the ADR, or as a working note).
- ADR drafted and Accepted (or explicitly Rejected with rationale).
- If folded: 006's ADR covers both reframes; this issue's resolution points at that ADR.
- If not folded: a standalone ADR + Open Evidence Standard §12/§15 revisions land in this issue.
- Open-questions registry Q12 moved to Resolution log.

## Dependencies

- **No hard dependency on Open Question #5** — the reframe is a spec / framing change.
- **Tight coupling with issue 006** — see above. The drafter should read 006 first.

## Risk

- **Relationship vocabulary may need refinement.** The current six (`derived_from`, `compares_to`, `extends`, `replicates`, `contradicts`, `evaluates`) were named without a structural review. The assessment may surface that some are actually the same relationship from different directions, or that some need decomposition.
- **Bidirectional / multi-target relationships.** If a relationship needs to be expressed bidirectionally (package A extends package B and package B is extended by package A), single-target attestations may not support that natively. Mitigation: most relationships are inherently directional (A `derived_from` B means A is the derivative); for symmetric relationships, two attestations can capture both directions.
- **Conflict with Open Question #1** (package format) — `upstream-evidence.json` was conceived as a multi-file companion. If Open Question #1 resolves toward multi-file, the file format conflict goes away (attestations could live alongside the package). If it stays single-blob, upstream-evidence-as-attestation is the simpler option (no second file).

## Reproducible at

- Open Evidence Standard: `civic-ai-tools/docs/architecture/open-evidence-standard.md` §12 (upstream-evidence references) and §15 (attestations).
- Open-questions registry: `civic-ai-tools/docs/architecture/open-questions.md` Q12. Cross-references Q11.
- Related issues: 006 (typed claims as attestation — possible fold).
