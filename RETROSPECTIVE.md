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
- **BPMN XML authored by hand**: The XML coordinates were manually calculated rather than exported from the bpmn.io visual modeler. Lane heights, task positions, and message flow waypoints may need adjustment if the diagram doesn't render cleanly on all screen sizes. Opening `public/bpmn/mcp-query-flow.bpmn` in https://demo.bpmn.io/ and re-exporting would improve layout.
- **Overlay positioning at extreme zoom levels**: At very low zoom, overlay cards may overlap or extend beyond the container. The `pointer-events: none` rule prevents interaction issues but overlays can visually clip.
- **Mobile experience is basic**: The diagram is horizontally scrollable on mobile (`overflow-x: auto`) but the trace controls and narrative panel don't have mobile-optimized layouts. The interaction hint ("Scroll to zoom...") is hidden on mobile.
- **bpmn-js bundle size**: bpmn-js adds ~400KB gzipped to the client bundle. The dynamic import with `ssr: false` ensures it's only loaded on the About page, but it's still a significant chunk for users who visit that page.

### Incomplete/Deferred Work
- **Step 12 (Trace Capture integration)**: The `capture-trace.ts` utility exists but is not wired into `useStreamingComparison.ts`. The plan called for adding a `NEXT_PUBLIC_CAPTURE_TRACES=true` check in the streaming hook that creates a capture instance and logs JSON to console. This integration was deferred.
- **Step 13 (Responsive polish)**: Basic mobile responsiveness (scrollable container, hidden hint) is in place, but the plan called for: fade hints on horizontal scroll edges, 2x2 grid for trace selector pills on mobile, and annotations panel below diagram instead of floating overlays. These are not implemented.
- **Live trace mode**: The plan mentioned connecting to the live SSE stream so the diagram animates during actual queries. Only pre-recorded trace replay is implemented.

---

## 4. Dependencies Added

| Package | Version | Purpose | Bundle Impact |
|---------|---------|---------|---------------|
| `bpmn-js` | ^18.12.0 | BPMN 2.0 diagram rendering with zoom/pan | ~400KB gzipped (dynamically loaded, About page only) |

bpmn-js pulls in `diagram-js`, `bpmn-moddle`, and `min-dash` as transitive dependencies (19 packages total). No other direct dependencies were added.

---

## 5. Next Developer Priorities

### High Priority
1. **Open the BPMN XML in bpmn.io modeler and re-export** — The hand-authored XML coordinates work but may have suboptimal spacing. Opening in https://demo.bpmn.io/, adjusting layout visually, and re-exporting will produce cleaner rendering.
2. **Wire trace capture into useStreamingComparison** — Add the `NEXT_PUBLIC_CAPTURE_TRACES=true` env check so developers can capture real traces from the home page demo and replace/supplement the hand-authored ones.
3. **Test with real captured traces** — The hand-authored traces use realistic timing but haven't been validated against actual API response patterns. Capture 4-5 real traces and compare.

### Medium Priority
4. **Mobile polish** — Trace selector pills in 2x2 grid, scroll fade hints, stacked layout for controls.
5. **Overlay clipping** — Add bounds checking so overlays don't extend beyond the visible container area.
6. **Accessibility** — Add `aria-live` region for narrative panel updates, keyboard shortcuts for playback controls, screen reader descriptions for diagram state changes.

### Lower Priority
7. **Live trace mode** — Connect to the SSE stream from the home page demo so the diagram animates during actual queries.
8. **Bundle optimization** — Investigate whether a lighter bpmn-js build (without BPMN font, without keyboard module) could reduce the ~400KB payload.
9. **Replace hand-authored BPMN XML with modeler-exported version** — If the diagram layout needs significant changes, use the visual modeler rather than editing XML coordinates by hand.

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
# (Note: capture utility exists but is not yet wired into useStreamingComparison)

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
