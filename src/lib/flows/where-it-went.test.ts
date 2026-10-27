// R6 W4 (#632, rulings W4-D1 = A, W4-D2 = A, W4-D3 = A): the builder of
// "Where this question went", `./where-it-went.ts`.
//
// WHAT IT BUILDS. One core, three entry points:
//   - `whereItWentFromSpans({ spans, sourcesOffered, statement, executed? })`:
//     a run, from its spans (each call span's `mcp.source`, each load span's
//     `tool.load_outcome` and the alias in its `tool.arguments`, the first
//     `llm_inference` span's `gen_ai.request.model` and `gen_ai.system`), the
//     run's stated offered set and the statement the consent gate built for it;
//   - `whereItWentFromCalls({ toolCalls, resolveSource, sourcesOffered,
//     statement, model, service, executed? })`: the JSON compare route, which
//     writes no trace (premise 1): its tool-call records, each call's source
//     as the route's resolver gives it, and the model and service it ran;
//   - `whereItWentFromPackage(pkg, served)`: a record, from its trace, its
//     environment's `mcpServers`, its composition's `sourcesOffered` and
//     `flowsStatement`, its notebook extension, and the statement this site
//     serves (passed in; the page builds it). Null for a package with no trace.
// Each returns `{ reached, notReached, statement }`:
//   - `reached`, in order of first contact: the model row (`kind: 'model'`),
//     each source a call reached (`kind: 'source'`, with its call count) and,
//     for an executed run, the notebook runner (`kind: 'notebook'`). Each row
//     holds its recipients: `{ role, place, got?, keptBy }`, `role` by
//     `roleLabel`, `place` by `recipientWhere`, `keptBy` the statement's own
//     `FlowsKeptBy` objects (Stage C: the view renders them as the panel
//     does, through `KeptByLines`), and `upstream: true` on a hosted row's
//     upstream host (`source:<id>:<host>`, R8 W3's shape);
//     `got` is the statement recipient's `receives`, present on the run side
//     and on a record whose reference matches, and ABSENT (no key) otherwise;
//   - `notReached`: every other stated source, `{ sourceId, name, whyNotSent }`
//     (not `reason`, which this repository reserves for a recorded call's
//     phrase: `src/components/reason-phrase-readers.test.ts`);
//   - `statement`: `{ kind: 'in-force' }`, `{ kind: 'reference', date, url }`
//     or `{ kind: 'none' }`.
//
// THE FIXTURES CAN FAIL.
//   - The run statements carry marker strings in every `receives` and holder,
//     so a builder that writes its own words, or reads only the first
//     recipient of a row, gives a different model.
//   - The comparison's first contact (Data Commons, then Socrata) runs against
//     the manifest's order (Socrata first).
//   - The not-offered refusal is driven twice: with `mcp.source` "unknown" and
//     an aliased tool name, so a tool-name split fails; and with `mcp.source`
//     naming the source, so a rule that ignores the kind fails.
//   - The in-loop run holds an On source whose load threw, and a source
//     allowed when asked with no call: a stated-reason row read before the
//     loads gives "On, not used" and "not asked" for them.
//   - The saved records (`./fixtures/record-*.package.json`, read live at G0)
//     are passed today's statement shaped to differ from them: another host,
//     two recipients, a source missing. A build that reads the statement on
//     no match shows the statement's host or two recipients.
// The builder does not exist at the base, so each test fails at its first
// assertion that the export is a function.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG, runRecordAttributes } from '../evidence/trace.ts';
import { statementHash, type FlowsRecipient, type FlowsSource, type FlowsStatement } from './statement.ts';
import { readerSourceName, recipientWhere, roleLabel } from '../sources/source-name.ts';
import * as copyModule from '../sources/copy.ts';
import { REFERENCE_IDENTITY_ENV } from '../evidence/reference-identity-fixture.ts';
import { hostedServerPurl } from '../mcp/registry.ts';

process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;

const { buildEvidencePackage } = await import('../evidence/packager.ts');
const { adaptRecord } = await import('../../components/answer-view/adapt-record.ts');

// --- The model's shape, as this test reads it ------------------------------------

interface RecipientRow { role: string; place: string; got?: string; keptBy?: FlowsRecipient['keptBy']; upstream?: true }
type ReachedRow =
  | { kind: 'model'; name: string; model: string | null; service: string | null; recipients: RecipientRow[] }
  | { kind: 'source'; sourceId: string; name: string; calls: number; recipients: RecipientRow[] }
  | { kind: 'notebook'; name: string; recipients: RecipientRow[] };
interface NotReachedRow { sourceId: string; name: string; whyNotSent: string }
type WhichStatement = { kind: 'in-force' } | { kind: 'reference'; date: string; url: string } | { kind: 'none' };
interface WhereModel { reached: ReachedRow[]; notReached: NotReachedRow[]; statement: WhichStatement }

interface Offered { sourceId: string; alias: string; reason: string }
interface CallRecord {
  name: string;
  args: Record<string, unknown>;
  operationType?: string;
  failed?: boolean;
  failureKind?: string;
  loadOutcome?: string;
}
type FromSpans = (input: { spans: readonly unknown[]; sourcesOffered: readonly Offered[]; statement?: FlowsStatement | null; executed?: boolean }) => WhereModel;
type FromCalls = (input: {
  toolCalls: readonly CallRecord[];
  resolveSource: (name: string) => string | undefined;
  sourcesOffered: readonly Offered[];
  statement?: FlowsStatement | null;
  model: string;
  service: string;
  executed?: boolean;
}) => WhereModel;
type FromPackage = (pkg: unknown, served: FlowsStatement | null) => WhereModel | null;

// --- The builder, loaded if it exists ---------------------------------------------

const BUILDER_URL = new URL('./where-it-went.ts', import.meta.url);
const BUILDER_FILE = fileURLToPath(BUILDER_URL);
const COMPONENT_FILE = fileURLToPath(new URL('../../components/answer-view/WhereItWent.tsx', import.meta.url));

/** The module, or an empty one while the file does not exist; any other load failure is thrown. */
async function loadBuilder(): Promise<Record<string, unknown>> {
  if (!fs.existsSync(BUILDER_FILE)) return {};
  return (await import(BUILDER_URL.href)) as Record<string, unknown>;
}
const builder = await loadBuilder();

