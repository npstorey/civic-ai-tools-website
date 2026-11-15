// S2-B phase 2 (npstorey/civic-ai-tools#309), criterion 6, for a base of the newer protocol era (`server/discover`, no handshake and no session): a server's report is read no more than
// five minutes before the check or the keys read it.
//
// THE RULE. The base check and the reported keys read what a server stated of itself. Read more than the check's
// five minutes ago (`BASE_READ_KEPT_MS`), it is read again before the next request; within five minutes nothing is
// added. A run states a server's keys only from a read within the bound.
//
// WHAT IS DRIVEN. The real loop core (its own base check), the real MCP client and `withReportedKeys`, against
// a loopback base of the newer era, whose report is its `DiscoverResult`'s `_meta` serverInfo. The clock is mocked (`Date` only), so five minutes pass in a step.
//
// SHAPED TO FAIL. The base's release moves only `serverInfo.version`, with the same schemas, so only a fresh read of
// its report can see it.
//
// Run with: npm test

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { ToolCallRecord } from '../model-loop/run-tool-loop.ts';

const GR = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socrata-tools-at-gr.json'), 'utf8')) as {
  serverInfo: { name: string; version: string };
  tools: Array<Record<string, unknown>>;
};
const MODERN = '2026-07-28';

interface Seen { method: string }
const base = { serverInfo: { ...GR.serverInfo }, seen: [] as Seen[] };

const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (req.method === 'DELETE') { base.seen.push({ method: 'DELETE' }); res.writeHead(405); res.end(); return; }
  const body = JSON.parse(raw) as { id?: unknown; method?: string };
  base.seen.push({ method: String(body.method) });
  const answer = (status: number, payload: Record<string, unknown>) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, ...payload }));
  };
  if (body.id === undefined) { res.writeHead(202); res.end(); return; }
  if (body.method === 'server/discover') {
    answer(200, { result: { resultType: 'complete', supportedVersions: [MODERN], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { ...base.serverInfo } } } });
    return;
  }
  if (body.method === 'tools/list') { answer(200, { result: { resultType: 'complete', tools: GR.tools } }); return; }
  answer(200, { result: { resultType: 'complete', content: [{ type: 'text', text: JSON.stringify({ data: [{ notice: 'fixture row' }], total_rows: 1 }) }] } });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
server.unref();

for (const k of ['SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING']) delete process.env[k];
process.env.SOCRATA_MCP_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
process.env.DATA_COMMONS_MCP_URL = 'http://127.0.0.1:9/mcp';
process.env.OPENROUTER_API_KEY = 'not-a-credential-s2b-p2';

const { CIVIC_MANIFEST } = await import('@typedstandards/civic-typed-router');
const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { runToolLoop } = await import('../model-loop/run-tool-loop.ts');
const { _resetDefaultModelClientForTests, getModelClient } = await import('../model-client.ts');
const { callMcpTool, startRunServerReads, withReportedKeys } = await import('./client.ts');
const { dispatchTargetOf, readMcpEnvFromProcess } = await import('./registry.ts');

const configured = readMcpEnvFromProcess();
const SOCRATA_ID = CIVIC_MANIFEST.find((entry) => entry.sourceId === 'socrata')!.id;
const T0 = Date.parse('2026-11-15T12:00:00Z');
const MINUTE = 60_000;

interface Outcome { call: ToolCallRecord; keys: { id: string; reportedName?: string; reportedVersion?: string }; seen: Seen[] }

/** One run in its own async context, as a request has: the model calls the pack's tool once. */
function packRun(): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    setImmediate(async () => {
      try {
        const reads = startRunServerReads();
        const from = base.seen.length;
        const model = await startScriptedModelServer([
          { toolCalls: [{ id: 'p1', name: 'nyc_record__get_data', args: { type: 'query', query: 'SELECT * LIMIT 1' } }] },
          { content: 'An answer.' },
        ]);
        process.env.MODEL_API_BASE_URL = model.url;
        _resetDefaultModelClientForTests();
        try {
          const result = await runToolLoop({
            client: getModelClient(),
            endpointModel: 'fake/model',
            requestSettings: undefined,
            prompt: 'What did the City Record publish?',
            tools: [],
            executeToolCall: (name, args) => callMcpTool(name, args),
            dispatchTarget: (name) => dispatchTargetOf(name, configured),
          });
          resolve({ call: result.toolCalls[0], keys: withReportedKeys([{ id: SOCRATA_ID }], reads, configured)[0], seen: base.seen.slice(from) });
        } finally {
          await new Promise((r) => model.server.close(r));
        }
      } catch (error) {
        reject(error);
      }
    });
  });
}

const methods = (seen: Seen[]) => seen.map((s) => s.method);
const count = (seen: Seen[], method: string) => seen.filter((s) => s.method === method).length;

mock.timers.enable({ apis: ['Date'], now: T0 });
const FIRST = await packRun();
mock.timers.setTime(T0 + 4 * MINUTE);
const WITHIN = await packRun();
base.serverInfo = { ...GR.serverInfo, version: '0.9.3' };
mock.timers.setTime(T0 + 5 * MINUTE + 1);
const PAST = await packRun();
mock.timers.reset();

test('premise, the newer era: the first run read the base and sent its pack call', () => {
  assert.equal(count(FIRST.seen, 'server/discover'), 1);
  assert.notEqual(FIRST.call.failed, true);
  assert.equal(FIRST.keys.reportedVersion, GR.serverInfo.version);
});

test('6, the newer era: within five minutes of the read, a run reads no new report and its pack call is sent', () => {
  assert.equal(count(WITHIN.seen, 'server/discover'), 0);
  assert.notEqual(WITHIN.call.failed, true);
});

test('6, the newer era: more than five minutes after the read, a run reads the report again before the check reads the base', () => {
  assert.deepEqual(methods(PAST.seen), ['server/discover', 'tools/list'], `the base received ${JSON.stringify(methods(PAST.seen))}`);
});

test('6, the newer era: the check refuses a base whose new report states a version no pin names, and nothing is sent', () => {
  assert.deepEqual({ failed: PAST.call.failed, failureKind: PAST.call.failureKind }, { failed: true, failureKind: 'base_changed' });
});

test('6, the newer era: the run states the version its new read found', () => {
  assert.equal(PAST.keys.reportedVersion, '0.9.3');
});

test('6, the newer era: a server with no session is sent no DELETE', () => {
  assert.equal(count(base.seen, 'DELETE'), 0);
});
