#!/usr/bin/env node
/**
 * POC MCP-LIVE-SOURCE — L1's loose end, measured properly. ONE sandbox.
 *
 * WHY THIS RUN EXISTS. `run-live-source.mjs` cycled the network policy twice
 * and got two DIFFERENT answers to the same question. Under `deny-all`:
 *
 *   reading 1 — a fresh process in the VM got ENOTFOUND, and the source
 *               ANSWERED anyway, with live rows.
 *   reading 2 — a fresh process got ENOTFOUND, and the source FAILED.
 *
 * "Sometimes" is not an answer a manifest can carry, and it is the difference
 * between a network policy that contains a live source and one that only looks
 * like it does. The hypothesis the two readings suggest: the policy removes
 * NAME RESOLUTION, so a process that has already resolved the upstream and is
 * holding an open pooled socket keeps using it, and only loses it when the pool
 * closes that socket (undici's keep-alive idle timeout). A newly spawned
 * process has no pool, which is why every probe said ENOTFOUND while the
 * long-lived server kept answering.
 *
 * WHAT THIS MEASURES, and the shape that makes each answer able to fail:
 *
 *   A. WARM — call the source, then block, then keep calling on a fixed
 *      cadence and record the first call that fails and how long after the
 *      block it was. If the hypothesis is right this is a positive number of
 *      seconds, not zero; if the block were immediate it would be the first
 *      call. Either result is legible.
 *
 *   B. COLD — block first, then kill the upstream server so the bridge
 *      respawns it with no pool at all, then call once. This must fail
 *      immediately. It is the control: without it, "the warm one failed
 *      eventually" could equally be the upstream rate-limiting us.
 *
 *   C. IDLE-THEN-BLOCK — let the pool go idle past the failure time A found,
 *      THEN block, then call. Must fail on the first call.
 *
 * Each is driven twice. B also yields the second clean reading of L5(a): the
 * refusal on the wire, what `client.ts` throws, what reaches the model and what
 * the reader sees — `run-live-source.mjs` only got one, because its first
 * deny-all reading never failed.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.POC_RESULTS_DIR ||= path.join(process.cwd(), 'temp', 'mcp-live-source-poc');
const {
  openResults, record, writeSummary, section, readout, elapsed, log,
  silenceAppClientLogs, keyLine, teeOutputTo, RESULTS_DIR, sleep,
} = await import('../poc-warm-vm/lib.mjs');
const OPS = await import('./sandbox-ops.mjs');
const {
  createFresh, installRecordServer, writeBridge, writeProbe, startBridge, waitForReady,
  resolveAuth, probe, probeCommand, policyCommand, listAllSandboxes, ownershipStrayCheck,
  CREATE_FRESH_COMMAND, INSTALL_COMMAND, READY_COMMAND,
  BRIDGE_PORT, RECORD_PACKAGE, UPSTREAM_HOST, OUR_SIGNATURE,
  UPSTREAM_ONLY_POLICY, DENY_ALL_POLICY,
} = OPS;

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_PATH = teeOutputTo(path.join(RESULTS_DIR, `block-timing-${RUN_ID}.log`));
silenceAppClientLogs();

const REPEATS = Number(process.env.POC_REPEATS || 2);
/** How long to keep calling after a block before giving up on it ever biting. */
const WATCH_MS = Number(process.env.POC_WATCH_MS || 120_000);
/** Seconds between calls in the watch. */
const CADENCE_MS = Number(process.env.POC_CADENCE_MS || 2000);

const live = [];
const recordedIds = new Set();
let runStartMs = null;
let jsonl = null;
let failure = null;
let finalizing = null;
let phase = 'startup';
const summary = { runId: RUN_ID, kind: 'block-timing', package: RECORD_PACKAGE, upstreamHost: UPSTREAM_HOST, bridgePort: BRIDGE_PORT, warm: [], cold: [], idleThenBlock: [] };

