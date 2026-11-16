// S3-B W2 (npstorey/civic-ai-tools#318; B6 and the ORCH's condition 2): the consistency dialog shows the routing
// configuration a record states, and says the replays do not apply it again, only for a record whose run offered the
// model a search (its configuration's `search` is not `none`). That is the one record whose replay, which lists its
// whole set and offers no search, is routed differently from the run.
//
// THE DECOY. Every production record states search `none`, or no configuration at all. For both, the dialog renders
// byte for byte what it renders for a run with no configuration field, which is the base's rendering: a line shown for
// them would fail here.
//
// The words are r2's S22 (research-checked, 39d99d20…44828; owner memo pending) and bundle revision 5's :115 (S23).
//
// WHAT IS DRIVEN. The dialog's `ConsistencyTab`, rendered to static markup, through the transpile-and-render harness
// of `attestation-dialog-offered-set.test.ts` (copied, as each component suite carries its own).
//
// RED before W2's green: the dialog shows no configuration for a searched record.
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
    // UX-2 P4b: the consent card and the pause link to the Settings overlay with `next/link`, a CommonJS file.
    if (specifier === 'next/link') return nextResolve('next/link.js', context);
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

function run(routingConfiguration?: Record<string, unknown>): Record<string, unknown> {
  return {
    toolCalls: [{ name: 'socrata__get_data', args: { type: 'query', dataset_id: 'erm2-nwe9' } }],
    output: 'There were 4,812 noise complaints.',
    tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    durationMs: 1200,
    offeredSet: { from: 'sourcesOffered', sources: ['socrata', 'data-commons'], lacking: [] },
    ...(routingConfiguration === undefined ? {} : { routingConfiguration }),
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

const CONFIGURATION = (search: unknown) => ({
  rule: { id: 'test-listed-subset', version: '1' },
  cap: 'none',
  search,
  inventory: { id: 'civic', version: '2026-11-12.1+0654b2c29331', hash: 'a'.repeat(64) },
  hash: 'b'.repeat(64),
});

test('B6: a record whose run offered a search shows its configuration, and that the replays do not apply it again', () => {
  const html = render([run(CONFIGURATION({ method: 'bm25', version: '1' })), run(CONFIGURATION({ method: 'bm25', version: '1' }))]);
  assert.ok(html.includes('Run 1') && html.includes('Run 2'), 'premise: the runs rendered');
  for (const line of [
    'Each of these replays shows the model all the sources it can use, and none offers it a search. The original analysis showed the model its sources under the configuration below, which the replays do not apply again.',
    'The model was offered a search for sources. The search method is recorded as bm25, version 1.',
    'The first list of sources had no size limit.',
    'routing rule recorded as test-listed-subset, version 1',
    'built over the source inventory civic (version 2026-11-12.1+0654b2c29331)',
    `routing configuration ${'b'.repeat(64)}`,
  ]) {
    assert.ok(html.includes(line), `the dialog does not show: ${line}\n${html}`);
  }
});

test('condition 2, the decoy: a record whose configuration states search none, or none at all, renders as the base does', () => {
  const base = render([run(), run()]);
  assert.equal(render([run(CONFIGURATION('none')), run(CONFIGURATION('none'))]), base);
  assert.ok(!base.includes('configuration below'), 'premise: the base shows no configuration');
});
