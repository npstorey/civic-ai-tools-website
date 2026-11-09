#!/usr/bin/env node

/**
 * Model evaluation harness for civic data queries.
 *
 * Runs a set of test queries against a roster of models via OpenRouter, on the
 * app's own in-loop request shape, using the site's MCP client for tool calls.
 * Captures each answer, every tool call, every load and how it ended, every
 * model request's usage and cost, and the automatic checks below, for scoring
 * against the six-dimension rubric (hub docs/research/eval-queries.md;
 * civic-ai-tools-website#573, and the open-weight evaluation, #740).
 *
 * MODES
 *   (none)          The full run (`planFor('run')`): every model on the 15
 *                   queries three times with every source On, plus the pause
 *                   set (below). 5 models × (45 + 6) = 255 rows.
 *   --probe         The five models on two queries with every source On, and
 *                   on one query with Socrata Ask first and the decision
 *                   `off`: 15 rows. Run before the full run; its results file
 *                   is what `--calibrate` reads.
 *   --dry-run       Prints what the run (or, with --probe, the probe) would
 *                   send first on each row, the row count and the two cost
 *                   bounds, from the recorded OpenRouter list in
 *                   scripts/fixtures/eval-models/. Makes no network call and
 *                   needs no key.
 *   --preflight     Sends no model request. Prints each environment variable
 *                   the run reads, by name, as set or absent; the key check;
 *                   the roster against OpenRouter's live list; every
 *                   configured source with its hosting; and the Socrata
 *                   guidance's origin as a load would compose it. Stops on a
 *                   missing key, a 1Password reference, a refused key, a
 *                   roster problem, a configuration that would start a
 *                   sandbox, or a fallback composition.
 *   --calibrate <probe results file>
 *                   No network. The calibrated bound for the run from the
 *                   probe's rows, the headline bound beside it, and the cap
 *                   rule's outcome (#740 D9; the seat's rulings).
 *   --check-slugs   Checks the roster against OpenRouter's live model list. A
 *                   public read; needs no key and calls no model.
 *   --cap <usd>     Required for any form that calls a model. The run stops
 *                   before a row whose worst case could carry the spend past it,
 *                   writes what it has, and exits 2.
 *   --out-dir <dir> Where the results file goes (default: this directory).
 *
 * WHAT A RUN CHECKS BEFORE IT SPENDS. In order: the environment (below); the
 * source configuration, refused if any source would be served from a sandbox
 * (a hosted source's `*_HOSTING` switch on), since a model's call to it would
 * start one; the roster against OpenRouter's live list (`checkRoster` — every
 * slug present, tools supported, every request parameter the model will be
 * sent listed as supported, the open-weight models' provider object the ruled
 * one); the key, with one call to OpenRouter's key endpoint, which costs
 * nothing and fails on a key that is set but does not work; and the Socrata
 * guidance, composed once as a load would compose it, refused if it fell back.
 * Only then the first model call. `--preflight` runs the same checks and stops
 * there.
 *
 * IT DRIVES THE SHARED TOOL-CALLING LOOP (#356). Until this file was migrated
 * it carried a fourth copy of that loop: its own iteration bound, its own
 * unguarded `JSON.parse` of the arguments the model chose, its own portal
 * injection with no `get_data` guard, and a raw `error.message` handed back to
 * the model. Wave #345 consolidated the application's three loops onto
 * `src/lib/model-loop/run-tool-loop.ts` and not one of those fixes reached
 * here, because the census that found the class and the guard that measured it
 * were both scoped to `src/` and to `.ts`. What remains in this file is what is
 * genuinely its own: the models it compares, the queries it runs them against,
 * and how it writes results up for scoring.
 *
 * A ROW IS ONE THE APP'S IN-LOOP PATH COULD HAVE PRODUCED (EVAL-OW, #740 D4).
 * Production runs `SOURCE_ROUTING=in-loop`, so every row runs as
 * `src/app/api/compare-stream/route.ts` runs a question under it: the
 * directory set from `directorySet(configured, consent)` at the row's consent
 * configuration, `createInLoopRouting` with the row's scripted pause, and the
 * shared loop fed the routing's first system prompt, its first tools
 * (`load_source` alone), its load step and its transport, with the app's
 * limits. A loaded source's guidance and tools arrive on the request after the
 * load, composed by the app's own code. The harness does not read
 * `SOURCE_ROUTING`: every row is in loop. Before #740 a row was the app's
 * all-sources shape (#609), which production no longer sends. The harness is
 * never portal-locked, since its questions span five portals.
 *
 * THE CONSENT CONFIGURATIONS (#740 P1 part 6). "Every source On" is the
 * enforced gate with every configured source's state `on`. "Ask first" is the
 * gold source's state absent, which `directorySet` reads as Ask first, and
 * every other source On. All fifteen queries route to Socrata, so a pause row
 * is made Ask first by its configuration, not chosen by its question. The
 * scripted decisions are `off` and `allow`; `allow-all` is a self-test's only
 * (`scripts/eval-models.test.mjs`), and no row runs it.
 *
 * THE MCP TRANSPORT IS THE SITE'S (#573). This file used to carry its own: one
 * legacy session, opened once, with no recovery. The hosted server redeployed
 * during this harness's own preparation (2026-10-11, 0.1.5 to 0.9.1 between two
 * reads five minutes apart) and every later call on the old session was refused
 * "No valid session ID". The site's client (`src/lib/mcp/client.ts`) reopens a
 * rejected session once and re-probes the protocol era, so a run now crosses a
 * redeploy the way the site does, and a call the model makes here reaches the
 * source by the same path a visitor's does.
 *
 * WHAT IS RECORDED PER MODEL REQUEST. The OpenAI client is given a fetch that
 * reads each response's usage (reasoning tokens included), the cost OpenRouter
 * reported for it (`usage.cost`, as S1 read it; nothing is added to the
 * request for it), finish reason, responding model and the provider that
 * served it, and the request parameters the request carried, a streamed
 * answering turn included. It changes one thing in a request: an open-weight
 * model's body gets the ruled `provider` object (#740 D3 = A), which the
 * shared loop has no field for. Nothing from the headers is kept. Each row has
 * its own client, and a row that times out is closed: a model request or tool
 * call its abandoned loop makes afterwards is refused rather than sent, so a
 * timeout stops spending instead of carrying on unseen beside the next row.
 *
 * THIS HARNESS IS PINNED TO OPENROUTER, AND THE APP IS NOT. Since
 * civic-ai-tools-website#30 the app reaches a configurable endpoint through
 * `src/lib/model-client.ts`, reading `MODEL_API_KEY` (with `OPENROUTER_API_KEY`
 * as its prior-era name) and `MODEL_API_BASE_URL` / `MODEL_API_KIND`. This
 * script hardcodes OpenRouter's base URL and requires `OPENROUTER_API_KEY`
 * specifically. That is why the variable name below differs from the one an
 * operator now sets — the statement is accurate about this script, not stale
 * about the app. Repointing the harness at the endpoint layer is tracked in
 * civic-ai-tools#155 and is deliberately not a find-and-replace.
 *
 * THE REASON RECORDED HERE FOR THAT PINNING WAS FALSE, and it is worth naming
 * rather than quietly deleting: it said this file "is `.mjs` run as bare
 * `node`, so it cannot import that TypeScript module." Node strips types from
 * an imported `.ts` module — by default from v22.18, behind
 * `--experimental-strip-types` before that — and the `runToolLoop` import below
 * is the standing counter-example. Nothing about the extension prevented the
 * import. The OpenRouter pinning is unfinished work (civic-ai-tools#155), not a
 * constraint of the runtime.
 *
 * Usage, on Node >= 22.18 where type stripping is on by default:
 *   OPENROUTER_API_KEY=<your-key> SOCRATA_MCP_URL=https://your-mcp-host \
 *     node scripts/eval-models.mjs --cap 35
 *
 * On Node 22.0 – 22.17 the same run needs the flag, because of that import:
 *   OPENROUTER_API_KEY=<your-key> SOCRATA_MCP_URL=https://your-mcp-host \
 *     node --experimental-strip-types scripts/eval-models.mjs --cap 35
 *
 * package.json's `engines.node` is ">=22", which admits those versions, so the
 * floor is load-bearing for the flagless form rather than incidental.
 * `scripts/eval-models.test.mjs` runs a flagless `node` against that import and
 * fails by name on a Node that cannot strip, so the gap is reported by the
 * suite rather than met by an operator.
 *
 * Required env vars, for a form that calls a model:
 *   OPENROUTER_API_KEY — the key itself. A 1Password reference (`op://…`) is
 *                      refused by name: run the command under `op run`, which
 *                      resolves it. The key is never printed.
 *   SOCRATA_MCP_URL  — MCP server URL. No fallback (civic-ai-tools#155 P1
 *                      E4): this used to default to the project's hosted
 *                      endpoint, which would silently route an
 *                      unconfigured run's queries through infrastructure
 *                      the caller does not operate. Point it at the Socrata
 *                      MCP deployment this eval run should query.
 *
 * Optional env vars:
 *   EVAL_MODELS      — comma-separated model IDs to run (default: all; full run only)
 *   EVAL_QUERIES     — comma-separated query indices, 1-based (default: all; full
 *                      run only). The pause set keeps the queries this leaves in it.
 *   EVAL_REPEATS     — repeats of the 15 queries, 1 to 3 (default 3; full run only)
 *   EVAL_ROW_GAP_MS  — the pause between rows, in ms (default 1000)
 *   The site's source configuration (`readMcpEnvFromProcess`): DATA_COMMONS_MCP_URL,
 *                      DATA_COMMONS_API_KEY, BOSTON_OPENCONTEXT_MCP_URL and the
 *                      hosted sources' `*_HOSTING` switches. Read once per run,
 *                      they decide which sources every row's directory lists,
 *                      exactly as on an instance that sets the same variables.
 *                      A hosted source switched on is refused: the run and the
 *                      preflight stop before any model call.
 *   MODEL_API_KIND   — read by the shared loop: whether a streamed answering
 *                      turn asks for its usage (`includeStreamUsage`).
 *
 * Output: scripts/eval-results-<run|probe>-<UTC timestamp>.json (gitignored),
 * rewritten after every row so a partial run survives a stop. It never holds
 * the key check's line or a balance: those are printed, and the printed
 * output is never committed.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import OpenAI from 'openai';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';

import { runToolLoop } from '../src/lib/model-loop/run-tool-loop.ts';
import { HOSTED_SOURCE_KEY_VARIABLE, hostingVariantInForce, readMcpEnvFromProcess } from '../src/lib/mcp/registry.ts';
import { createInLoopRouting, directorySet, entersInLoop } from '../src/lib/mcp/routing-mode.ts';
import { composeInLoopSystemPrompt } from '../src/lib/mcp/socrata-skill.ts';
import { rejectedRequestCount, summaryDataSources } from '../src/lib/evidence/summary-sources.ts';
import {
  BUILT_IN_CATALOG,
  modelRequestParameters,
  modelRequestSettings,
} from '../src/lib/model-catalog.ts';
import { citationCheck, pauseCheck } from './eval-checks.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const FIXTURES_DIR = resolve(__dirname, 'fixtures/eval-models');
/** The recorded OpenRouter list the dry run and `--calibrate` price from (#740 P1 part 8). */
export const OPENROUTER_SNAPSHOT = resolve(FIXTURES_DIR, 'openrouter-models-2026-11-09.json');

