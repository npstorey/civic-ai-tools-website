#!/usr/bin/env node
/**
 * POC MCP-WARM-VM — the whole measurement suite in ONE run.
 *
 * ONE command, deliberately: an owner-run leg that needs three rounds costs
 * more owner time than the measurement is worth, so step 0 is a cheap auth
 * check that fails in seconds when the sandbox API cannot authenticate, and
 * everything after it runs unattended.
 *
 * SECRET HYGIENE. The bridge bearer token is generated here with
 * `randomUUID()`, passed to the sandbox as an env var and held in memory for
 * the duration. It is never printed, logged, or written to the results file.
 * No environment file is opened; the Vercel auth triple is read by NAME only
 * and handed straight to the SDK.
 *
 * Writes: temp/mcp-warm-vm-poc/observations-<runId>.jsonl  (git-ignored)
 *         temp/mcp-warm-vm-poc/summary-<runId>.json
 */
import { randomUUID } from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';
import {
  openResults, record, writeSummary, section, readout, elapsed, log,
  importAppClientBoundTo, silenceAppClientLogs, keyLine,
} from './lib.mjs';
import {
  createFresh, createFromSnapshot, installCharter, writeBridge, startBridge,
  waitForReady, resolveAuth, mcpEndpoint,
  CREATE_FRESH_COMMAND, CREATE_FROM_SNAPSHOT_COMMAND, INSTALL_COMMAND,
  START_BRIDGE_COMMAND, READY_COMMAND, BRIDGE_PORT, SANDBOX_VCPUS,
  SANDBOX_MEMORY_MB, CHARTER_PACKAGE,
  listAllSandboxes, classifyAlive, stopClaimed, describeNotOurs,
} from './sandbox-ops.mjs';

// Vercel's published rates, read 2026-09-15 (mcp-source-hosting-plan.md §1).
const RATE_ACTIVE_CPU_HR = 0.128;
const RATE_GB_HR = 0.0212;
const RATE_PER_CREATION = 0.60 / 1_000_000;

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const REPEATS = Number(process.env.POC_REPEATS || 2);
const WARM_CALLS = Number(process.env.POC_WARM_CALLS || 5);
/**
 * 500, not 50. Active CPU is only reported once a VM stops, so per-call CPU is
 * a DIFFERENCE between two boots — and boot CPU itself varies by a few hundred
 * ms. At 50 calls that variance swamped the signal: two readings of the same
 * quantity came back 1.28 ms and 24.88 ms per call. 500 calls put roughly a
 * second of call CPU against the same boot noise.
 */
const CPU_CALLS = Number(process.env.POC_CPU_CALLS || 500);

let bindCounter = 0;
const live = [];                       // sandboxes to tear down on exit
/**
 * Every sandbox id this run created, recorded the moment `Sandbox.create`
 * resolves and NEVER removed — `live` shrinks as VMs are stopped, this does
 * not. It is the first of the two rules the end-of-run stray check uses to
 * decide what it may stop (see classifyAlive in sandbox-ops.mjs).
 */
const recordedIds = new Set();
/** Run start on the sandbox API's own clock (step 0's HTTP Date header). */
let runStartMs = null;
let jsonl = null;
let interrupted = false;
/** The single in-flight cleanup, shared by the finally block and SIGINT. */
let finalizing = null;
/** Updated as the suite advances, so a failure can say WHERE it stopped. */
let phase = 'startup';
/**
 * Fault injection, for demonstrating the failure path rather than asserting it.
 * `POC_FAULT_PHASE=<phase name>` throws on entering that phase, with VMs alive,
 * so the teardown + live stray check can be watched doing their job. A criterion
 * demonstrated only on a run that cannot fail is not demonstrated.
 */
const FAULT_PHASE = process.env.POC_FAULT_PHASE || '';
function enterPhase(name) {
  if (interrupted) throw new Error(`interrupted by SIGINT before phase "${name}"`);
  phase = name;
  if (FAULT_PHASE && name === FAULT_PHASE) {
    throw new Error(`injected fault at phase "${name}" (POC_FAULT_PHASE)`);
  }
}
/** Hoisted out of the try block so the finally can delete it. */
let snapshotRef = null;
let failure = null;
silenceAppClientLogs();
const summary = {
  runId: RUN_ID, package: CHARTER_PACKAGE, vcpus: SANDBOX_VCPUS,
  memoryMb: SANDBOX_MEMORY_MB, m1: {}, m2: {}, m3: {}, m4: {}, questions: [],
};

async function teardown() {
  for (const s of [...live]) {
    // BLOCKING, deliberately: a bare stop() returns when the stop is
    // ACKNOWLEDGED, not when the VM has stopped. The final stray check reads
    // live state, so a non-blocking teardown races it and reports a sandbox
    // still in `stopping` as a stray. Measured: the first full rehearsal ended
    // "STRAYS: 1" on a run that had leaked nothing.
    try { await s.stop({ blocking: true }); live.splice(live.indexOf(s), 1); } catch { /* reported by the caller */ }
  }
}
// SIGINT runs the SAME finalize as the finally block — stop this run's VMs,
// delete its snapshot, write the summary, run the ownership-aware stray check
// — then exits 130. A second Ctrl-C exits at once without cleanup and prints
// the command that finds anything left behind.
let sigints = 0;
process.on('SIGINT', async () => {
  sigints += 1;
  if (sigints > 1) {
    const since = runStartMs ? new Date(runStartMs).toISOString() : '<run start>';
    console.log(`\n  SIGINT again — exiting WITHOUT cleanup. Find anything left behind with:`);
    console.log(`    node scripts/poc-warm-vm/stop-strays.mjs --since ${since} --snapshots`);
    process.exit(130);
  }
  interrupted = true;
  if (!failure) failure = new Error(`interrupted by SIGINT during phase "${phase}"`);
  console.log('\n  SIGINT — stopping this run\u2019s VMs, deleting its snapshot, checking for strays. Ctrl-C again exits without cleanup.');
  await finalize();
  process.exit(130);
});

