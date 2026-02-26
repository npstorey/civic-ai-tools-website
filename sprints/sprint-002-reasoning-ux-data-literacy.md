# Sprint 002: Streaming Reasoning UX & Ambient Data Literacy

**Goal:** Make the demo's streaming reasoning display *teach* civic data concepts — so that watching the AI work doubles as an introduction to open data portals, structured queries, and AI trust calibration.

**Builds on:** Sprint 001 delivered real-time step narration, collapsible GroupCards, ToolCallCards with SoQL display, and educational tooltips. This sprint layers educational depth and visual clarity onto that foundation.

**Key insight from research:** The same design choices that make AI reasoning comprehensible also teach data literacy. A well-labeled SoQL explanation serves both the user who wants to understand the AI's process and the user who wants to learn what "GROUP BY" means.

---

## Tasks

### Must-have

- [ ] **1. Enrich the without-MCP panel with contextual framing**
  Replaces the generic spinner with a label: "Answering from training data only — no access to current databases." After content renders, adds a footer annotation: "This response is based on the model's training data (cutoff: ~early 2025). It cannot access current government records." Makes the comparison pedagogically explicit — users immediately understand *why* the two panels differ.
  - **Research ref:** Suggestion #2 (every major AI product now shows knowledge cutoff dates)
  - **Touches:** `src/components/ResponsePanel.tsx` — add conditional label in the non-streaming skeleton state and a footer annotation after content for the `withoutMcp` variant
  - **Acceptance:** A first-time user can articulate why the two panels give different answers without reading any documentation

- [ ] **2. Add full plain-English translation alongside SoQL queries**
  Below each SoQL block in ToolCallCard, render a natural-language sentence: "This asks: 'In the 311 complaints dataset, count complaints grouped by borough, sorted from most to fewest, showing the top 5.'" Generated from the structured args the system already has (dataset name via `getDatasetName`, clause semantics from `buildSoqlClauses`).
  - **Research ref:** Suggestion #1 (SQLAI.ai multi-layer explanations, Oracle AI Explain)
  - **Touches:** `src/lib/streaming.ts` — new `generatePlainEnglishQuery(args)` function; `src/components/ToolCallCard.tsx` — render the translation below SoqlDisplay; `src/components/SoqlDisplay.tsx` — optionally integrate
  - **Acceptance:** Every SoQL query displayed in a ToolCallCard has a readable English sentence a non-technical user can understand

- [ ] **3. Visually differentiate WHAT / WHAT-FOUND / WHY in progress entries**
  Use color, weight, and subtle icons to distinguish the three narration layers within GroupCard entries. Actions (`tool_start` phase) get a warm amber accent and gear icon. Results (`tool_result` phase) get a green accent and check icon. Reasoning (`thinking` phase entries, `reason` text) gets a cool blue/gray with italic weight. The phase data already flows through `ProgressLogEntry.phase` — this is purely a styling change.
  - **Research ref:** Suggestion #5 (LangSmith icon-differentiated run types, information hierarchy research)
  - **Touches:** `src/components/ProgressLog.tsx` — update `StandaloneEntry` and GroupCard body entry rendering to apply phase-specific styles; `src/app/globals.css` — add phase color classes using existing design tokens (`--nyc-caution` for action, `--nyc-success` for result, `--nyc-info` for reasoning)
  - **Acceptance:** A user can visually parse at a glance which entries are actions, which are results, and which are reasoning — without reading the text

### High-value

- [ ] **4. Improve GroupCard labels with richer one-line summaries**
  Enhance `generateGroupLabel` in `useStreamingComparison.ts` to produce more descriptive summaries. Current: "Querying data". Better: "Querying 311 complaints — filtering Brooklyn, 2024". Use the structured args (dataset name, WHERE conditions, GROUP BY fields) already available in the group's `tool_start` entries to generate context-rich labels. Also add the dataset name when known.
  - **Research ref:** Suggestion #3 (Perplexity Pro Search step labels, "logic and reasoning behind actions")
  - **Touches:** `src/hooks/useStreamingComparison.ts` — enrich `generateGroupLabel`; may need to pass more structured data through `ProgressLogEntry` (e.g., parsed args)
  - **Acceptance:** Each GroupCard header tells a user what data was sought and what filters/groupings were applied, readable without expanding

- [ ] **5. Expand educational tooltips with clause-concept mapping**
  Extend the existing tooltip system in SoqlDisplay and ToolCallCard to teach query concepts more explicitly. Map each SoQL clause to a metaphor: WHERE = "filter to only matching rows", GROUP BY = "organize into categories before counting", LIMIT = "show only the top N results". Add dataset ID tooltips: "erm2-nwe9 — every Socrata dataset has a unique code, like a library call number." Enhance existing `CLAUSE_TOOLTIPS` in SoqlDisplay with these richer descriptions.
  - **Research ref:** Suggestion #4 (GitHub teaching Git through terminology, DALI Framework contextual learning, librarian analogy)
  - **Touches:** `src/components/SoqlDisplay.tsx` — update `CLAUSE_TOOLTIPS` content; `src/components/ToolCallCard.tsx` — enhance dataset ID tooltip text
  - **Acceptance:** Every technical term visible to users has a tooltip that a high school student could understand

