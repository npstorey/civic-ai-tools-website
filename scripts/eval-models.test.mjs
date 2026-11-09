// Tests for scripts/eval-models.mjs.
//
// TWO REFUSALS (civic-ai-tools#155 P1 E4). SOCRATA_MCP_URL used to default to
// https://socrata-mcp.civicaitools.org when unset, silently routing an
// unconfigured run's queries through infrastructure the caller does not
// operate. It now refuses with a named error instead. Spawned as a CHILD
// PROCESS so the refusal is exercised the same way an operator would trigger
// it, before any model/MCP call is made.
//
// AND THE RUNNER (#356). The harness imports the shared tool-calling loop from
// src/lib/model-loop/run-tool-loop.ts — a TypeScript module, imported from a
// `.mjs` file. Until #356 this file's own header asserted that could not work.
// It can, and the two spawns below prove it twice over: the refusal tests run
// the harness itself with no flags, so a broken import would fail them by not
// reaching the env gate at all, and the third test states the property on its
// own so a failure names the cause instead of looking like a config bug.
//
// AND THE EVALUATION OF 2026-10 (#573 P0). The tests from the roster check
// down cover what P0 added. Every check that gates spending is shown failing
// on the shape it exists for — an absent slug, a limit sent under a name the
// model does not take, a refused key, a cap — and the whole harness is driven
// against stand-in endpoints (`fakeEndpoints` below), so the results file the
// owner's run will write is read here first.
//
// AND THE APP'S OFFER (#609). The tool names the live captures call, and Q3's
// portal, which moved with San Francisco's (#587), as a named delta on the
// query pin. #609's comparison of every request with the app's all-sources
// offer is superseded by the in-loop one below (#740 A1, replaced by A2).
//
// AND THE APP'S IN-LOOP SHAPE (EVAL-OW P1, #740). A row's first request is
// held to the one `src/app/api/compare-stream/route.ts` itself sends under
// `SOURCE_ROUTING=in-loop` (A2), and every open-weight request to the ruled
// `provider` object (A12). Then the scripted pause's self-test, the
// preflight's stop lines and the run's refusals, each driven on the stand-in
// with its log showing no model request; `--calibrate` on recorded profiles;
// and the app's limits, read from what a row hands the loop and driven to
// each bound. The two checks' fixtures are `scripts/eval-checks.test.mjs`'s.
//
// Run with: npm test

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  ALL_MODELS,
  APP_LIMITS,
  LIVE_CAPTURES,
  OPEN_WEIGHT_PROVIDER,
  OPENROUTER_SNAPSHOT,
  PAUSE_SET,
  PROBE,
  TEST_QUERIES,
  buildOutput,
  capRule,
  checkRoster,
  consentStates,
  genericExpectations,
  goldAskFirst,
  loopOptions,
  parseArgs,
  planBounds,
  planFor,
  quoteVerdict,
  recordingFetch,
  reservationPricing,
  resultShape,
  rowChecks,
  runEnvProblem,
  runVariables,
  scriptedPause,
  streamedBody,
} from './eval-models.mjs';
import { BUILT_IN_CATALOG, modelRequestParameters, modelRequestSettings } from '../src/lib/model-catalog.ts';
import { createInLoopRouting, directorySet } from '../src/lib/mcp/routing-mode.ts';
import { CONSENT_GATE_ENFORCED } from '../src/lib/sources/consent-enforced.ts';
import { mcpTools } from '../src/lib/mcp/tools.ts';
import { HOSTED_SOURCE_KEY_VARIABLE, routedSourceId } from '../src/lib/mcp/registry.ts';
import { CIVIC_MANIFEST, HOSTING_SANDBOX, readMcpEnv } from '@typedstandards/civic-typed-router';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './eval-models.mjs',
);

const CORE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/lib/model-loop/run-tool-loop.ts',
);

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './fixtures/eval-models');
const SNAPSHOT_PATH = OPENROUTER_SNAPSHOT;
const SNAPSHOT = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
const TOOL_RESULTS = JSON.parse(readFileSync(path.join(FIXTURES, 'tool-results-2026-10-11.json'), 'utf-8'));
const NO_NETWORK = path.join(FIXTURES, 'no-network.mjs');

/** A key that must never appear in anything the harness writes or prints. */
const FAKE_KEY = 'sk-or-fake-MUST-NOT-APPEAR-5520';

/** The ruled object (#740 D3 = A), stated here, not read from the harness. */
const RULED_PROVIDER = { max_price: { prompt: 0.15, completion: 0.6 }, require_parameters: true, data_collection: 'deny' };

/** Why a recorded `provider` is not the ruling's, or null when it is. */
function providerProblem(provider, openWeight) {
  if (!openWeight) return provider === undefined ? null : `a Claude request carried provider ${JSON.stringify(provider)}`;
  if (provider === undefined) return 'an open-weight request carried no provider';
  for (const pin of ['order', 'only', 'ignore']) if (Object.hasOwn(provider, pin)) return `the provider is pinned (${pin})`;
  return isDeepStrictEqual(provider, RULED_PROVIDER) ? null : `the provider is ${JSON.stringify(provider)}, not the ruled object`;
}

/** Scratch files a test leaves for a later test to read, removed when the suite ends. */
const KEPT_SCRATCH = [];
after(() => {
  for (const dir of KEPT_SCRATCH) rmSync(dir, { recursive: true, force: true });
});

test('refuses with a named error when OPENROUTER_API_KEY is unset', () => {
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  delete env.SOCRATA_MCP_URL;

  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8', timeout: 15_000, env });

  assert.equal(result.status, 1, `expected exit 1\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /OPENROUTER_API_KEY/);
});

test('refuses with a named error when SOCRATA_MCP_URL is unset (no reference-host default)', () => {
  const env = { ...process.env, OPENROUTER_API_KEY: 'not-a-real-key' };
  delete env.SOCRATA_MCP_URL;

  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8', timeout: 15_000, env });

  assert.equal(result.status, 1, `expected exit 1\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /SOCRATA_MCP_URL/);
  // The old default must not appear anywhere in the refusal.
  assert.doesNotMatch(result.stdout + result.stderr, /socrata-mcp\.civicaitools\.org/);
});

