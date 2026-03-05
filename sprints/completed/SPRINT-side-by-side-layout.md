# Sprint Plan: Side-by-Side Live Query Layout

**Status:** Ready to start
**Prerequisite:** Live query mode on About page working (done)
**Estimated effort:** 1 day
**Location:** `/about` page, "Try your own" tab

---

## Overview

Restructure the live query view from a vertical stack (diagram above, response below) to a horizontal split layout. Users watch the BPMN process on the left while the response streams on the right — process and outcome visible simultaneously. This replaces the current pattern where users must scroll past the diagram to read results.

The side-by-side layout only activates in "Try your own" mode during and after a live query. "Example traces" mode retains the current full-width diagram layout.

---

## Current State (from live-query-bpmn sprint)

Key files already in place:

| File | What it does now |
|------|-----------------|
| `src/components/about/McpFlowDiagram.tsx` | Dual-mode orchestration: derives `activeState` from `useTraceReplay` or `useLiveTrace`, syncs to BpmnViewer. Currently renders diagram, narrative, and LiveResponsePanel in a vertical stack. |
| `src/components/about/TraceControls.tsx` | Mode tabs (examples/live), live query input, running/complete/error/replay states. **Replay controls already live here** (play/pause, speed 1x/2x/4x, "New query" button). |
| `src/components/about/LiveResponsePanel.tsx` | **Already exists** — minimal: shows elapsed time, iteration count, plain-text response with truncation/expand toggle, NYC Open Data attribution. No markdown rendering, no tool summary, no breadcrumb pills. |
| `src/hooks/useLiveTrace.ts` | Returns `{ state, status, currentIteration, elapsedMs, responseContent, capturedTrace, error, slowMessage, start, cancel, reset }`. Status is `'idle' \| 'running' \| 'complete' \| 'error'` (no `'connecting'` state). |
| `src/components/about/BpmnViewer.tsx` | `BpmnViewerHandle` exposes: `activateNode`, `completeNode`, `activateEdge`, `highlightEdge`, `showOverlay`, `clearOverlays`, `resetAll`, **`fitToView()`**. There is no `fitToContainer()` on the handle — always use `fitToView()`. |

---

## Target Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Example traces  |  Try your own                                     │
│  [query input field                                       ] [Run]    │
│  33s elapsed  ━━━━━━━━━━━━━━━━━━━░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
│  Still working — the AI is iterating through the data...             │
├─────────────────────────────────┬────────────────────────────────────┤
│                                 │                                    │
│         BPMN DIAGRAM            │       RESPONSE PANEL               │
│                                 │                                    │
│   (animated live, with          │   (streaming markdown,             │
│    zoom/pan controls,           │    tool summary, source            │
│    overlays showing SoQL)       │    attribution, breadcrumb         │
│                                 │    pills when complete)            │
│                                 │                                    │
├─────────────────────────────────┴────────────────────────────────────┤
│  NARRATIVE PANEL (full width below both panels)                      │
│  🏛 NYC OPEN DATA — The AI has constructed a structured query...     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Tickets

### 1. Create the Split Layout Container

**What:** Build a layout component that switches between full-width (example traces) and side-by-side (live query) depending on mode and query state.

**Implementation:**

In `McpFlowDiagram.tsx`, add a container that responds to the current mode:

- **Example traces mode OR "Try your own" idle state:** Full-width single column, diagram takes 100% width. Exactly as it works now — no changes.
- **"Try your own" running or complete state:** Horizontal split layout.

CSS approach — use CSS grid:

```css
/* Full-width mode (default) */
.diagram-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
}

/* Split mode (active during live query) */
.diagram-layout.split {
  grid-template-columns: 55fr 45fr;  /* slightly favor the diagram */
  gap: 16px;
}
```

The 55/45 split gives the diagram a bit more room since it needs horizontal space for the swim lanes. The response panel is mostly vertical text so it works well narrower.

**Transition animation:**
- When the query starts and the layout splits, animate over ~300ms
- Use `transition: grid-template-columns 300ms ease` on the container
- The response panel fades in: `opacity: 0 → 1` over 300ms, starting after the grid transition begins

