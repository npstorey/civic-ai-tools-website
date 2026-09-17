#!/usr/bin/env node
/**
 * POC MCP-LIVE-SOURCE — everything that needs NO model key, in one run.
 *
 * The question this spike asks: when the source on the sandbox must reach a
 * live city service, does the isolation still hold, does its own secret stay
 * inside the machine, and what changes in the wake-up and cost picture?
 *
 * This file answers L1–L4 and the non-model half of L5. The model half —
 * driving a question through the shipped loop — is `run-questions.mjs`, which
 * needs a credential this session cannot hold and is therefore run separately.
 *
 * WHAT IT CREATES: six sandboxes, all on port 3100, every id recorded at the
 * moment `Sandbox.create` resolves. A hard cap (POC_MAX_CREATIONS, default 15)
 * refuses the seventh rather than trusting the phase list to be right.
 *
 * SECRET HYGIENE. The bridge bearer token is a per-run `randomUUID()` held in
 * memory. `SOCRATA_APP_TOKEN` — the SOURCE'S secret, L3 — is read from this
 * process's environment, handed to `Sandbox.create({ env })`, and then DELETED
 * from `process.env` before anything else runs, so no later phase and no module
 * this run imports can read it. Neither is ever printed, logged, or written to
 * the results file, and the run proves that last claim by scanning its own
 * output files for both literals — with a canary in the same scan, so a scan
 * that reads nothing cannot report "no leak".
 *
 * Writes (all git-ignored, under temp/mcp-live-source-poc/):
 *   run-<id>.log · observations-<id>.jsonl · summary-<id>.json
 */
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';

process.env.POC_RESULTS_DIR ||= path.join(process.cwd(), 'temp', 'mcp-live-source-poc');
const {
  openResults, record, writeSummary, section, readout, elapsed, log,
  silenceAppClientLogs, keyLine, teeOutputTo, RESULTS_DIR, sleep,
} = await import('../poc-warm-vm/lib.mjs');
const { GUEST_CPU_COMMAND, parseGuestCpu, perCallGuestCpu } = await import('../poc-warm-vm/guest-cpu.mjs');
const OPS = await import('./sandbox-ops.mjs');

const {
  createFresh, createFromSnapshot, installRecordServer, writeBridge, writeProbe,
  startBridge, waitForReady, resolveAuth, probe, probeCommand, policyCommand,
  listAllSandboxes, ownershipStrayCheck,
  CREATE_FRESH_COMMAND, CREATE_FROM_SNAPSHOT_COMMAND, INSTALL_COMMAND,
  START_BRIDGE_COMMAND, READY_COMMAND,
  BRIDGE_PORT, RECORD_PACKAGE, UPSTREAM_HOST, UPSTREAM_DATASET,
  SANDBOX_VCPUS, SANDBOX_MEMORY_MB, OUR_SIGNATURE,
  INSTALL_POLICY, UPSTREAM_ONLY_POLICY, DENY_ALL_POLICY, ALLOW_ALL_POLICY,
} = OPS;

// Vercel's published rates, read 2026-09-15 (mcp-source-hosting-plan.md §1).
// Identical to the warm-VM spike's, so the two cost pictures are comparable.
const RATE_ACTIVE_CPU_HR = 0.128;
const RATE_GB_HR = 0.0212;
const RATE_PER_CREATION = 0.60 / 1_000_000;

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_PATH = teeOutputTo(path.join(RESULTS_DIR, `run-${RUN_ID}.log`));
silenceAppClientLogs();

const REPEATS = Number(process.env.POC_REPEATS || 2);
const WARM_CALLS = Number(process.env.POC_WARM_CALLS || 5);
const CPU_CALLS = Number(process.env.POC_CPU_CALLS || 500);
const MAX_CREATIONS = Number(process.env.POC_MAX_CREATIONS || 15);

/**
 * L3's secret, taken once and immediately removed from this process.
 *
 * A DECOY when the owner supplies none: a unique random value that cannot
 * collide with anything, which makes the leak scan below a test that can
 * actually fail rather than a grep for a string that was never there. A decoy
 * also answers a question a real token cannot — what a live source does when
 * its optional credential is wrong — and that answer is recorded rather than
 * hidden.
 */
const SUPPLIED_APP_TOKEN = process.env.SOCRATA_APP_TOKEN?.trim() || '';
const APP_TOKEN_IS_DECOY = SUPPLIED_APP_TOKEN.length === 0;
const APP_TOKEN = SUPPLIED_APP_TOKEN || `decoy-${randomUUID()}`;
delete process.env.SOCRATA_APP_TOKEN;

/**
 * The instrument check for the leak scan. Printed into the log deliberately, so
 * the same scanner that reports "0 occurrences of the token" must also report a
 * non-zero count for this. A scan that finds neither has proved nothing about
 * the token; it has only proved it read no files.
 */
const CANARY = `LEAKCANARY-${randomUUID()}`;

// ------------------------------------------------------------------ state ---
const live = [];                 // sandboxes to tear down on exit
const recordedIds = new Set();   // every id created, never removed
const stoppedCpu = {};           // sandboxId -> activeCpuUsageMs, read after a blocking stop
let creations = 0;
let runStartMs = null;
let jsonl = null;
let phase = 'startup';
let failure = null;
let interrupted = false;
let finalizing = null;
let snapshotRef = null;

const summary = {
  runId: RUN_ID, kind: 'live-source', package: RECORD_PACKAGE, upstreamHost: UPSTREAM_HOST,
  upstreamDataset: UPSTREAM_DATASET, bridgePort: BRIDGE_PORT,
  signature: OUR_SIGNATURE, vcpus: SANDBOX_VCPUS, memoryMb: SANDBOX_MEMORY_MB,
  appTokenIsDecoy: APP_TOKEN_IS_DECOY,
  l4: { fresh: [], resume: [], warm: [], memory: [], guestCpu: [], installedSize: null, snapshot: null },
  l1: [], l2: [], l3: [], l5a: [], cost: null, leakScan: null,
};

function enterPhase(name) {
  if (interrupted) throw new Error(`interrupted by SIGINT before phase "${name}"`);
  phase = name;
}

/** Every creation goes through here, so the cap cannot be bypassed by a new phase. */
async function createCounted(kind, fn) {
  if (creations >= MAX_CREATIONS) {
    throw new Error(`creation cap reached (${creations}/${MAX_CREATIONS}) — refusing to create another sandbox for "${kind}"`);
  }
  creations += 1;
  const r = await elapsed(fn);
  live.push(r.value);
  recordedIds.add(r.value.sandboxId);
  return r;
}