test('#356: a flagless `node` can import the shared tool-calling core', () => {
  // NO FLAGS, on purpose. `npm test` runs this suite under
  // --experimental-strip-types, and inheriting that flag here would hide the
  // one case an operator actually meets: `node scripts/eval-models.mjs`.
  const source =
    `import { runToolLoop } from ${JSON.stringify(pathToFileURL(CORE).href)};\n` +
    'process.stdout.write(typeof runToolLoop);\n';

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf-8',
    timeout: 30_000,
  });

  assert.equal(
    result.status,
    0,
    'a flagless `node` could not import src/lib/model-loop/run-tool-loop.ts, which ' +
      'scripts/eval-models.mjs imports at module scope. Node strips types from an imported `.ts` ' +
      'by default only from v22.18; below that the harness needs --experimental-strip-types, and ' +
      `package.json's engines.node is ">=22", which still admits those versions. Running ` +
      `${process.version}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(result.stdout, 'function');
});

test('#356: the harness drives the shared core rather than a loop of its own', () => {
  const source = readFileSync(SCRIPT, 'utf-8');

  assert.match(
    source,
    /import \{ runToolLoop \} from '\.\.\/src\/lib\/model-loop\/run-tool-loop\.ts';/,
    'the harness must import the shared loop, not reimplement one',
  );
  assert.match(source, /await runToolLoop\(\{/, 'the harness must actually call it');

  // This file's copy of the wave's own criterion, kept where the migration
  // happened. The class-wide statement — no second tool-calling loop anywhere
  // this repository tracks — lives in
  // src/lib/model-loop/model-call-registry.test.ts, which is where a scan
  // scoped to one file would be the #356 defect all over again.
  assert.doesNotMatch(
    source,
    /args\.portal\s*=[^=]/,
    'portal injection is the loop\'s, above the tool-call record and the trace span (#359)',
  );
  assert.doesNotMatch(
    source,
    /JSON\.parse\(toolCall\./,
    'parsing the arguments the model chose belongs inside the loop\'s failure path (#349)',
  );
});

// --- #573 P0 ---

/** Runs the harness as an operator would, with an env built from nothing but what is passed. */
function runHarness(args, { env = {}, preload } = {}) {
  const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, ...env };
  const nodeArgs = preload ? ['--import', pathToFileURL(preload).href, SCRIPT, ...args] : [SCRIPT, ...args];
  return spawnSync(process.execPath, nodeArgs, { encoding: 'utf-8', timeout: 120_000, env: childEnv });
}

function scratchDir() {
  return mkdtempSync(path.join(tmpdir(), 'eval-models-test-'));
}

function fakeLog(file) {
  try {
    return readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

const chatRequests = (log) => log.filter((e) => e.path === '/api/v1/chat/completions');

/**
 * A stand-in for every endpoint the harness reaches, so it runs whole — roster
 * check, key check, the site's MCP client, the shared loop, the recording
 * fetch, the checks and the results file — with no network and no key.
 * `writeFakeEndpoints` writes this function out as a module the child loads
 * with `node --import`, which replaces `globalThis.fetch` before the harness
 * loads; anything it has no route for throws.
 *
 * It lives in this test file, not beside the other fixtures, because it
 * ANSWERS `tools/call`: as a tracked module of its own it would be read as a
 * sender by `src/lib/mcp/tool-call-senders.test.ts`, whose universe excludes
 * tests, and it is test code.
 *
 * OpenRouter: the model list (FAKE_OPENROUTER_LIST, a file in the list's
 * shape), the key endpoint (status FAKE_KEY_STATUS, default 200, with
 * distinctive balance figures), and chat completions. A "model" offered
 * `load_source` loads Socrata, then calls Socrata's `get_data` with a dataset
 * once it is loaded, then answers with the tool result echoed whole; one
 * offered only another tool calls the first it is offered (`get_data`, in
 * either spelling, with a dataset; any other with no arguments) and answers
 * after the result. FAKE_CHAT=always-tool never answers; FAKE_USAGE_TOTAL
 * sets every response's `total_tokens`. Every response reports `usage.cost`,
 * and a streamed request (the answering turn) is answered as chunks.
 *
 * MCP (the fake hosts `fakeEnv` names, and Boston OpenContext's when a test
 * configures it): the legacy exchange — the modern discovery probe is
 * answered 404 — with the skill guidance (refused under FAKE_SKILL=refuse,
 * so a composition falls back), `get_data` returning a two-row envelope and
 * Data Commons' `search_indicators` returning text with a JSON object inside
 * it. The server is called by its own tool name, so these are the upstream
 * names.
 *
 * FAKE_LOG receives one JSON line per request: host, path, method, and the
 * model or MCP method; for a model request, also the system message, the
 * question, the tool schemas and the body as sent. Never a header, so never
 * the key.
 */
async function fakeEndpoints() {
  const { appendFileSync, readFileSync } = await import('node:fs');
  const LOG = process.env.FAKE_LOG;
  const LIST = process.env.FAKE_OPENROUTER_LIST;
  const KEY_STATUS = Number(process.env.FAKE_KEY_STATUS || 200);
  const MCP_HOSTS = [process.env.SOCRATA_MCP_URL, process.env.DATA_COMMONS_MCP_URL, process.env.BOSTON_OPENCONTEXT_MCP_URL]
    .filter(Boolean)
    .map((u) => new URL(u).host);

  const log = (entry) => appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
  const json = (status, body, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  let serial = 0;
  // FAKE_CHAT picks how the stand-in model behaves: `answer` (the default)
  // loads Socrata when it is offered `load_source`, makes one data call and
  // answers; `always-tool` never answers, so the loop runs to its round limit
  // and takes its answering turn. FAKE_USAGE_TOTAL, when set, is the
  // `total_tokens` every response reports, so a test can drive the
  // cumulative bound.
  const MODE = process.env.FAKE_CHAT || 'answer';
  const USAGE_TOTAL = process.env.FAKE_USAGE_TOTAL ? Number(process.env.FAKE_USAGE_TOTAL) : undefined;
  const dataArgs = (name, user) =>
    ['get_data', 'socrata__get_data'].includes(name)
      ? { type: 'query', dataset_id: /Chicago/.test(user) ? '4ijn-s7e5' : 'erm2-nwe9', limit: 5 }
      : {};
  const usageOf = (body, messages) => {
    const prompt = USAGE_TOTAL !== undefined ? USAGE_TOTAL - 160 : Math.ceil(JSON.stringify(messages).length / 4);
    const reasoning = body.reasoning_effort ? 60 : 0;
    const completion = 100 + reasoning;
    return {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      // What OpenRouter reports the request cost, in US dollars.
      cost: 0.000001,
      ...(reasoning ? { completion_tokens_details: { reasoning_tokens: reasoning } } : {}),
    };
  };
  const chat = (body) => {
    const messages = body.messages ?? [];
    const last = messages.at(-1);
    const names = (body.tools ?? []).map((t) => t.function?.name);
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const dataTool = names.includes('socrata__get_data') ? 'socrata__get_data' : names.find((n) => n !== 'load_source');
    const calledData = messages.some((m) => m.role === 'assistant' && (m.tool_calls ?? []).some((c) => c.function?.name !== 'load_source'));
    const callOf = (name, args) => ({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: `call_${++serial}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    });
    let message;
    if (MODE === 'always-tool') {
      message = dataTool ? callOf(dataTool, dataArgs(dataTool, user)) : callOf('load_source', { alias: 'socrata' });
    } else if (last?.role === 'tool' && !(dataTool && names.includes('load_source') && !calledData)) {
      message = { role: 'assistant', content: `I received: ${String(last.content)}` };
    } else if (last?.role === 'tool') {
      // In loop, after a load: the loaded source's first tool.
      message = callOf(dataTool, dataArgs(dataTool, user));
    } else if (names.includes('load_source')) {
      message = callOf('load_source', { alias: 'socrata' });
    } else {
      const tool = names[0];
      message = callOf(tool, dataArgs(tool, user));
    }
    return {
      id: `gen-fake-${++serial}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      provider: 'Fake',
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', native_finish_reason: 'STOP' }],
      usage: usageOf(body, messages),
    };
  };
  // A streamed answering turn: one content chunk, then the usage chunk.
  const chatStream = (body) => {
    const frame = (payload) =>
      `data: ${JSON.stringify({ id: `gen-fake-${++serial}`, object: 'chat.completion.chunk', created: 1, model: body.model, provider: 'Fake', ...payload })}\n\n`;
    const text =
      frame({ choices: [{ index: 0, delta: { content: 'Streamed answer.' }, finish_reason: null }] }) +
      frame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop', native_finish_reason: 'STOP' }] }) +
      frame({ choices: [], usage: usageOf(body, body.messages ?? []) }) +
      'data: [DONE]\n\n';
    return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  const mcp = (host, body) => {
    const message = JSON.parse(body);
    const reply = (result) => json(200, { jsonrpc: '2.0', id: message.id, result }, { 'mcp-session-id': 'fake-session' });
    switch (message.method) {
      case 'initialize':
        return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: `fake ${host}`, version: '0' } });
      case 'notifications/initialized':
        return new Response(null, { status: 202 });
      case 'prompts/get':
        // FAKE_SKILL=refuse: the server's guidance does not arrive, so a composition falls back.
        if (process.env.FAKE_SKILL === 'refuse') return json(200, { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'fake: no guidance' } });
        return reply({ messages: [{ role: 'user', content: { type: 'text', text: 'Fake skill guidance: name the portal on every call.' } }] });
      case 'tools/call': {
        const name = message.params?.name;
        if (name === 'get_data') {
          const text = JSON.stringify({ data: [{ unique_key: '1' }, { unique_key: '2' }], returned_rows: 2 });
          return reply({ content: [{ type: 'text', text }], isError: false });
        }
        if (name === 'search_indicators') {
          const text =
            'Found 2 indicators for New York City.\n' +
            '{"variables": ["Median_Income_Household", "Count_Household"]}\n' +
            'Use get_observations with one of these variables next.';
          return reply({ content: [{ type: 'text', text }], isError: false });
        }
        return json(200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `fake: no tool ${name}` } });
      }
      default:
        return new Response('not found', { status: 404 });
    }
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : (input.url ?? String(input)));
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : undefined;
    let parsed;
    try {
      parsed = body ? JSON.parse(body) : undefined;
    } catch {
      parsed = undefined;
    }
    const entry = { host: url.host, path: url.pathname, method, model: parsed?.model, rpc: parsed?.method };
    // A model request also logs what it offered and the prompt it carried: the
    // system message, the question, and the tool schemas whole.
    if (url.pathname === '/api/v1/chat/completions' && parsed) {
      const messages = parsed.messages ?? [];
      Object.assign(entry, {
        messages: messages.length,
        system: messages.find((m) => m.role === 'system')?.content,
        user: messages.find((m) => m.role === 'user')?.content,
        tools: parsed.tools,
        // The request body as sent, whole: what a first request is compared on.
        body: parsed,
      });
    }
    log(entry);

    if (url.host === 'openrouter.ai') {
      if (method === 'GET' && url.pathname === '/api/v1/models') return json(200, JSON.parse(readFileSync(LIST, 'utf-8')));
      if (method === 'GET' && url.pathname === '/api/v1/key') {
        // Distinctive figures, so a test can show none of them is written.
        return KEY_STATUS === 200
          ? json(200, { data: { limit: 123.45, usage: 67.89, limit_remaining: 55.56 } })
          : json(KEY_STATUS, { error: { code: KEY_STATUS, message: 'fake: key refused' } });
      }
      if (method === 'POST' && url.pathname === '/api/v1/chat/completions') {
        return parsed?.stream === true ? chatStream(parsed) : json(200, chat(parsed));
      }
    }
    if (MCP_HOSTS.includes(url.host)) return mcp(url.host, body);
    throw new Error(`fake endpoints: no route for ${method} ${url.href}`);
  };
}

function writeFakeEndpoints(dir) {
  const file = path.join(dir, 'fake-endpoints.mjs');
  writeFileSync(file, `await (${fakeEndpoints.toString()})();\n`);
  return file;
}

function fakeEnv(dir, extra = {}) {
  return {
    OPENROUTER_API_KEY: FAKE_KEY,
    SOCRATA_MCP_URL: 'https://fake-socrata.test',
    // The site's client reads this; set, no call can leave for the real host.
    DATA_COMMONS_MCP_URL: 'https://fake-datacommons.test/mcp',
    FAKE_LOG: path.join(dir, 'requests.jsonl'),
    FAKE_OPENROUTER_LIST: SNAPSHOT_PATH,
    ...extra,
  };
}

function resultsFile(dir) {
  const files = readdirSync(dir).filter((f) => f.startsWith('eval-results-'));
  assert.equal(files.length, 1, `expected one results file in ${dir}, found: ${files.join(', ')}`);
  return { name: files[0], text: readFileSync(path.join(dir, files[0]), 'utf-8') };
}

test('#573, EVAL-OW C4: the roster passes the slug check against the recorded list, and each kind of problem fails it', () => {
  assert.equal(ALL_MODELS.length, 5, 'two catalog controls and three open-weight models');
  assert.deepEqual(checkRoster(ALL_MODELS, SNAPSHOT), []);

  const byId = (id) => ALL_MODELS.find((m) => m.id === id);

  // An injected absent slug: a guard, green on the roster and red on this shape.
  const absent = checkRoster([...ALL_MODELS, { id: 'z-ai/glm-5.3-flash-nope', role: 'open-weight', provider: OPEN_WEIGHT_PROVIDER }], SNAPSHOT);
  assert.deepEqual(absent, ["z-ai/glm-5.3-flash-nope: not on OpenRouter's model list"]);

  // An open-weight model sent max_completion_tokens: GLM at low WITHOUT the
  // stated limit name, so the catalog's rule would send max_completion_tokens,
  // which none of the three lists (S1, s1.md:291).
  for (const id of ['z-ai/glm-5.3-flash', 'openai/gpt-oss-120b']) {
    const undeclared = checkRoster([{ ...byId(id), requestSettings: { reasoningEffort: 'low' } }], SNAPSHOT);
    assert.deepEqual(undeclared, [`${id}: would be sent "max_completion_tokens", which the list does not give as supported`]);
  }

  // An effort the model does not offer, and an effort sent to a model that lists none.
  const effort = checkRoster([{ ...byId('z-ai/glm-5.3-flash'), requestSettings: { reasoningEffort: 'medium', tokenLimitParameter: 'max_tokens' } }], SNAPSHOT);
  assert.deepEqual(effort, ['z-ai/glm-5.3-flash: reasoning "medium" is not among the list\'s efforts (max, high, low)']);
  const none = checkRoster([{ ...byId('xiaomi/mimo-v2.6-flash'), requestSettings: { reasoningEffort: 'low', tokenLimitParameter: 'max_tokens' } }], SNAPSHOT);
  assert.deepEqual(none, [
    'xiaomi/mimo-v2.6-flash: would be sent "reasoning_effort", which the list does not give as supported',
    'xiaomi/mimo-v2.6-flash: reasoning "low" is set and the list gives no reasoning efforts',
  ]);

  // A model the list does not give tools or tool_choice for.
  const without = (param) => ({
    ...SNAPSHOT,
    data: SNAPSHOT.data.map((m) => (m.id === 'openai/gpt-oss-120b' ? { ...m, supported_parameters: m.supported_parameters.filter((p) => p !== param) } : m)),
  });
  assert.deepEqual(checkRoster([byId('openai/gpt-oss-120b')], without('tools')), ['openai/gpt-oss-120b: the list does not give "tools" as supported']);
  assert.deepEqual(checkRoster([byId('openai/gpt-oss-120b')], without('tool_choice')), ['openai/gpt-oss-120b: the list does not give "tool_choice" as supported']);

  // The provider object is not a model parameter, so the field check neither
  // refuses it (the green above) nor ignores it: an open-weight model without
  // the ruled object, with a pinned one, and a control carrying one are refused.
  const mimo = byId('xiaomi/mimo-v2.6-flash');
  assert.match(checkRoster([{ ...mimo, provider: undefined }], SNAPSHOT)[0], /its provider object is not the ruled one \(null\)/);
  assert.match(checkRoster([{ ...mimo, provider: { ...OPEN_WEIGHT_PROVIDER, order: ['Fake'] } }], SNAPSHOT)[0], /not the ruled one/);
  assert.deepEqual(checkRoster([{ ...byId('anthropic/claude-haiku-5.5'), provider: OPEN_WEIGHT_PROVIDER }], SNAPSHOT), [
    'anthropic/claude-haiku-5.5: a control model carries a provider object',
  ]);

  // A control whose catalog entry has gone.
  const control = ALL_MODELS.find((m) => m.role === 'control');
  const stale = checkRoster([{ ...control, catalogId: 'anthropic/gone', catalogEntryFound: false }], SNAPSHOT);
  assert.match(stale[0], /the catalog no longer has an entry "anthropic\/gone"/);
});

test('#573, EVAL-OW: the controls are the catalog but Opus 5.5, each with its entry\'s own settings; the open-weight models are at S1\'s rule with the ruled provider', () => {
  const controls = ALL_MODELS.filter((m) => m.role === 'control');
  assert.deepEqual(
    controls.map((m) => m.catalogId),
    BUILT_IN_CATALOG.map((e) => e.id).filter((id) => id !== 'anthropic/claude-opus-5.5'),
    'every catalog entry but Opus 5.5 is a control, in catalog order, and nothing else is',
  );
  for (const control of controls) {
    const entry = BUILT_IN_CATALOG.find((e) => e.id === control.catalogId);
    assert.deepEqual(control.requestSettings, modelRequestSettings(entry), `${control.id} must send what production sends`);
    assert.equal(control.provider, undefined);
  }
  // What each model is sent (the provider object aside): the catalog's two at
  // their catalog settings, and the open-weight three at S1's rule
  // (preregistration/s1.md:278-300 at hub 0c4232a).
  const sent = Object.fromEntries(ALL_MODELS.map((m) => [m.id, [m.role, modelRequestParameters(m.requestSettings, 4000)]]));
  assert.deepEqual(sent, {
    'anthropic/claude-haiku-5.5': ['control', { max_completion_tokens: 4000, reasoning_effort: 'low' }],
    'anthropic/claude-sonnet-5.5': ['control', { max_completion_tokens: 4000, reasoning_effort: 'medium' }],
    'z-ai/glm-5.3-flash': ['open-weight', { max_tokens: 4000, reasoning_effort: 'low' }],
    'openai/gpt-oss-120b': ['open-weight', { max_tokens: 4000, reasoning_effort: 'low' }],
    'xiaomi/mimo-v2.6-flash': ['open-weight', { max_tokens: 4000 }],
  });
  assert.deepEqual(OPEN_WEIGHT_PROVIDER, RULED_PROVIDER);
  for (const m of ALL_MODELS.filter((x) => x.role === 'open-weight')) assert.equal(m.provider, OPEN_WEIGHT_PROVIDER);
});

test('#609: the queries are March\'s fifteen, with one change: Q3\'s portal is San Francisco\'s current address', () => {
  // Pinned from TEST_QUERIES at website main ff3254c, so a run's results
  // compare with March's. A changed query is a different evaluation, so the
  // one change is a named delta, not a new hash alone. San Francisco's portal
  // moved, and in October the old address downloaded a whole dataset and
  // restarted the hosted server (docs/model-evaluation-2026-10.md); the site
  // has offered the new one since #587. Q3's question, dataset and category
  // stay March's.
  const hashOf = (queries) => createHash('sha256').update(JSON.stringify(queries)).digest('hex');
  const MARCH = 'e620889c47f1804e8bac844caef8687bde06f5e9420c47777b7486da013edb4d';
  assert.equal(TEST_QUERIES.length, 15);

  // The delta: with Q3's portal set back, the set is March's byte for byte,
  // so no other field of any query moved. The spread keeps the key order.
  const reverted = TEST_QUERIES.map((q) => (q.id === 'Q3' ? { ...q, portal: 'data.sfgov.org' } : q));
  assert.equal(hashOf(reverted), MARCH, 'apart from Q3\'s portal, the queries are March\'s');

  assert.equal(TEST_QUERIES.find((q) => q.id === 'Q3').portal, 'data.sf.gov');
  assert.equal(hashOf(TEST_QUERIES), '8a418b01d06c331c175f3bc34a490a4ecc4dd33bb984c1a7f40ac6b82884faed');
});

test('EVAL-OW C4: the probe is 15 rows and the run 255, with the pause set as ruled', () => {
  const countBy = (rows, key) => rows.reduce((acc, r) => ({ ...acc, [key(r)]: (acc[key(r)] ?? 0) + 1 }), {});

  const probe = planFor('probe');
  assert.equal(probe.rows.length, 15, 'five models × (two queries + one Ask-first query with off)');
  assert.deepEqual(probe.queries.map((q) => q.id), ['Q1', 'Q2']);
  assert.ok(probe.queries.some((q) => q.portal !== TEST_QUERIES[0].portal), 'one probe query must test a per-call portal');
  assert.deepEqual(countBy(probe.rows, (r) => `${r.queryId} ${r.consent.mode} ${r.consent.decision ?? ''}`), {
    'Q1 every-source-on ': 5,
    'Q2 every-source-on ': 5,
    'Q1 ask-first off': 5,
  });
  assert.equal(PROBE.askFirst.decision, 'off');

  const run = planFor('run', {});
  assert.equal(run.rows.length, 255, '5 × (15 × 3 + 6)');
  assert.deepEqual(countBy(run.rows, (r) => r.modelId), Object.fromEntries(ALL_MODELS.map((m) => [m.id, 51])));
  const pause = run.rows.filter((r) => r.consent.mode === 'ask-first');
  assert.equal(pause.length, 30);
  assert.deepEqual(PAUSE_SET.queries, ['Q1', 'Q2', 'Q6'], 'the seat\'s ruling, #740 comment 6728891704 point 2');
  assert.deepEqual(countBy(pause, (r) => `${r.queryId} ${r.consent.decision}`), {
    'Q1 off': 5, 'Q1 allow': 5, 'Q2 off': 5, 'Q2 allow': 5, 'Q6 off': 5, 'Q6 allow': 5,
  });
  for (const r of pause) {
    assert.deepEqual([r.consent.sourceId, r.consent.alias, r.repeat], ['socrata', 'socrata', 1]);
  }
  assert.ok(!run.rows.some((r) => r.consent.decision === 'allow-all'), 'no allow-all row runs');
  assert.deepEqual(countBy(run.rows.filter((r) => r.consent.mode === 'every-source-on'), (r) => r.repeat), { 1: 75, 2: 75, 3: 75 });
  // The order: repeat 1, then the pause set, then repeats 2 and 3.
  assert.deepEqual([...new Set(run.rows.map((r) => (r.consent.mode === 'ask-first' ? 'pause' : `r${r.repeat}`)))], ['r1', 'pause', 'r2', 'r3']);
  assert.equal(new Set(run.rows.map((r) => r.key)).size, 255, 'every row has its own key');

  // The filters.
  assert.equal(planFor('run', { EVAL_MODELS: 'openai/gpt-oss-120b', EVAL_QUERIES: '2', EVAL_REPEATS: '1' }).rows.length, 3, 'Q2 On, Q2 off, Q2 allow');
  assert.equal(planFor('run', { EVAL_QUERIES: '4' }).rows.filter((r) => r.consent.mode === 'ask-first').length, 0);
  assert.throws(() => planFor('run', { EVAL_MODELS: 'openai/gpt-oss-120b,nope/model' }), /Unknown model ID\(s\): nope\/model/);
  assert.throws(() => planFor('run', { EVAL_REPEATS: '4' }), /EVAL_REPEATS takes 1 to 3/);

  const bounds = planBounds(run, SNAPSHOT);
  assert.deepEqual(bounds.unpriced, []);
  assert.ok(bounds.highUsd > bounds.headlineUsd, `${bounds.highUsd} > ${bounds.headlineUsd}`);
});

test('#573: flags and environment are refused by name, the key check before anything else', () => {
  assert.deepEqual(parseArgs([]), { mode: 'run', dryRun: false, capUsd: undefined, outDir: path.dirname(SCRIPT) });
  assert.equal(parseArgs(['--probe', '--cap', '3']).capUsd, 3);
  assert.equal(parseArgs(['--preflight']).mode, 'preflight');
  assert.deepEqual(
    (({ mode, calibratePath }) => ({ mode, calibratePath }))(parseArgs(['--calibrate', 'probe.json'])),
    { mode: 'calibrate', calibratePath: path.resolve('probe.json') },
  );
  assert.throws(() => parseArgs(['--cap', '0']), /--cap takes a positive number/);
  assert.throws(() => parseArgs(['--cap']), /--cap takes a positive number/);
  assert.throws(() => parseArgs(['--fast']), /Unknown argument: --fast/);
  assert.throws(() => parseArgs(['--check-slugs', '--dry-run']), /no dry-run form/);
  assert.throws(() => parseArgs(['--preflight', '--dry-run']), /no dry-run form/);
  assert.throws(() => parseArgs(['--calibrate']), /--calibrate takes the probe's results file/);
  assert.throws(() => parseArgs(['--probe', '--preflight']), /separate forms/);

  const options = { capUsd: 3 };
  assert.match(runEnvProblem({}, options), /OPENROUTER_API_KEY environment variable is required/);
  assert.match(
    runEnvProblem({ OPENROUTER_API_KEY: '"op://Private/OpenRouter/api-key"', SOCRATA_MCP_URL: 'https://x' }, options),
    /holds a 1Password reference, not a key/,
  );
  assert.match(runEnvProblem({ OPENROUTER_API_KEY: 'k' }, options), /SOCRATA_MCP_URL/);
  assert.match(runEnvProblem({ OPENROUTER_API_KEY: 'k', SOCRATA_MCP_URL: 'https://x' }, {}), /--cap <usd> is required/);
  assert.equal(runEnvProblem({ OPENROUTER_API_KEY: 'k', SOCRATA_MCP_URL: 'https://x' }, options), null);
});

test('#573, EVAL-OW C6: the dry run prints each row\'s first request with its provider object, and makes no network call — and the preload that shows it does stop one', () => {
  for (const args of [['--dry-run'], ['--dry-run', '--probe']]) {
    const result = runHarness(args, { preload: NO_NETWORK });
    assert.equal(result.status, 0, `${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /no network call is made/);
    assert.match(result.stdout, /Roster check against the recorded list: OK\./);
    assert.doesNotMatch(result.stdout + result.stderr, /no-network preload/);
    const lines = result.stdout.split('\n').filter((l) => /^ {2}\[\d+\] /.test(l));
    const rows = args.includes('--probe') ? 15 : 255;
    assert.equal(lines.length, rows, 'one first request a row');
    assert.match(result.stdout, new RegExp(`\\nRows: ${rows}\\n`));
    assert.match(result.stdout, /Ceiling, every row at the app's limits, high-priced: \$\d+\.\d\d/);
    assert.match(result.stdout, /Ceiling, every row at the app's limits, headline: {4}\$\d+\.\d\d/);
    for (const line of lines) {
      assert.match(line, /system sha256 [0-9a-f]{12} \(\d+ chars\); tools \[load_source\]; /);
      const openWeight = /: model (z-ai|openai|xiaomi)\//.test(line);
      assert.equal(line.includes(`provider ${JSON.stringify(RULED_PROVIDER)}`), openWeight, line);
      assert.equal(line.endsWith('provider none'), !openWeight, line);
      assert.match(line, openWeight ? /; max_tokens 4000; / : /; max_completion_tokens 4000; /);
    }
  }

  // The red: the live slug check reads the network, and the same preload stops it.
  const live = runHarness(['--check-slugs'], { preload: NO_NETWORK });
  assert.notEqual(live.status, 0);
  assert.match(live.stdout + live.stderr, /no-network preload: fetch https:\/\/openrouter\.ai\/api\/v1\/models was attempted/);
});

