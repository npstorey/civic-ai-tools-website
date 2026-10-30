// R10 P1 (#682; the anchor's D7 = A, read literally; G0 D2 = A): what chose a
// run's sources, wherever reached sources are shown.
//
// WHAT IS DRIVEN.
//   - Criterion 1, the chooser line: the first line inside "Where this
//     question went" (`WhereItWent.tsx`, rendered to markup). On a run, from
//     the completion's `flows` (built here by the real builder,
//     `whereItWentFromCalls`, as the comparison route builds it) and the run's
//     trace, through the comparison's adapter and the executed run's; on a
//     record, through `whereItWentFromPackage` and `adaptRecord`.
//   - Criterion 2, the card: "Sources chosen by" in "Model + environment", in
//     the three adapters' environment lists; "all portals" in none of them;
//     the renamed portal card only when the run holds a portal.
//
// THE FIXTURES CAN FAIL. The in-loop run loads Socrata, has its load of Data
// Commons declined, and never asks for Boston OpenContext or NYC Checkbook,
// which the directory set lists (`selected` and `not-consented`). NYC Charter
// is Off (`reader-off`) and two sources are not set up: neither may appear in
// any group, so a reader that listed every offered source fails. The absent
// and stated cases are the same run with only `routing` moved, so a line read
// from anything but `routing` fails one of them.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');

function firstFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}
const candidatesFor = (base: string) => [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];

