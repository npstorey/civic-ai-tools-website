# Design principles: civic-ai-tools-website

**Scope:** UX and data-model principles governing AI-output and provenance surfaces — the chat output (homepage), the evidence detail page, the provenance graph view, the directory of MCP sources, and any future surface that renders AI-generated analysis or attestation state.
**Audience:** Future planning chats, implementation chats, civic technologists, government data workers, journalists, students, and the maintainer.
**Status:** Living document. Revise when principles materially change; do not revise to match a specific issue or PR scope.

---

## How to read this document

These are the principles the civic-ai-tools-website is designed against. They compose into most of the visible UX decisions — why the verification status chip says what it says, why the provenance chain is collapsible, why the analysis output is always tagged with its model and data sources, why language deliberately avoids implementation jargon. They are the slow-moving document; project plans and issue scopes are the fast-moving ones.

When an issue conversation disagrees with a principle below, the disagreement should be resolved explicitly — either by changing the principle (with a revision note) or by scoping an exception. Principles are not suggestions and are not per-issue aesthetic preferences.

The shortest version to remember: **disclosure not validation, hierarchy not equality, narrative not metadata, axes not chips, user language not implementation language.** The rest is how to render it.

---

## Family 1 — Disclosure, not validation

These govern what the UI is *allowed to claim*.

### Principle 1: Disclosure ≠ validation

Every label, badge, and chip on the evidence page tells you about process, not truth. "Verification Status: Unverified" means no attestation has been added — a process state, not "the AI got it wrong." "Key trust: active" means the signing key is in our published trust registry — a process claim, not "the answer is correct." "Verify Integrity" runs cryptographic checks against the package — process verification, not content review. "Boston OpenContext MCP Server" as a PROV-O agent means that server returned the cited data — disclosure of source, not endorsement of answer accuracy.

The distinction is subtle in isolation and load-bearing in aggregate. It's what keeps the tool honest when readers (government officials, journalists, students, civic technologists) eventually scrutinize these pages and expect the labels to mean exactly what they say.

This principle comes most directly from journalism and fact-checking UX — NewsGuard, Google Fact Check, IPTC trust-indicator guidance — where the distinction between "we disclosed our method" and "we validated the content" is a load-bearing norm. The civic-tech translation is exact: an evidence package is a disclosure surface, not a truth claim.

### Principle 2: Persistent source marking

Every AI-generated analysis is permanently marked with its origin. Model, data sources, tool calls, skill guidance, and timestamps are baked into the evidence package and visible at every render. Withdrawal is a separate signed action with a public reason; it does not erase the package. The cryptographic chain (signature + RFC 3161 timestamp + Rekor entry + content-addressable hash) makes the AI-generated provenance permanent across the entire lifecycle.

This is the discipline most AI tools get wrong (Copilot, Notion, Grammarly all drop authorship attribution on accept) and the discipline civic-ai-tools must preserve specifically because civic data analyses may be cited months or years after generation. If a reader sees a published civic-data finding, they should always be able to see that an AI generated it, what model, what data it pulled, and what tool calls produced the figures cited.

### Principle 3: No false precision

If we don't actually have a signal, don't show one. Cost estimates are real measured values, shown with the `~` qualifier where the exact figure depends on token counts that vary slightly between runs. Hash prefixes are real (the package is content-addressable). Tool-call durations are measured.

What we don't do, and shouldn't: invent confidence percentages on AI outputs, fabricate quality scores for data sources, or imply attestation activity that hasn't happened. The chip language matters here too: "Unverified" can read as "we tried and failed" if the page doesn't make clear that the chip means "no attestations have been added yet." When in doubt, label more explicitly rather than less.

The page's honesty is set by its worst-case element: one fake confidence score anywhere damages trust across every chip. Show what we know, label what we don't know, and never simulate precision we haven't earned.

---

## Family 2 — Hierarchy and restraint

These govern what the UI *shows at each moment*.

### Principle 4: One dominant split, subordinate detail

