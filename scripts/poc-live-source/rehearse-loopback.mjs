#!/usr/bin/env node
/**
 * POC MCP-LIVE-SOURCE — loopback rehearsal. Creates NO sandbox and costs nothing.
 *
 * Everything the measurement run does that does NOT need a VM, driven against a
 * bridge on localhost fronting the same pinned package:
 *
 *   1. The bridge starts against `@betanyc/nyc-record-mcp` and completes the
 *      MCP lifecycle the app's hand-written client speaks.
 *   2. `tools/list` returns EXACTLY the seven names the registry routes. A name
 *      the registry does not carry is a tool the model can be shown and the app
 *      cannot call — the defect `prompt-advertised-tools.test.ts` guards for the
 *      sources that already exist, checked here for the one being added.
 *   3. The advertised SCHEMAS match what `src/lib/mcp/tools.ts` claims. Those
 *      schemas were transcribed by hand; this is the check that they were
 *      transcribed correctly rather than plausibly.
 *   4. The refusal path (L5's mechanism) end to end, WITHOUT a network block:
 *      an argument the upstream's strict zod schema rejects produces the same
 *      `isError: true` result a blocked upstream produces, so the three layers
 *      — wire, client, formatters — can be read apart before a VM exists.
 *
 * Run: node scripts/poc-live-source/rehearse-loopback.mjs
 * Needs: the package installed under temp/rehearsal/ (the script does it).
 */
