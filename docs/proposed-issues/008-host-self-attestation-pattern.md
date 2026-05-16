# Host self-attestation pattern + first reference implementation

**Repo:** civic-ai-tools (Open Evidence Standard) + civic-ai-tools-website (reference implementation as the first host)
**Labels:** future-work, evidence-system, attestations, host-layer, infrastructure
**Estimated effort:** M (spec extension + reference implementation; depends on the typed-attestation primitive landing first)
**Blocks:** The host-and-trust layer of the OES architecture; downstream multi-host federation work
**Tracks:** Open Question #22 (host as typeable subject + v1 self-attestation shape). Builds on the typed-attestation primitive landing under the integration arc.

## Problem

The Open Evidence Standard treats hosts as load-bearing infrastructure (the entities that serve evidence packages and decide policy around what they serve), but the host role currently lives implicitly — there's no protocol-expressible way for a host to describe itself, declare its policies, or be the subject of third-party attestations.

The architecture conversation arrived at the position that hosts should be **first-class subjects in the OES ontology**, with self-attestations and third-party evaluations expressed as the same primitive used for all other OES claims (signed evidence packages referencing a typeable subject).

This makes the host-and-trust layer of the architecture composable with the rest of the protocol: no new primitive, just a new `subjectCategory` and a new family of `claimType` values.

Concretely, this issue scopes:

1. The protocol-level work: `Host` as a typeable subject; `host-self-attestation` and `host-evaluation` as claim types.
2. The first reference implementation: civicaitools.org publishing its own host self-attestation.
3. The bare minimum schema for what a self-attestation contains so it's useful (claims served, filter policy, governance, retention, abuse-handling SLA expectations).

## Proposed approach

Three deliverables:

1. **Spec extension.** Add to the Open Evidence Standard:
   - `subjectCategory: host` as a valid value.
   - `claimType: host-self-attestation` — a signed evidence package whose subject is a host (typically the signer itself), describing the host's properties.
   - `claimType: host-evaluation` — a signed evidence package whose subject is a host, authored by a third party, expressing an evaluation (positive or negative).
   - Required fields for `host-self-attestation` content:
     - `hostIdentifier` — typically a DNS-bound URI.
     - `claimTypesServed` — which OES claim types this host serves.
     - `filterPolicy` — pointer to a documented filter policy (URL).
     - `governance` — pointer to governance / accountability documentation.
     - `retention` — retention policy as a duration or "indefinite."
   - Optional but recommended fields:
     - `requiresAdversarialEvalOnPublication` — boolean or structured (min score, min evaluator binding tier). Hosts that require evals refuse to serve publication records lacking conforming evaluation references.
     - `subjectCategoryFilter` — which subject categories the host serves (e.g., `dataset`, `organization`; exclude `natural-person` if the host filters those by default).
     - `mirrors` — array of host identifiers that this host mirrors.

2. **Reference implementation in civicaitools.org.** The website publishes its own host self-attestation as an OES claim. Lands at a well-known location (e.g., `/.well-known/oes-host-attestation.json`) and is registered on the transparency log like any other claim. Becomes the first concrete data point for the host-and-trust layer.

3. **Display affordance.** Evidence detail pages on civicaitools.org surface the serving host's self-attestation (collapsed by default; expandable). Verification UX includes "served by host H, whose self-attestation is at URL X."

## Spec changes the work produces

- `docs/architecture/open-evidence-standard.md` — add `subjectCategory: host`, `claimType: host-self-attestation`, `claimType: host-evaluation`. Probably a new top-level section on the host-and-trust layer.
- `docs/adr/000N-host-self-attestation-pattern.md` (new ADR) — records the decision to make hosts first-class subjects and the v1 self-attestation shape.
- `docs/architecture/open-questions.md` — Q22 moves to Resolution log; Q23 (provenance-graph rendering of meta-attestation layer) gains a related-work reference.
- Possible follow-on: a `host-attestation-schema.json` in the spec directory for machine validation.

## Relationship to other work

- **Depends on**: typed-attestation primitive landing (Joel-Issue 2 in the integration arc). Host self-attestations *are* attestations under the unified node primitive; they need the primitive to exist.
- **Bundles with**: the adversarial-evaluation-as-publication-gate work (Joel-Issue 4 / reframed). The `requiresAdversarialEvalOnPublication` field on host self-attestations is how hosts express that gate.
- **Enables**: third-party host evaluations (a follow-on issue); cross-host claim discovery (deferred); host-policy-aware consumer filtering.
- **Reference for**: any future host (Data Concierge for Pittsburgh / WPRDC, future civic-tech adopters). The reference implementation defines the conformance shape.

## Scope

**In:**
- Spec extension for `Host` subject category and `host-self-attestation` / `host-evaluation` claim types.
- Reference implementation: civicaitools.org publishes its own self-attestation.
- Display surface: evidence detail page shows serving host's self-attestation.

**Out:**
- Third-party host evaluations infrastructure (separate follow-on once the self-attestation pattern is in use).
- Host-registry-as-discoverable-graph (deferred — the network emerges from individual host attestations; no central registry).
- Consortium certification mechanics (deferred — DPG-track concern).
- Cross-host claim mirroring policy (deferred).

## Acceptance criteria

- OES spec contains normative definitions for `subjectCategory: host`, `claimType: host-self-attestation`, `claimType: host-evaluation`.
- civicaitools.org publishes a self-attestation as a real OES claim, registered on the transparency log, signed by the platform key.
- The self-attestation is discoverable at a well-known URL.
- Evidence detail pages display the serving host's self-attestation.
- ADR filed recording the decision and the v1 shape.
- Registry Q22 moves to Resolution log.

## Dependencies

- **Hard dependency on Joel-Issue 2** (typed attestation primitive) — host self-attestations use the same primitive.
- **Coordination with Joel-Issue 3** (visibility lifecycle) — host self-attestations are always `published` claims by design (a private host self-attestation defeats the purpose).
- **Coordination with Joel-Issue 4** (adversarial-eval gate) — `requiresAdversarialEvalOnPublication` is a host-self-attestation field expressing the gate.
- **Soft dependency on platform-independence documentation** (DPG-track) — host self-attestations are the place where alternative-deployment hosts express their characteristics.

## Risk

- **Schema lock-in too early.** v1 self-attestation schema may need fields that haven't surfaced yet. Mitigation: keep v1 schema small and extensible (additive only); explicitly document the schema as `v1` so later versions can be `v2` without breaking.
- **Host self-attestations encouraging gatekeeping behavior.** A self-attestation system can ossify into "only consortium-certified hosts are 'real' hosts." Mitigation: explicit doctrine that any signing identity can publish a host self-attestation; the network's evaluation is a function of consumer filtering, not a central authority's blessing. Follow the working-method-flow doctrine on cross-surface moves.
- **Reference implementation diverging from spec.** Mitigation: the spec is authored alongside the civicaitools.org implementation; the implementation drives the spec, not the other way around. Co-evolve.

## Reproducible at

- Open Evidence Standard: `civic-ai-tools/docs/architecture/open-evidence-standard.md` (current internal working draft, pre-v0.1).
- Open-questions registry: `civic-ai-tools/docs/architecture/open-questions.md` Q22 (this question).
- Integration arc planning: `civic-ai-tools/docs/proposals/data-concierge-integration.md` Category F (host registry foundation).
- Architecture conversation: the host-and-trust layer discussion (see transcript in the planning doc's source materials).
