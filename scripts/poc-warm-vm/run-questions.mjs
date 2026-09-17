#!/usr/bin/env node
/**
 * POC MCP-WARM-VM — the three Charter questions, alone.
 *
 * The record run (run-poc.mjs, 2026-09-17T16:18:29Z) measured M1–M4 but
 * skipped the questions: no model key reached the process, and it only found
 * out after booting eight VMs. This is the smallest run that finishes the
 * job:
 *
 *   0. Check the model endpoint and key are configured — a local check with
 *      no network call and no value printed — and the sandbox API
 *      authenticates. Either missing: exit 1 having created NOTHING.
 *   1. Boot ONE sandbox: fresh create, install the pinned package, start the
 *      bridge on port 3000, wait for ready. Then deny all outbound traffic
 *      and probe it, so every answer below comes from a VM that cannot reach
 *      the internet.
 *   2. Ask the three questions through runToolLoop(compareLoopOptions(...)) —
 *      the shipped loop and factory, the app's own client, the app's default
 *      model. The question text and system prompt are run-poc.mjs's, verbatim.
 *   3. On the same VM, measure per-call CPU from the guest kernel's own
 *      accounting (guest-cpu.mjs): 2 × (500 calls, then an idle window of
 *      the same wall length). No extra sandbox creation. Best-effort: a
 *      failure here is reported and does not fail the run.
 *   4. Stop the VM, then run the ownership-aware stray check (sandbox-ops.mjs
 *      ownershipStrayCheck): claims only recorded ids or the node22 + port
 *      3000 + created-after-start signature; everything else is NOT OURS.
 *
 * Writes its own log: temp/mcp-warm-vm-poc/questions-run-<runId>.log (the whole
 * terminal output), beside observations-<runId>.jsonl and summary-<runId>.json.
 * All three are git-ignored.
 *
 * SECRET HYGIENE: variables are reported by NAME, present/absent. The bridge
 * token is a per-run randomUUID() held in memory and never printed.
 *
 * Exit 0 only when all three questions returned an answer, the run completed,
 * and the last line is "STRAYS: 0".
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  openResults, record, writeSummary, section, readout, elapsed, log,
  silenceAppClientLogs, keyLine, teeOutputTo, RESULTS_DIR,
} from './lib.mjs';
import {
  createFresh, installCharter, writeBridge, startBridge, waitForReady, resolveAuth,
  listAllSandboxes, ownershipStrayCheck,
  CREATE_FRESH_COMMAND, INSTALL_COMMAND, START_BRIDGE_COMMAND, READY_COMMAND,
  BRIDGE_PORT, CHARTER_PACKAGE, SANDBOX_VCPUS, SANDBOX_MEMORY_MB,
} from './sandbox-ops.mjs';
import { GUEST_CPU_COMMAND, parseGuestCpu, perCallGuestCpu } from './guest-cpu.mjs';

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_PATH = teeOutputTo(path.join(RESULTS_DIR, `questions-run-${RUN_ID}.log`));
silenceAppClientLogs();

const CPU_CALLS = Number(process.env.POC_CPU_CALLS || 500);

// Verbatim from run-poc.mjs, so the record's questions are the ones asked.
const QUESTIONS = [
  'Under the New York City Charter, what must a city agency do before it can adopt a new rule? Cite the section.',
  'What does the NYC Charter say about who may serve on a community board, and what restriction applies to employees of council members?',
  'How current is the Charter text you are working from, and what does the Charter say about the powers of the Public Advocate?',
];
const SYSTEM_PROMPT =
  'You answer questions about New York City law using the nyc_charter__* tools, which serve the ' +
  'NYC Charter, Administrative Code and Rules of the City of New York from a pinned package. ' +
  'ALWAYS call nyc_charter__get_version first and state how current the text is. Cite every ' +
  'section you rely on. Never state a legal conclusion the retrieved text does not support.';
const OUTBOUND_PROBE = `node -e "fetch('https://registry.npmjs.org/-/ping').then(r=>console.log('OUTBOUND_REACHED status='+r.status)).catch(e=>console.log('OUTBOUND_BLOCKED '+(e.cause?.code||e.message)))"`;

// ------------------------------------------------------------------ state ---
const live = [];
const recordedIds = new Set();
let runStartMs = null;
let jsonl = null;
let phase = 'startup';
let failure = null;
let interrupted = false;
let finalizing = null;
const summary = {
  runId: RUN_ID, kind: 'questions-only', package: CHARTER_PACKAGE, vcpus: SANDBOX_VCPUS, memoryMb: SANDBOX_MEMORY_MB,
  boot: {}, outbound: null, model: null, questions: [], guestCpu: { readings: [] },
};

function enterPhase(name) {
  if (interrupted) throw new Error(`interrupted by SIGINT before phase "${name}"`);
  phase = name;
}

async function teardown() {
  for (const s of [...live]) {
    try { await s.stop({ blocking: true }); live.splice(live.indexOf(s), 1); } catch { /* reported by the stray check */ }
  }
}

