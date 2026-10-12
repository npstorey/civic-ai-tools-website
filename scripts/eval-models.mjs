#!/usr/bin/env node

/**
 * Model evaluation harness for civic data queries.
 *
 * Runs a set of test queries against a roster of models via OpenRouter, using
 * the Socrata MCP server for tool calls. Captures each answer, every tool call,
 * every model request's usage, and the automatic checks below, for scoring
 * against the six-dimension rubric (hub docs/research/eval-queries.md;
 * civic-ai-tools-website#573).
 *
 * MODES
 *   (none)          The full run: every model in ALL_MODELS on every query.
 *   --probe         Two models on two queries (one of them a non-NYC portal),
 *                   then the tool-result check below. Run before the full run.
 *   --dry-run       Prints what the run (or, with --probe, the probe) would send
 *                   and its cost bounds, from the recorded OpenRouter list in
 *                   scripts/fixtures/eval-models/. Makes no network call and
 *                   needs no key.
 *   --check-slugs   Checks the roster against OpenRouter's live model list. A
 *                   public read; needs no key and calls no model.
 *   --cap <usd>     Required for any form that calls a model. The run stops
 *                   before a row whose worst case could carry the spend past it,
 *                   writes what it has, and exits 2.
 *   --out-dir <dir> Where the results file goes (default: this directory).
 *
 * WHAT A RUN CHECKS BEFORE IT SPENDS. In order: the environment (below); the
 * roster against OpenRouter's live list (`checkRoster` — every slug present,
 * tools supported, and every request parameter the model will be sent listed
 * as supported, so a stale or mistyped slug fails here and not in row 40); the
 * key, with one call to OpenRouter's key endpoint, which costs nothing and fails
 * on a key that is set but does not work. Only then the first model call.
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
 * its tool schema, and how it writes results up for scoring.
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
 * reads each response's usage (reasoning tokens included), finish reason,
 * responding model and provider, and the token-limit and reasoning fields the
 * request carried. Nothing in the request is changed and nothing from its
 * headers is kept. Each row has its own client, and a row that times out is
 * closed: a model request or tool call its abandoned loop makes afterwards is
 * refused rather than sent, so a timeout stops spending instead of carrying on
 * unseen beside the next row.
 *
 * THIS HARNESS IS PINNED TO OPENROUTER, AND THE APP IS NOT. Since
 * civic-ai-tools-website#30 the app reaches a configurable endpoint through
 * `src/lib/model-client.ts`, reading `MODEL_API_KEY` (with `OPENROUTER_API_KEY`
 * as its prior-era name) and `MODEL_API_BASE_URL` / `MODEL_API_KIND`. This
 * script reads none of that: it hardcodes OpenRouter's base URL and requires
 * `OPENROUTER_API_KEY` specifically. That is why the variable name below
 * differs from the one an operator now sets — the statement is accurate about
 * this script, not stale about the app. Repointing the harness at the endpoint
 * layer is tracked in civic-ai-tools#155 and is deliberately not a
 * find-and-replace.
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
 *   EVAL_MODELS      — comma-separated model IDs to test (default: all; full run only)
 *   EVAL_QUERIES     — comma-separated query indices to test, 1-based (default: all; full run only)
 *   DATA_COMMONS_API_KEY, BOSTON_OPENCONTEXT_MCP_URL — read by the site's client
 *                      in the probe's tool-result check, which captures one live
 *                      result from each source it can reach; a source it cannot
 *                      reach is recorded as such and skipped.
 *
 * Output: scripts/eval-results-<run|probe>-<UTC timestamp>.json (gitignored),
 * rewritten after every row so a partial run survives a stop.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import OpenAI from 'openai';

import { runToolLoop } from '../src/lib/model-loop/run-tool-loop.ts';
import { callMcpPrompt, callMcpTool } from '../src/lib/mcp/client.ts';
import { rejectedRequestCount, summaryDataSources } from '../src/lib/evidence/summary-sources.ts';
import {
  BUILT_IN_CATALOG,
  modelRequestParameters,
  modelRequestSettings,
} from '../src/lib/model-catalog.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const FIXTURES_DIR = resolve(__dirname, 'fixtures/eval-models');
const OPENROUTER_SNAPSHOT = resolve(FIXTURES_DIR, 'openrouter-models-2026-10-11.json');
const TOOL_RESULT_FIXTURES = resolve(FIXTURES_DIR, 'tool-results-2026-10-11.json');

// --- Models ---

/**
 * The controls are the built-in catalog as production runs it, so each one's
 * request settings are READ from its catalog entry (`modelRequestSettings`)
 * rather than restated here: a control sends exactly what the site sends that
 * model, and if the catalog's settings change the controls follow. Every
 * catalog entry is a control, in catalog order.
 *
 * Since the October 2026 ruling (#573) the catalog is the three models that
 * evaluation chose, each at the reasoning setting it was evaluated at, so the
 * controls send what the October run sent them as candidates.
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

/**
 * The October 2026 controls: the catalog as it stood before that ruling, kept
 * so a later run can compare with the October one. None carried a request
 * setting, so each is stated as none — `max_tokens` and no `reasoning_effort`,
 * exactly what the October run sent them. The slug is OpenRouter's listed
 * form: the catalog had Sonnet 4.6 as `anthropic/claude-sonnet-4-6`, an alias
 * OpenRouter resolves but does not list, so the slug check could not vouch for
 * it.
 */