async function stopAndReadCpu(sandbox) {
  try {
    await sandbox.stop({ blocking: true });
    const i = live.indexOf(sandbox);
    if (i >= 0) live.splice(i, 1);
    // `activeCpuUsageMs` is only reported once a VM has stopped (@vercel/sandbox@1.10.2).
    const fresh = await Sandbox.get({ sandboxId: sandbox.sandboxId, ...resolveAuth() });
    stoppedCpu[sandbox.sandboxId] = fresh?.activeCpuUsageMs ?? sandbox.activeCpuUsageMs ?? null;
  } catch (e) {
    stoppedCpu[sandbox.sandboxId] = `unreadable: ${e?.message}`;
  }
  return stoppedCpu[sandbox.sandboxId];
}

async function teardown() {
  for (const s of [...live]) {
    try { await stopAndReadCpu(s); } catch { /* reported by the stray check */ }
  }
}

let sigints = 0;
process.on('SIGINT', async () => {
  sigints += 1;
  if (sigints > 1) {
    const since = runStartMs ? new Date(runStartMs).toISOString() : '<run start>';
    console.log('\n  SIGINT again — exiting WITHOUT cleanup. Find anything left behind with:');
    console.log(`    node scripts/poc-warm-vm/stop-strays.mjs --port ${BRIDGE_PORT} --since ${since}`);
    process.exit(130);
  }
  interrupted = true;
  if (!failure) failure = new Error(`interrupted by SIGINT during phase "${phase}"`);
  console.log('\n  SIGINT — stopping this run’s VMs, then checking for strays. Ctrl-C again exits without cleanup.');
  await finalize();
  process.exit(130);
});

/**
 * Bind the app's OWN MCP client to a specific bridge address.
 *
 * `src/lib/mcp/client.ts` builds its registry once, at module load, so a fresh
 * `?bind=` suffix is what forces a fresh module instance. Nothing is stubbed:
 * this is the shipped client, the shipped registry and the shipped tool names.
 */
let bindCounter = 0;
async function bindAppClient(url, token) {
  process.env.NYC_RECORD_MCP_URL = url;
  process.env.NYC_RECORD_MCP_TOKEN = token;
  return import(`../../src/lib/mcp/client.ts?bind=${bindCounter++}`);
}

/** POST one JSON-RPC message straight at the bridge, to read the wire itself. */
async function rawRpc(url, token, sessionId, message) {
  const endpoint = url.replace(/\/$/, '').endsWith('/mcp') ? url : `${url.replace(/\/$/, '')}/mcp`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(message),
  });
  const text = await res.text();
  const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
  let payload = null;
  try { payload = JSON.parse((dataLine || text).replace(/^data:/, '').trim()); } catch { /* reported raw */ }
  return { status: res.status, sessionId: res.headers.get('mcp-session-id'), text, payload };
}

