# Retrospectives

Reverse-chronological session retros for the civic-ai-tools-website project.

---

## 2026-03-05 — Sprint 004: Migrate BPMN to /explore, Restructure About

**Scope:** Page reorganization — moved BPMN visualization from `/about` to a new `/explore` route, restructured About as educational prose, added Explore to header nav. Plus one ad hoc UX fix (Enter to submit).

### What we did

**1. Created `/explore` route** — New `src/app/explore/page.tsx` with the BPMN diagram as primary content. Brief intro text + the existing `McpFlowDiagramWrapper`.

**2. Renamed `components/about/` → `components/explore/`** — `git mv` preserved history. All internal relative imports (e.g., `./BpmnViewer`, `./TraceControls`) continued working with no changes.

**3. Restructured About page** — Removed `McpFlowDiagramWrapper` import. Replaced BPMN section with prose explaining MCP + a "Watch it in action" CTA button linking to `/explore`. All other educational sections preserved.

**4. Added Explore to header** — Desktop nav and mobile hamburger menu both show About | Explore | GitHub.

**5. Updated CLAUDE.md** — Architecture diagram, directory structure, prop threading paths, component references, sprint index all updated. Removed the "About page post-migration plan" section (migration complete).

**6. Enter to submit (ad hoc)** — Added `onKeyDown` handler to home page `<textarea>` so Enter submits, Shift+Enter inserts newline.

### What went well

- **Zero iteration** — Rename via `git mv`, create new page, edit About, update Header — all straightforward. Build passed on first attempt after `npm install`.
- **Relative imports survived the rename** — Since all BPMN components moved together, none of the internal imports needed updating. Only the one external import in `about/page.tsx` needed removal.
- **Cross-reference audit was quick** — `SkillPromptDisclosure` links to `/about#system-prompt` and `NarrationExplainer` links to `/about#narration` — both sections stayed on About, so no changes needed.

### What to watch

- **No runtime testing by Claude** — User tested manually and confirmed it looks good.
- **bpmn-js wasn't installed locally** — `npm install` was needed despite `bpmn-js` being in `package.json`. Build failed without it.

### Files changed

| File | Action |
|------|--------|
| `src/app/explore/page.tsx` | **New** — Explore page with BPMN diagram |
| `src/components/about/*` → `src/components/explore/*` | **Renamed** — 7 files moved |
| `src/app/about/page.tsx` | Removed BPMN import, replaced with prose + CTA |
| `src/components/Header.tsx` | Added Explore link (desktop + mobile) |
| `src/components/QueryForm.tsx` | Enter to submit, Shift+Enter for newline |
| `CLAUDE.md` | Updated architecture, directory structure, references |
| `sprints/completed/sprint-004-explore-page-migration.md` | Marked done, moved to completed/ |

---

## 2026-02-27 — Sprint 003 Bulk Polish: 18 Fixes Across Layout, A11y, Hover States, Copy

**Scope:** 18 additional fixes from the polish audit across 13 files. Focused on accessibility, interactive feedback, mobile navigation, and design system consistency.

### What we did

Implemented the remaining "Fix Soon" items and several "Minor" items from `sprint-003-polish-audit.md`, bringing the sprint from 10/44 to 28/44 fixed.

**Accessibility (4 fixes):** `:focus` → `:focus-visible` on all selectors, global `button:focus-visible` rule, `--text-muted` darkened from #777 to #757575 for WCAG AA, BPMN container `role="img"` + `aria-label`.

**Interactive feedback (4 fixes):** Hover states for TraceControls buttons (mode tabs, trace pills, speed, reset/cancel/new query via styled-jsx classes), breadcrumb chip hover, query suggestion card hover, design system focus style on live query input.

**Layout (3 fixes):** `overflow-x: clip` on body, responsive BPMN height `min(650px, 70dvh)`, mobile hamburger menu for screens < 640px.

**Visual consistency (2 fixes):** Fullscreen exit button border-radius 8px → 4px, About page h3 sizes standardized to 18px.

