# Sprint Plan: Community Trace Gallery

**Status:** Not started — blocked on live query feature  
**Prerequisite:** Live SSE → BPMN animation pipeline must be working first  
**Estimated effort:** 2–3 days  
**Page:** `/explore`

---

## Overview

After completing a demo query (on the home page or the /explore page), users can save their query trace to a public community gallery. Other visitors can browse and replay these traces through the BPMN diagram without consuming API calls. This turns individual data exploration into a shared civic tech resource.

---

## Dependencies

Before starting this sprint:

- [ ] Live query mode on `/explore` is working (SSE events drive BPMN animation in real time)
- [ ] Trace capture utility (`src/lib/bpmn/capture-trace.ts`) is wired into `useStreamingComparison` and records live query events
- [ ] The `/explore` page exists with the BPMN diagram, example traces tab, and live query tab

---

## Tickets

### 1. GitHub Authentication for Saving Traces

**What:** Require GitHub sign-in before a user can save a trace to the gallery.

**Implementation:**
- Use the existing GitHub OAuth flow (the "Sign in with GitHub" button already exists in the site header)
- The "Save to gallery" button appears after any completed query but triggers GitHub OAuth if the user isn't signed in
- Store trace data in `sessionStorage` before the OAuth redirect so it isn't lost during the auth flow — restore and save after auth completes
- Display GitHub username and avatar on saved traces in the gallery

**Acceptance criteria:**
- [ ] Unauthenticated users see "Save to gallery" button after query completion
- [ ] Clicking the button when not signed in redirects to GitHub OAuth
- [ ] After auth, the trace saves automatically without the user re-clicking
- [ ] Authenticated users save immediately on click
- [ ] GitHub username and avatar are stored with the trace metadata

---

### 2. Query Text Blocklist

**What:** Check query text against a blocklist before saving. Runs client-side for immediate feedback AND server-side as the authoritative check.

**Implementation:**

Create `src/lib/moderation.ts`:

```typescript
const BLOCKLIST_PATTERNS: RegExp[] = [
  // Profanity, slurs, hate speech patterns
  // Start conservative — add patterns as abuse appears
];

const BLOCKLIST_EXACT: Set<string> = new Set([
  // Exact query strings to block if specific abuse patterns emerge
]);

export function isQueryAllowed(query: string): { allowed: boolean; reason?: string } {
  const normalized = query.toLowerCase().trim();
  
  if (BLOCKLIST_EXACT.has(normalized)) {
    return { allowed: false, reason: 'This query cannot be saved to the gallery.' };
  }
  
  for (const pattern of BLOCKLIST_PATTERNS) {
    if (pattern.test(normalized)) {
      return { allowed: false, reason: 'This query cannot be saved to the gallery.' };
    }
  }
  
  return { allowed: true };
}
```

**Rules:**
- Run blocklist check client-side (for immediate UX) AND server-side in the POST endpoint (authoritative)
- Never tell the user which word or pattern triggered the block — generic message only: "This query cannot be saved to the gallery."
- The blocklist file should be easy to update without redeploying (consider loading patterns from an env variable or a JSON config file)

**Acceptance criteria:**
- [ ] Blocked queries show a generic rejection message client-side before hitting the API
- [ ] Server-side POST endpoint independently validates against the same blocklist
- [ ] Blocklist patterns are centralized in one file and easy to extend

---

### 3. Moderation Gate (Optional, Off by Default)

**What:** A toggle-able moderation system. When enabled, saved traces go to a pending queue instead of publishing immediately.

**Implementation:**

Environment variable:
```
NEXT_PUBLIC_MODERATION_ENABLED=false   # default: traces publish immediately
ADMIN_GITHUB_USERNAMES=nathanstorey    # comma-separated list of admin GitHub usernames
```

Data model addition:
```typescript
interface CommunityTrace {
  // ... existing fields from PreRecordedTrace ...
  id: string;
  query: string;
  model: string;
  portal: string;
  savedAt: string;
  savedBy: string;                    // GitHub username
  savedByAvatar?: string;            // GitHub avatar URL
  totalDuration_ms: number;
  toolCallCount: number;
  datasetsAccessed: string[];
  iterationCount: number;
  trace: PreRecordedTrace;
  status: 'published' | 'pending' | 'rejected';
  moderatedAt?: string;
  moderatedBy?: string;
}
```

**When moderation is OFF** (default):
- Traces save with `status: 'published'` and appear immediately
- User sees: "Trace saved! View it in the Explorer →"

**When moderation is ON:**
- Traces save with `status: 'pending'`
- User sees: "Trace submitted for review! It will appear in the gallery after approval."
- Public gallery endpoint only returns `status: 'published'` traces
- Admin endpoint returns pending traces (authenticated by checking GitHub username against `ADMIN_GITHUB_USERNAMES`)
- Admin action: `PATCH /api/traces/[id]` with `{ status: 'published' | 'rejected' }`