let sigints = 0;
process.on('SIGINT', async () => {
  sigints += 1;
  if (sigints > 1) {
    const since = runStartMs ? new Date(runStartMs).toISOString() : '<run start>';
    console.log('\n  SIGINT again — exiting WITHOUT cleanup. Find anything left behind with:');
    console.log(`    node scripts/poc-warm-vm/stop-strays.mjs --since ${since}`);
    process.exit(130);
  }
  interrupted = true;
  if (!failure) failure = new Error(`interrupted by SIGINT during phase "${phase}"`);
  console.log('\n  SIGINT — stopping this run’s VM, then checking for strays. Ctrl-C again exits without cleanup.');
  await finalize();
  process.exit(130);
});

// ---------------------------------------------------------------- step 0 ---
section('STEP 0 — model endpoint, then sandbox auth (nothing is created until both pass)');
log(`  log: ${LOG_PATH}`);
for (const n of ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'MODEL_API_KIND', 'MODEL_API_BASE_URL', 'VERCEL_OIDC_TOKEN', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID']) {
  log(`  ${n}: ${process.env[n]?.trim() ? 'present' : 'absent'}   (name only — never the value)`);
}

const { getMissingModelCredentialError } = await import('../../src/lib/model-client.ts');
const modelProblem = getMissingModelCredentialError();
if (modelProblem) {
  log(`\n  FAIL — the model endpoint is not usable: ${modelProblem.name}: ${modelProblem.message}`);
  log('  Nothing was created. Supply the model key to this process and re-run.');
  log('\n  STRAYS: none possible — nothing was created');
  process.exit(1);
}
readout('model endpoint', 'configured (endpoint settings resolve and a key is present)', 'getMissingModelCredentialError()  [src/lib/model-client.ts — no network call]');
// The model id is resolved here too, before any VM exists: a catalog override
// (MODEL_CATALOG / MODEL_CATALOG_PATH) that cannot be read locally must fail
// now, not after a boot.
let endpointModel;
try {
  const { getDefaultModel } = await import('../../src/lib/model-resolver.ts');
  endpointModel = process.env.POC_MODEL || getDefaultModel().endpointModel || getDefaultModel().id;
} catch (e) {
  log(`\n  FAIL — the default model could not be resolved: ${e?.name}: ${e?.message}`);
  log('  Nothing was created.');
  log('\n  STRAYS: none possible — nothing was created');
  process.exit(1);
}
readout('model', endpointModel, 'getDefaultModel()  [src/lib/model-resolver.ts]');

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
  log('  Nothing was created.');
  log('\n  STRAYS: none possible — nothing was created');
  process.exit(1);
}
jsonl = openResults(RUN_ID);
log(`  observations -> ${jsonl}`);