**Copy & content (5 fixes):** Generic training cutoff (removed stale date), commit-SHA GitHub links, "Running query" ellipsis removed, CTA shorthand clarified, footer period, excerpt claim softened, BPMN Tailwind colors → design system tokens, GitHub header link → website repo.

**Example replay header:** Removed unreliable step/iteration counters from the side panel header. Now shows the current event message during playback, and timing + tool call count when complete.

### What went well

- **Batch efficiency** — 18 fixes in one pass with zero build failures. Grouping by file minimized context switches.
- **CSS-class approach for hover states** — Adding classes like `mode-tab`, `trace-pill`, `secondary-btn` and defining hover rules in styled-jsx was cleaner than inline `onMouseEnter`/`onMouseLeave` handlers.
- **Global `button:focus-visible`** — One rule fixed focus styling across every custom button in the app.

### What didn't go well

- **Exit fullscreen button layout** — Moved from absolute positioning to a flex row to fix theoretical overlap, but this wasted ~52px of vertical space in fullscreen mode. Reverted to absolute after seeing the spacing issue in practice. Lesson: test layout changes visually before committing to a different approach.
- **Step counter was unreliable** — "Step 9 of 9" counted raw trace events, not user-visible steps. Attempted to fix by filtering to visible phases, but the mapping was still fragile. Removed entirely — simpler is better when the data model doesn't cleanly support the UX.

### Lessons

- **Absolute positioning is fine when overlap is theoretical.** Don't "fix" something that works by introducing a worse problem.
- **Remove unreliable UI rather than patching it.** A step counter that doesn't match what users see is worse than no counter.
- **Design system tokens prevent color drift.** Replacing Tailwind hex values (`#22c55e`, `#f59e0b`) with CSS variables (`--nyc-success`, `--nyc-caution`) means future palette changes propagate automatically.

### Files changed

| File | Changes |
|------|---------|
| `src/app/globals.css` | `overflow-x: clip`, `--text-muted` WCAG fix, `:focus-visible`, `button:focus-visible`, breadcrumb hover, query card hover, BPMN pulse colors |
| `src/components/Header.tsx` | Mobile hamburger menu, GitHub link → website repo |
| `src/components/about/McpFlowDiagram.tsx` | Responsive height, exit button border-radius, step counter removal |
| `src/components/about/TraceControls.tsx` | Focus style on live input, hover classes on tabs/pills/buttons |
| `src/components/about/LiveResponsePanel.tsx` | Simplified header: removed step/iteration, shows message or timing |
| `src/components/about/BpmnViewer.tsx` | `role="img"` + `aria-label`, lane colors → design system |
| `src/components/about/bpmn-diagram.css` | Active/loop/success colors → CSS variables |
| `src/components/ResponsePanel.tsx` | Generic training cutoff text |
| `src/components/ProgressLog.tsx` | (breadcrumb hover via globals.css) |
| `src/app/about/page.tsx` | h3 consistency, query card class, commit-SHA links, copy fix |
| `src/app/layout.tsx` | Footer trailing period |
| `src/app/page.tsx` | CTA shorthand → "civic-ai-tools" |
| `src/hooks/useStreamingComparison.ts` | Remove trailing ellipsis from group label |

---

## 2026-02-27 — Quick Polish: Broken Colors, Accessibility, Copy, Input Overflow

**Scope:** 10 fixes across 7 files, zero new files. All single-line or few-line changes addressing broken CSS variables, WCAG contrast failures, copy inconsistencies, and a UX bug.

### What we did

Implemented the top 10 issues from the polish audit (`sprints/completed/sprint-003-polish-audit.md`):