async function teardown() {
  for (const s of [...live]) {
    try { await s.stop({ blocking: true }); live.splice(live.indexOf(s), 1); } catch { /* the stray check reports it */ }
  }
}
let sigints = 0;
process.on('SIGINT', async () => {
  sigints += 1;
  if (sigints > 1) {
    console.log(`\n  SIGINT again — exiting WITHOUT cleanup. Find anything left behind with:\n    node scripts/poc-warm-vm/stop-strays.mjs --port ${BRIDGE_PORT} --since ${runStartMs ? new Date(runStartMs).toISOString() : '<run start>'}`);
    process.exit(130);
  }
  if (!failure) failure = new Error(`interrupted by SIGINT during phase "${phase}"`);
  await finalize();
  process.exit(130);
});

section('STEP 0 — sandbox auth (read-only; nothing is created until it passes)');
log(`  log: ${LOG_PATH}`);
log(`  subject: ${RECORD_PACKAGE} → ${UPSTREAM_HOST}   bridge port ${BRIDGE_PORT}`);
const auth = resolveAuth();
try {
  const listing = await listAllSandboxes(auth);
  runStartMs = listing.serverNowMs;
  readout('sandbox API', `OK — ${listing.rows.length} in scope, ${listing.rows.filter((r) => r.status === 'running').length} running`, 'listAllSandboxes(auth)  [every page]');
  readout('run start (API clock)', new Date(runStartMs).toISOString(), 'HTTP Date header of that listing');
} catch (e) {
  log(`\n  FAIL — the sandbox API did not authenticate: ${e?.name}: ${e?.message}\n  Nothing was created.\n\n  STRAYS: none possible — nothing was created`);
  process.exit(1);
}
jsonl = openResults(RUN_ID);
log(`  observations -> ${jsonl}`);

