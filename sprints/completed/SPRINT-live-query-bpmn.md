# Sprint Plan: Live Query Mode for BPMN Diagram

**Status:** Complete (Tickets 1-7 shipped; Ticket 8 manual step remaining)
**Prerequisite:** BPMN diagram with pre-recorded trace replay working on About page (done)  
**Estimated effort:** 1–1.5 days  
**Location:** `/about` page (will move to `/explore` in a future sprint)

---

## Overview

Add a "Try your own" mode to the BPMN diagram on the About page. Users type a natural language query, the system runs it against the same SSE backend the home page uses, and the BPMN diagram animates in real time as events arrive. After completion, the trace is automatically captured for instant replay at adjustable speeds.

This is the key prerequisite for the community trace gallery sprint. It also produces the first batch of real captured traces to replace the hand-authored ones.

---

## Architecture

```
User types query on About page
  ↓
Same API endpoint as home page (with-MCP stream only)
  ↓
SSE events arrive in real time
  ↓
Events are:
  1. Fed to BPMN animation system (same mapEventToNodes pipeline)
  2. Simultaneously recorded by capture utility
  ↓
On completion:
  - Final response displayed in compact panel
  - Recorded trace available for instant replay
  - (Future: "Save to gallery" button triggers community gallery flow)
```

---

## Tickets

### 1. Extract Shared SSE Connection Logic

**What:** The home page's `useStreamingComparison` hook contains the SSE connection and event parsing logic. Extract the SSE connection portion into a reusable utility so the About page can use the same backend without duplicating fetch/parse code.

**Implementation:**

Create a shared utility (e.g., `src/lib/sse-client.ts` or similar) that:

- Opens an SSE connection to the with-MCP endpoint given a query, model, and portal
- Parses incoming events into the existing `ProgressLogEntry` type
- Exposes an event callback interface: `onEvent(entry: ProgressLogEntry) => void`
- Exposes a content callback: `onContent(chunk: string) => void`
- Handles connection lifecycle: `onComplete()`, `onError(error: Error)`
- Returns an abort function so the caller can cancel mid-stream

`useStreamingComparison` on the home page should be refactored to use this shared utility internally. Verify the home page still works identically after the refactor.

**Do not:**
- Break the home page's existing behavior
- Change the SSE event format or API endpoint
- Duplicate the connection logic — extract and share it

**Acceptance criteria:**
- [ ] Shared SSE utility exists and is importable from both pages
- [ ] Home page uses the shared utility and behaves identically to before
- [ ] Utility supports an abort/cancel mechanism
- [ ] Utility handles connection errors and timeouts gracefully

---

### 2. Wire Trace Capture Into SSE Event Stream

**What:** The capture utility at `src/lib/bpmn/capture-trace.ts` exists but isn't connected to real event streams. Wire it into the shared SSE utility so every live query automatically records a replayable trace.

**Implementation:**

When a live query starts:
- Create a new capture instance via `createTraceCapture(query, model, portal)`
- On each SSE event, call `capture.recordEvent(event)` in addition to any other processing
- On completion, call `capture.exportTrace()` to get a `PreRecordedTrace` object
- Store the exported trace in component state so it's available for replay and (future) saving

**Also:** Add the `NEXT_PUBLIC_CAPTURE_TRACES=true` env flag integration into `useStreamingComparison` on the home page so developers can capture traces from the main demo too (this was deferred from the previous sprint per the retrospective). When the flag is enabled, log the exported trace JSON to `console.log` after completion with a message: "Trace captured — copy the JSON below to replace hand-authored traces."

**Acceptance criteria:**
- [ ] Every live query on the About page automatically produces a `PreRecordedTrace` object
- [ ] The captured trace has correct `relativeMs` timestamps, phases, args, and durations
- [ ] Home page captures traces to console when `NEXT_PUBLIC_CAPTURE_TRACES=true`
- [ ] Captured traces are valid input for the existing replay system

---

### 3. Build the `useLiveTrace` Hook

**What:** A companion to `useTraceReplay` that handles live mode — events pushed in real time rather than played back from a recording.

**Implementation:**

Create `src/hooks/useLiveTrace.ts`:

