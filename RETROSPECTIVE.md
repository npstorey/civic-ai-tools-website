# Retrospective: Live BPMN Diagram for MCP Query Visualization

**Date:** 2026-02-27
**Scope:** Implementation and polish of an interactive BPMN 2.0 diagram on the About page (`/about`) that animates pre-recorded MCP query traces through the system architecture.

---

## 1. Changes Made

### Files Created (11)

| File | Purpose | State |
|------|---------|-------|
| `public/bpmn/mcp-query-flow.bpmn` | BPMN 2.0 XML defining the 5-lane MCP query flow process | Complete |
| `src/lib/bpmn/traces.ts` | 4 hand-authored traces with realistic SoQL, dataset IDs, and timing | Complete |
| `src/lib/bpmn/node-mapping.ts` | Maps SSE `ProgressPhase` to BPMN element IDs with cascade delays and hold times | Complete |
| `src/lib/bpmn/capture-trace.ts` | Dev-only utility to capture live traces from SSE stream (activate via `NEXT_PUBLIC_CAPTURE_TRACES=true`) | Complete |
| `src/hooks/useTraceReplay.ts` | Replay state machine hook with speed control, minimum gaps, dramatic pauses | Complete |
| `src/components/about/BpmnViewer.tsx` | bpmn-js `NavigatedViewer` wrapper with zoom controls, lane coloring, animation API | Complete |
| `src/components/about/bpmn-diagram.css` | CSS markers (active/completed/loop-back/success), overlay cards, zoom controls | Complete |
| `src/components/about/TraceControls.tsx` | Trace selector pills, play/pause/reset, speed toggle, progress bar | Complete |
| `src/components/about/DiagramAnnotations.tsx` | Educational text panel with cross-references to #system-prompt and #narration | Complete |
| `src/components/about/NarrativePanel.tsx` | Plain-language "what's happening now" panel with lane context and emoji icons | Complete |
| `src/components/about/McpFlowDiagram.tsx` | Orchestrating wrapper: fullscreen mode, state sync between replay hook and viewer | Complete |
| `src/components/about/McpFlowDiagramWrapper.tsx` | Client-side dynamic import wrapper (required because Next.js 16 server components can't use `ssr: false`) | Complete |

### Files Modified (3)

| File | Changes |
|------|---------|
| `src/app/about/page.tsx` | Replaced static FlowBox/FlowArrow diagram with `<McpFlowDiagramWrapper />`; removed FlowBox/FlowArrow helper components (~40 lines) |
| `src/app/globals.css` | Added `@keyframes bpmn-pulse` (active node glow), `@keyframes bpmn-fullscreen-in` (scale+opacity transition) |
| `package.json` | Added `bpmn-js` dependency |

### Post-Commit Changes (Uncommitted)

The following work was done after the initial commit (`cd86f6b`) and is not yet committed.

#### BPMN Layout Improvements (`public/bpmn/mcp-query-flow.bpmn`)

Improved the hand-authored XML coordinates to address spacing and alignment issues flagged in the initial retro:
- Widened all lanes from 1080px to 1200px for more breathing room
- Increased AI Model lane height from 200px to 220px to give the loop-back flow more headroom
- Adjusted all task and event positions for better vertical alignment across lanes
- Changed MCP→Socrata message flow from a diagonal line to right-angle routing (horizontal then vertical) for readability
- Aligned Socrata task center with AI "Results Return" task for cleaner vertical flow
- Bumped exporter version from 1.0 to 1.1
- Added descriptive XML comments for each layout section

#### Fullscreen Stability Fixes (`McpFlowDiagram.tsx`, `BpmnViewer.tsx`)

Several fixes to make fullscreen mode robust, especially on mobile:
- Wrapped `TraceControls` and `NarrativePanel` in `flexShrink: 0` divs so they hold their size when the diagram flexes to fill available space
- Changed fullscreen container from `right: 0; bottom: 0` to `width: 100vw; height: 100dvh` — `100dvh` handles mobile browser chrome (address bar) correctly
- Added `overflow: hidden` on the fullscreen container to prevent content spill
- Made `minHeight: 0` conditional on fullscreen mode only (prevents flex layout issues in the diagram's flex child)
- Added `height: isFullscreen ? '100%' : undefined` on the BpmnViewer wrapper div and a `bpmn-container-wrapper` / `bpmn-fullscreen` className for CSS targeting

#### Trace Capture Integration (`useStreamingComparison.ts`)

Wired the `capture-trace.ts` dev utility into the streaming comparison hook — previously flagged as deferred Step 12:
- On comparison start, if `NEXT_PUBLIC_CAPTURE_TRACES=true`, creates a `createTraceCapture()` instance
- Records all MCP-panel `progress` events (phase, message, iteration, args, duration_ms)
- On MCP-panel `complete` event, exports the full trace JSON to console with instructions to copy into `src/lib/bpmn/traces.ts`
- Cleans up the capture ref after export

#### Mobile Polish (`bpmn-diagram.css`, `TraceControls.tsx`, `BpmnViewer.tsx`)

Implemented the responsive improvements flagged as deferred Step 13:

**CSS changes (`bpmn-diagram.css`):**
- **≤768px — Fullscreen height fix**: Added `.bpmn-fullscreen .bpmn-container { height: 100% !important }` to override the existing `400px !important` rule that was clobbering fullscreen on mobile
- **≤768px — Scroll fade hints**: Left/right 24px white-to-transparent gradient pseudo-elements on `.bpmn-container-wrapper`, scoped to `:not(.bpmn-fullscreen)` so they don't appear in fullscreen
- **≤640px — 2x2 pill grid**: `.trace-pills` switches from flex to `grid` with `grid-template-columns: 1fr 1fr`; `.trace-pill` gets `width: 100%` and `text-align: center`
- **≤640px — Stacked playback controls**: `.playback-bar` gets `flex-wrap: wrap`; `.speed-selector` gets `margin-left: 0` and `width: 100%` to drop to a second row

**Component className hooks:**
- `TraceControls.tsx`: Added `className` on 4 elements — `trace-pills` (pill container), `trace-pill` (each pill button), `playback-bar` (playback container), `speed-selector` (speed toggle div)
- `BpmnViewer.tsx`: Added conditional `className` on wrapper div — always `bpmn-container-wrapper`, plus `bpmn-fullscreen` when in fullscreen mode

---

## 2. Architecture Decisions and Rationale

### NavigatedViewer over basic Viewer
bpmn-js ships multiple viewer classes. We use `NavigatedViewer` which bundles `ZoomScrollModule`, `MoveCanvasModule`, and `KeyboardMoveModule` out of the box. This gives users scroll-to-zoom and drag-to-pan without custom code. The basic `Viewer` was used initially but produced a static, non-interactive diagram.

### Manual viewport fitting over `fit-viewport`
The built-in `canvas.zoom('fit-viewport')` produced unreliable results — the diagram often rendered tiny in the top-left corner. We replaced it with a manual `fitToContainer()` function that reads `canvas.viewbox().inner` bounds, calculates scale from container dimensions with 40px padding, and sets an explicit viewbox. This runs inside `requestAnimationFrame` to ensure the container has been laid out.

### Client wrapper component for SSR boundary
Next.js 16 App Router does not allow `next/dynamic` with `ssr: false` in Server Components. Rather than converting the entire About page to a client component (which would lose server-side metadata export), we created a thin `McpFlowDiagramWrapper.tsx` client component that does the dynamic import and renders a loading skeleton.

### setTimeout-chain replay over requestAnimationFrame
The replay hook uses chained `setTimeout` calls with calculated delays rather than a continuous animation loop. This matches the discrete, event-based nature of the trace data and makes speed changes trivial (divide gap by speed factor). The `holdMs` field on animation steps creates dramatic pauses at decision points (gateway, loop-back, success) so users can follow the flow.

### Hand-authored traces over captured traces
The 4 bundled traces are hand-authored with realistic but curated timing and SoQL. This guarantees consistent demo quality without depending on live API availability. The `capture-trace.ts` utility exists for developers to capture real traces and replace/supplement the hand-authored ones later.

### CSS markers over SVG manipulation
bpmn-js's `canvas.addMarker(elementId, cssClass)` API applies CSS classes to the element's DOM group. This is the officially supported animation mechanism and avoids fragile direct SVG attribute manipulation. All visual states (active green glow, completed gray fade, loop-back amber, success green) are pure CSS with transitions.

### Overlay API for floating annotations
bpmn-js's `overlays.add()` positions HTML elements relative to diagram nodes. This keeps annotations visually attached to the relevant process step as the user pans/zooms. Overlays use a connector arrow (`::before` pseudo-element) pointing down toward the node.

### 4 `@typescript-eslint/no-explicit-any` suppressions
bpmn-js does not ship complete TypeScript definitions. The `Viewer`/`NavigatedViewer` constructor, `canvas`, `overlays`, and `eventBus` APIs are all untyped. Rather than writing ambient declarations for a third-party library, we use localized `any` suppressions with eslint-disable comments.

---

## 3. Known Issues and Incomplete Work

### Known Issues
- **BPMN XML still hand-authored**: The layout coordinates were manually improved (wider lanes, right-angle routing, better alignment) but still haven't been round-tripped through the bpmn.io visual modeler. Opening `public/bpmn/mcp-query-flow.bpmn` in https://demo.bpmn.io/ and re-exporting would catch any remaining edge cases.
- **Overlay positioning at extreme zoom levels**: At very low zoom, overlay cards may overlap or extend beyond the container. The `pointer-events: none` rule prevents interaction issues but overlays can visually clip.
- **bpmn-js bundle size**: bpmn-js adds ~400KB gzipped to the client bundle. The dynamic import with `ssr: false` ensures it's only loaded on the About page, but it's still a significant chunk for users who visit that page.

### Resolved Since Initial Commit
- ~~**Step 12 (Trace Capture integration)**~~: Now wired into `useStreamingComparison.ts`. Enable with `NEXT_PUBLIC_CAPTURE_TRACES=true` — MCP panel events are recorded and exported as JSON on completion.
- ~~**Step 13 (Responsive polish)**~~: Scroll fade hints, 2x2 pill grid, stacked playback controls, and fullscreen height fix are all implemented. The "annotations panel below diagram" sub-item was not done (the floating overlay approach was kept).
- ~~**Mobile experience is basic**~~: Mobile now has scroll affordance (fade gradients), properly responsive controls at ≤640px, and correct fullscreen behavior on phones.

### Remaining Deferred Work
- **Live trace mode**: Connecting to the live SSE stream so the diagram animates during actual queries. Only pre-recorded trace replay is implemented. The trace capture integration is a prerequisite that is now complete.
- **Test with real captured traces**: The hand-authored traces use realistic timing but haven't been validated against actual API response patterns. Now that capture is wired in, this can be done.
- **Annotations panel mobile layout**: On mobile, the `DiagramAnnotations` educational text panel still renders the same as desktop. Could be collapsed or moved below the diagram.

---

## 4. Dependencies Added

| Package | Version | Purpose | Bundle Impact |
|---------|---------|---------|---------------|
| `bpmn-js` | ^18.12.0 | BPMN 2.0 diagram rendering with zoom/pan | ~400KB gzipped (dynamically loaded, About page only) |

bpmn-js pulls in `diagram-js`, `bpmn-moddle`, and `min-dash` as transitive dependencies (19 packages total). No other direct dependencies were added.

---

## 5. Next Developer Priorities

### High Priority
1. **Test with real captured traces** — Trace capture is now wired in. Run `NEXT_PUBLIC_CAPTURE_TRACES=true npm run dev`, execute 4-5 queries on the home page, and compare the captured JSON against the hand-authored traces in `src/lib/bpmn/traces.ts`. Replace or supplement as needed.
2. **Live trace mode** — Connect the BPMN viewer to the live SSE stream so the diagram animates during actual queries (not just pre-recorded replays). The trace capture integration and fullscreen stability fixes are prerequisites that are now complete.
3. **Sprint 002 (Reasoning UX & Data Literacy)** — All 8 tasks are still pending. See `sprints/sprint-002-reasoning-ux-data-literacy.md`.

### Medium Priority
4. **Overlay clipping** — Add bounds checking so overlays don't extend beyond the visible container area at extreme zoom levels.
5. **Accessibility** — Add `aria-live` region for narrative panel updates, keyboard shortcuts for playback controls, screen reader descriptions for diagram state changes.
6. **Annotations panel mobile layout** — `DiagramAnnotations` educational text panel doesn't have a mobile-specific layout. Could collapse or move below diagram on small screens.

### Lower Priority
7. **Bundle optimization** — Investigate whether a lighter bpmn-js build (without BPMN font, without keyboard module) could reduce the ~400KB payload.
8. **Round-trip BPMN XML through visual modeler** — The hand-authored coordinates were improved but still haven't been validated in https://demo.bpmn.io/. Opening, adjusting, and re-exporting would catch edge cases.

---

## 6. Useful Commands

```bash
# Development
npm run dev                    # Start dev server (default port 3000)
npm run dev -- -p 3001         # Start on port 3001
npm run build                  # Production build (validates bpmn-js dynamic import works with SSR)
npm run lint                   # ESLint check

# Verify BPMN file
curl -s http://localhost:3000/bpmn/mcp-query-flow.bpmn | head -5
# Should show: <?xml version="1.0" encoding="UTF-8"?>

# Open BPMN file in browser modeler
open https://demo.bpmn.io/     # Then drag-drop public/bpmn/mcp-query-flow.bpmn

# Check bpmn-js bundle impact
npx next build 2>&1 | grep -A5 "about"
# The /about route chunk includes the dynamically-loaded bpmn-js viewer

# Enable trace capture in development
NEXT_PUBLIC_CAPTURE_TRACES=true npm run dev
# Run a query on the home page — MCP panel events are captured and logged as JSON on completion
# Copy the console output into src/lib/bpmn/traces.ts to add/replace traces

# Key files to edit for diagram changes
# Layout/elements:  public/bpmn/mcp-query-flow.bpmn
# Animation timing: src/lib/bpmn/node-mapping.ts (cascade delays, holdMs)
# Replay behavior:  src/hooks/useTraceReplay.ts (MIN_GAP, speed factors)
# Visual markers:   src/components/about/bpmn-diagram.css
# Trace data:       src/lib/bpmn/traces.ts
```

---

## File Dependency Graph

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