try {
  phase = 'boot';
  section('BOOT — one sandbox');
  const token = randomUUID();
  const created = await elapsed(() => createFresh(token));
  const sandbox = created.value;
  live.push(sandbox); recordedIds.add(sandbox.sandboxId);
  const url = sandbox.domain(BRIDGE_PORT);
  readout('create', `${created.ms.toFixed(0)} ms — ${sandbox.sandboxId}`, CREATE_FRESH_COMMAND);
  await writeBridge(sandbox); await writeProbe(sandbox);
  const installed = await elapsed(() => installRecordServer(sandbox));
  readout('install', `${installed.ms.toFixed(0)} ms`, INSTALL_COMMAND);
  await startBridge(sandbox);
  const ready = await elapsed(() => waitForReady(url, token));
  readout('bridge ready', `${ready.ms.toFixed(0)} ms`, READY_COMMAND(url));

  process.env.NYC_RECORD_MCP_URL = url;
  process.env.NYC_RECORD_MCP_TOKEN = token;
  const client = await import('../../src/lib/mcp/client.ts?blocktiming=1');
  const { describeToolFailureForLlm, friendlyStreamError, classifyStreamError } = await import('../../src/lib/streaming.ts');
  const { isSourceRefusal } = await import('../../src/lib/mcp/tool-call-failure.ts');

  async function call() {
    const t0 = Date.now();
    try {
      const outText = await client.callMcpTool('nyc_record__get_procurement_notices', { limit: 1 });
      return { ok: true, ms: Date.now() - t0, chars: outText.length };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, name: e?.name, message: e?.message, error: e };
    }
  }

  const KILL_CHILD = 'pkill -f nyc-record-mcp; sleep 1; echo child-killed';
  async function killUpstreamChild() {
    const r = await sandbox.runCommand({ cmd: 'sh', args: ['-c', KILL_CHILD] });
    return ((await r.stdout()) + (await r.stderr())).trim();
  }

  // ------------------------------------------------------------- A. WARM ---
  phase = 'A warm source under deny-all';
  section(`A — A WARM SOURCE UNDER deny-all: how long does it keep answering?  (x${REPEATS})`);
  log(`  Each reading: open the policy, make a call (which fills the connection pool),`);
  log(`  block, then call every ${CADENCE_MS} ms for up to ${WATCH_MS / 1000}s and record the first failure.`);
  for (let r = 1; r <= REPEATS; r++) {
    await sandbox.updateNetworkPolicy(UPSTREAM_ONLY_POLICY);
    await sleep(3000);
    const warmUp = await call();
    if (!warmUp.ok) { log(`  reading ${r}: could not warm the pool — ${warmUp.name}: ${warmUp.message}`); continue; }
    await sandbox.updateNetworkPolicy(DENY_ALL_POLICY);
    const blockedAt = Date.now();
    const probeText = (await probe(sandbox, 'outbound', UPSTREAM_HOST)).text;
    const series = [];
    let firstFailureMs = null;
    while (Date.now() - blockedAt < WATCH_MS) {
      const c = await call();
      const since = Date.now() - blockedAt;
      series.push({ sinceBlockMs: since, ok: c.ok, ms: c.ms, name: c.name ?? null });
      if (!c.ok) { firstFailureMs = since; break; }
      await sleep(CADENCE_MS);
    }
    readout(`warm [${r}] fresh process in the VM`, probeText, probeCommand('outbound', UPSTREAM_HOST));
    readout(`warm [${r}] calls after the block`,
      series.map((s) => `${(s.sinceBlockMs / 1000).toFixed(1)}s:${s.ok ? 'OK' : 'FAIL'}`).join(' '),
      `${policyCommand(DENY_ALL_POLICY)} then callMcpTool('nyc_record__get_procurement_notices', { limit: 1 }) every ${CADENCE_MS} ms`);
    readout(`warm [${r}] FIRST FAILURE`,
      firstFailureMs == null ? `NONE within ${WATCH_MS / 1000}s — the source answered ${series.length} times through a deny-all policy`
        : `${(firstFailureMs / 1000).toFixed(1)} s after the block (${series.filter((s) => s.ok).length} successful calls through it)`,
      'the same series');
    summary.warm.push({ reading: r, probeText, series, firstFailureMs, successfulCallsThroughBlock: series.filter((s) => s.ok).length });
    record({ measurement: 'L1b', step: 'warm-under-deny-all', reading: r, command: `${policyCommand(DENY_ALL_POLICY)} then repeated callMcpTool`, ...summary.warm.at(-1) });
  }

  // ------------------------------------------------------------- B. COLD ---
  phase = 'B cold source under deny-all';
  section(`B — A COLD SOURCE UNDER deny-all: the control, and L5(a)'s second reading  (x${REPEATS})`);
  log('  The upstream server is killed while the block is in force, so the bridge');
  log('  respawns it with an empty connection pool. If A is about a pooled socket,');
  log('  this must fail on its first call every time.');
  for (let r = 1; r <= REPEATS; r++) {
    await sandbox.updateNetworkPolicy(DENY_ALL_POLICY);
    await sleep(2000);
    const killed = await killUpstreamChild();
    readout(`cold [${r}] respawn the upstream server`, killed, `sandbox.runCommand({ cmd:'sh', args:['-c','${KILL_CHILD}'] })  — bridge.mjs ensureChild() respawns it`);
    const c = await call();
    const thrown = c.error;
    readout(`cold [${r}] first call`, c.ok ? `ANSWERED ${c.chars} chars — the control did not hold` : `FAILED in ${c.ms} ms`,
      "callMcpTool('nyc_record__get_procurement_notices', { limit: 1 })");
    if (!c.ok) {
      readout(`cold [${r}] WHAT THE CLIENT THROWS`, `${c.name}: ${JSON.stringify(c.message)} · sourceRefusal=${isSourceRefusal(thrown)} · classified=${classifyStreamError(thrown)}`,
        'src/lib/mcp/client.ts → throwIfErrorResult');
      readout(`cold [${r}] WHAT REACHES THE MODEL`, JSON.stringify(describeToolFailureForLlm('nyc_record__get_procurement_notices', thrown)), 'describeToolFailureForLlm(...)');
      readout(`cold [${r}] WHAT THE READER SEES`, JSON.stringify(friendlyStreamError(thrown)), 'friendlyStreamError(...)');
    }
    summary.cold.push({
      reading: r, killed, ok: c.ok, ms: c.ms, name: c.name ?? null, message: c.message ?? null,
      sourceRefusal: thrown ? isSourceRefusal(thrown) : null,
      classified: thrown ? classifyStreamError(thrown) : null,
      toModel: thrown ? describeToolFailureForLlm('nyc_record__get_procurement_notices', thrown) : null,
      toReader: thrown ? friendlyStreamError(thrown) : null,
    });
    record({ measurement: 'L5a', step: 'cold-under-deny-all', reading: r, command: 'kill the child, then callMcpTool under deny-all', ...summary.cold.at(-1) });
  }

  // --------------------------------------------------- C. IDLE THEN BLOCK ---
  phase = 'C idle, then block';
  section(`C — IDLE PAST THE POOL, THEN BLOCK: does the block bite on the first call?  (x${REPEATS})`);
  const idleMs = Number(process.env.POC_IDLE_MS || 20_000);
  log(`  Warm the pool, wait ${idleMs / 1000}s with no calls, then block and call once.`);
  for (let r = 1; r <= REPEATS; r++) {
    await sandbox.updateNetworkPolicy(UPSTREAM_ONLY_POLICY);
    await sleep(3000);
    await killUpstreamChild();               // start from a known-cold server
    const warmUp = await call();
    if (!warmUp.ok) { log(`  reading ${r}: could not warm — ${warmUp.name}: ${warmUp.message}`); continue; }
    await sleep(idleMs);
    await sandbox.updateNetworkPolicy(DENY_ALL_POLICY);
    await sleep(2000);
    const c = await call();
    readout(`idle-then-block [${r}]`, c.ok ? `ANSWERED ${c.chars} chars — still reaching through the block after ${idleMs / 1000}s idle` : `FAILED in ${c.ms} ms (${c.name})`,
      `warm, idle ${idleMs / 1000}s, ${policyCommand(DENY_ALL_POLICY)}, then one callMcpTool`);
    summary.idleThenBlock.push({ reading: r, idleMs, ok: c.ok, ms: c.ms, name: c.name ?? null });
    record({ measurement: 'L1b', step: 'idle-then-block', reading: r, command: `idle ${idleMs} ms then ${policyCommand(DENY_ALL_POLICY)}`, ...summary.idleThenBlock.at(-1) });
  }
  phase = 'complete';
} catch (err) {
  failure = err;
} finally {
  await finalize();
}