// ---------------------------------------------------------------- step 0 ---
section('STEP 0 — auth (fails in seconds if the sandbox API cannot authenticate)');
for (const n of ['VERCEL_OIDC_TOKEN', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID']) {
  log(`  ${n}: ${process.env[n]?.trim() ? 'present' : 'absent'}   (name only — never the value)`);
}
const auth = resolveAuth();
const mechanism = Object.keys(auth).length ? 'VERCEL_TOKEN triple' : 'VERCEL_OIDC_TOKEN';
try {
  // `Sandbox.list()` returns a Parsed WRAPPER — { json, response, text } — so the
  // array is at `.json.sandboxes`. Reading `.sandboxes` directly yields undefined
  // and, with a `?? 0`, prints a confident "0 sandboxes" whether or not the call
  // authenticated. That is exactly how this script leaked a running sandbox on its
  // first dry run: a probe that cannot fail passed, and creation proceeded.
  // Every page (a bare list returns 20 rows), and the API's own clock: the
  // `Date` header of this call is the run start the stray check compares
  // `createdAt` against. It is read before anything is created.
  const listing = await listAllSandboxes(auth);
  if (listing.serverNowMs == null) {
    log('\n  WARNING — the sandbox API sent no Date header, so this run could not claim a');
    log('  sandbox by signature. Stopping rather than creating anything.');
    process.exit(1);
  }
  runStartMs = listing.serverNowMs;
  const rows = listing.rows;
  readout('Sandbox.list(), all pages', `OK via ${mechanism} — ${rows.length} sandbox(es) in scope, ` +
    `${rows.filter((r) => r.status === 'running').length} running`, 'listAllSandboxes(auth)  [Sandbox.list chained on pagination.next]');
  readout('run start (API clock)', new Date(runStartMs).toISOString(), "HTTP Date header of that listing");
} catch (e) {
  log(`\n  FAIL — the sandbox API did not authenticate: ${e?.name}: ${e?.message}`);
  log('  Nothing was created and nothing was billed. Supply the auth triple');
  log('  (VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID) or VERCEL_OIDC_TOKEN, and re-run.');
  process.exit(1);
}

jsonl = openResults(RUN_ID);
log(`\n  results -> ${jsonl}`);

// Everything below runs inside try/finally: a throw anywhere in the suite must
// still stop every VM this run created. The first dry run threw after M1(a) had
// booted one, and it stayed running until it was found by hand.
try {

// ----------------------------------------------- rehearsal-only switches ---
// POC_SIMULATE drives the two shapes the stray check must tell apart. Inert
// unless set; never set it on a record run.
//   unrecorded — create a VM through the SAME createFresh a real run uses,
//                and deliberately do NOT record its id: a create whose
//                bookkeeping never happened. Must be claimed by signature.
//   foreign    — create two VMs that are NOT this spike's shape, each
//                differing by one criterion: python3.13 (production-shaped),
//                and node22 with no port 3000. Must be left running and
//                reported. Both carry a 10-minute timeout, so they expire.
if (process.env.POC_SIMULATE === 'unrecorded') {
  const leaked = await createFresh(randomUUID());
  log(`\n  SIMULATION: created ${leaked.sandboxId} via createFresh and did NOT record its id`);
} else if (process.env.POC_SIMULATE === 'foreign') {
  const py = await Sandbox.create({ runtime: 'python3.13', timeout: 600_000, resources: { vcpus: 1 }, ...auth });
  const noPort = await Sandbox.create({ runtime: 'node22', timeout: 600_000, resources: { vcpus: 1 }, ...auth });
  log(`\n  SIMULATION: created ${py.sandboxId} (python3.13, no ports) and ${noPort.sandboxId} (node22, no ports); neither recorded`);
}

// ------------------------------------------------------------- utilities ---
/** Boot one sandbox from scratch, timing each leg. */
async function provisionFresh() {
  const token = randomUUID();
  const t = {};
  if (interrupted) throw new Error('interrupted by SIGINT before a fresh creation');
  const created = await elapsed(() => createFresh(token));
  const sandbox = created.value; live.push(sandbox); recordedIds.add(sandbox.sandboxId);
  t.createMs = created.ms;
  const url = sandbox.domain(BRIDGE_PORT);
  t.writeBridgeMs = (await elapsed(() => writeBridge(sandbox))).ms;
  t.installMs = (await elapsed(() => installCharter(sandbox))).ms;
  t.startMs = (await elapsed(() => startBridge(sandbox))).ms;
  t.readyMs = (await elapsed(() => waitForReady(url, token))).ms;
  const firstCall = await elapsed(async () => {
    const m = await importAppClientBoundTo(url, token, bindCounter++);
    return m.callMcpTool('nyc_charter__get_version', {});
  });
  t.firstToolResultMs = firstCall.ms;
  t.totalToToolResultMs = t.createMs + t.writeBridgeMs + t.installMs + t.startMs + t.readyMs + t.firstToolResultMs;
  t.resultChars = firstCall.value.length;
  return { sandbox, url, token, t };
}

async function provisionFromSnapshot(snapshotId) {
  const token = randomUUID();
  const t = {};
  if (interrupted) throw new Error('interrupted by SIGINT before a create-from-snapshot');
  const created = await elapsed(() => createFromSnapshot(snapshotId, token));
  const sandbox = created.value; live.push(sandbox); recordedIds.add(sandbox.sandboxId);
  t.createMs = created.ms;
  const url = sandbox.domain(BRIDGE_PORT);
  t.startMs = (await elapsed(() => startBridge(sandbox))).ms;
  t.readyMs = (await elapsed(() => waitForReady(url, token))).ms;
  const firstCall = await elapsed(async () => {
    const m = await importAppClientBoundTo(url, token, bindCounter++);
    return m.callMcpTool('nyc_charter__get_version', {});
  });
  t.firstToolResultMs = firstCall.ms;
  t.totalToToolResultMs = t.createMs + t.startMs + t.readyMs + t.firstToolResultMs;
  t.resultChars = firstCall.value.length;
  return { sandbox, url, token, t };
}

// --------------------------------------------------------------- M1 (a) ---
enterPhase('M1(a) fresh creation');
section(`M1(a) — FRESH CREATION to a returned tool result  (x${REPEATS})`);
summary.m1.fresh = [];
let keep = null;
for (let i = 1; i <= REPEATS; i++) {
  const p = await provisionFresh();
  log(`\n  reading ${i}:`);
  readout('create', `${p.t.createMs.toFixed(0)} ms`, CREATE_FRESH_COMMAND);
  readout('write bridge.mjs', `${p.t.writeBridgeMs.toFixed(0)} ms`, 'sandbox.writeFiles([{path:"/vercel/sandbox/bridge.mjs", ...}])');
  readout('install package', `${p.t.installMs.toFixed(0)} ms`, INSTALL_COMMAND);
  readout('start bridge', `${p.t.startMs.toFixed(0)} ms`, START_BRIDGE_COMMAND);
  readout('bridge ready', `${p.t.readyMs.toFixed(0)} ms`, READY_COMMAND(p.url));
  readout('first tool result', `${p.t.firstToolResultMs.toFixed(0)} ms (${p.t.resultChars} chars)`,
    "callMcpTool('nyc_charter__get_version', {})  [app's own client]");
  readout('TOTAL to tool result', `${(p.t.totalToToolResultMs / 1000).toFixed(1)} s`, 'sum of the six legs above');
  record({
    measurement: 'M1', step: 'fresh-creation', reading: i, sandboxId: p.sandbox.sandboxId,
    command: `${CREATE_FRESH_COMMAND} + ${INSTALL_COMMAND} + ${START_BRIDGE_COMMAND}`, ...p.t,
  });
  summary.m1.fresh.push(p.t);
  if (i < REPEATS) { await p.sandbox.stop({ blocking: true }); live.splice(live.indexOf(p.sandbox), 1); }
  else keep = p;
}

// ------------------------------------------------- snapshot, then M1 (b) ---
enterPhase('snapshot build');
section('SNAPSHOT — freeze a provisioned VM so "resume" has something to resume');
log('  NOTE: @vercel/sandbox@1.10.2 exposes NO resume() for a stopped sandbox.');
log('  stop() + snapshot() + create-from-snapshot IS the resume path at this SDK');
log('  version, and it is what M1(b) measures. Said plainly because the plan doc');
log('  quotes Vercel docs saying sandboxes "resume from an automatic snapshot" —');
log('  that is not a method this SDK version offers.');
// `expiration: 0` (never expire) is the ONLY value measured to work here:
// `{ expiration: 7200000 }` — two hours, intended as a self-healing backstop —
// was rejected with "Status code 400 is not ok" on a real run. So the finally
// block's explicit delete is the whole cleanup story, and it is demonstrated:
// two rehearsals ended with the snapshot reading status=deleted. A run killed
// between snapshot() and delete() leaves a 314 MB snapshot that never expires
// — `node scripts/poc-warm-vm/stop-strays.mjs --snapshots` lists them.
const snapped = await elapsed(() => keep.sandbox.snapshot({ expiration: 0 }));
const snapshotId = snapped.value.snapshotId;
snapshotRef = snapped.value;
live.splice(live.indexOf(keep.sandbox), 1);   // snapshot() stops the sandbox
readout('snapshot', `${(snapped.ms / 1000).toFixed(1)} s, id=${snapshotId}, ${(snapped.value.sizeBytes / 1e6).toFixed(0)} MB`,
  'sandbox.snapshot({ expiration: 0 })');
record({
  measurement: 'M1', step: 'snapshot-build', command: 'sandbox.snapshot({ expiration: 0 })',
  elapsedMs: snapped.ms, snapshotId, sizeBytes: snapped.value.sizeBytes,
});
summary.m1.snapshot = { elapsedMs: snapped.ms, snapshotId, sizeBytes: snapped.value.sizeBytes };

enterPhase('M1(b) resume from snapshot');
section(`M1(b) — RESUME FROM STOPPED (create-from-snapshot) to a tool result  (x${REPEATS})`);
summary.m1.resume = [];
let livePoc = null;
for (let i = 1; i <= REPEATS; i++) {
  const p = await provisionFromSnapshot(snapshotId);
  log(`\n  reading ${i}:`);
  readout('create from snapshot', `${p.t.createMs.toFixed(0)} ms`, CREATE_FROM_SNAPSHOT_COMMAND);
  readout('start bridge', `${p.t.startMs.toFixed(0)} ms`, START_BRIDGE_COMMAND);
  readout('bridge ready', `${p.t.readyMs.toFixed(0)} ms`, READY_COMMAND(p.url));
  readout('first tool result', `${p.t.firstToolResultMs.toFixed(0)} ms (${p.t.resultChars} chars)`,
    "callMcpTool('nyc_charter__get_version', {})  [app's own client]");
  readout('TOTAL to tool result', `${(p.t.totalToToolResultMs / 1000).toFixed(1)} s`, 'sum of the four legs above');
  record({
    measurement: 'M1', step: 'resume-from-snapshot', reading: i, sandboxId: p.sandbox.sandboxId,
    command: CREATE_FROM_SNAPSHOT_COMMAND, snapshotId, ...p.t,
  });
  summary.m1.resume.push(p.t);
  if (i < REPEATS) { await p.sandbox.stop({ blocking: true }); live.splice(live.indexOf(p.sandbox), 1); }
  else livePoc = p;
}

// --------------------------------------------------------------- M1 (c) ---
enterPhase('M1(c) warm calls');
section(`M1(c) — WARM CALL on the live session  (x${WARM_CALLS}, ${REPEATS} rounds)`);
const mcp = await importAppClientBoundTo(livePoc.url, livePoc.token, bindCounter++);
summary.m1.warm = [];
for (let round = 1; round <= REPEATS; round++) {
  const series = [];
  for (let i = 0; i < WARM_CALLS; i++) {
    const r = await elapsed(() => mcp.callMcpTool('nyc_charter__get_version', {}));
    series.push(Number(r.ms.toFixed(1)));
  }
  const median = [...series].sort((a, b) => a - b)[Math.floor(series.length / 2)];
  readout(`warm round ${round}`, `${series.join(', ')} ms  (median ${median} ms)`,
    `${WARM_CALLS}x callMcpTool('nyc_charter__get_version', {})  [app's own client, live session]`);
  record({
    measurement: 'M1', step: 'warm-call', reading: round,
    command: `${WARM_CALLS}x callMcpTool('nyc_charter__get_version', {})`, seriesMs: series, medianMs: median,
  });
  summary.m1.warm.push(series);
}

// ------------------------------------------------------------------- M2 ---
enterPhase('M2 compatibility');
section("M2 — COMPATIBILITY: does the app's own client complete the MCP lifecycle?");
const endpoint = mcpEndpoint(livePoc.url);
const initCmd = `curl -sS -i -X POST ${endpoint} -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'Authorization: Bearer <token>' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05",...}}'`;
const initRes = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${livePoc.token}`,
  },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'civic-ai-tools-website', version: '1.0.0' } },
  }),
});
const initText = await initRes.text();
const initSession = initRes.headers.get('mcp-session-id');
const initPayload = JSON.parse((initText.split('\n').find((l) => l.startsWith('data:')) || initText).replace(/^data:/, '').trim());
readout('initialize', `HTTP ${initRes.status}, content-type ${initRes.headers.get('content-type')}`, initCmd);
readout('negotiated protocolVersion', String(initPayload?.result?.protocolVersion), initCmd);
readout('serverInfo', JSON.stringify(initPayload?.result?.serverInfo), initCmd);
readout('mcp-session-id issued', initSession ? 'YES' : 'no', initCmd);

const listRes = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${livePoc.token}`,
    'mcp-session-id': initSession,
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
});
const listText = await listRes.text();
const listPayload = JSON.parse((listText.split('\n').find((l) => l.startsWith('data:')) || listText).replace(/^data:/, '').trim());
const advertised = (listPayload?.result?.tools || []).map((t) => t.name);
readout('tools/list', `HTTP ${listRes.status} — ${advertised.length} tools: ${advertised.join(', ')}`,
  initCmd.replace('"method":"initialize"', '"method":"tools/list"'));

