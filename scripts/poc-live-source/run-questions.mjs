#!/usr/bin/env node
/**
 * POC MCP-LIVE-SOURCE — the half that needs a model key. OWNER-RUN.
 *
 * Two things, on ONE sandbox:
 *
 *   L5(b) — the failure, through the shipped loop. A question is driven at a
 *     source whose upstream is blocked, and what the loop records, what the
 *     model was told and what the model then said are all kept.
 *
 *     THE BLOCK IS APPLIED TO A COLD SOURCE, DELIBERATELY. The L1 readings
 *     found that `deny-all` on a RUNNING VM does not stop a source that has
 *     already talked to its upstream — the block removes name resolution, and a
 *     process holding a pooled connection keeps using it. So this phase blocks
 *     the VM before the upstream server has ever made a request, which is the
 *     only shape in which the refusal path can be seen at all. That the other
 *     shape exists is L1's finding, not a defect in this one.
 *
 *   THE TWO QUESTIONS — the cross-source measurement. Both this source and
 *     Socrata are advertised and BOTH ARE LIVE, and both answer questions about
 *     New York City open data. One question sits in this source's lane (City
 *     Record notices) and one sits outside it (311 service requests, which this
 *     source has no data for and Socrata does). Crossing is legible in either
 *     direction: a City Record question answered through Socrata's `search`, or
 *     a 311 question sent to `nyc_record__search_notices`.
 *
 *     TWO DESCRIPTION VARIANTS, because a bare yes/no would not say what the
 *     source picker has to do. `scoped` is the shipped text, whose first tool
 *     carries one sentence naming what the source does and does not cover;
 *     `bare` is the same schema with that sentence removed. The difference
 *     between them is the measurement: whether one sentence of scope in a tool
 *     description is what keeps two overlapping sources apart.
 *
 * TWO CHILD PROCESSES, ONE COMMAND. `src/lib/mcp/client.ts` builds its registry
 * once, at module load, so one process cannot hold two registry configurations.
 * L5(b) needs Socrata ABSENT (so the only live source is the blocked one) and
 * the questions need it PRESENT. This file is therefore its own child: the
 * parent boots the VM, sets each phase's network policy, re-executes itself
 * with `--phase`, and owns teardown and the stray check. The owner runs one
 * command.
 *
 * SECRET HYGIENE. The model key is read from this process's environment by
 * `src/lib/model-client.ts`, exactly as the server reads it, and is never
 * printed, logged or written to a results file. The bridge token is a per-run
 * `randomUUID()`. Variables are reported by NAME with the word present/absent.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.POC_RESULTS_DIR ||= path.join(process.cwd(), 'temp', 'mcp-live-source-poc');
const {
  openResults, record, writeSummary, section, readout, elapsed, log,
  silenceAppClientLogs, keyLine, teeOutputTo, RESULTS_DIR, sleep,
} = await import('../poc-warm-vm/lib.mjs');
const OPS = await import('./sandbox-ops.mjs');
const {
  createFresh, installRecordServer, writeBridge, writeProbe, startBridge, waitForReady,
  resolveAuth, probe, probeCommand, policyCommand, listAllSandboxes, ownershipStrayCheck,
  CREATE_FRESH_COMMAND, INSTALL_COMMAND, START_BRIDGE_COMMAND, READY_COMMAND,
  BRIDGE_PORT, RECORD_PACKAGE, UPSTREAM_HOST, OUR_SIGNATURE,
  UPSTREAM_ONLY_POLICY, DENY_ALL_POLICY,
} = OPS;

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * FAULT INJECTION, for demonstrating the void path rather than asserting it.
 *
 * `POC_FAULT=void` makes the credential probe pass without calling anything,
 * skips the boot entirely, and makes every reading return the credential
 * failure that voided the first run. Nothing is created and nothing is billed,
 * and the run must end VOID with a non-zero exit — which is the behaviour the
 * first run did not have. A criterion demonstrated only on a run that cannot
 * fail is not demonstrated, and this is the cheapest shape that can fail.
 *
 * Inert unless set. Never set it on a record run.
 */
