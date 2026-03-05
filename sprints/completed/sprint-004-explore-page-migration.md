# Sprint 004: Migrate BPMN to /explore, Restructure About

**Status:** Done
**Prerequisite:** Live query mode working on About page (done)
**Estimated effort:** 1 day
**Goal:** Create the `/explore` page by moving the BPMN visualization off `/about`, then restructure About as educational prose. Zero new functionality — this is a page reorganization.

---

## Context

The About page is doing too much: educational content, system prompt disclosure, narration explainer, BPMN replay, and live queries. The BPMN visualization deserves its own page because the process is the star there, while prose is the star of About. See CLAUDE.md "Information Architecture" for the three-page design philosophy.

This sprint is a prerequisite for the community trace gallery sprint (`SPRINT-community-trace-gallery.md`), which adds save/browse/replay features on `/explore`.

---

## Tickets

### 1. Create `/explore` route and move BPMN components

**What:** Create `src/app/explore/page.tsx` and move the BPMN diagram there.

**Implementation:**
- Create `src/app/explore/page.tsx` with the BPMN diagram as the primary content
- Move or re-export components from `components/about/` as needed — the BPMN components (`McpFlowDiagram`, `McpFlowDiagramWrapper`, `BpmnViewer`, `TraceControls`, `LiveResponsePanel`, `DiagramAnnotations`, `NarrativePanel`, `bpmn-diagram.css`) serve `/explore` now
- Rename `components/about/` to `components/explore/` since that's their new home (update all imports)
- The explore page structure:
  - **Section A:** BPMN diagram at full width (first thing users see)
  - **Section B:** Trace controls — example traces and live query input (the existing `TraceControls` component handles both modes already)
  - **Section C:** Collapsed "About the diagram" with BPMN notation guide and download link
- Page metadata: title "Explore | Civic AI Tools", description about watching MCP queries flow through the system

**Acceptance criteria:**
- [ ] `/explore` renders the BPMN diagram with all existing functionality (example replay, live queries, side-by-side layout, fullscreen)
- [ ] All existing BPMN features work identically on the new route
- [ ] `components/about/` renamed to `components/explore/`, all imports updated
- [ ] Dynamic import of bpmn-js still works (only loaded on `/explore`)

---

### 2. Restructure the About page

**What:** Replace the BPMN diagram on About with educational prose and a CTA to `/explore`.

**Implementation:**
- Remove `McpFlowDiagramWrapper` import and usage from `about/page.tsx`
- Add a "How MCP Connects AI to Data" section where the BPMN was:
  - 3-4 sentences explaining the MCP query flow at a conceptual level
  - Prominent CTA link: "Watch it in action" pointing to `/explore`
  - Style the CTA as a button or visually prominent link (consistent with existing design)
- Reorder remaining sections: "What You Just Saw" → "Why Answers Differ" → "How MCP Works" (new prose + CTA) → "How the AI Was Guided" → "What Affects Response Quality" → "See It in Action"
- Remove any About-page-specific BPMN CSS or imports that are no longer needed

**Acceptance criteria:**
- [ ] About page no longer imports or renders any BPMN components
- [ ] "How MCP Works" section has clear prose + link to `/explore`
- [ ] Page load is faster (no bpmn-js bundle)
- [ ] All remaining educational content renders correctly
- [ ] No broken internal links on the About page

---

### 3. Update header navigation

**What:** Add "Explore" to the site header.

**Implementation:**
- Add "Explore" link in `Header.tsx` between "About" and "GitHub"
- Active state styling when on `/explore` (match existing pattern for About)

**Acceptance criteria:**
- [ ] "Explore" appears in the header nav on all pages
- [ ] Active state highlights correctly on `/explore`
- [ ] Header layout doesn't break on mobile

---

### 4. Update cross-reference links

**What:** Redirect any internal links that pointed to the BPMN on `/about` to `/explore`.

**Implementation:**
- Search for any links to `/about` that include BPMN-related anchors (e.g., `#diagram`, `#system-prompt`) and update them
- Check home page, About page, and any other pages for cross-references
- The home page CTA or any "see how it works" links should now point to `/explore`

**Acceptance criteria:**
- [ ] No internal links point to a BPMN section on `/about`
- [ ] "See how it works" type links across the site point to `/explore`
- [ ] No 404s or broken anchors

---

### 5. Update CLAUDE.md and docs

**What:** Update documentation to reflect the new route structure.

**Implementation:**
- Update Architecture diagram in CLAUDE.md (remove "planned" from `/explore`)
- Update Directory Structure to show `components/explore/` and `app/explore/`
- Update BPMN Diagram section to reference `/explore` instead of About page
- Update prop threading paths in Patterns & Conventions
- Mark this sprint as done in the sprint index

**Acceptance criteria:**
- [ ] CLAUDE.md accurately reflects the three-page structure as implemented
- [ ] Directory structure matches reality
- [ ] No references to "BPMN on About page" remain in docs

---

## Out of Scope

These are explicitly deferred to the community trace gallery sprint:

- Community trace saving, browsing, or replay
- `/api/traces` endpoints
- Storage layer for traces
- "Save to gallery" buttons
- `/explore?trace={id}` deep linking (the URL pattern is reserved but not wired up yet)
- Three-tab trace source selector (Examples / Community / Try your own)

---

## Definition of Done

- [ ] `/explore` renders the full BPMN visualization with example replay and live query support
- [ ] `/about` is purely educational prose with a clear link to `/explore`
- [ ] Header nav shows Home | About | Explore | GitHub
- [ ] No broken links across the site
- [ ] Page loads are not regressed (bpmn-js only loads on `/explore`)
- [ ] All docs updated