```typescript
interface UseLiveTraceOptions {
  onAnimationStep: (steps: AnimationStep[]) => void;  // drives BpmnViewer
  onOverlay: (nodeId: string, content: string) => void;
  onNarrativeUpdate: (narrative: NarrativeState) => void;
}

interface UseLiveTraceReturn {
  status: 'idle' | 'connecting' | 'running' | 'complete' | 'error';
  currentIteration: number;
  elapsedMs: number;
  responseContent: string;           // accumulated markdown response
  capturedTrace: PreRecordedTrace | null;  // available after completion
  error: string | null;
  start: (query: string, model: string, portal: string) => void;
  cancel: () => void;
}
```

**Behavior:**
- `start()` opens the SSE connection via the shared utility from Ticket 1
- Each incoming event is mapped through `mapEventToNodes()` from `node-mapping.ts` — same function the replay system uses
- Animation steps are dispatched to the BpmnViewer with the same cascade timing as replay mode (800ms cross-lane delays, hold times at gateway, etc.)
- Events are simultaneously recorded via the capture utility from Ticket 2
- An `elapsedMs` counter ticks every second for the UI to display
- `cancel()` aborts the SSE connection and stops animation, preserving current diagram state
- On completion: status transitions to `'complete'`, `capturedTrace` is populated, `responseContent` contains the full markdown response

**The animation pipeline must be identical to replay.** Use the same `mapEventToNodes` function, the same cascade delays, the same overlay content generation. The only difference is events arrive from SSE instead of from a pre-recorded array. If the current animation logic is tightly coupled to the replay hook's setTimeout chain, extract the animation-step-execution logic into a shared function that both hooks call.

**Acceptance criteria:**
- [ ] Hook opens SSE connection and receives events
- [ ] BPMN diagram animates identically to replay mode (same timing, same overlays, same markers)
- [ ] Iteration counter increments correctly
- [ ] Elapsed timer updates in real time
- [ ] Cancel aborts cleanly without broken diagram state
- [ ] Captured trace is available after completion
- [ ] Error states are handled (connection failure, timeout, rate limit)

---

### 4. Add "Try Your Own" Tab to TraceControls

**What:** Add a mode toggle to the trace controls UI so users can switch between example traces and live queries.

**Implementation:**

Add a tab/segmented control above the current trace selector pills with two options:

- **"Example traces"** (default) — shows the 4 pre-recorded trace pills and replay controls exactly as they work now. No changes to existing behavior.
- **"Try your own"** — replaces the trace pills with:
  - A text input field (placeholder: "Ask a question about NYC open data...")
  - A "Run" button styled consistently with the site's primary button
  - Model and portal selectors if easy to reuse from the home page, otherwise hardcode to the default model and "New York City" portal
  - A note below the input: "Uses one of your daily queries. For a full side-by-side comparison, use the main demo."

**State transitions in "Try your own" mode:**

Idle state:
- Input enabled, Run button enabled
- Diagram shows default (no markers, no overlays) or last completed state

