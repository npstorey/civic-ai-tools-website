// R6 W1, criterion 3 (#632, D8 = A): the consistency dialog shows, beside the
// runs, a source the record was offered that this instance does not have —
// and the attestation it submits is built from the same six keys as before.
//
// WHY BESIDE THE RUNS. A replay on an instance lacking one of the record's
// sources runs without it (`offeredSet.lacking` on the replay response). A
// "consistent" verdict over such runs reads as a claim about the record's
// analysis when it is a claim about a narrower one; saying so beside the
// numbers is disclosure, not validation (docs/design-principles.md,
// Principle 1), in the reader's words: a source's name, never its id
// (Principle 9).
//
// WHAT IS DRIVEN. The dialog's `ConsistencyTab`, rendered to static markup
// with completed runs and metrics, through the same transpile-and-render
// harness the other component suites use. The tab is not exported; this
// file's load hook appends one export to the transpiled module, so nothing in
// the component changes for the test.
//
// THE SIX KEYS. The signed runs are built in the dialog's submit handler from
// `runIndex` and five fields read off each replay result. The block is pinned
// by its source text (green at the base): the offered set is displayed, never
// signed.
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
const DIALOG = path.join(HERE, 'AttestationDialog.tsx');

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
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`attestation dialog test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && parent?.startsWith('file:') && fileURLToPath(parent).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(parent)), specifier)));
      if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith('file:')) {
      const file = fileURLToPath(loadUrl);
      if (file.startsWith(SRC) && /\.tsx?$/.test(file)) {
        const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          fileName: file,
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        });
        const source = file === DIALOG ? `${out.outputText}\nexport { ConsistencyTab as __ConsistencyTab };\n` : out.outputText;
        return { format: 'module', source, shortCircuit: true };
      }
    }
    return nextLoad(loadUrl, context);
  },
});

const { __ConsistencyTab: ConsistencyTab } = (await import('./AttestationDialog.tsx')) as unknown as {
  __ConsistencyTab: ComponentType<Record<string, unknown>>;
};

const CHARTER_NAME = 'NYC Charter, Laws and Rules';

function run(lacking: string[] | undefined): Record<string, unknown> {
  return {
    toolCalls: [{ name: 'socrata__get_data', args: { type: 'query', dataset_id: 'erm2-nwe9' } }],
    output: 'There were 4,812 noise complaints.',
    tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    durationMs: 1200,
    ...(lacking === undefined
      ? {}
      : { offeredSet: { from: 'sourcesOffered', sources: ['socrata', 'data-commons'], lacking } }),
  };
}

function render(runs: Array<Record<string, unknown>>): string {
  return renderToStaticMarkup(createElement(ConsistencyTab, {
    apiKey: 'placeholder',
    numRuns: runs.length,
    setNumRuns: () => {},
    status: 'done',
    progress: 'All runs complete',
    completedRuns: runs,
    metrics: { toolCallOverlap: 1, outputSimilarity: 1, consistencyClassification: 'highly_reproducible' },
    onRun: () => {},
    onSubmit: () => {},
    submitting: false,
  }));
}

test('criterion 3: runs on an instance lacking one of the record\'s sources say so beside the runs, by the source\'s name', () => {
  const html = render([run(['nyc-charter']), run(['nyc-charter'])]);
  assert.ok(html.includes('Run 1') && html.includes('Run 2'), 'premise: the runs rendered');
  assert.ok(html.includes(CHARTER_NAME), `the dialog does not name the source the replays ran without:\n${html}`);
  assert.ok(!html.includes('nyc-charter'), 'the dialog shows a source id where a reader expects a name');
});

test('criterion 3: runs lacking nothing, or carrying no offered set, show no such line', () => {
  for (const runs of [[run([]), run([])], [run(undefined)]]) {
    const html = render(runs);
    assert.ok(html.includes('Run 1'), 'premise: the runs rendered');
    assert.ok(!html.includes(CHARTER_NAME), `a line about a lacking source rendered with nothing lacking:\n${html}`);
  }
});

test('criterion 3: the signed runs are built from the same six keys as at the base (green at the base)', () => {
  const source = fs.readFileSync(DIALOG, 'utf8');
  const SIX_KEYS = [
    'runs: completedRuns.map((r, i) => ({',
    '  runIndex: i,',
    '  toolCallCount: r.toolCalls.length,',
    '  toolCallKeys: r.toolCalls.map(canonicalizeToolCall),',
    '  outputExcerpt: r.output.slice(0, 500),',
    '  tokenUsage: r.tokenUsage,',
    '  durationMs: r.durationMs,',
    '})),',
  ];
  const lines = source.split('\n').map((l) => l.trim());
  const at = lines.indexOf(SIX_KEYS[0]);
  assert.ok(at !== -1, 'the signed runs\' mapping is not where it was');
  assert.deepEqual(lines.slice(at, at + SIX_KEYS.length), SIX_KEYS.map((l) => l.trim()), 'the signed runs\' keys moved');
  const signed = source.slice(source.indexOf('const submitAttestation'), source.indexOf('// --- Render'));
  assert.ok(!signed.includes('offeredSet'), 'the offered set reached the submitted attestation');
});
