# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The reference implementation of a record-publishing platform for AI-assisted analysis of civic open data. Users ask plain-language questions about public data; the app answers them against live sources through MCP (Model Context Protocol) servers, can re-run an analysis as an executed notebook, and packages the result as a **signed record package** anyone can verify independently. The side-by-side comparison of a model answering with and without live data access is one of the surfaces the app offers — the thing it publishes is the record. Built with Next.js (App Router) in TypeScript, deployed on Vercel for the reference deployment.

**Production URL:** https://civicaitools.org/

## Strategic context — what not to include in this repo

This repo is public. Strategic and relationship context — specific external stakeholders, prospective collaborators, pre-meeting strategy, private outreach plans, named individuals' opinions or quotes — lives in local-only planning docs outside this repo (workspace `CLAUDE.md`, `ROADMAP.md`, per-user auto-memory), not here.

When contributing code, docs, commit messages, issue bodies, PR descriptions, or starter prompts for implementation chats that will commit to this repo, use neutral phrasing: "an external stakeholder," "an upcoming demo," "a follow-up meeting" — not specific names. If a task prompt you received includes strategic context, scrub it before producing any content destined for this repo.

## Secret hygiene

Never `cat`, `head`, `tail`, or otherwise dump the full contents of `.env*` files, `auth.json` files, `credentials*` files, `*.pem`, `*.key`, or any file under `~/.ssh`, `~/.aws`, or `~/Library/Application Support/*/auth.json`. If you need a single env var value, `grep '^VAR_NAME=' .env.local` for just that variable name (not the value). For CLI session tokens, prefer running the CLI command directly over reading its session file. If you think you need to dump a secrets file, stop and ask first.

This repo's `.env.local` contains critical infrastructure secrets including the Ed25519 signing key (`PUBLISHER_SIGNING_KEY`, still read under its prior-era name `EVIDENCE_SIGNING_KEY`) that anchors the cryptographic chain over published records. Secrets live in 1Password — `.env.local` files contain only `op://` references, not real values. Never generate, display, or handle signing keys or other sensitive values from within a Claude Code session; use a separate terminal.

## Commands

```bash
# Development
npm run dev          # Start dev server at localhost:3000
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
```

## Information Architecture

Each page has a distinct purpose. Use this framing to decide where new features belong:

| Page | Route | Star of the page | User goal |
|------|-------|-------------------|-----------|
| **Home** | `/` | The result content | "Show me why MCP matters" |
| **Explore** | `/explore` | The process | "Show me how this works" |
| **About** | `/about` | The prose | "Explain this to me" |
| **Project** | `/project` | Mission + proof | "What is this project, and does it work?" |
| **Learn** | `/learn` | Educational content | "Teach me the concepts" |
| **Record index** | `/records` | The published registry | "Show me what's been published" |
| **Record detail** | `/records/[slug]` | One signed analysis | "Let me scrutinize this analysis" |
| **Directory** | `/directory` | MCP-server inventory | "What sources can I connect to?" |
| **Roadmap** | `/roadmap` | Plans + commitments | "Where is this project going?" |
| **Dashboard** | `/dashboard` | The user's own publishes | "Manage my records" |
| **Ask** | `/ask` | The query form (signed-in) | "Answer a question against live data and publish it" |

`/ask` is the signed-in query mount (app front-door v0.1.0): the same shared `QuerySurface` as home, in signed-in configuration — app-private in the host topology (`src/lib/host-routing.ts`), so it 404s on the marketing host and is where the app host's `/` redirects.

(`/auth/device` is the device-flow pairing screen; `/dev/notebook-preview` is a dev-only preview harness, not user-facing.)

The BPMN visualization lives on `/explore`. The About page is purely educational prose with a CTA linking to `/explore`.

## Design principles

UX and data-model principles for AI-output and provenance surfaces are documented at [`docs/design-principles.md`](docs/design-principles.md). Read before making changes to the record detail page, chat output rendering, provenance graph, or any other AI-output / attestation surface. The five-word summary: **disclosure not validation, hierarchy not equality, narrative not metadata, axes not chips, user language not implementation language.**

## Architecture documentation

