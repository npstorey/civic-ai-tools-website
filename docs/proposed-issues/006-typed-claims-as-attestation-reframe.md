# Reframe typed claims as a kind of attestation

**Repo:** civic-ai-tools (Open Evidence Standard + Civic Claim Vocabulary spec drafts); civic-ai-tools-website (attestation infrastructure code lives here)
**Labels:** future-work, evidence-system, attestations, civic-claim-vocabulary, infrastructure, medium-priority
**Estimated effort:** M (architectural reframe + ADR + spec restructure; no implementation rewrite required for v0.1 since typed claims aren't built yet)
**Blocks:** Civic Claim Vocabulary v1.0 — the framing decision affects how `claims.jsonld` integrates with the rest of the package
**Tracks:** [Open Question #11](../../../../civic-ai-tools/docs/architecture/open-questions.md) — Typed claims as a kind of attestation. May subsume [Open Question #12](../../../../civic-ai-tools/docs/architecture/open-questions.md) (issue 007) — see "Relationship to issue 007" below.

## Problem

The Open Evidence Standard currently treats typed claims (`claims.jsonld`, the Civic Claim Vocabulary layer) and attestations (`consistency`, `evaluation`, `expert_attestation`) as architecturally separate concepts:

- **Typed claims** (Open Evidence Standard §11) are an optional companion file that asserts structured statements derived from the analysis, conforming to the Civic Claim Vocabulary. The `caco:AnalyticalDerivation` requirement (CCV draft spec §4.6) requires every typed claim to link back to the analytical step that produced it (which prompt, which model, which span of the source output).
- **Attestations** (Open Evidence Standard §15) are signed artifacts that comment on a previously-published package without modifying it. Attestation kinds in current use: `consistency` (repeat-publish runs), `evaluation` (LLM-as-judge), `expert_attestation` (named human reviewer). (Attestation packages recorded before signing was enforced carry no signature and are labeled unsigned; the signing path is `lib/evidence/attestation-signing.ts`.)

Looked at structurally, these are the same shape. A typed claim is:
- A signed assertion *about* a package's content.
- Carrying metadata about *how the assertion was made* (the translation model, the translation prompt, the source span).
- Linked to the package by hash.

An attestation is:
- A signed assertion *about* a package's correctness or replication.
- Carrying metadata about *how the assertion was made* (the reviewer identity, the rubric, the consistency-test inputs).
- Linked to the package by hash.

The framing difference is mostly historical — the typed-claims layer was conceived as part of the package; attestations were conceived as commentary on the package. Restructuring both as instances of "attestation" — signed structured assertions about evidence packages, with translation/review metadata — could collapse the two surfaces into one infrastructure.

This issue scopes that reframe.

## Proposed approach

Three deliverables:

1. **Assessment.** Walk through every property of every Civic Claim Vocabulary claim type and ask: is this property a feature of the underlying analysis (which must come from the analysis itself) or a feature of the attestation about the analysis (which the attester provides)? Examples:
   - `ccv:metric`, `ccv:value`, `ccv:scope`, `ccv:magnitude` — features of the analysis.
   - `caco:translationModel`, `caco:translationPrompt`, `caco:sourceOutputSpan` — features of the attestation (the LLM that did the translation, the prompt that asked for the translation, the source span the translation references).
   - The signed-by-the-platform-at-publish-time property — features of the attestation (when the attestation was made, by whom).
   The output is a property-by-property map showing which side of the typed-claim-as-attestation reframe each property lives on. If the map is clean, the reframe works. If it's confused, the reframe has friction.

2. **ADR + spec restructure.** If the assessment confirms the reframe, produce:
   - An ADR (`docs/adr/0005-typed-claims-as-attestation.md` or similar) recording the decision.
   - A revised Open Evidence Standard §11 that describes typed claims as a structured-assertion attestation kind, alongside `consistency`, `evaluation`, `expert_attestation` — possibly named `typed_claim` or `semantic_translation` in the attestation enum.
   - A revised §15 that includes `typed_claim` (or whatever name lands) in the canonical attestation kinds.
   - Civic Claim Vocabulary draft spec changes: `caco:AnalyticalDerivation` becomes the attestation-metadata pattern, possibly aligned with adjacent ontologies (PROV-O `prov:Activity` for the translation step, etc.).
   - Pointers from the open-questions registry Q11 entry to the Resolution log.

3. **Implementation guidance.** The reframe doesn't require the attestation infrastructure code to change today — typed claims aren't generated yet (Open Question #5). What it does require: when typed claims do get implemented (downstream of Open Question #5), the implementation should follow the attestation pattern (separate signed artifact, linked to the original package by hash) rather than embedding into the package's signed envelope. Document this in the ADR so the implementation team picks it up.

## Spec changes the work produces

- `docs/adr/000N-typed-claims-as-attestation.md` (new ADR).
- Open Evidence Standard §11 (typed claims) — restructured.
- Open Evidence Standard §15 (attestations) — gains the typed-claim attestation kind.
- Civic Claim Vocabulary draft spec §4.6 (`caco:AnalyticalDerivation`) — reframed as the attestation-metadata pattern.
- Open-questions registry Q11 — moved to Resolution log; Q12 may follow if the reframe also subsumes it (see issue 007).

## Relationship to issue 007 (attestation as upstream-evidence)

Issue 007 (`007-attestation-as-upstream-evidence.md`) tracks Open Question #12: whether `upstream-evidence.json` is also a kind of attestation. The two issues share the underlying insight (attestations are the unifying frame for "things you can say *about* a package"), but they target different artifacts:

- 006 (this issue): typed claims as attestation. The attestation says *this is what the analysis claims*.
- 007: upstream-evidence as attestation. The attestation says *this package is in relationship R with package X*.

Both could be in scope for a single ADR. **The drafter of 007 should check this issue's status before starting; if 006 has already produced an ADR that covers both, 007 folds and the registry Q12 entry gets updated to point at 006's resolution.** As of filing, the two are kept separate so each can be scoped independently; folding is a decision made during the work, not preemptively.

## Scope

**In:**
- Property-by-property assessment (§Proposed approach step 1).
- ADR + spec restructure if the assessment confirms the reframe.
- Implementation guidance for the eventual typed-claims build-out (downstream of Open Question #5).

**Out:**
- Implementing typed claims. That's downstream of Open Question #5 (claims.jsonld implementation timing).
- The Civic Claim Vocabulary domain-extensions portfolio. That work proceeds independently per issue 003.
- The promotion of CCV to a full OWL ontology. That's issue 005.
- The upstream-evidence-as-attestation reframe. That's issue 007 (or this issue, if folded).

## Acceptance criteria

- The property-by-property assessment is committed (as a section in the ADR or as a working note in the open-questions registry).
- ADR drafted and Accepted (or explicitly Rejected with rationale, if the assessment finds the reframe doesn't work).
- If Accepted: Open Evidence Standard §11 + §15 + Civic Claim Vocabulary draft spec §4.6 are all revised to reflect the reframe.
- Open-questions registry Q11 moved to Resolution log.
- Decision documented on whether issue 007 is folded into this work or remains separate; registry Q12 entry updated accordingly.

## Dependencies

- **No hard dependency on Open Question #5** — the reframe is a spec / framing change that can land before typed claims are built. It actually strengthens the argument that typed-claims implementation should wait until the framing is settled.
- **Soft interaction with issue 005** (CCV as full OWL ontology) — the ontology axioms for `caco:AnalyticalDerivation` will look different if the reframe lands; coordinate timing.
- **Soft interaction with issue 007** — see above. Both issues may share an ADR.

## Risk

- **Property-by-property assessment may surface a property that doesn't fit either side cleanly.** If found, the assessment should document the friction and propose a resolution (either move the property, or articulate why typed claims have a feature attestations don't). Don't force-fit.
- **The reframe changes how typed claims interact with the package signature.** Today the Civic Claim Vocabulary draft spec §3.2 says "The package signature in `signature.json` covers `claims.jsonld` along with all other package contents — claims are immutable once signed." Under the reframe, typed claims are separately-signed attestations, not part of the package's own signature. The spec needs to update this.
- **Attestation infrastructure may not perfectly fit the typed-claim semantics.** Today's attestations are simpler shapes than typed claims; making attestations general enough to accommodate typed claims may complicate the attestation infrastructure. Mitigation: ADR explicitly weighs this and either accepts the complexity or notes that a typed-claim-specific attestation kind is fine even within the unified frame.

## Reproducible at

- Open Evidence Standard: `civic-ai-tools/docs/architecture/open-evidence-standard.md` §11, §12, §15.
- Civic Claim Vocabulary draft spec: `civic-ai-tools/docs/architecture/civic-claim-vocabulary-draft-spec.md` §3.2, §4.6.
- Open-questions registry: `civic-ai-tools/docs/architecture/open-questions.md` Q11, Q12.
- Existing attestation infrastructure: `civic-ai-tools-website/src/lib/evidence/expert-attestation.test.ts` and adjacent (consistency / evaluation kinds).
- Related issues: 005 (CCV as ontology — coordinates on `caco:AnalyticalDerivation` axiomatization); 007 (attestation as upstream-evidence — may fold here).