function exported<T>(name: string): T {
  const value = builder[name];
  assert.equal(typeof value, 'function', `src/lib/flows/where-it-went.ts exports no function ${name}`);
  return value as T;
}
const fromSpans = (input: Parameters<FromSpans>[0]) => exported<FromSpans>('whereItWentFromSpans')(input);
const fromCalls = (input: Parameters<FromCalls>[0]) => exported<FromCalls>('whereItWentFromCalls')(input);
const fromPackage = (pkg: unknown, served: FlowsStatement | null) => exported<FromPackage>('whereItWentFromPackage')(pkg, served);

// --- The reasons (§2), in their order of precedence --------------------------------

const REASON = {
  allowedNotUsed: 'Ask first: allowed when asked, but not used for this question.',
  declined: 'Ask first: not allowed for this question.',
  noAnswer: 'Ask first: no answer arrived in time, so it was not used.',
  unavailable: 'Unavailable. This site could not load it for this question.',
  onNotUsed: 'On, not used for this question.',
  off: 'Off.',
  notAsked: 'Ask first: not asked for this question.',
  notSetUp: 'Not set up on this site.',
} as const;

const NOT_RECORDED = 'not recorded';

// --- Names --------------------------------------------------------------------------

const MANIFEST_ALIAS: Readonly<Record<string, string>> = Object.fromEntries(CIVIC_MANIFEST.map((e) => [e.sourceId, e.alias]));

/** A source's name: the manifest's, in the reader's language; else the record's alias. */
function nameOf(sourceId: string, alias: string): string {
  const entry = CIVIC_MANIFEST.find((e) => e.sourceId === sourceId);
  return entry ? readerSourceName({ sourceId, displayName: entry.displayName }) : alias;
}

const offered = (sourceId: string, reason: string, alias = MANIFEST_ALIAS[sourceId] ?? sourceId.replace(/-/g, '_')): Offered => ({ sourceId, alias, reason });
const notReached = (o: Offered, whyNotSent: string): NotReachedRow => ({ sourceId: o.sourceId, name: nameOf(o.sourceId, o.alias), whyNotSent });

// --- The run statements -------------------------------------------------------------

const MODEL = 'fixture/model-w4';
const SERVICE = 'openrouter';

const MODEL_RECIPIENT: FlowsRecipient = {
  id: 'model-endpoint', key: 'Model endpoint', role: 'model-endpoint', host: 'model.fixture-w4.example',
  receives: 'RECEIVES-MODEL-w4: your question, and the data the sources return for it',
  keptBy: [{ holder: 'HOLDER-MODEL-w4', keeps: 'operator-states' }],
};
const LOGS_RECIPIENT: FlowsRecipient = {
  id: 'function-logs', key: 'held:function-logs', role: 'function-logs', runsAt: 'Vercel',
  receives: 'RECEIVES-LOGS-w4', keptBy: [{ holder: 'HOLDER-LOGS-w4', keeps: 'metadata' }],
};
const EXECUTOR_RECIPIENT: FlowsRecipient = {
  id: 'notebook-executor', key: 'Notebook execution, `EXECUTOR_DRIVER=vercel-sandbox`', role: 'notebook-executor', runsAt: 'Vercel Sandbox',
  receives: 'RECEIVES-NOTEBOOK-w4: the notebook the AI model writes for your question',
  keptBy: [{ holder: 'HOLDER-NOTEBOOK-w4', keeps: 'not-stated' }],
};

function remoteSource(sourceId: string, host: string, keptBy: FlowsRecipient['keptBy']): FlowsSource {
  const entry = CIVIC_MANIFEST.find((e) => e.sourceId === sourceId);
  return {
    sourceId, displayName: entry?.displayName ?? sourceId, publisher: entry?.publisher ?? 'not stated',
    variant: { variant: 'remote', kind: 'remote', runsAt: 'other' }, host, freshness: 'live',
    recipients: [{ id: `source:${sourceId}`, key: 'MCP servers', role: 'source', host, receives: `RECEIVES-${sourceId}-w4`, keptBy }],
    version: `version-${sourceId}`,
  };
}

const CHARTER_SANDBOX: FlowsRecipient = {
  id: 'source:nyc-charter', key: 'held:sandbox-platform', role: 'sandbox-platform', runsAt: 'instance-sandbox',
  receives: 'RECEIVES-CHARTER-SANDBOX-w4', keptBy: [{ holder: 'HOLDER-SANDBOX-w4', keeps: 'not-stated' }],
};
/** R8 W3's shape: a hosted row's upstream host, a recipient of its own after the sandbox. */
const CHARTER_UPSTREAM: FlowsRecipient = {
  id: 'source:nyc-charter:upstream.fixture-w4.example', key: 'hosted-exchange', role: 'source', host: 'upstream.fixture-w4.example',
  receives: 'RECEIVES-CHARTER-UPSTREAM-w4', keptBy: [{ holder: 'HOLDER-UPSTREAM-w4', keeps: 'metadata' }],
};

function charterSource(recipients: FlowsRecipient[]): FlowsSource {
  return {
    sourceId: 'nyc-charter', displayName: 'NYC Charter, Laws and Rules MCP Server', publisher: 'BetaNYC',
    variant: { variant: 'sandbox', kind: 'npm-package', runsAt: 'instance-sandbox', package: '@betanyc/nyc-charter-laws-rules', version: '0.3.1' },
    freshness: 'pinned', recipients, version: 'version-nyc-charter',
  };
}

const SOCRATA_SOURCE = remoteSource('socrata', 'socrata.fixture-w4.example', [
  { holder: 'HOLDER-SOCRATA-OPERATOR-w4', keeps: 'operator-states' },
  { holder: 'HOLDER-SOCRATA-PORTAL-w4', keeps: 'not-stated' },
]);
const DATA_COMMONS_SOURCE = remoteSource('data-commons', 'dc.fixture-w4.example', [{ holder: 'HOLDER-DC-w4', keeps: 'content' }]);
const BOSTON_SOURCE = remoteSource('boston-opencontext', 'boston.fixture-w4.example', [{ holder: 'HOLDER-BOSTON-w4', keeps: 'metadata' }]);

const RUN_STATEMENT: FlowsStatement = {
  version: 'base-version-w4', date: '2026-10-21',
  recipients: [MODEL_RECIPIENT, LOGS_RECIPIENT, EXECUTOR_RECIPIENT],
  sources: [SOCRATA_SOURCE, DATA_COMMONS_SOURCE, BOSTON_SOURCE, charterSource([CHARTER_SANDBOX])],
  links: { privacy: '/privacy' },
};
const HOSTED_STATEMENT: FlowsStatement = {
  ...RUN_STATEMENT,
  sources: [SOCRATA_SOURCE, DATA_COMMONS_SOURCE, charterSource([CHARTER_SANDBOX, CHARTER_UPSTREAM])],
};

