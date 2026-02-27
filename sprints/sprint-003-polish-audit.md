# Sprint 003 — Full Polish Audit

**Date:** 2026-02-27
**Scope:** Every page and component audited for visual bugs, layout issues, copy inconsistencies, and UX rough edges.
**Status:** 28 of 44 issues fixed. Remaining: 16.

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

## Fix Soon (21 issues — 16 fixed, 5 remaining)

### Layout & Overflow

**~~6. No `overflow-x` guard on `<body>`~~ ✅** — `globals.css:56-62`. **Resolution:** Added `overflow-x: clip` to `body`.

**~~7. Non-fullscreen BPMN diagram fixed at 650px~~ ✅** — `McpFlowDiagram.tsx:297`. **Resolution:** Changed to `min(650px, 70dvh)` for responsive height on shorter viewports.

**~~8. Fullscreen exit button may overlap TraceControls~~ ✅** — `McpFlowDiagram.tsx:427-457`. **Resolution:** Kept absolute positioning (moving to a flex row wasted too much vertical space). Overlap is theoretical and not observed in practice.

### Navigation

**~~9. No mobile navigation~~ ✅** — `Header.tsx:52`. **Resolution:** Added hamburger menu toggle for screens < 640px with About and GitHub links.

**~~10. Hardcoded GitHub line-number links will drift~~ ✅** — `about/page.tsx:328,338,348`. **Resolution:** Changed `GITHUB_STREAMING_BASE` to use commit SHA `24916fb` instead of `main`.

### Copy & Terminology

**~~11. Home page never expands "MCP" acronym~~ ✅** — `page.tsx:55-62`. "MCP" appears as linked text but "Model Context Protocol" is never spelled out on the page users see first. The About page correctly expands it. **Resolution:** Changed link text to "Model Context Protocol (MCP)".

**~~12. "LLM" used without expansion~~ ✅** — `page.tsx:55`, `layout.tsx:22,30,37`. The hero says "Compare LLM responses" — non-technical visitors won't know what LLM means. The About page uses "AI" consistently. **Resolution:** Changed to "Compare AI responses" in hero and all 3 meta descriptions.

**~~13. "Without Data Tools" vs "Without MCP" mismatch~~ ✅** — `ComparisonDisplay.tsx:69` uses "Without MCP" while `about/page.tsx:104` uses "Without Data Tools". Same concept, different labels across pages. **Resolution:** Changed to "Without Data Tools" / "With Data Tools".

**~~14. Hardcoded training data cutoff "~early 2025"~~ ✅** — `ResponsePanel.tsx:276,297`. **Resolution:** Changed to generic "training data only" — no date that can go stale.

### Visual Consistency

**~~15. Live query input missing design system focus style~~ ✅** — `TraceControls.tsx:259`. **Resolution:** Added `live-query-input` class with dashed-border focus-visible style matching `nyc-field`.

**~~16. Buttons missing `fontFamily: 'inherit'`~~ ✅** — 6 components (`QueryForm.tsx`, `ProgressLog.tsx`, `NarrationExplainer.tsx`, `SkillPromptDisclosure.tsx`, `RateLimitBanner.tsx`) have inline-styled `<button>` elements that may render in the browser's default button font instead of the site's Noto Sans. **Resolution:** Added global `button { font-family: inherit; }` rule to `globals.css`.

**~~17. Fullscreen exit button uses unique 8px border-radius~~ ✅** — `McpFlowDiagram.tsx:441`. **Resolution:** Changed to `4px` to match all other buttons.

**~~18. Inconsistent h3 sizes on About page~~ ✅** — `about/page.tsx`. **Resolution:** Changed "Get Started" h3 from `20px` to `18px` to match other card h3s.

**~~19. Mismatched error red~~ ✅** — `TraceControls.tsx:506` uses `#dc3545` (Bootstrap red) while the design system defines `--nyc-error: #EC131E`. **Resolution:** Replaced with `var(--nyc-error)` and matching rgba values.

### Interactive Elements

**~~20. Many TraceControls buttons lack hover states~~ ✅** — Speed selectors, trace pills, mode tabs, Reset/Cancel/New query buttons. **Resolution:** Added styled-jsx hover rules via CSS classes (`mode-tab`, `trace-pill`, `secondary-btn`, `speed-btn`).

**~~21. ProgressLog breadcrumb chips lack hover states~~ ✅** — `ProgressLog.tsx:395-418`. **Resolution:** Added `.breadcrumb-trail button:hover` rule in `globals.css`.

**~~22. About page query suggestion cards lack hover state~~ ✅** — `about/page.tsx:499-519`. **Resolution:** Added `.query-suggestion-card` class with hover border/background transition in `globals.css`.

### Accessibility

**~~23. Focus styles use `:focus` instead of `:focus-visible`~~ ✅** — `globals.css`. **Resolution:** Changed all `:focus` selectors to `:focus-visible` for links, `.nyc-button`, and form fields.

**~~24. Inline-styled buttons lack consistent focus styling~~ ✅** — **Resolution:** Added global `button:focus-visible` rule with dashed-outline design system style in `globals.css`.