The first visual question every reader should answer in a 90-second skim is **AI synthesis vs. data from civic source.** Did the AI write this from training data alone, or did it fetch real records and cite them? Every other distinction — which model, which MCP server, which tool, which dataset, what attestation state — is secondary and should read as secondary.

This is the discipline that the homepage's "Without Data Tools" / "With Data Tools" split makes immediately visible. The evidence detail page should preserve the same dominant split: an analysis backed by tool-fetched civic data is materially different from a model-only response, and the page should make that visible at first glance, not buried under a flat list of metadata fields.

The trade is worth it because it eliminates the most dangerous misread — that an AI-only output and a tool-grounded analysis look interchangeable on first glance.

### Principle 5: Progressive disclosure with a narrative bridge

Three depths of disclosure, in this order:

- **Glance** (chip / label / step name) — which source, which status, which step. 1–3 seconds.
- **Hover or one-line narrative** — one-sentence plain-English description of what the step did and what it returned. 3–10 seconds.
- **Click** (drawer or expanded panel) — full story: raw arguments, full results, structured trace data, raw PROV-O escape hatch. 30+ seconds.

The load-bearing element in this hierarchy is the **plain-English narrative sentence** that bridges the technical step name and the trustable answer. The homepage chat narration ("Reading the data dictionary — the list of columns and what each one contains") is the canonical implementation. Everything else in the expanded view — argument JSON, schema details, response payloads — is for users who've already been convinced by the narrative to look deeper. If the narrative sentence is wrong or missing, no amount of structured metadata below it compensates.

This is why narrative strings should be generated server-side, not on the client. Client-side narrative generation tempts us to template per-render from the structured data, which produces sentences that are technically correct and humanly awful. Server-side generation at trace-write time forces us to write each sentence *once*, carefully, for each step shape.

### Principle 6: Inspectability without imposition

Raw PROV-O JSON-LD, the full evidence package JSON, the Jupyter notebook export, the verify-integrity API — all available, none default.

The escape hatch exists for power users: external auditors, researchers replaying analyses, government data stewards verifying the provenance chain manually, journalists fact-checking a cited figure. But most users most of the time do not want to see the JSON-LD graph or the raw package, and prior art (ProvStore, VisTrails) shows that graph-first interfaces are specialist surfaces that don't scale to non-technical readers.

The principle: the power user gets everything they need, without the everyday user ever being forced past the narrative layer.

---

## Family 3 — Separation of concerns

These govern what the UI *models in the data*.

### Principle 7: Three orthogonal axes

The data model tracks three independent properties of every evidence package:

- **Data provenance** — where the data came from (which MCP server, which dataset, which records). Captured in `dataSources[]`, the PROV-O agents, and the per-tool-call `mcp.source` attributes.
- **Attestation state** — what attestation activity has occurred on this package (none / consistency-tested / adversarially-evaluated / expert-attested). Captured in the attestations table.
- **Cryptographic integrity** — whether the package's signature, timestamp, Rekor entry, key-trust verdict, and content hash all check out. Captured in the verify endpoint's response.

These are independent axes and must not collapse in the data model, even if they partially collapse in the default rendering. A consistency-attested package can still have invalid integrity if its signing key has been revoked. A package signed with the active key can still have zero attestations. A multi-source package can have one source flagged as data-quality concerning while the others are clean.