/** A statement recipient as the run side shows it. */
const shown = (r: FlowsRecipient, sourceId?: string): RecipientRow => ({
  role: roleLabel(r.role), place: recipientWhere(r), got: r.receives, keptBy: r.keptBy,
  ...(sourceId !== undefined && r.id.startsWith(`source:${sourceId}:`) ? { upstream: true as const } : {}),
});

function sourceRow(statement: FlowsStatement, sourceId: string, calls: number): ReachedRow {
  const row = statement.sources.find((s) => s.sourceId === sourceId);
  assert.ok(row, `premise: the statement lists ${sourceId}`);
  return { kind: 'source', sourceId, name: nameOf(sourceId, MANIFEST_ALIAS[sourceId] ?? sourceId), calls, recipients: row.recipients.map((r) => shown(r, sourceId)) };
}
const modelRow = (statement: FlowsStatement, model = MODEL, service = SERVICE): ReachedRow => ({
  kind: 'model', name: roleLabel('model-endpoint'), model, service,
  recipients: statement.recipients.filter((r) => r.role === 'model-endpoint').map((r) => shown(r)),
});
const notebookRow = (statement: FlowsStatement): ReachedRow => ({
  kind: 'notebook', name: roleLabel('notebook-executor'),
  recipients: statement.recipients.filter((r) => r.role === 'notebook-executor').map((r) => shown(r)),
});

// --- A run: its spans, and the same calls as the JSON route holds them -----------------

type Step =
  | { llm: true }
  | { call: string; source: string; failureKind?: string }
  | { load: string; outcome: string };

const llm: Step = { llm: true };
const call = (name: string, source: string, failureKind?: string): Step => ({ call: name, source, ...(failureKind ? { failureKind } : {}) });
const load = (alias: string, outcome: string): Step => ({ load: alias, outcome });

/** The run's spans, written by the harness's own builder as the loop writes them. */
function spansOf(steps: readonly Step[]): unknown[] {
  const b = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  b.startRoot('analysis', {});
  let inference = 0;
  for (const step of steps) {
    if ('llm' in step) {
      b.endSpan(b.startSpan('llm_inference', b.rootSpanId, { 'gen_ai.system': SERVICE, 'gen_ai.request.model': MODEL, 'gen_ai.inference_index': inference++ }));
    } else if ('call' in step) {
      const id = b.startSpan('mcp_tool_call', b.rootSpanId, {
        'tool.name': step.call,
        'tool.operation_type': 'query',
        'tool.arguments': JSON.stringify({ query: `ARGS-${step.call}-w4` }),
        'mcp.source': step.source,
      });
      b.endSpan(id, step.failureKind ? { error: true, 'error.kind': step.failureKind, 'tool.duration_ms': 7 } : { 'tool.duration_ms': 7, 'tool.response_rows': 1 });
    } else {
      const id = b.startSpan('mcp_tool_call', b.rootSpanId, {
        'tool.name': 'load_source',
        'tool.operation_type': 'load_source',
        'tool.arguments': JSON.stringify({ alias: step.load }),
      });
      b.endSpan(id, { 'tool.load_outcome': step.outcome, 'tool.duration_ms': 1 });
    }
  }
  b.endRoot();
  const trace = b.finalize();
  return trace.resourceSpans[0].scopeSpans[0].spans;
}

/** The same run as the JSON compare route holds it: its tool-call records and its resolver. */
function callsOf(steps: readonly Step[]): { toolCalls: CallRecord[]; resolveSource: (name: string) => string | undefined } {
  const sources = new Map<string, string>();
  const toolCalls: CallRecord[] = [];
  for (const step of steps) {
    if ('call' in step) {
      if (step.source !== 'unknown') sources.set(step.call, step.source);
      toolCalls.push({
        name: step.call, args: { query: `ARGS-${step.call}-w4` }, operationType: 'query',
        ...(step.failureKind ? { failed: true, failureKind: step.failureKind } : {}),
      });
    } else if ('load' in step) {
      toolCalls.push({ name: 'load_source', args: { alias: step.load }, operationType: 'load_source', loadOutcome: step.outcome });
    }
  }
  return { toolCalls, resolveSource: (name) => sources.get(name) };
}

interface Run { steps: Step[]; sourcesOffered: Offered[]; statement: FlowsStatement; executed?: boolean }
const overSpans = (run: Run) => fromSpans({ spans: spansOf(run.steps), sourcesOffered: run.sourcesOffered, statement: run.statement, ...(run.executed ? { executed: true } : {}) });
const overCalls = (run: Run) => fromCalls({
  ...callsOf(run.steps), sourcesOffered: run.sourcesOffered, statement: run.statement, model: MODEL, service: SERVICE,
  ...(run.executed ? { executed: true } : {}),
});

// --- The runs of criterion 1 --------------------------------------------------------

const C = {
  socrata: offered('socrata', 'selected'),
  dc: offered('data-commons', 'selected'),
  boston: offered('boston-opencontext', 'not-configured'),
  charterOff: offered('nyc-charter', 'reader-off'),
};
const COMPARISON: Run = {
  steps: [llm, call('data_commons__get_observations', 'data-commons'), llm, call('socrata__get_data', 'socrata'), call('socrata__get_data', 'socrata'), llm],
  sourcesOffered: [C.socrata, C.dc, C.boston, C.charterOff],
  statement: RUN_STATEMENT,
};

const N = {
  socrata: offered('socrata', 'selected'),
  dcOff: offered('data-commons', 'reader-off'),
  boston: offered('boston-opencontext', 'not-configured'),
  charter: offered('nyc-charter', 'selected'),
};
const NOTEBOOK_RUN: Run = {
  steps: [llm, call('nyc_charter__search', 'nyc-charter'), llm, call('nyc_charter__get_section', 'nyc-charter'), llm],
  sourcesOffered: [N.socrata, N.dcOff, N.boston, N.charter],
  statement: RUN_STATEMENT,
  executed: true,
};

const HOSTED_RUN: Run = {
  steps: [llm, call('nyc_charter__get_section', 'nyc-charter'), llm],
  sourcesOffered: [offered('socrata', 'reader-off'), offered('nyc-charter', 'selected')],
  statement: HOSTED_STATEMENT,
};