// =============================================================== step 0 ====
section('STEP 0 — sandbox auth (read-only; nothing is created until it passes)');
log(`  log: ${LOG_PATH}`);
log(`  canary (proves the leak scan reads these files): ${CANARY}`);
log(`  subject: ${RECORD_PACKAGE} → ${UPSTREAM_HOST}/resource/${UPSTREAM_DATASET}.json`);
log(`  bridge port: ${BRIDGE_PORT}   ownership signature: ${JSON.stringify(OUR_SIGNATURE)}`);
log(`  creation cap: ${MAX_CREATIONS}`);
for (const n of ['SOCRATA_APP_TOKEN', 'VERCEL_OIDC_TOKEN', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID']) {
  log(`  ${n}: ${process.env[n]?.trim() ? 'present' : 'absent'}   (name only — never the value)`);
}
log(`  SOCRATA_APP_TOKEN for this run: ${APP_TOKEN_IS_DECOY ? 'NONE SUPPLIED — a unique decoy is used (see L3)' : 'supplied by the operator'}`);

const auth = resolveAuth();
try {
  const listing = await listAllSandboxes(auth);
  if (listing.serverNowMs == null) throw new Error('the sandbox API sent no Date header, so no run start could be fixed');
  runStartMs = listing.serverNowMs;
  readout('sandbox API', `OK — ${listing.rows.length} sandbox(es) in scope, ${listing.rows.filter((r) => r.status === 'running').length} running`,
    'listAllSandboxes(auth)  [every page]');
  readout('run start (API clock)', new Date(runStartMs).toISOString(), 'HTTP Date header of that listing');
} catch (e) {
  log(`\n  FAIL — the sandbox API did not authenticate: ${e?.name}: ${e?.message}`);
  log('  Nothing was created.\n\n  STRAYS: none possible — nothing was created');
  process.exit(1);
}
jsonl = openResults(RUN_ID);
log(`  observations -> ${jsonl}`);

/** One fresh boot, timed leg by leg. */
async function provisionFresh(opts = {}) {
  const token = randomUUID();
  const t = {};
  const created = await createCounted('fresh', () => createFresh(token, opts));
  const sandbox = created.value;
  t.createMs = created.ms;
  const url = sandbox.domain(BRIDGE_PORT);
  t.writeFilesMs = (await elapsed(async () => { await writeBridge(sandbox); await writeProbe(sandbox); })).ms;
  t.installMs = (await elapsed(() => installRecordServer(sandbox))).ms;
  t.startMs = (await elapsed(() => startBridge(sandbox))).ms;
  t.readyMs = (await elapsed(() => waitForReady(url, token))).ms;
  return { sandbox, url, token, t };
}

try {
  // ======================================================= L4(a) fresh ====
  enterPhase('L4(a) fresh boot');
  section(`L4(a) — FRESH BOOT to a returned tool result, with a LIVE upstream in the path  (x${REPEATS})`);
  log(`  Contrast: the warm-VM spike installed @betanyc/nyc-charter-laws-rules@0.2.0, whose`);
  log(`  bundled corpus dominated the install. This package is 13.7 kB packed and answers`);
  log(`  from ${UPSTREAM_HOST}, so the first tool result also pays a real round trip.`);
  let working = null;
  let donorSandbox = null;
  for (let i = 1; i <= REPEATS; i++) {
    const p = await provisionFresh();
    readout(`create [${i}]`, `${p.t.createMs.toFixed(0)} ms — ${p.sandbox.sandboxId}`, CREATE_FRESH_COMMAND);
    readout(`write bridge.mjs + vm-probe.mjs [${i}]`, `${p.t.writeFilesMs.toFixed(0)} ms`, 'sandbox.writeFiles([...])');
    readout(`install package [${i}]`, `${p.t.installMs.toFixed(0)} ms`, INSTALL_COMMAND);
    readout(`start bridge [${i}]`, `${p.t.startMs.toFixed(0)} ms`, START_BRIDGE_COMMAND);
    readout(`bridge ready [${i}]`, `${p.t.readyMs.toFixed(0)} ms`, READY_COMMAND(p.url));

    // The upstream is not reachable yet (install policy), so the first tool
    // result is measured after the policy is opened to the upstream — which is
    // the state a hosted instance runs in, and the honest place to measure it.
    await p.sandbox.updateNetworkPolicy(UPSTREAM_ONLY_POLICY);
    const client = await bindAppClient(p.url, p.token);
    const first = await elapsed(() => client.callMcpTool('nyc_record__get_procurement_notices', { limit: 1 }));
    p.t.firstToolResultMs = first.ms;
    p.t.resultChars = first.value.length;
    p.t.totalToToolResultMs = p.t.createMs + p.t.writeFilesMs + p.t.installMs + p.t.startMs + p.t.readyMs + first.ms;
    readout(`first tool result [${i}]`, `${first.ms.toFixed(0)} ms (${first.value.length} chars)`,
      `${policyCommand(UPSTREAM_ONLY_POLICY)} then callMcpTool('nyc_record__get_procurement_notices', { limit: 1 })  [app's own client]`);
    readout(`TOTAL to tool result [${i}]`, `${(p.t.totalToToolResultMs / 1000).toFixed(1)} s`, 'sum of the six legs above');

    const size = await probe(p.sandbox, 'size');
    readout(`installed size [${i}]`, size.text.split('\n').join(' | '), probeCommand('size'));
    summary.l4.installedSize = size.text;
    summary.l4.fresh.push({ reading: i, sandboxId: p.sandbox.sandboxId, url: p.url, ...p.t, installedSize: size.text });
    record({ measurement: 'L4', step: 'fresh-boot', reading: i, command: `${CREATE_FRESH_COMMAND} + ${INSTALL_COMMAND} + ${START_BRIDGE_COMMAND}`, sandboxId: p.sandbox.sandboxId, ...p.t, installedSize: size.text });

    // Reading 1's VM becomes the snapshot donor (snapshot() stops it), so the
    // resume measurement costs no extra creation. Reading 2's VM stays alive as
    // the working VM for L1, L2, L5a and the rest of L4.
    if (i < REPEATS) { donorSandbox = p.sandbox; } else { working = p; }
  }

  // ====================================================== L4(b) resume ====
  enterPhase('L4(b) snapshot and resume');
  section(`L4(b) — SNAPSHOT, then RESUME to a tool result  (x${REPEATS})`);
  log('  @vercel/sandbox@1.10.2 exposes no resume() for a stopped sandbox, so');
  log('  snapshot + create-from-snapshot IS the resume path at this SDK version —');
  log('  the same one the warm-VM spike measured, which is what makes the two');
  log('  wake-up numbers comparable.');
  // `expiration: 0` (never expire) is the only value the warm-VM spike measured
  // to work; `{ expiration: 7200000 }` was rejected with "Status code 400 is not
  // ok". `snapshot()` STOPS the sandbox itself, so the donor is the first fresh
  // boot (already finished with) rather than a seventh creation.
  const donor = donorSandbox;
  const snapped = await elapsed(() => donor.snapshot({ expiration: 0 }));
  snapshotRef = snapped.value;
  const snapshotId = snapped.value.snapshotId;
  const di = live.indexOf(donor);
  if (di >= 0) live.splice(di, 1);              // snapshot() stopped it
  try {
    const fresh = await Sandbox.get({ sandboxId: donor.sandboxId, ...resolveAuth() });
    stoppedCpu[donor.sandboxId] = fresh?.activeCpuUsageMs ?? null;
  } catch { stoppedCpu[donor.sandboxId] = null; }
  readout('snapshot built', `${(snapped.ms / 1000).toFixed(1)} s, id=${snapshotId}, ${(snapped.value.sizeBytes / 1e6).toFixed(0)} MB`,
    'sandbox.snapshot({ expiration: 0 })  [on the first fresh boot — no extra creation]');
  summary.l4.snapshot = { snapshotId, ms: snapped.ms, sizeBytes: snapped.value.sizeBytes };
  record({ measurement: 'L4', step: 'snapshot', command: 'sandbox.createSnapshot()', snapshotId, ms: snapped.ms, sizeBytes: snapped.value.sizeBytes });

  for (let i = 1; i <= REPEATS; i++) {
    const token = randomUUID();
    const t = {};
    const created = await createCounted('resume', () => createFromSnapshot(snapshotId, token));
    const sandbox = created.value;
    t.createMs = created.ms;
    const url = sandbox.domain(BRIDGE_PORT);
    t.startMs = (await elapsed(() => startBridge(sandbox))).ms;
    t.readyMs = (await elapsed(() => waitForReady(url, token))).ms;
    await sandbox.updateNetworkPolicy(UPSTREAM_ONLY_POLICY);
    const client = await bindAppClient(url, token);
    const first = await elapsed(() => client.callMcpTool('nyc_record__get_procurement_notices', { limit: 1 }));
    t.firstToolResultMs = first.ms;
    t.resultChars = first.value.length;
    t.totalToToolResultMs = t.createMs + t.startMs + t.readyMs + first.ms;
    readout(`create from snapshot [${i}]`, `${t.createMs.toFixed(0)} ms — ${sandbox.sandboxId}`, CREATE_FROM_SNAPSHOT_COMMAND);
    readout(`bridge ready [${i}]`, `${t.readyMs.toFixed(0)} ms`, READY_COMMAND(url));
    readout(`first tool result [${i}]`, `${first.ms.toFixed(0)} ms (${first.value.length} chars)`,
      `${policyCommand(UPSTREAM_ONLY_POLICY)} then callMcpTool('nyc_record__get_procurement_notices', { limit: 1 })`);
    readout(`TOTAL to tool result [${i}]`, `${(t.totalToToolResultMs / 1000).toFixed(1)} s`, 'sum of the four legs above');
    summary.l4.resume.push({ reading: i, sandboxId: sandbox.sandboxId, url, ...t });
    record({ measurement: 'L4', step: 'resume', reading: i, command: CREATE_FROM_SNAPSHOT_COMMAND, sandboxId: sandbox.sandboxId, ...t });
    await stopAndReadCpu(sandbox);
  }

  // ============================== L1 / L2 / L5a on the working VM =========
  const sandbox = working.sandbox;
  const client = await bindAppClient(working.url, working.token);
  log(`\n  working VM for L1, L2, L5a and the rest of L4: ${sandbox.sandboxId} at ${working.url}`);

  /** One live tool call through the app's own client; returns success or the thrown error. */
  async function callSource(tool = 'nyc_record__get_procurement_notices', args = { limit: 1 }) {
    const t0 = Date.now();
    try {
      const outText = await client.callMcpTool(tool, args);
      return { ok: true, ms: Date.now() - t0, chars: outText.length, sample: outText.slice(0, 160).replace(/\s+/g, ' ') };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, errorName: e?.name, errorMessage: e?.message, error: e };
    }
  }

  const FOREIGN_HOSTS = ['registry.npmjs.org', 'api.datacommons.org'];

  for (let r = 1; r <= REPEATS; r++) {
    // -------------------------------------------------- L1 + L2, allow-all ---
    enterPhase(`L1 reading ${r}`);
    section(`L1 / L2 — READING ${r} of ${REPEATS}`);
    await sandbox.updateNetworkPolicy(ALLOW_ALL_POLICY);
    await sleep(1500);   // let the policy settle before reading through it
    const openUp = await probe(sandbox, 'outbound', UPSTREAM_HOST);
    const openForeign = [];
    for (const h of FOREIGN_HOSTS) openForeign.push((await probe(sandbox, 'outbound', h)).text);
    const openCall = await callSource();
    readout(`allow-all · upstream [${r}]`, openUp.text, probeCommand('outbound', UPSTREAM_HOST));
    for (const [k, h] of FOREIGN_HOSTS.entries()) readout(`allow-all · ${h} [${r}]`, openForeign[k], probeCommand('outbound', h));
    readout(`allow-all · source answers [${r}]`, openCall.ok ? `${openCall.chars} chars in ${openCall.ms} ms` : `FAILED ${openCall.errorName}: ${openCall.errorMessage}`,
      `${policyCommand(ALLOW_ALL_POLICY)} then callMcpTool('nyc_record__get_procurement_notices', { limit: 1 })`);
    const tlsOpen = await probe(sandbox, 'tls', UPSTREAM_HOST);
    readout(`allow-all · TLS chain [${r}]`, tlsOpen.text, probeCommand('tls', UPSTREAM_HOST));

    // ------------------------------------------- L1 + L2, upstream-only ---
    await sandbox.updateNetworkPolicy(UPSTREAM_ONLY_POLICY);
    await sleep(1500);
    const allowUp = await probe(sandbox, 'outbound', UPSTREAM_HOST);
    const allowForeign = [];
    for (const h of FOREIGN_HOSTS) allowForeign.push((await probe(sandbox, 'outbound', h)).text);
    const allowCall = await callSource();
    const allowSearch = await callSource('nyc_record__search_notices', { query: 'Department of Sanitation', limit: 3 });
    readout(`upstream-only · upstream [${r}]`, allowUp.text, probeCommand('outbound', UPSTREAM_HOST));
    for (const [k, h] of FOREIGN_HOSTS.entries()) readout(`upstream-only · ${h} REFUSED? [${r}]`, allowForeign[k], probeCommand('outbound', h));
    readout(`upstream-only · source answers [${r}]`, allowCall.ok ? `${allowCall.chars} chars in ${allowCall.ms} ms — ${allowCall.sample}` : `FAILED ${allowCall.errorName}: ${allowCall.errorMessage}`,
      `${policyCommand(UPSTREAM_ONLY_POLICY)} then callMcpTool('nyc_record__get_procurement_notices', { limit: 1 })`);
    readout(`upstream-only · search answers [${r}]`, allowSearch.ok ? `${allowSearch.chars} chars in ${allowSearch.ms} ms` : `FAILED ${allowSearch.errorName}: ${allowSearch.errorMessage}`,
      `callMcpTool('nyc_record__search_notices', { query: 'Department of Sanitation', limit: 3 })`);
    const tlsAllow = await probe(sandbox, 'tls', UPSTREAM_HOST);
    readout(`upstream-only · TLS chain [${r}]`, tlsAllow.text, probeCommand('tls', UPSTREAM_HOST));
    const caInv = await probe(sandbox, 'ca');
    readout(`upstream-only · CA material [${r}]`, caInv.text.split('\n').join(' | '), probeCommand('ca'));

    // ------------------------------------------------ L1 contrast: deny-all ---
    await sandbox.updateNetworkPolicy(DENY_ALL_POLICY);
    await sleep(1500);
    const denyUp = await probe(sandbox, 'outbound', UPSTREAM_HOST);
    const denyDns = await probe(sandbox, 'dns', UPSTREAM_HOST);
    readout(`deny-all · upstream [${r}]`, denyUp.text, probeCommand('outbound', UPSTREAM_HOST));
    readout(`deny-all · names or packets? [${r}]`, denyDns.text.split('\n').join(' | '), probeCommand('dns', UPSTREAM_HOST));

    // ------------------------------------------------------------- L5(a) ---
    // The failure, on the wire and through the shipped client — with no model
    // in the path, so the three layers can be read apart.
    enterPhase(`L5(a) reading ${r}`);
    const init = await rawRpc(working.url, working.token, null, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'poc-live-source', version: '1' } },
    });
    const wire = await rawRpc(working.url, working.token, init.sessionId, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'nyc_record__get_procurement_notices', arguments: { limit: 1 } },
    });
    const wireResult = wire.payload?.result;
    const wireText = wireResult?.content?.[0]?.text ?? '(no text content)';
    readout(`deny-all · WHAT THE TOOL RETURNS [${r}]`,
      `HTTP ${wire.status} · isError=${wireResult?.isError} · text=${JSON.stringify(wireText.slice(0, 200))}`,
      `POST ${working.url}/mcp {"method":"tools/call","params":{"name":"nyc_record__get_procurement_notices",...}}`);

    const denyCall = await callSource();
    const { describeToolFailureForLlm, friendlyStreamError, classifyStreamError } = await import('../../src/lib/streaming.ts');
    const { isSourceRefusal } = await import('../../src/lib/mcp/tool-call-failure.ts');
    const thrown = denyCall.error;
    const llmText = thrown ? describeToolFailureForLlm('nyc_record__get_procurement_notices', thrown) : '(the call did not fail)';
    const readerText = thrown ? friendlyStreamError(thrown) : '(the call did not fail)';
    const kind = thrown ? classifyStreamError(thrown) : 'n/a';
    readout(`deny-all · WHAT THE CLIENT THROWS [${r}]`,
      `${denyCall.errorName}: ${JSON.stringify(denyCall.errorMessage)} · sourceRefusal=${thrown ? isSourceRefusal(thrown) : 'n/a'} · classified=${kind}`,
      "callMcpTool(...)  [src/lib/mcp/client.ts → throwIfErrorResult]");
    readout(`deny-all · WHAT REACHES THE MODEL [${r}]`, JSON.stringify(llmText),
      "describeToolFailureForLlm('nyc_record__get_procurement_notices', <thrown>)  [src/lib/streaming.ts]");
    readout(`deny-all · WHAT THE READER SEES [${r}]`, JSON.stringify(readerText),
      'friendlyStreamError(<thrown>)  [src/lib/streaming.ts]');

    summary.l1.push({
      reading: r,
      allowAll: { upstream: openUp.text, foreign: openForeign, sourceOk: openCall.ok, sourceMs: openCall.ms, sourceChars: openCall.chars ?? null },
      upstreamOnly: { upstream: allowUp.text, foreign: allowForeign, sourceOk: allowCall.ok, sourceMs: allowCall.ms, sourceChars: allowCall.chars ?? null, searchOk: allowSearch.ok, searchChars: allowSearch.chars ?? null },
      denyAll: { upstream: denyUp.text, dns: denyDns.text, sourceOk: denyCall.ok },
    });
    summary.l2.push({ reading: r, allowAll: tlsOpen.text, upstreamOnly: tlsAllow.text, caMaterial: caInv.text });
    summary.l5a.push({
      reading: r, wireHttpStatus: wire.status, wireIsError: wireResult?.isError ?? null, wireText,
      clientErrorName: denyCall.errorName, clientErrorMessage: denyCall.errorMessage,
      sourceRefusal: thrown ? isSourceRefusal(thrown) : null, classified: kind,
      toModel: llmText, toReader: readerText,
    });
    record({ measurement: 'L1', step: 'policy-cycle', reading: r, command: `${policyCommand(ALLOW_ALL_POLICY)} / ${policyCommand(UPSTREAM_ONLY_POLICY)} / ${policyCommand(DENY_ALL_POLICY)}`, ...summary.l1.at(-1) });
    record({ measurement: 'L2', step: 'tls-chain', reading: r, command: probeCommand('tls', UPSTREAM_HOST), ...summary.l2.at(-1) });
    record({ measurement: 'L5a', step: 'blocked-upstream', reading: r, command: 'callMcpTool under deny-all, then the two formatters', ...summary.l5a.at(-1) });

    // Leave the VM in the state the next phase needs.
    await sandbox.updateNetworkPolicy(UPSTREAM_ONLY_POLICY);
    await sleep(1500);
  }

  // ================================================= L4(c) warm and CPU ====
  enterPhase('L4(c) warm calls, memory, guest CPU');
  section(`L4(c) — WARM CALL with a real upstream in the path  (x${WARM_CALLS}, ${REPEATS} rounds)`);
  for (let r = 1; r <= REPEATS; r++) {
    const series = [];
    for (let k = 0; k < WARM_CALLS; k++) {
      const c = await callSource();
      series.push(c.ok ? c.ms : NaN);
    }
    const sorted = [...series].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    readout(`warm round ${r}`, `${series.join(', ')} ms  (median ${median} ms)`,
      `${WARM_CALLS}x callMcpTool('nyc_record__get_procurement_notices', { limit: 1 }) on the live session, policy ${JSON.stringify(UPSTREAM_ONLY_POLICY)}`);
    summary.l4.warm.push({ round: r, seriesMs: series, medianMs: median });
    record({ measurement: 'L4', step: 'warm-series', round: r, command: `${WARM_CALLS}x callMcpTool('nyc_record__get_procurement_notices')`, seriesMs: series, medianMs: median });
  }

  section('L4(c) — RESIDENT MEMORY');
  for (let r = 1; r <= REPEATS; r++) {
    const m = await fetch(`${working.url.replace(/\/$/, '')}/metrics`, { headers: { Authorization: `Bearer ${working.token}` } });
    const metrics = await m.json();
    const free = await sandbox.runCommand({ cmd: 'free', args: ['-m'] });
    const freeOut = (await free.stdout()).split('\n').find((l) => /^Mem:/.test(l))?.replace(/\s+/g, ' ').trim() ?? 'n/a';
    readout(`bridge RSS [${r}]`, `${(metrics.bridgeRssKb / 1024).toFixed(0)} MB`, `GET ${working.url}/metrics`);
    readout(`nyc-record child RSS [${r}]`, metrics.childRssKb ? `${(metrics.childRssKb / 1024).toFixed(0)} MB` : 'n/a', `GET ${working.url}/metrics`);
    readout(`VM memory [${r}]`, freeOut, 'free -m');
    summary.l4.memory.push({ reading: r, bridgeRssKb: metrics.bridgeRssKb, childRssKb: metrics.childRssKb, free: freeOut, counters: metrics.counters });
    record({ measurement: 'L4', step: 'memory', reading: r, command: `GET ${working.url}/metrics · free -m`, bridgeRssKb: metrics.bridgeRssKb, childRssKb: metrics.childRssKb, free: freeOut });
  }

  section(`L4(c) — GUEST CPU PER CALL  (${REPEATS} × (${CPU_CALLS} calls, then an equal idle window))`);
  log('  NOTE: every one of these calls crosses the public internet to the city service,');
  log('  so unlike the warm-VM spike this number includes the CPU of a real TLS round trip.');
  try {
    const read = async () => {
      const r = await sandbox.runCommand({ cmd: 'sh', args: ['-c', GUEST_CPU_COMMAND] });
      return parseGuestCpu(await r.stdout());
    };
    let a = await read();
    for (let reading = 1; reading <= REPEATS; reading++) {
      const t0 = Date.now();
      let failed = 0;
      for (let k = 0; k < CPU_CALLS; k++) {
        const c = await callSource();
        if (!c.ok) failed += 1;
      }
      const b = await read();
      const callWallMs = Date.now() - t0;
      const t1 = Date.now();
      await sleep(callWallMs);
      const c = await read();
      const idleWallMs = Date.now() - t1;
      const m = perCallGuestCpu({ callWin: { start: a, end: b, wallMs: callWallMs }, idleWin: { start: b, end: c, wallMs: idleWallMs }, calls: CPU_CALLS });
      readout(`guest CPU per call, VM-wide [${reading}]`,
        `${m.vm.perCallMs.toFixed(2)} ms   (${m.vm.inCalls} busy ticks over ${callWallMs} ms of calls; ${m.vm.inIdle} over ${idleWallMs} ms idle; 1 tick = ${m.tickMs} ms; ${failed} call(s) failed)`,
        `sh -c '${GUEST_CPU_COMMAND}'  [/proc/stat user+nice+system+irq+softirq+steal]`);
      readout(`guest CPU per call, node processes [${reading}]`,
        `${m.node.perCallMs.toFixed(2)} ms   (${m.node.inCalls} ticks in calls, ${m.node.inIdle} idle; pids ${m.nodePids.join(',')}${m.pidsStable ? '' : ' — PIDS CHANGED, reading invalid'})`,
        'same command  [utime+stime of every node process]');
      readout(`wall clock per call [${reading}]`, `${(callWallMs / CPU_CALLS).toFixed(1)} ms`, `${CPU_CALLS} calls / ${callWallMs} ms`);
      summary.l4.guestCpu.push({ reading, calls: CPU_CALLS, callWallMs, idleWallMs, failedCalls: failed, wallPerCallMs: callWallMs / CPU_CALLS, ...m });
      record({ measurement: 'L4', step: 'guest-cpu-per-call', reading, command: GUEST_CPU_COMMAND, calls: CPU_CALLS, callWallMs, idleWallMs, failedCalls: failed, ...m });
      a = c;
    }
  } catch (e) {
    summary.l4.guestCpuError = `${e?.name}: ${e?.message}`;
    log(`  NOT RESOLVED — the guest CPU measurement failed: ${summary.l4.guestCpuError}`);
  }

  // The working VM's own billed counter, read after it stops.
  const workingCpu = await stopAndReadCpu(sandbox);
  readout('working VM billed active CPU', `${workingCpu} ms (whole life: boot, install, every phase above)`,
    'sandbox.stop({blocking:true}) then Sandbox.get(id).activeCpuUsageMs');

  // ================================================== L3 the source secret ===
  enterPhase('L3 the source secret');
  section(`L3 — THE SOURCE'S SECRET: supplied to the machine only  (x${REPEATS})`);
  log(`  SOCRATA_APP_TOKEN reaches the VM ONLY through Sandbox.create({ env }). It was removed`);
  log(`  from this process's environment at startup, before any phase ran.`);
  log(`  in this process now: ${process.env.SOCRATA_APP_TOKEN ? 'PRESENT — CONTAINMENT BROKEN' : 'ABSENT (deleted after handoff)'}`);
  log(`  token in use: ${APP_TOKEN_IS_DECOY ? 'a unique DECOY (no operator token was supplied)' : 'the operator-supplied value'}`);
  log(`  NOTE, read out of the package: it sends the token as the "$$app_token" QUERY-STRING`);
  log(`  parameter of every request (dist/city-record.js buildUrl), not as a header.`);
  for (let r = 1; r <= REPEATS; r++) {
    const p = await provisionFresh({ appToken: APP_TOKEN });
    await p.sandbox.updateNetworkPolicy(UPSTREAM_ONLY_POLICY);
    await sleep(1000);
    const inside = await probe(p.sandbox, 'secret');
    readout(`inside the machine [${r}]`, inside.text.split('\n').join('  |  '), probeCommand('secret'));

    const c = await bindAppClient(p.url, p.token);
    let call;
    try {
      const outText = await c.callMcpTool('nyc_record__get_procurement_notices', { limit: 1 });
      call = { ok: true, chars: outText.length, sample: outText.slice(0, 200).replace(/\s+/g, ' ') };
    } catch (e) {
      call = { ok: false, errorName: e?.name, errorMessage: e?.message };
    }
    readout(`does the upstream accept it [${r}]`,
      call.ok ? `YES — ${call.chars} chars returned` : `NO — ${call.errorName}: ${call.errorMessage}`,
      "callMcpTool('nyc_record__get_procurement_notices', { limit: 1 })  with SOCRATA_APP_TOKEN set in the VM");

    const hostSide = {
      inThisProcess: Boolean(process.env.SOCRATA_APP_TOKEN),
      inAppRegistryEnv: Boolean(process.env.SOCRATA_APP_TOKEN),
      readByAppSource: null,   // filled once, below
    };
    readout(`in this process [${r}]`, hostSide.inThisProcess ? 'PRESENT — CONTAINMENT BROKEN' : 'ABSENT', 'process.env.SOCRATA_APP_TOKEN');
    summary.l3.push({ reading: r, sandboxId: p.sandbox.sandboxId, inside: inside.text, upstreamAccepted: call.ok, upstreamError: call.errorMessage ?? null, ...hostSide });
    record({ measurement: 'L3', step: 'secret-containment', reading: r, command: probeCommand('secret'), sandboxId: p.sandbox.sandboxId, inside: inside.text, upstreamAccepted: call.ok, upstreamError: call.errorMessage ?? null, ...hostSide });
    await stopAndReadCpu(p.sandbox);
  }

  // Does anything in the app's own source read this name at all?
  const appReads = (await import('node:child_process')).execSync(
    "git grep -n 'SOCRATA_APP_TOKEN' -- src/ || true", { cwd: process.cwd(), encoding: 'utf8' },
  ).trim();
  readout('does the app read this name?', appReads ? appReads.split('\n').join(' | ') : 'no match in src/ — the app never reads it',
    "git grep -n 'SOCRATA_APP_TOKEN' -- src/");
  summary.l3AppReads = appReads || null;

  // ============================================================ cost =======
  enterPhase('cost arithmetic');
  section("L4 — IDLE-STOP ARITHMETIC, recomputed from THESE figures");
  const cpuReadings = summary.l4.guestCpu;
  const cpuPerCallMs = cpuReadings.length ? cpuReadings.reduce((a, c) => a + c.vm.perCallMs, 0) / cpuReadings.length : null;
  const wallPerCallMs = cpuReadings.length ? cpuReadings.reduce((a, c) => a + c.wallPerCallMs, 0) / cpuReadings.length : null;
  const resumeMs = summary.l4.resume.length ? summary.l4.resume.reduce((a, c) => a + c.totalToToolResultMs, 0) / summary.l4.resume.length : null;
  const freshMs = summary.l4.fresh.length ? summary.l4.fresh.reduce((a, c) => a + c.totalToToolResultMs, 0) / summary.l4.fresh.length : null;
  // Boot CPU: the billed counter from the two resume VMs, which did a boot and
  // one call each and nothing else. Reported as measured, noise included.
  const resumeCpu = summary.l4.resume.map((r) => stoppedCpu[r.sandboxId]).filter((v) => typeof v === 'number');
  const bootCpuMs = resumeCpu.length ? resumeCpu.reduce((a, b) => a + b, 0) / resumeCpu.length : null;
  const gb = SANDBOX_MEMORY_MB / 1024;
  const money = (x) => (x == null ? 'n/a' : x < 0.01 ? `$${x.toFixed(6)}` : `$${x.toFixed(4)}`);

  log(`  rates: $${RATE_ACTIVE_CPU_HR}/active-CPU-hour · $${RATE_GB_HR}/GB-hour · $0.60/million creations`);
  log(`  shape: ${SANDBOX_VCPUS} vCPU, ${SANDBOX_MEMORY_MB} MB (${gb} GB)`);
  log(`  measured: wake ${resumeMs == null ? 'n/a' : (resumeMs / 1000).toFixed(1)} s from snapshot, ${freshMs == null ? 'n/a' : (freshMs / 1000).toFixed(1)} s fresh`);
  log(`  measured: guest CPU ${cpuPerCallMs == null ? 'n/a' : cpuPerCallMs.toFixed(2)} ms/call, wall ${wallPerCallMs == null ? 'n/a' : wallPerCallMs.toFixed(0)} ms/call`);
  log(`  measured: billed active CPU over a boot + 1 call = ${resumeCpu.length ? resumeCpu.join(', ') + ' ms' : 'n/a'}`);

  const perCallCpuCost = cpuPerCallMs == null ? null : (cpuPerCallMs / 3_600_000) * RATE_ACTIVE_CPU_HR;
  const perBootCost = bootCpuMs == null ? null : (bootCpuMs / 3_600_000) * RATE_ACTIVE_CPU_HR + RATE_PER_CREATION;
  const wakeWindowCost = gb * RATE_GB_HR * (60 / 3600);
  const keptWarmMonth = gb * RATE_GB_HR * 24 * 30;
  const idleStopMonthly = {};
  log('\n  IDLE-STOP (one wake per question, stops after):');
  log(`    per wake  = boot CPU ${bootCpuMs == null ? 'n/a' : (bootCpuMs / 1000).toFixed(1) + 's'} × $${RATE_ACTIVE_CPU_HR}/h + one creation = ${money(perBootCost)}`);
  log(`    per call  = ${cpuPerCallMs == null ? 'n/a' : cpuPerCallMs.toFixed(2) + 'ms'} × $${RATE_ACTIVE_CPU_HR}/h = ${money(perCallCpuCost)}`);
  log(`    memory is billed only while running; a 60s wake window = ${money(wakeWindowCost)}`);
  for (const q of [100, 1000, 10000]) {
    const c = (perBootCost ?? 0) + (perCallCpuCost ?? 0) + wakeWindowCost;
    idleStopMonthly[q] = q * c;
    log(`    ${String(q).padStart(5)} questions/month, one 60s wake each = ${money(q * c)}`);
  }
  log('\n  KEPT WARM (left running):');
  log(`    memory    = ${gb} GB × $${RATE_GB_HR}/GB-h × 24 × 30 = ${money(keptWarmMonth)} / month`);
  log(`    CPU       = ${cpuPerCallMs == null ? 'n/a' : cpuPerCallMs.toFixed(2) + 'ms/call'}; 10,000 calls = ${money(perCallCpuCost == null ? null : 10000 * perCallCpuCost)}`);
  log(`    TOTAL at 10,000 calls/month = ${money(keptWarmMonth + 10000 * (perCallCpuCost ?? 0) + RATE_PER_CREATION)} / month`);
  summary.cost = {
    rates: { activeCpuHour: RATE_ACTIVE_CPU_HR, gbHour: RATE_GB_HR, perCreation: RATE_PER_CREATION },
    cpuPerCallMs, wallPerCallMs, bootCpuMs, resumeCpuReadings: resumeCpu, gb,
    avgFreshMs: freshMs, avgResumeMs: resumeMs,
    perWakeUsd: perBootCost, perCallUsd: perCallCpuCost, wakeWindow60sUsd: wakeWindowCost,
    idleStopMonthlyUsd: idleStopMonthly, keptWarmMonthUsd: keptWarmMonth,
  };
  record({ measurement: 'L4', step: 'cost', command: "Vercel's published rates applied to this run's readings", ...summary.cost });

  phase = 'complete';
} catch (err) {
  failure = err;
} finally {
  await finalize();
}