**No moderation UI in this sprint.** Moderate via curl or a simple script. Build a UI only if volume warrants it.

**Acceptance criteria:**
- [ ] With `MODERATION_ENABLED=false`, traces publish immediately (default behavior)
- [ ] With `MODERATION_ENABLED=true`, traces save as pending and don't appear in public gallery
- [ ] Admin can list pending traces via `GET /api/traces?status=pending` (authenticated)
- [ ] Admin can publish or reject via `PATCH /api/traces/[id]` (authenticated)
- [ ] Non-admin users get 403 on admin endpoints

---

### 4. Save Rate Limiting

**What:** Max 3 trace saves per GitHub user per 24-hour rolling window.

**Implementation:**
- Check in the POST endpoint before saving
- Storage key pattern: `user-saves:{githubId}:{YYYY-MM-DD}` with a counter value
- Return clear error: "You've saved 3 traces today. Try again tomorrow."
- Show remaining saves in the "Save to gallery" button tooltip: "2 saves remaining today"

**Acceptance criteria:**
- [ ] 4th save attempt in 24 hours returns a 429 with a friendly message
- [ ] Rate limit resets at midnight UTC (or rolling 24h — pick one and be consistent)
- [ ] User sees their remaining save count before attempting

---

### 5. "Save to Gallery" Button — Home Page

**What:** After a with-MCP response completes on the home page, show a save button in the MCP panel footer.

**Placement:** Near the existing tool summary banner and timing bar, below the response content.

**User flow:**
1. User completes a query on the home page
2. "Share this trace ↗" button appears in the MCP panel footer
3. Click → check GitHub auth (prompt sign-in if needed) → check blocklist → check rate limit → save
4. Show confirmation: "Trace saved!" with a "View in Explorer →" link
5. Clicking the link navigates to `/explore` with the trace ID in the URL (`/explore?trace={id}`), which auto-loads and starts replay

**Implementation notes:**
- The trace data comes from the capture utility that should already be recording SSE events during the with-MCP stream
- If the capture utility isn't recording (e.g., it wasn't wired in), the save button should not appear — fail gracefully
- Extract dataset names from the tool call args for the `datasetsAccessed` metadata field
- Calculate `toolCallCount` and `iterationCount` from the recorded events

**Acceptance criteria:**
- [ ] Save button appears only after a successful with-MCP response
- [ ] Save button does not appear if trace capture failed or wasn't active
- [ ] Full flow works: auth → blocklist → rate limit → save → confirmation → navigate to /explore
- [ ] Navigating to `/explore?trace={id}` auto-loads and replays the trace

---

### 6. "Save to Gallery" Button — Explore Page

**What:** After a live query completes on the `/explore` page, show a save button in the post-completion controls.

**User flow:**
1. User runs a live query on `/explore`
2. Query completes, BPMN animation finishes
3. "Save to gallery" button appears alongside the "Replay" button
4. Click → same auth/blocklist/rate-limit flow as home page
5. Trace appears in the Community tab — switch to that tab and highlight the new trace with a brief pulse animation

**Acceptance criteria:**
- [ ] Save button appears after live query completion (not after example trace replay)
- [ ] After saving, Community tab activates and the new trace is visually highlighted
- [ ] The save flow is identical to the home page flow (shared utility)

---

### 7. API Routes

**What:** Backend endpoints for trace CRUD.

**Endpoints:**

```
GET  /api/traces
  - Returns published traces (metadata only — no full event arrays)
  - Paginated: ?page=1&limit=12
  - Sort: ?sort=recent (default) | ?sort=complex | ?sort=replayed
  - Admin override: ?status=pending (requires admin auth)
  - Response: { traces: CommunityTraceMeta[], total: number, page: number }

GET  /api/traces/[id]
  - Returns single trace WITH full event array for replay
  - 404 if not found or if status !== 'published' (unless admin)
  - Response: CommunityTrace

POST /api/traces
  - Requires GitHub auth
  - Body: { query, model, portal, trace: PreRecordedTrace }
  - Server-side: blocklist check, rate limit check, compute metadata
  - Sets status based on MODERATION_ENABLED env var
  - Response: { id, status }

PATCH /api/traces/[id]
  - Admin only (check GitHub username against ADMIN_GITHUB_USERNAMES)
  - Body: { status: 'published' | 'rejected' }
  - Response: { id, status }
```

**The `CommunityTraceMeta` type** (returned in list endpoint — lightweight, no full event array):
```typescript
interface CommunityTraceMeta {
  id: string;
  query: string;
  model: string;
  portal: string;
  savedAt: string;
  savedBy: string;
  savedByAvatar?: string;
  totalDuration_ms: number;
  toolCallCount: number;
  datasetsAccessed: string[];
  iterationCount: number;
  status: 'published' | 'pending' | 'rejected';
}
```