// --- Models ---

/**
 * The provider object every open-weight request carries (#740 D3 = A): S1's
 * price bound and parameter rule (hub `benchmark/runner/models.mjs:36` at
 * `0c4232a`) plus `data_collection: 'deny'`, so OpenRouter routes only to an
 * endpoint listing at most $0.15 per million input tokens and $0.60 per
 * million output tokens, supporting every field sent, and not collecting
 * user data. No provider is pinned: no `order`, `only` or `ignore`. No
 * Claude request carries a `provider`.
 */
export const OPEN_WEIGHT_PROVIDER = Object.freeze({
  max_price: Object.freeze({ prompt: 0.15, completion: 0.6 }),
  require_parameters: true,
  data_collection: 'deny',
});

/**
 * The catalog's models are controls, each with its request settings READ from
 * its catalog entry (`modelRequestSettings`) rather than restated here, so a
 * control sends exactly what the site sends that model.
 */
function controlFromCatalog(entry) {
  return {
    id: entry.endpointModel,
    name: entry.name,
    role: 'control',
    catalogId: entry.id,
    catalogEntryFound: true,
    requestSettings: modelRequestSettings(entry),
  };
}

/** Catalog entries this run leaves out: Opus 5.5 (#740, "What is not this sprint's"). */
export const CATALOG_IDS_NOT_RUN = Object.freeze(['anthropic/claude-opus-5.5']);

/**
 * The three open-weight candidates (#740 D2 = A), at S1's rule (hub
 * `benchmark/preregistration/s1.md:278-300` at `0c4232a`): `reasoning_effort:
 * 'low'` where the model lists efforts, none where it lists none, and the
 * limit sent as `max_tokens`, the one token-limit field each lists (none lists
 * `max_completion_tokens`, which the catalog's rule would pick for a model
 * with a reasoning setting; `s1.md:291`). Read from the recorded list
 * (`openrouter-models-2026-11-09.json`): GLM-5.3-Flash lists max, high and
 * low, and its reasoning cannot be turned off; gpt-oss-120b lists high,
 * medium and low; MiMo-V2.6-Flash lists none.
 */
const OPEN_WEIGHT_MODELS = [
  { id: 'z-ai/glm-5.3-flash', name: 'GLM-5.3-Flash', requestSettings: { reasoningEffort: 'low', tokenLimitParameter: 'max_tokens' } },
  { id: 'openai/gpt-oss-120b', name: 'gpt-oss-120b', requestSettings: { reasoningEffort: 'low', tokenLimitParameter: 'max_tokens' } },
  { id: 'xiaomi/mimo-v2.6-flash', name: 'MiMo-V2.6-Flash', requestSettings: { tokenLimitParameter: 'max_tokens' } },
].map((m) => ({ ...m, role: 'open-weight', provider: OPEN_WEIGHT_PROVIDER }));

/** The run's roster (#740 D2 = A): Haiku 5.5 and Sonnet 5.5 from the catalog, then the three open-weight models. */
export const ALL_MODELS = [
  ...BUILT_IN_CATALOG.filter((entry) => !CATALOG_IDS_NOT_RUN.includes(entry.id)).map(controlFromCatalog),
  ...OPEN_WEIGHT_MODELS,
];

// --- Test Queries ---

export const TEST_QUERIES = [
  {
    id: 'Q1',
    query: 'How many 311 complaints were filed in NYC last month?',
    portal: 'data.cityofnewyork.us',
    category: 'simple-lookup',
    expectedDataset: 'erm2-nwe9',
  },
  {
    id: 'Q2',
    query: 'What percentage of Chicago restaurant inspections failed last year?',
    portal: 'data.cityofchicago.org',
    category: 'simple-lookup',
    expectedDataset: '4ijn-s7e5',
  },
  {
    id: 'Q3',
    query: 'Show me the 5 most recent fire incidents in San Francisco',
    // San Francisco's current address, the one the site offers (#587); March
    // and October ran the old one, which in October downloaded a whole dataset
    // and restarted the hosted server (docs/model-evaluation-2026-10.md).
    portal: 'data.sf.gov',
    category: 'simple-lookup',
    expectedDataset: 'wr8u-xric',
  },
  {
    id: 'Q4',
    query: 'What are the top 10 complaint types in NYC 311 data this year?',
    portal: 'data.cityofnewyork.us',
    category: 'aggregation',
    expectedDataset: 'erm2-nwe9',
  },
  {
    id: 'Q5',
    query: 'Which Chicago ward had the most crimes in February 2026?',
    portal: 'data.cityofchicago.org',
    category: 'aggregation',
    expectedDataset: 'ijzp-q8t2',
  },
  {
    id: 'Q6',
    query: "What's the average building permit cost in Seattle by permit class?",
    portal: 'data.seattle.gov',
    category: 'aggregation',
    expectedDataset: '76t5-zqzr',
  },
  {
    id: 'Q7',
    query: 'Compare restaurant inspection grades across NYC boroughs — which borough has the highest percentage of A grades?',
    portal: 'data.cityofnewyork.us',
    category: 'multi-step',
    expectedDataset: '43nn-pn8j',
  },
  {
    id: 'Q8',
    query: "What are the highest-paying city jobs in Chicago and how do they compare to the median salary?",
    portal: 'data.cityofchicago.org',
    category: 'multi-step',
    expectedDataset: 'xzkq-xp2w',
  },
  {
    id: 'Q9',
    query: 'Show me the trend in LA 311 requests by month for the past 6 months',
    portal: 'data.lacity.org',
    category: 'multi-step',
    expectedDataset: 'h73f-gn57',
  },
  {
    id: 'Q10',
    query: "What's the crime rate?",
    portal: 'data.cityofnewyork.us',
    category: 'ambiguous',
    expectedDataset: null, // should ask for clarification
  },
  {
    id: 'Q11',
    query: 'Show me permit data',
    portal: 'data.cityofchicago.org',
    category: 'ambiguous',
    expectedDataset: null, // should ask for clarification
  },
  {
    id: 'Q12',
    query: 'How many building permits were issued in the Bronx in 1950?',
    portal: 'data.cityofnewyork.us',
    category: 'edge-case',
    expectedDataset: 'ic3t-wcy2',
  },
  {
    id: 'Q13',
    query: 'Show me noise complaints in manhattan from NYC 311',
    portal: 'data.cityofnewyork.us',
    category: 'edge-case',
    expectedDataset: 'erm2-nwe9',
  },
  {
    id: 'Q14',
    query: 'List all active business licenses in Seattle',
    portal: 'data.seattle.gov',
    category: 'edge-case',
    expectedDataset: 'wnbq-64tb',
  },
  {
    id: 'Q15',
    query: 'Compare 311 complaint volumes between NYC and Chicago for the past week',
    portal: 'data.cityofnewyork.us',
    category: 'edge-case',
    expectedDataset: null, // should decline on web
  },
];

/**
 * Q1's portal, NYC's: seven of the fifteen queries run on it. The other eight
 * name another portal per call, which is what #573's premise 2 asks about.
 */
const HOME_PORTAL = TEST_QUERIES[0].portal;

// --- The plans (#740 P1 part 6) ---

/**
 * The gold source of every query: all fifteen route to Socrata, so a pause
 * row is made Ask first by its configuration (#740 P1 part 6).
 */
const GOLD_SOURCE = Object.freeze({
  sourceId: 'socrata',
  alias: CIVIC_MANIFEST.find((entry) => entry.sourceId === 'socrata').alias,
});

/** Every source On: the gate enforced, every configured source's state `on`. */
export const EVERY_SOURCE_ON = Object.freeze({ mode: 'every-source-on' });

/** The gold source Ask first, with the decision the row's pause answers. */
export function goldAskFirst(decision) {
  return Object.freeze({ mode: 'ask-first', sourceId: GOLD_SOURCE.sourceId, alias: GOLD_SOURCE.alias, decision });
}

/** Repeats of the fifteen queries in the full run. */
export const RUN_REPEATS = 3;

/**
 * THE PAUSE SET (the seat's ruling, #740 comment 6728891704 point 2): three
 * questions whose gold source is set to Ask first, once with `off` and once
 * with `allow`, one repeat. Q1, Q2 and Q6 are three portals, each with an
 * `expectedDataset`; Q3 is left out because its portal is unmeasured end to
 * end (#740 P4). The rows are configured Ask first, not chosen by source.
 */
export const PAUSE_SET = Object.freeze({ queries: Object.freeze(['Q1', 'Q2', 'Q6']), decisions: Object.freeze(['off', 'allow']), repeats: 1 });

/**
 * The probe (#740, "The owner's probe leg"): every model on two queries, one
 * of them off the NYC portal, with every source On, then one query with the
 * gold source Ask first and `off`. Its first open-weight row measures whether
 * any endpoint passes the provider object; its rows are the profile
 * `--calibrate` reads.
 */
export const PROBE = Object.freeze({ queries: Object.freeze(['Q1', 'Q2']), askFirst: Object.freeze({ query: 'Q1', decision: 'off' }) });

/**
 * THE TOOL-RESULT CHECK (#573 premise 6), October's. Through OpenRouter, a
 * Google model was found to receive a tool result whose text contained a JSON
 * object as that object alone (the chooser spike, 2026-10-11), and the October
 * probe handed each recorded result to these models through `runToolLoop`,
 * `gpt-4o` the control. Its runner left this file with October's models
 * (#740: neither they nor the check is in any plan now; the runner is at
 * `b4bf703`). What stays is what its recorded fixtures are still tested
 * against: these models' names, the live captures' tool names, and the pure
 * verdict functions below.
 */
export const QUOTE_MODELS = ['google/gemini-3.5-flash-lite', 'google/gemini-3.8-flash', 'openai/gpt-4o'];

/**
 * One live result per other source the site has, captured through the site's
 * own client in the probe — the text the site would send as the tool message.
 * Each tool is named as the app offers it, `<alias>__<name>` (#609): the client
 * routes the name to its source and calls that server by its own name.
 * Socrata's results are recorded in the fixture file instead: they need no key.
 */
export const LIVE_CAPTURES = [
  {
    id: 'data-commons-live',
    source: 'data-commons',
    tool: 'data_commons__search_indicators',
    args: { query: 'median household income', places: ['New York City, USA'] },
  },
  {
    id: 'boston-opencontext-live',
    source: 'boston-opencontext',
    tool: 'boston__ckan__search_datasets',
    args: { query: 'building permits', limit: 3 },
  },
];