const FAULT = process.env.POC_FAULT || '';
const PHASE_ARG = process.argv.find((a) => a.startsWith('--phase='))?.split('=')[1] ?? null;

/** The project's own hosted Socrata MCP endpoint (docs/project-plan.md, .env.example). */
const SOCRATA_URL = process.env.POC_SOCRATA_MCP_URL || 'https://socrata-mcp.civicaitools.org';
/**
 * The portal injected into Socrata calls that omit one.
 *
 * NO CODED FALLBACK, per #407 and the guard that enforces it: a portal
 * hostname is configuration, and a default written here would be a run-input
 * default — a value a run that named no portal would inherit, reaching the
 * `portal` argument of a call. It comes from the instance's own resolver, and
 * `POC_PORTAL` overrides it for a run that wants to state one explicitly.
 * Absent, it is `undefined`, and `runToolLoop` injects nothing — which is the
 * shipped behaviour for an instance that configured no default, and the honest
 * thing to measure this source's overlap with Socrata against.
 */
const { getDefaultPortal } = await import('../../src/lib/site-config.ts');
const PORTAL = process.env.POC_PORTAL || getDefaultPortal() || undefined;

const QUESTIONS = [
  {
    id: 'Q1-in-lane',
    lane: 'nyc-record',
    prompt: 'Which New York City agencies have recently posted procurement solicitations that are still open, and when are they due? Name the agencies and the dates.',
    why: "City Record notices — this source's own subject. Socrata could also be asked for a dataset, so answering it through Socrata is crossing.",
  },
  {
    id: 'Q2-out-of-lane',
    lane: 'socrata',
    prompt: 'How many 311 noise complaints did New York City receive in the last full week, and which borough had the most?',
    why: 'Not City Record data at all. nyc_record has no 311 notices, so any nyc_record call here is the model reaching for the wrong source.',
  },
];

const SYSTEM_PROMPT =
  'You answer questions about New York City using the live data tools available to you. ' +
  'Choose the tool best suited to the question, call it, and answer only from what comes back. ' +
  'Never state a figure the retrieved data does not support. If the data cannot be retrieved, say so plainly.';

const L5_QUESTION =
  'Which New York City agencies have recently posted procurement solicitations that are still open? Use the City Record notices.';