The reason this matters is future-proofing. Every time we conflate two axes into one chip — "consistency-passing AND active key" as a single state — we make it harder to surface a third state later (e.g., a key in the trust registry's `legacy_embedded` state with an active consistency attestation). Keeping the axes separate in the model costs nothing and preserves optionality.

### Principle 8: Default renders collapse, drawers expose

Default rendering should collapse detail in favor of scanability; expanded views should expose all available structure.

The current evidence detail page violates this principle inconsistently — some tool-call steps in the provenance chain are expandable, others are flat-only — and the inconsistency is the wrong axis to discriminate on. The fix is uniform: every detail-bearing element collapses by default and exposes its full structure on click. Whether that detail is a tool's argument JSON, a query's full response, an attestation's reviewer notes, or a PROV-O activity's complete metadata, the affordance pattern should be consistent.

Collapse in the skim; expose on demand.

This is the principle that lets Principle 7 coexist with Principle 4. The data model is honest about the three axes; the UI compresses them where compression aids scanning and decompresses them where decompression aids understanding.

---

## Principle 9 — Language discipline

User-facing copy reflects user mental models, not implementation.

"AI" is user language; "LLM" is implementation. "Data source" or "civic data source" is user language; "MCP server" is implementation (acceptable in technical contexts and the directory page, less so on the homepage). "Provenance graph" or "audit trail" is user language; "PROV-O" is technical jargon that's fine as a label on the download button but shouldn't appear in headings. "AI instructions" or "system prompt" reads as user language; "skill guidance" is current internal language whose meaning isn't obvious from the words. "Unattested" or "No attestations yet" reads as a process state; "Unverified" risks being read as "we tried and failed."

Word choice is the cheapest and highest-leverage design decision in the whole system, and it's the one most likely to be overridden by engineering defaults if nobody is watching. Language discipline is therefore a standalone principle rather than part of a family — it cuts across disclosure, hierarchy, and data modeling alike.

The civic-data audience spans government workers, journalists, students, and engineers. Default to the broadest accessible language; reserve technical terminology for surfaces (download buttons, API docs, JSON-LD viewers) where the technical reader is the intended audience.

---

## How the principles compose

The principles don't operate independently. A few characteristic decisions show how they compose:

The *cryptographic chain on every package* is Principle 1 (disclosure — the chain proves what was signed when, not that the answer is right) + Principle 2 (persistent — the signature can't be removed, only superseded by a withdrawal) + Principle 6 (inspectability — verify-integrity is a button, not the default rendering).

The *evidence package detail page's verification card* is Principle 3 (no false precision — every check is a real cryptographic operation, not an invented score) + Principle 7 (three orthogonal axes — signature, Rekor, key trust, hash match are each independent verdicts) + Principle 8 (collapse-and-expose — the card summarizes status, click drills into per-check detail).

The *provenance chain redesign* (issue #84) is Principle 5 (narrative bridge needed between step names and trustable answers) + Principle 8 (uniform collapse-expose pattern, not the current selective expansion) + Principle 9 (step labels should read as user language, not implementation tool names where avoidable).

The *homepage with-vs-without comparison* is Principle 4 (one dominant split — AI alone vs AI with civic data, made the hero of the page) + Principle 5 (per-step narration that bridges raw tool calls to plain-English summary) + Principle 9 ("With Data Tools" / "Without Data Tools" reads as user language, not "RAG vs zero-shot").

The *attestation type names* (`consistency`, `evaluation`, `expert_attestation`) are Principle 1 (each name describes the process performed, not the truth verdict reached) + Principle 9 (`expert_attestation` was deliberately chosen over options that implied authority or final judgment).

---

## What these principles don't cover

Three things are *not* design principles for civic-ai-tools, and should not be mistaken for them.

**Novelty.** The UX is deliberately conservative. Civic-data audiences do not need an inventive provenance UI; they need a legible one. Where prior art converges (W3C PROV-O for graph structure, Sigstore + Rekor for cryptographic verification, GitHub-style disclosure-button semantics, expand-on-click for detail), follow it. Where prior art diverges, pick the option that best serves civic governance and audit trails. Novelty is not a design goal.

**Aesthetic polish.** The principles above are about legibility, honesty, and data-model discipline. They are not about making the page beautiful. A beautiful evidence page that violates Principle 1 (implies validation it doesn't have) is worse than an ugly one that doesn't. Aesthetic work is appropriate once the principles are satisfied.

**Completeness.** Any given issue stubs things deliberately. Completeness is not a principle; scope discipline is. The principles govern what ships; what ships is a subset of the end state.

---

## The sentence to carry into stakeholder conversations

> *Civic AI Tools discloses how every analysis was made — which model, which data sources, which tool calls, with what cryptographic chain — and does not claim the analyses are correct.*

That single sentence is the whole governance posture. Everything else is how to render it.