1. **`--nyc-blue` CSS variable** — Added alias for `#103FEF`, fixing 14 broken `var(--nyc-blue)` references across 6 files
2. **Markdown table overflow** — Added `display: block` + `overflow-x: auto` to `.response-markdown table`
3. **Green success contrast** — Darkened `--nyc-success` from `#00B703` to `#008A02` (~4.6:1 on white, WCAG AA pass)
4. **TimingBar capitalization** — `'Data Retrieval'` → `'Data retrieval'` to match sentence case
5. **Connection error message** — Appended "Please try again." to match home page pattern
6. **Expand "LLM" and "MCP"** — Hero text: "Compare AI responses" + "Model Context Protocol (MCP)"; meta descriptions updated
7. **Panel titles** — `"Without MCP"` / `"With MCP"` → `"Without Data Tools"` / `"With Data Tools"`
8. **Button font-family** — Global `button { font-family: inherit; }` reset for unstyled buttons
9. **Error red mismatch** — Replaced Bootstrap `#dc3545` with `var(--nyc-error)` in TraceControls
10. **Query input auto-expand** — Textarea auto-resizes via `useRef` + `autoResize` callback, capped at 120px

### What went well

- **All 10 fixes were independent** — No ordering constraints, no cascading side effects. Applied in one pass with no iteration.
- **Build passed first try** — No type errors, no lint regressions. The changes were minimal enough that risk was near zero.
- **CSS variable alias was the right call** — Adding `--nyc-blue` as an alias fixed 14 references without touching any component files, versus a find-and-replace that would have touched 6 files.
- **Design system consistency** — Fixes 3 and 9 bring error/success colors fully in line with the NYC Design System variables instead of ad-hoc hex values.

### What to watch

- **No runtime testing** — All verification was build-only. The textarea auto-resize, table overflow scroll, and button font rendering should be manually tested.
- **`--nyc-success` darkening is global** — 26 usages affected. Most are decorative (borders, backgrounds) where the slightly darker green is imperceptible, but worth a visual pass.

### Lessons

- **Polish audits produce high-ROI work** — 10 fixes, 7 files, minimal risk, measurable UX improvement. Good pattern for future sprints.
- **CSS variable aliases prevent drift** — When component code naturally reaches for `--nyc-blue`, having both `--nyc-blue` and `--nyc-blue-40` point to the same value avoids broken references without enforcing a naming convention.

### Files changed

| File | Changes |
|------|---------|
| `src/app/globals.css` | Add `--nyc-blue` alias, darken `--nyc-success`, table overflow, button font reset |
| `src/components/shared/McpResponseDisplay.tsx` | TimingBar label sentence case |
| `src/hooks/useLiveTrace.ts` | Error message copy |
| `src/app/page.tsx` | Hero copy: "AI responses" + "Model Context Protocol (MCP)" |
| `src/app/layout.tsx` | Meta descriptions: "AI" not "LLM" |
| `src/components/ComparisonDisplay.tsx` | Panel titles: "Without/With Data Tools" |
| `src/components/about/TraceControls.tsx` | Error state uses design system red |
| `src/components/QueryForm.tsx` | Textarea auto-expand with ref + autoResize |

---

## 2026-02-27 — Unify Example Trace Replays with Side-by-Side Layout

**Scope:** 5 files changed (1 new, 3 modified, 1 deleted), replacing NarrativePanel with the same side-panel step cards used by live queries.

### What we did

Example trace replays now use the same 55fr/45fr side-by-side layout as live queries. Clicking Play opens the split view with the BPMN diagram on the left and an incrementally-building step card panel on the right — identical to what live queries show. The old `NarrativePanel` (full-width educational text per phase) is deleted.

**Key pieces:**
- **`trace-progress.ts`** — Pure utility that derives `ProgressGroup[]`, `ProgressLogEntry[]`, and `ToolCall[]` from a slice of `TraceEvent[]`. Mirrors the grouping logic from `useLiveTrace.handleProgressEvent` but runs as a stateless function via `useMemo`, avoiding any changes to `useTraceReplay`.
- **`LiveResponsePanel`** gained two optional props: `exampleStatus` (step counter instead of elapsed time) and `completionCta` (footer action slot). Both modes now use the same component.
- **`McpFlowDiagram`** — `showSplit` expanded to activate during example playback. `exampleProgressData` derived via `useMemo`. "Try this query yourself" CTA switches to live mode with the example query pre-filled.
- **`TraceControls`** — Removed playing/complete status line (now in the side panel). Pre-play info (title + tool count + duration) remains.

