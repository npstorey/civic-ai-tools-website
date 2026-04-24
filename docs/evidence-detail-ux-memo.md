# Evidence detail page — UX design memo

**Issue:** [#84 UX pass on evidence detail page, especially long provenance chains](https://github.com/npstorey/civic-ai-tools-website/issues/84)
**Scope:** Design memo only. No component changes in this pass. Follow-ups split into separate PRs/issues per §8.
**Constraint doc:** [`docs/design-principles.md`](./design-principles.md). Principles are cited by number; not re-derived.

---

## 1. Problem framing

Four reference packages make the problems concrete.

- **`b8cc28` (5 tool calls, Boston OpenContext).** Only one call gets the `▶` expand affordance — the final `ckan__aggregate_data(query)`. The four metadata and search calls before it render flat, hiding what users care about for verification: which dataset was queried, what search string was sent, which resource IDs were resolved. The rule lives at `src/components/evidence/ProvenanceChain.tsx:140` (`const hasExpandableContent = soql || Object.keys(q.arguments).length > 2;`) — a Socrata-era density heuristic that over-collapses for CKAN and Data Commons packages. This is a **Principle 8 violation**: the UI discriminates on an axis (`> 2 args` / SoQL-shape) that does not correspond to whether detail is worth exposing.
- **`a9e428` (63 tool calls, Data Commons).** A scanning wall. Eleven `search_indicators` calls interleave with fifty-two `get_observations` calls that differ only in which indicator DCID was fetched. No summary header, grouping, filter, jump-to, or collapse-all. A reader asking *"what did the AI fetch, in what phases?"* has to scroll through sixty-plus near-identical entries.
- **`ffd99b` (22 tool calls, Data Commons).** Same shape at mid-scale — enough repetition to ask "what was the AI doing across these steps?", not enough to make the reader give up. The absence of a narrative bridge (Principle 5) is most noticeable here.
- **`255b8e` (2 tool calls, Data Commons).** Works-fine-today baseline. The redesign must not regress this case.

Two secondary issues surfaced during the code read.

- **The page has two provenance sections.** `Provenance Chain` renders a timeline of steps; `Provenance Graph (W3C PROV-O)` renders the same underlying graph as agents / activities / entities. They overlap in content and compete for the reader's attention. (Principle 4: one dominant split, subordinate detail.)
- **The homepage renders the same provenance data more legibly.** `src/components/ProgressLog.tsx::CompletedSummary` builds a three-layer view for completed queries — (A) a plain-English narrative paragraph generated from the tool calls, (B) a strip of clickable breadcrumb chips, and (C) a `ToolCallCard` detail panel per selected step plus a "Show all steps" toggle. The detail page has none of this — it renders step labels and an inconsistent expand affordance. That is the gap to close.

## 2. Principles applied

The composition section of `docs/design-principles.md` (§121–131) already names this issue as a Principle 5 + 8 + 9 case. Those three are load-bearing; Principles 1, 4, and 7 are framing context. Citations below are to the numbered principles in that document.

- **Principle 5 (progressive disclosure with a narrative bridge)** prescribes the three-depth pattern: glance label → one-sentence narrative → click-to-drawer. It also argues narrative strings should be generated **once, server-side**, not templated client-side per render. The homepage currently builds narrative client-side from structured tool data (via `buildNarrativeSummary` in `src/lib/streaming.ts:683`); that works but is explicitly flagged in P5 as the weaker option. The detail-page redesign should slot narrative *at package-write time* if possible, not repeat the homepage's client-side-templating shortcut.
- **Principle 8 (default renders collapse, drawers expose)** makes the expansion inconsistency at `ProvenanceChain.tsx:140` a violation by name. The fix is uniform collapse-by-default + expose-on-click for every detail-bearing step, not a heuristic on argument count.
- **Principle 9 (language discipline)** governs the label audit. "Provenance Chain" as a heading reads as technical jargon; "Skill guidance" is internal vocabulary whose meaning isn't obvious from the words; "Unverified" can read as "we tried and failed"; "PROV-O" is fine on a download button and wrong in a section heading. Each of those is a cheap, high-leverage change.
- **Principle 1 (disclosure ≠ validation)** keeps any new chip or badge honest. The redesign should not introduce new evaluative labels.
- **Principle 4 (one dominant split, subordinate detail)** argues against two coequal provenance cards on the same page. Fold.
- **Principle 7 (three orthogonal axes)** keeps the data model honest across data-provenance / attestation / cryptographic-integrity. The redesign operates in the UI layer; the data model is already orthogonal post-M9.3 and should stay that way.

## 3. Evaluate the three options

### (a) Reuse the homepage step-render component on the detail page

**What it requires.** Import `CompletedSummary` (or extract a shared variant) into the detail page. Adapt the data shape: homepage reads `ToolCall[]` (`name`, `args`, `operationType`, `resultSummary: {rows, columns}`, `duration_ms`, `reason`); the package stores `EvidencePackage.queries[]` (`tool`, `operationType`, `arguments`, `datasetId`, `portal`, `duration_ms`, `resultRows`, `resultColumns`). The field rename is trivial, but two gaps are not:

- **`reason`** (the free-text "why is the AI making this call" string) is generated client-side during streaming in `src/lib/streaming.ts::generateToolReason` and never stored in the package. Either we start persisting it in `queries[]` (back-compat with null-fallback for existing packages) or the detail-page port loses the reason strip.
- The homepage narrator (`buildNarrativeSummary`) is **Socrata-aware**: it calls `getPortalCity`, `getDatasetName`, `datasetUrl` — all Socrata portal-specific. On a Data Commons–only package it would either produce empty or awkward prose (no portal city, no dataset dictionary). `ToolCallCard` has the same problem: its `buildSocrataUrl` generates Socrata JSON/CSV links that don't exist for Data Commons or Boston OpenContext.

**Trade-offs.** Unifies the two components (long-run cleanup) but drags Socrata-specific assumptions into a place where multi-source packages now dominate. Does not satisfy Principle 5's server-side-narrative prescription — the narrator runs client-side in either location.

**Effort.** 3–5 days. Extract shared component, generalize the narrator, remove or conditionalize the Socrata link helpers, adapt the data shape.

**Resolves which problems?** Inconsistency (yes), density (partly — breadcrumb chips compress better than the timeline), disclosure (yes). Does not resolve homepage-vs-detail disparity in the direction P5 prefers.

### (b) Port the "always expandable + narration" pattern into `ProvenanceChain` while keeping its timeline visual

**What it requires.** Restructure `ProvenanceChain` so every step renders with a consistent collapse-by-default / expose-on-click affordance (ditch the `soql || > 2 args` branch at line 140). Add a narration layer above the timeline: a summary header ("11 searches across 2 sources, then 52 observation queries — 1m 12s, $0.08") and an optional per-phase narrative sentence where the data supports it. Keep the dot-and-line timeline visual — it maps cleanly to Principle 5's "glance" layer and is already understood.

**Trade-offs.** Preserves the timeline metaphor that reads well for small chains (the `255b8e` baseline). Contains the change surface to one component. Does not unify with the homepage — an explicit short-term cost for long-term flexibility on each surface.

**Effort.** 1.5–2 days. Core restructure ~1 day; summary header and narration wiring ~0.5–1 day. Grouping and filter controls (§5) are scoped to separate PRs.

**Resolves which problems?** Inconsistency (yes, in one commit). Density (setup for grouping — actual grouping is separate). Disclosure (yes, with narrative bridge added). Leaves homepage-vs-detail component duplication unresolved.

### (c) Minimum-change fix — drop the `> 2` threshold so every tool call becomes expandable

**What it requires.** One-line change at `ProvenanceChain.tsx:140`: replace `const hasExpandableContent = soql || Object.keys(q.arguments).length > 2;` with `const hasExpandableContent = true;` (or equivalent — every tool call has *something* worth seeing). Ship today.

**Trade-offs.** Fixes P8 violation. Does not address density, narration, disclosure hierarchy, language, or the duplicated provenance-graph card. Cheap, honest, no regression risk.

**Effort.** Minutes.

**Resolves which problems?** Inconsistency only.

## 4. Recommendation

**Ship (c) as a bridge, then do (b) as the core redesign. Defer (a).**

(c) costs nothing and fixes a live Principle 8 violation on every CKAN and Data Commons package published since M9.2. There's no reason to wait for (b) to land to fix it. Make it a one-line PR.

(b) is the right shape for the full redesign. Three reasons:

1. **Principle 8 uniformity is achieved inside the component that owns it.** The timeline stays; the branching heuristic goes. The scope of the change matches the scope of the violation.
2. **The timeline visual is a good fit for Principle 5's glance layer.** Dots and lines read as "this happened, then this happened." Breadcrumb chips (the homepage layer B) read as "here are the steps, pick one" — a different mental model. For a frozen, post-hoc audit surface the timeline metaphor is more appropriate than the live-query chip strip.
3. **(a) drags Socrata assumptions into the evidence page at exactly the moment multi-source packages are becoming the default.** The post-M9.3 `dataSources[]` and PROV-O graphs are source-agnostic; the narration layer needs to match. Building that narrator into `ProvenanceChain` (or better, into the packager) lets it be source-aware from the start, rather than retrofitting a Socrata-heavy renderer.

Principle 5's "narrative strings should be generated server-side, once, per step shape" is not satisfied by porting the homepage's current client-side narrator. The long-run correct answer is generating narration at **package-write time** and storing it on `queries[]` alongside the tool fields (the same pattern `resultRows` and `datasetId` already use). Scope narration-at-package-time as a separate task after (b) ships, rather than blocking (b) on it — a client-side placeholder narrator is strictly better than no narrator.

Defer (a) indefinitely. Revisit if the evidence detail page ever embeds a live-replay mode (see BPMN replay #60) — at that point a unified renderer would have higher leverage.

## 5. Long-chain density handling

Positions on the seven patterns the issue lists, in rough order of recommended priority.

- **Consecutive-similar grouping (ship).** The canonical win for `a9e428`. Render runs of identical `(tool, operationType, source)` tuples as a single collapsed group: "11 × `search_indicators` on Data Commons — click to expand." Expanding reveals the per-call list using the same ToolCallCard-style disclosure. Grouping rule should be strict (exact tuple match); fuzzy grouping invents precision (Principle 3). Scope: ship in the same follow-up PR as the core redesign or the immediate one after.
- **Top-of-chain summary header (ship).** One line: "3 phases — 1 skill load, 11 searches, 52 observation queries — 1m 12s, $0.08 estimated." This is the glance layer from Principle 5 applied to the chain as a whole. Cheap to generate from the existing `queries[]` data. Include it above the timeline.
- **Collapse-all / expand-all toggle (ship).** Pairs naturally with grouping and costs almost nothing. Keeps the current "flat dense view" available for users who prefer it (inspectability without imposition — Principle 6).
- **Jump-to / anchor links (ship, low priority).** Sticky phase headers (`Metadata phase`, `Search phase`, `Query phase`, `Synthesis`) derived from the grouping boundaries. Pure progressive-enhancement; adds weight only when the chain exceeds some threshold (e.g., >10 calls).
- **Filter controls by source / tool / operation type (skip initially).** The use case hasn't materialized. Grouping covers the visual-density win; filters are for power users auditing specific subsets. Revisit once a user actually asks for it — filters are easy to add, harder to remove once shipped.
- **Timeline vs. list toggle (skip).** Two views reading from one data model adds UI weight for a use case the grouping pattern already mostly serves. Revisit if power-user feedback argues for it.
- **Virtualized rendering (skip).** Not needed at the current scale. `a9e428` (63) renders fine; `255b8e` (2) renders trivially. Revisit if chains regularly exceed ~200 calls, which would also motivate rethinking the underlying data model.

## 6. Broader detail-page concerns

**Section ordering.** Current order is reasonable: Summary → Verification → (Status History) → Provenance Chain → Provenance Graph → Skill Guidance → Notebook → Attestations → Resources → Actions → Package hash. Recommend two changes:

1. **Fold Provenance Graph into Provenance Chain.** Two cards showing overlapping content violates Principle 4. Demote the graph view to a secondary tab inside the Provenance Chain card (Summary / Graph / JSON-LD tabs — the Graph tab preserves the current expandable PROV-O listing). This also satisfies Principle 6: the escape hatch stays available, never default.
2. **Move Resources Used above Attestations.** Resources summarizes *what was used to produce this* (model, data sources, tokens, cost, duration). Attestations summarizes *what has been done to this since*. The natural reading order is "what is this" → "what state is it in" — attestations come after the resource summary, not before.

**Density vs. whitespace.** The biggest density win is the merge in (1). After that, the page reads fine at desktop width. Mobile needs a separate pass — the Resources grid (`repeat(auto-fit, minmax(140px, 1fr))`) collapses well, but the Provenance Chain horizontal spacing assumes a wider viewport. Defer to a mobile-specific follow-up.

**Attestation card layout with multiple types landing.** Today's linear list is fine for one or two attestations. At three-plus — especially when `expert_attestation` work lands — group by type: a small strip showing "Consistency ✓ · Evaluation ✓ · Expert — none" with each state click-expanding into its attestations below. This keeps attestation state as Principle 7's orthogonal axis visible at a glance without hiding details.

**Multi-source resources post-M9.3.** The `formatDataSourcesSummary` wiring is correct — packages rendering "Data sources: Data Commons" or "Data sources: Socrata, Data Commons" already show the right thing. No additional work; just don't regress it.

## 7. Language audit (Principle 9)

Five highest-leverage changes.

1. **Section heading "Provenance Chain" → "Analysis steps"** (or "How this was made"). "Provenance" is Latinate and operational-jargon-y; the content is a step-by-step narrative of what the AI did. "Analysis steps" reads as user language and matches the homepage's "Show all steps" toggle.
2. **"Skill guidance" → "AI instructions"** across section heading, step label, and Resources grid. The current term is internal vocabulary whose meaning isn't obvious; P9 calls this out by name. "AI instructions" or "System prompt" both work; prefer the former for reader-accessibility.
3. **The folded graph tab should be labeled "Graph."** Keep "PROV-O" only on the download button, where the technical audience is the intended reader. The structural fold itself (§6) belongs to PR 4; this label change belongs to PR 5, so the two stay independently shippable.
4. **StatusBadge `unverified` → "No attestations yet".** "Unverified" reads as a failure ("we tried and failed") — flagged directly in P9. "No attestations yet" is honest and reads as a process state.
5. **Resources grid "Tool calls" → "Data requests"** (or "Source queries"). "Tool calls" is implementation-speak. For the target audience, "data requests" is what actually happened.

Secondary candidate, not leading: the step label `ckan__search_datasets(search)` reads like code. A user-facing label ("Search Boston open data catalog") needs per-tool narration strings and should land with the (b) narrative-bridge work, not as a standalone rename.

## 8. Proposed implementation split

Five follow-up PRs/issues. Dependencies noted.

- **PR 1 — Bridge fix: drop the `> 2` threshold.** One-line change at `ProvenanceChain.tsx:140` to make every tool call expandable. No dependencies. Effort: 15 minutes. Ship today, resolves the live Principle 8 violation independently of the larger redesign. Candidate new issue.
- **PR 2 — Core provenance chain redesign (option b).** Uniform collapse/expose affordance (supersedes PR 1), summary header, optional per-step narration placeholder sourced client-side for now. Effort: 1–2 days. Depends on: nothing; PR 1 is optional pre-work. Candidate issue: "Evidence detail provenance chain: uniform disclosure + summary header."
- **PR 3 — Long-chain density features.** Consecutive-similar grouping, collapse-all/expand-all toggle, phase-anchor links. Effort: 1–2 days. Depends on: PR 2 (shared step-rendering primitive). Candidate issue: "Evidence detail provenance chain: grouping + collapse-all for long chains."
- **PR 4 — Page-level restructure.** Fold Provenance Graph card into a tab inside Provenance Chain; swap Attestations / Resources ordering. Effort: ~1 day. Depends on: nothing, but ideally lands after PR 2 so the merge happens into the redesigned component. Candidate issue: "Evidence detail: merge Provenance Graph into Provenance Chain; reorder Resources and Attestations."
- **PR 5 — Language audit pass.** The five renames in §7 plus any downstream references (tests, page metadata). Effort: ~0.5–1 day. Depends on: nothing. Can land in parallel or before PR 2. Candidate issue: "Evidence detail: language audit per Principle 9."

**Deferred out of this memo.** Narrative-at-package-time (generating per-step narration strings at publish time and persisting them in `queries[]` to satisfy Principle 5 server-side-narrative). Worth its own design note once PRs 2–3 are in. Also deferred: mobile UX pass, attestation card re-layout for the multi-type future.

**Resolved decisions (from planning-chat review).**

1. **`narration?: string` on `queries[]` is acceptable** as a package-schema evolution. Generate server-side at publish time in `buildEvidencePackage()`. Templates must be deterministic per-tool-per-source functions — never LLM-generated, which would be Principle 3 false precision via stochastic means. Unknown tools get a generic honest fallback. Old packages render without the field via client-side fallback. Schema evolution documented in `docs/api/evidence-publish.md` change-log when it lands. Scoped as a follow-up design note, not a PR 2 blocker.
2. **PR 1 ships separately** from PR 2. The bridge fix is a regression fix for a live Principle 8 violation on every CKAN and Data Commons package published since M9.2; it should land within the day rather than wait for the PR 2 redesign cycle.
3. **No alias/redirect needed for the "Provenance Chain" → "Analysis steps" rename.** Before PR 5 lands, spend ~5 minutes greping the repo for the literal string "Provenance Chain" and update any README screenshots or external doc references found.