// --- The app's limits (#740 D9 = A) ---

/**
 * The limits `/api/compare-stream` runs a question under, passed to the loop
 * as that route passes them (`queryWithMcpStreaming`,
 * `src/lib/openrouter-streaming.ts:389-394`): 20 tool-calling rounds, 4,000
 * tokens a request, and 200,000 tokens cumulative over the question, checked
 * after each round (`MAX_TOKENS_PER_REQUEST`, `:137`; a per-question bound,
 * not a per-call one); tool results bounded at 50,000 characters (`:138`);
 * and 45 seconds a tool call (`MCP_TOOL_TIMEOUT_MS`,
 * `src/app/api/compare-stream/route.ts:439`). The route's two environment
 * overrides (`TOKEN_LIMIT_PER_REQUEST`, `MAX_TOOL_RESULT_CHARS`) are unset on
 * production (#740 G0), so the defaults are pinned here.
 *
 * THE ANSWERING TURN STREAMS, as the app's does (`finalTurn: 'stream'`). The
 * request is then the app's byte for byte: `stream: true`, and
 * `stream_options: { include_usage: true }` where `includeStreamUsage()` says
 * the endpoint takes it. `recordingFetch` reads a streamed body's usage, model
 * and provider from its chunks, so streaming costs the record nothing.
 *
 * WHAT THE ROUTE PASSES AND THIS DOES NOT: `declaredModel` and `trace` (the
 * signed trace's attributes), `onDelta`, `onEvent` and `passThroughDelivery`
 * (the reader's stream). None reaches a request body.
 */
export const APP_LIMITS = Object.freeze({
  maxIterations: 20,
  maxTokens: 4000,
  maxCumulativeTokens: 200_000,
  maxToolResultChars: 50_000,
  toolTimeoutMs: 45_000,
  finalTurn: 'stream',
});

/**
 * A question's time bound. `/api/compare-stream` exports no `maxDuration`
 * and `vercel.json` sets none, so the platform's default bounds a question
 * there: 300 seconds for a function on fluid compute. The harness takes the
 * same.
 */
const QUERY_TIMEOUT_MS = 300_000;

// --- What a row is given (#740 D4 = A) ---

/** The harness is never portal-locked: its questions name five portals. */
const LOCKED_PORTAL = undefined;

/**
 * The consent a row's directory is read from, in the gate's shape
 * (`DirectoryConsent`): enforced, every source `on`, and for an Ask-first row
 * the gold source's state absent, which `directorySet` reads as Ask first.
 */
export function consentStates(consent) {
  const states = {};
  for (const entry of CIVIC_MANIFEST) states[entry.sourceId] = 'on';
  if (consent.mode === 'ask-first') delete states[consent.sourceId];
  return { enforced: true, states };
}

/**
 * The row's scripted pause, in the app's `ConsentPause` shape: it answers
 * every question with `decision` (a row with every source On asks none, and
 * one that did would be answered `no-answer`), and notes each source it was
 * asked about, for the load's `loadAsked`.
 */
export function scriptedPause(decision, askedSources) {
  return {
    async ask(sourceId) {
      askedSources.add(sourceId);
      return decision ?? 'no-answer';
    },
  };
}

/**
 * The routing one row runs under: `createInLoopRouting` at the row's
 * directory and scripted pause, as `src/app/api/compare-stream/route.ts`
 * creates it, with the run's clock. `callTool` is for a caller that must not
 * reach a source (the dry run); a run passes none.
 */
export async function routingFor(spec, query, configured, now, askedSources, callTool) {
  const directory = directorySet(configured, consentStates(spec.consent));
  if (!entersInLoop('in-loop', directory)) {
    throw new Error('the directory set is empty at this configuration, so no row can run in loop');
  }
  return createInLoopRouting({
    portal: query.portal,
    lockedPortal: LOCKED_PORTAL,
    configured,
    directory,
    // The gate's selection, configured ∩ On (the record's offered reasons only).
    selection: directory.filter((entry) => entry.state === 'on').map((entry) => entry.sourceId),
    now,
    pause: scriptedPause(spec.consent.decision, askedSources),
    ...(callTool ? { callTool } : {}),
  });
}

/**
 * The routing's load step, recording each load as it ends: the alias, the
 * outcome, and `loadAsked` (the bundle's `trace.loadSpan.loadAsked`): true
 * when the scripted pause was asked about the load's source on this load or
 * on the earlier one whose decision it reuses. It answers exactly what the
 * routing's own step answers.
 */
export function recordedLoadStep(routing, askedSources, loads) {
  const inner = routing.loadStep;
  return {
    toolName: inner.toolName,
    async load(alias, context) {
      const entry = routing.directory.find((candidate) => candidate.alias === alias);
      const note = (outcome) =>
        loads.push({
          alias: alias ?? null,
          sourceId: entry?.sourceId ?? null,
          state: entry?.state ?? null,
          outcome,
          loadAsked: entry ? askedSources.has(entry.sourceId) : false,
        });
      try {
        const answer = await inner.load(alias, context);
        note(answer.outcome);
        return answer;
      } catch (error) {
        note('unavailable');
        throw error;
      }
    },
  };
}

/**
 * What a row hands the shared loop, as `queryWithMcpStreaming` hands it under
 * in-loop routing: the routing's first prompt and tools, its load step and
 * transport, the query's portal, and the app's limits.
 */
export function loopOptions({ model, query, routing, loadStep, executeToolCall }) {
  return {
    endpointModel: model.id,
    // A control's settings come from its catalog entry and an open-weight
    // model's are stated above; either way they reach the request through the
    // catalog's own `modelRequestParameters`, the path a catalog entry takes.
    requestSettings: model.requestSettings,
    prompt: query.query,
    systemPrompt: routing.firstSystemPrompt,
    tools: routing.firstTools,
    executeToolCall,
    loadStep,
    // Default portal for a `get_data` call whose arguments omit one; the loop
    // injects it into Socrata's `get_data` alone, above the record.
    portal: query.portal,
    lockedPortal: LOCKED_PORTAL,
    toolTimeoutMs: APP_LIMITS.toolTimeoutMs,
    maxIterations: APP_LIMITS.maxIterations,
    maxTokens: APP_LIMITS.maxTokens,
    maxCumulativeTokens: APP_LIMITS.maxCumulativeTokens,
    maxToolResultChars: APP_LIMITS.maxToolResultChars,
    finalTurn: APP_LIMITS.finalTurn,
    logContext: `eval-models ${model.id}`,
  };
}

// --- Arguments and environment ---

/** Parses this harness's flags. Throws an Error naming the problem. */
export function parseArgs(argv) {
  const options = { mode: 'run', dryRun: false, capUsd: undefined, outDir: __dirname };
  const setMode = (mode) => {
    if (options.mode !== 'run' && options.mode !== mode) throw new Error(`--${options.mode} and --${mode} are separate forms`);
    options.mode = mode;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--probe') setMode('probe');
    else if (arg === '--check-slugs') setMode('check-slugs');
    else if (arg === '--preflight') setMode('preflight');
    else if (arg === '--calibrate') {
      const file = argv[++i];
      if (!file) throw new Error('--calibrate takes the probe\'s results file');
      setMode('calibrate');
      options.calibratePath = resolve(file);
    } else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--cap') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) throw new Error('--cap takes a positive number of US dollars, e.g. --cap 35');
      options.capUsd = value;
    } else if (arg === '--out-dir') {
      const dir = argv[++i];
      if (!dir) throw new Error('--out-dir takes a directory');
      options.outDir = resolve(dir);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.mode === 'check-slugs' && options.dryRun) {
    throw new Error('--check-slugs reads the live list; it has no dry-run form');
  }
  if ((options.mode === 'preflight' || options.mode === 'calibrate') && options.dryRun) {
    throw new Error(`--${options.mode} sends no model request; it has no dry-run form`);
  }
  return options;
}

/**
 * The key a model-calling form needs, or a named refusal: absent, or a
 * 1Password reference that was never resolved.
 */
function keyProblem(env) {
  const key = env.OPENROUTER_API_KEY;
  if (!key) return 'OPENROUTER_API_KEY environment variable is required';
  if (key.includes('op://')) {
    return 'OPENROUTER_API_KEY holds a 1Password reference, not a key. Run the command under `op run`, which resolves it.';
  }
  return null;
}

/**
 * The environment a model-calling form needs, or a named refusal. Checked in
 * this order — key, MCP URL, cap — before any network call.
 */
export function runEnvProblem(env, options) {
  const key = keyProblem(env);
  if (key) return key;
  if (!env.SOCRATA_MCP_URL) return 'SOCRATA_MCP_URL environment variable is required (no reference-host default)';
  if (options.capUsd === undefined) return '--cap <usd> is required for a run that calls a model';
  return null;
}

/**
 * Every environment variable a run reads, by name: the harness's own, the
 * site's source configuration (`readMcpEnvFromProcess`, from the router's
 * manifest), the hosted sources' keys, and the one the shared loop reads.
 */
export function runVariables() {
  const sources = CIVIC_MANIFEST.flatMap((entry) => [entry.configuration.addressVariable, entry.configuration.keyVariable].filter(Boolean));
  return [
    'OPENROUTER_API_KEY',
    ...new Set([...sources, ...Object.values(HOSTED_SOURCE_KEY_VARIABLE)]),
    'MODEL_API_KIND',
    'EVAL_MODELS',
    'EVAL_QUERIES',
    'EVAL_REPEATS',
    'EVAL_ROW_GAP_MS',
  ];
}

/** Each run variable as `set` or `absent`. Never a value. */
export function environmentLines(env) {
  return runVariables().map((name) => `  ${name.padEnd(28)} ${env[name] ? 'set' : 'absent'}`);
}

/**
 * Every source of the manifest at `configured`, with how it would be served:
 * `remote` (an address), `sandbox` (a hosted source's switch on: a model's
 * call to it would start a sandbox), or `not configured`.
 */
export function sourceHostings(configured) {
  return CIVIC_MANIFEST.map((entry) => {
    const variant = hostingVariantInForce(entry, configured);
    const hosting = variant === undefined ? 'not configured' : variant.kind === 'npm-package' ? 'sandbox' : 'remote';
    return { sourceId: entry.sourceId, alias: entry.alias, variable: entry.configuration.addressVariable, hosting };
  });
}

/** The refusal for a configuration that would start a sandbox, or null. */
export function sandboxProblem(configured) {
  const hosted = sourceHostings(configured).filter((s) => s.hosting === 'sandbox');
  if (hosted.length === 0) return null;
  return (
    `this configuration would start a sandbox for a hosted source (${hosted.map((s) => `${s.alias}, ${s.variable}`).join('; ')}): ` +
    'unset the switch for an evaluation run; nothing was sent to a model'
  );
}