try {
  // ------------------------------------------------------------- boot ---
  enterPhase('boot one sandbox');
  section('BOOT — one sandbox');
  const token = randomUUID();
  const created = await elapsed(() => createFresh(token));
  const sandbox = created.value;
  live.push(sandbox); recordedIds.add(sandbox.sandboxId);
  const url = sandbox.domain(BRIDGE_PORT);
  readout('create', `${created.ms.toFixed(0)} ms — ${sandbox.sandboxId}`, CREATE_FRESH_COMMAND);
  const wrote = await elapsed(() => writeBridge(sandbox));
  const installed = await elapsed(() => installCharter(sandbox));
  readout('install package', `${installed.ms.toFixed(0)} ms`, INSTALL_COMMAND);
  const started = await elapsed(() => startBridge(sandbox));
  const ready = await elapsed(() => waitForReady(url, token));
  readout('bridge ready', `${ready.ms.toFixed(0)} ms`, READY_COMMAND(url));
  summary.boot = { sandboxId: sandbox.sandboxId, url, createMs: created.ms, writeBridgeMs: wrote.ms, installMs: installed.ms, startMs: started.ms, readyMs: ready.ms };
  record({ measurement: 'Q', step: 'boot', command: `${CREATE_FRESH_COMMAND} + ${INSTALL_COMMAND} + ${START_BRIDGE_COMMAND}`, ...summary.boot });

  enterPhase('deny outbound');
  await sandbox.updateNetworkPolicy('deny-all');
  const probe = await sandbox.runCommand({ cmd: 'sh', args: ['-c', OUTBOUND_PROBE] });
  const probeOut = ((await probe.stdout()) + (await probe.stderr())).trim().slice(0, 200);
  readout('outbound after deny-all', probeOut, `sandbox.updateNetworkPolicy('deny-all'); sandbox.runCommand: ${OUTBOUND_PROBE}`);
  summary.outbound = probeOut;
  record({ measurement: 'Q', step: 'outbound-denied', command: OUTBOUND_PROBE, output: probeOut });

  // Bind the app's MCP client to THIS VM before anything imports it: the
  // registry is built once, at the first load of src/lib/mcp/client.ts, and
  // compare-loop.ts and the CPU phase below share that one instance.
  process.env.NYC_CHARTER_MCP_URL = url;
  process.env.NYC_CHARTER_MCP_TOKEN = token;

  // -------------------------------------------------------- questions ---
  enterPhase('three Charter questions');
  section("THREE CHARTER QUESTIONS — runToolLoop(compareLoopOptions(...)), the app's own client");
  const { getModelClient } = await import('../../src/lib/model-client.ts');
  const { runToolLoop } = await import('../../src/lib/model-loop/run-tool-loop.ts');
  const { compareLoopOptions } = await import('../../src/lib/model-loop/compare-loop.ts');
  const client = getModelClient();
  summary.model = endpointModel;
  log(`  model: ${endpointModel}   (getDefaultModel(), src/lib/model-resolver.ts)`);

  for (const [qi, prompt] of QUESTIONS.entries()) {
    const cmd = `runToolLoop(compareLoopOptions({ client, endpointModel: '${endpointModel}', prompt: <question ${qi + 1}>, systemPrompt }))`;
    log(`\n  Q${qi + 1}: ${prompt}`);
    try {
      const r = await elapsed(() => runToolLoop(compareLoopOptions({ client, endpointModel, prompt, systemPrompt: SYSTEM_PROMPT })));
      const calls = r.value.toolCalls.map((c) => ({
        name: c.name, args: c.args, operationType: c.operationType ?? null,
        failed: Boolean(c.failed), failureKind: c.failureKind ?? null,
      }));
      const charterCalls = calls.filter((c) => c.name.startsWith('nyc_charter__'));
      const otherCalls = calls.filter((c) => !c.name.startsWith('nyc_charter__'));
      readout('tools called', calls.length
        ? calls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 80)})${c.failed ? ` FAILED:${c.failureKind}` : ''}`).join('; ')
        : '(none)', cmd);
      readout('elapsed / iterations / tokens', `${(r.ms / 1000).toFixed(1)} s / ${r.value.iterations} / ${r.value.usage.totalTokens}`, cmd);
      log('  ANSWER:');
      log('  ' + r.value.content.split('\n').join('\n  '));
      const q = {
        question: qi + 1, prompt, ok: r.value.content.trim().length > 0, elapsedMs: Math.round(r.ms),
        iterations: r.value.iterations, usage: r.value.usage, tokenLimitExceeded: r.value.tokenLimitExceeded,
        charterCalls: charterCalls.length, otherTools: otherCalls.map((c) => c.name), failedCalls: calls.filter((c) => c.failed).length,
        toolCalls: calls, answer: r.value.content,
      };
      summary.questions.push(q);
      record({ measurement: 'Q', step: 'question', command: cmd, ...q });
    } catch (e) {
      log(`  QUESTION FAILED: ${e?.name}: ${e?.message}`);
      const q = { question: qi + 1, prompt, ok: false, error: `${e?.name}: ${e?.message}` };
      summary.questions.push(q);
      record({ measurement: 'Q', step: 'question', command: cmd, ...q });
    }
  }

  // -------------------------------------------- guest CPU, same VM ---
  enterPhase('guest CPU per call');
  section(`GUEST CPU PER CALL — same VM, 2 × (${CPU_CALLS} calls, then an equal idle window); no extra creation`);
  try {
    const { callMcpTool } = await import('../../src/lib/mcp/client.ts');
    const read = async () => {
      const r = await sandbox.runCommand({ cmd: 'sh', args: ['-c', GUEST_CPU_COMMAND] });
      return parseGuestCpu(await r.stdout());
    };
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    let a = await read();
    for (let reading = 1; reading <= 2; reading++) {
      const t0 = Date.now();
      for (let k = 0; k < CPU_CALLS; k++) await callMcpTool('nyc_charter__get_version', {});
      const b = await read();
      const callWallMs = Date.now() - t0;
      const t1 = Date.now();
      await sleep(callWallMs);
      const c = await read();
      const idleWallMs = Date.now() - t1;
      const m = perCallGuestCpu({ callWin: { start: a, end: b, wallMs: callWallMs }, idleWin: { start: b, end: c, wallMs: idleWallMs }, calls: CPU_CALLS });
      readout(`guest CPU per call, VM-wide [${reading}]`,
        `${m.vm.perCallMs.toFixed(2)} ms   (${m.vm.inCalls} busy ticks over ${callWallMs} ms of calls; ${m.vm.inIdle} over ${idleWallMs} ms idle; 1 tick = ${m.tickMs} ms)`,
        `sh -c '${GUEST_CPU_COMMAND}'  [/proc/stat user+nice+system+irq+softirq+steal]`);
      readout(`guest CPU per call, node processes [${reading}]`,
        `${m.node.perCallMs.toFixed(2)} ms   (${m.node.inCalls} ticks in calls, ${m.node.inIdle} idle; pids ${m.nodePids.join(',')}${m.pidsStable ? '' : ' — PIDS CHANGED, reading invalid'})`,
        `same command  [utime+stime of every node process]`);
      summary.guestCpu.readings.push({ reading, calls: CPU_CALLS, callWallMs, idleWallMs, ...m });
      record({ measurement: 'M4', step: 'guest-cpu-per-call', reading, command: GUEST_CPU_COMMAND, calls: CPU_CALLS, callWallMs, idleWallMs, ...m });
      a = c;
    }
  } catch (e) {
    summary.guestCpu.error = `${e?.name}: ${e?.message}`;
    log(`  NOT RESOLVED — the guest CPU measurement failed: ${summary.guestCpu.error}`);
  }

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

async function finalizeOnce() {
  await teardown();
  summary.runStartMs = runStartMs;
  summary.recordedIds = [...recordedIds];
  const sp = jsonl ? writeSummary(RUN_ID, summary) : '(not written)';

  section(failure ? 'QUESTIONS KEY NUMBERS (run did NOT complete — see STOPPED AT below)' : 'QUESTIONS KEY NUMBERS');
  keyLine('  model', summary.model ?? 'n/a');
  keyLine('  boot (create / install / ready)', summary.boot.createMs == null ? 'n/a'
    : `${Math.round(summary.boot.createMs)} / ${Math.round(summary.boot.installMs)} / ${Math.round(summary.boot.readyMs)} ms`);
  keyLine('  outbound after deny-all', summary.outbound ?? 'n/a');
  for (const q of summary.questions) {
    if (!q.ok && q.error) { keyLine(`  Q${q.question}`, `FAILED — ${q.error}`); continue; }
    keyLine(`  Q${q.question} tools`, q.toolCalls.map((c) => `${c.name}${c.failed ? '(FAILED)' : ''}`).join(', ') || '(none)');
    keyLine(`  Q${q.question} charter calls / other tools`, `${q.charterCalls} / ${q.otherTools.length ? q.otherTools.join(', ') : 'none'}`);
    keyLine(`  Q${q.question} elapsed / iterations / tokens`, `${(q.elapsedMs / 1000).toFixed(1)} s / ${q.iterations} / ${q.usage.totalTokens}`);
    keyLine(`  Q${q.question} answer`, `${q.answer.length} chars${q.ok ? '' : ' — EMPTY'}`);
  }
  if (summary.questions.length < QUESTIONS.length) keyLine('  questions answered', `${summary.questions.filter((q) => q.ok).length} of ${QUESTIONS.length}`);
  for (const r of summary.guestCpu.readings) {
    keyLine(`  guest CPU/call VM-wide [${r.reading}]`, `${r.vm.perCallMs.toFixed(2)} ms`);
    keyLine(`  guest CPU/call node procs [${r.reading}]`, `${r.node.perCallMs.toFixed(2)} ms${r.pidsStable ? '' : ' (pids changed — invalid)'}`);
  }
  if (summary.guestCpu.error) keyLine('  guest CPU per call', `NOT RESOLVED — ${summary.guestCpu.error}`);
  log(`\n  log:          ${LOG_PATH}`);
  log(`  observations: ${jsonl}`);
  log(`  summary:      ${sp}`);

  const { notOursLine, strayLine, sinceIso } = await ownershipStrayCheck({ auth: resolveAuth(), recordedIds, runStartMs });
  const answered = summary.questions.filter((q) => q.ok).length;
  section(failure ? 'INCOMPLETE' : 'DONE');
  if (failure) {
    log(`  STOPPED AT: ${phase}`);
    log(`  REASON:     ${failure?.name}: ${failure?.message}`);
  }
  log(`  questions answered: ${answered} of ${QUESTIONS.length}`);
  log(`  run start (API clock): ${sinceIso}   recorded ids: ${recordedIds.size}`);
  log(`  ${notOursLine}`);
  log(`  ${strayLine}`);
  if (failure || answered < QUESTIONS.length || strayLine !== 'STRAYS: 0') process.exitCode = 1;
}