// --------------------------------------------------------------- finalize ---
function finalize() {
  if (!finalizing) finalizing = finalizeOnce();
  return finalizing;
}

/**
 * Scan this run's own output files for two literals: the source's secret (which
 * must appear zero times) and the canary (which must appear at least once).
 *
 * The canary is the instrument check. A scanner pointed at the wrong paths, or
 * one whose read threw and was swallowed, reports zero for the token and looks
 * like a clean result; it cannot also report a non-zero count for a string that
 * was definitely written. Neither literal is ever printed back out — the counts
 * are the whole output.
 */
function leakScan(paths) {
  const results = [];
  for (const p of paths) {
    let text;
    try { text = fs.readFileSync(p, 'utf8'); }
    catch (e) { results.push({ file: p, readable: false, why: e.message, tokenHits: null, canaryHits: null }); continue; }
    const count = (needle) => (needle ? text.split(needle).length - 1 : 0);
    results.push({ file: path.basename(p), readable: true, bytes: text.length, tokenHits: count(APP_TOKEN), canaryHits: count(CANARY) });
  }
  return results;
}

async function finalizeOnce() {
  await teardown();
  if (snapshotRef) {
    try { await snapshotRef.delete(); summary.snapshotDeleted = true; }
    catch (e) { summary.snapshotDeleted = `FAILED: ${e?.message}`; }
  }
  summary.runStartMs = runStartMs;
  summary.recordedIds = [...recordedIds];
  summary.creations = creations;
  summary.billedActiveCpuMsByVm = stoppedCpu;
  const sp = jsonl ? writeSummary(RUN_ID, summary) : '(not written)';

  section(failure ? 'KEY NUMBERS (run did NOT complete — see STOPPED AT below)' : 'KEY NUMBERS');
  keyLine('  subject', `${RECORD_PACKAGE} → ${UPSTREAM_HOST}`);
  keyLine('  bridge port / signature', `${BRIDGE_PORT} / ${JSON.stringify(OUR_SIGNATURE)}`);
  keyLine('  sandboxes created', `${creations} (cap ${MAX_CREATIONS})`);
  for (const f of summary.l4.fresh) keyLine(`  L4 fresh boot [${f.reading}]`, `${(f.totalToToolResultMs / 1000).toFixed(1)} s (install ${Math.round(f.installMs)} ms, first call ${Math.round(f.firstToolResultMs)} ms)`);
  for (const f of summary.l4.resume) keyLine(`  L4 resume [${f.reading}]`, `${(f.totalToToolResultMs / 1000).toFixed(1)} s (create ${Math.round(f.createMs)} ms, ready ${Math.round(f.readyMs)} ms, first call ${Math.round(f.firstToolResultMs)} ms)`);
  for (const w of summary.l4.warm) keyLine(`  L4 warm call [${w.round}]`, `median ${w.medianMs} ms of ${w.seriesMs.length}: ${w.seriesMs.join(', ')} ms`);
  for (const g of summary.l4.guestCpu) keyLine(`  L4 guest CPU/call [${g.reading}]`, `${g.vm.perCallMs.toFixed(2)} ms VM-wide, ${g.node.perCallMs.toFixed(2)} ms node; wall ${g.wallPerCallMs.toFixed(0)} ms`);
  for (const m of summary.l4.memory) keyLine(`  L4 memory [${m.reading}]`, `bridge ${(m.bridgeRssKb / 1024).toFixed(0)} MB + child ${m.childRssKb ? (m.childRssKb / 1024).toFixed(0) + ' MB' : 'n/a'} | ${m.free}`);
  if (summary.l4.installedSize) keyLine('  L4 installed size', summary.l4.installedSize.split('\n').join(' | '));
  if (summary.l4.snapshot) keyLine('  L4 snapshot', `${(summary.l4.snapshot.sizeBytes / 1e6).toFixed(0)} MB in ${(summary.l4.snapshot.ms / 1000).toFixed(1)} s (deleted: ${summary.snapshotDeleted})`);
  for (const r of summary.l1) {
    keyLine(`  L1 allow-all [${r.reading}]`, `${r.allowAll.upstream}; ${r.allowAll.foreign.join('; ')}; source ${r.allowAll.sourceOk ? 'ANSWERED' : 'FAILED'}`);
    keyLine(`  L1 upstream-only [${r.reading}]`, `${r.upstreamOnly.upstream}; ${r.upstreamOnly.foreign.join('; ')}; source ${r.upstreamOnly.sourceOk ? 'ANSWERED' : 'FAILED'}`);
    keyLine(`  L1 deny-all [${r.reading}]`, `${r.denyAll.upstream}; source ${r.denyAll.sourceOk ? 'ANSWERED — ISOLATION FAILED' : 'FAILED (as it must)'}`);
  }
  for (const r of summary.l2) {
    keyLine(`  L2 TLS allow-all [${r.reading}]`, r.allowAll);
    keyLine(`  L2 TLS upstream-only [${r.reading}]`, r.upstreamOnly);
  }
  for (const r of summary.l3) {
    keyLine(`  L3 inside the VM [${r.reading}]`, r.inside.split('\n').join(' | '));
    keyLine(`  L3 in this process [${r.reading}]`, r.inThisProcess ? 'PRESENT — CONTAINMENT BROKEN' : 'ABSENT');
    keyLine(`  L3 upstream accepted [${r.reading}]`, r.upstreamAccepted ? 'yes' : `no — ${r.upstreamError}`);
  }
  if (summary.l3AppReads !== undefined) keyLine('  L3 app reads the name?', summary.l3AppReads || 'no match in src/');
  for (const r of summary.l5a) {
    keyLine(`  L5a tool returns [${r.reading}]`, `HTTP ${r.wireHttpStatus} isError=${r.wireIsError} ${JSON.stringify(String(r.wireText).slice(0, 90))}`);
    keyLine(`  L5a client throws [${r.reading}]`, `${r.clientErrorName} (sourceRefusal=${r.sourceRefusal}, classified=${r.classified})`);
    keyLine(`  L5a to the model [${r.reading}]`, JSON.stringify(r.toModel));
    keyLine(`  L5a to the reader [${r.reading}]`, JSON.stringify(r.toReader));
  }
  if (summary.cost) {
    keyLine('  per wake (boot + 1 creation)', summary.cost.perWakeUsd == null ? 'n/a' : `$${summary.cost.perWakeUsd.toFixed(6)}`);
    keyLine('  idle-stop, 1k q/mo @60s wake', summary.cost.idleStopMonthlyUsd[1000] == null ? 'n/a' : `$${summary.cost.idleStopMonthlyUsd[1000].toFixed(4)} / month`);
    keyLine('  idle-stop, 10k q/mo @60s wake', summary.cost.idleStopMonthlyUsd[10000] == null ? 'n/a' : `$${summary.cost.idleStopMonthlyUsd[10000].toFixed(4)} / month`);
    keyLine('  kept warm (memory alone)', `$${summary.cost.keptWarmMonthUsd.toFixed(2)} / month for ${summary.cost.gb} GB`);
  }
  keyLine('  billed active CPU by VM', JSON.stringify(stoppedCpu));

  log(`\n  log:          ${LOG_PATH}`);
  log(`  observations: ${jsonl}`);
  log(`  summary:      ${sp}`);

  // ------------------------------------------------------------ leak scan ---
  // Last, so it reads everything the run wrote. Its own two lines carry neither
  // literal, so scanning after printing them would change nothing.
  const scan = leakScan([LOG_PATH, jsonl, sp].filter((p) => p && p !== '(not written)'));
  summary.leakScan = scan;
  section('LEAK SCAN — the source secret must appear 0 times; the canary must appear at least once');
  for (const s of scan) {
    log(`  ${String(s.file).padEnd(46)} ${s.readable ? `${s.bytes} bytes · token ${s.tokenHits} · canary ${s.canaryHits}` : `UNREADABLE (${s.why})`}`);
  }
  const tokenTotal = scan.reduce((a, s) => a + (s.tokenHits ?? 0), 0);
  const canaryTotal = scan.reduce((a, s) => a + (s.canaryHits ?? 0), 0);
  const scanValid = canaryTotal > 0;
  log(`  RESULT: token occurrences ${tokenTotal}; canary occurrences ${canaryTotal} — ` +
    (!scanValid ? 'SCAN INVALID: the canary was not found, so a zero token count proves nothing.'
      : tokenTotal === 0 ? 'the secret is in none of this run’s output files, and the scan can see what is in them.'
        : 'LEAK: the secret appears in this run’s output.'));
  // Re-write the summary so the scan result is in it too (the scan itself
  // carries no literal, so this cannot introduce what it just looked for).
  if (jsonl) writeSummary(RUN_ID, summary);

  const { notOursLine, strayLine, sinceIso } = await ownershipStrayCheck({
    auth: resolveAuth(), recordedIds, runStartMs, signature: OUR_SIGNATURE,
  });
  section(failure ? 'INCOMPLETE' : 'DONE');
  if (failure) {
    log(`  STOPPED AT: ${phase}`);
    log(`  REASON:     ${failure?.name}: ${failure?.message}`);
    if (failure?.stack) log(`  ${failure.stack.split('\n').slice(1, 4).join('\n  ')}`);
  }
  log(`  sandboxes created: ${creations} of a ${MAX_CREATIONS} cap`);
  log(`  run start (API clock): ${sinceIso}   recorded ids: ${recordedIds.size}`);
  log(`  signature used for the claim: runtime ${OUR_SIGNATURE.runtime} + route on port ${OUR_SIGNATURE.port}`);
  log(`  ${notOursLine}`);
  log(`  ${strayLine}`);
  if (failure || strayLine !== 'STRAYS: 0' || !scanValid || tokenTotal !== 0) process.exitCode = 1;
}