/**
 * The Socrata guidance as a load of Socrata composes it (the in-loop
 * composer, for the home portal, with every configured source listed), and
 * where it came from: `endpoint`, `inline` or `fallback`.
 */
export async function socrataGuidanceOrigin(configured, now) {
  const directory = directorySet(configured, consentStates(EVERY_SOURCE_ON)).map((entry) => entry.sourceId);
  const composed = await composeInLoopSystemPrompt({ portal: HOME_PORTAL, configured, directory, loaded: [GOLD_SOURCE.sourceId], now });
  const id = CIVIC_MANIFEST.find((entry) => entry.sourceId === GOLD_SOURCE.sourceId).id;
  return composed.components.find((component) => component.id === id)?.guidanceOrigin ?? 'none';
}

// --- The roster against OpenRouter's list ---

/**
 * Every problem with `models` against OpenRouter's model list (`list.data`).
 * Empty means the run may start. Each check is one the run would otherwise
 * meet as a failed row: a slug the list does not carry, a model without tool
 * support or `tool_choice` (every tool request sends it), a request field the
 * list does not give as supported for that model (a limit sent under a name
 * the model does not take might not limit it), and a reasoning effort the
 * model does not offer. A control whose catalog entry is gone is a roster that
 * has gone stale.
 *
 * The fields checked are `modelRequestParameters`'s, the model's own request
 * parameters. The `provider` object is OpenRouter's routing field, not a
 * model parameter, so the list's `supported_parameters` does not carry it and
 * it is not checked there (S1 likewise, hub `models.mjs` `listedFields`); it
 * is checked against the ruling instead: an open-weight model must carry
 * exactly the ruled object, and a control none.
 */
export function checkRoster(models, list, maxTokens = APP_LIMITS.maxTokens) {
  const problems = [];
  const byId = new Map((list?.data ?? []).map((m) => [m.id, m]));
  for (const model of models) {
    if (model.role === 'control' && model.catalogEntryFound === false) {
      problems.push(`${model.id}: the catalog no longer has an entry "${model.catalogId}" — refresh the controls`);
    }
    if (model.role === 'open-weight' && !isDeepStrictEqual(model.provider, OPEN_WEIGHT_PROVIDER)) {
      problems.push(`${model.id}: its provider object is not the ruled one (${JSON.stringify(model.provider ?? null)})`);
    }
    if (model.role !== 'open-weight' && model.provider !== undefined) {
      problems.push(`${model.id}: a ${model.role} model carries a provider object`);
    }
    const listed = byId.get(model.id);
    if (!listed) {
      problems.push(`${model.id}: not on OpenRouter's model list`);
      continue;
    }
    const supported = new Set(listed.supported_parameters ?? []);
    if (!supported.has('tools')) problems.push(`${model.id}: the list does not give "tools" as supported`);
    if (!supported.has('tool_choice')) problems.push(`${model.id}: the list does not give "tool_choice" as supported`);
    for (const field of Object.keys(modelRequestParameters(model.requestSettings, maxTokens))) {
      if (!supported.has(field)) {
        problems.push(`${model.id}: would be sent "${field}", which the list does not give as supported`);
      }
    }
    const effort = model.requestSettings?.reasoningEffort;
    if (effort !== undefined) {
      const efforts = listed.reasoning?.supported_efforts;
      if (!efforts) problems.push(`${model.id}: reasoning "${effort}" is set and the list gives no reasoning efforts`);
      else if (!efforts.includes(effort) && effort !== 'none') {
        problems.push(`${model.id}: reasoning "${effort}" is not among the list's efforts (${efforts.join(', ')})`);
      }
    }
  }
  return problems;
}

/** USD per million tokens, from the list's per-token strings. */
const perMillion = (perToken) => Number((Number(perToken) * 1e6).toPrecision(12));

/**
 * A model's listed prices in USD per million tokens: the headline (OpenRouter's
 * cheapest endpoint), its cache-read price where listed, and each price tier
 * the list gives above a prompt size (`overrides[].min_prompt_tokens`).
 */
export function listedPricing(list, id) {
  const listed = (list?.data ?? []).find((m) => m.id === id);
  if (!listed?.pricing) return undefined;
  const p = listed.pricing;
  const prices = (o) => ({
    input: perMillion(o.prompt),
    output: perMillion(o.completion),
    ...(o.input_cache_read !== undefined ? { cacheRead: perMillion(o.input_cache_read) } : {}),
  });
  const tiers = (p.overrides ?? [])
    .filter((o) => typeof o.min_prompt_tokens === 'number')
    .map((o) => ({ minPromptTokens: o.min_prompt_tokens, ...prices({ ...p, ...o }) }));
  return { ...prices(p), tiers };
}

async function fetchOpenRouterList() {
  const res = await fetch(`${OPENROUTER_BASE_URL}/models`);
  if (!res.ok) throw new Error(`OpenRouter's model list answered ${res.status}`);
  return { fetchedAt: new Date().toISOString(), ...(await res.json()) };
}

// --- Cost: the figure of record, the reservation, and the bounds ---

/**
 * How far above its headline price a Claude model's dearest endpoint lists.
 * OpenRouter's model list gives one price per model, its cheapest endpoint's;
 * the endpoints lists, which this harness does not read, give the rest. S1
 * read Haiku 5.5's on 2026-11-03: four of its ten endpoints list 10% above
 * the headline, at every tier (hub `benchmark/runner/openrouter-models.json`
 * at `0c4232a`). Sonnet 5.5's endpoints are unmeasured, and the same factor
 * is taken for it.
 */
export const DEAREST_ENDPOINT_FACTOR = 1.1;

const scaled = (value, factor) => Number((value * factor).toPrecision(12));

/** The headline price of a model: every request at OpenRouter's cheapest endpoint. */
export function headlinePricing(model, list) {
  const listed = listedPricing(list, model.id);
  return listed ? { input: listed.input, output: listed.output } : undefined;
}

/**
 * THE RESERVATION PRICE, priced high on purpose so the cap stops early rather
 * than late (the seat's ruling, #740 comment 6728891704 point 4): a Claude
 * model at its dearest endpoint and at its dearest tier, the one above
 * 100,000 prompt tokens where the list gives it; an open-weight model at the
 * provider object's ceilings, since its headline is its cheapest endpoint and
 * not the endpoint a request lands on.
 */
export function reservationPricing(model, list) {
  if (model.provider) {
    return { input: model.provider.max_price.prompt, output: model.provider.max_price.completion };
  }
  const listed = listedPricing(list, model.id);
  if (!listed) return undefined;
  const dearest = [listed, ...listed.tiers].reduce((a, t) => (t.input + t.output > a.input + a.output ? t : a));
  return { input: scaled(dearest.input, DEAREST_ENDPOINT_FACTOR), output: scaled(dearest.output, DEAREST_ENDPOINT_FACTOR) };
}

/** The prices a request of `promptTokens` is billed at: the highest tier it reaches. */
function priceAt(pricing, promptTokens) {
  let price = pricing;
  for (const tier of pricing.tiers ?? []) if (promptTokens >= tier.minPromptTokens) price = tier;
  return price;
}

/** What one request costs at `pricing`, from its reported usage: cached prompt tokens at the cache-read price. */
export function requestCostUsd(usage, pricing) {
  const prompt = usage.prompt ?? 0;
  const cached = Math.min(usage.cachedPrompt ?? 0, prompt);
  const price = priceAt(pricing, prompt);
  const cacheRead = price.cacheRead ?? price.input;
  return ((prompt - cached) * price.input + cached * cacheRead + (usage.completion ?? 0) * price.output) / 1e6;
}

/** A request with no usage reported, counted at the most one could cost here. */
function worstRequestUsd(pricing) {
  return (APP_LIMITS.maxCumulativeTokens * pricing.input + APP_LIMITS.maxTokens * pricing.output) / 1e6;
}

/**
 * THE FIGURE OF RECORD for one request (S1's rule, hub `benchmark/README.md:271-275`
 * at `0c4232a`; the seat's G0 read, ruling 1): the larger of the cost at the
 * listed price and the cost OpenRouter reported, Claude rows included. With
 * no reported cost, the larger of the listed price's and the reservation
 * price's; with no usage, the most the request could cost.
 */
export function requestCosts(request, listed, reservation) {
  if (!request.usage) {
    return { listedUsd: null, reportedUsd: null, ofRecordUsd: worstRequestUsd(reservation), basis: 'reservation (no usage returned)' };
  }
  const listedUsd = requestCostUsd(request.usage, listed);
  const reportedUsd = typeof request.reportedCostUsd === 'number' ? request.reportedCostUsd : null;
  if (reportedUsd !== null) return { listedUsd, reportedUsd, ofRecordUsd: Math.max(listedUsd, reportedUsd), basis: 'larger of listed and reported' };
  return {
    listedUsd,
    reportedUsd,
    ofRecordUsd: Math.max(listedUsd, requestCostUsd(request.usage, reservation)),
    basis: 'larger of listed and reservation (no cost reported)',
  };
}

/**
 * The most one row could cost at `pricing`. The cumulative bound is checked
 * after a round, so the last round and the answering turn can carry a row past
 * it; three times the bound in prompt tokens and every possible response at
 * the limit (the first request, each round's, and the answering turn) covers
 * that with room, while no one round's tool results exceed the bound.
 */
export function rowCeilingUsd(pricing) {
  return (
    (3 * APP_LIMITS.maxCumulativeTokens * pricing.input + (APP_LIMITS.maxIterations + 2) * APP_LIMITS.maxTokens * pricing.output) / 1e6
  );
}

// --- What each model request reported ---

/** The fields kept from a chat-completions response. Never the request's headers. */
export function responseFacts(body) {
  const choice = body?.choices?.[0];
  const usage = body?.usage;
  return {
    id: body?.id,
    model: body?.model,
    provider: body?.provider,
    finishReason: choice?.finish_reason ?? null,
    nativeFinishReason: choice?.native_finish_reason ?? null,
    toolCallsRequested: choice?.message?.tool_calls?.length ?? 0,
    contentChars: typeof choice?.message?.content === 'string' ? choice.message.content.length : 0,
    usage: usage
      ? {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
          reasoning: usage.completion_tokens_details?.reasoning_tokens,
          cachedPrompt: usage.prompt_tokens_details?.cached_tokens,
        }
      : null,
    // What OpenRouter reported the request cost, in US dollars (`usage.cost`).
    reportedCostUsd: typeof usage?.cost === 'number' ? usage.cost : undefined,
    error: body?.error ? { code: body.error.code, message: body.error.message } : undefined,
  };
}

/**
 * A streamed response's chunks folded into the shape `responseFacts` reads:
 * the content's length, the last finish reason, model and provider each
 * reported, and the usage chunk.
 */
