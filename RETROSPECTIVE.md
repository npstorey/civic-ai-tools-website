# Retrospectives

Reverse-chronological session retros for the civic-ai-tools-website project.

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
