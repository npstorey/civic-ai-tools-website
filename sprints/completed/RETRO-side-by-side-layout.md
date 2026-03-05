# Retrospective: Side-by-Side Live Query Layout

**Sprint:** `SPRINT-side-by-side-layout.md`
**Date:** 2026-02-27

---

## What Went Well

### Split layout implementation was clean
The CSS grid approach (`55fr 45fr` with `transition: grid-template-columns 300ms ease`) worked well. The `showSplit` derived boolean kept the layout logic centralized, and the `fitToView()` call after transitions ensured the BPMN diagram always fit its narrowed container.

### 5-tier slow messaging is user-friendly
The progressive escalation (30s neutral, 60s mild, 90s data-literacy tip, 120s action-oriented, 180s clickable suggestion) provides genuine teaching moments. The tier 5 suggested query pre-fill is a nice UX touch.

### Cancelled state preserves context
Adding `'cancelled'` as a distinct status (rather than resetting to `'idle'`) means the diagram state, partial response, and elapsed time are all preserved. Users can see what happened before they cancelled.

### Course correction landed well
After the initial wrong approach (see below), the second pass reusing the actual `ProgressLog` component produced identical behavior between the home page MCP panel and the About page live query panel.

---

## What Didn't Go Well

### Built a parallel system instead of reusing existing components
The first implementation of streaming progress in LiveResponsePanel built custom progress entry rendering from scratch — a custom `ProgressEntry` type, custom spinner/checkmark icons, and custom phase-colored rendering. This duplicated the existing `ProgressLog` component which already had `StandaloneEntry`, `GroupCard`, and `CompletedSummary` sub-components.

**Root cause:** Started implementing from the plan's description of *what* to show without first reading the home page's `ProgressLog.tsx` and `ResponsePanel.tsx` to understand *how* it was already done.

**Impact:** Wasted a full implementation pass. The custom rendering looked different from the home page and required maintaining two parallel systems.

### useLiveTrace is accumulating too much responsibility
The hook now manages: SSE connection, diagram animation state, progress log accumulation, progress group management, tool call tracking, trace capture, slow message timers, elapsed time, and abort control. The `handleProgressEvent` callback alone replicates ~100 lines of logic from `useStreamingComparison`'s `handleEvent`.

This is a code smell but acceptable for now since the two hooks serve different contexts (dual-panel comparison vs. single-panel live query with BPMN animation).

---

## Lessons / What To Do Differently

### Read the component you're matching before writing code
When told "make X behave like Y," always read Y's implementation first. In this case, reading `ProgressLog.tsx` and `ResponsePanel.tsx` before writing any code would have revealed that importing `ProgressLog` directly was the right approach.

### Prefer importing over reimplementing
If a component already does what you need, import it — don't rebuild it. The `ProgressLog` component was already flexible enough (it accepts `variant`, `isActive`, `isComplete`, `toolsCalled` props) to work in the About page context without modification.

### Export utilities proactively
`generateGroupLabel` had to be exported from `useStreamingComparison.ts` for reuse in `useLiveTrace.ts`. When building utility functions, consider whether they'll be needed elsewhere.

---

## Tech Debt Identified

1. **Duplicated event handling logic** — `handleProgressEvent` in `useLiveTrace` and `handleEvent` in `useStreamingComparison` do the same thing with different state shapes. A shared utility could extract the group-building logic.

2. **`@keyframes blink` defined in two places** — both `ResponsePanel.tsx` (styled-jsx) and `LiveResponsePanel.tsx` define the same blinking cursor animation. Could be moved to `globals.css`.

3. **`@keyframes spin` added to globals.css** — was already defined in some component-level styles. Should audit for duplicates.

---

## Acceptance Criteria Status

All items from the sprint's Definition of Done were met:
- Side-by-side layout with smooth transitions
- Response panel with ProgressLog, markdown, source attribution
- Replay works in split mode (response stays static)
- 5-tier slow query messages with data literacy tips
- Fullscreen preserves split layout
- Clean state transitions across all modes
- Example traces mode unaffected
- Independent panel scrolling
- Mobile guard at 1024px breakpoint (collapses to single column)