export function streamedBody(text) {
  let content = '';
  const body = { choices: [{ message: { content: '' } }], streamed: true };
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    for (const key of ['id', 'model', 'provider']) if (chunk[key] !== undefined) body[key] = chunk[key];
    if (chunk.usage) body.usage = chunk.usage;
    if (chunk.error) body.error = chunk.error;
    const choice = chunk.choices?.[0];
    if (typeof choice?.delta?.content === 'string') content += choice.delta.content;
    if (choice?.finish_reason) body.choices[0].finish_reason = choice.finish_reason;
    if (choice?.native_finish_reason) body.choices[0].native_finish_reason = choice.native_finish_reason;
  }
  body.choices[0].message.content = content;
  return body;
}

/**
 * The request parameters a request carried, read from its body as sent: the
 * model, the token-limit and reasoning fields, the `provider` object, whether
 * it streamed, the message and tool counts and the tools' names, and the
 * body's length in characters (what `--calibrate` reads characters a token
 * from).
 */
export function sentFacts(body) {
  let parsed;
  try {
    parsed = typeof body === 'string' ? JSON.parse(body) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!parsed) return undefined;
  return {
    model: parsed.model,
    max_tokens: parsed.max_tokens,
    max_completion_tokens: parsed.max_completion_tokens,
    reasoning_effort: parsed.reasoning_effort,
    provider: parsed.provider,
    stream: parsed.stream,
    messages: Array.isArray(parsed.messages) ? parsed.messages.length : undefined,
    tools: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
    toolNames: Array.isArray(parsed.tools) ? parsed.tools.map((t) => t.function?.name) : [],
    bodyChars: body.length,
  };
}

/**
 * A fetch for one row's OpenAI client. It changes one thing in a request: a
 * row with a `provider` object (an open-weight model's, #740 D3 = A) has it
 * added to the body, since the shared loop builds every body from the model's
 * request parameters alone and has no field for extra body properties. It
 * records what was sent and what came back, a streamed body included, and
 * refuses to send anything once the row is closed.
 */
export function recordingFetch(row, baseFetch = globalThis.fetch) {
  return async (url, init) => {
    if (row.closed) throw new Error(`Row ${row.label} was closed after its timeout; request not sent`);
    let sendInit = init;
    if (row.provider && typeof init?.body === 'string') {
      const body = JSON.parse(init.body);
      sendInit = { ...init, body: JSON.stringify({ ...body, provider: row.provider }) };
    }
    const startedAt = Date.now();
    const res = await baseFetch(url, sendInit);
    const record = { status: res.status, durationMs: Date.now() - startedAt, sent: sentFacts(sendInit?.body) };
    try {
      const text = await res.clone().text();
      const streamed = (res.headers.get('content-type') ?? '').includes('text/event-stream');
      Object.assign(record, responseFacts(streamed ? streamedBody(text) : JSON.parse(text)), streamed ? { streamed: true } : {});
    } catch {
      record.unreadable = true;
    }
    row.requests.push(record);
    return res;
  };
}

// --- The automatic checks ---

/** The dataset a `get_data` call addressed: `dataset_id`, or a metadata call's `query`. */
function datasetOf(call) {
  const args = call.args ?? {};
  if (typeof args.dataset_id === 'string') return args.dataset_id;
  if (args.type === 'metadata' && typeof args.query === 'string') return args.query;
  return undefined;
}

/**
 * The automatic checks for one row (#573 P0, and #740's two). Facts only:
 * whether the expected dataset was called, answered and cited; whether the
 * query's portal answered; the tool and budget counts; what the model
 * requests reported — any response ended at its length limit, the reasoning
 * spent, whether a response ran past the limit it was sent, and whether the
 * endpoint's `total_tokens` (the figure the cumulative bound sums) contains
 * the reasoning it reported; and, on an in-loop row, the pause check and the
 * citation check (`scripts/eval-checks.mjs`).
 *
 * What the row's calls REACHED is the site's own reading of a run
 * (`summaryDataSources`): the portal and dataset of every call the source
 * answered, refused calls skipped. So a portal only a refused call named is
 * never listed here as reached — the property
 * `src/lib/portal-lists-name-no-refused-portal-as-reached.test.ts` holds every
 * such list to — and the refusals are a count, as the site states them.
 */
export function rowChecks(query, result, requests) {
  const calls = result.toolsCalled ?? [];
  const expected = query.expectedDataset;
  const reached = summaryDataSources(calls);
  const withUsage = requests.filter((r) => r.usage);
  const reasoningReported = withUsage.filter((r) => typeof r.usage.reasoning === 'number' && r.usage.reasoning > 0);
  const limitOf = (r) => r.sent?.max_tokens ?? r.sent?.max_completion_tokens;

  return {
    expectedDataset: expected,
    expectedDatasetCalled: expected ? calls.some((c) => datasetOf(c) === expected) : null,
    expectedDatasetAnswered: expected ? reached.some((s) => s.datasetId === expected) : null,
    expectedDatasetCited: expected ? (result.response ?? '').includes(expected) : null,
    dataQueries: calls.filter((c) => c.args?.type === 'query').length,
    portal: query.portal,
    portalAnswered: reached.some((s) => s.portal === query.portal),
    sourcesReached: reached,
    toolCallCount: calls.length,
    failedToolCalls: rejectedRequestCount(calls),
    budgetExceeded: Boolean(result.budgetExceeded),
    emptyAnswer: !(result.response ?? '').trim(),
    requests: requests.length,
    requestsWithoutUsage: requests.length - withUsage.length,
    finishedAtLength: requests.filter((r) => r.finishReason === 'length').length,
    limitOverrun: requests.some((r) => r.usage && limitOf(r) !== undefined && r.usage.completion > limitOf(r)),
    reasoningTokens: withUsage.reduce((s, r) => s + (r.usage.reasoning ?? 0), 0),
    reasoningCounted: reasoningReported.length === 0
      ? null
      : reasoningReported.every((r) => r.usage.completion >= r.usage.reasoning && r.usage.total >= r.usage.prompt + r.usage.reasoning),
    capSumMatches: withUsage.length === requests.length
      ? result.totalTokens === withUsage.reduce((s, r) => s + (r.usage.total ?? 0), 0)
      : null,
    pause: result.consent ? pauseCheck({ consent: result.consent, toolCalls: calls }) : null,
    citation: result.consent ? citationCheck(result.response, calls) : null,
  };
}

// --- The tool-result check's verdicts (October's; above) ---

/** Lower-case letters and digits only: what a quote is compared on. */
export function alnum(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when the text holds a balanced `{…}` that parses as a JSON object. */
function containsJsonObject(text) {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          if (parsed && typeof parsed === 'object') return true;
        } catch {
          // not JSON; try the next opening brace
        }
        break;
      }
    }
  }
  return false;
}

/** How a tool result's text is built, in the terms the finding is stated in. */
export function resultShape(text) {
  const trimmed = String(text ?? '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return 'json-array';
    if (parsed && typeof parsed === 'object') return 'json-object';
  } catch {
    // not JSON as a whole
  }
  if (!/[{}]/.test(trimmed)) return 'text-no-braces';
  return containsJsonObject(trimmed) ? 'text-with-json-object' : 'text-with-braces';
}

/** For a captured result: the first 40 characters of its first and last lines with words in them. */
export function genericExpectations(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter((l) => alnum(l).length >= 12);
  if (lines.length === 0) return [];
  const head = (line) => line.slice(0, 40);
  return lines.length === 1 ? [head(lines[0])] : [head(lines[0]), head(lines.at(-1))];
}

/**
 * The verdict for one model on one recorded result: whole when every expected
 * value is in the answer, lost when none is, partial between, and
 * inconclusive when the model never called the tool, so the text was never
 * sent to it.
 */
export function quoteVerdict(expect, answer, toolCalled) {
  const found = expect.map((e) => alnum(answer).includes(alnum(e)));
  if (!toolCalled) return { verdict: 'inconclusive', found };
  if (found.length > 0 && found.every(Boolean)) return { verdict: 'whole', found };
  if (found.some(Boolean)) return { verdict: 'partial', found };
  return { verdict: 'lost', found };
}

// --- Output ---

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function count(rows, predicate) {
  return rows.filter(predicate).length;
}

const round4 = (value) => Math.round(value * 10_000) / 10_000;

/**
 * The results file: metadata, every row with its checks, every error, and a
 * per-model summary of the automatic checks. `rowsWritten` (results plus errors) equal to
 * `rowsExpected` (the plan's rows) is the owner leg's acceptance. It holds no
 * key check and no balance: neither is passed in.
 */
export function buildOutput({ meta, models, queries, rows, results, errors }) {
  const rowsExpected = rows ? rows.length : models.length * queries.length;
  const rowsWritten = results.length + errors.length;
  const verdicts = (checks, key) => {
    const applied = checks.filter((c) => c?.[key]);
    return `${count(applied, (c) => c[key].pass)}/${applied.length}`;
  };
  return {
    metadata: {
      ...meta,
      routing: 'in-loop',
      limits: { ...APP_LIMITS, queryTimeoutMs: QUERY_TIMEOUT_MS },
      openWeightProvider: OPEN_WEIGHT_PROVIDER,
      modelsEvaluated: models.map((m) => m.id),
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        ...(m.catalogId ? { catalogId: m.catalogId } : {}),
        requestSettings: m.requestSettings ?? null,
        requestParameters: modelRequestParameters(m.requestSettings, APP_LIMITS.maxTokens),
        provider: m.provider ?? null,
      })),
      queriesRun: queries.map((q) => q.id),
      pauseSet: PAUSE_SET,
      rowsExpected,
      rowsWritten,
      complete: rowsWritten === rowsExpected,
      totalRuns: results.length,
      totalErrors: errors.length,
      totalTimeouts: count(errors, (e) => e.isTimeout),
      totalBudgetExceeded: count(results, (r) => r.budgetExceeded),
      guidanceFallbackRows: count(results, (r) => r.guidanceFallback),
    },
    results,
    errors,
    summary: models.map((model) => {
      const modelRows = results.filter((r) => r.modelId === model.id);
      const modelErrors = errors.filter((e) => e.modelId === model.id);
      const checks = modelRows.map((r) => r.checks);
      const withExpected = checks.filter((c) => c.expectedDataset);
      const offHome = modelRows.filter((r) => r.portal !== HOME_PORTAL);
      const totalTokens = modelRows.reduce((s, r) => s + r.totalTokens, 0);
      const requests = modelRows.flatMap((r) => r.requests ?? []);
      return {
        modelId: model.id,
        modelName: model.name,
        role: model.role,
        queriesRun: modelRows.length,
        errors: modelErrors.length,
        timeouts: count(modelErrors, (e) => e.isTimeout),
        budgetExceeded: count(checks, (c) => c.budgetExceeded),
        expectedDatasetCalled: `${count(withExpected, (c) => c.expectedDatasetCalled)}/${withExpected.length}`,
        expectedDatasetAnswered: `${count(withExpected, (c) => c.expectedDatasetAnswered)}/${withExpected.length}`,
        expectedDatasetCited: `${count(withExpected, (c) => c.expectedDatasetCited)}/${withExpected.length}`,
        otherPortalAnswered: `${count(offHome, (r) => r.checks.portalAnswered)}/${offHome.length}`,
        pauseCheckPassed: verdicts(checks, 'pause'),
        citationCheckPassed: verdicts(checks, 'citation'),
        guidanceFallbackRows: count(modelRows, (r) => r.guidanceFallback),
        servedBy: [...new Set(requests.map((q) => q.provider).filter(Boolean))].sort(),
        avgToolCalls: modelRows.length ? Math.round((modelRows.reduce((s, r) => s + r.toolCallCount, 0) / modelRows.length) * 10) / 10 : 0,
        failedToolCalls: checks.reduce((s, c) => s + c.failedToolCalls, 0),
        emptyAnswers: count(checks, (c) => c.emptyAnswer),
        responsesAtLength: checks.reduce((s, c) => s + c.finishedAtLength, 0),
        limitOverruns: count(checks, (c) => c.limitOverrun),
        reasoningTokens: checks.reduce((s, c) => s + c.reasoningTokens, 0),
        totalTokens,
        avgTokensPerQuery: modelRows.length ? Math.round(totalTokens / modelRows.length) : 0,
        medianDurationMs: median(modelRows.map((r) => r.durationMs)),
        costUsd: round4(modelRows.reduce((s, r) => s + (r.costUsd ?? 0), 0)),
        listedCostUsd: round4(requests.reduce((s, q) => s + (q.cost?.listedUsd ?? 0), 0)),
        reportedCostUsd: round4(requests.reduce((s, q) => s + (q.cost?.reportedUsd ?? 0), 0)),
      };
    }),
  };
}