const R = {
  socrata: offered('socrata', 'selected'),
  dcOff: offered('data-commons', 'reader-off'),
  bostonUnset: offered('boston-opencontext', 'not-configured'),
  charterAsk: offered('nyc-charter', 'not-consented'),
};
/** One `not_offered` refusal as the dispatch writes it: no source resolved, an aliased name. */
const REFUSED_UNKNOWN: Run = {
  steps: [llm, call('data_commons__get_observations', 'unknown', 'not_offered'), llm, call('socrata__get_data', 'socrata'), llm],
  sourcesOffered: [R.socrata, R.dcOff, R.bostonUnset, R.charterAsk],
  statement: RUN_STATEMENT,
};
/** The kind decides, whatever the span's source says: `not_offered` and `not_configured` are not received. */
const REFUSED_NAMED: Run = {
  steps: [llm, call('nyc_charter__search', 'nyc-charter', 'not_offered'), call('boston__ckan__search', 'boston-opencontext', 'not_configured'), llm, call('socrata__get_data', 'socrata'), llm],
  sourcesOffered: [R.socrata, R.dcOff, R.bostonUnset, R.charterAsk],
  statement: RUN_STATEMENT,
};

const L = {
  socrata: offered('socrata', 'selected'),
  dc: offered('data-commons', 'selected'),
  bostonAsk: offered('boston-opencontext', 'not-consented'),
  charter: offered('nyc-charter', 'selected'),
  declined: offered('fixture-declined-w4', 'not-consented', 'fixture_declined'),
  noAnswer: offered('fixture-no-answer-w4', 'not-consented', 'fixture_no_answer'),
  unset: offered('fixture-unset-w4', 'not-configured', 'fixture_unset'),
};
/** D2: an in-loop run. Every load outcome, and one source called. */
const IN_LOOP_RUN: Run = {
  steps: [
    llm,
    load('socrata', 'loaded'),
    load('data_commons', 'loaded'),
    load('boston', 'loaded'),
    load('nyc_charter', 'unavailable'),
    load('fixture_declined', 'no-answer'),
    load('fixture_declined', 'declined'),
    load('fixture_no_answer', 'no-answer'),
    load('fixture_unset', 'not-offered'),
    load('nowhere_w4', 'not-offered'),
    llm,
    call('socrata__get_data', 'socrata'),
    llm,
  ],
  sourcesOffered: [L.socrata, L.dc, L.bostonAsk, L.charter, L.declined, L.noAnswer, L.unset],
  statement: RUN_STATEMENT,
};

const S = {
  socrata: offered('socrata', 'configured'),
  dcOff: offered('data-commons', 'reader-off'),
  bostonAsk: offered('boston-opencontext', 'not-consented'),
  charterUnset: offered('nyc-charter', 'not-configured'),
};
/** The stated reasons, with no load and no call: the model endpoint alone is reached. */
const STATED_RUN: Run = {
  steps: [llm],
  sourcesOffered: [S.socrata, S.dcOff, S.bostonAsk, S.charterUnset],
  statement: RUN_STATEMENT,
};

const F = { socrata: offered('socrata', 'selected'), dc: offered('data-commons', 'selected'), boston: offered('boston-opencontext', 'selected') };
/** Calls that failed in ways the request may have arrived: each source counts as reached. */
const FAILED_RUN: Run = {
  steps: [llm, call('socrata__get_data', 'socrata', 'unavailable'), call('data_commons__get_observations', 'data-commons', 'timeout'), call('boston__ckan__search', 'boston-opencontext', 'unknown'), llm],
  sourcesOffered: [F.socrata, F.dc, F.boston],
  statement: RUN_STATEMENT,
};

// --- Criterion 1: the builder, line by line -------------------------------------------

test('criterion 1: a comparison lists the model endpoint, then each source in order of first contact, not the manifest\'s', () => {
  const order = CIVIC_MANIFEST.map((e) => e.sourceId);
  assert.ok(order.indexOf('socrata') < order.indexOf('data-commons'), 'premise: the manifest lists Socrata before Data Commons');
  assert.deepEqual(overSpans(COMPARISON), {
    reached: [modelRow(RUN_STATEMENT), sourceRow(RUN_STATEMENT, 'data-commons', 1), sourceRow(RUN_STATEMENT, 'socrata', 2)],
    notReached: [notReached(C.boston, REASON.notSetUp), notReached(C.charterOff, REASON.off)],
    statement: { kind: 'in-force' },
  });
});

test('criterion 1: a notebook run with Charter lists the sandbox row and the notebook runner', () => {
  const model = overSpans(NOTEBOOK_RUN);
  assert.deepEqual(model, {
    reached: [modelRow(RUN_STATEMENT), sourceRow(RUN_STATEMENT, 'nyc-charter', 2), notebookRow(RUN_STATEMENT)],
    notReached: [notReached(N.socrata, REASON.onNotUsed), notReached(N.dcOff, REASON.off), notReached(N.boston, REASON.notSetUp)],
    statement: { kind: 'in-force' },
  });
  const charter = model.reached.find((r) => r.kind === 'source' && r.sourceId === 'nyc-charter');
  assert.deepEqual(charter?.recipients.map((r) => [r.role, r.place]), [['Sandbox platform', "this site's sandbox"]]);
  assert.deepEqual(model.reached.at(-1)?.recipients.map((r) => r.place), ['Vercel Sandbox'], 'the runner at its place');
});

test('criterion 1: a hosted source whose row carries the sandbox and an upstream host lists both recipients, in order', () => {
  const row = HOSTED_STATEMENT.sources.find((s) => s.sourceId === 'nyc-charter');
  assert.equal(row?.recipients.length, 2, 'premise: the row carries two recipients (R8 W3\'s shape)');
  const model = overSpans(HOSTED_RUN);
  assert.deepEqual(model.reached, [modelRow(HOSTED_STATEMENT), sourceRow(HOSTED_STATEMENT, 'nyc-charter', 1)]);
  const charter = model.reached[1];
  assert.deepEqual(charter.recipients.map((r) => r.place), ["this site's sandbox", 'upstream.fixture-w4.example'], 'every recipient, never only the first');
  assert.deepEqual(model.notReached, [notReached(offered('socrata', 'reader-off'), REASON.off)]);
});

test('criterion 1: a not_offered refusal does not make a source reached, and an aliased tool name is not a source', () => {
  assert.deepEqual(overSpans(REFUSED_UNKNOWN), {
    reached: [modelRow(RUN_STATEMENT), sourceRow(RUN_STATEMENT, 'socrata', 1)],
    notReached: [notReached(R.dcOff, REASON.off), notReached(R.bostonUnset, REASON.notSetUp), notReached(R.charterAsk, REASON.notAsked)],
    statement: { kind: 'in-force' },
  });
});