const routed = mcp.routeTool('nyc_charter__get_section');
readout('app registry routing',
  `nyc_charter__get_section -> sourceId=${routed.sourceId}, auth header ${routed.headers?.Authorization ? 'attached' : 'MISSING'}`,
  "routeTool('nyc_charter__get_section')  [src/lib/mcp/registry.ts]");

const sectionOut = await elapsed(() => mcp.callMcpTool('nyc_charter__get_section', { citation: '§ 1043', corpus: 'charter' }));
readout('tools/call get_section §1043', `${sectionOut.ms.toFixed(0)} ms, ${sectionOut.value.length} chars`,
  "callMcpTool('nyc_charter__get_section', { citation: '§ 1043', corpus: 'charter' })  [app's own client]");
log("\n  ---- ACCEPTANCE (1): first 400 chars returned through the app's own client ----");
log('  ' + sectionOut.value.slice(0, 400).split('\n').join('\n  '));
log('  -----------------------------------------------------------------------------');

summary.m2 = {
  initializeStatus: initRes.status, contentType: initRes.headers.get('content-type'),
  negotiatedProtocolVersion: initPayload?.result?.protocolVersion,
  serverInfo: initPayload?.result?.serverInfo, sessionIdIssued: Boolean(initSession),
  toolsAdvertised: advertised, getSectionChars: sectionOut.value.length,
  getSectionFirstLine: sectionOut.value.split('\n')[0],
  getSectionExcerpt: sectionOut.value.slice(0, 400),
};
record({ measurement: 'M2', step: 'lifecycle', command: initCmd, ...summary.m2 });