### What went well

- **Plan-first paid off** — The plan was detailed enough that implementation was mechanical. No backtracking, no surprises. Build passed on first attempt.
- **Derived state via useMemo was the right call** — The largest trace has ~30 events, so recomputing on each index change is instant. This avoided modifying `useTraceReplay` or adding new state management.
- **Reusing `LiveResponsePanel`** — Adding two optional props was far cleaner than creating a new component. The shared `McpResponseDisplay` underneath means both modes get identical rendering (breadcrumbs, markdown, provenance, footer) for free.
- **Clean deletion** — `NarrativePanel` was fully replaced with zero fallback needed. No other code imported it.

### What to watch

- **No runtime testing** — Verified via build + lint only. The split transition animation, step card progressive reveal, pause/resume fidelity, and "Try this query yourself" flow all need manual testing.
- **`onModeChangeTo` duplicates `handleModeChange`** — The new helper is nearly identical to `handleModeChange` but adds `setSuggestedQuery`. Could be consolidated, but kept separate for clarity since the CTA path has different intent.

### Lessons

- **Derived state > duplicated state** — Rather than making `useTraceReplay` track progress groups (adding complexity to an already-tested hook), deriving them from the event index via a pure function was simpler and risk-free.
- **Optional props for mode variants** — Adding `exampleStatus?` and `completionCta?` to an existing component is cleaner than branching into separate components. The panel stays unified while each mode customizes its header and footer.

### Files changed

| File | Action |
|------|--------|
| `src/lib/bpmn/trace-progress.ts` | **New** — Pure function to convert TraceEvent[] → progress data |
| `src/components/about/LiveResponsePanel.tsx` | Add `exampleStatus` and `completionCta` optional props |
| `src/components/about/McpFlowDiagram.tsx` | Expand `showSplit`, add `useMemo` for derived data, render side panel for both modes, remove NarrativePanel |
| `src/components/about/TraceControls.tsx` | Remove playing/complete status line, clean up unused vars |
| `src/components/about/NarrativePanel.tsx` | **Deleted** — replaced by side panel |

---

## 2026-02-27 — Unify MCP Display, Controls Polish, Trace Labels

**Scope:** 3 tasks across 10 files (1 new), net -187 lines.

### What we did

**1. Unified MCP response display** — Created `McpResponseDisplay.tsx` as a shared component, then refactored both `ResponsePanel` (home page) and `LiveResponsePanel` (About page) to use it. This eliminated the duplicated `buildProvenanceLine` function and ~200 lines of copy-pasted rendering logic. Threaded `queryText` through the component tree so both pages show the user's query as a styled quote above the response.

**2. Clickable dataset IDs** — Added `datasetUrl()` and `buildProvenanceLine()` to `streaming.ts` with markdown links. Updated `buildNarrativeSummary()` the same way. Added `linkDatasetIds()` in the shared component to auto-link bare dataset IDs in markdown content. Updated `ProgressLog` to render narrative via ReactMarkdown. All dataset links open Socrata pages in new tabs.

**3. Controls polish** — Moved close-fullscreen from the zoom control cluster to a prominent dark pill button at the overlay top-right. Grouped speed controls (1x/2x/4x) next to the Replay button instead of pushed to the far right, hidden during live queries. Replaced technical trace pill labels ("Simple query", "Multi-step") with query descriptions ("311 complaints in NYC", "Restaurant grades by borough") and added a complexity indicator ("2 tool calls · ~8s").

### What went well

- **Plan was solid** — the MCP unification plan was detailed enough to implement without backtracking. One build error (duplicate `firstPortal` variable) caught and fixed immediately.
- **Net negative lines** — consolidated from 2 implementations down to 1 shared component, removing more code than we added.
- **About page got free upgrades** — TimingBar, Time/Tokens footer, SkillPromptDisclosure, and query text quote all came for free by adopting the shared component.

### What to watch