const PRIOR_CONTROLS = [
  { id: 'openai/gpt-4o', name: 'GPT-4o', role: 'prior-control', requestSettings: undefined },
  { id: 'openai/gpt-5.4', name: 'GPT-5.4', role: 'prior-control', requestSettings: undefined },
  { id: 'google/gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', role: 'prior-control', requestSettings: undefined },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', role: 'prior-control', requestSettings: undefined },
];

/**
 * The October 2026 candidates the catalog did not take, at the settings they
 * were evaluated at (#573).
 *
 * Gemini 3.8 Flash also names its token limit `max_tokens`. OpenRouter's list
 * gives `max_tokens` and not `max_completion_tokens` among its supported
 * parameters (read 2026-10-11), and with a reasoning setting present
 * `modelRequestParameters` would otherwise send the limit as
 * `max_completion_tokens` — a field the list does not carry for this model, so
 * the 2,000-token limit every other model runs under might not apply to it.
 * `checkRoster` refuses that combination, so the setting is stated rather than
 * left to the default. A catalog entry for it would need the same.
 */
const CANDIDATES = [
  {
    id: 'google/gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    role: 'candidate',
    requestSettings: { reasoningEffort: 'medium', tokenLimitParameter: 'max_tokens' },
  },
  { id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', role: 'candidate', requestSettings: { reasoningEffort: 'medium' } },
];

export const ALL_MODELS = [...BUILT_IN_CATALOG.map(controlFromCatalog), ...PRIOR_CONTROLS, ...CANDIDATES];

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
    portal: 'data.sfgov.org',
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

// --- The probe ---

/**
 * The probe (#573): the two candidates the shortlist flagged — Gemini 3.8
 * Flash for its cautions and its cost per task, GPT-6.1 Sol for whether its
 * tool calls work through OpenRouter — on one NYC query and one on another
 * portal, which settles whether a per-call portal is honoured end to end.
 */
export const PROBE = {
  models: ['google/gemini-3.8-flash', 'openai/gpt-6.1-sol'],
  queries: ['Q1', 'Q2'],
};

/**
 * THE TOOL-RESULT CHECK (#573 premise 6). Through OpenRouter, a Google model
 * was found to receive a tool result whose text contained a JSON object as
 * that object alone (the chooser spike, 2026-10-11). Each recorded result is
 * handed to these models as a tool result — through `runToolLoop`, with a stub
 * tool that returns it — and each is asked for values only the whole text
 * holds. `gpt-4o` is the control: the instrument is only trusted where the
 * control reads the whole text, and the known-red entry (the server's guidance,
 * the spike's case) must come back lost on a Google model for the instrument
 * to have shown it can fail.
 */
export const QUOTE_MODELS = ['google/gemini-3.5-flash-lite', 'google/gemini-3.8-flash', 'openai/gpt-4o'];

/**
 * One live result per other source the site has, captured through the site's
 * own client in the probe — the text the site would send as the tool message.
 * Socrata's results are recorded in the fixture file instead: they need no key.
 */
export const LIVE_CAPTURES = [
  {
    id: 'data-commons-live',
    source: 'data-commons',
    tool: 'search_indicators',
    args: { query: 'median household income', places: ['New York City, USA'] },
  },
  {
    id: 'boston-opencontext-live',
    source: 'boston-opencontext',
    tool: 'ckan__search_datasets',
    args: { query: 'building permits', limit: 3 },
  },
];

const QUOTE_TOOL = {
  type: 'function',
  function: {
    name: 'read_result',
    description: 'Returns the recorded tool result this test is about.',
    parameters: {
      type: 'object',
      properties: { note: { type: 'string', description: 'Optional. Ignored.' } },
    },
  },
};

const GENERIC_QUOTE_QUESTION = 'Quote exactly the first line of the text that contains words, and its last such line.';

// --- Tool definitions (must match website's socrataMcpTools exactly) ---
// Copied from src/lib/mcp/tools.ts — the examples and property descriptions
// are critical for getting models to actually invoke the tool.

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_data',
      description: `Unified Socrata open data access tool. Supports multiple operation types:
- catalog: Search the catalog for datasets matching a query on a Socrata portal
- metadata: Get detailed metadata about a specific dataset
- query: Execute a SoQL query against a dataset to fetch and filter data
- metrics: Get row count, view count, last-updated timestamps for a dataset

IMPORTANT TIPS:
1. For type=metadata and type=metrics, pass the dataset ID in "dataset_id"
2. For type=query, ALWAYS start by fetching a sample with no WHERE clause to see actual column values
3. NYC 311 data uses field names like: complaint_type, descriptor, created_date, community_board
4. Field values are case-sensitive - fetch sample data first to see exact formats

Examples:
- Search catalog: { "type": "catalog", "portal": "data.cityofnewyork.us", "query": "311 complaints" }
- Get metadata: { "type": "metadata", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9" }
- Get metrics: { "type": "metrics", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9" }
- Fetch sample data first: { "type": "query", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9", "limit": 5 }
- Query with filter: { "type": "query", "portal": "data.cityofnewyork.us", "dataset_id": "erm2-nwe9", "select": "complaint_type, COUNT(*) as count", "group": "complaint_type", "order": "count DESC", "limit": 10 }`,
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['catalog', 'metadata', 'query', 'metrics'],
            description: 'The type of operation to perform',
          },
          portal: {
            type: 'string',
            description: 'Socrata portal domain (e.g., data.cityofnewyork.us, data.sfgov.org)',
          },
          query: {
            type: 'string',
            description: 'For type=catalog: search query. For type=metadata: the dataset ID. For type=query: optional full-text search within data.',
          },
          dataset_id: {
            type: 'string',
            description: 'Dataset identifier (required for type=query, metadata, and metrics)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of rows to return (default: 10)',
          },
          offset: {
            type: 'number',
            description: 'Number of rows to skip (for pagination)',
          },
          select: {
            type: 'string',
            description: 'SoQL select clause (for type=query)',
          },
          where: {
            type: 'string',
            description: 'SoQL where clause (for type=query)',
          },
          order: {
            type: 'string',
            description: 'SoQL order clause (for type=query)',
          },
          group: {
            type: 'string',
            description: 'SoQL group clause (for type=query)',
          },
        },
        required: ['type'],
      },
    },
  },
];

