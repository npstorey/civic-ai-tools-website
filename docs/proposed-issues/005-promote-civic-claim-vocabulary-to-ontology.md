# Promote Civic Claim Vocabulary from controlled vocabulary to full OWL ontology

**Repo:** civic-ai-tools (CCV draft spec + alignment with adjacent ontologies live here)
**Labels:** future-work, civic-claim-vocabulary, ontology, infrastructure, medium-priority
**Estimated effort:** L (multi-step: axiomatization of core shapes, alignment with adjacent ontologies, reasoner test corpus, ADR, v0.2 spec)
**Blocks:** any work that depends on richer downstream tooling (SPARQL queries over claim graphs, OWL reasoners checking class hierarchies, automated alignment with PROV-O / Data Cube)
**Tracks:** [Open Question #10](../../../../civic-ai-tools/docs/architecture/open-questions.md) — Civic Claim Vocabulary as a full ontology

## Problem

The Civic Claim Vocabulary is currently framed as a controlled vocabulary of typed claim shapes expressed in JSON-LD, intentionally lighter-weight than a full OWL ontology with rich axioms (see `civic-ai-tools/docs/architecture/civic-claim-vocabulary-draft-spec.md` §4 — "controlled set of typed claim shapes expressed in JSON-LD"). The current draft references W3C ontologies (PROV-O, OWL-Time, RDF Data Cube) and Schema.org for concepts those vocabularies already cover, but it does not itself author OWL axioms or define class hierarchies that a reasoner could use.

This was the right framing for v0.1 — small, stable, easy to author against, no heavy semantic-web machinery required. The cost is that the vocabulary lacks:

- **Axiomatic class definitions.** A reasoner cannot infer that `ccv:TrendClaim` is a subclass of `ccv:Claim` without explicit `rdfs:subClassOf` axioms; the spec describes this in prose but doesn't formalize it.
- **Disjoint-class declarations.** Whether `ccv:ObservationClaim` and `ccv:TrendClaim` can both apply to the same instance is left implicit.
- **Property cardinality and domain/range constraints in OWL form.** SHACL shapes are mentioned but not yet authored; OWL property restrictions would let reasoners check well-formedness independently of SHACL.
- **Explicit alignment with adjacent ontologies.** A `ccv:ObservationClaim` is structurally close to `qb:Observation` (W3C Data Cube), but no `owl:equivalentClass` or `rdfs:subClassOf` declaration links them. Same for `ccv:TrendClaim` and any analogous SDMX-RDF concept; same for `ccv:RelationshipClaim` and statistical-inference vocabularies elsewhere.
- **Reasoner compatibility.** The spec cannot today be loaded into a standard OWL reasoner (HermiT, Pellet, ELK) for consistency checks, classification, or query answering against a claim corpus.

The project intends to address all of this. This issue scopes the promotion.

## Proposed approach

Three phases. Each phase produces a publishable artifact; the spec stays usable throughout.

**Phase 1 — Axiomatize the core in OWL.** Author `civic-claim-vocabulary.owl` (Turtle or RDF/XML, hosted at `https://civicaitools.org/ns/civic-claim-vocabulary/v1`) with:

- Class hierarchy: `ccv:Claim` as the root; `ccv:TrendClaim`, `ccv:ComparisonClaim`, `ccv:ObservationClaim`, `ccv:CompositionClaim`, `ccv:RelationshipClaim`, `ccv:QualitativeClaim` as subclasses.
- Property declarations for every required and optional property in §4.3 with explicit `rdfs:domain`, `rdfs:range`, and cardinality restrictions.
- The `ccv:Scope`, `ccv:ConfidenceStatement`, `ccv:AnalyticalDerivation` patterns as named OWL classes.
- The `ccv:GeographicScope` taxonomy from §4.4 with `rdfs:subClassOf` from each named subtype to `ccv:GeographicScope`.

**Phase 2 — Alignment with adjacent ontologies.** Add explicit `owl:equivalentClass` / `rdfs:subClassOf` / `skos:exactMatch` / `skos:closeMatch` declarations linking:

- `ccv:ObservationClaim` ↔ `qb:Observation` (W3C Data Cube — likely `rdfs:subClassOf qb:Observation` since CCV adds claim-specific properties).
- `ccv:Scope` and its geographic subtypes ↔ relevant TIGER/Line and OGC GeoSPARQL classes (where they exist).
- `ccv:AnalyticalDerivation` ↔ relevant `prov:Derivation` subtypes; `ccv:translationModel` ↔ `prov:wasAssociatedWith` patterns.
- `ccv:Claim` ↔ Schema.org `schema:Claim` (subject to the §9 open question 5 about fact-check tooling interop — alignment may be `skos:closeMatch` rather than `owl:equivalentClass` to avoid the fact-check connotation).
- `ccv:ConfidenceStatement` confidence-method enums ↔ relevant statistical-inference vocabularies (search for existing ontologies; no obvious candidate yet).

**Phase 3 — Reasoner test corpus.** Build a small corpus of test claims (JSON-LD) plus a SPARQL test suite (or an OWL test suite using one of the standard reasoners) that demonstrates:

- Subclass inference works (a `ccv:TrendClaim` instance is also a `ccv:Claim`).
- Property domain/range constraints fire when violated.
- Cross-ontology alignment fires (an instance of `ccv:ObservationClaim` is recognized as a `qb:Observation`).
- SHACL validation produces the same results as the OWL constraints for the cases where they overlap.

The reasoner-test corpus is the "is this actually working" check. Without it, the OWL axioms could be subtly wrong and no one would notice until a downstream consumer hits the bug.

## Spec changes the work produces

- `civic-claim-vocabulary.owl` (new file, hosted at the namespace URL).
- `civic-claim-vocabulary-draft-spec.md` v0.2: framing changes from "controlled vocabulary" back to "ontology"; §4 gains a "Class hierarchy" subsection describing the OWL axioms; §6 governance section gets revised once a v1.0 process exists; `claims-vocabulary` references rename to `claims-ontology` where appropriate (no mass rename — the term "Civic Claim Vocabulary" stays as the project name; just the framing inside the spec changes).
- `end-state-vision.md` glossary entries for OWL, RDF, and Civic Claim Vocabulary updated to reflect the promotion.
- `end-state-vision.md` §5 heading reverts from "claims vocabulary family" to "claims ontology family" to match the OWL framing once the promotion lands.
- A new ADR (`docs/adr/0004-civic-claim-vocabulary-as-ontology.md` or similar) records the decision and the phasing.

## Scope

**In:**
- ADR recording the decision and phasing.
- OWL axiomatization (Phase 1).
- Alignment declarations with adjacent ontologies (Phase 2).
- Reasoner test corpus (Phase 3).
- Spec rewrites in CCV draft + end-state-vision + open-questions registry to reflect the promotion.
- Hosting plan for `civic-claim-vocabulary.owl` at the namespace URL (likely just adding it to the website's `/.well-known/` or `/ns/` path — straightforward).

**Out:**
- Building OWL reasoners or SPARQL endpoints for downstream consumption. Adopters use existing reasoners (HermiT, Pellet, ELK) and existing SPARQL stores against the published ontology.
- Domain extensions. Each extension is its own work, gated on a real package needing it (per the Civic Claim Vocabulary domain-extensions portfolio in `003-civic-claim-vocabulary-domain-extensions-portfolio.md`).
- Implementing `claims.jsonld` generation. That depends on Open Question #5 resolving — separate work.
- Q11 (typed claims as attestation reframe) — separate issue 006.

## Acceptance criteria

- ADR drafted and Accepted.
- `civic-claim-vocabulary.owl` published at the namespace URL and validates against W3C OWL 2 DL profile (verifiable via the [OWL 2 Validator](https://www.w3.org/2012/pyRdfa/extract?validate=yes&format=html&warnings=yes)).
- Alignment declarations land for at minimum Data Cube + PROV-O + Schema.org.
- Reasoner test corpus demonstrates the four checks above; tests pass against at least one of HermiT, Pellet, or ELK.
- CCV draft spec v0.2 is committed with the framing changes; pointers in `end-state-vision.md` and the open-questions registry are updated.
- `civic-claim-vocabulary.owl` is referenced from the trust-registry-style `.well-known` location or equivalent so adopters can discover it.

## Dependencies

- **Soft dependency on Open Question #5** (claims.jsonld implementation timing) — promoting the vocabulary to an ontology before any package uses it is permitted under the Xanadu doctrine (research / spec authoring is exempt from the gate), but actually generating `claims.jsonld` is downstream and gated separately.
- **No hard dependency on Open Question #1** (package format) — the ontology is independent of how the package is structured.
- **Open Question #11 may interact** — if typed claims get reframed as a kind of attestation, the OWL axioms may need to express the attestation relationship differently. Coordinate timing.

## Risk

- **OWL is hard to write correctly.** Subtle axiomatization errors (wrong domain/range, missing disjointness, accidentally-too-broad subclass declarations) produce reasoner outputs that look fine but are wrong. Mitigation: Phase 3's reasoner test corpus is designed exactly for this.
- **Alignment declarations may force naming changes.** If `qb:Observation` semantics differ from `ccv:ObservationClaim` more than expected, the alignment may need to be `skos:closeMatch` rather than `owl:equivalentClass` (or even just informative prose). Don't force alignment that doesn't actually hold.
- **Reasoner choice has consequences.** OWL 2 DL profiles vary in expressivity and reasoner support. Pick a profile that works with at least two reasoners.

## Reproducible at

- CCV draft spec: `civic-ai-tools/docs/architecture/civic-claim-vocabulary-draft-spec.md` (v0.1 draft, internal working draft pre-v0.1 status).
- Vision doc framing: `civic-ai-tools/docs/architecture/end-state-vision.md` §5 (claims vocabulary family) and Glossary entries for OWL, RDF, Civic Claim Vocabulary.
- Open-questions registry: `civic-ai-tools/docs/architecture/open-questions.md` Q10.
- Related issues: 003 (domain-extensions portfolio — depends on a stable v1.0 ontology); 006 (typed claims as attestation reframe — may interact); 007 (attestation as upstream-evidence — may interact).