**Both panels must have independent vertical scrolling:**
- Left panel (diagram): `overflow: hidden` — bpmn-js handles zoom/pan internally via canvas transforms, native scroll would conflict
- Right panel (response): `overflow-y: auto` — response content will often exceed viewport height
- Both panels need a defined height — calculate from viewport: `height: calc(100vh - [controls height] - [narrative panel height] - [header height])` or use flex with `min-height: 0`

**After layout transition, call `viewerRef.current?.fitToView()`** (with a ~300ms delay to let the grid transition complete) so the diagram re-fits to the narrower left panel.

**Acceptance criteria:**
- [ ] Example traces mode shows full-width diagram (no layout change)
- [ ] "Try your own" idle state shows full-width diagram (no layout change)
- [ ] Running a query transitions to side-by-side layout with animation
- [ ] Both panels have correct independent scrolling behavior
- [ ] Grid columns don't collapse or overlap at reasonable viewport widths (1024px+)
- [ ] `fitToView()` is called after the grid transition so the diagram re-fits

---

### 2. Extend LiveResponsePanel for Side-by-Side Use

**What:** Upgrade the existing `LiveResponsePanel.tsx` from a minimal plain-text card into a streaming markdown panel with tool summary, source attribution, and breadcrumb pills.

**Current state:** `LiveResponsePanel.tsx` already exists with: elapsed time, iteration count, plain-text content with truncation, and a simple attribution footer. It uses `whiteSpace: 'pre-wrap'` — no markdown rendering.

**Implementation:**

Replace the plain-text rendering with `react-markdown` + `remark-gfm` (already installed — used by `ResponsePanel.tsx` on the home page). The home page renders markdown inline:
```typescript
// from src/components/ResponsePanel.tsx
<div className="response-markdown">
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
</div>
```

Reuse the same pattern and CSS class `response-markdown` for consistent styling.

**During streaming (query running):**
- Header: "Response" with a subtle spinner
- Streaming markdown content rendered as it arrives
- No progress log — the BPMN diagram handles step visualization
- Light top border or subtle background to separate from diagram panel

**After completion:**
- Tool summary line at the top: "5 queries · 83,755 records · 12.4s" — compute from `capturedTrace.events` (count `tool_start` phases, sum `tool_result` `resultSummary.rows`, use `elapsedMs`)
- Source attribution: "Source: NYC Open Data · 311 Service Requests (erm2-nwe9)" — extract dataset IDs from `tool_start` events' args, map through `getDatasetName()` and `getPortalCity()` from `src/lib/streaming.ts`
- Breadcrumb pills showing the query workflow — see note below
- Full rendered markdown response, scrollable
- Remove the truncation/expand toggle (no longer needed when the panel has its own scroll area in the side-by-side layout)

**Breadcrumb pills:** There is **no dedicated breadcrumb component** to reuse. The home page renders them inline in `ProgressLog.tsx` (lines ~367-396). Options:
1. **Extract a shared `BreadcrumbPills` component** from `ProgressLog.tsx` and use it in both places (cleaner, more work)
2. **Duplicate the ~30 lines of pill rendering** in `LiveResponsePanel` (faster, acceptable for now)

Labels come from `buildBreadcrumbLabel()` in `src/lib/streaming.ts`. Build the breadcrumb data from `capturedTrace.events`: filter to `tool_start` phases, map each through `buildBreadcrumbLabel({ name: 'get_data', args: event.args })`.

**Replay controls:** Already implemented in `TraceControls.tsx` (shared controls bar above both panels). Do **not** add duplicate replay controls in the response panel.

**Acceptance criteria:**
- [ ] Panel shows streaming markdown during query execution (using react-markdown + remark-gfm)
- [ ] Tool summary, source attribution, and breadcrumb pills appear after completion
- [ ] Markdown renders identically to the home page (same `response-markdown` class and renderer)
- [ ] Panel scrolls independently when content exceeds viewport height
- [ ] No duplicate replay controls (they remain in TraceControls)

---