- **Padding delta on About page** — content padding changed from 16px to 24px inside the live response panel. Should look fine but worth a visual check.
- **Pre-existing lint errors** — 3 lint issues exist on main (TraceControls setState-in-effect, two unused vars). None introduced by us, but the TraceControls one is in a file we touched — could be cleaned up in a follow-up.
- **No runtime testing** — all verification was build+lint. The streaming behavior, auto-scroll, cursor blinking, and dataset link clicking should be manually tested on both pages.

### Files changed

| File | Action |
|------|--------|
| `src/lib/streaming.ts` | Add `datasetUrl()`, `buildProvenanceLine()`; update `buildNarrativeSummary()` with markdown links |
| `src/components/shared/McpResponseDisplay.tsx` | **New** — shared MCP response component (TimingBar, linkDatasetIds, provenance, footer) |
| `src/components/ResponsePanel.tsx` | Remove duplicated code; MCP variant delegates to shared component; add `queryText` prop |
| `src/components/about/LiveResponsePanel.tsx` | Remove duplicated code; delegate to shared component; add `queryText` prop |
| `src/components/ProgressLog.tsx` | Render narrative via ReactMarkdown for clickable links |
| `src/components/ComparisonDisplay.tsx` | Add `queryText` prop passthrough |
| `src/app/page.tsx` | Store `lastQuery` in state, pass to ComparisonDisplay |
| `src/components/about/McpFlowDiagram.tsx` | Store `liveQueryText`; split fullscreen toggle into enter/close buttons |
| `src/components/about/TraceControls.tsx` | Extract `SpeedSelector`; group speed with Replay; add complexity indicator |
| `src/lib/bpmn/traces.ts` | Replace technical chip labels with query descriptions |

---

## 2026-02-27 — Side-by-Side Live Query Layout

**Scope:** Adding live query mode to the About page BPMN diagram with a side-by-side response panel, 5-tier slow query messaging, and cancelled state preservation.

### What went well

- **Split layout was clean** — CSS grid (`55fr 45fr` with transition) worked well. The `showSplit` derived boolean kept layout logic centralized, and `fitToView()` after transitions ensured the diagram always fit.
- **5-tier slow messaging is user-friendly** — Progressive escalation (30s neutral → 180s clickable suggestion) provides genuine teaching moments.
- **Cancelled state preserves context** — Adding `'cancelled'` as a distinct status means diagram state, partial response, and elapsed time are all preserved.
- **Course correction landed well** — After the initial wrong approach (see below), reusing the actual `ProgressLog` component produced identical behavior between home and About pages.

### What didn't go well

- **Built a parallel system instead of reusing existing components** — First implementation built custom progress rendering from scratch, duplicating `ProgressLog`. Root cause: started implementing from plan description without reading existing code first. Wasted a full implementation pass.
- **useLiveTrace accumulating too much responsibility** — The hook now manages SSE connection, diagram animation, progress logs, tool tracking, trace capture, slow timers, elapsed time, and abort control. Acceptable for now but a code smell.

### Lessons

- **Read the component you're matching before writing code.** When told "make X behave like Y," always read Y first.
- **Prefer importing over reimplementing.** `ProgressLog` was already flexible enough to work in the About page context without modification.
- **Export utilities proactively.** `generateGroupLabel` had to be exported from `useStreamingComparison.ts` for reuse — anticipate cross-module needs.

### Tech debt identified

1. Duplicated event handling logic between `useLiveTrace` and `useStreamingComparison` — a shared utility could extract group-building logic.
2. `@keyframes blink` defined in multiple component-level styled-jsx blocks — could move to `globals.css`.
3. `@keyframes spin` added to globals.css but also exists in component styles — audit for duplicates.

---

## 2026-02-27 — Live BPMN Diagram for MCP Query Visualization

**Scope:** Interactive BPMN 2.0 diagram on the About page that animates pre-recorded MCP query traces through the system architecture. 11 files created, 3 modified.

### Architecture decisions