// --- Guardrails ---

const QUERY_TIMEOUT_MS = 120_000; // 120 seconds per query
const QUERY_TOKEN_CAP = 50_000;   // 50K tokens per query
/**
 * The token limit on every model request, unchanged from March. It equals the
 * comparison loop's (`COMPARE_MAX_TOKENS`); the `/ask` path sends 4,000. A
 * reasoning model spends its reasoning inside this limit, so the probe records
 * every response that ended at `length`.
 */
const MAX_TOKENS = 2000;
const MAX_ITERATIONS = 10;

/**
 * WHAT THE BUDGET GUARDRAIL IS NOW, AND WHAT IT WAS (#356).
 *
 * This file used to implement three tiers itself: a soft cap that broke its
 * own loop and forced a summary turn, a hard cap at twice the soft one that
 * returned a synthetic `[HARD ABORT]` string with no summary turn at all, and a
 * per-round estimate that broke *before* a call whose input looked likely to
 * cross either line.
 *
 * The shared loop carries one bound — `maxCumulativeTokens`, checked after each
 * round — which stops the loop and takes one final answering turn. So the soft
 * tier survives exactly, and `budgetExceeded` on each result still reports it.
 * The hard tier does not survive: `hardAbort` is removed from the result rather
 * than written out as a field that can no longer be true, and a run that would
 * once have returned a synthetic string now pays for one answering turn and
 * returns a real answer. Against that cost, the loop truncates every tool
 * result before it re-enters the transcript (`maxToolResultChars`) — a bound
 * this harness never had, on exactly the transcript growth the hard tier
 * existed to catch.
 *
 * The bound is a sum of each response's reported `total_tokens`. Whether a
 * reasoning model's reasoning is inside that figure is the endpoint's to say,
 * not this file's; each row's `checks.reasoningCounted` records what it said.
 *
 * `QUERY_TIMEOUT_MS` above is unchanged and still bounds a whole query rather
 * than a tool call. The loop takes an optional per-tool-call bound and this
 * harness deliberately passes none: it has never had one, and giving it one is
 * a behaviour change rather than a migration.
 */

// --- Arguments and environment ---

/** Parses this harness's flags. Throws an Error naming the problem. */
export function parseArgs(argv) {
  const options = { mode: 'run', dryRun: false, capUsd: undefined, outDir: __dirname };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--probe') options.mode = 'probe';
    else if (arg === '--check-slugs') options.mode = 'check-slugs';
    else if (arg === '--dry-run') options.dryRun = true;
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
  return options;
}

/**
 * The environment a model-calling form needs, or a named refusal. Checked in
 * this order — key, MCP URL, cap — before any network call.
 */
export function runEnvProblem(env, options) {
  const key = env.OPENROUTER_API_KEY;
  if (!key) return 'OPENROUTER_API_KEY environment variable is required';
  if (key.includes('op://')) {
    return 'OPENROUTER_API_KEY holds a 1Password reference, not a key. Run the command under `op run`, which resolves it.';
  }
  if (!env.SOCRATA_MCP_URL) return 'SOCRATA_MCP_URL environment variable is required (no reference-host default)';
  if (options.capUsd === undefined) return '--cap <usd> is required for a run that calls a model';
  return null;
}

// --- The roster against OpenRouter's list ---

/**
 * Every problem with `models` against OpenRouter's model list (`list.data`).
 * Empty means the run may start. Each check is one the run would otherwise
 * meet as a failed row: a slug the list does not carry, a model without tool
 * support, a request field the list does not give as supported for that model
 * (a limit sent under a name the model does not take might not limit it), and
 * a reasoning effort the model does not offer. A control whose catalog entry
 * is gone is a roster that has gone stale.
 */
