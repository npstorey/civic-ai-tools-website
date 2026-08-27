# CLAUDE.md

The reference implementation of a record-publishing platform for AI-assisted analysis of civic open
data: users ask plain-language questions, the app answers them against live sources through MCP
servers, and packages each result as a **signed record package** anyone can verify independently.
Next.js (App Router) + TypeScript; reference deployment https://civicaitools.org/.

## Strategic context — what not to include in this repo

This repo is public. Strategic and relationship context — specific external stakeholders,
prospective collaborators, pre-meeting strategy, private outreach plans, named individuals' opinions
or quotes — lives in local-only planning docs outside this repo. In code, docs, commit messages,
issues, PRs, and starter prompts destined for this repo use neutral phrasing ("an external
stakeholder," "an upcoming demo"); if a prompt you received carries strategic context, scrub it.

## Secret hygiene

Never `cat`, `head`, `tail`, or otherwise dump `.env*`, `auth.json`, `credentials*`, `*.pem`, `*.key`, or
anything under `~/.ssh` or `~/.aws`; for one variable, `grep '^VAR_NAME=' .env.local` — the name, never the
value. Secrets belong in 1Password and reach a process through `op run`; `.env.local` should hold `op://`
references rather than literals (migration open: civic-ai-tools-website#101 — assume literals are still on
disk). `PUBLISHER_SIGNING_KEY` (still read under its prior-era name `EVIDENCE_SIGNING_KEY`) is the Ed25519
key anchoring the cryptographic chain over every published record: never generate, display, or handle a
signing key inside a Claude Code session — use a separate terminal. A sandboxed agent session **does**
execute the global pre-push sensitivity hook (measured via `GIT_TRACE=1`, even against a filesystem
remote) — don't design an owner-run leg around the assumption that it doesn't.

## Commands

| Command | Healthy output |
|---|---|
| `npm test` | `# pass 1044` / `# fail 0` (`node --test` TAP summary) |
| `npm run build` | `✓ Compiled successfully`, then the Route (app) table |
| `npm run typecheck` | no output, exit 0 — **run after `npm run build`** (tsconfig includes `.next/types`, which the build emits) |
| `npm run lint` | `✖ 4 problems (0 errors, 4 warnings)` — warnings are the baseline; **zero errors** is the gate |
| `npm run check:compose-env` | `RESULT: PASS — every variable this profile reads can reach the container.` |
| `npm run check:standalone` | `[standalone-assets] OK — 3 runtime-read asset(s) present and byte-identical` — needs a standalone build first; `npm run build:standalone` does both |
| `npm run dev` | dev server on localhost:3000 |

CI (`.github/workflows/ci.yml`) has two jobs. `build / test / lint / typecheck` runs the first five
commands plus a `.well-known` byte-identity check. `container image build` (#295) builds the real
image from the `.dockerignore`-filtered context — always-run and unfiltered, because the trigger for
that defect class is "any file the build type-checks changed", which a paths filter cannot enumerate.
Both are **required checks**; both are **credential-free by construction** — never add a `secrets.`
reference or a placeholder-credential `env:` block to make a step pass; the keyless build is the
invariant it protects. `check:standalone` runs inside the container job, and also on a host in the
paths-filtered, deliberately-not-required `standalone.yml`: host and container are different
environments, and a green run on one is not evidence about the other. A stale `node_modules` fails
tests in ways that look like code defects — `npm ci` first.

## Information Architecture

Each page has one job — use this to decide where a new feature belongs.

| Route | Star of the page | User goal |
|---|---|---|
| `/` | The result content | "Show me why MCP matters" |
| `/explore` | The process (BPMN diagram, trace replay, live queries) | "Show me how this works" |
| `/about` | The prose | "Explain this to me" |
| `/project` | Mission + proof | "What is this project, and does it work?" |
| `/learn` | Educational content | "Teach me the concepts" |
| `/records` | The published registry | "Show me what's been published" |
| `/records/[slug]` | One signed analysis | "Let me scrutinize this analysis" |
| `/directory` | MCP-server inventory | "What sources can I connect to?" |
| `/roadmap` | Plans + commitments | "Where is this project going?" |
| `/dashboard` | The user's own publishes | "Manage my records" |
| `/ask` | The query form, signed-in | "Answer a question against live data and publish it" |

`/evidence` and `/api/evidence/*` are permanent prior-era aliases of `/records` and `/api/records/*`,
not a deprecation window. `/ask` is app-private in the host topology (`src/lib/host-routing.ts`): it
404s on the marketing host and is where the app host's `/` redirects.

## Where the detail lives

- [`docs/deploy.md`](docs/deploy.md) — env vars tier by tier, the driver seams, self-hosting, migrations.
- [`docs/db-migrations.md`](docs/db-migrations.md) — how a migration reports success and changes nothing.
- [`docs/api/records-publish.md`](docs/api/records-publish.md) — the record-publish contract.
- [`docs/design-principles.md`](docs/design-principles.md) — **read before touching the record detail
  page, chat output rendering, the provenance graph, or any other AI-output / attestation surface.**
  Five words: disclosure not validation, hierarchy not equality, narrative not metadata, axes not
  chips, user language not implementation language.
- [`docs/RETROSPECTIVE.md`](docs/RETROSPECTIVE.md) — session retrospectives, reverse-chronological.
- Canonical specs (package shape, signing, captureMethod, withdrawal, typed claims):
  [`civic-ai-tools/docs/architecture/`](https://github.com/npstorey/civic-ai-tools/tree/main/docs/architecture)
  — where this codebase diverges from a draft, the codebase wins and the spec gets updated.

## Rules

Each cost a real mistake; the incident sits in an HTML comment beside it. Path-scoped rules live in
`.claude/rules/`, loaded only when you open a matching file.

- **Read before reimplementing.** When told "make X behave like Y," read Y's implementation first;
  importing the existing component beats building a parallel one.
  <!-- A live-trace pass rebuilt progress rendering from scratch, duplicating ProgressLog, because it
       started from plan text without reading it. Cost a full pass. RETROSPECTIVE.md, 2026-02-27. -->
- **Cross-cutting formatters live in `src/lib/streaming.ts`** (`buildNarrativeSummary`,
  `buildProvenanceLine`, `datasetUrl`, `getEducationalAnnotation`, `getPortalCity`, `getDatasetName`)
  — don't re-declare one in a component; export from here for the second caller.
  <!-- Same sprint: generateGroupLabel had to be retro-exported from useStreamingComparison.ts.
       RETROSPECTIVE.md, "Export utilities proactively." -->
- **Composition over duplication.** `src/components/shared/McpResponseDisplay.tsx` is the canonical case:
  `ResponsePanel` (home/ask) and `LiveResponsePanel` (explore) both delegate to it — new MCP response
  features belong there so both surfaces get them.
  <!-- Explore grew its own response renderer before the unification. Same retrospective. -->
- **Never render a raw `err.message` in a streaming path.** Reader-facing errors go through
  `friendlyStreamError()`, LLM-facing tool-failure strings through `describeToolFailureForLlm()`
  (both in `src/lib/streaming.ts`).
  <!-- #154: raw error text (status codes, server names, stack fragments) reached the reader and the
       model, breaking the anti-hallucination guard. #271 is the follow-on typed payload. -->
- **Reference design tokens by name, never by hex.** `src/app/globals.css` defines a per-instance accent
  family (`--accent`, from `SITE_BRAND_ACCENT`), a fixed neutral scale, and fixed semantic status colors;
  `src/app/design-tokens.test.ts` fails on a token that resolves to nothing. Light mode only.
  <!-- #217 made look-and-feel a configuration seam. A literal hex silently opts that element out of
       an instance's brand: invisible here, wrong on every other instance. -->
- **`next build` in a sandboxed agent session: re-measure, don't assume.** Turbopack's PostCSS worker
  pool binds a TCP port, and a sandbox that denies binding kills the build. Measured 2026-08-19 it
  built repeatedly (exit 0) sandboxed; where binding is denied, `next build --webpack` skips the
  worker pool. CI's `build` job is the real gate.
  <!-- Blamed on Google Fonts egress for two days. Not a network problem — since #246 fonts are
       self-hosted (src/fonts/). Same restriction behind the socket-binding failures in #249. -->
- **Touching `.env*` stalls a background agent.** Any read of a `.env*` file trips the global
  secret-read guard, and a subagent that hits it hangs to the 600s watchdog instead of failing fast.
  Ask the owner to run env edits in their own terminal.
  <!-- Repeated subagent stalls traced to .env* reads in agent sessions; the owner-run appends that
       replaced them had to be newline-defensive and verified structurally afterward. -->
- **The model-calling loop has several implementations — fixing one is not fixing it.** Besides
  `src/lib/openrouter-streaming.ts`, the model is called from `openrouter.ts`, `evidence/[slug]/replay`,
  `evidence/[slug]/evaluate`, `evidence/generate-summary`, and `evidence/adversarial-eval.ts`. Some
  carry their own loop-exit condition, their own result truncation, and their own error handling.
  Before fixing anything in the answer path, `grep -rl "chat.completions.create" src` and say in the
  PR which copies you did and did not change.
  <!-- Wave #325: three phases each fixed one instance of a defect that lived in a class, each
       honoring its blast zone exactly. #319 was fixed in openrouter-streaming.ts while
       openrouter.ts:120 kept the literal pre-fix condition and replay/route.ts kept it twice while
       feeding a signed attestation (#338). A zone scoped by file cannot see a defect scoped to a
       class. The same shape hit the preamble (#323 reopened) and the notebook path (notebook.ts:123). -->