test('criterion 1: a call that failed not_offered or not_configured is not received, whatever its span names', () => {
  assert.deepEqual(overSpans(REFUSED_NAMED), {
    reached: [modelRow(RUN_STATEMENT), sourceRow(RUN_STATEMENT, 'socrata', 1)],
    notReached: [notReached(R.dcOff, REASON.off), notReached(R.bostonUnset, REASON.notSetUp), notReached(R.charterAsk, REASON.notAsked)],
    statement: { kind: 'in-force' },
  });
});

test('criterion 1 (D2): an in-loop run reads each source\'s last load before its stated reason, and a load reaches no source', () => {
  assert.deepEqual(overSpans(IN_LOOP_RUN), {
    reached: [modelRow(RUN_STATEMENT), sourceRow(RUN_STATEMENT, 'socrata', 1)],
    notReached: [
      notReached(L.dc, REASON.onNotUsed),
      notReached(L.bostonAsk, REASON.allowedNotUsed),
      notReached(L.charter, REASON.unavailable),
      notReached(L.declined, REASON.declined),
      notReached(L.noAnswer, REASON.noAnswer),
      notReached(L.unset, REASON.notSetUp),
    ],
    statement: { kind: 'in-force' },
  });
});

test('criterion 1: the stated reasons, with no load and no call; the model endpoint alone is reached', () => {
  assert.deepEqual(overSpans(STATED_RUN), {
    reached: [modelRow(RUN_STATEMENT)],
    notReached: [notReached(S.socrata, REASON.onNotUsed), notReached(S.dcOff, REASON.off), notReached(S.bostonAsk, REASON.notAsked), notReached(S.charterUnset, REASON.notSetUp)],
    statement: { kind: 'in-force' },
  });
});

test('criterion 1: a source whose only call failed unavailable, timeout or unknown is listed as reached', () => {
  assert.deepEqual(overSpans(FAILED_RUN), {
    reached: [modelRow(RUN_STATEMENT), sourceRow(RUN_STATEMENT, 'socrata', 1), sourceRow(RUN_STATEMENT, 'data-commons', 1), sourceRow(RUN_STATEMENT, 'boston-opencontext', 1)],
    notReached: [],
    statement: { kind: 'in-force' },
  });
});

for (const [label, run] of [
  ['the comparison', COMPARISON],
  ['the notebook run', NOTEBOOK_RUN],
  ['the hosted run', HOSTED_RUN],
  ['the unresolved refusal', REFUSED_UNKNOWN],
  ['the named refusals', REFUSED_NAMED],
  ['the in-loop run', IN_LOOP_RUN],
  ['the stated reasons', STATED_RUN],
  ['the failed calls', FAILED_RUN],
] as const) {
  test(`criterion 1: the JSON compare route's inputs give the same rows as the spans of the same calls (${label})`, () => {
    const spans = overSpans(run);
    assert.ok(spans.reached.length >= 1, 'premise: the spans give rows');
    assert.deepEqual(overCalls(run), spans);
  });
}

// --- Criterion 1: the two files read nothing from the environment ----------------------