import { spawn, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const REPO = process.cwd();
const REHEARSAL = path.join(REPO, 'temp', 'rehearsal-live-source');
const PORT = Number(process.env.REHEARSAL_PORT || 3100);
const TOKEN = randomUUID();
const PKG = '@betanyc/nyc-record-mcp@1.1.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.log(...a);

// ------------------------------------------------------------------ setup ---
fs.mkdirSync(REHEARSAL, { recursive: true });
const bin = path.join(REHEARSAL, 'node_modules', '.bin', 'nyc-record-mcp');
if (!fs.existsSync(bin)) {
  say(`installing ${PKG} into ${REHEARSAL} …`);
  fs.writeFileSync(path.join(REHEARSAL, 'package.json'), JSON.stringify({ name: 'rehearsal', private: true }, null, 2));
  execSync(`npm install --no-audit --no-fund --silent ${PKG}`, { cwd: REHEARSAL, stdio: 'inherit' });
}
say(`server binary: ${bin}`);

const bridge = spawn(process.execPath, [path.join(REPO, 'scripts', 'poc-warm-vm', 'bridge.mjs')], {
  env: {
    ...process.env,
    BRIDGE_PORT: String(PORT),
    BRIDGE_TOKEN: TOKEN,
    BRIDGE_TOOL_PREFIX: 'nyc_record__',
    BRIDGE_SERVER_CMD: bin,
    BRIDGE_SERVER_ARGS: '[]',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
process.on('exit', () => { try { bridge.kill('SIGKILL'); } catch { /* already gone */ } });

const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 100; i++) {
  try {
    const r = await fetch(`${BASE}/readyz`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (r.status === 200) break;
  } catch { /* not up yet */ }
  await sleep(100);
}
say(`bridge ready on ${BASE}`);

let failures = 0;
const check = (name, ok, detail) => {
  say(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function rpc(sessionId, message) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${TOKEN}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(message),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data:')) || text;
  let payload = null;
  try { payload = JSON.parse(line.replace(/^data:/, '').trim()); } catch { /* raw */ }
  return { status: res.status, sessionId: res.headers.get('mcp-session-id'), payload, text };
}

// ------------------------------------------------------------ 1. lifecycle ---
say('\n1. MCP lifecycle through the bridge');
const init = await rpc(null, {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'rehearsal', version: '1' } },
});
check('initialize returns 200', init.status === 200, `HTTP ${init.status}`);
check('a session id is issued', Boolean(init.sessionId), init.sessionId || 'none');
say(`     negotiated protocolVersion: ${init.payload?.result?.protocolVersion}`);
say(`     serverInfo: ${JSON.stringify(init.payload?.result?.serverInfo)}`);

// ------------------------------------------------ 2. advertised tool names ---
say('\n2. tools/list against the registry');
const listed = await rpc(init.sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
const advertised = (listed.payload?.result?.tools ?? []).map((t) => t.name).sort();
const { buildMcpRegistry } = await import('../../src/lib/mcp/registry.ts');
const registry = buildMcpRegistry({
  socrataUrl: 'https://socrata.example/mcp',
  dataCommonsUrl: 'https://dc.example/mcp',
  bostonOpencontextUrl: 'https://boston.example/mcp',
  nycRecordUrl: BASE,
});
const routed = (registry.servers['nyc-record']?.tools ?? []).slice().sort();
say(`     advertised by the server: ${advertised.join(', ')}`);
check('the registry routes exactly what the server advertises',
  JSON.stringify(advertised) === JSON.stringify(routed),
  JSON.stringify(advertised) === JSON.stringify(routed) ? `${advertised.length} tools` : `registry: ${routed.join(', ')}`);

// ------------------------------------------------------ 3. schema fidelity ---
say('\n3. the hand-transcribed schemas against the live ones');
const { mcpTools } = await import('../../src/lib/mcp/tools.ts');
const ours = new Map(mcpTools.filter((t) => t.function.name.startsWith('nyc_record__')).map((t) => [t.function.name, t.function.parameters]));
for (const t of listed.payload?.result?.tools ?? []) {
  const mine = ours.get(t.name);
  if (!mine) { check(`${t.name} has a schema in tools.ts`, false, 'missing'); continue; }
  const liveProps = Object.keys(t.inputSchema?.properties ?? {}).sort();
  const myProps = Object.keys(mine.properties ?? {}).sort();
  const liveReq = (t.inputSchema?.required ?? []).slice().sort();
  const myReq = (mine.required ?? []).slice().sort();
  check(`${t.name} properties match`, JSON.stringify(liveProps) === JSON.stringify(myProps), `live ${liveProps} / ours ${myProps}`);
  check(`${t.name} required match`, JSON.stringify(liveReq) === JSON.stringify(myReq), `live ${liveReq} / ours ${myReq}`);
}
check('tools.ts advertises no nyc_record tool the server does not have',
  [...ours.keys()].every((n) => advertised.includes(n)),
  [...ours.keys()].filter((n) => !advertised.includes(n)).join(', ') || 'none extra');

// ------------------------------------- 4. a live call through the app client ---
say("\n4. the app's own client against this bridge");
process.env.NYC_RECORD_MCP_URL = BASE;
process.env.NYC_RECORD_MCP_TOKEN = TOKEN;
const client = await import('../../src/lib/mcp/client.ts?rehearsal=1');
const route = client.routeTool('nyc_record__get_procurement_notices');
check('routeTool resolves to nyc-record', route.sourceId === 'nyc-record', `${route.sourceId} → ${route.endpointUrl}`);
check('an auth header is attached', Boolean(route.headers?.Authorization), route.headers?.Authorization ? 'yes (Bearer <redacted>)' : 'NO');
try {
  const t0 = Date.now();
  const outText = await client.callMcpTool('nyc_record__get_procurement_notices', { limit: 1 });
  check('a live tool call returns rows', outText.length > 0, `${outText.length} chars in ${Date.now() - t0} ms`);
  say(`     first 200 chars: ${outText.slice(0, 200).replace(/\s+/g, ' ')}`);
} catch (e) {
  check('a live tool call returns rows', false, `${e?.name}: ${e?.message}`);
}

// ----------------------------------------------- 5. the refusal path, L5's ---
say('\n5. the refusal path — the same isError shape a blocked upstream produces');
const badWire = await rpc(init.sessionId, {
  jsonrpc: '2.0', id: 3, method: 'tools/call',
  params: { name: 'nyc_record__get_notices_by_agency', arguments: { agency_name: 'DCAS', council_district: 3 } },
});
const badResult = badWire.payload?.result;
say(`     ON THE WIRE:  HTTP ${badWire.status} · isError=${badResult?.isError} · ${JSON.stringify(String(badResult?.content?.[0]?.text).slice(0, 160))}`);
check('an invented argument is refused with isError: true', badResult?.isError === true, `isError=${badResult?.isError}`);

const { describeToolFailureForLlm, friendlyStreamError, classifyStreamError } = await import('../../src/lib/streaming.ts');
const { isSourceRefusal } = await import('../../src/lib/mcp/tool-call-failure.ts');
try {
  await client.callMcpTool('nyc_record__get_notices_by_agency', { agency_name: 'DCAS', council_district: 3 });
  check('the client throws on a refusal', false, 'it returned instead');
} catch (e) {
  check('the client throws on a refusal', true, `${e.name}: ${JSON.stringify(e.message)}`);
  check('it is recorded as a source refusal', isSourceRefusal(e), String(isSourceRefusal(e)));
  say(`     CLASSIFIED AS:   ${classifyStreamError(e)}`);
  say(`     TO THE MODEL:    ${JSON.stringify(describeToolFailureForLlm('nyc_record__get_notices_by_agency', e))}`);
  say(`     TO THE READER:   ${JSON.stringify(friendlyStreamError(e))}`);
  check('the upstream’s own words do not reach the model',
    !describeToolFailureForLlm('nyc_record__get_notices_by_agency', e).includes('council_district'),
    'no argument name in the model-facing string');
}

say(`\n${failures === 0 ? 'REHEARSAL PASS' : `REHEARSAL FAIL — ${failures} check(s) failed`}`);
bridge.kill('SIGKILL');
process.exit(failures === 0 ? 0 : 1);
