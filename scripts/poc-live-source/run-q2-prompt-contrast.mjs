#!/usr/bin/env node
/**
 * POC MCP-LIVE-SOURCE — Q2 under the HARNESS prompt and the SHIPPED prompt.
 * OWNER-RUN (needs the model key). CREATES NO SANDBOX.
 *
 * WHY THIS RUN EXISTS. The questions run reported that `openai/gpt-4o` answered
 * Q2 from a wrong date window — a future week in one variant and a 2023 week in
 * the other — and the report attributed it in part to neither model being given
 * the current date. That was a statement about THIS HARNESS, not about the
 * site. `run-questions.mjs` passes a hand-written three-sentence SYSTEM_PROMPT.
 * The shipped path does not: `/api/compare` calls
 * `buildSystemPrompt(portal)` (compare/route.ts:122), which composes through
 * `composeSkillPrompt` with `today: new Date().toISOString().split('T')[0]`
 * (socrata-skill.ts:626) and emits "Today's date is <date>. Always use this as
 * the current date for interpreting relative time expressions…"
 * (socrata-skill.ts:516).
 *
 * So the finding as written was a claim about a prompt the site never sends.
 * This run measures both, on both models, and reports the four side by side.
 *
 * WHY NO SANDBOX. All four original Q2 readings called Socrata tools only, and
 * Q2 is not answerable from City Record notices at all. `mcpTools` advertises
 * the seven `nyc_record__` tools unconditionally either way, so the tool set the
 * model sees is unchanged; what differs is that an `nyc_record` call would now
 * be refused by name (`NYC_RECORD_MCP_URL`) instead of returning rows. That
 * difference is recorded rather than assumed: every reading reports its
 * `nyc_record` call count, and a non-zero one is reported as a material
 * difference from the original readings rather than quietly averaged in.
 *
 * WHAT IS HELD FIXED, so the prompt is the only variable: the same two
 * questions' Q2 text, the same models, the same loop and factory, the same live
 * Socrata endpoint, and the same portal resolution — `getDefaultPortal()`,
 * unset on this instance, so no portal is injected and each call names its own.
 *
 * SECRET HYGIENE. Variables by NAME only. The credential is probed through the
 * shared `credential-probe.mjs` before anything runs.
 */
import path from 'node:path';

process.env.POC_RESULTS_DIR ||= path.join(process.cwd(), 'temp', 'mcp-live-source-poc');
const {
  openResults, record, writeSummary, section, readout, log, keyLine, teeOutputTo, RESULTS_DIR,
  silenceAppClientLogs,
} = await import('../poc-warm-vm/lib.mjs');

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_PATH = teeOutputTo(path.join(RESULTS_DIR, `q2-prompt-contrast-${RUN_ID}.log`));
silenceAppClientLogs();

/** The project's own hosted Socrata MCP endpoint, as in the questions run. */
const SOCRATA_URL = process.env.POC_SOCRATA_MCP_URL || 'https://socrata-mcp.civicaitools.org';
process.env.SOCRATA_MCP_URL = SOCRATA_URL;
// nyc_record is deliberately NOT configured: no sandbox exists in this run.
delete process.env.NYC_RECORD_MCP_URL;
delete process.env.NYC_RECORD_MCP_TOKEN;

/** Q2, verbatim from run-questions.mjs. */
const Q2 = 'How many 311 noise complaints did New York City receive in the last full week, and which borough had the most?';

/** The harness prompt, verbatim from run-questions.mjs:115-118. */
const HARNESS_PROMPT =
  'You answer questions about New York City using the live data tools available to you. ' +
  'Choose the tool best suited to the question, call it, and answer only from what comes back. ' +
  'Never state a figure the retrieved data does not support. If the data cannot be retrieved, say so plainly.';

section('STEP 0 — model endpoint and credential (nothing is created; no sandbox in this run)');
log(`  log: ${LOG_PATH}`);
for (const n of ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'MODEL_API_BASE_URL', 'SOCRATA_MCP_URL', 'NYC_RECORD_MCP_URL']) {
  log(`  ${n}: ${process.env[n]?.trim() ? 'present' : 'absent'}   (name only — never the value)`);
}