### 3. Connect Response Panel to Live Trace Data

**What:** Wire the `useLiveTrace` hook's output into the upgraded response panel so content streams in real time and metadata appears after completion.

**Implementation:**

The `useLiveTrace` hook already provides:
- `responseContent: string` — accumulated markdown response (streams in via `onEvent` for `token` type)
- `status: 'idle' | 'running' | 'complete' | 'error'` (note: no `'connecting'` state)
- `capturedTrace: PreRecordedTrace | null` — available after completion
- `elapsedMs: number`
- `currentIteration: number`

**Tool call metadata** — compute from `capturedTrace.events` after completion (no need to accumulate incrementally in the hook):

```typescript
function computeQueryMeta(trace: PreRecordedTrace): {
  toolCallCount: number;
  totalRecords: number;
  datasets: { id: string; name: string }[];
  portal: string;
} {
  const toolStarts = trace.events.filter(e => e.phase === 'tool_start');
  const toolResults = trace.events.filter(e => e.phase === 'tool_result');
  const totalRecords = toolResults.reduce((sum, e) => sum + (e.resultSummary?.rows ?? 0), 0);
  const datasetIds = [...new Set(toolStarts.map(e => e.args?.dataset_id as string).filter(Boolean))];
  const datasets = datasetIds.map(id => ({ id, name: getDatasetName(id) }));
  const portal = (toolStarts[0]?.args?.portal as string) ?? trace.portal;
  return { toolCallCount: toolStarts.length, totalRecords, datasets, portal };
}
```

This can live in `LiveResponsePanel.tsx` or a utility — it's a pure function over the trace data.

**Breadcrumb pills** — also from `capturedTrace.events`:
```typescript
const breadcrumbs = toolStarts.map((event, i) => ({
  label: buildBreadcrumbLabel(
    { name: 'get_data', args: event.args ?? {} },
    toolStarts.map(e => ({ name: 'get_data', args: e.args ?? {} })),
    i,
  ),
  args: event.args,
}));
```

**Props to pass from McpFlowDiagram → LiveResponsePanel:**
- `content: liveTrace.responseContent`
- `isComplete: liveTrace.status === 'complete'`
- `isRunning: liveTrace.status === 'running'`
- `elapsedMs: liveTrace.elapsedMs`
- `capturedTrace: liveTrace.capturedTrace`

**Acceptance criteria:**
- [ ] Response content streams into the panel in real time as markdown arrives
- [ ] Tool summary line shows accurate counts (tool calls, records, time) after completion
- [ ] Source attribution shows correct dataset name, ID, and portal city
- [ ] Breadcrumb pills render with correct labels after completion
- [ ] All metadata is derived from `capturedTrace.events`, not hardcoded

---

### 4. Handle Replay Mode in Side-by-Side Layout

**What:** After a live query completes, the user can replay the captured trace. The response panel should show the completed response while the BPMN diagram replays the animation.

**Implementation:**

Replay is **already wired** via `TraceControls`:
- "Replay" button calls `onLiveReplay` → `McpFlowDiagram.handleLiveReplay()` → sets `liveReplayTrace` + `isReplayingCapture` → `useTraceReplay(liveReplayTrace)` drives the diagram
- Speed controls (1x/2x/4x) already work via `onSetSpeed`
- "New query" button resets everything

The only new work for side-by-side is:
1. **Keep the response panel visible and static during replay** — it currently unmounts when `isReplayingCapture` is true (see `McpFlowDiagram.tsx` line ~233: the LiveResponsePanel only shows when `!isReplayingCapture`). Change this: show the panel with the completed response during replay too.
2. **Keep the side-by-side layout active during replay** — don't collapse to full-width.
3. Call `fitToView()` if the layout was full-width before replay starts.

**When replay finishes or is reset:**
- Controls return to the post-completion state (Replay button visible, speed toggle visible)
- Diagram shows all-completed markers

**If the user starts a new query while replay is in progress:**
- Already handled: `handleLiveStart()` resets `isReplayingCapture` and calls `liveTrace.start()`