// ===========================================================================
// CHILD: one phase, in its own process, with its own registry configuration.
// ===========================================================================
if (PHASE_ARG) {
  const url = process.env.POC_BRIDGE_URL;
  const token = process.env.POC_BRIDGE_TOKEN;
  process.env.NYC_RECORD_MCP_URL = url;
  process.env.NYC_RECORD_MCP_TOKEN = token;
  if (PHASE_ARG === 'cross') process.env.SOCRATA_MCP_URL = SOCRATA_URL;
  else delete process.env.SOCRATA_MCP_URL;

  const { getModelClient, classifyModelError } = await import('../../src/lib/model-client.ts');
  const { runToolLoop } = await import('../../src/lib/model-loop/run-tool-loop.ts');
  const { compareLoopOptions } = await import('../../src/lib/model-loop/compare-loop.ts');
  const { mcpTools } = await import('../../src/lib/mcp/tools.ts');
  const client = getModelClient();
  const out = [];

  /**
   * `scoped` is the shipped description; `bare` removes the one sentence that
   * names what the source covers. Mutating the advertised text is the whole
   * point of the variant — nothing about the LOOP's configuration is restated,
   * and the exact description used is recorded with every reading.
   */
  const SCOPE_SENTENCE = ' This source covers ONLY City Record notices; for any other New York City dataset use the Socrata tools instead.';
  const searchTool = mcpTools.find((t) => t.function.name === 'nyc_record__search_notices');
  const SHIPPED_DESCRIPTION = searchTool.function.description;
  function applyVariant(variant) {
    searchTool.function.description = variant === 'bare'
      ? SHIPPED_DESCRIPTION.replace(SCOPE_SENTENCE, '')
      : SHIPPED_DESCRIPTION;
    return searchTool.function.description;
  }

  /**
   * A credential-class failure is fatal to the WHOLE run, not to one reading.
   *
   * The first questions run recorded ten loops that each returned "401 Missing
   * Authentication header", reported zero tool calls, and were then summarised
   * as though they had run. Nine of those ten were known-useless the moment the
   * first one failed. `classifyModelError` already separates the credential
   * kinds from everything else, so the first one stops the phase and the reason
   * travels back to the parent, which refuses to call the run complete.
   */
  const FATAL_KINDS = new Set(['model_not_configured', 'model_auth_rejected']);
  let fatal = null;

  async function ask({ label, prompt, endpointModel, variant, portal }) {
    const description = applyVariant(variant);
    const t0 = Date.now();
    if (FAULT === 'void') {
      fatal = { kind: 'model_auth_rejected', message: 'Error: 401 Missing Authentication header (POC_FAULT=void)' };
      return { label, prompt, endpointModel, variant, ok: false, elapsedMs: Date.now() - t0, error: fatal.message, modelErrorKind: fatal.kind, fatal: true, toolCalls: [], scopeSentencePresent: description.includes('covers ONLY City Record notices') };
    }
    try {
      const r = await runToolLoop(compareLoopOptions({ client, endpointModel, prompt, systemPrompt: SYSTEM_PROMPT, portal }));
      return {
        label, prompt, endpointModel, variant, ok: r.content.trim().length > 0,
        elapsedMs: Date.now() - t0, iterations: r.iterations, usage: r.usage,
        scopeSentencePresent: description.includes('covers ONLY City Record notices'),
        toolCalls: r.toolCalls.map((c) => ({
          name: c.name, args: c.args, operationType: c.operationType ?? null,
          failed: Boolean(c.failed), failureKind: c.failureKind ?? null,
          rows: c.resultSummary?.rows ?? null, durationMs: c.duration_ms ?? null,
        })),
        answer: r.content,
      };
    } catch (e) {
      const kind = classifyModelError(e);
      if (FATAL_KINDS.has(kind)) fatal = { kind, message: `${e?.name}: ${e?.message}` };
      return { label, prompt, endpointModel, variant, ok: false, elapsedMs: Date.now() - t0, error: `${e?.name}: ${e?.message}`, modelErrorKind: kind, fatal: FATAL_KINDS.has(kind), toolCalls: [] };
    }
  }

  if (PHASE_ARG === 'blocked') {
    const endpointModel = process.env.POC_MODEL;
    const readings = Number(process.env.POC_REPEATS || 2);
    for (let i = 1; i <= readings; i++) {
      out.push({ phase: 'blocked', reading: i, ...(await ask({ label: `L5b[${i}]`, prompt: L5_QUESTION, endpointModel, variant: 'scoped' })) });
      if (fatal) break;
    }
  } else {
    const models = (process.env.POC_MODELS || '').split(',').filter(Boolean);
    const variants = (process.env.POC_VARIANTS || 'scoped,bare').split(',').filter(Boolean);
    outer: for (const endpointModel of models) {
      for (const variant of variants) {
        for (const q of QUESTIONS) {
          out.push({ phase: 'cross', question: q.id, lane: q.lane, ...(await ask({ label: `${q.id}/${endpointModel}/${variant}`, prompt: q.prompt, endpointModel, variant, portal: PORTAL })) });
          if (fatal) break outer;
        }
      }
    }
  }
  process.stdout.write(`\n__PHASE_JSON__${JSON.stringify({ readings: out, fatal, expected: Number(process.env.POC_EXPECTED || out.length) })}__END__\n`);
  process.exit(fatal ? 3 : 0);
}