const { getModelClient, getMissingModelCredentialError, classifyModelError } = await import('../../src/lib/model-client.ts');
const missing = getMissingModelCredentialError();
if (missing) {
  log(`\n  FAIL — ${missing.name}: ${missing.message}`);
  log('  Nothing was created and nothing was billed.');
  process.exit(1);
}

const { getDefaultModel } = await import('../../src/lib/model-resolver.ts');
const { BUILT_IN_CATALOG, selectableModels } = await import('../../src/lib/model-catalog.ts');
const serverDefault = getDefaultModel().endpointModel || getDefaultModel().id;
const pickerDefault = selectableModels(BUILT_IN_CATALOG)[0]?.id;
const models = (process.env.POC_MODELS || [serverDefault, pickerDefault].filter(Boolean).join(',')).split(',').filter(Boolean);
readout('models', models.join(', '), 'getDefaultModel() [server default] + selectableModels(BUILT_IN_CATALOG)[0] [the picker default]');

const { probeCredential, PROBE_COMMAND } = await import('./credential-probe.mjs');
const client = getModelClient();
try {
  for (const r of await probeCredential(client, models)) {
    readout(`model credential · ${r.model}`, `USABLE — answered in ${r.ms} ms`, PROBE_COMMAND(r.model));
  }
} catch (e) {
  const kind = classifyModelError(e);
  log(`\n  FAIL — the model credential does not work: ${e?.name}: ${e?.message}`);
  log(`  classified: ${kind ?? 'unclassified'}`);
  if (kind === 'model_auth_rejected' || kind === 'model_not_configured') {
    log('  If the env file holds an op:// reference, run this under op run:');
    log('    op run --env-file=<env file> -- sh scripts/poc-live-source/owner-run-q2-contrast.sh');
  }
  log('  Nothing was created and nothing was billed.');
  process.exit(1);
}

const jsonl = openResults(RUN_ID);
log(`  observations -> ${jsonl}`);

// --------------------------------------------------------------- prompts ---
section('THE TWO PROMPTS');
const { buildSystemPrompt } = await import('../../src/lib/mcp/socrata-skill.ts');
const { getDefaultPortal } = await import('../../src/lib/site-config.ts');
const portal = process.env.POC_PORTAL || getDefaultPortal() || undefined;
const SHIPPED_PROMPT = await buildSystemPrompt(portal);

const dateLineOf = (p) => p.split('\n').find((l) => l.startsWith("Today's date is")) ?? null;
const PROMPTS = [
  { id: 'harness', text: HARNESS_PROMPT, why: "run-questions.mjs:115-118 — the hand-written string the first questions run used" },
  { id: 'shipped', text: SHIPPED_PROMPT, why: 'buildSystemPrompt(portal) — what /api/compare builds (compare/route.ts:122)' },
];
for (const p of PROMPTS) {
  readout(`${p.id} prompt`, `${p.text.length} chars · date line: ${dateLineOf(p.text) ? JSON.stringify(dateLineOf(p.text)) : 'NONE'}`, p.why);
}
readout('portal', portal ?? '(none — getDefaultPortal() is unset, so no portal is injected)', 'getDefaultPortal()  [src/lib/site-config.ts]');
readout('nyc_record', 'ADVERTISED but NOT configured — no sandbox in this run', 'mcpTools advertises unconditionally; the registry routes to unconfiguredTools');

if (process.env.POC_STEP0_ONLY) {
  log('\n  POC_STEP0_ONLY — stopping here. The credential works, both prompts were');
  log('  composed, and the shipped one carries its date line. No model loop ran.');
  log('  Nothing was created and nothing was billed.');
  process.exit(0);
}

// ------------------------------------------------------------- the runs ---
const { runToolLoop } = await import('../../src/lib/model-loop/run-tool-loop.ts');
const { compareLoopOptions } = await import('../../src/lib/model-loop/compare-loop.ts');