test('criterion 1: where-it-went.ts and WhereItWent.tsx read nothing from process.env', () => {
  for (const file of [BUILDER_FILE, COMPONENT_FILE]) {
    assert.ok(fs.existsSync(file), `${file} does not exist`);
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\bprocess\s*(\.\s*env\b|\[\s*['"`]env['"`]\s*\])/, `${file} reads process.env`);
  }
});

// --- Criterion 3: the named records, from their saved copies ---------------------------

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')) as Record<string, unknown>;

const D887C1 = fixture('record-d887c1.package.json');
const R397939 = fixture('record-397939.package.json');
const R2F32D9 = fixture('record-2f32d9.package.json');
/** The bytes production served at d887c1's publication (`flows-four.sh`, "both"), hash 78c516db…. */
const SERVED_78 = fixture('flows-statement-78c516db.json') as unknown as FlowsStatement;

const D887C1_REFERENCE = { url: 'https://app.civicaitools.org/api/flows', hash: '78c516db86bf5af90f0f0de1f6c3a614b6ff1c9026b27a25620fbc7c52ecd995', date: '2026-10-20' };
const RECORD_MODEL = 'anthropic/claude-haiku-5.5';
const RECORD_SERVICE = 'openrouter';

/** The record side with no match: one recipient, its place from the record, no "what it got", "not recorded" kept-by lines. */
/** Stage C: no kept-by lines at all on no match; the view says so once, for every row. */
const recorded = (role: string, place: string): RecipientRow => ({ role, place });
const unmatchedModel: ReachedRow = { kind: 'model', name: roleLabel('model-endpoint'), model: RECORD_MODEL, service: RECORD_SERVICE, recipients: [recorded(roleLabel('model-endpoint'), NOT_RECORDED)] };
const unmatchedNotebook: ReachedRow = { kind: 'notebook', name: roleLabel('notebook-executor'), recipients: [recorded(roleLabel('notebook-executor'), NOT_RECORDED)] };
const recordSource = (sourceId: string, calls: number, place: string): ReachedRow => ({
  kind: 'source', sourceId, name: nameOf(sourceId, MANIFEST_ALIAS[sourceId] ?? sourceId), calls, recipients: [recorded(roleLabel('source'), place)],
});

/** Today's statement, shaped to differ from d887c1: Socrata at another host, with two recipients. */
function differingStatement(): FlowsStatement {
  const s = structuredClone(SERVED_78);
  const socrata = s.sources.find((x) => x.sourceId === 'socrata');
  assert.ok(socrata, 'premise: the served statement lists Socrata');
  socrata.host = 'socrata-moved.fixture-w4.example';
  socrata.recipients = [
    { ...socrata.recipients[0], host: 'socrata-moved.fixture-w4.example' },
    { ...socrata.recipients[0], id: 'source:socrata:second.fixture-w4.example', host: 'second.fixture-w4.example' },
  ];
  return s;
}

const D887C1_NOT_REACHED = [
  { sourceId: 'data-commons', name: 'Data Commons', whyNotSent: REASON.off },
  { sourceId: 'boston-opencontext', name: 'Boston OpenContext', whyNotSent: REASON.notSetUp },
  { sourceId: 'nyc-charter', name: 'NYC Charter, Laws and Rules', whyNotSent: REASON.onNotUsed },
];

test('criterion 3 premises: the saved records hold what the contract names', () => {
  const comp = (pkg: Record<string, unknown>) => (pkg.extensions as Record<string, Record<string, unknown>>)['org.civicaitools.composition'];
  assert.deepEqual(comp(D887C1).flowsStatement, D887C1_REFERENCE);
  assert.deepEqual((comp(D887C1).sourcesOffered as Offered[]).map((o) => o.reason), ['selected', 'reader-off', 'not-configured', 'selected']);
  assert.equal(statementHash(SERVED_78), D887C1_REFERENCE.hash, 'the saved statement is the one d887c1 references');
  assert.equal(comp(R397939).flowsStatement, undefined, '397939 carries no reference');
  assert.equal(comp(R2F32D9).flowsStatement, undefined, '2f32d9 carries no reference');
});

test('criterion 3: d887c1, passed the statement with its hash: the kept-by lines and what each got are the statement\'s', () => {
  assert.deepEqual(fromPackage(D887C1, SERVED_78), {
    reached: [modelRow(SERVED_78, RECORD_MODEL, RECORD_SERVICE), sourceRow(SERVED_78, 'socrata', 1), notebookRow(SERVED_78)],
    notReached: D887C1_NOT_REACHED,
    statement: { kind: 'in-force' },
  });
});

for (const [label, served] of [
  ['a statement without that hash', (() => { const s = structuredClone(SERVED_78); s.recipients[0].receives = 'RECEIVES-CHANGED-w4'; return s; })()],
  ['a statement shaped to differ (another host, two recipients)', differingStatement()],
] as const) {
  test(`criterion 3: d887c1, passed ${label}: "not recorded", the record's host and one recipient, the reference's date and address`, () => {
    assert.notEqual(statementHash(served), D887C1_REFERENCE.hash, 'premise: the hashes differ');
    assert.deepEqual(fromPackage(D887C1, served), {
      reached: [unmatchedModel, recordSource('socrata', 1, 'socrata-mcp.civicaitools.org'), unmatchedNotebook],
      notReached: D887C1_NOT_REACHED,
      statement: { kind: 'reference', date: D887C1_REFERENCE.date, url: D887C1_REFERENCE.url },
    });
  });
}

test('criterion 3: 397939, no reference: its host from mcpServers, "not recorded", and a source today\'s statement does not list is still shown', () => {
  const withoutDc = structuredClone(SERVED_78);
  withoutDc.sources = withoutDc.sources.filter((s) => s.sourceId !== 'data-commons');
  const expected = {
    reached: [unmatchedModel, recordSource('data-commons', 2, 'api.datacommons.org'), unmatchedNotebook],
    notReached: [
      { sourceId: 'socrata', name: 'Socrata', whyNotSent: REASON.onNotUsed },
      { sourceId: 'boston-opencontext', name: 'Boston OpenContext', whyNotSent: REASON.notSetUp },
    ],
    statement: { kind: 'none' },
  };
  assert.deepEqual(fromPackage(R397939, SERVED_78), expected);
  assert.deepEqual(fromPackage(R397939, withoutDc), expected);
});

test('criterion 3: 2f32d9, no reference: its host from mcpServers and "not recorded"', () => {
  assert.deepEqual(fromPackage(R2F32D9, SERVED_78), {
    reached: [unmatchedModel, recordSource('socrata', 2, 'socrata-mcp.civicaitools.org'), unmatchedNotebook],
    notReached: [
      { sourceId: 'data-commons', name: 'Data Commons', whyNotSent: REASON.onNotUsed },
      { sourceId: 'boston-opencontext', name: 'Boston OpenContext', whyNotSent: REASON.notSetUp },
    ],
    statement: { kind: 'none' },
  });
});

test('criterion 3: a package with no trace gives no section', () => {
  const { trace: _trace, ...traceless } = D887C1;
  void _trace;
  assert.ok(typeof exported<FromPackage>('whereItWentFromPackage') === 'function');
  assert.equal(fromPackage(traceless, SERVED_78), null);
  assert.equal(fromPackage({ ...R397939, trace: undefined }, null), null);
});

test('criterion 3: a package the real packager builds from a run with a reference reads back in-force or reference by the same rule', () => {
  const reference = { url: 'https://site.fixture-w4.example/api/flows', hash: statementHash(RUN_STATEMENT), date: RUN_STATEMENT.date };
  const b = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  b.startRoot('analysis', runRecordAttributes({
    assertedDate: '2026-10-21',
    mcpServers: [{ url: 'https://socrata.record-w4.example/mcp', name: 'socrata' }],
    toolDefinitions: [],
    sourcesOffered: [offered('socrata', 'selected'), offered('data-commons', 'reader-off')],
    components: [],
    flowsStatement: reference,
  }));
  b.endSpan(b.startSpan('llm_inference', b.rootSpanId, { 'gen_ai.system': SERVICE, 'gen_ai.request.model': MODEL }));
  b.endSpan(b.startSpan('mcp_tool_call', b.rootSpanId, {
    'tool.name': 'socrata__get_data', 'tool.operation_type': 'query', 'tool.arguments': JSON.stringify({ type: 'query', dataset_id: 'erm2-nwe9' }), 'mcp.source': 'socrata',
  }), { 'tool.duration_ms': 9 });
  b.endRoot();
  const { pkg } = buildEvidencePackage({
    trace: b.finalize() as unknown as Record<string, unknown>,
    prompt: 'PROMPT-w4: how many complaints?',
    output: 'OUTPUT-w4',
    toolCalls: [{ name: 'socrata__get_data', args: { type: 'query', dataset_id: 'erm2-nwe9' }, resultSummary: { rows: 1, columns: 1 } }],
    model: MODEL,
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'R6 W4 criterion 3',
    summary: 'R6 W4 criterion 3.',
    // A full-text publish is datHere: the profile whose package carries the environment's `mcpServers`.
    contentProfile: 'datHere',
    captureMethod: 'chat-flow-stream',
  });
  const composition = (pkg.extensions as Record<string, Record<string, unknown>> | undefined)?.['org.civicaitools.composition'];
  assert.deepEqual(composition?.flowsStatement, reference, 'premise: the package carries the run\'s reference');
  assert.deepEqual((pkg.extensions as Record<string, Record<string, unknown>> | undefined)?.['org.civicaitools.environment']?.mcpServers, [{ url: 'https://socrata.record-w4.example/mcp', name: 'socrata' }], 'premise: the package carries the run\'s servers');

  const notReachedDc = [{ sourceId: 'data-commons', name: 'Data Commons', whyNotSent: REASON.off }];
  assert.deepEqual(fromPackage(pkg, RUN_STATEMENT), {
    reached: [modelRow(RUN_STATEMENT), sourceRow(RUN_STATEMENT, 'socrata', 1)],
    notReached: notReachedDc,
    statement: { kind: 'in-force' },
  });
  assert.deepEqual(fromPackage(pkg, HOSTED_STATEMENT), {
    reached: [
      { kind: 'model', name: roleLabel('model-endpoint'), model: MODEL, service: SERVICE, recipients: [recorded(roleLabel('model-endpoint'), NOT_RECORDED)] },
      recordSource('socrata', 1, 'socrata.record-w4.example'),
    ],
    notReached: notReachedDc,
    statement: { kind: 'reference', date: reference.date, url: reference.url },
  });
});

test('criterion 3: a record with no reference whose reached source is a pkg: entry places it in this site\'s sandbox', () => {
  const charter = CIVIC_MANIFEST.find((e) => e.sourceId === 'nyc-charter');
  const pin = charter?.hostings.find((v) => v.kind === 'npm-package');
  assert.ok(pin?.kind === 'npm-package', 'premise: the manifest holds a hosted nyc-charter entry');
  const purl = hostedServerPurl(pin);
  assert.ok(purl.startsWith('pkg:'), `premise: the hosted server's address is a pkg: entry (${purl})`);
  const b = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  b.startRoot('analysis', runRecordAttributes({
    assertedDate: '2026-10-21',
    mcpServers: [{ url: 'https://socrata.record-w4.example/mcp', name: 'socrata' }, { url: purl, name: 'nyc-charter' }],
    toolDefinitions: [],
    sourcesOffered: [offered('socrata', 'selected'), offered('nyc-charter', 'selected')],
    components: [],
  }));
  b.endSpan(b.startSpan('llm_inference', b.rootSpanId, { 'gen_ai.system': SERVICE, 'gen_ai.request.model': MODEL }));
  b.endSpan(b.startSpan('mcp_tool_call', b.rootSpanId, {
    'tool.name': 'nyc_charter__get_section', 'tool.operation_type': 'query', 'tool.arguments': JSON.stringify({ citation: '26-504' }), 'mcp.source': 'nyc-charter',
  }), { 'tool.duration_ms': 9 });
  b.endRoot();
  const { pkg } = buildEvidencePackage({
    trace: b.finalize() as unknown as Record<string, unknown>,
    prompt: 'PROMPT-w4: what does section 26-504 cover?',
    output: 'OUTPUT-w4',
    toolCalls: [{ name: 'nyc_charter__get_section', args: { citation: '26-504' }, resultSummary: { rows: 1, columns: 1 } }],
    model: MODEL,
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'R6 W4 criterion 3, Charter',
    summary: 'R6 W4 criterion 3, Charter.',
    // A full-text publish is datHere: the profile whose package carries the environment's `mcpServers`.
    contentProfile: 'datHere',
    captureMethod: 'chat-flow-stream',
  });
  assert.deepEqual(fromPackage(pkg, RUN_STATEMENT), {
    reached: [
      { kind: 'model', name: roleLabel('model-endpoint'), model: MODEL, service: SERVICE, recipients: [recorded(roleLabel('model-endpoint'), NOT_RECORDED)] },
      { kind: 'source', sourceId: 'nyc-charter', name: 'NYC Charter, Laws and Rules', calls: 1, recipients: [recorded(roleLabel('sandbox-platform'), "this site's sandbox")] },
    ],
    notReached: [{ sourceId: 'socrata', name: 'Socrata', whyNotSent: REASON.onNotUsed }],
    statement: { kind: 'none' },
  });
});

test('criterion 3 (ruling F3): a record that is not datHere reads its servers from the trace root, else its places read "not recorded"', () => {
  const charter = CIVIC_MANIFEST.find((e) => e.sourceId === 'nyc-charter');
  const pin = charter?.hostings.find((v) => v.kind === 'npm-package');
  assert.ok(pin?.kind === 'npm-package', 'premise: the manifest holds a hosted nyc-charter entry');
  const servers = [{ url: 'https://socrata.root-w4.example/mcp', name: 'socrata' }, { url: hostedServerPurl(pin), name: 'nyc-charter' }];
  const b = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  b.startRoot('analysis', runRecordAttributes({
    assertedDate: '2026-10-21',
    mcpServers: servers,
    toolDefinitions: [],
    sourcesOffered: [offered('socrata', 'selected'), offered('data-commons', 'reader-off'), offered('nyc-charter', 'selected')],
    components: [],
  }));
  b.endSpan(b.startSpan('llm_inference', b.rootSpanId, { 'gen_ai.system': SERVICE, 'gen_ai.request.model': MODEL }));
  b.endSpan(b.startSpan('mcp_tool_call', b.rootSpanId, {
    'tool.name': 'nyc_charter__search', 'tool.operation_type': 'query', 'tool.arguments': JSON.stringify({ query: 'rent' }), 'mcp.source': 'nyc-charter',
  }), { 'tool.duration_ms': 9 });
  b.endSpan(b.startSpan('mcp_tool_call', b.rootSpanId, {
    'tool.name': 'socrata__get_data', 'tool.operation_type': 'query', 'tool.arguments': JSON.stringify({ type: 'query', dataset_id: 'erm2-nwe9' }), 'mcp.source': 'socrata',
  }), { 'tool.duration_ms': 9 });
  b.endRoot();
  const { pkg } = buildEvidencePackage({
    trace: b.finalize() as unknown as Record<string, unknown>,
    prompt: 'PROMPT-w4: rent rules and complaints?',
    output: 'OUTPUT-w4',
    toolCalls: [
      { name: 'nyc_charter__search', args: { query: 'rent' }, resultSummary: { rows: 1, columns: 1 } },
      { name: 'socrata__get_data', args: { type: 'query', dataset_id: 'erm2-nwe9' }, resultSummary: { rows: 1, columns: 1 } },
    ],
    model: MODEL,
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'hash_only',
    title: 'R6 W4 criterion 3, trace root',
    summary: 'R6 W4 criterion 3, trace root.',
  });
  const extensions = (pkg.extensions ?? {}) as Record<string, Record<string, unknown>>;
  assert.equal(extensions['org.civicaitools.environment'], undefined, 'premise: a package that is not datHere carries no environment block');

  const model = { kind: 'model', name: roleLabel('model-endpoint'), model: MODEL, service: SERVICE, recipients: [recorded(roleLabel('model-endpoint'), NOT_RECORDED)] } as const;
  const notReachedDc = [{ sourceId: 'data-commons', name: 'Data Commons', whyNotSent: REASON.off }];
  assert.deepEqual(fromPackage(pkg, RUN_STATEMENT), {
    reached: [
      model,
      { kind: 'source', sourceId: 'nyc-charter', name: 'NYC Charter, Laws and Rules', calls: 1, recipients: [recorded(roleLabel('sandbox-platform'), "this site's sandbox")] },
      recordSource('socrata', 1, 'socrata.root-w4.example'),
    ],
    notReached: notReachedDc,
    statement: { kind: 'none' },
  });

  // The same package with the root's list removed: no list anywhere, so each place reads "not recorded".
  const bare = structuredClone(pkg) as unknown as { trace: { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ parentSpanId?: string; attributes: Array<{ key: string }> }> }> }> } };
  const root = bare.trace.resourceSpans[0].scopeSpans[0].spans.find((s) => s.parentSpanId === undefined);
  assert.ok(root && root.attributes.some((a) => a.key === 'analysis.mcp_servers'), 'premise: the root span carries the list');
  root.attributes = root.attributes.filter((a) => a.key !== 'analysis.mcp_servers');
  assert.deepEqual(fromPackage(bare, RUN_STATEMENT), {
    reached: [
      model,
      { kind: 'source', sourceId: 'nyc-charter', name: 'NYC Charter, Laws and Rules', calls: 1, recipients: [recorded(roleLabel('source'), NOT_RECORDED)] },
      recordSource('socrata', 1, NOT_RECORDED),
    ],
    notReached: notReachedDc,
    statement: { kind: 'none' },
  });
});

