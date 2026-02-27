# Sprint 003 — Full Polish Audit

**Date:** 2026-02-27
**Scope:** Every page and component audited for visual bugs, layout issues, copy inconsistencies, and UX rough edges.
**Status:** 10 of 44 issues fixed (commit `135dfea`). Remaining: 34.

---

## Fix Now (5 issues — all fixed)

### ~~1. `var(--nyc-blue)` is undefined — 14 references silently fail~~ ✅

**Where:** 6 files across the codebase

- `McpResponseDisplay.tsx:140,222` — markdown links lose blue color; query text left-border disappears
- `ProgressLog.tsx:62,80,155,364` — "Without MCP" spinner/accent colors fall through
- `ResponsePanel.tsx:229,243` — loading spinner and border on "Without MCP" panel
- `SkillPromptDisclosure.tsx:244,256` — GitHub source links
- `NarrationExplainer.tsx:71,87` — function name links and "Learn more" link
- `about/page.tsx:512,685` — heading accents and code links

Only `--nyc-blue-40` (`#103FEF`) is defined in `globals.css`. Every `var(--nyc-blue)` resolves to nothing, so these colors inherit from parent (typically dark gray/black) instead of appearing blue.

**Fix:** Either add `--nyc-blue: #103FEF` to `:root` in `globals.css`, or replace all 14 occurrences with `var(--nyc-blue-40)`.

**Resolution:** Added `--nyc-blue: #103FEF` alias to `:root` in `globals.css`.

### ~~2. Markdown tables in LLM responses can overflow horizontally~~ ✅

**Where:** `globals.css:285-302`, `McpResponseDisplay.tsx:293`

`.response-markdown table` has `width: 100%` but no `overflow-x: auto` wrapper. Civic data queries frequently produce 5–8 column tables that will overflow the response panel on viewports below ~1024px, potentially causing page-level horizontal scroll. (`.response-markdown pre` correctly has `overflow-x: auto` — only tables lack this.)

**Fix:** Add `overflow-x: auto` to a wrapper around tables, or add a `.response-markdown` parent rule like `display: block; overflow-x: auto` for tables.

**Resolution:** Added `display: block` + `overflow-x: auto` to `.response-markdown table` rule.

### ~~3. Green "Complete in X.Xs" text fails WCAG AA contrast~~ ✅

**Where:** `TraceControls.tsx:418`

`--nyc-success` (`#00B703`) on white has ~3.5:1 contrast ratio. At `fontSize: 13px`, this fails the 4.5:1 WCAG AA requirement for normal text.

**Fix:** Darken to ~`#008A02` (achieves ~4.6:1).

**Resolution:** Changed `--nyc-success` from `#00B703` to `#008A02` globally.

### ~~4. TimingBar label capitalization inconsistency~~ ✅

**Where:** `McpResponseDisplay.tsx:31-34`

Labels are `'AI reasoning'` (sentence case), `'Data Retrieval'` (title case), `'Synthesis'` (title case). Mixed capitalization within the same UI element.

**Fix:** Standardize to either all sentence case or all title case.

**Resolution:** Changed `'Data Retrieval'` → `'Data retrieval'` (sentence case).

### ~~5. Inconsistent connection error messages~~ ✅

**Where:** `useStreamingComparison.ts:160` vs `useLiveTrace.ts:446`

Home page says `'Failed to connect to the server. Please try again.'` but About page says `'Failed to connect to the server.'` (no guidance).

**Fix:** Use the same message in both places.

**Resolution:** Added "Please try again." to `useLiveTrace.ts` to match home page.

---

## Fix Soon (21 issues — 5 fixed, 16 remaining)

### Layout & Overflow

**6. No `overflow-x` guard on `<body>`** — `globals.css:56-62`. If any LLM-generated content overflows (wide tables, long code), the whole page gets a horizontal scrollbar. Add `overflow-x: hidden` or `overflow-x: clip` to `html`/`body`.

**7. Non-fullscreen BPMN diagram fixed at 650px** — `McpFlowDiagram.tsx:297`. On iPad (1024×768 portrait), the diagram extends far below fold. No responsive height override for shorter viewports. Add a `@media (max-height: 800px)` rule or use `dvh` units.