Running state:
- Input disabled, Run button becomes "Cancel" button
- Show: "Running live..." with a subtle pulse animation, current iteration number, elapsed time
- Hide play/pause/speed controls (they don't apply to live queries)
- Diagram animates in real time

Complete state:
- Input re-enabled for another query
- Show: "✓ Complete" with elapsed time and tool call count
- Show "Replay" button + speed controls (1x/2x/4x) — clicking Replay plays back the just-captured trace through the existing replay system
- Show compact response panel (see Ticket 5)

Error state:
- Show error message inline (rate limit, connection failure, etc.)
- "Retry" button that re-submits the same query
- Input re-enabled

**Acceptance criteria:**
- [ ] Tab toggle switches between example traces and live query input
- [ ] Example traces mode is completely unchanged
- [ ] Input field and Run button render in "Try your own" mode
- [ ] State transitions (idle → running → complete) update the controls correctly
- [ ] Cancel button aborts the query and returns to idle state
- [ ] After completion, Replay button loads captured trace into the existing replay system

---

### 5. Compact Response Panel

**What:** After a live query completes, show the AI's response below the BPMN diagram in a compact format. The diagram is the star — the response is supplementary.

**Implementation:**

Below the diagram (and above the educational annotations), render a collapsible response panel:

- **Header line:** Tool summary stats — "5 queries · 83,755 records · 12.4s" (reuse the same summary generation logic from the home page)
- **Source attribution:** "Source: NYC Open Data · Restaurant Inspections (43nn-pn8j)"
- **Response preview:** First ~150 words of the markdown response, rendered, with a "Show full response →" toggle that expands to the complete response
- **Collapsed by default** after the first time the user reads it — if they run a second query, it starts collapsed with the new summary line visible

**Do not** replicate the full home page response UI (no side-by-side, no without-MCP panel, no progress log). Keep it minimal — the BPMN diagram already showed the process.

**Acceptance criteria:**
- [ ] Response panel appears after live query completion
- [ ] Summary stats line shows tool call count, record count, total time
- [ ] Source attribution shows dataset name and ID
- [ ] Response preview truncates to ~150 words with expand toggle
- [ ] Panel is visually subordinate to the BPMN diagram (smaller, lighter weight)

---

### 6. Post-Completion Replay from Captured Trace

**What:** After a live query completes, the user can replay it at adjustable speeds through the existing replay system.

**Implementation:**

When the user clicks "Replay" after a live query:
- Take the `capturedTrace` from the `useLiveTrace` hook
- Load it into the existing `useTraceReplay` hook
- Switch the controls back to replay mode: show play/pause, speed toggle (1x/2x/4x), reset, progress bar
- The BPMN diagram resets and replays from the beginning using the captured trace

This should require minimal new code — the captured trace is already a `PreRecordedTrace` object, and the replay system already accepts those. The wiring is: capture completes → store trace → user clicks Replay → pass trace to `useTraceReplay` → existing animation plays.

**Acceptance criteria:**
- [ ] Replay button appears after live query completion
- [ ] Clicking Replay resets diagram and plays back the captured trace
- [ ] Speed controls (1x/2x/4x) work during replay of captured traces
- [ ] User can switch back to "Example traces" tab and return without losing the captured trace
- [ ] Replayed captured traces look identical to replayed example traces

---

### 7. Rate Limit and Error Handling

**What:** Handle rate limits, connection failures, and edge cases gracefully.

**Implementation:**

**Rate limits:**
- If the API returns a rate limit error (429), show in the input area: "Daily query limit reached. Try the example traces below, or sign in with GitHub for more queries."
- Don't break the diagram state — it should still show the last completed trace or the default state
- The "Example traces" tab should always work regardless of rate limit status

**Connection errors:**
- If the SSE connection drops mid-query: show "Connection lost" with a "Retry" button
- Preserve whatever animation state has been reached (completed nodes stay completed) so the user can see how far the query got before failure
- The captured trace up to the failure point should be available (partial trace)

**Slow queries:**
- If a query exceeds 30 seconds, show a subtle "This is taking longer than usual..." message below the input but don't auto-cancel
- If it exceeds 90 seconds, show "This query is very complex. You can keep waiting or cancel and try a simpler question." with the Cancel button prominent

**Empty/invalid input:**
- Disable the Run button when input is empty
- Don't validate query content beyond empty check — let the backend handle it

**Acceptance criteria:**
- [ ] Rate limit errors show a friendly message and don't break the diagram
- [ ] Connection drops preserve partial diagram state and offer retry
- [ ] Slow query messaging appears at 30s and 90s thresholds
- [ ] Empty input disables the Run button
- [ ] All error states allow recovery (retry, new query, or switch to example traces)

---

### 8. Replace Hand-Authored Traces with Real Captures

**What:** After the live query feature works, use it to capture real traces and replace the hand-authored ones.

**Implementation:**

This is a manual step, not code:

1. Enable `NEXT_PUBLIC_CAPTURE_TRACES=true` in your dev environment
2. Run these 4 queries on the home page and copy the trace JSON from console:
   - "Most common 311 complaints in NYC" (simple, 2-3 tool calls)
   - "Compare restaurant inspection violations across boroughs" (multi-step, 5+ tool calls)
   - "Noise complaints in Brooklyn in 2024" (filtered, 3-4 tool calls with WHERE)
   - A query that triggers iteration/retry — try "How do housing violations in Brooklyn compare to Manhattan?" or "What are the most dangerous restaurants in Queens?" **Watch for a trace where the AI queries, reads results, decides to query differently, and loops back. This loop-back is the most important thing to capture.**
3. Replace the corresponding hand-authored traces in `src/lib/bpmn/traces.ts` with the real captured data
4. Update `chipLabel`, `title`, and `responseSummary` fields to match the real queries
5. Verify all 4 traces replay correctly in the BPMN diagram with the real timing and SoQL

**Keep the hand-authored traces in a comment block or a separate file as fallbacks** in case the real traces reveal edge cases in the animation system.

**Acceptance criteria:**
- [ ] All 4 example traces are real captured data from actual API calls
- [ ] At least one trace clearly shows a loop-back (thinking phase between tool call cycles)
- [ ] All traces replay correctly with real timing (no animation glitches from unusual timing gaps)
- [ ] Hand-authored traces are preserved as fallbacks

---

## Implementation Order

```
Ticket 1: Extract shared SSE utility
  ↓ (home page still works)
Ticket 2: Wire capture utility into SSE stream
  ↓ (can capture traces from home page)
Ticket 3: Build useLiveTrace hook
  ↓ (core engine works)
Ticket 4: Add "Try your own" tab UI
  ↓ (user can type and run queries)
Ticket 5: Compact response panel
Ticket 6: Post-completion replay
Ticket 7: Error handling
  ↓ (feature complete)
Ticket 8: Replace hand-authored traces (manual step)
```

Tickets 5, 6, and 7 can be done in any order after Ticket 4. Ticket 8 is a manual task done after everything else works.

---

## Out of Scope (Deferred to Community Gallery Sprint)

- Moving the BPMN diagram to `/explore`
- "Save to gallery" button
- Community trace gallery UI
- GitHub authentication for saving
- Moderation and blocklist
- Navigation restructuring

---

## Definition of Done

- [x] A user can type a query on the About page and watch the BPMN diagram animate with real SSE events
- [x] The animation quality (timing, overlays, narrative panel) is identical to pre-recorded replay
- [x] After completion, the user can replay their query at 1x/2x/4x speed
- [x] A compact response with source attribution appears after completion
- [x] Rate limits, connection errors, and slow queries are handled gracefully
- [x] Example traces still work exactly as before (no regressions)
- [ ] All 4 example traces are replaced with real captured data (Ticket 8 — manual step)

---

## Retrospective

### What went well
- **Clean extraction pattern**: Pulling `animation.ts` out of `useTraceReplay` and having both hooks import from the same source guarantees identical animation behavior between live and replay. Zero drift risk.
- **SSE client reuse**: `connectSSE()` replaced ~70 lines of fetch/reader/buffer code in `useStreamingComparison` and was immediately reusable in `useLiveTrace`. Two consumers, one parser.
- **Backward compatibility**: `mcpOnly` defaults to `false` so the home page request shape is unchanged. `useTraceReplay` re-exports types so `DiagramAnnotations` and `NarrativePanel` imports didn't need touching.
- **Build stability**: Only one type error on first build (`string` vs `ProgressPhase` cast). Fixed in under a minute.

### What could be better
- **TraceControls grew large** (~300 lines of inline-styled JSX handling 5 distinct UI states). A future pass could extract `LiveControls` as a sub-component.
- **No integration test coverage** — manually verified only. The SSE client and animation transforms are pure functions that would be easy to unit test.
- **Hardcoded model/portal** — live mode uses `claude-sonnet-4` and NYC. Fine for now, but portal selection would need UI work in TraceControls.
- **Replay trigger timing** — `handleLiveReplay` sets `liveReplayTrace` then calls `play()` after a 100ms timeout to let `useTraceReplay` reset from the trace ID change. Works, but a more explicit "ready" signal would be cleaner.

### Stats
| | |
|---|---|
| New files | 4 (`sse-client.ts`, `animation.ts`, `useLiveTrace.ts`, `LiveResponsePanel.tsx`) |
| Modified files | 6 |
| Lines changed | +659 / -409 |
| Build errors | 1 (fixed immediately) |
| Tickets shipped | 1, 2, 3, 4, 5, 6, 7 |

### Open items
- **Ticket 8**: Run 4 queries with `NEXT_PUBLIC_CAPTURE_TRACES=true`, copy JSON from console, replace hand-authored traces in `traces.ts`
- Style polish after testing — tab spacing, mobile behavior, fullscreen layout with response panel
- Could add suggested-queries dropdown to the live input to lower friction