test('criterion 3: the record adapter hands the view the builder\'s model, from the statement it is passed', () => {
  const row = { slug: 'noise-trends-in-nyc-last-week-d887c1', summary: 'SUMMARY-w4', contentProfile: 'datHere', captureMethod: 'chat-flow-stream' };
  const adapt = adaptRecord as unknown as (input: Record<string, unknown>) => Record<string, unknown>;
  for (const served of [SERVED_78, differingStatement()]) {
    const view = adapt({ stored: D887C1, resolution: null, row, instance: 'records.fixture-w4.example', servedStatement: served });
    assert.deepEqual(view.whereItWent, fromPackage(D887C1, served));
  }
  const { trace: _trace, ...traceless } = D887C1;
  void _trace;
  const none = adapt({ stored: traceless, resolution: null, row, instance: null, servedStatement: SERVED_78 });
  assert.equal(Object.hasOwn(none, 'whereItWent'), false, 'a traceless record\'s view has no section');
});

// --- Criterion 4: the words ---------------------------------------------------------

const ALL_RUNS: Array<[string, Run]> = [
  ['the comparison', COMPARISON], ['the notebook run', NOTEBOOK_RUN], ['the hosted run', HOSTED_RUN],
  ['the in-loop run', IN_LOOP_RUN], ['the failed calls', FAILED_RUN],
];