registerHooks({
  resolve(specifier, context, nextResolve) {
    const from = (context as { parentURL?: string }).parentURL;
    if (/^next\/[a-z-]+$/.test(specifier) && specifier !== 'next/server') return nextResolve(`${specifier}.js`, context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`chooser test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && from?.startsWith('file:') && fileURLToPath(from).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(from)), specifier)));
      if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith('file:')) {
      const file = fileURLToPath(loadUrl);
      if (file.startsWith(SRC) && /\.tsx$/.test(file)) {
        const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          fileName: file,
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        });
        return { format: 'module', source: out.outputText, shortCircuit: true };
      }
    }
    return nextLoad(loadUrl, context);
  },
});

type Model = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const { default: WhereItWent } = (await import('@/components/answer-view/WhereItWent')) as unknown as { default: ComponentType<{ model: unknown }> };
const { adaptComparison } = (await import('@/components/answer-view/adapt-comparison')) as unknown as { adaptComparison: (input: Json) => Model };
const { adaptNotebook } = (await import('@/components/answer-view/adapt-notebook')) as unknown as { adaptNotebook: (input: Json) => Model };
const { adaptRecord } = (await import('@/components/answer-view/adapt-record')) as unknown as { adaptRecord: (input: Json) => Model };
const { whereItWentFromCalls, whereItWentFromPackage } = (await import('@/lib/flows/where-it-went')) as unknown as {
  whereItWentFromCalls: (input: Json) => Model;
  whereItWentFromPackage: (pkg: unknown, served: unknown) => Model | null;
};
const copy = (await import('@/lib/sources/copy')) as unknown as {
  SOURCE_CHOOSER_TEXT: {
    inLoop: string; loaded: string; askedNotLoaded: string; neverAsked: string; none: string; separator: string; reasonSeparator: string;
    notRecorded: string; allSources: string; unrecognized: (method: string) => string;
  };
  SOURCE_CHOOSER_CARD: {
    label: string; inLoop: (version: string | null) => string; notRecorded: string; allSources: string;
    unrecognized: (method: string) => string; definitionLabel: string;
  };
  RUN_PORTAL_LABEL: string;
  WHERE_IT_WENT_REASONS: Record<string, string>;
};
const { SOURCE_CHOOSER_TEXT: T, SOURCE_CHOOSER_CARD: CARD, RUN_PORTAL_LABEL, WHERE_IT_WENT_REASONS: R } = copy;

// --- The run ------------------------------------------------------------------------------

const ROUTER_VERSION = '0.6.0';
const DEFINITION_HASH = 'd'.repeat(8) + '0123456789abcdef'.repeat(3) + 'e'.repeat(8);
const MODEL = 'fixture/model-r10';
const PORTAL = 'data.fixture-r10.example';

/** The run's offered set, as the routes record it (`recordReasons`): the directory set is On plus Ask first, configured. */
const OFFERED = [
  { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
  { sourceId: 'data-commons', alias: 'data_commons', reason: 'not-consented' },
  { sourceId: 'boston-opencontext', alias: 'boston', reason: 'not-consented' },
  { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'reader-off' },
  { sourceId: 'nyc-checkbook', alias: 'nyc_checkbook', reason: 'selected' },
  { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'not-configured' },
  { sourceId: 'nys-legislation', alias: 'nys_legislation', reason: 'not-configured' },
];
const QUERY = { type: 'query', dataset_id: 'aaaa-1111', select: 'count(*)' };

/** The run's calls, as the loop records them (`tools_called`). */
const TOOL_CALLS = [
  { name: 'load_source', args: { alias: 'socrata' }, operationType: 'load_source', loadOutcome: 'loaded' },
  { name: 'socrata__get_data', args: QUERY, operationType: 'query', resultSummary: { rows: 1, columns: 1 } },
  { name: 'load_source', args: { alias: 'data_commons' }, operationType: 'load_source', loadOutcome: 'declined' },
];
const resolveSource = (name: string) => (name.startsWith('socrata__') ? 'socrata' : undefined);

type Routing = { method: string; version: string } | null;

function attr(key: string, value: string | boolean | number) {
  return { key, value: typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { boolValue: value } : { intValue: String(value) } };
}

/** The run's trace, in the OTLP shape `TraceBuilder.finalize()` writes; `routing` null writes no key, as an all-sources run does. */
function traceOf(routing: Routing): Json {
  const root = {
    name: 'analysis', spanId: 'r0',
    attributes: [
      attr('analysis.sources_offered', JSON.stringify(OFFERED)),
      attr('analysis.components', JSON.stringify([
        { id: 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server', guidanceHash: 'a'.repeat(64), guidanceOrigin: 'fallback' },
        { id: '@typedstandards/civic-typed-router', version: ROUTER_VERSION },
      ])),
      ...(routing ? [attr('analysis.routing', JSON.stringify(routing)), attr('analysis.definition_hash', DEFINITION_HASH)] : []),
    ],
  };
  const child = (spanId: string, name: string, attributes: ReturnType<typeof attr>[]) => ({ name, spanId, parentSpanId: 'r0', attributes });
  const spans = [
    root,
    child('s1', 'llm_inference', [attr('gen_ai.request.model', MODEL), attr('gen_ai.system', 'openrouter')]),
    child('s2', 'mcp_tool_call', [attr('tool.name', 'load_source'), attr('tool.operation_type', 'load_source'), attr('tool.arguments', '{"alias":"socrata"}'), attr('tool.load_outcome', 'loaded')]),
    child('s3', 'mcp_tool_call', [attr('tool.name', 'socrata__get_data'), attr('tool.operation_type', 'query'), attr('mcp.source', 'socrata')]),
    child('s4', 'mcp_tool_call', [attr('tool.name', 'load_source'), attr('tool.operation_type', 'load_source'), attr('tool.arguments', '{"alias":"data_commons"}'), attr('tool.load_outcome', 'declined')]),
  ];
  return { resourceSpans: [{ scopeSpans: [{ spans }] }] };
}

const IN_LOOP: Routing = { method: 'in-loop', version: ROUTER_VERSION };
const ALL_SOURCES: Routing = { method: 'all-sources', version: ROUTER_VERSION };
const PICKER: Routing = { method: 'picker', version: ROUTER_VERSION };

/** The completion's `flows`, as the comparison route builds it. */
const FLOWS = whereItWentFromCalls({ toolCalls: TOOL_CALLS, resolveSource, sourcesOffered: OFFERED, statement: null, model: MODEL, service: 'openrouter' });

const NOTEBOOK = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { extensions: { 'org.civicaitools.notebook': { provenance: 'executed' } } },
  cells: [{ cell_type: 'markdown', metadata: {}, source: ['# Fixture\n'] }],
};

const comparison = (trace: Json | null | undefined, portal = PORTAL) => adaptComparison({
  content: 'An answer.', isComplete: true, isActive: false, queryText: 'How many?', toolsCalled: TOOL_CALLS,
  progressGroups: [], progressLog: [], model: MODEL, portal, evidenceTrace: trace, instance: null, flows: FLOWS,
});
const executed = (trace: Json | null | undefined, portal = PORTAL) => adaptNotebook({
  notebook: NOTEBOOK, prompt: 'How many?', model: MODEL, portal, toolCalls: TOOL_CALLS, instance: null, socrataMcpUrl: null,
  flows: FLOWS, evidenceTrace: trace,
});

// --- The record ----------------------------------------------------------------------------

function packageOf(routing: Routing): Json {
  return {
    trace: traceOf(routing),
    extensions: {
      'org.civicaitools.composition': {
        assertedDate: '2026-10-30',
        sourcesOffered: OFFERED,
        components: [{ id: '@typedstandards/civic-typed-router', version: ROUTER_VERSION }],
        ...(routing ? { routing, definitionHash: DEFINITION_HASH } : {}),
      },
    },
  };
}

// --- Reading the section ---------------------------------------------------------------------

const unescape = (text: string) =>
  text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const flat = (html: string) => unescape(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ''));

/** The section's markup, and the text that follows its summary (what opens the disclosure). */
function sectionOf(model: Model): { html: string; inside: string } {
  assert.ok(model.whereItWent, 'premise: the view model carries "Where this question went"');
  const html = renderToStaticMarkup(createElement(WhereItWent, { model: model.whereItWent }));
  const after = html.slice(html.indexOf('</summary>') + '</summary>'.length);
  return { html, inside: flat(after) };
}

const IN_LOOP_LINES = [
  T.inLoop,
  `${T.loaded}Socrata.`,
  `${T.askedNotLoaded}Data Commons${T.reasonSeparator}${R.declined}`,
  `${T.neverAsked}Boston OpenContext${T.separator}NYC Checkbook.`,
];

function assertInLoop(inside: string, where: string): void {
  // The chooser line opens the disclosure: it is the first text after the summary.
  assert.ok(inside.startsWith(IN_LOOP_LINES.join('')), `${where}: the section opens with: ${inside.slice(0, 400)}`);
  for (const outside of ['NYC Charter', 'NYC City Record', 'NYS Open Legislation']) {
    assert.ok(!inside.slice(0, IN_LOOP_LINES.join('').length + 40).includes(outside), `${where}: the chooser line names ${outside}, which no group holds`);
  }
  assert.ok(!inside.includes(T.notRecorded), `${where}: the in-loop run says "not recorded"`);
}

function assertNotRecorded(inside: string, where: string): void {
  assert.ok(inside.startsWith(T.notRecorded), `${where}: the section opens with: ${inside.slice(0, 300)}`);
  for (const group of [T.inLoop, T.loaded, T.askedNotLoaded, T.neverAsked, T.allSources]) {
    assert.ok(!inside.includes(group), `${where}: a run with no routing key says "${group}"`);
  }
}

function assertAllSources(inside: string, where: string): void {
  assert.ok(inside.startsWith(T.allSources), `${where}: the section opens with: ${inside.slice(0, 300)}`);
  for (const group of [T.inLoop, T.loaded, T.askedNotLoaded, T.neverAsked, T.notRecorded]) {
    assert.ok(!inside.includes(group), `${where}: a stated all-sources run says "${group}"`);
  }
}

// --- Criterion 1: the chooser line, on a run -----------------------------------------------------

const RUNS: Array<[string, (trace: Json | null | undefined) => Model]> = [
  ['the comparison', (trace) => comparison(trace)],
  ['the executed run', (trace) => executed(trace)],
];

for (const [name, adapt] of RUNS) {
  test(`criterion 1, ${name}, in-loop: the chooser line names the three groups by the sources' reader names, with the reason`, () => {
    assertInLoop(sectionOf(adapt(traceOf(IN_LOOP))).inside, name);
  });

  test(`criterion 1, ${name}, no routing key: "not recorded", and no group`, () => {
    assertNotRecorded(sectionOf(adapt(traceOf(null))).inside, name);
  });

  test(`criterion 1, ${name}, a stated all-sources method: the all-sources sentence`, () => {
    assertAllSources(sectionOf(adapt(traceOf(ALL_SOURCES))).inside, name);
  });

  test(`criterion 1, ${name}, a method with no sentence: never read as in-loop or all-sources`, () => {
    const { inside } = sectionOf(adapt(traceOf(PICKER)));
    assert.ok(inside.startsWith(T.unrecognized('picker')), `${name}: the section opens with: ${inside.slice(0, 300)}`);
    for (const other of [T.inLoop, T.allSources, T.notRecorded]) assert.ok(!inside.includes(other), `${name}: "picker" read as "${other}"`);
  });

  test(`criterion 1, ${name}, P-f: before the trace arrives, no chooser line, and no "not recorded"`, () => {
    const { inside } = sectionOf(adapt(null));
    for (const line of [T.inLoop, T.notRecorded, T.allSources]) assert.ok(!inside.includes(line), `${name}: before its trace the section says "${line}"`);
  });
}

// --- Criterion 1: the chooser line, on a record -----------------------------------------------------

test('criterion 1, the record (whereItWentFromPackage), in-loop: the chooser line names the three groups', () => {
  assertInLoop(sectionOf({ whereItWent: whereItWentFromPackage(packageOf(IN_LOOP), null) }).inside, 'the record');
});

test('criterion 1, the record, no routing key: "not recorded", and no group', () => {
  assertNotRecorded(sectionOf({ whereItWent: whereItWentFromPackage(packageOf(null), null) }).inside, 'the record');
});

test('criterion 1, the record, a stated all-sources method: the all-sources sentence', () => {
  assertAllSources(sectionOf({ whereItWent: whereItWentFromPackage(packageOf(ALL_SOURCES), null) }).inside, 'the record');
});

test('criterion 1, the record: the routing on the root span is not read in place of the record\'s own `routing`', () => {
  // The composition says nothing; the trace's root span says in-loop. The record's field decides.
  const pkg = packageOf(null);
  (pkg as { trace: Json }).trace = traceOf(IN_LOOP);
  assertNotRecorded(sectionOf({ whereItWent: whereItWentFromPackage(pkg, null) }).inside, 'the record');
});
