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
// AND THE APP'S OFFER (#609). The tests at the foot hold the harness to what
// the app offers a model: the tools and the system prompt of every request,
// read from what the harness sent and set against the app's own functions at
// two configurations, and the tool names the live captures call. Q3's portal
// moved with San Francisco's (#587), as a named delta on the query pin.
//
// AND THE APP'S IN-LOOP SHAPE (EVAL-OW P1, #740). The tests at the very foot
// hold a row's first request to the one `src/app/api/compare-stream/route.ts`
// itself sends under `SOURCE_ROUTING=in-loop` (A2), and every open-weight
// request to the ruled `provider` object (A12).
//
// Run with: npm test

import { test } from 'node:test';
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
  LIVE_CAPTURES,
  PROBE,
  QUOTE_MODELS,
  TEST_QUERIES,
  buildOutput,
  checkRoster,
  genericExpectations,
  parseArgs,
  planBounds,
  planFor,
  quoteVerdict,
  recordingFetch,
  resultShape,
  rowChecks,
  runEnvProblem,
} from './eval-models.mjs';
import { BUILT_IN_CATALOG, modelRequestSettings } from '../src/lib/model-catalog.ts';
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
const SNAPSHOT_PATH = path.join(FIXTURES, 'openrouter-models-2026-10-11.json');
const SNAPSHOT = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
const TOOL_RESULTS = JSON.parse(readFileSync(path.join(FIXTURES, 'tool-results-2026-10-11.json'), 'utf-8'));
const NO_NETWORK = path.join(FIXTURES, 'no-network.mjs');

/** A key that must never appear in anything the harness writes or prints. */
const FAKE_KEY = 'sk-or-fake-MUST-NOT-APPEAR-5520';

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
 * shape), the key endpoint (status FAKE_KEY_STATUS, default 200), and chat
 * completions. A "model" calls the first tool it is offered on its first turn
 * (Socrata's `get_data`, in either spelling, with a dataset; any other tool
 * with no arguments) and, once a tool result has come back, answers with that
 * result echoed whole. A `google/` model is first given what the chooser spike found Google
 * models receive through OpenRouter (#573 premise 6): a result whose text
 * holds a JSON object, reduced to that object. So the tool-result check meets
 * one model that loses the text and one that does not.
 *
 * MCP (the fake hosts `fakeEnv` names, and Boston OpenContext's when a test
 * configures it): the legacy exchange — the modern discovery probe is
 * answered 404 — with `get_data` returning a two-row envelope and Data
 * Commons' `search_indicators` returning text with a JSON object inside it.
 * The server is called by its own tool name, so these are the upstream names.
 *
 * FAKE_LOG receives one JSON line per request: host, path, method, and the
 * model or MCP method; for a model request, also the system message, the
 * question and the tool schemas it carried. Never a header, so never the key.
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

  const firstJsonObject = (text) => {
    for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
      let depth = 0;
      for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) {
          try {
            JSON.parse(text.slice(start, i + 1));
            return text.slice(start, i + 1);
          } catch {
            break;
          }
        }
      }
    }
    return undefined;
  };
  const asGoogleReceivesIt = (content) => {
    try {
      JSON.parse(content);
      return content; // whole JSON arrives whole
    } catch {
      return firstJsonObject(content) ?? content;
    }
  };

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
      const seen = String(body.model).startsWith('google/') ? asGoogleReceivesIt(String(last.content)) : String(last.content);
      last.content = seen; // so the prompt count below reflects what was "received"
      message = { role: 'assistant', content: `I received: ${seen}` };
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