- [ ] **6. Build a timing breakdown bar for completed tool sequences**
  After the MCP panel completes, render a horizontal stacked bar above or within the tool summary banner showing time spent in each phase. Segments: "Analysis" (pre-tool thinking), "Data retrieval" (sum of tool call durations), "Synthesis" (post-tool response generation). Each segment labeled with duration. Uses `duration_ms` data already flowing through `tools_called` and `completionTime`. Clicking a segment could scroll to the corresponding GroupCard.
  - **Research ref:** Suggestion #9 (browser DevTools waterfall, Arize Phoenix latency dashboards); also sprint-001 nice-to-have #7
  - **Touches:** `src/components/ResponsePanel.tsx` — new `TimingBar` sub-component rendered near `buildToolSummary`; data sourced from `tools_called[].duration_ms` and panel-level `duration_ms`
  - **Acceptance:** Users can see at a glance that "data retrieval took 3.2s of the total 5.8s" — making the cost of grounded answers tangible

### Nice-to-have

- [ ] **7. Add learning-moment annotations at key tool-call phases**
  At specific points in the progress log, inject short (1-2 sentence) educational annotations. When the AI searches a catalog: "The AI is searching an open data portal — a public catalog where governments publish datasets for anyone to use." When it reads metadata: "Reading the data dictionary — the list of columns and what each one contains." When it retries: "The first query didn't return useful results, so the AI is adjusting its approach." Annotations render as subtle italic text below the progress entry, using a distinct muted style. Keep them static/template-based (no localStorage tracking yet — that's a future enhancement).
  - **Research ref:** Suggestion #8 (Duolingo contextual scaffolding, 47%→69% activation lift from contextual walkthroughs)
  - **Touches:** `src/components/ProgressLog.tsx` — annotation rendering below relevant entries; `src/lib/streaming.ts` — new `getEducationalAnnotation(phase, operationType)` function returning annotation text or null
  - **Acceptance:** A user who has never heard of "open data" learns what a portal, dataset, and query are just by watching the progress log

- [ ] **8. Add source provenance line to MCP response footer**
  After the MCP response content, render a compact provenance line: "Source: NYC Open Data · 311 Service Requests (erm2-nwe9) · 8.2M rows · Updated daily". Assembled from the `tools_called` metadata (dataset name, portal, result summary). Teaches data provenance, freshness, and scale in a single line without requiring any expansion or interaction.
  - **Research ref:** Ambient learning research — "a source attribution teaches provenance, freshness, scale, and data sourcing in a single line"
  - **Touches:** `src/components/ResponsePanel.tsx` — new provenance footer below markdown content; data from `tools_called` array
  - **Acceptance:** Users can see exactly where the data came from, how much data exists, and how fresh it is — in one glance

---

## Acceptance Criteria (Sprint-level)

1. A non-technical user watching both panels can explain: what the AI did differently with MCP, why the answers differ, and what "querying a dataset" means — without reading the About page.
2. The progress log is visually scannable: phase types are distinguishable at a glance, GroupCard headers are informative without expanding, and SoQL queries have English translations.
3. The without-MCP panel actively teaches about training data limitations rather than presenting results without context.
4. No existing functionality is broken or degraded — all changes are additive to the current UX.

---

## Deferred (needs more design work)

These research suggestions have high potential but require significant design decisions or scope that exceeds a single sprint:

- **Inline verification badges on data claims** (research #7) — Tagging individual numbers in prose as verified/unverified requires parsing model output and matching against tool results. Risk of false confidence if badges are wrong. Needs a robust matching algorithm and careful UX design for edge cases.
- **Glossary-in-context system** (research #10) — Detecting and annotating technical terms across all rendered content requires a term detection utility, comprehensive term list, and localStorage tracking for progressive reduction. Good candidate for sprint-003.
- **Interactive replay mode** (research #11) — Replaying the tool-call sequence as a narrated animation is compelling but requires an animation system, playback controls, and stored event data. Significant engineering effort.
- **Fork-and-modify query capability** (research #12) — Letting users edit SoQL parameters and re-run queries transforms the demo into a tool. Requires a query builder UI, API integration, and careful rate-limit considerations.
- **Adaptive scaffolding by user behavior** (research #13) — Tracking interactions to adjust UI detail level is the right long-term direction but premature before the base educational content exists. Build the content first (this sprint), then make it adaptive.
- **Trust calibration dashboard** (research #14) — Structured diff between panels requires parsing both responses and aligning claims. Depends on visual diff highlighting (sprint-001 #6, still unimplemented).
- **Guided lesson mode** (research #15) — Curated progressive query sequence is an excellent educational tool but is effectively a new product feature requiring content authoring, UI design, and progress tracking.
- **Visual diff highlighting** (sprint-001 #6) — Carried forward; still valuable but requires NLP-level analysis of hedged vs. grounded language.

---

## Notes

- Research warns (CHI 2025) that teaching AI capabilities without teaching verification creates overconfidence. Every annotation about how the AI works should be paired with a nudge to verify. Keep this principle in mind for all copy.
- The existing three-layer narration model (WHAT/WHAT-FOUND/WHY) and GroupCard architecture are solid foundations. This sprint enriches them rather than replacing them.
- All `duration_ms` data, `phase` tags, and structured `args` needed for these tasks already flow through the streaming pipeline — most tasks are about presentation, not plumbing.