**8. Fullscreen exit button may overlap TraceControls** — `McpFlowDiagram.tsx:427-457`. Absolutely positioned at `top: 16px, right: 24px` while TraceControls can wrap on narrow viewports (~768px), causing overlap.

### Navigation

**9. No mobile navigation** — `Header.tsx:52`. The `<nav>` uses `hidden sm:flex`, so About and GitHub links are unreachable on screens < 640px. No hamburger menu fallback.

**10. Hardcoded GitHub line-number links will drift** — `about/page.tsx:328,338,348`. NarrationLayer components link to `streaming.ts` line ranges (`#L43-L71`, etc.) that will silently break when the file is edited. Consider permanent commit-SHA links.

### Copy & Terminology

**~~11. Home page never expands "MCP" acronym~~ ✅** — `page.tsx:55-62`. "MCP" appears as linked text but "Model Context Protocol" is never spelled out on the page users see first. The About page correctly expands it. **Resolution:** Changed link text to "Model Context Protocol (MCP)".

**~~12. "LLM" used without expansion~~ ✅** — `page.tsx:55`, `layout.tsx:22,30,37`. The hero says "Compare LLM responses" — non-technical visitors won't know what LLM means. The About page uses "AI" consistently. **Resolution:** Changed to "Compare AI responses" in hero and all 3 meta descriptions.

**~~13. "Without Data Tools" vs "Without MCP" mismatch~~ ✅** — `ComparisonDisplay.tsx:69` uses "Without MCP" while `about/page.tsx:104` uses "Without Data Tools". Same concept, different labels across pages. **Resolution:** Changed to "Without Data Tools" / "With Data Tools".

**14. Hardcoded training data cutoff "~early 2025"** — `ResponsePanel.tsx:276,297`. This will become stale as newer models are added. The cutoff varies by model.

### Visual Consistency

**15. Live query input missing design system focus style** — `TraceControls.tsx:259`. The `<input>` is styled inline without `nyc-field` class. Browser default focus ring instead of the dashed-blue design system focus.

**~~16. Buttons missing `fontFamily: 'inherit'`~~ ✅** — 6 components (`QueryForm.tsx`, `ProgressLog.tsx`, `NarrationExplainer.tsx`, `SkillPromptDisclosure.tsx`, `RateLimitBanner.tsx`) have inline-styled `<button>` elements that may render in the browser's default button font instead of the site's Noto Sans. **Resolution:** Added global `button { font-family: inherit; }` rule to `globals.css`.

**17. Fullscreen exit button uses unique 8px border-radius** — `McpFlowDiagram.tsx:441`. Every other button in the app uses 4px. Visual outlier.

**18. Inconsistent h3 sizes on About page** — `about/page.tsx` uses `18px` for card h3s (lines 388, 415, 451) but `20px` for Get Started h3 (line 565).

**~~19. Mismatched error red~~ ✅** — `TraceControls.tsx:506` uses `#dc3545` (Bootstrap red) while the design system defines `--nyc-error: #EC131E`. **Resolution:** Replaced with `var(--nyc-error)` and matching rgba values.

### Interactive Elements

**20. Many TraceControls buttons lack hover states** — Speed selectors (lines 43–65), trace pills (164–189), mode tabs (121–157), Reset/Cancel/New query buttons (207–475). All have `cursor: pointer` but no visual hover feedback.

**21. ProgressLog breadcrumb chips lack hover states** — `ProgressLog.tsx:395-418`. Clickable but no visual response on hover.

**22. About page query suggestion cards lack hover state** — `about/page.tsx:499-519`. Cards are clickable links but show no visual change on hover.

### Accessibility

**23. Focus styles use `:focus` instead of `:focus-visible`** — `globals.css:138-141,170-173,235-242`. Focus rings appear on mouse clicks as well as keyboard navigation, which is visually noisy.

**24. Inline-styled buttons lack consistent focus styling** — All custom buttons outside the `nyc-button` class get browser-default focus ring instead of the dashed-outline design language.