**Acceptance criteria:**
- [ ] Replay button triggers BPMN replay of the captured trace (already works)
- [ ] Response panel stays visible and static during replay (new)
- [ ] Side-by-side layout is maintained during replay (new)
- [ ] Speed controls (1x/2x/4x) work during replay (already works)
- [ ] Narrative panel updates during replay (already works)
- [ ] Starting a new query cancels any in-progress replay (already works)

---

### 5. Improve Slow Query Messaging with Data Literacy Tips

**What:** Replace generic slow query messages with context-aware messages that teach data literacy concepts — specifically, the relationship between query specificity and performance.

**Current state:** `useLiveTrace.ts` already has two thresholds:
- 30s: "Still working — the AI is iterating through the data..."
- 90s: "This is taking longer than usual. Complex queries can take 1-2 minutes."

**Implementation:**

Expand to a 5-tier progressive sequence:

| Threshold | Message | Style |
|-----------|---------|-------|
| 30s | "Still working — the AI is iterating through the data..." | neutral (gray, italic) |
| 60s | "This is taking longer than usual. Large datasets without date filters can be slow." | mild warning (amber) |
| 90s | "Tip: adding a year (like 'in 2024') narrows the data and speeds things up significantly." | helpful tip (blue info) |
| 120s | "This is a very large query. You can keep waiting or cancel and try a more specific question." | action-oriented (prominent) |
| 180s | "This query has been running for 3 minutes. Consider canceling and trying something like: '[original query] in 2024'" | action + clickable suggestion |

The 180s message should include a concrete suggestion derived from the user's actual query — append "in 2024" to their original query text as a clickable element that pre-fills the input.

**Where to update:**
- Threshold logic: `useLiveTrace.ts` (the `setInterval` timer that sets `slowMessage`)
- Message rendering: `TraceControls.tsx` (the `liveSlowMessage` display in the running state)
- For the clickable suggestion at 180s, `useLiveTrace` could expose `suggestedQuery: string | null` or `TraceControls` could derive it from the original query prop

**Also:** In the response panel (side-by-side layout), show "Waiting for data..." while `status === 'running'` and `responseContent` is still empty.

**Acceptance criteria:**
- [ ] Messages escalate progressively at 30s, 60s, 90s, 120s, 180s thresholds
- [ ] The 90s message teaches about date filters specifically
- [ ] The 180s message includes a clickable query suggestion based on the user's original query
- [ ] Messages have escalating visual prominence
- [ ] Response panel shows a "Waiting for data..." placeholder during long queries

---

### 6. Fullscreen Mode for Side-by-Side Layout

**What:** Fullscreen mode should show the same side-by-side layout when a live query is running or complete, giving both panels more room.

**Current state:** Fullscreen is toggled via `isFullscreen` state in `McpFlowDiagram.tsx`. When true, it renders a fixed-position overlay with `flex-direction: column`. The existing `useEffect` calls `viewerRef.current?.fitToView()` with a 150ms delay when `isFullscreen` changes.

**Implementation:**

When entering fullscreen during a live query or with completed results:
- Maintain the side-by-side grid layout
- Both panels expand to fill the available viewport
- Call `fitToView()` after transition (existing effect handles this, but may need the delay increased to ~350ms to account for the grid transition)
- Response panel gets more height for comfortable reading
- Controls, progress bar, and status messages stay pinned above the split panels
- Narrative panel stays pinned below

When entering fullscreen from example traces mode:
- Keep current behavior — full-width diagram, no split

The fullscreen container flex layout should wrap the side-by-side grid:
```
flex-direction: column:
  - TraceControls (flex-shrink: 0)
  - Split grid container (flex: 1, min-height: 0)
      - Left: BPMN diagram
      - Right: Response panel (overflow-y: auto)
  - Narrative panel (flex-shrink: 0)
```

**Acceptance criteria:**
- [ ] Fullscreen with live query shows side-by-side layout
- [ ] Fullscreen with example traces shows full-width diagram (no change)
- [ ] Diagram re-fits via `fitToView()` on fullscreen enter/exit
- [ ] Response panel scrolls independently in fullscreen
- [ ] All controls remain accessible in fullscreen