export function checkRoster(models, list, maxTokens = MAX_TOKENS) {
  const problems = [];
  const byId = new Map((list?.data ?? []).map((m) => [m.id, m]));
  for (const model of models) {
    if (model.role === 'control' && model.catalogEntryFound === false) {
      problems.push(`${model.id}: the catalog no longer has an entry "${model.catalogId}" — refresh the controls`);
    }
    const listed = byId.get(model.id);
    if (!listed) {
      problems.push(`${model.id}: not on OpenRouter's model list`);
      continue;
    }
    const supported = new Set(listed.supported_parameters ?? []);
    if (!supported.has('tools')) problems.push(`${model.id}: the list does not give "tools" as supported`);
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
export function listedPricing(list, id) {
  const listed = (list?.data ?? []).find((m) => m.id === id);
  if (!listed?.pricing) return undefined;
  const perMillion = (perToken) => Number((Number(perToken) * 1e6).toPrecision(12));
  return { input: perMillion(listed.pricing.prompt), output: perMillion(listed.pricing.completion) };
}

async function fetchOpenRouterList() {
  const res = await fetch(`${OPENROUTER_BASE_URL}/models`);
  if (!res.ok) throw new Error(`OpenRouter's model list answered ${res.status}`);
  return { fetchedAt: new Date().toISOString(), ...(await res.json()) };
}

// --- Cost bounds ---

/** What one request costs at `pricing`, from its reported usage. */
export function requestCostUsd(usage, pricing) {
  return ((usage.prompt ?? 0) * pricing.input + (usage.completion ?? 0) * pricing.output) / 1e6;
}

/** A request with no usage reported, counted at the most one could cost here. */
function worstRequestUsd(pricing) {
  return (QUERY_TOKEN_CAP * pricing.input + MAX_TOKENS * pricing.output) / 1e6;
}

/**
 * The most one query row could cost. The cumulative bound is checked after a
 * round, so the last round and the answering turn can carry a row past it;
 * three times the bound in prompt tokens and every possible response at the
 * limit covers that with room.
 */
export function rowCeilingUsd(pricing) {
  return (3 * QUERY_TOKEN_CAP * pricing.input + (MAX_ITERATIONS + 2) * MAX_TOKENS * pricing.output) / 1e6;
}

/** March's token profile: about 23,000 tokens a query, 90 percent of them input. */
function rowMarchProfileUsd(pricing) {
  return (20_700 * pricing.input + 2_300 * pricing.output) / 1e6;
}

/** The most one tool-result check could cost: three requests, each carrying the text. */
export function quoteCeilingUsd(pricing, textChars) {
  const promptTokens = Math.ceil(textChars / 2) + 2_000;
  return (3 * promptTokens * pricing.input + 3 * MAX_TOKENS * pricing.output) / 1e6;
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
    error: body?.error ? { code: body.error.code, message: body.error.message } : undefined,
  };
}

/** The token-limit and reasoning fields a request carried, read from its body. */
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
    messages: Array.isArray(parsed.messages) ? parsed.messages.length : undefined,
    tools: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
  };
}

/**
 * A fetch for one row's OpenAI client: sends the request unchanged, records
 * what came back, and refuses to send anything once the row is closed.
 */