/** The probe against the stand-in, memoized: several tests read the same run. */
let standInProbe;
function probeAgainstStandIn() {
  if (standInProbe) return standInProbe;
  const dir = scratchDir();
  try {
    const result = runHarness(['--probe', '--cap', '30', '--out-dir', dir], {
      env: fakeEnv(dir, { EVAL_ROW_GAP_MS: '0' }),
      preload: writeFakeEndpoints(dir),
    });
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const file = resultsFile(dir);
    const kept = scratchDir();
    KEPT_SCRATCH.push(kept);
    standInProbe = { result, file, out: JSON.parse(file.text), log: fakeLog(path.join(dir, 'requests.jsonl')), path: path.join(kept, file.name) };
    writeFileSync(standInProbe.path, file.text);
    return standInProbe;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('#573, EVAL-OW: a probe against stand-in endpoints writes every row in loop, with each load, what each request carried and cost, and no key or balance', () => {
  const { result, file, out, log } = probeAgainstStandIn();
  assert.match(file.name, /^eval-results-probe-\d{8}T\d{6}Z\.json$/);
  for (const text of [result.stdout, result.stderr, file.text, JSON.stringify(log)]) {
    assert.ok(!text.includes(FAKE_KEY), 'the key must never be printed or written');
  }

  // The owner leg's acceptance, in the probe's terms.
  assert.equal(out.metadata.rowsExpected, 15);
  assert.equal(out.metadata.rowsWritten, 15);
  assert.equal(out.metadata.complete, true);
  assert.equal(out.metadata.totalErrors, 0);
  assert.equal(out.metadata.spend.stoppedAtCap, false);
  assert.equal(out.metadata.routing, 'in-loop');

  // Each load and how it ended, with loadAsked: On rows load Socrata with no
  // question put; the Ask-first rows ask, and `off` declines.
  for (const row of out.results) {
    const askFirst = row.consent.mode === 'ask-first';
    assert.deepEqual(row.loads, [
      { alias: 'socrata', sourceId: 'socrata', state: askFirst ? 'ask-first' : 'on', outcome: askFirst ? 'declined' : 'loaded', loadAsked: askFirst },
    ], row.key);
    assert.deepEqual(row.loaded, askFirst ? [] : ['socrata']);
    assert.equal(row.checks.pause.pass, true, row.key);
    assert.equal(row.checks.citation.pass, true, row.key);
    assert.equal(row.guidanceFallback, false);
    assert.deepEqual(row.firstRequest.tools, ['load_source']);
    // Per request: the served provider, what was sent, the tokens and both costs.
    for (const request of row.requests) {
      assert.equal(request.provider, 'Fake');
      assert.ok(request.usage.prompt > 0 && request.usage.completion > 0);
      assert.equal(request.reportedCostUsd, 0.000001);
      assert.ok(request.cost.listedUsd > 0);
      assert.equal(request.cost.ofRecordUsd, Math.max(request.cost.listedUsd, request.cost.reportedUsd));
    }
  }
  const chicago = out.results.find((r) => r.queryId === 'Q2' && r.modelId === 'openai/gpt-oss-120b');
  assert.equal(chicago.checks.portal, 'data.cityofchicago.org');
  assert.equal(chicago.checks.portalAnswered, true);
  assert.equal(chicago.checks.expectedDatasetCalled, true);
  assert.equal(chicago.checks.reasoningCounted, true);
  assert.equal(chicago.checks.capSumMatches, true);

  // Part 11: the printed output carries the key check and the balance; the results file never does.
  assert.match(result.stdout, /Key check: OK \(limit \$123\.45, used \$67\.89, remaining \$55\.56\)/);
  for (const forbidden of ['Key check', '123.45', '67.89', '55.56', 'limit_remaining']) {
    assert.ok(!file.text.includes(forbidden), `the results file holds "${forbidden}"`);
  }
});

test('EVAL-OW A12 (C2), end to end: every open-weight request on the wire and in sentFacts carries the ruled provider object, and no Claude request one', () => {
  const { out, log } = probeAgainstStandIn();
  const openWeight = new Set(ALL_MODELS.filter((m) => m.role === 'open-weight').map((m) => m.id));
  assert.equal(openWeight.size, 3);
  const wire = chatRequests(log);
  assert.equal(wire.filter((r) => openWeight.has(r.model)).length > 0, true, 'premise: open-weight requests were sent');
  assert.equal(wire.filter((r) => !openWeight.has(r.model)).length > 0, true, 'premise: Claude requests were sent');
  for (const r of wire) assert.equal(providerProblem(r.body.provider, openWeight.has(r.model)), null, `${r.model}, on the wire`);
  const recorded = out.results.flatMap((row) => row.requests.map((q) => ({ model: row.modelId, sent: q.sent })));
  assert.equal(recorded.length, wire.length, 'every request sent was recorded');
  for (const r of recorded) assert.equal(providerProblem(r.sent.provider, openWeight.has(r.model)), null, `${r.model}, in sentFacts`);
  // The metadata states the object, and each open-weight model's.
  assert.deepEqual(out.metadata.openWeightProvider, RULED_PROVIDER);
  for (const m of out.metadata.models) assert.deepEqual(m.provider, openWeight.has(m.id) ? RULED_PROVIDER : null);
});

test('#573: a slug missing from the live list stops the run before any model call', () => {
  const dir = scratchDir();
  try {
    const list = { ...SNAPSHOT, data: SNAPSHOT.data.filter((m) => m.id !== 'z-ai/glm-5.3-flash') };
    const listPath = path.join(dir, 'list.json');
    writeFileSync(listPath, JSON.stringify(list));
    const result = runHarness(['--probe', '--cap', '3', '--out-dir', dir], {
      env: fakeEnv(dir, { FAKE_OPENROUTER_LIST: listPath }),
      preload: writeFakeEndpoints(dir),
    });
    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, /z-ai\/glm-5\.3-flash: not on OpenRouter's model list/);
    const log = fakeLog(path.join(dir, 'requests.jsonl'));
    assert.equal(chatRequests(log).length, 0, 'no model call before the roster passes');
    assert.equal(log.filter((e) => e.path === '/api/v1/key').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#573: a key the endpoint refuses stops the run before any model call', () => {
  const dir = scratchDir();
  try {
    const result = runHarness(['--probe', '--cap', '3', '--out-dir', dir], {
      env: fakeEnv(dir, { FAKE_KEY_STATUS: '401' }),
      preload: writeFakeEndpoints(dir),
    });
    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, /OpenRouter refused the key \(401 from its key endpoint\); nothing was spent/);
    assert.ok(!(result.stdout + result.stderr).includes(FAKE_KEY));
    assert.equal(chatRequests(fakeLog(path.join(dir, 'requests.jsonl'))).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#573: the cap stops the run before a row whose worst case could cross it, and the exit says so', () => {
  const dir = scratchDir();
  try {
    const result = runHarness(['--probe', '--cap', '0.01', '--out-dir', dir], { env: fakeEnv(dir), preload: writeFakeEndpoints(dir) });
    assert.equal(result.status, 2, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /STOPPED AT CAP/);
    const out = JSON.parse(resultsFile(dir).text);
    assert.equal(out.metadata.spend.stoppedAtCap, true);
    assert.equal(out.metadata.complete, false);
    assert.equal(chatRequests(fakeLog(path.join(dir, 'requests.jsonl'))).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#573: a row closed after its timeout sends nothing more, and a request record keeps no header', async () => {
  const row = { label: 'm Q1', closed: false, requests: [] };
  let sentCount = 0;
  const base = async () => {
    sentCount++;
    return new Response(
      JSON.stringify({
        id: 'g1',
        model: 'm',
        provider: 'P',
        choices: [{ finish_reason: 'length', message: { content: 'abc' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0002, completion_tokens_details: { reasoning_tokens: 3 } },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const fetchFor = recordingFetch(row, base);
  const body = JSON.stringify({ model: 'm', max_completion_tokens: 2000, reasoning_effort: 'low', messages: [{}], tools: [{ function: { name: 't' } }] });
  await fetchFor('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FAKE_KEY}` },
    body,
  });
  assert.equal(sentCount, 1);
  assert.deepEqual(row.requests[0].sent, {
    model: 'm',
    max_tokens: undefined,
    max_completion_tokens: 2000,
    reasoning_effort: 'low',
    provider: undefined,
    stream: undefined,
    messages: 1,
    tools: 1,
    toolNames: ['t'],
    bodyChars: body.length,
  });
  assert.deepEqual(row.requests[0].usage, { prompt: 10, completion: 5, total: 15, reasoning: 3, cachedPrompt: undefined });
  assert.equal(row.requests[0].reportedCostUsd, 0.0002);
  assert.equal(row.requests[0].finishReason, 'length');
  assert.ok(!JSON.stringify(row.requests).includes(FAKE_KEY));

  row.closed = true;
  await assert.rejects(
    fetchFor('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{}' }),
    /closed after its timeout/,
  );
  assert.equal(sentCount, 1, 'a closed row must not reach the network');
});

test('#573: the automatic checks read the calls and requests as recorded, and each can come out either way', () => {
  const q = TEST_QUERIES.find((x) => x.id === 'Q2'); // Chicago, expects 4ijn-s7e5
  const req = (usage, sent = { max_tokens: 2000 }, finishReason = 'stop') => ({ sent, usage, finishReason });
  const base = { response: 'Found in 4ijn-s7e5.', totalTokens: 300, budgetExceeded: false };

  const hit = rowChecks(q, {
    ...base,
    toolsCalled: [
      { name: 'get_data', args: { type: 'metadata', query: '4ijn-s7e5', domain: 'data.cityofchicago.org' } },
      {
        name: 'get_data',
        args: { type: 'query', dataset_id: '4ijn-s7e5', portal: 'data.cityofchicago.org' },
        resultSummary: { rows: 3, columns: 2 },
      },
    ],
  }, [req({ prompt: 100, completion: 50, total: 150 }), req({ prompt: 120, completion: 30, total: 150 })]);
  assert.equal(hit.expectedDatasetCalled, true);
  assert.equal(hit.expectedDatasetAnswered, true);
  assert.equal(hit.expectedDatasetCited, true);
  assert.equal(hit.portalAnswered, true);
  assert.deepEqual(hit.sourcesReached, [{ portal: 'data.cityofchicago.org', datasetId: '4ijn-s7e5' }]);
  assert.equal(hit.reasoningCounted, null, 'no reasoning reported, nothing to say');
  assert.equal(hit.capSumMatches, true);
  assert.equal(hit.limitOverrun, false);

  const miss = rowChecks(q, {
    ...base,
    response: 'No data.',
    toolsCalled: [
      {
        name: 'get_data',
        args: { type: 'query', dataset_id: '4ijn-s7e5', portal: 'data.cityofchicago.org' },
        failed: true,
        failureKind: 'unknown',
      },
      {
        name: 'get_data',
        args: { type: 'catalog', portal: 'data.cityofnewyork.us', query: 'inspections' },
        resultSummary: { rows: 5, columns: 9 },
      },
      // Refused, on a portal nothing else reached: it must not be listed as reached.
      {
        name: 'get_data',
        args: { type: 'query', dataset_id: 'wr8u-xric', portal: 'data.sf.gov' },
        failed: true,
        failureKind: 'unknown',
      },
    ],
  }, [
    req({ prompt: 100, completion: 50, total: 150, reasoning: 80 }), // completion cannot hold the reasoning
    req({ prompt: 100, completion: 2100, total: 2200, reasoning: 10 }, { max_completion_tokens: 2000 }, 'length'),
  ]);
  assert.equal(miss.expectedDatasetCalled, true);
  assert.equal(miss.expectedDatasetAnswered, false, 'a failed call answered nothing');
  assert.equal(miss.expectedDatasetCited, false);
  assert.equal(miss.portalAnswered, false);
  assert.deepEqual(miss.sourcesReached, [], 'a catalog call names no dataset, and refused calls reached nothing');
  assert.equal(miss.failedToolCalls, 2);
  assert.equal(miss.reasoningCounted, false);
  assert.equal(miss.limitOverrun, true);
  assert.equal(miss.finishedAtLength, 1);
  assert.equal(miss.capSumMatches, false, 'the loop counted 300; the requests report 2,350');

  const ambiguous = rowChecks(TEST_QUERIES.find((x) => x.id === 'Q10'), { ...base, toolsCalled: [] }, [req(null)]);
  assert.equal(ambiguous.expectedDatasetCalled, null);
  assert.equal(ambiguous.dataQueries, 0);
  assert.equal(ambiguous.requestsWithoutUsage, 1);
  assert.equal(ambiguous.capSumMatches, null);
});

test('#573: buildOutput counts rows against models × queries and summarizes the checks', () => {
  const models = ALL_MODELS.filter((m) => m.id === 'xiaomi/mimo-v2.6-flash');
  const queries = TEST_QUERIES.filter((q) => ['Q1', 'Q2'].includes(q.id));
  const q1 = queries[0];
  const call = { name: 'get_data', args: { dataset_id: 'erm2-nwe9', portal: q1.portal }, resultSummary: { rows: 1, columns: 1 } };
  const result = {
    modelId: 'xiaomi/mimo-v2.6-flash',
    queryId: 'Q1',
    portal: q1.portal,
    toolCallCount: 1,
    totalTokens: 1000,
    durationMs: 4000,
    costUsd: 0.01,
    checks: rowChecks(q1, { response: 'erm2-nwe9', toolsCalled: [call], totalTokens: 1000 }, []),
  };
  const error = { modelId: 'xiaomi/mimo-v2.6-flash', queryId: 'Q2', isTimeout: true, costUsd: 0.02 };
  const out = buildOutput({ meta: { mode: 'run' }, models, queries, results: [result], errors: [error] });
  assert.equal(out.metadata.rowsExpected, 2);
  assert.equal(out.metadata.rowsWritten, 2);
  assert.equal(out.metadata.complete, true, 'a timed-out row is a written row');
  assert.equal(out.metadata.totalTimeouts, 1);
  assert.deepEqual(out.metadata.models[0].requestParameters, { max_tokens: 4000 });
  assert.deepEqual(out.metadata.models[0].provider, RULED_PROVIDER);
  assert.equal(out.metadata.limits.maxCumulativeTokens, 200_000);
  // A plan's rows, when given, are what a run is counted against.
  assert.equal(buildOutput({ meta: {}, models, queries, rows: [{}, {}, {}], results: [result], errors: [error] }).metadata.rowsExpected, 3);
  const [s] = out.summary;
  assert.equal(s.expectedDatasetAnswered, '1/1');
  assert.equal(s.timeouts, 1);
  assert.equal(s.costUsd, 0.01);
  assert.equal(buildOutput({ meta: {}, models, queries, results: [result], errors: [] }).metadata.complete, false);
});

test('#573: the recorded tool results are what they claim, and each verdict is reachable', () => {
  const byId = Object.fromEntries(TOOL_RESULTS.fixtures.map((f) => [f.id, f]));
  for (const fixture of TOOL_RESULTS.fixtures) {
    assert.equal(resultShape(fixture.text), fixture.shape, `${fixture.id} is declared ${fixture.shape}`);
    // A whole text must be able to come back "whole": every expected value is in it.
    assert.equal(quoteVerdict(fixture.expect, fixture.text, true).verdict, 'whole', fixture.id);
  }
  // The known red holds exactly one JSON object; the control holds no brace at all.
  const red = byId['socrata-guidance-with-object'].text;
  assert.equal((red.match(/\{/g) ?? []).length, 1);
  assert.equal((red.match(/\}/g) ?? []).length, 1);
  assert.doesNotMatch(byId['socrata-guidance-cut-no-braces'].text, /[{}]/);
  // What the spike found a Google model received, reduced to the object: lost.
  const objectAlone = red.slice(red.indexOf('{'), red.indexOf('}') + 1);
  assert.equal(quoteVerdict(byId['socrata-guidance-with-object'].expect, objectAlone, true).verdict, 'lost');
  // The query envelope's first row alone: partial, not whole.
  const envelope = JSON.parse(byId['socrata-query-envelope'].text);
  assert.equal(quoteVerdict(byId['socrata-query-envelope'].expect, JSON.stringify(envelope.data[0]), true).verdict, 'partial');
  assert.equal(quoteVerdict(['x'], 'x', false).verdict, 'inconclusive');

  assert.equal(resultShape('{"a":1}'), 'json-object');
  assert.equal(resultShape('[{"a":1}]'), 'json-array');
  assert.equal(resultShape('plain words'), 'text-no-braces');
  assert.equal(resultShape('words {"a": 1} words'), 'text-with-json-object');
  assert.equal(resultShape('a {placeholder} here'), 'text-with-braces');
  assert.deepEqual(genericExpectations('Found 2 indicators for NYC.\n{"variables": ["X"]}\nUse get_observations next please.'), [
    'Found 2 indicators for NYC.',
    'Use get_observations next please.',
  ]);
});

// --- #609: the live captures' names ---
//
// Until EVAL-OW P1 (#740) this section also held the harness's all-sources
// offer to the app's (A1: every request's tools and composed prompt, at two
// configurations). The harness now runs every row in loop, as production
// does, and A2 at the foot of this file holds its first request to the one
// the route itself sends.

/** The environment that configures every optional source the manifest has. */
function everyOptionalSource() {
  const env = {};
  for (const entry of CIVIC_MANIFEST) {
    if (entry.configuration.requirement !== 'optional') continue;
    const variable = entry.configuration.addressVariable;
    env[variable] = variable.endsWith('_HOSTING') ? HOSTING_SANDBOX : `https://fake-${entry.alias}.test/mcp`;
    if (Object.hasOwn(HOSTED_SOURCE_KEY_VARIABLE, entry.sourceId)) env[HOSTED_SOURCE_KEY_VARIABLE[entry.sourceId]] = 'fixture';
  }
  return env;
}

const toolNames = (tools) => (tools ?? []).map((t) => t.function?.name);

test('#609: every live capture names a tool the app offers, and the name routes to the capture\'s own source', () => {
  const offered = new Set(toolNames(mcpTools));
  for (const capture of LIVE_CAPTURES) {
    assert.ok(offered.has(capture.tool), `${capture.id}: "${capture.tool}" is not a name mcpTools holds`);
  }
  // What the client routes each name to (`routeToolCall`, through the same
  // registry), with every source configured: the capture's own source.
  const configured = readMcpEnv({ SOCRATA_MCP_URL: 'https://fake-socrata.test', ...everyOptionalSource() });
  for (const capture of LIVE_CAPTURES) {
    assert.equal(routedSourceId(capture.tool, configured), capture.source, capture.id);
  }
});

// --- EVAL-OW P1 (#740): the app's in-loop request shape, and the provider object ---
//
// A2 (C1). A row's first request equals the app's first request for the same
// question, model and configuration under `SOURCE_ROUTING=in-loop`: tools
// `[load_source]`, the directory prompt, and the model, limit and reasoning
// fields. The app's side is CAPTURED FROM THE ROUTE ITSELF
// (`src/app/api/compare-stream/route.ts`), driven in a child process as
// `src/app/api/in-loop-routing-driven.test.ts` drives it: `module.registerHooks()`
// resolves `@/` and stubs the modules that need a request scope or a sign-in
// provider, the model endpoint is the built-in one with its requests answered
// and recorded in process, and the consent in force is the real encoder's
// cookie. A reference rebuilt from
// the functions the harness calls would agree with the harness by
// construction (the seat's ruling, #740 comment 6728891704 point 1).
//
// Three named configurations, so no one fixed request can equal them all:
// the default sources (Socrata, and Data Commons, which has a coded default
// address), every source On; the defaults with Boston OpenContext, every
// source On; and that configuration with Socrata Ask first. The first two
// list different directories, so their prompts and `load_source` enums
// differ; the third is a pause row's first request.
//
// A12 (C2). Every open-weight request carries exactly the ruled `provider`
// object (#740 D3 = A), read from what the row recorded it sent
// (`sentFacts`), and no Claude request carries one.

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const REPO_DIR = path.resolve(SRC_DIR, '..');

/**
 * The route's side: drives `POST /api/compare-stream` once per entry of
 * DRIVES (model, question, portal, configuration, consent states), each with
 * its own environment, and writes the first model request of each to
 * DRIVER_OUT. The stand-in model answers every request at once with no tool
 * call, so a drive is one request and contacts no source.
 */
const ROUTE_DRIVER_SOURCE = `
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { pathToFileURL } from 'node:url';

const SRC = process.env.DRIVER_SRC;
const STUB_PREFIX = 'file:///eval-ow-p1-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const STUB_SOURCE = {
  'next/headers': "export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.61' }); }",
  'next-auth': 'export async function getServerSession() { return null; }',
  '@/lib/auth': 'export const authOptions = {};',
  '@/lib/sandbox': 'import { NotebookExecutionError } from ' + JSON.stringify(DRIVER_URL) + '; export { NotebookExecutionError }; export async function executeNotebook() { throw new Error("no sandbox in this drive"); }',
};
nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(STUB_SOURCE, specifier)) return { url: STUB_PREFIX + encodeURIComponent(specifier) + '.mjs', format: 'module', shortCircuit: true };
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) {
        try { if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true }; } catch {}
      }
      throw new Error('route driver: cannot resolve ' + specifier);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(url.slice(STUB_PREFIX.length).replace(/\\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// The model endpoint is the built-in one, as in production: the built-in
// catalog is offered only against it (no MODEL_API_BASE_URL is set). Its
// chat-completions requests are answered here, in process, and recorded;
// every other request leaves for nowhere.
const requests = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== 'openrouter.ai' || url.pathname !== '/api/v1/chat/completions') throw new TypeError('fetch failed');
  const body = JSON.parse(typeof init.body === 'string' ? init.body : await new Response(init.body).text());
  requests.push(body);
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  if (body.stream === true) {
    const frame = 'data: ' + JSON.stringify({ id: 'd', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { content: 'Answer.' }, finish_reason: 'stop' }], usage }) + '\\n\\n';
    return new Response(frame + 'data: [DONE]\\n\\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return new Response(JSON.stringify({ id: 'd', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: 'A fixture answer that names no dataset.' }, finish_reason: 'stop' }], usage }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { _resetDefaultModelClientForTests } = await import(pathToFileURL(path.join(SRC, 'lib/model-client.ts')).href);
_resetDefaultModelClientForTests();
const { consentCookieForTests } = await import(pathToFileURL(path.join(SRC, 'lib/sources/consent-cookie-for-tests.ts')).href);
const route = await import(pathToFileURL(path.join(SRC, 'app/api/compare-stream/route.ts')).href);

const VARIABLES = JSON.parse(process.env.DRIVER_VARIABLES);
const out = [];
for (const d of JSON.parse(process.env.DRIVES)) {
  for (const name of VARIABLES) delete process.env[name];
  Object.assign(process.env, d.env);
  const from = requests.length;
  const response = await route.POST(new Request('http://localhost/api/compare-stream', {
    method: 'POST',
    headers: { cookie: consentCookieForTests(d.states) },
    body: JSON.stringify({ query: d.query, model: d.model, portal: d.portal, mcpOnly: true }),
  }));
  const text = await response.text();
  out.push({ ...d, first: requests[from] ?? null, requests: requests.length - from, responseHead: requests[from] ? undefined : text.slice(0, 600) });
}
fs.writeFileSync(process.env.DRIVER_OUT, JSON.stringify(out));
process.exit(0);
`;

/** The source-configuration variables a drive sets or clears, from the manifest. */
const SOURCE_VARIABLES = [
  ...new Set(CIVIC_MANIFEST.flatMap((e) => [e.configuration.addressVariable, e.configuration.keyVariable].filter(Boolean))),
];

const DEFAULT_SOURCES_ENV = { SOCRATA_MCP_URL: 'https://fake-socrata.test', DATA_COMMONS_MCP_URL: 'https://fake-datacommons.test/mcp' };
const WITH_BOSTON_ENV = { ...DEFAULT_SOURCES_ENV, BOSTON_OPENCONTEXT_MCP_URL: 'https://fake-boston.test/mcp' };

/** The three named configurations of C1: the sources each configures, and Socrata's consent. */
const C1_CONFIGURATIONS = [
  { name: 'the default sources, every source On', env: DEFAULT_SOURCES_ENV, states: {} },
  { name: 'the defaults and Boston OpenContext, every source On', env: WITH_BOSTON_ENV, states: {} },
  { name: 'the defaults and Boston OpenContext, Socrata Ask first', env: WITH_BOSTON_ENV, states: { socrata: 'ask-first' } },
];

/** The two Claude models the route offers from the built-in catalog, and one question. */
const C1_MODELS = ['anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5'];
const C1_QUERY = TEST_QUERIES.find((q) => q.id === 'Q2');

/** The route's first request for every (configuration, model), memoized. */
let routeFirstRequests;
function routeDrives() {
  if (routeFirstRequests) return routeFirstRequests;
  const dir = scratchDir();
  try {
    const out = path.join(dir, 'route.json');
    const drives = C1_CONFIGURATIONS.flatMap((c) =>
      C1_MODELS.map((model) => ({ configuration: c.name, model, query: C1_QUERY.query, portal: C1_QUERY.portal, env: c.env, states: c.states })),
    );
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', ROUTE_DRIVER_SOURCE], {
      cwd: REPO_DIR,
      encoding: 'utf-8',
      timeout: 120_000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SOURCE_ROUTING: 'in-loop',
        RATE_LIMIT_SECRET: 'fixture',
        OPENROUTER_API_KEY: 'fixture',
        DRIVER_SRC: SRC_DIR,
        DRIVER_OUT: out,
        DRIVER_VARIABLES: JSON.stringify(SOURCE_VARIABLES),
        DRIVES: JSON.stringify(drives),
      },
    });
    assert.equal(result.status, 0, `the route drive failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    routeFirstRequests = JSON.parse(readFileSync(out, 'utf-8'));
    return routeFirstRequests;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The harness's side: one run per source configuration, against the stand-in; every first request it sent. */
const harnessRuns = new Map();
function harnessFirstRequests(env) {
  const key = JSON.stringify(env);
  if (harnessRuns.has(key)) return harnessRuns.get(key);
  const dir = scratchDir();
  try {
    const index = TEST_QUERIES.findIndex((q) => q.id === C1_QUERY.id) + 1;
    const run = runHarness(['--cap', '30', '--out-dir', dir], {
      env: {
        ...fakeEnv(dir, { EVAL_MODELS: C1_MODELS.join(','), EVAL_QUERIES: String(index), EVAL_REPEATS: '1', EVAL_ROW_GAP_MS: '0' }),
        ...env,
      },
      preload: writeFakeEndpoints(dir),
    });
    assert.equal(run.status, 0, `harness run\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    const firsts = chatRequests(fakeLog(path.join(dir, 'requests.jsonl'))).filter((r) => r.messages === 2).map((r) => r.body);
    const found = { firsts, out: JSON.parse(resultsFile(dir).text) };
    harnessRuns.set(key, found);
    return found;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The request fields A2 names, by name. */
const firstRequestFields = (body) => ({
  model: body.model,
  tools: toolNames(body.tools),
  system: body.messages?.find((m) => m.role === 'system')?.content,
  user: body.messages?.find((m) => m.role === 'user')?.content,
  max_tokens: body.max_tokens,
  max_completion_tokens: body.max_completion_tokens,
  reasoning_effort: body.reasoning_effort,
});

test('EVAL-OW P1 A2 (C1): a row\'s first request equals the route\'s first request, under in-loop, at three named configurations', () => {
  const route = routeDrives();
  assert.equal(route.length, C1_CONFIGURATIONS.length * C1_MODELS.length);
  for (const drive of route) assert.ok(drive.first, `${drive.configuration} ${drive.model}: the route sent no model request:\n${drive.responseHead}`);

  // The instrument: the route's first request offers load_source alone, and
  // the two directories differ, so no fixed request equals both.
  for (const drive of route) assert.deepEqual(toolNames(drive.first.tools), ['load_source'], `${drive.configuration}: premise`);
  const systemOf = (c) => firstRequestFields(route.find((d) => d.configuration === c.name).first).system;
  assert.notEqual(systemOf(C1_CONFIGURATIONS[0]), systemOf(C1_CONFIGURATIONS[1]));

  for (const configuration of C1_CONFIGURATIONS) {
    const { firsts } = harnessFirstRequests(configuration.env);
    for (const model of C1_MODELS) {
      const app = route.find((d) => d.configuration === configuration.name && d.model === model).first;
      const harness = firsts.filter((b) => b.model === model && firstRequestFields(b).user === C1_QUERY.query);
      assert.ok(harness.length > 0, `${configuration.name} ${model}: the harness sent no first request for ${C1_QUERY.id}`);
      for (const body of harness) {
        assert.deepEqual(firstRequestFields(body), firstRequestFields(app), `${configuration.name} ${model}: the named fields differ`);
        // And the whole body, so a field A2 does not name cannot differ either.
        assert.ok(isDeepStrictEqual(body, app), `${configuration.name} ${model}: the bodies differ beyond the named fields`);
      }
    }
  }
});

test('EVAL-OW P1 A12 (C2): an open-weight request carries exactly the ruled provider object, read from sentFacts; a Claude request carries none', async () => {
  const wire = [];
  const base = async (_url, init) => {
    wire.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({ id: 'g', model: 'm', provider: 'P', choices: [{ finish_reason: 'stop', message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const send = (row, model, fields) =>
    recordingFetch(row, base)('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model, messages: [{}], tools: [{}], ...fields }),
    });

  const openWeight = { label: 'z-ai/glm-5.3-flash Q1', closed: false, requests: [], provider: RULED_PROVIDER };
  await send(openWeight, 'z-ai/glm-5.3-flash', { max_tokens: 4000, reasoning_effort: 'low' });
  const claude = { label: 'anthropic/claude-haiku-5.5 Q1', closed: false, requests: [] };
  await send(claude, 'anthropic/claude-haiku-5.5', { max_completion_tokens: 4000, reasoning_effort: 'low' });

  // Read from what the row recorded it sent.
  assert.equal(providerProblem(openWeight.requests[0].sent?.provider, true), null);
  assert.equal(providerProblem(claude.requests[0].sent?.provider, false), null);
  // And from what reached the wire.
  assert.deepEqual(wire[0].provider, RULED_PROVIDER);
  assert.equal(Object.hasOwn(wire[1], 'provider'), false);

  // The check fails on each mutation it exists for.
  const withoutDeny = { max_price: RULED_PROVIDER.max_price, require_parameters: true };
  assert.match(providerProblem({ ...RULED_PROVIDER, order: ['Fake'] }, true), /pinned \(order\)/);
  assert.match(providerProblem({ ...RULED_PROVIDER, only: ['Fake'] }, true), /pinned \(only\)/);
  assert.match(providerProblem(withoutDeny, true), /not the ruled object/);
  assert.match(providerProblem(undefined, true), /carried no provider/);
  assert.match(providerProblem(RULED_PROVIDER, false), /a Claude request carried provider/);
});

// --- EVAL-OW P1: the pause self-test, the stops, the bounds and the limits ---

test('EVAL-OW C3: the pause self-test — off ends the load declined; after allow-all no later load pauses; allow, the contrast, pauses again', async () => {
  // What the scripted decisions fix is the app's code (`createInLoopRouting`,
  // `src/lib/mcp/routing-mode.ts:326`, `allowedAll` at `:299`, `:314`,
  // `:328`), driven here through the harness's own scripted pause.
  assert.equal(CONSENT_GATE_ENFORCED, true, 'the harness states the gate enforced, as the app runs it');
  const realFetch = globalThis.fetch;
  // A load composes the source's guidance; offline, it falls back, which this test does not read.
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  try {
    const configured = readMcpEnv({ SOCRATA_MCP_URL: 'https://fake-socrata.test', DATA_COMMONS_MCP_URL: 'https://fake-datacommons.test/mcp' });
    const routed = async (decision, consent) => {
      const asked = new Set();
      let asks = 0;
      const scripted = scriptedPause(decision, asked);
      const routing = await createInLoopRouting({
        configured,
        directory: directorySet(configured, consent),
        selection: [],
        pause: { ask: (id, report) => { asks++; return scripted.ask(id, report); } },
        callTool: async () => 'fixture',
      });
      const load = async (alias) => (await routing.loadStep.load(alias, { iteration: 1 })).outcome;
      return { load, asked, asks: () => asks };
    };
    // Both sources Ask first: the gate enforced, no stored state.
    const bothAskFirst = { enforced: true, states: {} };

    const off = await routed('off', bothAskFirst);
    assert.equal(await off.load('socrata'), 'declined');
    assert.equal(await off.load('socrata'), 'declined', 'a second load repeats the first outcome');
    assert.equal(off.asks(), 1, 'and asks nothing');
    assert.deepEqual([...off.asked], ['socrata']);

    const allowAll = await routed('allow-all', bothAskFirst);
    assert.equal(await allowAll.load('socrata'), 'loaded');
    assert.equal(await allowAll.load('data_commons'), 'loaded');
    assert.equal(allowAll.asks(), 1, 'after allow-all, no later load pauses');

    const allow = await routed('allow', bothAskFirst);
    assert.equal(await allow.load('socrata'), 'loaded');
    assert.equal(await allow.load('data_commons'), 'loaded');
    assert.equal(allow.asks(), 2, 'the contrast: after allow, the next Ask-first load pauses again');

    // The harness's configuration: the gold source Ask first, every other On.
    const harness = await routed('off', consentStates(goldAskFirst('off')));
    assert.equal(await harness.load('data_commons'), 'loaded');
    assert.equal(harness.asks(), 0, 'an On source asks nothing');
    assert.equal(await harness.load('socrata'), 'declined');
    assert.equal(harness.asks(), 1);

    // The decisions a plan scripts are off and allow, and allow-all is this test's only.
    const scripted = new Set([...planFor('run', {}).rows, ...planFor('probe').rows].map((r) => r.consent.decision ?? 'none'));
    assert.deepEqual([...scripted].sort(), ['allow', 'none', 'off']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/** The preflight against the stand-in, at an environment. */
function preflightAt(extra, list) {
  const dir = scratchDir();
  try {
    const env = fakeEnv(dir, extra);
    if (list) {
      env.FAKE_OPENROUTER_LIST = path.join(dir, 'list.json');
      writeFileSync(env.FAKE_OPENROUTER_LIST, JSON.stringify(list));
    }
    const result = runHarness(['--preflight'], { env, preload: writeFakeEndpoints(dir) });
    return { result, log: fakeLog(path.join(dir, 'requests.jsonl')), output: result.stdout + result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('EVAL-OW C5: the preflight prints the environment by name, the key check, the roster, every source with its hosting and the guidance\'s origin, and sends no model request', () => {
  const { result, log, output } = preflightAt({});
  assert.equal(result.status, 0, output);
  for (const name of runVariables()) assert.match(result.stdout, new RegExp(`\\n {2}${name} +(set|absent)\\n`), name);
  assert.match(result.stdout, / {2}OPENROUTER_API_KEY +set\n/);
  assert.match(result.stdout, / {2}NYC_CHARTER_HOSTING +absent\n/);
  for (const value of [FAKE_KEY, 'fake-socrata.test', 'fake-datacommons.test']) assert.ok(!output.includes(value), `a value was printed: ${value}`);
  assert.match(result.stdout, /Key check: OK/);
  assert.match(result.stdout, /Roster check: OK\./);
  assert.match(result.stdout, / {2}socrata +remote +\(SOCRATA_MCP_URL\)/);
  assert.match(result.stdout, / {2}nyc_charter +not configured +\(NYC_CHARTER_HOSTING\)/);
  assert.match(result.stdout, /Socrata guidance, as a load composes it for data\.cityofnewyork\.us: endpoint/);
  assert.match(result.stdout, /Preflight OK\. Nothing was sent to a model\./);
  assert.equal(chatRequests(log).length, 0);
});

test('EVAL-OW C5: each preflight stop line prints and exits before any model request', () => {
  const missingGlm = { ...SNAPSHOT, data: SNAPSHOT.data.filter((m) => m.id !== 'z-ai/glm-5.3-flash') };
  const stops = [
    { name: 'the key absent', extra: { OPENROUTER_API_KEY: '' }, line: /Error: OPENROUTER_API_KEY environment variable is required/, network: false },
    { name: 'a 1Password reference', extra: { OPENROUTER_API_KEY: 'op://Private/OpenRouter/key' }, line: /Error: OPENROUTER_API_KEY holds a 1Password reference, not a key/, network: false },
    { name: 'a hosted source switched on', extra: { NYC_CHARTER_HOSTING: 'sandbox' }, line: /Error: this configuration would start a sandbox for a hosted source \(nyc_charter, NYC_CHARTER_HOSTING\)/, network: false },
    { name: 'a roster problem', extra: {}, list: missingGlm, line: /z-ai\/glm-5\.3-flash: not on OpenRouter's model list/ },
    { name: 'the key refused', extra: { FAKE_KEY_STATUS: '401' }, line: /Error: OpenRouter refused the key \(401 from its key endpoint\); nothing was spent/ },
    { name: 'a fallback composition', extra: { FAKE_SKILL: 'refuse' }, line: /Error: the Socrata guidance fell back to the app's fallback text/ },
  ];
  for (const stop of stops) {
    const { result, log, output } = preflightAt(stop.extra, stop.list);
    assert.equal(result.status, 1, `${stop.name}\n${output}`);
    assert.match(output, stop.line, stop.name);
    assert.doesNotMatch(output, /Preflight OK/, stop.name);
    assert.equal(chatRequests(log).length, 0, `${stop.name}: a model request was sent`);
    if (stop.network === false) assert.deepEqual(log, [], `${stop.name}: stopped before any request at all`);
  }
});

test('EVAL-OW C5: the run refuses a sandbox-starting configuration and a fallback composition too, before any model request', () => {
  for (const [extra, line] of [
    [{ NYC_CHARTER_HOSTING: 'sandbox' }, /would start a sandbox for a hosted source \(nyc_charter, NYC_CHARTER_HOSTING\)/],
    [{ FAKE_SKILL: 'refuse' }, /the Socrata guidance fell back to the app's fallback text/],
  ]) {
    const dir = scratchDir();
    try {
      const result = runHarness(['--probe', '--cap', '3', '--out-dir', dir], { env: fakeEnv(dir, extra), preload: writeFakeEndpoints(dir) });
      assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      assert.match(result.stderr, line);
      assert.equal(chatRequests(fakeLog(path.join(dir, 'requests.jsonl'))).length, 0);
      assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('eval-results-')), [], 'no results file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * The calibrated bound by the proposed method, computed here from the
 * fixture's prices, so the harness's printed figure can disagree with it.
 */
function expectedBound(probe, rowsPerModel) {
  const prices = (id) => SNAPSHOT.data.find((m) => m.id === id).pricing;
  let high = 0;
  let headline = 0;
  for (const model of ALL_MODELS) {
    const rows = [...probe.results, ...probe.errors].filter((r) => r.modelId === model.id);
    const prompts = rows.map((r) => r.requests.reduce((s, q) => s + q.usage.prompt, 0));
    const completion = Math.max(...rows.flatMap((r) => r.requests.map((q) => Math.max(q.usage.completion, q.usage.reasoning ?? 0))));
    const rowPrompt = Math.min(600_000, 2 * Math.max(...prompts));
    const rowRequests = Math.min(22, 2 * Math.max(...rows.map((r) => r.requests.length)));
    const allowance = Math.min(4000, 2 * completion);
    const reservation = reservationPricing(model, SNAPSHOT);
    const listed = prices(model.id);
    const at = (input, output) => (rowPrompt * input + rowRequests * allowance * output) / 1e6;
    high += rowsPerModel * at(reservation.input, reservation.output);
    headline += rowsPerModel * at(Number(listed.prompt) * 1e6, Number(listed.completion) * 1e6);
  }
  return { high, headline };
}

function calibrateOn(probe) {
  const dir = scratchDir();
  try {
    const file = path.join(dir, 'eval-results-probe-shaped.json');
    writeFileSync(file, JSON.stringify(probe));
    // No preload, and none needed: --calibrate makes no network call, which the no-network preload shows.
    return runHarness(['--calibrate', file], { preload: NO_NETWORK });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const printedBound = (stdout, which) => Number(stdout.match(new RegExp(`Calibrated bound, ${which}: +\\$(\\d+\\.\\d\\d)`))?.[1]);

test('EVAL-OW C5: --calibrate on the stand-in\'s probe file and on two recorded profiles prints both bounds and the cap rule\'s outcome', () => {
  // The rule itself, at each of its three branches.
  assert.equal(capRule(41.2, 3).cap, 42);
  assert.match(capRule(80, 3).line, /at or under \$80\.00: the cap is the bound rounded up, --cap 80/);
  assert.deepEqual([capRule(90.5, 10).run, capRule(90.5, 10).cap], [true, 91]);
  assert.deepEqual([capRule(90.5, 60).run, capRule(90.5, 60).cap], [false, null]);

  // 1. The probe file the stand-in endpoints wrote.
  const { out } = probeAgainstStandIn();
  const plain = calibrateOn(out);
  assert.equal(plain.status, 0, `stdout:\n${plain.stdout}\nstderr:\n${plain.stderr}`);
  assert.doesNotMatch(plain.stdout + plain.stderr, /no-network preload/);
  assert.match(plain.stdout, /The run: 255 rows/);
  const plainExpected = expectedBound(out, 51);
  assert.equal(printedBound(plain.stdout, 'high-priced'), Number(plainExpected.high.toFixed(2)));
  assert.equal(printedBound(plain.stdout, 'headline'), Number(plainExpected.headline.toFixed(2)));
  assert.match(plain.stdout, new RegExp(`Cap rule: the bound is at or under \\$80\\.00: the cap is the bound rounded up, --cap ${Math.ceil(plainExpected.high)}\\n`));

  // 2. The same rows with every prompt at 90,000 billed tokens: the
  // high-priced bound crosses $80 and the headline bound does not.
  const shaped = structuredClone(out);
  for (const row of shaped.results) for (const request of row.requests) request.usage.prompt = 90_000;
  shaped.metadata.spend.chargedUsd = 2;
  const expected = expectedBound(shaped, 51);
  assert.ok(expected.high > 80 && expected.high <= 150 && expected.headline <= 80, `premise: ${JSON.stringify(expected)}`);
  const runs = calibrateOn(shaped);
  assert.equal(runs.status, 0, `stdout:\n${runs.stdout}\nstderr:\n${runs.stderr}`);
  assert.equal(printedBound(runs.stdout, 'high-priced'), Number(expected.high.toFixed(2)));
  assert.equal(printedBound(runs.stdout, 'headline'), Number(expected.headline.toFixed(2)));
  assert.match(runs.stdout, /Cap rule: the bound is above \$80\.00; the probe's recorded spend \$2\.00 plus the cap \$\d+\.00 is \$\d+\.00, at or under \$150\.00: --cap \d+/);

  // 3. That profile with a probe that recorded $70: the high-priced bound is
  // what stops the run (the headline bound plus $70 would be under $150), and
  // both bounds are printed before the stop.
  shaped.metadata.spend.chargedUsd = 70;
  assert.ok(70 + Math.ceil(expected.headline) <= 150 && 70 + Math.ceil(expected.high) > 150, 'premise: only the high-priced bound stops it');
  const stops = calibrateOn(shaped);
  assert.equal(stops.status, 3, `stdout:\n${stops.stdout}\nstderr:\n${stops.stderr}`);
  const at = (pattern) => stops.stdout.search(pattern);
  assert.ok(at(/Calibrated bound, high-priced/) !== -1 && at(/Calibrated bound, headline/) !== -1);
  assert.ok(at(/Calibrated bound, headline/) < at(/Cap rule:/), 'both bounds print before the stop');
  assert.match(stops.stdout, /Cap rule: the bound is above \$80\.00, and the probe's recorded spend \$70\.00 plus the cap \$\d+\.00 would be \$\d+\.00, above \$150\.00: no run; the seat takes it to the owner/);

  // A file that is not a probe's is refused.
  const notProbe = calibrateOn({ ...out, metadata: { ...out.metadata, mode: 'run' } });
  assert.equal(notProbe.status, 1);
  assert.match(notProbe.stderr, /is not a probe's results file \(mode run\)/);
});

test('EVAL-OW C6: the run\'s limits are 200,000, 4,000 and 20, read from what the harness passes the loop', async () => {
  const source = readFileSync(SCRIPT, 'utf-8');
  assert.match(source, /await runToolLoop\(\{\n\s+client,\n\s+\.\.\.loopOptions\(\{/, 'a row hands the loop loopOptions, whole');
  const configured = readMcpEnv({ SOCRATA_MCP_URL: 'https://fake-socrata.test' });
  const routing = await createInLoopRouting({ configured, directory: directorySet(configured, consentStates({ mode: 'every-source-on' })), selection: ['socrata'] });
  const loadStep = { toolName: 'load_source', load: async () => ({ outcome: 'not-offered', text: '' }) };
  const executeToolCall = async () => '';
  const model = ALL_MODELS.find((m) => m.id === 'z-ai/glm-5.3-flash');
  const query = TEST_QUERIES.find((q) => q.id === 'Q6');
  const options = loopOptions({ model, query, routing, loadStep, executeToolCall });
  assert.deepEqual(
    {
      maxCumulativeTokens: options.maxCumulativeTokens,
      maxTokens: options.maxTokens,
      maxIterations: options.maxIterations,
      maxToolResultChars: options.maxToolResultChars,
      toolTimeoutMs: options.toolTimeoutMs,
      finalTurn: options.finalTurn,
    },
    { maxCumulativeTokens: 200_000, maxTokens: 4000, maxIterations: 20, maxToolResultChars: 50_000, toolTimeoutMs: 45_000, finalTurn: 'stream' },
  );
  assert.deepEqual(APP_LIMITS, { maxIterations: 20, maxTokens: 4000, maxCumulativeTokens: 200_000, maxToolResultChars: 50_000, toolTimeoutMs: 45_000, finalTurn: 'stream' });
  assert.equal(options.systemPrompt, routing.firstSystemPrompt);
  assert.equal(options.tools, routing.firstTools);
  assert.equal(options.loadStep, loadStep);
  assert.equal(options.executeToolCall, executeToolCall);
  assert.deepEqual([options.endpointModel, options.requestSettings, options.prompt, options.portal, options.lockedPortal], [
    model.id, model.requestSettings, query.query, query.portal, undefined,
  ]);
});

/** A short run against the stand-in: one model, Q2, one repeat (Q2 On, Q2 off, Q2 allow). */
function shortRun(extra) {
  const dir = scratchDir();
  try {
    const index = TEST_QUERIES.findIndex((q) => q.id === 'Q2') + 1;
    const env = fakeEnv(dir, { EVAL_MODELS: 'anthropic/claude-haiku-5.5', EVAL_QUERIES: String(index), EVAL_REPEATS: '1', EVAL_ROW_GAP_MS: '0', ...extra });
    const result = runHarness(['--cap', '30', '--out-dir', dir], { env, preload: writeFakeEndpoints(dir) });
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    return { out: JSON.parse(resultsFile(dir).text), log: fakeLog(path.join(dir, 'requests.jsonl')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('EVAL-OW C6: a model that never answers runs 20 rounds and a streamed answering turn, read and recorded whole; the pause check fires on its reloads', () => {
  const { out, log } = shortRun({ FAKE_CHAT: 'always-tool' });
  assert.equal(out.results.length, 3);
  for (const row of out.results) {
    assert.equal(row.iterations, 20, row.key);
    assert.equal(row.requests.length, 22, `${row.key}: the first request, 20 rounds and the answering turn`);
    assert.equal(row.answeringTurnTaken, true);
    assert.equal(row.response, 'Streamed answer.');
    for (const request of row.requests) assert.equal(request.sent.max_completion_tokens, 4000);
    const last = row.requests.at(-1);
    assert.equal(last.sent.stream, true, 'the answering turn streams, as the app\'s does');
    assert.equal(last.streamed, true);
    assert.equal(last.provider, 'Fake');
    assert.ok(last.usage?.prompt > 0, 'a streamed body\'s usage is read');
    assert.equal(last.reportedCostUsd, 0.000001);
    assert.equal(last.unreadable, undefined);
  }
  assert.equal(chatRequests(log).filter((r) => r.body.stream === true).length, 3);
  // Declined, the stand-in keeps asking for Socrata: the check fires on the model's behaviour.
  const off = out.results.find((r) => r.consent.decision === 'off');
  assert.equal(off.checks.pause.pass, false);
  assert.equal(off.checks.pause.declineRespected.reloads, 19, 'twenty loads ran, the first declined');
  assert.ok(off.loads.every((l) => l.outcome === 'declined' && l.loadAsked === true));
  assert.equal(out.results.find((r) => r.consent.mode === 'every-source-on').checks.pause.pass, true);
});

test('EVAL-OW C6: the 200,000-token cumulative bound stops a row after the round that crosses it, then the answering turn', () => {
  const { out } = shortRun({ FAKE_CHAT: 'always-tool', FAKE_USAGE_TOTAL: '60000' });
  for (const row of out.results) {
    assert.equal(row.budgetExceeded, true, row.key);
    // 60,000, 120,000, 180,000, then 240,000 crosses it: four requests, and the answering turn.
    assert.equal(row.requests.length, 5, row.key);
    assert.equal(row.totalTokens, 300_000);
    assert.equal(row.checks.capSumMatches, true);
  }
});

test('EVAL-OW: a streamed body folds into the fields a JSON body gives', () => {
  const text =
    'data: {"id":"g","model":"m","provider":"P","choices":[{"delta":{"content":"Hel"}}]}\n\n' +
    'data: {"id":"g","model":"m","provider":"P","choices":[{"delta":{"content":"lo"},"finish_reason":"stop","native_finish_reason":"end"}]}\n\n' +
    ': keep-alive\n\n' +
    'data: {"id":"g","choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9,"cost":0.5}}\n\n' +
    'data: [DONE]\n\n';
  const body = streamedBody(text);
  assert.deepEqual(
    { model: body.model, provider: body.provider, content: body.choices[0].message.content, finish: body.choices[0].finish_reason, usage: body.usage },
    { model: 'm', provider: 'P', content: 'Hello', finish: 'stop', usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9, cost: 0.5 } },
  );
});

test('EVAL-OW: the automatic checks carry the pause and citation verdicts on an in-loop row, and none on a row with no consent', () => {
  const q = TEST_QUERIES.find((x) => x.id === 'Q2');
  const calls = [
    { name: 'load_source', args: { alias: 'socrata' }, operationType: 'load_source', loadOutcome: 'loaded' },
    { name: 'socrata__get_data', args: { type: 'query', dataset_id: '4ijn-s7e5', portal: q.portal }, resultSummary: { rows: 1, columns: 1 } },
  ];
  const checks = rowChecks(q, { response: 'From 4ijn-s7e5.', toolsCalled: calls, totalTokens: 0, consent: goldAskFirst('allow') }, []);
  assert.equal(checks.pause.pass, true);
  assert.equal(checks.pause.allowUsed.dataCalls, 1);
  assert.equal(checks.citation.pass, true);
  const cited = rowChecks(q, { response: 'From erm2-nwe9 【1†source】.', toolsCalled: calls, totalTokens: 0, consent: goldAskFirst('allow') }, []);
  assert.equal(cited.citation.pass, false);
  assert.deepEqual(cited.citation.unaddressed, ['erm2-nwe9']);
  const none = rowChecks(q, { response: '', toolsCalled: calls, totalTokens: 0 }, []);
  assert.deepEqual([none.pause, none.citation], [null, null]);
});