// ------------------------------------------------------------------- M3 ---
enterPhase('M3 guarding');
section('M3 — GUARDING: the token, and the outbound block');
summary.m3.tokenRefusals = [];
const refusalCases = [
  ['no Authorization header', { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }],
  ['wrong bearer token', { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer not-the-token' }],
];
for (const [label, headers] of refusalCases) {
  for (let i = 1; i <= REPEATS; i++) {
    const r = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const body = (await r.text()).slice(0, 200);
    const cmd = `curl -sS -i -X POST ${endpoint} ${headers.Authorization ? "-H 'Authorization: Bearer not-the-token'" : '(no Authorization header)'} -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;
    readout(`${label} [reading ${i}]`, `HTTP ${r.status} ${r.statusText} — ${body}`, cmd);
    record({ measurement: 'M3', step: 'token-refused', label, reading: i, command: cmd, httpStatus: r.status, body });
    summary.m3.tokenRefusals.push({ label, reading: i, httpStatus: r.status, body });
  }
}

// The outbound probe runs BEFORE the block too, so the instrument is shown
// able to report success. A "blocked" reading from a probe that never worked
// proves nothing — it is the same shape as a green over a fixture that could
// only ever be green.
const OUTBOUND_PROBE = `node -e "fetch('https://registry.npmjs.org/-/ping').then(r=>console.log('OUTBOUND_REACHED status='+r.status)).catch(e=>console.log('OUTBOUND_BLOCKED '+(e.cause?.code||e.message)))"`;
async function outboundProbe() {
  const r = await livePoc.sandbox.runCommand({ cmd: 'sh', args: ['-c', OUTBOUND_PROBE] });
  return ((await r.stdout()) + (await r.stderr())).trim().slice(0, 300);
}
log('\n  --- the instrument, shown able to report success: probe BEFORE the block ---');
summary.m3.beforeBlock = [];
for (let i = 1; i <= REPEATS; i++) {
  const before = await outboundProbe();
  readout(`outbound BEFORE deny-all [reading ${i}]`, before, `sandbox.runCommand: ${OUTBOUND_PROBE}`);
  record({ measurement: 'M3', step: 'outbound-before-block', reading: i, command: OUTBOUND_PROBE, output: before });
  summary.m3.beforeBlock.push({ reading: i, output: before });
}

await livePoc.sandbox.updateNetworkPolicy('deny-all');
readout('apply outbound block', 'applied', "sandbox.updateNetworkPolicy('deny-all')");

log('\n  --- the same probe AFTER the block, and Charter still answering ---');
summary.m3.afterBlock = [];
let inboundSurvivedBlock = true;
for (let i = 1; i <= REPEATS; i++) {
  const after = await outboundProbe();
  readout(`outbound AFTER deny-all [reading ${i}]`, after, `sandbox.runCommand: ${OUTBOUND_PROBE}`);
  // The inbound public route is a SEPARATE question from egress, and
  // "deny-all" is not documented either way. If the block also severs the
  // route the app reaches, that is a finding about the guarding design, not a
  // script failure — so it is caught, recorded, and the policy restored so the
  // remaining measurements still happen.
  try {
    const still = await elapsed(() => mcp.callMcpTool('nyc_charter__get_section', { citation: '§ 1043', corpus: 'charter' }));
    readout(`Charter still answers [reading ${i}]`,
      `${still.ms.toFixed(0)} ms, ${still.value.length} chars, first line: ${still.value.split('\n')[0].slice(0, 60)}`,
      "callMcpTool('nyc_charter__get_section', { citation: '§ 1043', corpus: 'charter' })  [outbound denied]");
    record({
      measurement: 'M3', step: 'outbound-blocked-charter-answers', reading: i, command: OUTBOUND_PROBE,
      probeOutput: after, charterChars: still.value.length, charterMs: Number(still.ms.toFixed(1)),
    });
    summary.m3.afterBlock.push({ reading: i, probeOutput: after, charterChars: still.value.length });
  } catch (e) {
    inboundSurvivedBlock = false;
    readout(`Charter FAILED under deny-all [reading ${i}]`, `${e?.name}: ${e?.message}`,
      "callMcpTool('nyc_charter__get_section', ...)  [outbound denied]");
    record({
      measurement: 'M3', step: 'outbound-block-severed-inbound', reading: i, command: OUTBOUND_PROBE,
      probeOutput: after, error: `${e?.name}: ${e?.message}`,
    });
    summary.m3.afterBlock.push({ reading: i, probeOutput: after, error: `${e?.name}: ${e?.message}` });
  }
}
summary.m3.inboundSurvivedBlock = inboundSurvivedBlock;
if (!inboundSurvivedBlock) {
  log('\n  FINDING: "deny-all" also severed the INBOUND public route, so it cannot be the');
  log('  steady-state policy for a source the app must reach. Restoring a custom policy');
  log('  (empty allowlist) so the remaining measurements run, and recording the distinction.');
  await livePoc.sandbox.updateNetworkPolicy({ allow: [] });
  try {
    const retry = await mcp.callMcpTool('nyc_charter__get_section', { citation: '§ 1043', corpus: 'charter' });
    readout('Charter under { allow: [] }', `${retry.length} chars — inbound route intact, egress still denied`,
      "sandbox.updateNetworkPolicy({ allow: [] }) then callMcpTool('nyc_charter__get_section', ...)");
    record({
      measurement: 'M3', step: 'empty-allowlist-works', command: "sandbox.updateNetworkPolicy({ allow: [] })",
      charterChars: retry.length,
    });
    summary.m3.emptyAllowlistChars = retry.length;
  } catch (e2) {
    readout('Charter under { allow: [] }', `STILL FAILING: ${e2?.name}: ${e2?.message}`,
      "sandbox.updateNetworkPolicy({ allow: [] })");
    summary.m3.emptyAllowlistError = `${e2?.name}: ${e2?.message}`;
    await livePoc.sandbox.updateNetworkPolicy('allow-all');
  }
}

// ------------------------------------------------------------------- M4 ---
enterPhase('M4 memory and CPU');
section('M4 — MEMORY and COST');
const PS_COMMAND = "ps -o rss=,comm= -e | grep -i node    (RSS in kB, per node process)";
summary.m4.memory = [];
for (let i = 1; i <= REPEATS; i++) {
  const metricsRes = await fetch(`${livePoc.url.replace(/\/$/, '')}/metrics`, {
    headers: { Authorization: `Bearer ${livePoc.token}` },
  });
  const metrics = await metricsRes.json();
  const psRes = await livePoc.sandbox.runCommand({ cmd: 'sh', args: ['-c', 'ps -o rss=,comm= -e | grep -i node || true'] });
  const psOut = (await psRes.stdout()).trim();
  const freeRes = await livePoc.sandbox.runCommand({ cmd: 'sh', args: ['-c', "free -m | awk '/Mem:/{print \"total=\"$2\"MB used=\"$3\"MB\"}'"] });
  const freeOut = (await freeRes.stdout()).trim();
  readout(`bridge RSS [reading ${i}]`, `${(metrics.bridgeRssKb / 1024).toFixed(0)} MB`,
    `GET ${livePoc.url}/metrics  (process.memoryUsage().rss)`);
  readout(`Charter child RSS [reading ${i}]`, metrics.childRssKb ? `${(metrics.childRssKb / 1024).toFixed(0)} MB` : 'n/a',
    `GET ${livePoc.url}/metrics  (/proc/<childpid>/status VmRSS)`);
  readout(`independent ps [reading ${i}]`, psOut.split('\n').join(' | '), PS_COMMAND);
  readout(`VM memory [reading ${i}]`, freeOut, 'free -m');
  record({
    measurement: 'M4', step: 'memory', reading: i,
    command: `GET /metrics + ${PS_COMMAND} + free -m`,
    bridgeRssKb: metrics.bridgeRssKb, childRssKb: metrics.childRssKb, ps: psOut, free: freeOut, counters: metrics.counters,
  });
  summary.m4.memory.push({ reading: i, bridgeRssKb: metrics.bridgeRssKb, childRssKb: metrics.childRssKb, ps: psOut, free: freeOut });
}

// Active CPU is reported only once a sandbox is stopped, so per-call CPU comes
// from a DIFFERENCE between two otherwise identical boots — one serving
// CPU_CALLS calls, one serving none. Repeated, so the difference has two
// readings and not one.
log(`\n  --- active-CPU per call, by difference (boot+0 calls vs boot+${CPU_CALLS} calls) ---`);
summary.m4.cpu = [];
for (let i = 1; i <= REPEATS; i++) {
  const idle = await provisionFromSnapshot(snapshotId);
  await idle.sandbox.stop({ blocking: true });
  live.splice(live.indexOf(idle.sandbox), 1);
  const idleCpu = idle.sandbox.activeCpuUsageMs;

  const busy = await provisionFromSnapshot(snapshotId);
  const bm = await importAppClientBoundTo(busy.url, busy.token, bindCounter++);
  for (let k = 0; k < CPU_CALLS; k++) await bm.callMcpTool('nyc_charter__get_version', {});
  await busy.sandbox.stop({ blocking: true });
  live.splice(live.indexOf(busy.sandbox), 1);
  const busyCpu = busy.sandbox.activeCpuUsageMs;

  const perCallMs = (busyCpu - idleCpu) / CPU_CALLS;
  readout(`boot + 0 calls [reading ${i}]`, `${idleCpu} ms active CPU`,
    'sandbox.stop({blocking:true}) then sandbox.activeCpuUsageMs');
  readout(`boot + ${CPU_CALLS} calls [reading ${i}]`, `${busyCpu} ms active CPU`,
    'sandbox.stop({blocking:true}) then sandbox.activeCpuUsageMs');
  readout(`per-call active CPU [reading ${i}]`, `${perCallMs.toFixed(2)} ms`,
    `(${busyCpu} - ${idleCpu}) / ${CPU_CALLS}`);
  record({
    measurement: 'M4', step: 'active-cpu', reading: i,
    command: `2x create-from-snapshot; one serves ${CPU_CALLS} calls; sandbox.stop({blocking:true}); sandbox.activeCpuUsageMs`,
    idleCpuMs: idleCpu, busyCpuMs: busyCpu, perCallMs: Number(perCallMs.toFixed(2)), calls: CPU_CALLS,
  });
  summary.m4.cpu.push({ reading: i, idleCpuMs: idleCpu, busyCpuMs: busyCpu, perCallMs: Number(perCallMs.toFixed(2)) });
}

// ------------------------------------------------ three Charter questions ---
enterPhase('three Charter questions');
section("THREE REAL CHARTER QUESTIONS — through the app's normal tool loop");
const QUESTIONS = [
  'Under the New York City Charter, what must a city agency do before it can adopt a new rule? Cite the section.',
  'What does the NYC Charter say about who may serve on a community board, and what restriction applies to employees of council members?',
  'How current is the Charter text you are working from, and what does the Charter say about the powers of the Public Advocate?',
];
// REBIND BEFORE THE IMPORT, and this order is load-bearing. `compare-loop.ts`
// imports `callMcpTool` from the UNSUFFIXED `../mcp/client.ts`, a different
// module instance from every `?bind=N` one above, and that instance reads
// NYC_CHARTER_MCP_URL once at ITS first load — which is the line below. The
// M4 CPU section last pointed the environment at a sandbox that has since been
// stopped, so without this the questions would be asked of a dead address.
process.env.NYC_CHARTER_MCP_URL = livePoc.url;
process.env.NYC_CHARTER_MCP_TOKEN = livePoc.token;
try {
  const { getModelClient } = await import('../../src/lib/model-client.ts');
  const { getDefaultModel } = await import('../../src/lib/model-resolver.ts');
  const { runToolLoop } = await import('../../src/lib/model-loop/run-tool-loop.ts');
  const { compareLoopOptions } = await import('../../src/lib/model-loop/compare-loop.ts');
  const client = getModelClient();
  // The app's own default, from the app's own catalog — not a model id typed here.
  const endpointModel = process.env.POC_MODEL || getDefaultModel().endpointModel || getDefaultModel().id;
  log(`  model: ${endpointModel}   (src/lib/model-resolver.ts getDefaultModel())`);
  log('  loop:  runToolLoop(compareLoopOptions(...)) — the shipped loop and the shipped');
  log('         factory. No tool-calling loop is written in this script (CLAUDE.md).');
  const systemPrompt =
    'You answer questions about New York City law using the nyc_charter__* tools, which serve the ' +
    'NYC Charter, Administrative Code and Rules of the City of New York from a pinned package. ' +
    'ALWAYS call nyc_charter__get_version first and state how current the text is. Cite every ' +
    'section you rely on. Never state a legal conclusion the retrieved text does not support.';
  for (const [qi, prompt] of QUESTIONS.entries()) {
    const cmd = `runToolLoop(compareLoopOptions({ client, endpointModel: '${endpointModel}', prompt: <question ${qi + 1}>, systemPrompt }))`;
    const r = await elapsed(() => runToolLoop(compareLoopOptions({ client, endpointModel, prompt, systemPrompt })));
    const calls = r.value.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 90)})`);
    log(`\n  Q${qi + 1}: ${prompt}`);
    readout('tools called', calls.length ? calls.join('; ') : '(none)', cmd);
    readout('elapsed / iterations / tokens',
      `${(r.ms / 1000).toFixed(1)} s / ${r.value.iterations} / ${r.value.usage.totalTokens}`, cmd);
    log('  ANSWER:');
    log('  ' + r.value.content.split('\n').join('\n  '));
    record({
      measurement: 'Q', step: 'tool-loop', question: qi + 1, command: cmd, prompt,
      toolCalls: r.value.toolCalls.map((c) => ({ name: c.name, args: c.args, operationType: c.operationType, failed: c.failed })),
      iterations: r.value.iterations, usage: r.value.usage, elapsedMs: Number(r.ms.toFixed(0)), answer: r.value.content,
    });
    summary.questions.push({ question: prompt, toolCalls: calls, answer: r.value.content, usage: r.value.usage });
  }
} catch (e) {
  log(`  SKIPPED — the model half did not run: ${e?.name}: ${e?.message}`);
  log('  (M1-M4 above are unaffected; none of them calls a model.)');
  summary.questions = { skipped: `${e?.name}: ${e?.message}` };
}

// ------------------------------------------------------------ arithmetic ---
enterPhase('cost arithmetic');
section("M4 — COST ARITHMETIC at Vercel's published rates");
const cpuPerCallMs = summary.m4.cpu.reduce((a, c) => a + c.perCallMs, 0) / summary.m4.cpu.length;
const bootCpuMs = summary.m4.cpu.reduce((a, c) => a + c.idleCpuMs, 0) / summary.m4.cpu.length;
const gb = SANDBOX_MEMORY_MB / 1024;
const money = (x) => (x < 0.01 ? `$${x.toFixed(6)}` : `$${x.toFixed(4)}`);

log(`  rates: $${RATE_ACTIVE_CPU_HR}/active-CPU-hour · $${RATE_GB_HR}/GB-hour · $0.60/million creations`);
log(`  shape: ${SANDBOX_VCPUS} vCPU, ${SANDBOX_MEMORY_MB} MB (${gb} GB)`);
log(`  measured: ${cpuPerCallMs.toFixed(2)} ms active CPU per call; ${(bootCpuMs / 1000).toFixed(1)} s active CPU per boot`);

const perCallCpuCost = (cpuPerCallMs / 3_600_000) * RATE_ACTIVE_CPU_HR;
const perBootCost = (bootCpuMs / 3_600_000) * RATE_ACTIVE_CPU_HR + RATE_PER_CREATION;
const wakeWindowCost = gb * RATE_GB_HR * (60 / 3600);
const keptWarmMonth = gb * RATE_GB_HR * 24 * 30;

log('\n  IDLE-STOP (one wake per question, stops after):');
log(`    per wake  = boot CPU ${(bootCpuMs / 1000).toFixed(1)}s x $${RATE_ACTIVE_CPU_HR}/h + one creation = ${money(perBootCost)}`);
log(`    per call  = ${cpuPerCallMs.toFixed(2)}ms x $${RATE_ACTIVE_CPU_HR}/h = ${money(perCallCpuCost)}`);
log(`    memory is billed only while running; a 60s wake window = ${money(wakeWindowCost)}`);
const idleStopMonthly = {};
for (const q of [100, 1000, 10000]) {
  const c = q * (perBootCost + perCallCpuCost + wakeWindowCost);
  idleStopMonthly[q] = c;
  log(`    ${String(q).padStart(5)} questions/month, one 60s wake each = ${money(c)}`);
}

log('\n  KEPT WARM (left running):');
log(`    memory    = ${gb} GB x $${RATE_GB_HR}/GB-h x 24 x 30 = ${money(keptWarmMonth)} / month`);
log(`    creations = 1/month = ${money(RATE_PER_CREATION)}  (negligible)`);
log(`    CPU       = ${cpuPerCallMs.toFixed(2)}ms/call; 10,000 calls = ${money(10000 * perCallCpuCost)}`);
log(`    TOTAL at 10,000 calls/month = ${money(keptWarmMonth + 10000 * perCallCpuCost + RATE_PER_CREATION)} / month`);
log("\n  NOTE: Vercel's 24-hour maximum session (Pro) means \"kept warm\" is in fact a");
log('  VM re-created every 24h, not a permanent service — 30 creations a month, and a');
log('  gap at each roll. The product docs say sandboxes are "not designed to run');
log('  continuously" and point permanent services at VMs or Functions.');

summary.m4.cost = {
  rates: { activeCpuHour: RATE_ACTIVE_CPU_HR, gbHour: RATE_GB_HR, perCreation: RATE_PER_CREATION },
  cpuPerCallMs, bootCpuMs, gb,
  perWakeUsd: perBootCost, perCallUsd: perCallCpuCost,
  wakeWindow60sUsd: wakeWindowCost, idleStopMonthlyUsd: idleStopMonthly,
  keptWarmMonthUsd: keptWarmMonth,
};

phase = 'complete';
} catch (err) {
  failure = err;
} finally {
  await finalize();
}