export function recordingFetch(row, baseFetch = globalThis.fetch) {
  return async (url, init) => {
    if (row.closed) throw new Error(`Row ${row.label} was closed after its timeout; request not sent`);
    const startedAt = Date.now();
    const res = await baseFetch(url, init);
    const record = { status: res.status, durationMs: Date.now() - startedAt, sent: sentFacts(init?.body) };
    try {
      Object.assign(record, responseFacts(await res.clone().json()));
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
 * The automatic checks for one row (#573 P0). Facts only: whether the expected
 * dataset was called, answered and cited; whether the query's portal answered;
 * the tool and budget counts; and what the model requests reported — any
 * response ended at its length limit, the reasoning spent, whether a response
 * ran past the limit it was sent, and whether the endpoint's `total_tokens`
 * (the figure the 50K cap sums) contains the reasoning it reported.
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
  };
}

// --- The tool-result check ---

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

function quotePrompt(question) {
  return (
    'This is a test of whether a tool result reaches you intact. Call the read_result tool once. ' +
    `Then, using only the text it returned, answer: ${question} Quote exactly. ` +
    'If the text did not reach you, or reached you only in part, say so plainly instead of guessing.'
  );
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

/**
 * The results file: metadata, every row with its checks, every error, the
 * tool-result check when the probe ran it, and a per-model summary of the
 * automatic checks. `rowsWritten` (results plus errors) equal to
 * `rowsExpected` (models × queries) is the owner leg's acceptance.
 */
export function buildOutput({ meta, models, queries, results, errors, quoteChecks = null }) {
  const rowsExpected = models.length * queries.length;
  const rowsWritten = results.length + errors.length;
  return {
    metadata: {
      ...meta,
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      queryTokenCap: QUERY_TOKEN_CAP,
      maxTokens: MAX_TOKENS,
      maxIterations: MAX_ITERATIONS,
      modelsEvaluated: models.map((m) => m.id),
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        ...(m.catalogId ? { catalogId: m.catalogId } : {}),
        requestSettings: m.requestSettings ?? null,
        requestParameters: modelRequestParameters(m.requestSettings, MAX_TOKENS),
      })),
      queriesRun: queries.map((q) => q.id),
      rowsExpected,
      rowsWritten,
      complete: rowsWritten === rowsExpected,
      totalRuns: results.length,
      totalErrors: errors.length,
      totalTimeouts: count(errors, (e) => e.isTimeout),
      totalBudgetExceeded: count(results, (r) => r.budgetExceeded),
    },
    results,
    errors,
    quoteChecks,
    summary: models.map((model) => {
      const rows = results.filter((r) => r.modelId === model.id);
      const modelErrors = errors.filter((e) => e.modelId === model.id);
      const checks = rows.map((r) => r.checks);
      const withExpected = checks.filter((c) => c.expectedDataset);
      const offHome = rows.filter((r) => r.portal !== HOME_PORTAL);
      const totalTokens = rows.reduce((s, r) => s + r.totalTokens, 0);
      return {
        modelId: model.id,
        modelName: model.name,
        role: model.role,
        queriesRun: rows.length,
        errors: modelErrors.length,
        timeouts: count(modelErrors, (e) => e.isTimeout),
        budgetExceeded: count(checks, (c) => c.budgetExceeded),
        expectedDatasetCalled: `${count(withExpected, (c) => c.expectedDatasetCalled)}/${withExpected.length}`,
        expectedDatasetAnswered: `${count(withExpected, (c) => c.expectedDatasetAnswered)}/${withExpected.length}`,
        expectedDatasetCited: `${count(withExpected, (c) => c.expectedDatasetCited)}/${withExpected.length}`,
        otherPortalAnswered: `${count(offHome, (r) => r.checks.portalAnswered)}/${offHome.length}`,
        avgToolCalls: rows.length ? Math.round((rows.reduce((s, r) => s + r.toolCallCount, 0) / rows.length) * 10) / 10 : 0,
        failedToolCalls: checks.reduce((s, c) => s + c.failedToolCalls, 0),
        emptyAnswers: count(checks, (c) => c.emptyAnswer),
        responsesAtLength: checks.reduce((s, c) => s + c.finishedAtLength, 0),
        limitOverruns: count(checks, (c) => c.limitOverrun),
        reasoningTokens: checks.reduce((s, c) => s + c.reasoningTokens, 0),
        totalTokens,
        avgTokensPerQuery: rows.length ? Math.round(totalTokens / rows.length) : 0,
        medianDurationMs: median(rows.map((r) => r.durationMs)),
        costUsd: Math.round(rows.reduce((s, r) => s + (r.costUsd ?? 0), 0) * 10_000) / 10_000,
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

function newRow(label) {
  return { label, closed: false, requests: [] };
}

function clientFor(row, apiKey) {
  return new OpenAI({ baseURL: OPENROUTER_BASE_URL, apiKey, fetch: recordingFetch(row) });
}

function rowCost(requests, pricing) {
  return requests.reduce((sum, r) => sum + (r.usage ? requestCostUsd(r.usage, pricing) : worstRequestUsd(pricing)), 0);
}

async function runQuery(client, row, query, model, systemPrompt) {
  const result = await runToolLoop({
    client,
    endpointModel: model.id,
    // A control's settings come from its catalog entry and a candidate's are
    // stated above; either way they reach the request through the catalog's
    // own `modelRequestParameters`, the path a catalog entry takes (#548).
    requestSettings: model.requestSettings,
    prompt: query.query,
    systemPrompt,
    // This harness's own one-tool array, above — not the app's tool set.
    // Widening it would change what the evaluation measures, which is a
    // separate decision from where the loop lives.
    tools,
    executeToolCall: (name, args) => {
      if (row.closed) throw new Error(`Row ${row.label} was closed after its timeout; tool call not sent`);
      return callMcpTool(name, args);
    },
    // Default portal for a `get_data` call whose arguments omit one. The copy
    // this file used to carry injected into EVERY tool call, guarded only on
    // `!args.portal`; with the one-tool array above that was the same
    // behaviour, and the loop's `get_data` guard keeps it the same behaviour if
    // that array ever grows. The loop injects above the tool-call record and
    // above the trace span, so what is written out below is what was sent.
    portal: query.portal,
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    maxCumulativeTokens: QUERY_TOKEN_CAP,
    // No `toolTimeoutMs` — see the guardrail note above.
    logContext: `eval-models ${model.id}`,
  });

  return {
    queryId: query.id,
    modelId: model.id,
    modelName: model.name,
    query: query.query,
    portal: query.portal,
    category: query.category,
    expectedDataset: query.expectedDataset,
    response: result.content,
    // The loop's records carry more than the `{ name, args }` pairs this file
    // used to write: the operation type, the reason line, result row and column
    // counts, per-call duration, and whether a call failed and how (#321). All
    // of that is useful for scoring and none of it was available before.
    toolsCalled: result.toolCalls,
    toolCallCount: result.toolCalls.length,
    iterations: result.iterations,
    inputTokens: result.usage.promptTokens,
    outputTokens: result.usage.completionTokens,
    totalTokens: result.usage.totalTokens,
    durationMs: result.durationMs,
    budgetExceeded: result.tokenLimitExceeded,
    timestamp: new Date().toISOString(),
  };
}

function systemPromptFor(query, skillGuidance) {
  // Same as the website's buildSystemPrompt.
  const today = new Date().toISOString().split('T')[0];
  return `You are a helpful assistant with access to Socrata open data portals via the get_data tool.

Today's date is ${today}. Always use this as the current date for interpreting relative time expressions like "last year" or "past two months."

${skillGuidance}

## PORTAL-SPECIFIC GUIDANCE
Default portal: ${query.portal}

When you get results, summarize clearly and cite the dataset ID used.`;
}

async function runQuoteCheck(model, fixture, apiKey, pricing) {
  const row = newRow(`${model.id} ${fixture.id}`);
  const startedAt = Date.now();
  try {
    const result = await withTimeout(
      runToolLoop({
        client: clientFor(row, apiKey),
        endpointModel: model.id,
        requestSettings: model.requestSettings,
        prompt: quotePrompt(fixture.question),
        tools: [QUOTE_TOOL],
        executeToolCall: async () => fixture.text,
        maxIterations: 2,
        maxTokens: MAX_TOKENS,
        logContext: `eval-models tool-result ${model.id}`,
      }),
      QUERY_TIMEOUT_MS,
    );
    const toolCalled = result.toolCalls.length > 0;
    // The first request after the tool result is the one that carried it.
    const afterResult = row.requests.find((r) => (r.sent?.messages ?? 0) >= 3 && r.usage);
    return {
      modelId: model.id,
      fixtureId: fixture.id,
      source: fixture.source,
      shape: fixture.shape,
      role: fixture.role ?? 'subject',
      textChars: fixture.text.length,
      expect: fixture.expect,
      ...quoteVerdict(fixture.expect, result.content, toolCalled),
      toolCalls: result.toolCalls.length,
      promptTokensWithResult: afterResult?.usage.prompt ?? null,
      answer: result.content,
      requests: row.requests,
      costUsd: rowCost(row.requests, pricing),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    row.closed = true;
    return {
      modelId: model.id,
      fixtureId: fixture.id,
      source: fixture.source,
      shape: fixture.shape,
      role: fixture.role ?? 'subject',
      verdict: 'error',
      error: error.message,
      requests: row.requests,
      costUsd: rowCost(row.requests, pricing) + worstRequestUsd(pricing),
    };
  }
}

/** One live result per other source, through the site's client, as the site would send it. */
async function captureLiveResults() {
  const captured = [];
  for (const capture of LIVE_CAPTURES) {
    const startedAt = Date.now();
    try {
      const text = await callMcpTool(capture.tool, capture.args);
      captured.push({
        ...capture,
        capturedAt: new Date().toISOString(),
        status: 'captured',
        durationMs: Date.now() - startedAt,
        shape: resultShape(text),
        text,
        question: GENERIC_QUOTE_QUESTION,
        expect: genericExpectations(text),
      });
    } catch (error) {
      captured.push({ ...capture, status: 'not-captured', reason: error.message, durationMs: Date.now() - startedAt });
    }
  }
  return captured;
}

// --- Plans ---

function selectModels(ids) {
  return ids.map((id) => {
    const model = ALL_MODELS.find((m) => m.id === id);
    if (!model) throw new Error(`${id} is not in ALL_MODELS`);
    return model;
  });
}

/** The models and queries a form runs, after EVAL_MODELS / EVAL_QUERIES for a full run. */
export function planFor(mode, env = {}) {
  if (mode === 'probe') {
    return {
      models: selectModels(PROBE.models),
      queries: TEST_QUERIES.filter((q) => PROBE.queries.includes(q.id)),
      quoteModels: selectModels(QUOTE_MODELS),
    };
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
  return {
    models: modelFilter ? ALL_MODELS.filter((m) => modelFilter.includes(m.id)) : ALL_MODELS,
    queries: queryFilter ? TEST_QUERIES.filter((_, i) => queryFilter.includes(i + 1)) : TEST_QUERIES,
    quoteModels: [],
  };
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** The cost bounds of a plan at a list's prices, and the models priced. */
export function planBounds(plan, list, fixtures = []) {
  let floor = 0;
  let ceiling = 0;
  const unpriced = [];
  for (const model of plan.models) {
    const pricing = listedPricing(list, model.id);
    if (!pricing) {
      unpriced.push(model.id);
      continue;
    }
    floor += plan.queries.length * rowMarchProfileUsd(pricing);
    ceiling += plan.queries.length * rowCeilingUsd(pricing);
  }
  for (const model of plan.quoteModels) {
    const pricing = listedPricing(list, model.id);
    if (!pricing) {
      unpriced.push(model.id);
      continue;
    }
    for (const fixture of fixtures) ceiling += quoteCeilingUsd(pricing, fixture.text.length);
    // The live captures' size is unknown until they are captured; the bound
    // takes each at the largest recorded result.
    const largest = Math.max(0, ...fixtures.map((f) => f.text.length));
    ceiling += LIVE_CAPTURES.length * quoteCeilingUsd(pricing, largest);
  }
  return { floorUsd: floor, ceilingUsd: ceiling, unpriced: [...new Set(unpriced)] };
}

function usd(value) {
  return `$${value.toFixed(2)}`;
}

function printPlan(plan, list, listLabel, fixtures) {
  console.log(`OpenRouter list: ${listLabel}`);
  const models = [...new Map([...plan.models, ...plan.quoteModels].map((m) => [m.id, m])).values()];
  console.log('');
  console.log('Model'.padEnd(32) + 'Role'.padEnd(15) + 'Request parameters'.padEnd(64) + 'USD/MTok in/out');
  for (const m of models) {
    const pricing = listedPricing(list, m.id);
    console.log(
      m.id.padEnd(32) +
        m.role.padEnd(15) +
        JSON.stringify(modelRequestParameters(m.requestSettings, MAX_TOKENS)).padEnd(64) +
        (pricing ? `${pricing.input} / ${pricing.output}` : 'not listed'),
    );
  }
  console.log('');
  console.log(`Queries: ${plan.queries.length} (${plan.queries.map((q) => q.id).join(', ')})`);
  console.log(`Rows: ${plan.models.length} models × ${plan.queries.length} queries = ${plan.models.length * plan.queries.length}`);
  if (plan.quoteModels.length > 0) {
    console.log(
      `Tool-result check: ${plan.quoteModels.length} models × ${fixtures.length} recorded results ` +
        `(${fixtures.map((f) => f.id).join(', ')}), plus up to ${LIVE_CAPTURES.length} live captures ` +
        `(${LIVE_CAPTURES.map((c) => c.source).join(', ')})`,
    );
  }
  const bounds = planBounds(plan, list, fixtures);
  console.log(`Cost at March's token profile: ${usd(bounds.floorUsd)}; ceiling: ${usd(bounds.ceilingUsd)}`);
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

function dryRun(options) {
  const plan = planFor(options.mode, process.env);
  const snapshot = loadJson(OPENROUTER_SNAPSHOT);
  const fixtures = options.mode === 'probe' ? loadJson(TOOL_RESULT_FIXTURES).fixtures : [];
  console.log(`=== Dry run (${options.mode}): no network call is made ===\n`);
  printPlan(plan, snapshot, `the recorded copy read ${snapshot.fetchedAt} (${OPENROUTER_SNAPSHOT})`, fixtures);
  const problems = checkRoster([...plan.models, ...plan.quoteModels], snapshot);
  if (problems.length) {
    console.error(`\nRoster check against the recorded list FAILED (${problems.length}):`);
    printRosterProblems(problems);
    process.exit(1);
  }
  console.log('\nRoster check against the recorded list: OK.');
  if (options.capUsd !== undefined) console.log(`Cap: ${usd(options.capUsd)}`);
}

async function checkKey(apiKey) {
  const res = await fetch(`${OPENROUTER_BASE_URL}/key`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) fail(`OpenRouter refused the key (${res.status} from its key endpoint); nothing was spent`);
  const data = (await res.json())?.data ?? {};
  const fmt = (v) => (typeof v === 'number' ? usd(v) : String(v ?? 'none'));
  console.log(`Key check: OK (limit ${fmt(data.limit)}, used ${fmt(data.usage)}, remaining ${fmt(data.limit_remaining)})`);
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    fail(error.message);
  }

  if (options.mode === 'check-slugs') return checkSlugsLive();
  if (options.dryRun) return dryRun(options);

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
  console.log(`Guardrails: ${QUERY_TIMEOUT_MS / 1000}s timeout, ${QUERY_TOKEN_CAP.toLocaleString()} token cap per query, ${MAX_TOKENS} tokens per response\n`);

  const list = await fetchOpenRouterList();
  const fixtures = options.mode === 'probe' ? loadJson(TOOL_RESULT_FIXTURES).fixtures : [];
  const bounds = printPlan(plan, list, `live, read ${list.fetchedAt}`, fixtures);
  const problems = checkRoster([...plan.models, ...plan.quoteModels], list);
  if (problems.length) {
    console.error(`\nRoster check FAILED (${problems.length}); nothing was spent:`);
    printRosterProblems(problems);
    process.exit(1);
  }
  console.log('Roster check: OK.');
  console.log(`Cap: ${usd(options.capUsd)}${bounds.ceilingUsd > options.capUsd ? ' (below the ceiling: the run can stop early)' : ''}`);
  await checkKey(apiKey);

  const pricingOf = new Map([...plan.models, ...plan.quoteModels].map((m) => [m.id, listedPricing(list, m.id)]));
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const outputPath = resolve(options.outDir, `eval-results-${options.mode}-${stamp}.json`);
  const meta = {
    mode: options.mode,
    date: startedAt.toISOString().split('T')[0],
    startedAt: startedAt.toISOString(),
    harness: { sha256: sha256Of(__filename), gitHead: gitHead() },
    node: process.version,
    mcpServer: process.env.SOCRATA_MCP_URL,
    openRouterList: {
      fetchedAt: list.fetchedAt,
      models: Object.fromEntries(
        [...pricingOf.keys()].map((id) => {
          const listed = list.data.find((m) => m.id === id);
          return [id, { canonicalSlug: listed?.canonical_slug, pricingPerMTok: pricingOf.get(id) }];
        }),
      ),
    },
    spend: { capUsd: options.capUsd, chargedUsd: 0, stoppedAtCap: false },
  };

  const results = [];
  const errors = [];
  let quoteChecks = null;
  const charged = () =>
    results.reduce((s, r) => s + r.costUsd, 0) +
    errors.reduce((s, e) => s + e.costUsd, 0) +
    (quoteChecks?.rows ?? []).reduce((s, q) => s + q.costUsd, 0);

  function save() {
    meta.spend.chargedUsd = Math.round(charged() * 10_000) / 10_000;
    meta.finishedAt = new Date().toISOString();
    writeFileSync(
      outputPath,
      JSON.stringify(buildOutput({ meta, models: plan.models, queries: plan.queries, results, errors, quoteChecks }), null, 2),
    );
  }

  console.log(`\nMCP server: ${process.env.SOCRATA_MCP_URL}`);
  console.log('Fetching skill guidance...');
  const skillGuidance = await callMcpPrompt('skill-guidance', { modality: 'web' });
  meta.skillGuidanceLength = skillGuidance.length;
  console.log(`Skill guidance: ${skillGuidance.length} chars\n`);

  const total = plan.models.length * plan.queries.length;
  let completed = 0;

  rows: for (const model of plan.models) {
    console.log(`\n--- ${model.name} (${model.id}) ---\n`);
    const pricing = pricingOf.get(model.id);

    for (const query of plan.queries) {
      if (charged() + rowCeilingUsd(pricing) > options.capUsd) {
        meta.spend.stoppedAtCap = true;
        console.log(`\nStopped before ${model.id} ${query.id}: its worst case could carry the spend past the cap.`);
        break rows;
      }
      completed++;
      console.log(`[${completed}/${total}] ${query.id}: "${query.query.slice(0, 60)}..."`);

      const row = newRow(`${model.id} ${query.id}`);
      try {
        const result = await withTimeout(
          runQuery(clientFor(row, apiKey), row, query, model, systemPromptFor(query, skillGuidance)),
          QUERY_TIMEOUT_MS,
        );
        result.requests = row.requests;
        result.costUsd = rowCost(row.requests, pricing);
        result.checks = rowChecks(query, result, row.requests);
        results.push(result);

        const flags = [
          result.budgetExceeded ? 'BUDGET EXCEEDED' : '',
          result.checks.finishedAtLength ? `${result.checks.finishedAtLength} AT LENGTH` : '',
          result.checks.expectedDataset && !result.checks.expectedDatasetCalled ? 'EXPECTED DATASET NOT CALLED' : '',
        ].filter(Boolean);
        console.log(
          `  → ${result.toolCallCount} tool calls, ${result.totalTokens.toLocaleString()} tokens, ` +
            `${(result.durationMs / 1000).toFixed(1)}s, ${usd(result.costUsd)}${flags.length ? ` [${flags.join('; ')}]` : ''}`,
        );
      } catch (error) {
        row.closed = true;
        const isTimeout = error.message.includes('Timed out');
        console.error(`  ✗ ${isTimeout ? 'TIMEOUT' : 'Error'}: ${error.message}`);
        errors.push({
          queryId: query.id,
          modelId: model.id,
          error: error.message,
          isTimeout,
          // The same array the row's fetch writes to: a response still in
          // flight at the timeout lands here when it arrives.
          requests: row.requests,
          // A timed-out row may have one request in flight, counted at its worst.
          costUsd: rowCost(row.requests, pricing) + (isTimeout ? worstRequestUsd(pricing) : 0),
          timestamp: new Date().toISOString(),
        });
      }

      save();
      // Brief pause between queries to avoid rate limits
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (plan.quoteModels.length > 0 && !meta.spend.stoppedAtCap) {
    console.log('\n=== Tool-result check (#573 premise 6) ===\n');
    const live = await captureLiveResults();
    for (const c of live) {
      console.log(`Live capture ${c.source}: ${c.status}${c.status === 'captured' ? ` (${c.shape}, ${c.text.length} chars)` : ` — ${c.reason}`}`);
    }
    const subjects = [...fixtures, ...live.filter((c) => c.status === 'captured' && c.expect.length > 0)];
    // The captured texts are kept whole: they are what the verdicts were about.
    quoteChecks = { captures: live, rows: [] };
    for (const model of plan.quoteModels) {
      const pricing = pricingOf.get(model.id);
      for (const fixture of subjects) {
        if (charged() + quoteCeilingUsd(pricing, fixture.text.length) > options.capUsd) {
          meta.spend.stoppedAtCap = true;
          console.log(`Stopped before ${model.id} ${fixture.id}: its worst case could carry the spend past the cap.`);
          break;
        }
        const check = await runQuoteCheck(model, fixture, apiKey, pricing);
        quoteChecks.rows.push(check);
        console.log(
          `  ${model.id.padEnd(30)} ${fixture.id.padEnd(32)} ${String(check.verdict).padEnd(12)} ` +
            `prompt tokens with result: ${check.promptTokensWithResult ?? '—'}`,
        );
        save();
      }
    }
  }

  save();
  console.log(`\n=== Results saved to ${outputPath} ===`);

  const finalOutput = buildOutput({ meta, models: plan.models, queries: plan.queries, results, errors, quoteChecks });
  console.log('\n=== Summary ===\n');
  console.log(
    'Model'.padEnd(30) +
      'Rows'.padEnd(6) +
      'Dataset'.padEnd(9) +
      'Portal'.padEnd(8) +
      'Tools'.padEnd(7) +
      'AtLen'.padEnd(7) +
      'Reason.'.padEnd(9) +
      'Avg tok'.padEnd(9) +
      'Med s'.padEnd(7) +
      'USD',
  );
  console.log('-'.repeat(100));
  for (const s of finalOutput.summary) {
    console.log(
      s.modelId.padEnd(30) +
        String(s.queriesRun).padEnd(6) +
        s.expectedDatasetAnswered.padEnd(9) +
        s.otherPortalAnswered.padEnd(8) +
        String(s.avgToolCalls).padEnd(7) +
        String(s.responsesAtLength).padEnd(7) +
        String(s.reasoningTokens).padEnd(9) +
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