test('criterion 4: on the run side, each reached row\'s "what it got" is its statement recipient\'s receives, byte for byte', () => {
  let rows = 0;
  for (const [label, run] of ALL_RUNS) {
    const model = overSpans(run);
    for (const reached of model.reached) {
      const recipients = reached.kind === 'model'
        ? run.statement.recipients.filter((r) => r.role === 'model-endpoint')
        : reached.kind === 'notebook'
          ? run.statement.recipients.filter((r) => r.role === 'notebook-executor')
          : run.statement.sources.find((s) => s.sourceId === reached.sourceId)?.recipients ?? [];
      assert.deepEqual(reached.recipients.map((r) => r.got), recipients.map((r) => r.receives), `${label}: ${reached.name}`);
      rows += reached.recipients.length;
    }
  }
  assert.ok(rows >= 10, `premise: the runs reach their recipients (${rows})`);
});

test('criterion 4: on a matching record, each reached row\'s "what it got" is the served statement\'s receives', () => {
  const model = fromPackage(D887C1, SERVED_78);
  const got = model?.reached.flatMap((r) => r.recipients.map((x) => x.got));
  assert.deepEqual(got, [
    SERVED_78.recipients.find((r) => r.role === 'model-endpoint')?.receives,
    ...(SERVED_78.sources.find((s) => s.sourceId === 'socrata')?.recipients.map((r) => r.receives) ?? []),
    SERVED_78.recipients.find((r) => r.role === 'notebook-executor')?.receives,
  ]);
});

test('criterion 4: the eight reasons are one export of copy.ts, pinned to §2\'s strings in §2\'s order, each 13 words or fewer', () => {
  const reasons = (copyModule as unknown as Record<string, unknown>).WHERE_IT_WENT_REASONS;
  assert.ok(reasons !== undefined && reasons !== null && typeof reasons === 'object', 'copy.ts exports no WHERE_IT_WENT_REASONS');
  assert.deepEqual(Object.entries(reasons as Record<string, string>), Object.entries(REASON));
  for (const text of Object.values(REASON)) assert.ok(text.split(/\s+/).length <= 13, `"${text}" runs over 13 words`);
});

test('criterion 4: the service label is never a place, and no row uses the words the contract retires', () => {
  const models: Array<[string, WhereModel | null]> = [
    ...ALL_RUNS.map(([label, run]): [string, WhereModel] => [label, overSpans(run)]),
    ['d887c1 matched', fromPackage(D887C1, SERVED_78)],
    ['d887c1 unmatched', fromPackage(D887C1, differingStatement())],
    ['397939', fromPackage(R397939, SERVED_78)],
  ];
  for (const [label, model] of models) {
    assert.ok(model, `${label}: premise: a model`);
    for (const row of model.reached) {
      if (row.kind === 'model') assert.ok(row.service, `${label}: the model row states its service`);
      for (const r of row.recipients) {
        assert.notEqual(r.place, SERVICE, `${label}: the service label is printed as a place`);
        assert.notEqual(r.place, RECORD_SERVICE, `${label}: the service label is printed as a place`);
      }
    }
    const text = JSON.stringify(model).toLowerCase();
    for (const retired of ['published by', 'tool arguments', 'question text and tool results', 'returned no data', 'flows statement']) {
      assert.ok(!text.includes(retired), `${label}: the model carries "${retired}"`);
    }
  }
});