function finalize() {
  if (!finalizing) finalizing = finalizeOnce();
  return finalizing;
}

async function finalizeOnce() {
  await teardown();
  summary.runStartMs = runStartMs;
  summary.recordedIds = [...recordedIds];
  const sp = jsonl ? writeSummary(RUN_ID, summary) : '(not written)';

  section(failure ? 'KEY NUMBERS (run did NOT complete)' : 'KEY NUMBERS');
  for (const w of summary.warm) {
    keyLine(`  A warm [${w.reading}]`, w.firstFailureMs == null
      ? `NEVER failed within the watch — ${w.successfulCallsThroughBlock} calls answered through deny-all`
      : `first failure ${(w.firstFailureMs / 1000).toFixed(1)} s after the block; ${w.successfulCallsThroughBlock} calls answered through it`);
  }
  for (const c of summary.cold) {
    keyLine(`  B cold [${c.reading}]`, c.ok ? 'ANSWERED — the control did not hold' : `FAILED in ${c.ms} ms (${c.name}, refusal=${c.sourceRefusal}, ${c.classified})`);
    if (c.toReader) keyLine(`  B cold [${c.reading}] reader`, JSON.stringify(c.toReader));
  }
  for (const i of summary.idleThenBlock) {
    keyLine(`  C idle ${i.idleMs / 1000}s [${i.reading}]`, i.ok ? 'still ANSWERED through the block' : `FAILED in ${i.ms} ms (${i.name})`);
  }
  log(`\n  log:          ${LOG_PATH}`);
  log(`  observations: ${jsonl}`);
  log(`  summary:      ${sp}`);

  const { notOursLine, strayLine, sinceIso } = await ownershipStrayCheck({
    auth: resolveAuth(), recordedIds, runStartMs, signature: OUR_SIGNATURE,
  });
  section(failure ? 'INCOMPLETE' : 'DONE');
  if (failure) { log(`  STOPPED AT: ${phase}`); log(`  REASON:     ${failure?.name}: ${failure?.message}`); }
  log(`  run start (API clock): ${sinceIso}   recorded ids: ${recordedIds.size}`);
  log(`  signature used for the claim: runtime ${OUR_SIGNATURE.runtime} + route on port ${OUR_SIGNATURE.port}`);
  log(`  ${notOursLine}`);
  log(`  ${strayLine}`);
  if (failure || strayLine !== 'STRAYS: 0') process.exitCode = 1;
}