test('#573: the roster passes the slug check against the recorded list, and each kind of problem fails it', () => {
  assert.equal(ALL_MODELS.length, 9, 'four controls and five candidates');
  assert.deepEqual(checkRoster(ALL_MODELS, SNAPSHOT), []);

  const byId = (id) => ALL_MODELS.find((m) => m.id === id);

  // An absent slug — the catalog's own hyphenated Sonnet 4.6, which OpenRouter
  // resolves but does not list.
  const absent = checkRoster([...ALL_MODELS, { id: 'anthropic/claude-sonnet-4-6', role: 'candidate' }], SNAPSHOT);
  assert.equal(absent.length, 1);
  assert.match(absent[0], /anthropic\/claude-sonnet-4-6: not on OpenRouter's model list/);

  // Gemini 3.8 Flash at medium WITHOUT the stated limit name: the request would
  // carry max_completion_tokens, which the list does not give for it.
  const undeclared = checkRoster([{ ...byId('google/gemini-3.8-flash'), requestSettings: { reasoningEffort: 'medium' } }], SNAPSHOT);
  assert.deepEqual(undeclared, [
    'google/gemini-3.8-flash: would be sent "max_completion_tokens", which the list does not give as supported',
  ]);

  // An effort the model does not offer.
  const effort = checkRoster([{ ...byId('google/gemini-3.5-flash-lite'), requestSettings: { reasoningEffort: 'xhigh' } }], SNAPSHOT);
  assert.ok(effort.some((p) => /reasoning "xhigh" is not among the list's efforts/.test(p)), effort.join('\n'));

  // A model the list does not give tools for.
  const noTools = {
    ...SNAPSHOT,
    data: SNAPSHOT.data.map((m) =>
      m.id === 'openai/gpt-4o' ? { ...m, supported_parameters: m.supported_parameters.filter((p) => p !== 'tools') } : m,
    ),
  };
  assert.deepEqual(checkRoster([byId('openai/gpt-4o')], noTools), ['openai/gpt-4o: the list does not give "tools" as supported']);

  // A control whose catalog entry has gone.
  const control = ALL_MODELS.find((m) => m.role === 'control');
  const stale = checkRoster([{ ...control, catalogId: 'anthropic/gone', catalogEntryFound: false }], SNAPSHOT);
  assert.match(stale[0], /the catalog no longer has an entry "anthropic\/gone"/);
});

test('#573: the controls are the catalog, each carrying its entry\'s own request settings', () => {
  const controls = ALL_MODELS.filter((m) => m.role === 'control');
  assert.deepEqual(
    controls.map((m) => m.catalogId),
    BUILT_IN_CATALOG.map((e) => e.id),
    'every catalog entry is a control, in catalog order, and nothing else is',
  );
  for (const control of controls) {
    const entry = BUILT_IN_CATALOG.find((e) => e.id === control.catalogId);
    assert.deepEqual(control.requestSettings, modelRequestSettings(entry), `${control.id} must send what production sends`);
  }
  // Every model at the reasoning setting the October 2026 run sent it: the
  // catalog's three as they were evaluated, the October controls with none,
  // and the two candidates the catalog did not take.
  const sent = Object.fromEntries(ALL_MODELS.map((m) => [m.id, [m.role, m.requestSettings?.reasoningEffort ?? null]]));
  assert.deepEqual(sent, {
    'anthropic/claude-haiku-5.5': ['control', 'low'],
    'anthropic/claude-sonnet-5.5': ['control', 'medium'],
    'anthropic/claude-opus-5.5': ['control', 'medium'],
    'openai/gpt-4o': ['prior-control', null],
    'openai/gpt-5.4': ['prior-control', null],
    'google/gemini-3.5-flash-lite': ['prior-control', null],
    'anthropic/claude-sonnet-4.6': ['prior-control', null],
    'google/gemini-3.8-flash': ['candidate', 'medium'],
    'openai/gpt-6.1-sol': ['candidate', 'medium'],
  });
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

test('#573: --probe is two models on two queries, one of them off the NYC portal, then the tool-result check', () => {
  const plan = planFor('probe');
  assert.deepEqual(plan.models.map((m) => m.id), PROBE.models);
  assert.equal(plan.queries.length, 2);
  assert.ok(plan.queries.some((q) => q.portal === 'data.cityofnewyork.us'));
  assert.ok(plan.queries.some((q) => q.portal !== 'data.cityofnewyork.us'), 'one probe query must test a per-call portal');
  assert.deepEqual(plan.quoteModels.map((m) => m.id), QUOTE_MODELS);
  assert.ok(QUOTE_MODELS.includes('openai/gpt-4o'), 'the tool-result check needs a non-Google control');

  const full = planFor('run', {});
  assert.equal(full.models.length * full.queries.length, 135);
  assert.deepEqual(full.quoteModels, []);
  assert.throws(() => planFor('run', { EVAL_MODELS: 'openai/gpt-4o,nope/model' }), /Unknown model ID\(s\): nope\/model/);

  const bounds = planBounds(full, SNAPSHOT);
  assert.deepEqual(bounds.unpriced, []);
  assert.ok(bounds.floorUsd > 5 && bounds.floorUsd < 12, `March-profile floor ${bounds.floorUsd}`);
  assert.ok(bounds.ceilingUsd > bounds.floorUsd);
});

test('#573: flags and environment are refused by name, the key check before anything else', () => {
  assert.deepEqual(parseArgs([]), { mode: 'run', dryRun: false, capUsd: undefined, outDir: path.dirname(SCRIPT) });
  assert.equal(parseArgs(['--probe', '--cap', '3']).capUsd, 3);
  assert.throws(() => parseArgs(['--cap', '0']), /--cap takes a positive number/);
  assert.throws(() => parseArgs(['--cap']), /--cap takes a positive number/);
  assert.throws(() => parseArgs(['--fast']), /Unknown argument: --fast/);
  assert.throws(() => parseArgs(['--check-slugs', '--dry-run']), /no dry-run form/);

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

test('#573: the dry run makes no network call — and the preload that shows it does stop one', () => {
  for (const args of [['--dry-run'], ['--dry-run', '--probe']]) {
    const result = runHarness(args, { preload: NO_NETWORK });
    assert.equal(result.status, 0, `${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /no network call is made/);
    assert.match(result.stdout, /Roster check against the recorded list: OK\./);
    assert.doesNotMatch(result.stdout + result.stderr, /no-network preload/);
  }
  const dry = runHarness(['--dry-run'], { preload: NO_NETWORK });
  assert.match(dry.stdout, /Rows: 9 models × 15 queries = 135/);

  // The red: the live slug check reads the network, and the same preload stops it.
  const live = runHarness(['--check-slugs'], { preload: NO_NETWORK });
  assert.notEqual(live.status, 0);
  assert.match(live.stdout + live.stderr, /no-network preload: fetch https:\/\/openrouter\.ai\/api\/v1\/models was attempted/);
});

test('#573: a probe against stand-in endpoints writes every row, records what each request carried, and tells a lost tool result from a whole one', () => {
  const dir = scratchDir();
  try {
    const result = runHarness(['--probe', '--cap', '3', '--out-dir', dir], { env: fakeEnv(dir), preload: writeFakeEndpoints(dir) });
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const file = resultsFile(dir);
    assert.match(file.name, /^eval-results-probe-\d{8}T\d{6}Z\.json$/);
    for (const text of [result.stdout, result.stderr, file.text, readFileSync(path.join(dir, 'requests.jsonl'), 'utf-8')]) {
      assert.ok(!text.includes(FAKE_KEY), 'the key must never be printed or written');
    }
    const out = JSON.parse(file.text);

    // The owner leg's acceptance, in the probe's terms.
    assert.equal(out.metadata.rowsExpected, 4);
    assert.equal(out.metadata.rowsWritten, 4);
    assert.equal(out.metadata.complete, true);
    assert.equal(out.metadata.spend.stoppedAtCap, false);
    assert.ok(out.metadata.spend.chargedUsd > 0 && out.metadata.spend.chargedUsd < 3);

    // What each request carried, read from the request itself.
    const sent = (modelId) => out.results.filter((r) => r.modelId === modelId).flatMap((r) => r.requests.map((q) => q.sent));
    for (const s of sent('openai/gpt-6.1-sol')) {
      assert.equal(s.max_completion_tokens, 2000);
      assert.equal(s.reasoning_effort, 'medium');
      assert.equal(s.max_tokens, undefined);
    }
    for (const s of sent('google/gemini-3.8-flash')) {
      assert.equal(s.max_tokens, 2000);
      assert.equal(s.reasoning_effort, 'medium');
      assert.equal(s.max_completion_tokens, undefined);
    }

    // The checks, on a row the stand-in answered off the NYC portal.
    const chicago = out.results.find((r) => r.queryId === 'Q2' && r.modelId === 'openai/gpt-6.1-sol');
    assert.equal(chicago.checks.portal, 'data.cityofchicago.org');
    assert.equal(chicago.checks.portalAnswered, true);
    assert.equal(chicago.checks.expectedDatasetCalled, true);
    assert.equal(chicago.checks.reasoningCounted, true);
    assert.equal(chicago.checks.capSumMatches, true);

    // The tool-result check: three models, four recorded results and the one
    // live capture the stand-in serves (Data Commons); Boston is not configured.
    const captures = Object.fromEntries(out.quoteChecks.captures.map((c) => [c.source, c]));
    assert.equal(captures['data-commons'].status, 'captured');
    assert.equal(captures['data-commons'].shape, 'text-with-json-object');
    assert.equal(captures['boston-opencontext'].status, 'not-captured');
    assert.match(captures['boston-opencontext'].reason, /BOSTON_OPENCONTEXT_MCP_URL/);

    const verdict = (model, fixture) => out.quoteChecks.rows.find((r) => r.modelId === model && r.fixtureId === fixture).verdict;
    assert.equal(out.quoteChecks.rows.length, 15);
    // The known red: lost on a Google model, whole on the control.
    assert.equal(verdict('google/gemini-3.8-flash', 'socrata-guidance-with-object'), 'lost');
    assert.equal(verdict('google/gemini-3.5-flash-lite', 'socrata-guidance-with-object'), 'lost');
    assert.equal(verdict('openai/gpt-4o', 'socrata-guidance-with-object'), 'whole');
    // Pure JSON and brace-free text arrive whole everywhere.
    for (const model of QUOTE_MODELS) {
      for (const fixture of ['socrata-query-envelope', 'socrata-catalog-array', 'socrata-guidance-cut-no-braces']) {
        assert.equal(verdict(model, fixture), 'whole', `${model} ${fixture}`);
      }
    }
    assert.equal(verdict('google/gemini-3.8-flash', 'data-commons-live'), 'lost');
    assert.equal(verdict('openai/gpt-4o', 'data-commons-live'), 'whole');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#573: a slug missing from the live list stops the run before any model call', () => {
  const dir = scratchDir();
  try {
    const list = { ...SNAPSHOT, data: SNAPSHOT.data.filter((m) => m.id !== 'google/gemini-3.8-flash') };
    const listPath = path.join(dir, 'list.json');
    writeFileSync(listPath, JSON.stringify(list));
    const result = runHarness(['--probe', '--cap', '3', '--out-dir', dir], {
      env: fakeEnv(dir, { FAKE_OPENROUTER_LIST: listPath }),
      preload: writeFakeEndpoints(dir),
    });
    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, /google\/gemini-3\.8-flash: not on OpenRouter's model list/);
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
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, completion_tokens_details: { reasoning_tokens: 3 } },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const fetchFor = recordingFetch(row, base);
  await fetchFor('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FAKE_KEY}` },
    body: JSON.stringify({ model: 'm', max_completion_tokens: 2000, reasoning_effort: 'low', messages: [{}], tools: [{}] }),
  });
  assert.equal(sentCount, 1);
  assert.deepEqual(row.requests[0].sent, {
    model: 'm', max_tokens: undefined, max_completion_tokens: 2000, reasoning_effort: 'low', messages: 1, tools: 1,
  });
  assert.deepEqual(row.requests[0].usage, { prompt: 10, completion: 5, total: 15, reasoning: 3, cachedPrompt: undefined });
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
  const models = ALL_MODELS.filter((m) => m.id === 'openai/gpt-4o');
  const queries = TEST_QUERIES.filter((q) => ['Q1', 'Q2'].includes(q.id));
  const q1 = queries[0];
  const call = { name: 'get_data', args: { dataset_id: 'erm2-nwe9', portal: q1.portal }, resultSummary: { rows: 1, columns: 1 } };
  const result = {
    modelId: 'openai/gpt-4o',
    queryId: 'Q1',
    portal: q1.portal,
    toolCallCount: 1,
    totalTokens: 1000,
    durationMs: 4000,
    costUsd: 0.01,
    checks: rowChecks(q1, { response: 'erm2-nwe9', toolsCalled: [call], totalTokens: 1000 }, []),
  };
  const error = { modelId: 'openai/gpt-4o', queryId: 'Q2', isTimeout: true, costUsd: 0.02 };
  const out = buildOutput({ meta: { mode: 'run' }, models, queries, results: [result], errors: [error] });
  assert.equal(out.metadata.rowsExpected, 2);
  assert.equal(out.metadata.rowsWritten, 2);
  assert.equal(out.metadata.complete, true, 'a timed-out row is a written row');
  assert.equal(out.metadata.totalTimeouts, 1);
  assert.deepEqual(out.metadata.models[0].requestParameters, { max_tokens: 2000 });
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

// --- #609: the harness offers what the app offers ---
//
// Each row's request is read from what the harness actually sent (the
// stand-in's log of every model request), and the expectation is computed by
// the app's own functions — `offeredMcpTools(mcpToolsFor(lockedPortal),
// configured, selection)` and `composeSystemPrompt({ portal, configured,
// selection })`, the two calls `src/app/api/compare-stream/route.ts` makes
// under all-sources — in a second process given the same environment, the
// same stand-in transport and the run's own clock. The harness is never
// portal-locked (its questions span five portals) and passes no selection, so
// the expectation is computed at no lock and no selection too.
//
// Two configurations, because a hand copy can equal one of them: none of the
// optional sources configured, and every one. Each optional source is read
// from the router's manifest, so a source added there is configured here
// without an edit; the test checks that each configuration offers exactly the
// sources it claims, so a configuration that silently configured nothing
// would fail rather than pass.

const MCP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/mcp');

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

const CONFIGURATIONS = {
  'no optional source': {},
  'every optional source': everyOptionalSource(),
};

const REQUIRED_ALIASES = CIVIC_MANIFEST.filter((e) => e.configuration.requirement !== 'optional').map((e) => e.alias);
const ALL_ALIASES = CIVIC_MANIFEST.map((e) => e.alias);

/** What the app's functions give for this process's environment, written to REF_OUT. */
const REFERENCE_SOURCE = `
import { writeFileSync } from 'node:fs';
import { mcpToolsFor, offeredMcpTools } from ${JSON.stringify(pathToFileURL(path.join(MCP_DIR, 'tools.ts')).href)};
import { composeSystemPrompt } from ${JSON.stringify(pathToFileURL(path.join(MCP_DIR, 'socrata-skill.ts')).href)};
import { readMcpEnvFromProcess } from ${JSON.stringify(pathToFileURL(path.join(MCP_DIR, 'registry.ts')).href)};
const configured = readMcpEnvFromProcess();
const lockedPortal = undefined;
const selection = undefined;
const now = new Date(process.env.REF_NOW);
const prompts = {};
for (const portal of JSON.parse(process.env.REF_PORTALS)) {
  prompts[portal] = (await composeSystemPrompt({ portal, configured, selection, now })).prompt;
}
writeFileSync(process.env.REF_OUT, JSON.stringify({ tools: offeredMcpTools(mcpToolsFor(lockedPortal), configured, selection), prompts }));
`;

const DRIVE_QUERIES = ['Q1', 'Q2']; // NYC and Chicago: two portals, so a prompt that ignores the row's portal fails
const drives = new Map();

/**
 * One run of the harness (one model, two queries) against the stand-in at a
 * configuration, and the app's tools and prompts for the same environment and
 * clock. Memoized: the tool and prompt tests read the same two runs.
 */
function driveAt(configuration) {
  if (drives.has(configuration)) return drives.get(configuration);
  const dir = scratchDir();
  try {
    const preload = writeFakeEndpoints(dir);
    const indices = DRIVE_QUERIES.map((id) => TEST_QUERIES.findIndex((q) => q.id === id) + 1).join(',');
    const env = fakeEnv(dir, { EVAL_MODELS: 'openai/gpt-4o', EVAL_QUERIES: indices, ...CONFIGURATIONS[configuration] });
    const run = runHarness(['--cap', '3', '--out-dir', dir], { env, preload });
    assert.equal(run.status, 0, `${configuration}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    const out = JSON.parse(resultsFile(dir).text);
    const requests = chatRequests(fakeLog(path.join(dir, 'requests.jsonl')));

    const refOut = path.join(dir, 'reference.json');
    const portals = [...new Set(TEST_QUERIES.filter((q) => DRIVE_QUERIES.includes(q.id)).map((q) => q.portal))];
    const ref = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, '--input-type=module', '-e', REFERENCE_SOURCE], {
      encoding: 'utf-8',
      timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...env,
        FAKE_LOG: path.join(dir, 'reference.jsonl'),
        REF_OUT: refOut,
        REF_NOW: out.metadata.startedAt,
        REF_PORTALS: JSON.stringify(portals),
      },
    });
    assert.equal(ref.status, 0, `reference at ${configuration}\nstdout:\n${ref.stdout}\nstderr:\n${ref.stderr}`);
    const reference = JSON.parse(readFileSync(refOut, 'utf-8'));
    const drive = { configuration, out, requests, reference };
    drives.set(configuration, drive);
    return drive;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const toolNames = (tools) => (tools ?? []).map((t) => t.function?.name);
const aliasesOf = (names) => [...new Set(names.map((n) => CIVIC_MANIFEST.find((e) => n.startsWith(`${e.alias}__`))?.alias))];

test('#609: every model request offers the tools the app offers, with no optional source configured and with every one', () => {
  const drives = Object.keys(CONFIGURATIONS).map(driveAt);

  // The instrument: each configuration offers exactly the sources it claims,
  // and the two lists differ, so no one fixed list can equal both.
  const [none, every] = drives.map((d) => toolNames(d.reference.tools));
  assert.deepEqual(aliasesOf(none), REQUIRED_ALIASES);
  assert.deepEqual(aliasesOf(every), ALL_ALIASES);
  assert.notDeepEqual(none, every);

  for (const drive of drives) {
    // Two rows, each a tool call and an answer: four model requests.
    assert.equal(drive.requests.length, 4, `${drive.configuration}: ${drive.requests.length} model requests`);
    for (const request of drive.requests) {
      assert.deepEqual(
        toolNames(request.tools),
        toolNames(drive.reference.tools),
        `${drive.configuration}: the harness offered ${JSON.stringify(toolNames(request.tools))}`,
      );
      // By schema too; compared whole, so a failure names the configuration
      // rather than printing every schema.
      assert.ok(
        isDeepStrictEqual(request.tools, drive.reference.tools),
        `${drive.configuration}: the names are the app's and the schemas are not`,
      );
    }
  }
});

test('#609: every model request carries the app\'s composed prompt for its row\'s portal, configuration and clock', () => {
  for (const drive of Object.keys(CONFIGURATIONS).map(driveAt)) {
    const { prompts } = drive.reference;
    // The instrument: the two portals compose two prompts, and each states the run's date.
    assert.equal(Object.keys(prompts).length, 2);
    assert.notEqual(...Object.values(prompts));
    for (const prompt of Object.values(prompts)) assert.ok(prompt.includes(drive.out.metadata.startedAt.slice(0, 10)));

    for (const request of drive.requests) {
      const query = TEST_QUERIES.find((q) => q.query === request.user);
      assert.ok(query, `a model request carried a question the run did not ask: ${request.user}`);
      assert.ok(
        request.system === prompts[query.portal],
        `${drive.configuration} ${query.id}: the harness's system prompt is not the app's composition ` +
          `(it begins ${JSON.stringify(String(request.system).slice(0, 120))})`,
      );
    }
  }
});

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

/** The ruled object (#740 D3 = A), stated here, not read from the harness. */
const RULED_PROVIDER = { max_price: { prompt: 0.15, completion: 0.6 }, require_parameters: true, data_collection: 'deny' };

/** Why a recorded `provider` is not the ruling's, or null when it is. */
function providerProblem(provider, openWeight) {
  if (!openWeight) return provider === undefined ? null : `a Claude request carried provider ${JSON.stringify(provider)}`;
  if (provider === undefined) return 'an open-weight request carried no provider';
  for (const pin of ['order', 'only', 'ignore']) if (Object.hasOwn(provider, pin)) return `the provider is pinned (${pin})`;
  return isDeepStrictEqual(provider, RULED_PROVIDER) ? null : `the provider is ${JSON.stringify(provider)}, not the ruled object`;
}

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
  const { data_collection: _dropped, ...withoutDeny } = RULED_PROVIDER;
  assert.match(providerProblem({ ...RULED_PROVIDER, order: ['Fake'] }, true), /pinned \(order\)/);
  assert.match(providerProblem({ ...RULED_PROVIDER, only: ['Fake'] }, true), /pinned \(only\)/);
  assert.match(providerProblem(withoutDeny, true), /not the ruled object/);
  assert.match(providerProblem(undefined, true), /carried no provider/);
  assert.match(providerProblem(RULED_PROVIDER, false), /a Claude request carried provider/);
});