Canonical architecture documents and spec drafts live in the hub repo at [`civic-ai-tools/docs/architecture/`](https://github.com/npstorey/civic-ai-tools/tree/main/docs/architecture). Read before making changes that touch the record-package shape, signing/verification, captureMethod, withdrawal lifecycle, typed-claims layer, or any other surface where the spec is authoritative. The Open Evidence Standard and Civic Claim Vocabulary drafts are both internal working drafts (pre-v0.1, not for external review); sections subject to open questions are marked inline with `⚠ Subject to Open Question #N` callouts. The canonical home for unresolved architectural decisions is [`open-questions.md`](https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/open-questions.md) — spec sections cite by Q-number. The project's discipline for moving questions through to resolution is documented in [`working-method.md`](https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/working-method.md) (companion to `xanadu-doctrine.md`); the registry is the front door, GitHub issues are the execution back end, ADRs record settled decisions, specs reflect canonical state. The same doctrine also covers memory and instruction surfaces (CLAUDE.md / MEMORY.md) with their own inclusion conditions. The third companion doctrine, [`chat-type-taxonomy.md`](https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/chat-type-taxonomy.md), governs conversation surfaces — which kind of chat (strategic, planning, orchestration, implementation, meta) is appropriate for which kind of work; together the three doctrines cover spec growth (Xanadu), surface content placement (working method), and conversational surface (chat-type taxonomy). When this codebase diverges from the spec drafts, the codebase wins and the spec gets updated to match.

## Architecture

```
Frontend (Next.js App Router + Tailwind CSS)
    │
    ├── / (home)           → Query form + side-by-side streaming results
    ├── /explore           → BPMN diagram + trace replay + live queries
    ├── /about             → Educational prose, system prompt disclosure, CTA to /explore
    │
API Routes (Serverless)
    ├── POST /api/compare        → Runs parallel LLM calls (with/without MCP)
    ├── GET  /api/compare-stream → SSE streaming endpoint for live queries
    ├── GET  /api/models         → Available models list
    ├── GET  /api/rate-limit     → User quota status
    └── /api/auth/[...nextauth]  → GitHub OAuth
    │
External Services
    ├── Model endpoint (OpenAI-compatible; OpenRouter by default, swappable via MODEL_API_BASE_URL)
    ├── socrata-mcp-server (Socrata data via HTTP/SSE at /mcp endpoint)
    └── Upstash Redis via @vercel/kv (Rate limiting)
```

The diagram shows the comparison path as the reference deployment runs it. The stack is not hardwired to these services: the model endpoint (`src/lib/model-client.ts`), the Postgres database, the blob-storage driver (`src/lib/storage/`), and the notebook-executor driver (`src/lib/sandbox/`) are all configurable seams. [`docs/deploy.md`](docs/deploy.md) is the reference for the driver decisions and what each seam accepts.

## Key Implementation Details

### OpenRouter Integration (`lib/openrouter.ts`)
- Uses `openai` npm package with `baseURL: 'https://openrouter.ai/api/v1'`
- Tool calling follows OpenAI function calling format
- Same model used for both with/without MCP comparisons
- **Tool iteration cap** to prevent infinite loops — see `maxIterations` in `src/lib/openrouter-streaming.ts` for the current value (cited rather than restated here so this line can't drift out of sync with the code)
- **Force final response**: If iteration limit hit with no content, makes one more call without tools to get a summary

### MCP Tool Execution Flow
1. OpenRouter returns `tool_calls` in response
2. Backend intercepts and calls socrata-mcp-server via HTTP POST to `/mcp`
3. Server uses JSON-RPC format with SSE response
4. Tool results returned to model for final response

### MCP Server Communication (`lib/mcp/client.ts`)
```typescript
// 1. Initialize session first:
POST ${SOCRATA_MCP_URL}/mcp
Headers: { 'Accept': 'application/json, text/event-stream' }
Body: {
  jsonrpc: '2.0',
  id: Date.now(),
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {...} }
}
// Response header contains: mcp-session-id

// 2. Make tool calls with session ID:
POST ${SOCRATA_MCP_URL}/mcp
Headers: { 'mcp-session-id': sessionId }
Body: {
  jsonrpc: '2.0',
  id: Date.now(),
  method: 'tools/call',
  params: { name: 'get_data', arguments: { type: 'query', portal: '...', ... } }
}
```

### MCP Tool Types (`lib/mcp/tools.ts`)
The `get_data` tool supports these operation types:
- `catalog`: Search for datasets matching a query
- `metadata`: Get metadata about a specific dataset (pass dataset_id in `query` param)
- `query`: Execute a SoQL query against a dataset
- `metrics`: Get metrics/statistics about a dataset

### Socrata Skill Module (`lib/mcp/socrata-skill.ts`)
Domain knowledge injected into the LLM system prompt:
- Known dataset IDs and key fields for NYC, Chicago, SF
- SoQL query patterns and syntax
- **SoQL date functions** (NOT standard SQL!): `date_trunc_ym()`, `date_extract_m()`, etc.
- Anti-hallucination guidelines
- Portal-specific guidance

### Rate Limiting (`lib/rate-limit.ts`)
- Anonymous: 10 requests/day (tracked by IP)
- Authenticated: 25 requests/day (tracked by GitHub user ID)
- Key format in Upstash: `rate:{user_id_or_ip}:{YYYY-MM-DD}`
- Falls back to in-memory store if KV not configured (resets on deploy)

### Streaming & SSE (`lib/streaming.ts`, `lib/sse-client.ts`, `lib/openrouter-streaming.ts`)
- Home page uses SSE via `/api/compare-stream` for real-time progress updates
- Progress phases: `analyze`, `tool_start`, `tool_complete`, `tool_result`, `thinking`, `synthesize`
- `streaming.ts` is the shared utility hub — exports event types, `buildNarrativeSummary()`, `buildProvenanceLine()`, `datasetUrl()`, `getEducationalAnnotation()`
- `sse-client.ts` handles client-side SSE connection with reconnect
- **Streaming errors: never render a raw `err.message`.** Route every reader-facing streaming error through `friendlyStreamError()` and every LLM-facing tool-failure string through `describeToolFailureForLlm()` (both in `streaming.ts`) — they preserve the anti-hallucination guard and keep raw infrastructure detail (status codes, server names, stack text) out of the response.
- Dataset IDs are auto-linked to Socrata pages: `https://{portal}/d/{datasetId}`

### Shared MCP Response Display (`components/shared/McpResponseDisplay.tsx`)
Both the home page and Explore page delegate MCP response rendering to this shared component. It renders (in order):
1. **Query text** — blue left border quote
2. **ProgressLog** — narrative summary, breadcrumbs, expandable steps
3. **Markdown content** — via ReactMarkdown with auto-linked dataset IDs
4. **Source provenance** — green left border with linked dataset names
5. **Footer** — TimingBar, Time/Tokens, SkillPromptDisclosure

`linkDatasetIds()` inside this component replaces bare dataset IDs in markdown with clickable `[id](url)` links, avoiding double-linking inside existing markdown links.

**Truncation CTAs:** When `token_limit_exceeded` is true, an amber banner appears with two CTAs:
1. "Continue this analysis" — builds a continuation prompt with the original query, narrative summary of data collected, and partial response, then auto-submits it as a new query
2. "Try this locally (no limits)" — links to `/about#try-it`

**Download as notebook:** When query tool calls are present, a "Notebook" button appears alongside the "Copy" button. Uses `lib/notebook.ts` to generate a `.ipynb` file client-side with Python code cells that re-execute the same Socrata API queries using `requests` + `pandas`. Only `query`-type tool calls generate code cells; catalog/metadata/metrics calls are skipped.

### BPMN Diagram (`components/explore/`, `lib/bpmn/`)
Interactive BPMN 2.0 diagram on the Explore page visualizing MCP query execution. Two modes:

**Examples mode** — replays 4 pre-recorded traces through the diagram with animation:
- Traces defined in `lib/bpmn/traces.ts` (hand-authored with realistic SoQL and timing)
- Replay state machine in `hooks/useTraceReplay.ts` (setTimeout-chain, speed control, dramatic pauses)
- Node mapping in `lib/bpmn/node-mapping.ts` (ProgressPhase → BPMN element IDs)

**Live mode** — runs a real MCP query and animates the diagram in real-time:
- `hooks/useLiveTrace.ts` manages SSE connection, diagram animation, progress logs, trace capture
- Side-by-side layout: CSS grid `55fr 45fr` with transition; diagram left, response panel right
- 5-tier slow query messaging (30s neutral → 180s clickable suggestion)
- Cancelled queries preserve diagram state and partial response
- Captured traces can be replayed after completion

Key architectural decisions:
- **bpmn-js NavigatedViewer** — bundles zoom/pan/keyboard; ~400KB gzipped, dynamically loaded on Explore page only
- **CSS markers** (`canvas.addMarker()`) for animation states, not direct SVG manipulation
- **Overlay API** (`overlays.add()`) for SoQL previews and result annotations
- **Client wrapper** (`McpFlowDiagramWrapper.tsx`) for Next.js App Router SSR boundary

```
explore/page.tsx
  └── McpFlowDiagramWrapper.tsx (client, dynamic import)
        └── McpFlowDiagram.tsx (orchestrator)
              ├── TraceControls.tsx (mode toggle, trace pills, playback, speed, live query input)
              ├── BpmnViewer.tsx ← bpmn-diagram.css
              │     └── fetches /bpmn/mcp-query-flow.bpmn
              ├── LiveResponsePanel.tsx → McpResponseDisplay (both modes: response panel)
              ├── DiagramAnnotations.tsx (educational text, non-fullscreen only)
              └── hooks/useTraceReplay.ts + hooks/useLiveTrace.ts
                    ├── lib/bpmn/traces.ts
                    ├── lib/bpmn/node-mapping.ts
                    └── lib/bpmn/animation.ts
```

## Environment Variables

This is the local-dev set for the reference deployment; the full tier-by-tier environment reference for an instance (drivers, signing, instance identity) is [`docs/deploy.md`](docs/deploy.md).

The 14 publisher-identity variables take the `PUBLISHER_` prefix as of the 2026-08-19 vocabulary settlement (Appendix J); each prior-era `EVIDENCE_` spelling is still read as a fallback, canonical-wins-when-defined, with a one-time server-side deprecation warning. `src/lib/publisher-env.ts` is the single resolver.

Required in `.env.local`:
```
OPENROUTER_API_KEY=sk-or-...
SOCRATA_MCP_URL=https://socrata-mcp.civicaitools.org  # Required, no fallback — every data query refuses without it (#258)
DATA_COMMONS_MCP_URL=https://api.datacommons.org/mcp
DATA_COMMONS_API_KEY=                # From https://apikeys.datacommons.org (free)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
NEXTAUTH_SECRET=        # openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000  # or production URL
```

The `DATA_COMMONS_MCP_URL` / `DATA_COMMONS_API_KEY` pair powers the second MCP data source (Google Data Commons; US demographic + federal statistical data via a hosted HTTPS endpoint that Google launched 2026-02-09). The hosted endpoint is mandatory-auth via an `X-API-Key` header — anonymous access is not permitted, so `DATA_COMMONS_API_KEY` must be set or Data Commons tool calls will fail.

Optional (production only):
```
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX  # Google Analytics 4
```

Recommended in production, not required (Upstash via Vercel KV) — the rate
limiter degrades gracefully without it, falling back to per-process memory
(resets on restart; not shared across instances), which is fine for a
single-node instance but not durable or shared across serverless instances:
```
KV_URL=
KV_REST_API_URL=
KV_REST_API_TOKEN=
KV_REST_API_READ_ONLY_TOKEN=
```

## Directory Orientation

Deliberately a short orientation, not an exhaustive tree — the tree drifted badly once already. Verify against the filesystem when precision matters.

- `src/app/(marketing)/` — the public pages: home (`page.tsx`), `/explore`, `/directory`, `/learn`, `/project`, `/about`, `/roadmap`
- `src/app/(app)/` — dashboard, record pages, auth, and the signed-in query surfaces: `/dashboard`, `/records` (+ its permanent prior-era alias `/evidence`), `/ask`, `/auth/device`, plus the dev-only `/dev/notebook-preview`
- `src/app/api/` — serverless routes: `compare`, `compare-stream`, `models`, `rate-limit`, `query-notebook`, `session-status` (boolean-only has-a-session probe with marketing-origin CORS), plus the `records/*` route family (thin re-exports) with its implementations at `evidence/*` — the prior-era segment is a permanent alias, not a deprecation window — and `blob/*`, `cron/*`, `auth/*`
- `src/lib/` — the major areas:
  - `evidence/` — record-system core: packaging, signing, verification, provenance, attestation, lifecycle. (Directory and type names here are internal identifiers, deliberately left on the prior-era spelling by the 2026-08-19 settlement — they never cross the wire.)
  - `storage/` — blob-storage driver seam (Vercel Blob / S3-compatible)
  - `sandbox/` — notebook-executor driver seam (container / Vercel Sandbox)
  - `db/` — Drizzle ORM schema + client (Postgres)
  - `mcp/` — MCP HTTP client, tool definitions, Socrata skill fallback
  - auth (files, not a directory): `auth.ts`, `auth-providers.ts`, `api-auth.ts`, `device-flow.ts` — NextAuth config, provider seam, API-token auth, device flow
- `src/components/` — UI, with `dashboard/`, `evidence/`, `explore/`, `home/`, `notebook/`, `roadmap/`, and `shared/` subtrees alongside top-level components like `Header.tsx`

For depth, read [`docs/deploy.md`](docs/deploy.md) (drivers, environment tiers, self-hosting) and [`docs/api/records-publish.md`](docs/api/records-publish.md) (the record-publish contract, including the repositories-and-layers orientation).

## Key Datasets

| Portal | Dataset | ID | Key Fields |
|--------|---------|-----|------------|
| NYC | 311 Service Requests | erm2-nwe9 | complaint_type, borough, created_date |
| NYC | Restaurant Inspections | 43nn-pn8j | boro, grade, inspection_date |
| NYC | Housing Violations | wvxf-dwi5 | boro, violationid, inspectiondate |
| Chicago | 311 Service Requests | v6vf-nfxy | sr_type, created_date |
| SF | 311 Cases | vw6y-z8j6 | service_name, opened, neighborhood |

## Sprint Workflow

Active work is organized into lightweight sprints in [`/sprints/`](sprints/).

- **Naming:** `sprint-NNN-short-description.md`
- **Format:** Goal, checkboxed task list (grouped by priority), acceptance criteria
- **Current sprint:** Check `/sprints/` for the latest active sprint before starting work
- **Backlog:** Longer-term priorities and deferred items live in [`BACKLOG.md`](BACKLOG.md)

### Sprint Index

| Sprint | Description | Status |
|--------|-------------|--------|
| [001](sprints/completed/sprint-001-mcp-messaging-ux.md) | MCP messaging UX (progress logs, narrative) | Done |
| [002](sprints/completed/sprint-002-reasoning-ux-data-literacy.md) | Reasoning UX & data literacy | Done |
| [003](sprints/completed/sprint-003-polish-audit.md) | Polish audit (a11y, contrast, mobile) | Done |
| [SPRINT-live-query-bpmn](sprints/completed/SPRINT-live-query-bpmn.md) | Live query mode for BPMN diagram | Done (ticket 8 remaining) |
| [SPRINT-side-by-side-layout](sprints/completed/SPRINT-side-by-side-layout.md) | Side-by-side layout for live queries | Done |
| [004](sprints/completed/sprint-004-explore-page-migration.md) | Migrate BPMN to `/explore`, restructure About | Done |
| [SPRINT-community-trace-gallery](sprints/SPRINT-community-trace-gallery.md) | Community trace gallery on `/explore` | Not started (after 004) |

## Related Repos

| Repo | Purpose |
|------|---------|
| [civic-ai-tools](https://github.com/npstorey/civic-ai-tools) | MCP server configs, skill docs, setup scripts |
| [socrata-mcp-server](https://github.com/npstorey/socrata-mcp-server) | The MCP server itself (Socrata/OpenGov data) |

## Design Notes

- **Light mode only** — Simplified styling, no dark mode
- **Palette is a configurable seam** — `src/app/globals.css` defines a per-instance accent family (`--accent` and companions, set from `SITE_BRAND_ACCENT`, default `#103FEF`), a fixed neutral scale, and fixed semantic status colors. Reference tokens by name, never by hex; `src/app/design-tokens.test.ts` fails on a token that resolves to nothing.
- **Compact layout** — Form and button visible above fold on laptop screens
- **Indexing is explicit instance config** — `SITE_NOINDEX` (unset/empty = indexable, the standard web default; set truthy = `robots.txt` disallows every path and page metadata carries noindex/nofollow). The reference deployment sets `SITE_NOINDEX=1`. See [`docs/deploy.md`](docs/deploy.md#indexing-optional) and `src/lib/site-indexing.ts`.
- **Mobile out of scope for BPMN side-by-side** — Desktop only for now; mobile polish (stacked layout, 2x2 trace pills, scroll fade) is a future item
- **Fullscreen keeps site header** — Overlay renders below the header so users retain navigation context; uses `100dvh`

### Deep linking

- `/explore?trace={id}` — Auto-loads and replays a specific trace (reserved, not yet wired up)
- Header nav (desktop, `src/components/Header.tsx`): Explore ▾ (Data Flow `/explore` · Directory `/directory` · Records `/records`) | Learn | Project | About ▾ (About `/about` · Roadmap `/roadmap`) | Typed Standards (external link, typedstandards.org). There is no GitHub nav link. Dashboard is not in the nav — it lives in the signed-in user menu; signed-out users see a "Sign in with GitHub" button instead.

## Patterns & Conventions

These patterns are established across the codebase. Follow them when making changes.

### Read before reimplementing
When told "make X behave like Y," always read Y's implementation first. Importing an existing component is almost always better than building a parallel version. This was learned the hard way — see RETROSPECTIVE.md for details.

### Shared utilities live in `streaming.ts`
Cross-cutting formatting functions (`buildProvenanceLine`, `buildNarrativeSummary`, `datasetUrl`, `getEducationalAnnotation`, `getPortalCity`, `getDatasetName`) all live in `lib/streaming.ts`. Don't duplicate these in component files. If a new utility is needed by multiple components, add it here.

### Export utilities proactively
When building a utility for one module, consider whether other modules will need it. Export from the start rather than having to refactor later (e.g., `generateGroupLabel` needed export for cross-module reuse).

### Component composition over duplication
The `McpResponseDisplay` shared component is the canonical example — both `ResponsePanel` (home) and `LiveResponsePanel` (Explore) delegate to it. When adding MCP response features, add them to the shared component so both pages benefit.

### Prop threading for context
Query text, progress state, and tool call data are threaded from page → wrapper → panel → shared component. Follow the existing prop chains when adding new data:
- Home: `page.tsx → QuerySurface → ComparisonDisplay → ResponsePanel → McpResponseDisplay`
- Ask: `(app)/ask/page.tsx → QuerySurface → …` (same chain as home from `QuerySurface` down)
- Explore: `McpFlowDiagram → LiveResponsePanel → McpResponseDisplay`

### styled-jsx for component-scoped CSS
CSS keyframes (`blink`, `spin`, `pulse`) and component-specific styles use styled-jsx blocks within components. Global styles are in `globals.css`.

### bpmn-js patterns
- Use `canvas.addMarker()`/`removeMarker()` for animation states — don't manipulate SVG directly
- Use `overlays.add()` for positioned HTML content on diagram nodes
- Always call `fitToView()` after layout changes (fullscreen toggle, split panel transition) with a ~350ms delay for transition completion

## Known Tech Debt

### `next build` in a sandboxed agent session: re-measure in your environment

Whether the default (Turbopack) builder completes inside a Claude Code sandbox
is environment-dependent, not absolute. Its PostCSS worker pool binds a TCP
port, and a sandbox that denies port binding (`Operation not permitted`) kills
the build — the same restriction behind the `listen EPERM` failures in
`openrouter-streaming.test.ts` — but measured 2026-08-19, Turbopack built
repeatedly (exit 0) in a sandboxed agent session. Re-measure in your
environment (`npm run build`); if port binding is denied there, `next build
--webpack` completes without the worker pool. Either way, treat CI's `build`
check as the real gate.

Note for anyone diagnosing a build failure here: this is **not** a network
problem. Google Fonts was blamed for it for two days; the sandbox reaches
`fonts.googleapis.com` fine, and since #246 the fonts are self-hosted anyway
(`src/fonts/`), so no build path needs font egress at all.


1. **Duplicated SSE event handling** — `useLiveTrace` and `useStreamingComparison` both build progress groups from SSE events. A shared utility could extract the group-building logic.
2. **`@keyframes` duplication** — `blink` is defined in multiple styled-jsx blocks and could move to `globals.css`. `spin` exists in both `globals.css` and component styles.
3. **`useLiveTrace` responsibility accumulation** — Manages SSE connection, diagram animation, progress logs, tool tracking, trace capture, slow timers, elapsed time, and abort control. Works but is a code smell.
4. **bpmn-js type gaps** — 4 `@typescript-eslint/no-explicit-any` suppressions for untyped bpmn-js APIs.
5. **BPMN XML hand-authored** — Should be round-tripped through bpmn.io visual modeler for maintainability.
6. **Pre-existing lint warnings** — TraceControls setState-in-effect, unused `mapEventToNodes` in animation.ts. (The unused `onError` in sse-client.ts was removed — see its error-contract JSDoc; errors flow through promise rejection only.)

## Retrospectives

Session retrospectives are kept in [`docs/RETROSPECTIVE.md`](docs/RETROSPECTIVE.md) (reverse-chronological). Review before starting work to understand recent decisions and lessons learned.
