#!/usr/bin/env node
/**
 * POC MCP-WARM-VM — drive the APP'S OWN MCP client against a bridge address.
 *
 * Imports `src/lib/mcp/client.ts` itself: the hand-written client fixed to
 * protocol 2024-11-05 that reads the first SSE `data:` line, the same code
 * path `/ask` uses. Nothing here reimplements MCP — that is the whole point
 * of the compatibility measurement (M2).
 *
 * Usage: node --experimental-strip-types scripts/poc-warm-vm/drive-client.mjs
 *   env: NYC_CHARTER_MCP_URL, NYC_CHARTER_MCP_TOKEN
 *   opt: POC_RESULTS_FILE — append a JSON line per observation (git-ignored)
 */
import fs from 'node:fs';

const URL_ = process.env.NYC_CHARTER_MCP_URL;
const TOKEN = process.env.NYC_CHARTER_MCP_TOKEN;
const RESULTS = process.env.POC_RESULTS_FILE || '';
if (!URL_ || !TOKEN) {
  console.error('[drive] NYC_CHARTER_MCP_URL and NYC_CHARTER_MCP_TOKEN must be set');
  process.exit(2);
}

const observations = [];
function record(o) {
  observations.push({ at: new Date().toISOString(), ...o });
  if (RESULTS) fs.appendFileSync(RESULTS, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
}

// --- M2 preamble: what does initialize actually negotiate, and is a session
// issued? Read from the wire directly ONCE, because the app's client keeps
// that detail internal (it stores sessionId in module state).
const initRes = await fetch(`${URL_.replace(/\/$/, '').endsWith('/mcp') ? URL_ : URL_ + '/mcp'}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${TOKEN}`,
  },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'civic-ai-tools-website', version: '1.0.0' } },
  }),
});
const initText = await initRes.text();
const initSession = initRes.headers.get('mcp-session-id');
const initPayload = JSON.parse((initText.split('\n').find((l) => l.startsWith('data:')) || initText).replace(/^data:/, '').trim());
console.log(`[M2] initialize -> HTTP ${initRes.status}`);
console.log(`[M2]   content-type: ${initRes.headers.get('content-type')}`);
console.log(`[M2]   negotiated protocolVersion: ${initPayload?.result?.protocolVersion}`);
console.log(`[M2]   serverInfo: ${JSON.stringify(initPayload?.result?.serverInfo)}`);
console.log(`[M2]   mcp-session-id issued: ${initSession ? 'yes (' + initSession + ')' : 'no'}`);
record({ measurement: 'M2', step: 'initialize', httpStatus: initRes.status,
  contentType: initRes.headers.get('content-type'),
  protocolVersion: initPayload?.result?.protocolVersion,
  serverInfo: initPayload?.result?.serverInfo, sessionIdIssued: Boolean(initSession) });

// --- M3a: the same POST with NO Authorization header must be refused.
const noAuth = await fetch(`${URL_.replace(/\/$/, '').endsWith('/mcp') ? URL_ : URL_ + '/mcp'}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
});
const noAuthBody = (await noAuth.text()).slice(0, 300);
console.log(`[M3] unauthenticated tools/list -> HTTP ${noAuth.status} ${noAuth.statusText}`);
console.log(`[M3]   body: ${noAuthBody}`);
console.log(`[M3]   www-authenticate: ${noAuth.headers.get('www-authenticate')}`);
record({ measurement: 'M3', step: 'no-token', httpStatus: noAuth.status, body: noAuthBody,
  wwwAuthenticate: noAuth.headers.get('www-authenticate') });

// --- M3a2: a WRONG token must also be refused (absence and mismatch differ).
const badAuth = await fetch(`${URL_.replace(/\/$/, '').endsWith('/mcp') ? URL_ : URL_ + '/mcp'}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer not-the-token' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
});
console.log(`[M3] wrong-token tools/list -> HTTP ${badAuth.status} ${badAuth.statusText}`);
record({ measurement: 'M3', step: 'wrong-token', httpStatus: badAuth.status, body: (await badAuth.text()).slice(0, 300) });

// --- M2 proper: the APP'S OWN CLIENT, imported and called.
const { callMcpTool, routeTool } = await import('../../src/lib/mcp/client.ts');

const routed = routeTool('nyc_charter__get_section');
console.log(`[M2] app registry routes nyc_charter__get_section -> sourceId=${routed.sourceId} url=${routed.endpointUrl}`);
console.log(`[M2]   auth header attached: ${routed.headers && routed.headers.Authorization ? 'yes (Authorization: Bearer <redacted>)' : 'NO'}`);
record({ measurement: 'M2', step: 'route', sourceId: routed.sourceId, endpointUrl: routed.endpointUrl,
  authHeaderAttached: Boolean(routed.headers && routed.headers.Authorization) });

async function timedCall(name, args) {
  const t0 = process.hrtime.bigint();
  const out = await callMcpTool(name, args);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  record({ measurement: 'M1', step: 'tool-call', tool: name, args, elapsedMs: Number(ms.toFixed(1)), resultChars: out.length });
  return { out, ms };
}

console.log('\n=== app client -> nyc_charter__get_version ===');
const v = await timedCall('nyc_charter__get_version', {});
console.log(`(${v.ms.toFixed(1)} ms, ${v.out.length} chars)`);
console.log(v.out.slice(0, 600));

console.log('\n=== app client -> nyc_charter__get_section { citation: "§ 1043" } ===');
const s = await timedCall('nyc_charter__get_section', { citation: '§ 1043', corpus: 'charter' });
console.log(`(${s.ms.toFixed(1)} ms, ${s.out.length} chars)  <-- ACCEPTANCE (1)`);
console.log(s.out.slice(0, 900));

console.log('\n=== app client -> nyc_charter__search { query: "community board" } ===');
const q = await timedCall('nyc_charter__search', { query: 'community board', corpus: 'charter', limit: 3 });
console.log(`(${q.ms.toFixed(1)} ms, ${q.out.length} chars)`);
console.log(q.out.slice(0, 500));

// Warm-call series: five back-to-back get_version calls on the live session.
console.log('\n=== M1 warm-call series (5x nyc_charter__get_version on the live session) ===');
const warm = [];
for (let i = 0; i < 5; i++) { const r = await timedCall('nyc_charter__get_version', {}); warm.push(r.ms); }
console.log('warm call ms: ' + warm.map((m) => m.toFixed(1)).join(', '));
record({ measurement: 'M1', step: 'warm-series', callsMs: warm.map((m) => Number(m.toFixed(1))) });

console.log('\n[drive] OK — ' + observations.length + ' observation(s)' + (RESULTS ? ` appended to ${RESULTS}` : ''));