// ===========================================================================
// PARENT: boot, policy, both phases, teardown, stray check.
// ===========================================================================
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_PATH = teeOutputTo(path.join(RESULTS_DIR, `questions-run-${RUN_ID}.log`));
silenceAppClientLogs();

const live = [];
const recordedIds = new Set();
let runStartMs = null;
let jsonl = null;
let phase = 'startup';
let failure = null;
let finalizing = null;
/**
 * Set when the run produced no usable measurement. A void run must not print as
 * a completed one: the first questions run reported ten loops in its KEY NUMBERS
 * block as though they had run, when every one of them had been refused by the
 * model endpoint.
 */
let voidReason = null;
const summary = { runId: RUN_ID, kind: 'live-source-questions', package: RECORD_PACKAGE, upstreamHost: UPSTREAM_HOST, bridgePort: BRIDGE_PORT, socrataUrl: SOCRATA_URL, portal: PORTAL, boot: {}, models: [], l5b: [], cross: [] };

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
  console.log('\n  SIGINT — stopping this run’s VM, then checking for strays. Ctrl-C again exits without cleanup.');
  await finalize();
  process.exit(130);
});

/** Run one phase in a child process and parse its JSON tail. */
function runPhase(name, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', path.join(HERE, 'run-questions.mjs'), `--phase=${name}`], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => {
      const m = stdout.match(/__PHASE_JSON__([\s\S]*?)__END__/);
      if (!m) return reject(new Error(`phase "${name}" produced no result (exit ${code}): ${(stderr || stdout).slice(-1200)}`));
      try { resolve(JSON.parse(m[1])); } catch (e) { reject(new Error(`phase "${name}" produced unparseable output: ${e.message}`)); }
    });
    child.on('error', reject);
  });
}