// --- Query execution ---

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function newRow(label, provider) {
  return { label, closed: false, requests: [], ...(provider ? { provider } : {}) };
}

function clientFor(row, apiKey) {
  return new OpenAI({ baseURL: OPENROUTER_BASE_URL, apiKey, fetch: recordingFetch(row) });
}

/** Each request priced (`cost`), and the row's figure of record. */
function priceRequests(requests, listed, reservation) {
  for (const request of requests) request.cost = requestCosts(request, listed, reservation);
  return requests.reduce((sum, r) => sum + r.cost.ofRecordUsd, 0);
}

const sha256Text = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** One row: the routing at its configuration, the shared loop, and what it recorded. */
async function runRow(client, row, spec, model, query, configured, now) {
  const askedSources = new Set();
  const loads = [];
  const routing = await routingFor(spec, query, configured, now, askedSources);
  const result = await runToolLoop({
    client,
    ...loopOptions({
      model,
      query,
      routing,
      loadStep: recordedLoadStep(routing, askedSources, loads),
      executeToolCall: (name, args) => {
        if (row.closed) throw new Error(`Row ${row.label} was closed after its timeout; tool call not sent`);
        return routing.executeToolCall(name, args);
      },
    }),
  });
  const components = routing.components();
  return {
    key: spec.key,
    queryId: query.id,
    modelId: model.id,
    modelName: model.name,
    repeat: spec.repeat,
    consent: spec.consent,
    query: query.query,
    portal: query.portal,
    category: query.category,
    expectedDataset: query.expectedDataset,
    response: result.content,
    // The loop's records: the operation type, the reason line, result row and
    // column counts, per-call duration, whether a call failed and how (#321),
    // and on a load its outcome.
    toolsCalled: result.toolCalls,
    toolCallCount: result.toolCalls.length,
    loads,
    directory: routing.directory,
    loaded: routing.loaded(),
    components,
    guidanceFallback: components.some((c) => c.guidanceOrigin === 'fallback'),
    firstRequest: {
      systemPromptSha256: sha256Text(routing.firstSystemPrompt),
      systemPromptChars: routing.firstSystemPrompt.length,
      tools: routing.firstTools.map((t) => t.function.name),
    },
    finalSystemPromptSha256: sha256Text(routing.systemPrompt()),
    assertedDate: routing.assertedDate,
    iterations: result.iterations,
    answeringTurnTaken: result.answeringTurnTaken,
    inputTokens: result.usage.promptTokens,
    outputTokens: result.usage.completionTokens,
    totalTokens: result.usage.totalTokens,
    durationMs: result.durationMs,
    budgetExceeded: result.tokenLimitExceeded,
    timestamp: new Date().toISOString(),
  };
}

// --- Plans ---

const consentLabel = (consent) => (consent.mode === 'ask-first' ? `${consent.alias}-ask-first-${consent.decision}` : 'every-source-on');

function rowSpec(model, query, repeat, consent) {
  return { key: `${model.id} ${query.id} r${repeat} ${consentLabel(consent)}`, modelId: model.id, queryId: query.id, repeat, consent };
}

/**
 * The rows a form runs (#740 P1 part 6), after EVAL_MODELS / EVAL_QUERIES /
 * EVAL_REPEATS for a full run.
 *
 * THE RUN'S ORDER: the first repeat of the fifteen queries, then the pause
 * set, then the second and third repeats; within each, query by query, every
 * model on a query before the next. A cap stop starts no row after it, so it
 * loses the last repeat's last queries on every model alike, and the pause
 * set, which the two checks need, runs early.
 */
export function planFor(mode, env = {}) {
  if (mode === 'probe') {
    const queries = TEST_QUERIES.filter((q) => PROBE.queries.includes(q.id));
    const askFirst = TEST_QUERIES.find((q) => q.id === PROBE.askFirst.query);
    const rows = [
      ...queries.flatMap((q) => ALL_MODELS.map((m) => rowSpec(m, q, 1, EVERY_SOURCE_ON))),
      ...ALL_MODELS.map((m) => rowSpec(m, askFirst, 1, goldAskFirst(PROBE.askFirst.decision))),
    ];
    return { models: ALL_MODELS, queries, rows };
  }
  const modelFilter = env.EVAL_MODELS?.split(',').map((s) => s.trim());
  const queryFilter = env.EVAL_QUERIES?.split(',').map((s) => parseInt(s.trim()));
  if (modelFilter) {
    const unknown = modelFilter.filter((id) => !ALL_MODELS.some((m) => m.id === id));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown model ID(s): ${unknown.join(', ')}\nAvailable models:\n${ALL_MODELS.map((m) => `  ${m.id} (${m.name})`).join('\n')}`,
      );
    }
  }
  let repeats = RUN_REPEATS;
  if (env.EVAL_REPEATS !== undefined) {
    repeats = Number(env.EVAL_REPEATS);
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > RUN_REPEATS) throw new Error(`EVAL_REPEATS takes 1 to ${RUN_REPEATS}`);
  }
  const models = modelFilter ? ALL_MODELS.filter((m) => modelFilter.includes(m.id)) : ALL_MODELS;
  const queries = queryFilter ? TEST_QUERIES.filter((_, i) => queryFilter.includes(i + 1)) : TEST_QUERIES;
  const block = (repeat) => queries.flatMap((q) => models.map((m) => rowSpec(m, q, repeat, EVERY_SOURCE_ON)));
  const pauseRows = queries
    .filter((q) => PAUSE_SET.queries.includes(q.id))
    .flatMap((q) => PAUSE_SET.decisions.flatMap((decision) => models.map((m) => rowSpec(m, q, 1, goldAskFirst(decision)))));
  const rows = [...block(1), ...pauseRows];
  for (let repeat = 2; repeat <= repeats; repeat++) rows.push(...block(repeat));
  return { models, queries, rows };
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * The cost bounds of a plan: every row at its ceiling, priced high (the
 * reservation price) and at the headline price, printed side by side (#740 P1
 * part 5).
 */
export function planBounds(plan, list) {
  let highUsd = 0;
  let headlineUsd = 0;
  const unpriced = [];
  for (const spec of plan.rows) {
    const model = plan.models.find((m) => m.id === spec.modelId);
    const high = reservationPricing(model, list);
    const headline = headlinePricing(model, list);
    if (!high || !headline) {
      unpriced.push(model.id);
      continue;
    }
    highUsd += rowCeilingUsd(high);
    headlineUsd += rowCeilingUsd(headline);
  }
  return { highUsd, headlineUsd, unpriced: [...new Set(unpriced)] };
}

function usd(value) {
  return `$${value.toFixed(2)}`;
}

/** The two bounds, high-priced above and headline beside it. */
function boundLines(label, highUsd, headlineUsd) {
  return [
    `${label}, high-priced: ${usd(highUsd)} (Claude at its dearest endpoint and tier; open-weight at the provider object's ceilings)`,
    `${label}, headline:    ${usd(headlineUsd)} (every request at its model's headline price)`,
  ];
}

function printPlan(plan, list, listLabel) {
  console.log(`OpenRouter list: ${listLabel}`);
  console.log('');
  console.log('Model'.padEnd(28) + 'Role'.padEnd(13) + 'Request parameters'.padEnd(64) + 'USD/MTok headline | reservation');
  for (const m of plan.models) {
    const headline = headlinePricing(m, list);
    const high = reservationPricing(m, list);
    const params = { ...modelRequestParameters(m.requestSettings, APP_LIMITS.maxTokens), ...(m.provider ? { provider: m.provider } : {}) };
    console.log(
      m.id.padEnd(28) +
        m.role.padEnd(13) +
        `${JSON.stringify(params)} `.padEnd(64) +
        (headline ? `${headline.input} / ${headline.output} | ${high.input} / ${high.output}` : 'not listed'),
    );
  }
  console.log('');
  console.log(`Queries: ${plan.queries.length} (${plan.queries.map((q) => q.id).join(', ')})`);
  const pause = plan.rows.filter((r) => r.consent.mode === 'ask-first').length;
  console.log(`Rows: ${plan.rows.length} (${plan.rows.length - pause} with every source On, ${pause} with Socrata Ask first)`);
  const bounds = planBounds(plan, list);
  for (const line of boundLines('Ceiling, every row at the app\'s limits', bounds.highUsd, bounds.headlineUsd)) console.log(line);
  if (bounds.unpriced.length) console.log(`Not priced (absent from the list): ${bounds.unpriced.join(', ')}`);
  return bounds;
}

// --- Main ---

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function printRosterProblems(problems) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
}

function printSources(configured) {
  console.log('Configured sources and their hosting:');
  for (const s of sourceHostings(configured)) console.log(`  ${s.alias.padEnd(18)} ${s.hosting.padEnd(15)} (${s.variable})`);
}