**25. `--text-muted` (#777) borderline fails WCAG AA** — At small text sizes (11–13px), `#777777` on white has ~4.48:1 contrast — technically below the 4.5:1 threshold. Darkening to `#757575` would pass.

**26. BPMN diagram container lacks aria-label** — `BpmnViewer.tsx:267`. The SVG container has no `role="img"` or descriptive label for screen readers.

**~~27. Query textarea does not auto-expand~~ ✅** — `QueryForm.tsx:74-82`. `rows={1}` with `resize: 'none'` means longer queries are cramped and hard to edit. **Resolution:** Added `useRef` + `autoResize` callback with `maxHeight: 120px` cap.

---

## Minor (18 issues — none fixed yet)

### Layout

**28.** Header uses `max-w-6xl` (1152px) while home page uses `maxWidth: 1000px` and About uses `900px` — staggered widths create visual funnel (`Header.tsx:38`, `page.tsx:40`, `about/page.tsx:55`)

**29.** `--header-height` fallback is `0px` — one-frame flash possible on first fullscreen render (`McpFlowDiagram.tsx:412`)

### Copy

**30.** "tool calls" vs "queries" vs "requests" used inconsistently across different counters (`LiveResponsePanel.tsx:86`, `streaming.ts:681`, `RateLimitBanner.tsx:67`)

**31.** "iterations" vs "steps" overlap in progress UI (`LiveResponsePanel.tsx:80`, `ProgressLog.tsx:196`)

**32.** "Running query..." has trailing ellipsis while all other group labels don't (`useStreamingComparison.ts:264`)

**33.** "Data Commons MCP" mentioned only in home page CTA, nowhere else on the site (`page.tsx:154-157`)

**34.** "opengov-mcp" shorthand in CTA may confuse non-technical users (`page.tsx:128-130`)

**35.** Footer tagline lacks trailing period (`layout.tsx:55-78`)

**36.** About page excerpt claims "Here's exactly what it contains" but shows a simplified field list (`about/page.tsx:242`)

### Visual

**37.** Pill/chip border-radius varies: 16px (trace pills), 12px (breadcrumbs), 14px (iteration badge) — no standard

**38.** BPMN diagram uses Tailwind colors (`#22c55e`, `#f59e0b`) instead of NYC design system tokens (`bpmn-diagram.css:9,41`)

**39.** ToolCallCard operation badge colors are a custom palette outside the design system (`ToolCallCard.tsx:18-21`)

**40.** 8 distinct body text sizes (11–20px) with no formal type scale

**41.** `@keyframes` duplicated across styled-jsx blocks (known tech debt)

**42.** Primary button padding/font-size overrides vary per instance — no size variants

### Interactive

**43.** Enter fullscreen button, GroupCard/ToolCallCard headers, disclosure toggles, and several other buttons lack hover states (multiple files — lower-priority since these have other visual affordances like underlines, chevrons, or semantic context)

**44.** No confirmation when switching from live query to example mode mid-query (`McpFlowDiagram.tsx:107-117`)

**45.** GitHub header link goes to umbrella repo, not this website's repo — could confuse developers (`Header.tsx:65`)

---

## Summary

| Severity | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| Fix now  | 5     | 5     | 0         |
| Fix soon | 21    | 5     | 16        |
| Minor    | 18    | 0     | 18        |
| **Total** | **44** | **10** | **34** |

### Completed quick wins (commit `135dfea`)
1. ~~Add `--nyc-blue: #103FEF` to `:root`~~ — fixed 14 broken color references
2. ~~Add `button { font-family: inherit; }` to `globals.css`~~ — fixed font inconsistency across 6 components
3. ~~Add `overflow-x: auto` to `.response-markdown table`~~ — prevents the most common real-world overflow
4. ~~Darken `--nyc-success` for text use~~ — fixed WCAG contrast failure
5. ~~Expand "LLM" → "AI", "MCP" → "Model Context Protocol (MCP)"~~ — clearer for non-technical visitors
6. ~~Standardize panel titles to "Without/With Data Tools"~~ — consistent across pages
7. ~~Replace Bootstrap error red with design system `--nyc-error`~~ — visual consistency
8. ~~Sentence-case TimingBar labels~~ — consistent capitalization
9. ~~Connection error message parity~~ — matches home page copy
10. ~~Auto-expanding query textarea~~ — no more clipped input
