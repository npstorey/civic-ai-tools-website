// R6 W4 (#632), criterion 5 and premise 3: the section's model never reaches a
// publish body. The publish dialog posts named fields (`PublishEvidenceDialog.tsx`,
// the `/api/records` body); here it is mounted with every field of a completion
// that carries `flows`, `flows` included, and published. Neither the record's
// body nor the summary request carries the model.
//
// WHAT MAKES IT ABLE TO FAIL: a dialog that spread its props, or the
// completion, into either body would carry `flows` and its strings.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`r6-w4 publish-body test hook: cannot resolve ${specifier}`);
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && !path.extname(specifier) && parent?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      const json = fs.readFileSync(fileURLToPath(loadUrl), 'utf8');
      return { format: 'module', source: `export default ${json};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

const { mountPublishDialog, fire } = await import('../publish-dialog-test-harness.ts');

const BODIES: Array<{ url: string; body: Record<string, unknown> }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  if (url === '/api/records/signing-status') return Response.json({ signingConfigured: true, sealOnly: false });
  BODIES.push({ url, body });
  if (url === '/api/records/generate-summary') return Response.json({ summary: 'A summary.' });
  if (url === '/api/records') return Response.json({ slug: 'fixture-w4', visibility: 'public', packageHash: 'f'.repeat(64) });
  throw new TypeError(`the dialog asked for ${url}, which this test does not answer`);
}) as typeof fetch;

const MARKER = 'FLOWSMARKER-w4';
const FLOWS = {
  reached: [{ kind: 'model', name: 'Model endpoint', model: 'fixture/model', service: 'openrouter', recipients: [{ role: 'Model endpoint', place: MARKER, got: MARKER, keptBy: [MARKER] }] }],
  notReached: [{ sourceId: 'data-commons', name: 'Data Commons', whyNotSent: 'Off.' }],
  statement: { kind: 'in-force' },
};
const TOOL_CALLS = [{ name: 'socrata__get_data', args: { portal: 'data.example.org', dataset_id: 'erm2-nwe9', query: 'SELECT count(*)' } }];
/** A completion's data, `flows` and all, as a careless caller might hand it over whole. */
const COMPLETION = { content: 'Nine reports.', duration_ms: 10, tools_called: TOOL_CALLS, flows: FLOWS };

test('criterion 5: a publish from a completion that carries flows posts no flows key and none of its strings', async () => {
  const dialog = await mountPublishDialog({
    ...COMPLETION,
    queryText: 'How many reports?',
    output: COMPLETION.content,
    toolCalls: COMPLETION.tools_called,
    evidenceTrace: { resourceSpans: [] },
    model: 'fixture-fast',
    portal: 'data.example.org',
  });
  await dialog.settle();
  await fire(dialog.button('Seal'), 'onClick');
  await dialog.settle();
  const publish = BODIES.filter((b) => b.url === '/api/records');
  assert.equal(publish.length, 1, `premise: one publish request (${BODIES.map((b) => b.url).join(', ')})`);
  assert.ok(Array.isArray(publish[0].body.toolCalls), 'premise: the body carries the calls');
  for (const { url, body } of BODIES) {
    assert.equal(Object.hasOwn(body, 'flows'), false, `${url}: the body has a flows key`);
    assert.ok(!JSON.stringify(body).includes(MARKER), `${url}: the body carries the section's strings`);
  }
});