async function checkSlugsLive() {
  const list = await fetchOpenRouterList();
  const problems = checkRoster(ALL_MODELS, list);
  console.log(`OpenRouter list read ${list.fetchedAt}: ${list.data.length} models listed`);
  for (const m of ALL_MODELS) {
    const listed = list.data.find((x) => x.id === m.id);
    console.log(`  ${listed ? '✓' : '✗'} ${m.id}${listed ? ` (${listed.canonical_slug})` : ''}`);
  }
  if (problems.length) {
    console.error(`\nRoster check FAILED (${problems.length}):`);
    printRosterProblems(problems);
    process.exit(1);
  }
  console.log(`\nRoster check OK: ${ALL_MODELS.length} models.`);
}

/** A transport for the dry run: it reaches no source. */
const refuseCall = async () => {
  throw new Error('the dry run reaches no source');
};

/**
 * The dry run (#740 P1 part 8): no network call. Each row's FIRST request —
 * model, system prompt sha256 and length, tool names, token-limit field,
 * reasoning and `provider` object — composed by the app's own code at the
 * environment's source configuration. The requests after a load depend on the
 * model's answers and are not printed (the seat's G0 read).
 */
async function dryRun(options) {
  const plan = planFor(options.mode, process.env);
  const snapshot = loadJson(OPENROUTER_SNAPSHOT);
  console.log(`=== Dry run (${options.mode}): no network call is made ===\n`);
  let configured = readMcpEnvFromProcess();
  if (!configured.socrataUrl) {
    console.log('SOCRATA_MCP_URL is unset: the first requests below are composed as if it were set. A run refuses to start without it.\n');
    configured = { ...configured, socrataUrl: 'https://socrata-mcp.invalid' };
  }
  printSources(configured);
  const sandbox = sandboxProblem(configured);
  if (sandbox) fail(sandbox);
  console.log('');
  printPlan(plan, snapshot, `the recorded copy read ${snapshot.fetchedAt} (${OPENROUTER_SNAPSHOT})`);
  const problems = checkRoster(plan.models, snapshot);
  if (problems.length) {
    console.error(`\nRoster check against the recorded list FAILED (${problems.length}):`);
    printRosterProblems(problems);
    process.exit(1);
  }
  console.log('\nRoster check against the recorded list: OK.');

  console.log('\nEach row\'s first request:');
  const now = new Date();
  for (const [index, spec] of plan.rows.entries()) {
    const model = plan.models.find((m) => m.id === spec.modelId);
    const query = TEST_QUERIES.find((q) => q.id === spec.queryId);
    const routing = await routingFor(spec, query, configured, now, new Set(), refuseCall);
    const params = modelRequestParameters(model.requestSettings, APP_LIMITS.maxTokens);
    const limitField = Object.hasOwn(params, 'max_completion_tokens') ? 'max_completion_tokens' : 'max_tokens';
    console.log(
      `  [${index + 1}] ${spec.key}: model ${model.id}; system sha256 ${sha256Text(routing.firstSystemPrompt).slice(0, 12)} ` +
        `(${routing.firstSystemPrompt.length} chars); tools [${routing.firstTools.map((t) => t.function.name).join(', ')}]; ` +
        `${limitField} ${params[limitField]}; reasoning ${params.reasoning_effort ?? 'none'}; ` +
        `provider ${model.provider ? JSON.stringify(model.provider) : 'none'}`,
    );
  }
  console.log(`\nRows: ${plan.rows.length}`);
  if (options.capUsd !== undefined) console.log(`Cap: ${usd(options.capUsd)}`);
}

async function checkKey(apiKey) {
  const res = await fetch(`${OPENROUTER_BASE_URL}/key`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) fail(`OpenRouter refused the key (${res.status} from its key endpoint); nothing was spent`);
  const data = (await res.json())?.data ?? {};
  const fmt = (v) => (typeof v === 'number' ? usd(v) : String(v ?? 'none'));
  console.log(`Key check: OK (limit ${fmt(data.limit)}, used ${fmt(data.usage)}, remaining ${fmt(data.limit_remaining)})`);
}

/**
 * The checks every model-calling form makes before its first model request,
 * in order, each exiting with its stop line: the source configuration, the
 * roster against the live list, the key, and the Socrata guidance's origin.
 * Returns what the run needs.
 */
async function checksBeforeSpending(models, apiKey, now) {
  const configured = readMcpEnvFromProcess();
  printSources(configured);
  const sandbox = sandboxProblem(configured);
  if (sandbox) fail(sandbox);

  const list = await fetchOpenRouterList();
  console.log(`\nOpenRouter list: live, read ${list.fetchedAt} (${list.data.length} models)`);
  const problems = checkRoster(models, list);
  if (problems.length) {
    console.error(`\nRoster check FAILED (${problems.length}); nothing was spent:`);
    printRosterProblems(problems);
    process.exit(1);
  }
  console.log('Roster check: OK.');

  await checkKey(apiKey);

  const origin = await socrataGuidanceOrigin(configured, now);
  console.log(`Socrata guidance, as a load composes it for ${HOME_PORTAL}: ${origin}`);
  if (origin === 'fallback') {
    fail("the Socrata guidance fell back to the app's fallback text: the server's guidance did not arrive, so a row would not be the app's; nothing was sent to a model");
  }
  return { configured, list };
}

/** `--preflight`: the checks before spending, and nothing else. */
async function preflight() {
  console.log('=== Preflight: no model request is sent ===\n');
  console.log('Environment (by name):');
  for (const line of environmentLines(process.env)) console.log(line);
  console.log('');
  const key = keyProblem(process.env);
  if (key) fail(key);
  if (!process.env.SOCRATA_MCP_URL) fail('SOCRATA_MCP_URL environment variable is required (no reference-host default)');
  await checksBeforeSpending(ALL_MODELS, process.env.OPENROUTER_API_KEY, new Date());
  console.log('\nPreflight OK. Nothing was sent to a model.');
}

// --- Calibration (#740 P1 part 10) ---

/** The share taken off the fewest characters a token (S1, hub `calibration.mjs` `CALIBRATION_MARGIN`). */
export const CALIBRATION_MARGIN = 0.1;

const floor4 = (x) => Math.floor(x * 1e4) / 1e4;

/**
 * THE CALIBRATED PROFILE, per model, from the probe's rows (S1's method, hub
 * `benchmark/preregistration/s1.md:321-337` and `:365-375` at `0c4232a`,
 * read, not imported; adapted to a row of up to 20 rounds):
 *
 *   - characters a token: the fewest characters of a request body's JSON per
 *     billed prompt token over the model's requests, less 10% (S1 point 1);
 *   - the completion allowance: twice the largest billed completion
 *     (reasoning included), and never above the 4,000-token limit (S1 point 2);
 *   - NEW for a multi-round row: the largest number of requests one row made,
 *     and the largest billed prompt tokens one row summed. A row's calibrated
 *     reservation is twice each, never above the row's ceiling (the
 *     answering turn and every round, 22 requests; three times the cumulative
 *     bound, 600,000 prompt tokens): S1's doubling of what was measured,
 *     taken over the row instead of over one request.
 */
export function calibrationProfile(probe) {
  const byModel = {};
  for (const row of [...(probe.results ?? []), ...(probe.errors ?? [])]) {
    const m = (byModel[row.modelId] ??= { rows: 0, requests: 0, fewest: Infinity, largestCompletion: 0, largestRowRequests: 0, largestRowPrompt: 0 });
    m.rows++;
    const requests = row.requests ?? [];
    m.largestRowRequests = Math.max(m.largestRowRequests, requests.length);
    let rowPrompt = 0;
    for (const request of requests) {
      if (!request.usage) continue;
      m.requests++;
      const prompt = request.usage.prompt ?? 0;
      rowPrompt += prompt;
      m.largestCompletion = Math.max(m.largestCompletion, request.usage.completion ?? 0, request.usage.reasoning ?? 0);
      if (prompt > 0 && request.sent?.bodyChars) m.fewest = Math.min(m.fewest, request.sent.bodyChars / prompt);
    }
    m.largestRowPrompt = Math.max(m.largestRowPrompt, rowPrompt);
  }
  const profile = {};
  for (const [id, m] of Object.entries(byModel)) {
    profile[id] = {
      rows: m.rows,
      requests: m.requests,
      charsPerToken: Number.isFinite(m.fewest) ? floor4(m.fewest * (1 - CALIBRATION_MARGIN)) : null,
      largestCompletion: m.largestCompletion,
      completionAllowance: Math.min(APP_LIMITS.maxTokens, 2 * m.largestCompletion),
      largestRowRequests: m.largestRowRequests,
      largestRowPromptTokens: m.largestRowPrompt,
      rowRequests: Math.min(APP_LIMITS.maxIterations + 2, 2 * m.largestRowRequests),
      rowPromptTokens: Math.min(3 * APP_LIMITS.maxCumulativeTokens, 2 * m.largestRowPrompt),
    };
  }
  return profile;
}

/** One row's calibrated reservation at `pricing`. */
function calibratedRowUsd(p, pricing) {
  return (p.rowPromptTokens * pricing.input + p.rowRequests * p.completionAllowance * pricing.output) / 1e6;
}

/**
 * The calibrated bound over a plan's rows: each row at its model's calibrated
 * reservation, priced high and at the headline. A model the probe did not
 * measure is counted at its full ceiling and named.
 */
export function calibratedBound(profile, plan, list) {
  let highUsd = 0;
  let headlineUsd = 0;
  const uncalibrated = new Set();
  for (const spec of plan.rows) {
    const model = plan.models.find((m) => m.id === spec.modelId);
    const p = profile[model.id];
    const high = reservationPricing(model, list);
    const headline = headlinePricing(model, list);
    if (!p || p.requests === 0) {
      uncalibrated.add(model.id);
      highUsd += rowCeilingUsd(high);
      headlineUsd += rowCeilingUsd(headline);
      continue;
    }
    highUsd += calibratedRowUsd(p, high);
    headlineUsd += calibratedRowUsd(p, headline);
  }
  return { highUsd, headlineUsd, uncalibrated: [...uncalibrated] };
}

/** The ceiling (#740 D9 = A) and the most the sprint's model spend may reach in all (the owner's note; the seat's G0 read, ruling 1). */
export const CEILING_USD = 80;
export const IN_ALL_USD = 150;

/**
 * The cap rule (#740 D9; the seat's G0 read, ruling 1): a bound at or under
 * $80 sets the cap to the bound rounded up to a whole dollar; a bound above
 * $80 runs only while the probe's recorded spend plus the cap stays at or
 * under $150; otherwise no run, and the seat takes it to the owner.
 */