**Acceptance criteria:**
- [ ] GET list returns only published traces by default
- [ ] GET list returns metadata only (no event arrays) for fast loading
- [ ] GET single trace returns full event array for replay
- [ ] POST validates auth, blocklist, rate limit before saving
- [ ] PATCH is admin-only and updates status
- [ ] All endpoints return appropriate error codes (401, 403, 404, 429)

---

### 8. Storage Layer

**What:** Lightweight storage for traces. Start simple, migrate later if needed.

**Option A — Vercel KV** (recommended if already using Vercel):
```
trace:{id}              → full CommunityTrace JSON
trace-meta:{id}         → CommunityTraceMeta JSON (no event array)
trace-list:published    → sorted list of published trace IDs
trace-list:pending      → sorted list of pending trace IDs
user-saves:{githubId}:{date} → daily save count (integer)
```

**Option B — Filesystem** (simpler, works anywhere):
```
data/traces/{id}.json        → full CommunityTrace
data/traces/index.json       → manifest: array of CommunityTraceMeta sorted by date
```

**Implementation notes:**
- Abstract the storage behind an interface so switching from filesystem to KV to database is a one-file change
- Full trace events can be large (50-200KB per trace for complex queries) — the list endpoint MUST return metadata only
- Set a max trace size limit (500KB) and reject traces that exceed it

**Acceptance criteria:**
- [ ] Storage interface is abstracted (easy to swap implementations)
- [ ] List endpoint is fast (reads metadata only, not full traces)
- [ ] Individual trace fetch loads the full event array
- [ ] Traces larger than 500KB are rejected with a clear error

---

### 9. Community Traces Gallery UI

**What:** The "Community traces" tab on the `/explore` page.

**Card layout:**
```
┌──────────────────────────────────────────────────────┐
│ "Compare noise complaints by borough in NYC"         │
│ 🔧 5 tool calls · 📊 311 Service Requests · ⏱ 12.4s │
│ @nathanstorey · 2 hours ago                          │
│                                         [▶ Replay]   │
└──────────────────────────────────────────────────────┘
```

**Features:**
- Default sort: most recent
- Secondary sorts: "Most complex" (highest tool call count)
- Show 12 traces initially, "Load more" button for pagination
- Each card: query text (1 line truncated with ellipsis), tool call count, primary dataset name as a pill/chip, total duration, GitHub username + small avatar, relative timestamp ("2 hours ago"), Replay button
- Clicking Replay loads the full trace (fetched from `GET /api/traces/[id]`) and starts BPMN playback
- Loading state: skeleton cards while fetching
- Empty state: "No community traces yet. Run a query and be the first to share! →" with a link/button that switches to the "Try your own" tab

**Acceptance criteria:**
- [ ] Gallery loads and displays published traces on the Community tab
- [ ] Cards show all metadata fields legibly
- [ ] Clicking Replay loads the trace and starts BPMN animation
- [ ] Pagination works (Load more button)
- [ ] Empty state is friendly and actionable
- [ ] Sort toggle works (recent vs. complex)

---

### 10. Navigation Update

**What:** Add "Explore" to the site header.

- Add "Explore" link between "About" and "GitHub" in the site header nav
- Update About page: replace the BPMN diagram section with a brief description + prominent link to `/explore`
- Update any cross-reference links that pointed to the BPMN diagram on `/about` — redirect to `/explore`

**Acceptance criteria:**
- [ ] "Explore" appears in the header nav on all pages
- [ ] About page links to `/explore` where the BPMN diagram used to be
- [ ] No broken internal links

---

## Out of Scope (Future Sprints)

These are explicitly deferred. Do not build them in this sprint:

- Replay count tracking and "most replayed" sort
- Upvoting or favoriting traces
- Curated collections or "featured traces"
- Moderation admin UI (use curl/scripts)
- Search or keyword filter within the gallery
- Comments on traces
- Social sharing (Twitter/LinkedIn cards for individual traces)
- Trace forking ("run this query again with a different model")
- Trace diffing (compare two traces of the same query)

---

## Definition of Done

- [ ] A user can run a query on the home page, save the trace, and see it appear on `/explore`
- [ ] A user can run a live query on `/explore`, save it, and replay it from the Community tab
- [ ] A visitor can browse and replay community traces without signing in or using API calls
- [ ] Blocklist prevents inappropriate queries from being saved
- [ ] Rate limiting prevents spam (3 saves/user/day)
- [ ] Moderation gate can be toggled on via env variable if needed
- [ ] Gallery is empty-state friendly and works with 0, 1, and 100+ traces
- [ ] Navigation includes Explore link and About page cross-references work
