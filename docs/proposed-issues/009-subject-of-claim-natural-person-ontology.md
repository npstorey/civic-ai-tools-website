# Subject-of-claim ontology for natural persons + default host-side filtering

**Repo:** civic-ai-tools (Open Evidence Standard + Civic Claim Vocabulary spec drafts); civic-ai-tools-website (display + filter surface)
**Labels:** future-work, evidence-system, harms-mitigation, ontology, high-leverage
**Estimated effort:** M (spec extension + display affordance + host-policy expression)
**Blocks:** Harm-mitigation completeness in the OES preamble; meaningful protection against the doxxing failure mode
**Tracks:** Related to the OES harms section (existing issue #63) and the host self-attestation pattern (proposed-issue 008).

## Problem

The architecture conversation named the most consequential failure mode the protocol enables: **a published claim that wears the formal clothes of "civic evidence" while its actual subject is a private individual** (home address, employer, family members, etc.). The cryptographic infrastructure can't distinguish a watchdog publishing evidence of corporate malfeasance from a harasser publishing a target's home address — both are signed claims by authors with identity bindings, about real-world entities.

The single highest-leverage protocol-level defense against this failure mode is a **subject-of-claim ontology** that distinguishes the categories of things claims can be about, with `natural-person` as a category that hosts default-filter (or default-route-to-human-review) unless explicitly overridden.

This issue scopes that ontology and the host-side default filtering pattern.

## Proposed approach

Three deliverables:

1. **Subject-of-claim ontology in the OES + Civic Claim Vocabulary specs.** Initial top-level categories:
   - `dataset` — claims about data (the default for civic-data analyses).
   - `organization` — claims about companies, government agencies, NGOs, etc.
   - `public-figure` — claims about identifiable individuals in public roles. (Boundary cases — when does someone become a public figure? — are deliberately fuzzy here; the spec describes the category, hosts and consumers interpret.)
   - `natural-person` — claims about identifiable private individuals.
   - `event` — claims about events (incidents, decisions, actions).
   - `geography` — claims about places.
   - `policy` — claims about policies, laws, rules.
   - `host` — claims about hosts (subject-category for host self-attestations and evaluations).
   - `claim` — claims about other claims (subject-category for meta-attestations).
   - `unknown` — fallback; hosts should treat as suspicious.

2. **Required-field expectation in the OES spec.** Every published claim SHOULD declare `subjectCategory`. Claims without it are treated by hosts as `unknown` (and most hosts will default-filter `unknown`).

3. **Host-side default filtering pattern.** Hosts default to NOT serving claims with `subjectCategory: natural-person` unless one of:
   - The host's self-attestation explicitly opts in to serving them, AND a subject-objection meta-attestation has not been published, AND the host applies additional review.
   - A consumer explicitly requests `natural-person`-category claims with appropriate filtering.

   The protocol doesn't enforce this; hosts implement it. The spec documents it as the recommended default host policy.

## Spec changes the work produces

- `docs/architecture/open-evidence-standard.md` — new section defining `subjectCategory` as a required envelope field, with the initial taxonomy; recommended host-side default policy for `natural-person` and `unknown` categories; reference to subject-objection meta-attestations as the structured response path.
- `docs/architecture/civic-claim-vocabulary-draft-spec.md` — alignment with the subjectCategory values; existing claim shapes annotated with which categories they typically apply to.
- `docs/adr/000N-subject-of-claim-ontology.md` (new ADR) — records the decision, the initial taxonomy, and the recommended default host policy. Cites the harms section (issue #63 follow-on) for the threat-model rationale.
- Possible follow-on: per-category claim-shape extensions (e.g., what does a `policy`-category claim require that a `dataset`-category claim doesn't?).

## Relationship to other work

- **Builds on**: typed-attestation primitive (Joel-Issue 2) — subject-objection meta-attestations use the primitive.
- **Coordinates with**: host self-attestation pattern (proposed-issue 008) — host policy on `natural-person` claims is expressed via the host self-attestation.
- **Coordinates with**: OES harms section work (existing issue #63) — this ontology is the most concrete protocol-level mitigation; the harms section references it.
- **Coordinates with**: privacy-and-applicable-laws documentation (DPG-track issue) — the natural-person handling is GDPR-adjacent; the privacy doc references this issue as the operational mechanism.

## Scope

**In:**
- Subject-of-claim taxonomy as a required envelope field.
- Recommended default host policy for `natural-person` and `unknown`.
- ADR.
- Spec updates.
- Reference implementation: civicaitools.org applies the default policy.

**Out:**
- Per-category claim-shape extensions (separate follow-on).
- Public-figure boundary determination algorithms (deliberately deferred — fuzzy by design).
- Mass-abuse-report mitigation (separate concern; relies on identity-binding-strength weighting, not on subject-category).
- Children's-data handling (related but separate — children's-data position lives in the privacy doc, may produce its own subject category like `minor` later).

## Acceptance criteria

- OES spec declares `subjectCategory` as a required envelope field with the initial taxonomy.
- ADR records the decision and recommended default host policy.
- civicaitools.org enforces the default policy: claims with `subjectCategory: natural-person` are not served from the standard list-and-search surfaces; can be served via explicit consumer opt-in.
- A real `subject-objection` meta-attestation flow exists end-to-end (subject of a claim can publish an objection, hosts can default-filter on its presence).
- Subject-category is surfaced in the evidence detail page so readers see what kind of subject a claim is about.

## Dependencies

- **Hard dependency on Joel-Issue 2** (typed attestation primitive) — subject-objection meta-attestations rely on the primitive.
- **Coordination with proposed-issue 008** (host self-attestation) — host policy on natural-person claims is expressed there.
- **Coordination with DPG-track privacy documentation** — privacy doc references this as the operational GDPR-adjacent mitigation.

## Risk

- **Boundary cases between `public-figure` and `natural-person`.** The taxonomy has a fuzzy edge by design. Mitigation: spec acknowledges the fuzziness; describes the spectrum; hosts and consumers make judgment calls; the protocol doesn't try to compute boundaries.
- **`unknown` becoming a backdoor.** A malicious actor could publish a claim about a natural person tagged as `dataset` to evade default filtering. Mitigation: hosts should apply content scanning regardless of declared category; default-filter `unknown` and treat suspicious `dataset` claims with skepticism.
- **Discouraging legitimate claims about identified individuals** (whistleblower revealing a public official's behavior). Mitigation: `public-figure` is a valid category; the default policy targets `natural-person` private individuals. Whistleblower scenarios about public officials are within `public-figure` scope. The spec documents the distinction.
- **Subject-objection abuse.** Anyone can claim to be a subject and object. Mitigation: identity binding on the objector matters; hosts weight by binding tier; consumers can filter on objection-presence with confidence based on objector's binding.

## Reproducible at

- Open Evidence Standard: `civic-ai-tools/docs/architecture/open-evidence-standard.md` (no current section on subject-of-claim; the proposed addition).
- Civic Claim Vocabulary draft: `civic-ai-tools/docs/architecture/civic-claim-vocabulary-draft-spec.md` §4.3 (required properties).
- Existing related issue: npstorey/civic-ai-tools#63 (threat model documentation — the harms section this ontology is the operational answer to).
- Integration arc planning: `civic-ai-tools/docs/proposals/data-concierge-integration.md` § "Out of scope for v1" (flagged as highest-leverage follow-on).