// ---------------------------------------------------------------- finalize ---
// One cleanup for every exit path — normal completion, a throw, and SIGINT.
// Single-flight: a SIGINT that lands while the finally block is already
// finalizing waits on the same promise instead of starting a second cleanup.
// (`finalizing` is declared with the other state at the top: a `let` down here
// would be in its temporal dead zone when the finally block above calls this.)
function finalize() {
  if (!finalizing) finalizing = finalizeOnce();
  return finalizing;
}

async function finalizeOnce() {
  // ---------------------------------------------------------- teardown ---
  await teardown();
  // The snapshot is a billed artifact (per-GB-month) and nothing outside this
  // run refers to it, so it goes with the VMs that used it — on SIGINT too.
  if (snapshotRef) {
    try { await snapshotRef.delete(); summary.m1.snapshotDeleted = true; }
    catch (e) { summary.m1.snapshotDeleted = `FAILED: ${e?.message}`; }
  }
  summary.runStartMs = runStartMs;
  summary.recordedIds = [...recordedIds];

  const sp = jsonl ? writeSummary(RUN_ID, summary) : '(not written — the run stopped before step 0 finished)';
  // ------------------------------------------------- pasteable tail block ---
  section(failure ? 'KEY NUMBERS (run did NOT complete — see STOPPED AT below)' : 'KEY NUMBERS');
  const ms = (x) => (x == null ? 'n/a' : `${Math.round(x)} ms`);
  const secs = (x) => (x == null ? 'n/a' : `${(x / 1000).toFixed(1)} s`);

  log('  M1 — wake-up to a returned tool result');
  (summary.m1.fresh || []).forEach((t, i) =>
    keyLine(`  fresh creation [${i + 1}]`, `${secs(t.totalToToolResultMs)}  (install ${ms(t.installMs)}, first call ${ms(t.firstToolResultMs)})`));
  (summary.m1.resume || []).forEach((t, i) =>
    keyLine(`  resume from stopped [${i + 1}]`, `${secs(t.totalToToolResultMs)}  (create ${ms(t.createMs)}, ready ${ms(t.readyMs)})`));
  (summary.m1.warm || []).forEach((series, i) =>
    keyLine(`  warm call [${i + 1}]`, `median ${[...series].sort((a, b) => a - b)[Math.floor(series.length / 2)]} ms of ${series.length}: ${series.join(', ')} ms`));
  if (summary.m1.snapshot) keyLine('  snapshot built', `${secs(summary.m1.snapshot.elapsedMs)}, ${(summary.m1.snapshot.sizeBytes / 1e6).toFixed(0)} MB (deleted: ${summary.m1.snapshotDeleted})`);

  log('\n  M2 — compatibility with the app\u2019s own client');
  keyLine('  negotiated protocolVersion', summary.m2.negotiatedProtocolVersion ?? 'n/a');
  keyLine('  mcp-session-id issued', summary.m2.sessionIdIssued === undefined ? 'n/a' : (summary.m2.sessionIdIssued ? 'YES' : 'no'));
  keyLine('  initialize / content-type', `HTTP ${summary.m2.initializeStatus ?? 'n/a'} / ${summary.m2.contentType ?? 'n/a'}`);
  keyLine('  tools advertised', (summary.m2.toolsAdvertised || []).join(', ') || 'n/a');
  keyLine('  get_section §1043', `${summary.m2.getSectionChars ?? 'n/a'} chars — ${summary.m2.getSectionFirstLine ?? ''}`);

  log('\n  M3 — guarding, as observed');
  for (const r of summary.m3.tokenRefusals || []) keyLine(`  ${r.label} [${r.reading}]`, `HTTP ${r.httpStatus} — ${r.body}`);
  for (const r of summary.m3.beforeBlock || []) keyLine(`  outbound BEFORE block [${r.reading}]`, r.output);
  for (const r of summary.m3.afterBlock || []) keyLine(`  outbound AFTER block [${r.reading}]`, `${r.probeOutput}${r.charterChars ? `  |  Charter answered ${r.charterChars} chars` : `  |  Charter FAILED: ${r.error}`}`);
  keyLine('  inbound route under deny-all', summary.m3.inboundSurvivedBlock === undefined ? 'n/a' : (summary.m3.inboundSurvivedBlock ? 'SURVIVED' : 'SEVERED — deny-all cannot be the steady state'));

  log('\n  M4 — memory and cost');
  for (const m of summary.m4.memory || [])
    keyLine(`  resident memory [${m.reading}]`, `bridge ${(m.bridgeRssKb / 1024).toFixed(0)} MB + Charter ${m.childRssKb ? (m.childRssKb / 1024).toFixed(0) + ' MB' : 'n/a'}  |  ${m.free}  |  ps: ${m.ps.split('\n').join(' ')}`);
  for (const c of summary.m4.cpu || [])
    keyLine(`  active CPU per call [${c.reading}]`, `${c.perCallMs} ms   (boot+${CPU_CALLS} ${c.busyCpuMs} ms − boot ${c.idleCpuMs} ms)`);
  if (summary.m4.cost) {
    const k = summary.m4.cost;
    keyLine('  per wake (boot + 1 creation)', `$${k.perWakeUsd.toFixed(6)}`);
    keyLine('  per tool call (CPU)', `$${k.perCallUsd.toFixed(6)}`);
    keyLine('  idle-stop, 1k q/mo @60s wake', `$${k.idleStopMonthlyUsd[1000].toFixed(4)} / month`);
    keyLine('  idle-stop, 10k q/mo @60s wake', `$${k.idleStopMonthlyUsd[10000].toFixed(4)} / month`);
    keyLine('  kept warm (memory alone)', `$${k.keptWarmMonthUsd.toFixed(2)} / month for ${k.gb} GB`);
  }

  log('\n  Q — three Charter questions through runToolLoop');
  if (Array.isArray(summary.questions)) {
    summary.questions.forEach((q, i) => keyLine(`  Q${i + 1} tools called`, q.toolCalls.join('; ') || '(none)'));
    if (!summary.questions.length) keyLine('  (none ran)', '—');
  } else {
    keyLine('  SKIPPED', summary.questions.skipped);
  }

  log(`\n  observations: ${jsonl}`);
  log(`  summary:      ${sp}`);

  // ------------------------------------------------------- stray check ---
  // A LIVE read of every page of the sandbox API, not this process's own
  // bookkeeping. It claims only what this run can prove it created (recorded
  // id, or the node22 + port 3000 + created-after-start signature) and stops
  // only those. Anything else alive — production's notebook executor runs in
  // this scope — is reported NOT OURS and left running, and does not turn
  // "STRAYS: 0" into a leak line. The STRAYS line names what was found alive
  // BEFORE the backstop acted, so a leak can never print as "STRAYS: 0".
  let strayLine;
  let notOursLine;
  const sinceIso = runStartMs ? new Date(runStartMs).toISOString() : '<run start>';
  try {
    const { ours, notOurs } = await classifyAlive({ auth, recordedIds, runStartMs });
    notOursLine = notOurs.length
      ? `NOT OURS — left running: ${notOurs.length}  ${notOurs.map(describeNotOurs).join('  ')}`
      : 'NOT OURS — left running: 0';
    if (!ours.length) {
      strayLine = 'STRAYS: 0';
    } else {
      const label = ours.map((o) => `${o.row.id}[${o.by}]`).join(' ');
      const remaining = await stopClaimed(ours, auth);
      strayLine = remaining.length
        ? `STRAYS: ${ours.length} ${label} (backstop FAILED; ${remaining.length} still alive: ${remaining.map((o) => o.row.id).join(' ')})`
        : `STRAYS: ${ours.length} ${label} (backstop stopped all ${ours.length}; 0 still alive)`;
    }
  } catch (e) {
    notOursLine = 'NOT OURS — left running: UNKNOWN (the listing could not be read)';
    strayLine = `STRAYS: UNKNOWN — could not read the sandbox list (${e?.name}: ${e?.message}); run: node scripts/poc-warm-vm/stop-strays.mjs --since ${sinceIso}`;
  }

  section(failure ? 'INCOMPLETE' : 'DONE');
  if (failure) {
    log(`  STOPPED AT: ${phase}`);
    log(`  REASON:     ${failure?.name}: ${failure?.message}`);
    log('  This run\u2019s VMs were still torn down, and the stray check below is live.');
  }
  log(`  run start (API clock): ${sinceIso}   recorded ids: ${recordedIds.size}`);
  log(`  ${notOursLine}`);
  log(`  ${strayLine}`);
  if (failure || strayLine !== 'STRAYS: 0') process.exitCode = 1;
}