export function capRule(boundUsd, probeSpendUsd) {
  const cap = Math.ceil(boundUsd);
  if (boundUsd <= CEILING_USD) {
    return { run: true, cap, line: `the bound is at or under ${usd(CEILING_USD)}: the cap is the bound rounded up, --cap ${cap}` };
  }
  const inAll = probeSpendUsd + cap;
  if (inAll <= IN_ALL_USD) {
    return {
      run: true,
      cap,
      line: `the bound is above ${usd(CEILING_USD)}; the probe's recorded spend ${usd(probeSpendUsd)} plus the cap ${usd(cap)} is ${usd(inAll)}, at or under ${usd(IN_ALL_USD)}: --cap ${cap}`,
    };
  }
  return {
    run: false,
    cap: null,
    line: `the bound is above ${usd(CEILING_USD)}, and the probe's recorded spend ${usd(probeSpendUsd)} plus the cap ${usd(cap)} would be ${usd(inAll)}, above ${usd(IN_ALL_USD)}: no run; the seat takes it to the owner`,
  };
}

/** `--calibrate <probe results file>`: no network. Exits 3 when the rule says no run. */
function calibrate(options) {
  const probe = loadJson(options.calibratePath);
  if (probe.metadata?.mode !== 'probe') fail(`${options.calibratePath} is not a probe's results file (mode ${probe.metadata?.mode})`);
  const list = loadJson(OPENROUTER_SNAPSHOT);
  const profile = calibrationProfile(probe);
  const plan = planFor('run', process.env);
  const probeSpendUsd = probe.metadata.spend?.chargedUsd ?? 0;

  console.log(`=== Calibration from ${options.calibratePath}: no network call is made ===\n`);
  console.log(`Probe: ${probe.results.length + probe.errors.length} rows, recorded spend ${usd(probeSpendUsd)} (per request the larger of the listed and the reported cost)`);
  console.log(`Prices: the recorded list read ${list.fetchedAt}\n`);
  console.log('Per model (from the probe\'s rows):');
  for (const [id, p] of Object.entries(profile)) {
    console.log(
      `  ${id.padEnd(28)} ${p.charsPerToken ?? '—'} characters a token; largest completion ${p.largestCompletion}, allowance ${p.completionAllowance}; ` +
        `largest row ${p.largestRowRequests} requests, ${p.largestRowPromptTokens} prompt tokens; a row reserved at ${p.rowRequests} requests, ${p.rowPromptTokens} prompt tokens`,
    );
  }
  const bound = calibratedBound(profile, plan, list);
  console.log(`\nThe run: ${plan.rows.length} rows`);
  for (const line of boundLines('Calibrated bound', bound.highUsd, bound.headlineUsd)) console.log(line);
  if (bound.uncalibrated.length) console.log(`Not in the probe, counted at the full ceiling: ${bound.uncalibrated.join(', ')}`);
  const rule = capRule(bound.highUsd, probeSpendUsd);
  console.log(`\nCap rule: ${rule.line}`);
  if (!rule.run) process.exit(3);
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    fail(error.message);
  }

  if (options.mode === 'check-slugs') return checkSlugsLive();
  if (options.mode === 'calibrate') return calibrate(options);
  if (options.dryRun) {
    try {
      return await dryRun(options);
    } catch (error) {
      fail(error.message);
    }
  }
  if (options.mode === 'preflight') return preflight();

  const problem = runEnvProblem(process.env, options);
  if (problem) fail(problem);
  const apiKey = process.env.OPENROUTER_API_KEY;

  let plan;
  try {
    plan = planFor(options.mode, process.env);
  } catch (error) {
    fail(error.message);
  }

  console.log(`=== Model Evaluation Harness (${options.mode}) ===\n`);
  console.log(
    `Limits (the app's): ${APP_LIMITS.maxIterations} rounds, ${APP_LIMITS.maxTokens} tokens a request, ` +
      `${APP_LIMITS.maxCumulativeTokens.toLocaleString()} tokens cumulative a question, ${APP_LIMITS.toolTimeoutMs / 1000}s a tool call, ` +
      `${QUERY_TIMEOUT_MS / 1000}s a question\n`,
  );

  const startedAt = new Date();
  const { configured, list } = await checksBeforeSpending(plan.models, apiKey, startedAt);
  console.log('');
  const bounds = printPlan(plan, list, 'the live list above');
  console.log(`Cap: ${usd(options.capUsd)}${bounds.highUsd > options.capUsd ? ' (below the high-priced ceiling: the run can stop early)' : ''}`);

  const prices = new Map(plan.models.map((m) => [m.id, { listed: listedPricing(list, m.id), reservation: reservationPricing(m, list) }]));
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const outputPath = resolve(options.outDir, `eval-results-${options.mode}-${stamp}.json`);
  const meta = {
    mode: options.mode,
    date: startedAt.toISOString().split('T')[0],
    startedAt: startedAt.toISOString(),
    harness: { sha256: sha256Of(__filename), gitHead: gitHead() },
    node: process.version,
    mcpServer: process.env.SOCRATA_MCP_URL,
    sources: sourceHostings(configured),
    openRouterList: {
      fetchedAt: list.fetchedAt,
      models: Object.fromEntries(
        plan.models.map((m) => {
          const listed = list.data.find((x) => x.id === m.id);
          return [m.id, { canonicalSlug: listed?.canonical_slug, pricingPerMTok: prices.get(m.id).listed, reservationPerMTok: prices.get(m.id).reservation }];
        }),
      ),
    },
    spend: { capUsd: options.capUsd, chargedUsd: 0, stoppedAtCap: false },
  };

  const results = [];
  const errors = [];
  const charged = () => results.reduce((s, r) => s + r.costUsd, 0) + errors.reduce((s, e) => s + e.costUsd, 0);
  const gapMs = process.env.EVAL_ROW_GAP_MS !== undefined ? Number(process.env.EVAL_ROW_GAP_MS) : 1000;

  function save() {
    meta.spend.chargedUsd = round4(charged());
    meta.finishedAt = new Date().toISOString();
    writeFileSync(
      outputPath,
      JSON.stringify(buildOutput({ meta, models: plan.models, queries: plan.queries, rows: plan.rows, results, errors }), null, 2),
    );
  }

  console.log(`\nMCP server: ${process.env.SOCRATA_MCP_URL}\n`);

  for (const [index, spec] of plan.rows.entries()) {
    const model = plan.models.find((m) => m.id === spec.modelId);
    const query = plan.queries.find((q) => q.id === spec.queryId) ?? TEST_QUERIES.find((q) => q.id === spec.queryId);
    const { listed, reservation } = prices.get(model.id);
    if (charged() + rowCeilingUsd(reservation) > options.capUsd) {
      meta.spend.stoppedAtCap = true;
      console.log(`\nStopped before ${spec.key}: its worst case, at the reservation price, could carry the spend past the cap.`);
      break;
    }
    console.log(`[${index + 1}/${plan.rows.length}] ${spec.key}: "${query.query.slice(0, 60)}..."`);

    const row = newRow(spec.key, model.provider);
    try {
      const result = await withTimeout(runRow(clientFor(row, apiKey), row, spec, model, query, configured, startedAt), QUERY_TIMEOUT_MS);
      result.requests = row.requests;
      result.costUsd = priceRequests(row.requests, listed, reservation);
      result.checks = rowChecks(query, result, row.requests);
      results.push(result);

      const served = [...new Set(row.requests.map((r) => r.provider).filter(Boolean))];
      const flags = [
        result.budgetExceeded ? 'BUDGET EXCEEDED' : '',
        result.checks.finishedAtLength ? `${result.checks.finishedAtLength} AT LENGTH` : '',
        result.checks.expectedDataset && !result.checks.expectedDatasetCalled ? 'EXPECTED DATASET NOT CALLED' : '',
        result.checks.pause && !result.checks.pause.pass ? 'PAUSE CHECK FAILED' : '',
        result.checks.citation && !result.checks.citation.pass ? 'CITATION CHECK FAILED' : '',
        result.guidanceFallback ? 'GUIDANCE FELL BACK' : '',
      ].filter(Boolean);
      console.log(
        `  → loads ${result.loads.map((l) => `${l.alias}:${l.outcome}`).join(', ') || 'none'}; ${result.toolCallCount} tool calls, ` +
          `${result.totalTokens.toLocaleString()} tokens, ${(result.durationMs / 1000).toFixed(1)}s, ${usd(result.costUsd)}; ` +
          `served by ${served.join(', ') || 'not reported'}${flags.length ? ` [${flags.join('; ')}]` : ''}`,
      );
    } catch (error) {
      row.closed = true;
      const isTimeout = error.message.includes('Timed out');
      console.error(`  ✗ ${isTimeout ? 'TIMEOUT' : 'Error'}: ${error.message}`);
      const costUsd = priceRequests(row.requests, listed, reservation) + (isTimeout ? worstRequestUsd(reservation) : 0);
      errors.push({
        key: spec.key,
        queryId: query.id,
        modelId: model.id,
        repeat: spec.repeat,
        consent: spec.consent,
        error: error.message,
        isTimeout,
        // The same array the row's fetch writes to: a response still in
        // flight at the timeout lands here when it arrives.
        requests: row.requests,
        // A timed-out row may have one request in flight, counted at its worst.
        costUsd,
        timestamp: new Date().toISOString(),
      });
    }

    save();
    // Brief pause between rows to avoid rate limits
    if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
  }

  save();
  console.log(`\n=== Results saved to ${outputPath} ===`);

  const finalOutput = buildOutput({ meta, models: plan.models, queries: plan.queries, rows: plan.rows, results, errors });
  console.log('\n=== Summary ===\n');
  console.log(
    'Model'.padEnd(28) +
      'Rows'.padEnd(6) +
      'Dataset'.padEnd(9) +
      'Pause'.padEnd(7) +
      'Cite'.padEnd(7) +
      'Tools'.padEnd(7) +
      'AtLen'.padEnd(7) +
      'Avg tok'.padEnd(9) +
      'Med s'.padEnd(7) +
      'USD',
  );
  console.log('-'.repeat(100));
  for (const s of finalOutput.summary) {
    console.log(
      s.modelId.padEnd(28) +
        String(s.queriesRun).padEnd(6) +
        s.expectedDatasetAnswered.padEnd(9) +
        s.pauseCheckPassed.padEnd(7) +
        s.citationCheckPassed.padEnd(7) +
        String(s.avgToolCalls).padEnd(7) +
        String(s.responsesAtLength).padEnd(7) +
        String(s.avgTokensPerQuery).padEnd(9) +
        (s.medianDurationMs / 1000).toFixed(1).padEnd(7) +
        usd(s.costUsd),
    );
  }
  const m = finalOutput.metadata;
  console.log(`\nRows written ${m.rowsWritten} of ${m.rowsExpected}${m.complete ? '' : ' — INCOMPLETE'}; errors ${m.totalErrors} (timeouts ${m.totalTimeouts}); charged ${usd(meta.spend.chargedUsd)} of the ${usd(options.capUsd)} cap${meta.spend.stoppedAtCap ? ' — STOPPED AT CAP' : ''}.`);
  // A run the cap stopped is not the run that was asked for: exit 2, so a
  // script reading the status cannot take it for a finished one.
  if (meta.spend.stoppedAtCap) process.exitCode = 2;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