| Decision | Rationale |
|----------|-----------|
| **NavigatedViewer over basic Viewer** | Bundles ZoomScroll, MoveCanvas, KeyboardMove — scroll-to-zoom and drag-to-pan without custom code |
| **Manual viewport fitting** | Built-in `fit-viewport` produced unreliable results; manual `fitToContainer()` with explicit viewbox is reliable |
| **Client wrapper for SSR boundary** | Next.js 16 App Router can't use `ssr: false` in Server Components; thin wrapper preserves server metadata exports |
| **setTimeout-chain replay** | Matches discrete event-based trace data; speed changes are trivial (divide gap by factor) |
| **Hand-authored traces** | Guarantees consistent demo quality without live API dependency; capture utility exists for replacing with real traces later |
| **CSS markers over SVG manipulation** | `canvas.addMarker()` is the officially supported animation API; all visual states are pure CSS with transitions |
| **Overlay API for annotations** | `overlays.add()` positions HTML relative to diagram nodes; annotations track pan/zoom automatically |

### Files created

| File | Purpose |
|------|---------|
| `public/bpmn/mcp-query-flow.bpmn` | BPMN 2.0 XML: 5-lane MCP query flow process |
| `src/lib/bpmn/traces.ts` | 4 hand-authored traces with realistic SoQL and timing |
| `src/lib/bpmn/node-mapping.ts` | Maps ProgressPhase → BPMN element IDs with cascade delays |
| `src/lib/bpmn/capture-trace.ts` | Dev utility to capture live traces (enable via `NEXT_PUBLIC_CAPTURE_TRACES=true`) |
| `src/hooks/useTraceReplay.ts` | Replay state machine with speed control and dramatic pauses |
| `src/components/about/BpmnViewer.tsx` | bpmn-js NavigatedViewer wrapper with zoom, lane coloring, animation API |
| `src/components/about/bpmn-diagram.css` | CSS markers, overlay cards, zoom controls, responsive rules |
| `src/components/about/TraceControls.tsx` | Trace selector pills, playback controls, speed toggle |
| `src/components/about/DiagramAnnotations.tsx` | Educational text panel |
| `src/components/about/NarrativePanel.tsx` | "What's happening now" panel with lane context |
| `src/components/about/McpFlowDiagram.tsx` | Orchestrator: fullscreen, state sync between replay and viewer |
| `src/components/about/McpFlowDiagramWrapper.tsx` | Client-side dynamic import wrapper |

### Post-commit polish (applied same day)

- **BPMN layout**: Widened lanes to 1200px, right-angle MCP→Socrata routing, better vertical alignment
- **Fullscreen stability**: `100dvh` for mobile chrome, `overflow: hidden`, flex fixes
- **Trace capture integration**: Wired into `useStreamingComparison` — records MCP-panel events, exports JSON on completion
- **Mobile responsive**: Scroll fade hints, 2x2 pill grid at ≤640px, stacked playback controls, fullscreen height fix

### Known issues

- BPMN XML hand-authored — should round-trip through bpmn.io visual modeler
- Overlay cards may clip at extreme zoom levels
- bpmn-js adds ~400KB gzipped (dynamically loaded, About page only)
- 4 `@typescript-eslint/no-explicit-any` suppressions for untyped bpmn-js APIs

### Dependencies added

| Package | Version | Purpose | Bundle Impact |
|---------|---------|---------|---------------|
| `bpmn-js` | ^18.12.0 | BPMN 2.0 diagram rendering | ~400KB gzipped (dynamic, About page only) |

### File dependency graph

```
about/page.tsx
  └── McpFlowDiagramWrapper.tsx (client, dynamic import)
        └── McpFlowDiagram.tsx (orchestrator)
              ├── TraceControls.tsx
              ├── BpmnViewer.tsx ← bpmn-diagram.css
              │     └── fetches /bpmn/mcp-query-flow.bpmn
              ├── NarrativePanel.tsx
              │     └── lib/streaming.ts (getEducationalAnnotation)
              ├── DiagramAnnotations.tsx
              │     └── lib/streaming.ts (getEducationalAnnotation)
              └── hooks/useTraceReplay.ts
                    ├── lib/bpmn/traces.ts
                    └── lib/bpmn/node-mapping.ts
```