const SOCRATA_TOOLS = ['get_data', 'search', 'fetch'];
const results = [];
section('Q2 UNDER EACH PROMPT, ON EACH MODEL');
log(`  Q2: ${Q2}`);
for (const endpointModel of models) {
  for (const p of PROMPTS) {
    const label = `${endpointModel} / ${p.id}`;
    const t0 = Date.now();
    let r;
    try {
      const out = await runToolLoop(compareLoopOptions({
        client, endpointModel, prompt: Q2, systemPrompt: p.text, portal,
      }));
      const calls = out.toolCalls.map((c) => ({
        name: c.name, args: c.args, operationType: c.operationType ?? null,
        failed: Boolean(c.failed), failureKind: c.failureKind ?? null,
        rows: c.resultSummary?.rows ?? null, durationMs: c.duration_ms ?? null,
      }));
      r = {
        label, endpointModel, prompt: p.id, promptChars: p.text.length,
        dateLine: dateLineOf(p.text), ok: out.content.trim().length > 0,
        elapsedMs: Date.now() - t0, iterations: out.iterations, usage: out.usage,
        recordCalls: calls.filter((c) => c.name.startsWith('nyc_record__')).length,
        socrataCalls: calls.filter((c) => SOCRATA_TOOLS.includes(c.name)).length,
        toolCalls: calls, answer: out.content,
      };
    } catch (e) {
      r = { label, endpointModel, prompt: p.id, ok: false, elapsedMs: Date.now() - t0, error: `${e?.name}: ${e?.message}`, toolCalls: [], recordCalls: 0, socrataCalls: 0 };
    }
    results.push(r);
    log(`\n  ${label}`);
    readout('tool calls', r.toolCalls.length ? r.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 150)})${c.failed ? ` FAILED:${c.failureKind}` : ''} rows=${c.rows}`).join('\n                  ') : '(none)',
      `runToolLoop(compareLoopOptions({ endpointModel: '${endpointModel}', prompt: <Q2>, systemPrompt: <${p.id}> }))`);
    readout('source split', `nyc_record ${r.recordCalls} · socrata ${r.socrataCalls} · failed ${r.toolCalls.filter((c) => c.failed).length}`, 'the same call');
    readout('iterations / tokens', `${r.iterations} / ${r.usage?.totalTokens}`, 'the same call');
    log('  ANSWER:');
    log('  ' + String(r.answer ?? r.error).slice(0, 1400).split('\n').join('\n  '));
    record({ measurement: 'Q2-prompt-contrast', step: 'reading', command: `runToolLoop(compareLoopOptions(...)) with the ${p.id} system prompt`, ...r });
  }
}

// -------------------------------------------------------------- verdict ---
section('SIDE BY SIDE');
for (const r of results) {
  const windows = r.toolCalls
    .map((c) => (typeof c.args?.where === 'string' ? c.args.where : null))
    .filter(Boolean);
  keyLine(`  ${r.label}`, `${r.recordCalls} nyc_record · ${r.socrataCalls} socrata · ${r.iterations} iters · ${r.usage?.totalTokens} tokens`);
  keyLine('    date line in prompt', r.dateLine ? 'YES' : 'NO');
  for (const w of windows) keyLine('    where', w.slice(0, 150));
  keyLine('    answer', String(r.answer ?? r.error).replace(/\s+/g, ' ').slice(0, 260));
}
const crossed = results.filter((r) => r.recordCalls > 0);
keyLine('  nyc_record calls in this run', crossed.length ? `${crossed.length} reading(s) — MATERIAL DIFFERENCE from the original readings, where nyc_record was live` : '0 — same source split as the original readings');

const sp = writeSummary(RUN_ID, {
  runId: RUN_ID, kind: 'q2-prompt-contrast', createsSandbox: false, socrataUrl: SOCRATA_URL,
  portal: portal ?? null, models, question: Q2,
  prompts: PROMPTS.map((p) => ({ id: p.id, chars: p.text.length, dateLine: dateLineOf(p.text), why: p.why })),
  results,
});
log(`\n  log:          ${LOG_PATH}`);
log(`  observations: ${jsonl}`);
log(`  summary:      ${sp}`);
section('DONE');
log(`  readings: ${results.filter((r) => r.ok).length} of ${results.length} answered`);
log('  sandboxes created: 0 — this run needs none');
log('  STRAYS: none possible — nothing was created');
if (results.some((r) => !r.ok)) process.exitCode = 1;