// ---------------------------------------------------------------- step 0 ---
section('STEP 0 — model endpoint, then sandbox auth (nothing is created until both pass)');
log(`  log: ${LOG_PATH}`);
for (const n of ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'MODEL_API_KIND', 'MODEL_API_BASE_URL', 'SOCRATA_APP_TOKEN', 'VERCEL_OIDC_TOKEN', 'VERCEL_TOKEN']) {
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
log('  NOTE: that check is local. It answers "is a key present", not "does it work" —');
log('  and a present-but-unusable key is exactly what voided the first questions run:');
log('  the value was an op:// reference, non-empty and not a credential. The probe');
log('  below is the one that can fail.');

let models;
try {
  const { getDefaultModel } = await import('../../src/lib/model-resolver.ts');
  const { BUILT_IN_CATALOG, selectableModels } = await import('../../src/lib/model-catalog.ts');
  const serverDefault = getDefaultModel().endpointModel || getDefaultModel().id;
  const pickerDefault = selectableModels(BUILT_IN_CATALOG)[0]?.id;
  models = (process.env.POC_MODELS || [serverDefault, pickerDefault].filter(Boolean).join(',')).split(',').filter(Boolean);
  readout('models', models.join(', '), 'getDefaultModel() [server default] + selectableModels(BUILT_IN_CATALOG)[0] [the picker default a visitor to /ask gets]');
} catch (e) {
  log(`\n  FAIL — the models could not be resolved: ${e?.name}: ${e?.message}\n  Nothing was created.`);
  log('\n  STRAYS: none possible — nothing was created');
  process.exit(1);
}
summary.models = models;

/**
 * THE CREDENTIAL PROBE — one real model call per model, before anything is
 * created or billed.
 *
 * WHY IT EXISTS. The first questions run booted a sandbox and drove ten loops
 * that every one of them answered "401 Missing Authentication header", because
 * step 0 had only asked whether a key was PRESENT. A non-empty string passes
 * that test whatever it is, and the value was an `op://` reference — a pointer
 * to a credential, not one. This is the warm-VM spike's own rule, which it
 * wrote down and this run did not follow: prove that credentials are present
 * with a call whose failure you can see.
 *
 * One turn, `max_tokens: 1`, no `tools` — the allow-listed non-loop class in
 * `src/lib/model-loop/model-call-registry.test.ts`, which carries an entry
 * naming this file for exactly this call.
 *
 * Every model is probed, not just the first: a key that works for the server
 * default and not for the picker default would otherwise be found eight loops
 * and one sandbox later.
 */
const { getModelClient, classifyModelError } = await import('../../src/lib/model-client.ts');
const { probeCredential, PROBE_COMMAND } = await import('./credential-probe.mjs');
try {
  if (FAULT === 'void') {
    readout('model credential', 'SKIPPED — POC_FAULT=void (nothing is called, created or billed)', 'POC_FAULT=void');
  } else {
    for (const r of await probeCredential(getModelClient(), models)) {
      readout(`model credential · ${r.model}`, `USABLE — answered in ${r.ms} ms (${r.totalTokens ?? '?'} tokens)`, PROBE_COMMAND(r.model));
    }
  }
} catch (e) {
  const kind = classifyModelError(e);
  log(`\n  FAIL — the model credential does not work: ${e?.name}: ${e?.message}`);
  log(`  classified: ${kind ?? 'unclassified'}`);
  if (kind === 'model_auth_rejected' || kind === 'model_not_configured') {
    log('  The endpoint rejected the credential this process received. If the value in');
    log('  the env file is an op:// reference, resolve it before this process starts:');
    log('    op run --env-file=<env file> -- sh scripts/poc-live-source/owner-run-questions.sh');
    log('  The script prefers an already-resolved MODEL_API_KEY from the parent');
    log('  environment and only falls back to reading the file for a literal.');
  }
  log('  Nothing was created and nothing was billed.');
  log('\n  STRAYS: none possible — nothing was created');
  process.exit(1);
}

/**
 * Rehearsal switch. Everything above this line is the real step 0 — the key
 * reaching the process, the endpoint resolving, the models resolving. Set
 * POC_STEP0_ONLY=1 to stop here, so the owner-run command's whole path can be
 * driven once before it is allowed to create or bill anything. An owner-run leg
 * that needs three rounds costs more owner time than the measurement is worth.
 */
const auth = resolveAuth();
try {
  const listing = await listAllSandboxes(auth);
  if (listing.serverNowMs == null) throw new Error('the sandbox API sent no Date header, so no run start could be fixed');
  runStartMs = listing.serverNowMs;
  readout('sandbox API', `OK — ${listing.rows.length} sandbox(es) in scope, ${listing.rows.filter((r) => r.status === 'running').length} running`, 'listAllSandboxes(auth)  [every page]');
  readout('run start (API clock)', new Date(runStartMs).toISOString(), 'HTTP Date header of that listing');
} catch (e) {
  log(`\n  FAIL — the sandbox API did not authenticate: ${e?.name}: ${e?.message}\n  Nothing was created.`);
  log('\n  STRAYS: none possible — nothing was created');
  process.exit(1);
}
if (process.env.POC_STEP0_ONLY) {
  log('\n  POC_STEP0_ONLY — stopping here. The model key reached this process, the');
  log('  endpoint and both models resolved, and the sandbox API authenticated.');
  log('  Nothing was created and nothing was billed.');
  log(`  Variable names this process received: ${Object.keys(process.env).sort().join(', ')}`);
  log('\n  STRAYS: none possible — nothing was created');
  process.exit(0);
}

jsonl = openResults(RUN_ID);
log(`  observations -> ${jsonl}`);

try {
  // ------------------------------------------------------------- boot ---
  phase = 'boot';
  section('BOOT — one sandbox on port 3100');
  const token = randomUUID();
  // POC_FAULT=void: no sandbox at all. The phases below run against a
  // placeholder address and never reach it, because every reading is
  // short-circuited into the credential failure being demonstrated.
  // The create leg is TIMED, not just awaited. Dropping the `elapsed()` here
  // when POC_FAULT was added left `summary.boot.createMs` undefined, and the
  // KEY NUMBERS line below guards on it — so a leg that was measured fine
  // printed the whole boot as "n/a" beside a recorded id of 1.
  const createdAt = FAULT === 'void' ? null : await elapsed(() => createFresh(token));
  const sandbox = createdAt ? createdAt.value : null;
  if (!sandbox) {
    log('  POC_FAULT=void — no sandbox created. Demonstrating the void path only.');
  }
  const url = sandbox ? sandbox.domain(BRIDGE_PORT) : 'https://fault-injection.invalid';
  if (sandbox) {
    live.push(sandbox); recordedIds.add(sandbox.sandboxId);
    readout('create', `${createdAt.ms.toFixed(0)} ms — ${sandbox.sandboxId}`, CREATE_FRESH_COMMAND);
    await writeBridge(sandbox); await writeProbe(sandbox);
  }
  if (sandbox) {
  const installed = await elapsed(() => installRecordServer(sandbox));
  readout('install package', `${installed.ms.toFixed(0)} ms`, INSTALL_COMMAND);
  await startBridge(sandbox);
  const ready = await elapsed(() => waitForReady(url, token));
  readout('bridge ready', `${ready.ms.toFixed(0)} ms`, READY_COMMAND(url));
  summary.boot = { sandboxId: sandbox.sandboxId, url, createMs: createdAt.ms, installMs: installed.ms, readyMs: ready.ms };
  record({ measurement: 'Q', step: 'boot', command: `${CREATE_FRESH_COMMAND} + ${INSTALL_COMMAND} + ${START_BRIDGE_COMMAND}`, ...summary.boot });
  }

  // ------------------------------------------------------------ L5(b) ---
  // The upstream server has not made a single request yet: the bridge started
  // it, and nothing has called a tool. Blocking NOW is what makes the block
  // bite — see this file's header, and L1's finding about a warm source.
  phase = 'L5(b) blocked upstream';
  section('L5(b) — ONE QUESTION AT A SOURCE WHOSE UPSTREAM IS BLOCKED');
  if (sandbox) {
    await sandbox.updateNetworkPolicy(DENY_ALL_POLICY);
    await sleep(3000);
    const blockedProbe = await probe(sandbox, 'outbound', UPSTREAM_HOST);
    readout('upstream after deny-all', blockedProbe.text, probeCommand('outbound', UPSTREAM_HOST));
  }
  log(`  the upstream server has made no request yet, so it holds no pooled connection`);
  const l5bPhase = await runPhase('blocked', {
    POC_BRIDGE_URL: url, POC_BRIDGE_TOKEN: token,
    POC_MODEL: models[0], POC_REPEATS: String(process.env.POC_REPEATS || 2),
    POC_FAULT: FAULT,
  });
  const l5b = l5bPhase.readings;
  summary.l5b = l5b;
  if (l5bPhase.fatal) {
    voidReason = `L5(b) stopped on a ${l5bPhase.fatal.kind} failure: ${l5bPhase.fatal.message}`;
    throw new Error(voidReason);
  }
  for (const r of l5b) {
    log(`\n  L5b reading ${r.reading} — model ${r.endpointModel}`);
    readout('tool calls', r.toolCalls.length ? r.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 60)})${c.failed ? ` FAILED:${c.failureKind}` : ''}`).join('; ') : '(none)',
      `runToolLoop(compareLoopOptions({ ... prompt: <L5 question> }))  with ${policyCommand(DENY_ALL_POLICY)} on the VM`);
    readout('iterations / tokens', `${r.iterations} / ${r.usage?.totalTokens}`, 'the same call');
    log('  WHAT THE READER WOULD SEE (the model’s answer):');
    log('  ' + String(r.answer ?? r.error).split('\n').join('\n  '));
    record({ measurement: 'L5b', step: 'blocked-question', command: 'runToolLoop(compareLoopOptions(...)) under deny-all', ...r });
  }

  // ------------------------------------------------- the two questions ---
  phase = 'the two questions';
  section('THE TWO QUESTIONS — both sources advertised, both live');
  if (sandbox) {
    await sandbox.updateNetworkPolicy(UPSTREAM_ONLY_POLICY);
    await sleep(3000);
    const openProbe = await probe(sandbox, 'outbound', UPSTREAM_HOST);
    readout('upstream restored', openProbe.text, probeCommand('outbound', UPSTREAM_HOST));
  }
  log(`  nyc_record → the sandbox bridge at ${url} (policy: only ${UPSTREAM_HOST})`);
  log(`  socrata    → ${SOCRATA_URL}, called directly by this process, portal ${PORTAL ?? '(none — this instance configured no default, so each call names its own)'}`);
  const variants = (process.env.POC_VARIANTS || 'scoped,bare').split(',').filter(Boolean);
  log(`  models: ${models.join(', ')}   variants: ${variants.join(', ')}   questions: ${QUESTIONS.map((q) => q.id).join(', ')}`);
  for (const q of QUESTIONS) log(`    ${q.id} (${q.lane}): ${q.why}`);
  const expectedCross = models.length * variants.length * QUESTIONS.length;
  const crossPhase = await runPhase('cross', {
    POC_BRIDGE_URL: url, POC_BRIDGE_TOKEN: token,
    POC_MODELS: models.join(','), POC_VARIANTS: variants.join(','),
    POC_EXPECTED: String(expectedCross), POC_FAULT: FAULT,
  });
  const cross = crossPhase.readings;
  summary.cross = cross;
  summary.expectedCross = expectedCross;
  if (crossPhase.fatal) {
    voidReason = `the questions stopped on a ${crossPhase.fatal.kind} failure after ${cross.length} of ${expectedCross} readings: ${crossPhase.fatal.message}`;
    throw new Error(voidReason);
  }
  for (const r of cross) {
    const recordCalls = r.toolCalls.filter((c) => c.name.startsWith('nyc_record__'));
    const socrataCalls = r.toolCalls.filter((c) => ['get_data', 'search', 'fetch'].includes(c.name));
    const otherCalls = r.toolCalls.filter((c) => !c.name.startsWith('nyc_record__') && !['get_data', 'search', 'fetch'].includes(c.name));
    const crossed = (r.lane === 'nyc-record' && recordCalls.length === 0 && socrataCalls.length > 0)
      || (r.lane === 'socrata' && recordCalls.length > 0);
    log(`\n  ${r.label}`);
    readout('tool calls', r.toolCalls.length ? r.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 70)})${c.failed ? ` FAILED:${c.failureKind}` : ''}`).join('; ') : '(none)',
      `runToolLoop(compareLoopOptions({ endpointModel: '${r.endpointModel}', prompt: <${r.question}>, portal: ${PORTAL ? `'${PORTAL}'` : 'undefined'} }))`);
    readout('source split', `nyc_record ${recordCalls.length} · socrata ${socrataCalls.length} · other ${otherCalls.length} · failed ${r.toolCalls.filter((c) => c.failed).length}`, 'the same call');
    readout('scope sentence in the description', String(r.scopeSentencePresent), `variant "${r.variant}"`);
    readout('CROSSED?', crossed ? `YES — a ${r.lane} question answered from the other source` : 'no', `lane ${r.lane}`);
    readout('iterations / tokens', `${r.iterations} / ${r.usage?.totalTokens}`, 'the same call');
    log('  ANSWER:');
    log('  ' + String(r.answer ?? r.error).slice(0, 2000).split('\n').join('\n  '));
    r.recordCalls = recordCalls.length; r.socrataCalls = socrataCalls.length; r.otherCalls = otherCalls.length; r.crossed = crossed;
    record({ measurement: 'Q', step: 'cross-source', command: 'runToolLoop(compareLoopOptions(...)) with both sources live', ...r });
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

  // A reading that recorded no tool calls AND returned no answer measured
  // nothing, whatever the reason. Counting them is what turns "ten loops ran"
  // into "0 of 8 answered".
  const answered = [...summary.l5b, ...summary.cross].filter((r) => r.ok).length;
  const attempted = summary.l5b.length + summary.cross.length;
  const expected = (Number(process.env.POC_REPEATS || 2)) + (summary.expectedCross ?? 0);
  if (!voidReason && attempted > 0 && answered === 0) {
    voidReason = `0 of ${attempted} readings returned an answer — nothing was measured`;
  }
  if (!voidReason && expected > 0 && attempted < expected) {
    voidReason = `only ${attempted} of ${expected} readings ran`;
  }

  if (voidReason) {
    section('VOID — THIS RUN MEASURED NOTHING');
    log(`  ${voidReason}`);
    log('  The numbers below are recorded so the failure can be read, NOT as results.');
  }
  section(failure ? 'KEY NUMBERS (run did NOT complete — see STOPPED AT below)' : 'KEY NUMBERS');
  keyLine('  VOID', voidReason ? `YES — ${voidReason}` : 'no');
  keyLine('  readings answered', `${answered} of ${attempted} attempted (${expected} expected)`);
  keyLine('  models', summary.models.join(', '));
  // Per leg, so one missing figure cannot hide the two that were measured.
  const leg = (v) => (v == null ? 'n/a' : `${Math.round(v)} ms`);
  keyLine('  boot (create / install / ready)', summary.boot.sandboxId
    ? `${leg(summary.boot.createMs)} / ${leg(summary.boot.installMs)} / ${leg(summary.boot.readyMs)}  [${summary.boot.sandboxId}]`
    : 'no sandbox was created');
  for (const r of summary.l5b) {
    keyLine(`  L5b[${r.reading}] tool calls`, r.toolCalls.map((c) => `${c.name}${c.failed ? `(FAILED:${c.failureKind})` : ''}`).join(', ') || '(none)');
    keyLine(`  L5b[${r.reading}] answer`, String(r.answer ?? r.error).replace(/\s+/g, ' ').slice(0, 220));
  }
  for (const r of summary.cross) {
    keyLine(`  ${r.label}`, `nyc_record ${r.recordCalls} · socrata ${r.socrataCalls} · other ${r.otherCalls} · CROSSED ${r.crossed ? 'YES' : 'no'} · ${r.iterations} iters · ${r.usage?.totalTokens} tokens`);
    keyLine(`    tools`, r.toolCalls.map((c) => c.name).join(', ') || '(none)');
  }
  log(`\n  log:          ${LOG_PATH}`);
  log(`  observations: ${jsonl}`);
  log(`  summary:      ${sp}`);

  const { notOursLine, strayLine, sinceIso } = await ownershipStrayCheck({
    auth: resolveAuth(), recordedIds, runStartMs, signature: OUR_SIGNATURE,
  });
  section(failure ? 'INCOMPLETE' : 'DONE');
  if (failure) {
    log(`  STOPPED AT: ${phase}`);
    log(`  REASON:     ${failure?.name}: ${failure?.message}`);
  }
  log(`  run start (API clock): ${sinceIso}   recorded ids: ${recordedIds.size}`);
  log(`  signature used for the claim: runtime ${OUR_SIGNATURE.runtime} + route on port ${OUR_SIGNATURE.port}`);
  log(`  ${notOursLine}`);
  log(`  ${strayLine}`);
  summary.void = voidReason;
  summary.answered = answered;
  summary.attempted = attempted;
  if (jsonl) writeSummary(RUN_ID, summary);
  if (voidReason) log(`\n  VOID: ${voidReason}`);
  if (failure || voidReason || strayLine !== 'STRAYS: 0') process.exitCode = 1;
}