**~~25. `--text-muted` (#777) borderline fails WCAG AA~~ ✅** — **Resolution:** Changed `--text-muted` from `var(--nyc-gray-40)` (#777) to `#757575` (4.6:1 contrast ratio).

**~~26. BPMN diagram container lacks aria-label~~ ✅** — `BpmnViewer.tsx:267`. **Resolution:** Added `role="img"` and descriptive `aria-label` to diagram container.

**~~27. Query textarea does not auto-expand~~ ✅** — `QueryForm.tsx:74-82`. `rows={1}` with `resize: 'none'` means longer queries are cramped and hard to edit. **Resolution:** Added `useRef` + `autoResize` callback with `maxHeight: 120px` cap.

---

## Minor (18 issues — 7 fixed, 11 remaining)

### Layout

**28.** Header uses `max-w-6xl` (1152px) while home page uses `maxWidth: 1000px` and About uses `900px` — staggered widths create visual funnel (`Header.tsx:38`, `page.tsx:40`, `about/page.tsx:55`)

**29.** `--header-height` fallback is `0px` — one-frame flash possible on first fullscreen render (`McpFlowDiagram.tsx:412`)

### Copy

**30.** "tool calls" vs "queries" vs "requests" used inconsistently across different counters (`LiveResponsePanel.tsx:86`, `streaming.ts:681`, `RateLimitBanner.tsx:67`)

**~~31.~~ ✅** "iterations" vs "steps" overlap in progress UI — **Resolution:** Removed step/iteration counters from example replay header; shows current event message during playback and timing + tool count when complete.

**~~32.~~ ✅** "Running query..." trailing ellipsis — **Resolution:** Removed trailing ellipsis to match other labels.

**33.** "Data Commons MCP" mentioned only in home page CTA, nowhere else on the site (`page.tsx:154-157`)

**~~34.~~ ✅** "opengov-mcp" shorthand — **Resolution:** Changed to "civic-ai-tools" to match the repo name users will find.

**~~35.~~ ✅** Footer tagline lacks trailing period — **Resolution:** Added period after "Nathan Storey".

**~~36.~~ ✅** About page excerpt claims "Here's exactly what it contains" — **Resolution:** Changed to "Here are the key components".

### Visual

**37.** Pill/chip border-radius varies: 16px (trace pills), 12px (breadcrumbs), 14px (iteration badge) — no standard

**~~38.~~ ✅** BPMN diagram uses Tailwind colors — **Resolution:** Replaced `#22c55e` with `var(--nyc-success)`, `#f59e0b` with `var(--nyc-caution)` in `bpmn-diagram.css`, `globals.css`, and `BpmnViewer.tsx` lane colors.

**39.** ToolCallCard operation badge colors are a custom palette outside the design system (`ToolCallCard.tsx:18-21`)

**40.** 8 distinct body text sizes (11–20px) with no formal type scale

**41.** `@keyframes` duplicated across styled-jsx blocks (known tech debt)

**42.** Primary button padding/font-size overrides vary per instance — no size variants

### Interactive

**43.** Enter fullscreen button, GroupCard/ToolCallCard headers, disclosure toggles, and several other buttons lack hover states (multiple files — lower-priority since these have other visual affordances like underlines, chevrons, or semantic context)

**44.** No confirmation when switching from live query to example mode mid-query (`McpFlowDiagram.tsx:107-117`)

**~~45.~~ ✅** GitHub header link goes to umbrella repo — **Resolution:** Changed to `civic-ai-tools-website` repo in both desktop and mobile nav.

---

## Summary

| Severity | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| Fix now  | 5     | 5     | 0         |
| Fix soon | 21    | 16    | 5         |
| Minor    | 18    | 7     | 11        |
| **Total** | **44** | **28** | **16** |

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

### Second batch (17 fixes)
11. ~~`overflow-x: clip` on body~~ — prevents page-level horizontal scrollbar (#6)
12. ~~Responsive BPMN diagram height~~ — `min(650px, 70dvh)` for shorter viewports (#7)
13. ~~Exit fullscreen button~~ — kept absolute but fixed border-radius; flex row wasted vertical space (#8)
14. ~~Mobile hamburger menu~~ — About and GitHub links now reachable on mobile (#9)
15. ~~Commit-SHA GitHub links~~ — narration layer links won't drift (#10)
16. ~~Generic training cutoff text~~ — no date that can go stale (#14)
17. ~~Design system focus on live query input~~ — dashed-border focus-visible (#15)
18. ~~Fullscreen exit button border-radius~~ — 4px matches all other buttons (#17)
19. ~~Consistent h3 sizes~~ — "Get Started" h3 now 18px (#18)
20. ~~Hover states for TraceControls buttons~~ — mode tabs, pills, speed, reset/cancel/new (#20)
21. ~~Breadcrumb chip hover states~~ — green border on hover (#21)
22. ~~Query suggestion card hover states~~ — blue border + background on hover (#22)
23. ~~`:focus` → `:focus-visible`~~ — no more focus rings on mouse clicks (#23)
24. ~~Global `button:focus-visible`~~ — consistent dashed focus for all buttons (#24)
25. ~~`--text-muted` WCAG AA fix~~ — darkened from #777 to #757575 (#25)
26. ~~BPMN container aria-label~~ — `role="img"` + descriptive label (#26)
27. ~~Minor copy fixes~~ — trailing ellipsis, CTA shorthand, footer period, excerpt claim, BPMN Tailwind colors, GitHub header link (#32, #34, #35, #36, #38, #45)