---

### 7. Transition State: Idle → Running → Complete

**What:** Define and implement clean transitions between layout states so nothing feels jarring.

**Implementation:**

**State: Idle** (user hasn't run a query yet, or has reset)
- Full-width diagram, no response panel
- Diagram shows default state (no markers) or last example trace final state
- Input field enabled, Run button enabled

**State: Idle → Running** (user clicks Run)
- Layout animates from full-width to side-by-side over 300ms
- Diagram narrows, `fitToView()` called after transition (~350ms delay)
- Response panel fades in with "Waiting for AI response..." placeholder
- Input disabled, Run becomes Cancel (already implemented in TraceControls)
- Progress bar and status message appear (already implemented in TraceControls)

**State: Running** (SSE events arriving)
- BPMN diagram animates on the left
- Response streams on the right
- Progress bar advances
- Narrative panel updates below

**State: Running → Complete** (synthesize phase finishes)
- Status changes to "Complete in Xs" (already implemented in TraceControls)
- Response panel shows final content with summary, attribution, breadcrumbs
- Replay button appears (already in TraceControls)
- Input re-enabled for another query

**State: Complete → Replay** (user clicks Replay)
- Diagram resets and replays (already wired)
- Response panel stays static (new — see Ticket 4)
- Speed controls active (already in TraceControls)

**State: Complete → New Query** (user types and runs another query)
- Diagram resets
- Response panel clears and shows placeholder
- Full cycle restarts (stays in split layout, doesn't collapse back to full-width)

**State: Running → Cancel** (user clicks Cancel)
- SSE connection aborts (already implemented)
- Diagram preserves current state (already implemented)
- Response panel shows whatever content had streamed so far
- Status shows "Canceled" with option to modify query
- Layout stays split (don't collapse back — the partial results are still useful)

**State: Any → Switch to Example Traces tab**
- Layout collapses back to full-width
- Response panel unmounts
- Diagram resets to default or loads selected example trace (already implemented in `handleModeChange`)

**Acceptance criteria:**
- [ ] All state transitions are smooth (no layout jumps, no flash of empty content)
- [ ] Canceling preserves partial results (both diagram state and response content)
- [ ] Running a second query in sequence doesn't collapse and re-expand the layout
- [ ] Switching to Example Traces tab cleanly returns to full-width layout
- [ ] `fitToView()` is called after every layout width change

---

## Implementation Order

```
Ticket 1: Split layout container
  ↓ (layout works, panels are positioned)
Ticket 2: Extend LiveResponsePanel
  ↓ (panel renders markdown, summary, breadcrumbs)
Ticket 3: Wire to live trace data
  ↓ (content streams in real time, metadata computed)
Ticket 7: State transitions
  ↓ (clean transitions between all states)
Ticket 4: Replay in side-by-side
Ticket 5: Slow query messaging
Ticket 6: Fullscreen for side-by-side
```

Tickets 4, 5, and 6 can be done in any order after Ticket 7. Ticket 5 is the quickest win — it's mostly copy changes.

---

## Out of Scope

- Mobile/responsive layout for the side-by-side view (desktop only for now)
- Moving the feature to `/explore` (future sprint)
- Community trace gallery / save button (future sprint)
- Skill prompt tuning for date range guidance (separate backlog item)
- Without-MCP panel or comparison mode (that's the home page's job)

---

## Definition of Done

- [ ] Running a live query shows BPMN diagram on the left and streaming response on the right simultaneously
- [ ] The side-by-side layout transitions smoothly from the full-width idle state
- [ ] Response panel shows tool summary, source attribution, and breadcrumb pills after completion
- [ ] Replay works in side-by-side mode (diagram replays, response stays static)
- [ ] Slow query messages teach about date filters and query specificity
- [ ] Fullscreen mode preserves the side-by-side layout
- [ ] All state transitions (idle → running → complete → replay → new query → cancel) are clean
- [ ] Example traces mode is completely unaffected (no regressions)
- [ ] Independent scrolling works on both panels
