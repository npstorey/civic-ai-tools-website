// LAYOUT-WEB W4 P2 criterion (5), as the amendment's (b) restates it, and
// reading 9: the foot line when a record's publication attestation names a
// layout, rendered.
//
// WHAT IS DRIVEN. The chain the record page runs, from the attestation views
// to the markup: `publishedLayoutNodeId` (the selection over the views
// `lifecycle.ts` builds), `lookUpPublishedLayout` (the held nodes),
// `adaptRecord`, and `AnswerView` rendered by react-dom/server, as the server
// renders the record page before the toggle reads the session. The held
// fixture node is built from `envelope-order` and signed by a throwaway
// Ed25519 key generated for this run (a fixture); a second is built from
// `answer-first`, the shown layout's. A held set is handed in as data, since
// the repository commits no node at this head.
//
// Each case differs from the one that shows the line in one property: the
// node the attestation names, the attestation's signature verdict, its signer
// match, or the layout shown.
//
// Module hooks resolve `@/` and transpile `.ts`/`.tsx`, as the other render
// tests here do.
//
// Run with: npm test (or node --test --experimental-strip-types src/components/answer-view/published-layout-line.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildLayoutNode, signEnvelopeHash } from '@typedstandards/produce-core';

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
      if (found === null) throw new Error(`W4 P2 test hook: cannot resolve ${specifier}`);
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
      if (file.startsWith(SRC) && /\.tsx?$/.test(file)) {
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

type AnyComponent = ComponentType<Record<string, unknown>>;
const { default: AnswerView } = (await import('@/components/answer-view/AnswerView')) as unknown as { default: AnyComponent };
const { AnswerLayoutsProvider } = (await import('@/components/answer-view/AnswerLayoutsProvider')) as unknown as {
  AnswerLayoutsProvider: ComponentType<{ value: unknown; children?: ReactNode }>;
};
const { adaptRecord } = await import('@/components/answer-view/adapt-record');
const { ANSWER_FIRST, ENVELOPE_ORDER, BUILT_IN_INSTANCE_LAYOUTS } = await import('@/lib/answer-layout');
const { buildLayoutNodeDocument } = await import('@/lib/answer-layout/node-document');
const { committedLayoutNodes, lookUpPublishedLayout } = await import('@/lib/answer-layout/held');
const { publishedLayoutNodeId } = await import('@/lib/evidence/published-layout');

const { privateKey } = crypto.generateKeyPairSync('ed25519');
const KEY = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const KID = 'fixture:w4p2-render';
const SIGNER = { bindingTier: 'platform', identifier: 'platform:w4p2-fixture', displayName: 'W4 P2 Fixture Platform' };

function heldNode(layout: typeof ANSWER_FIRST) {
  const { node, nodeId } = buildLayoutNode({ ...layout, packageId: `w4p2-${layout.name}`, createdAt: '2026-10-20T00:00:00.000Z', signingKeyId: KID, signer: SIGNER });
  return committedLayoutNodes([buildLayoutNodeDocument(node, nodeId, signEnvelopeHash(nodeId, KEY, KID), 'https://w4p2-fixture.invalid/r.json')])[0];
}

const ENVELOPE_NODE = heldNode(ENVELOPE_ORDER);
const ANSWER_FIRST_NODE = heldNode(ANSWER_FIRST);
const HELD = [ANSWER_FIRST_NODE, ENVELOPE_NODE];
const NOT_HELD_ID = '9'.repeat(64);

/** The record's publication attestation view, as `lifecycle.ts` builds it: verified and signer-matched unless a case says otherwise. */
function publishesView(layoutNodeId: string, over: Record<string, unknown> = {}) {
  return {
    nodeId: 'a'.repeat(64), type: 'attestation/publishes/v1', signer: SIGNER, createdAt: '2026-10-20T00:00:00.000Z',
    signatureValid: true, nodeIdMatches: true, hasTimestamp: true, hasRekor: true, signerMatchesTarget: true, layoutNodeId, ...over,
  };
}

/** The record page's chain, from the views to the foot line's text in the server's markup. */
function footLine(views: ReturnType<typeof publishesView>[], instance = BUILT_IN_INSTANCE_LAYOUTS): string {
  const model = adaptRecord({
    stored: null,
    resolution: null,
    row: { slug: 'w4p2-record', summary: 'W4P2 summary', contentProfile: 'default', captureMethod: null },
    instance: 'records.w4p2-fixture.invalid',
    publishedLayout: lookUpPublishedLayout(publishedLayoutNodeId(views as never), HELD),
  });
  const html = renderToStaticMarkup(createElement(AnswerLayoutsProvider, { value: instance }, createElement(AnswerView, { model })));
  const m = /<span data-part="layout-line">([^<]*)<\/span>/.exec(html);
  assert.ok(m, 'the foot line renders');
  return m[1];
}

test('W4 P2 (5) an attestation naming the held envelope-order node shows the line', () => {
  assert.equal(footLine([publishesView(ENVELOPE_NODE.nodeId)]), 'Published under layout envelope-order v1; shown under layout answer-first v1');
});

test('W4 P2 (5) one naming the shown layout’s node shows none: W4 P1’s line, unchanged', () => {
  assert.equal(footLine([publishesView(ENVELOPE_NODE.nodeId)]), 'Published under layout envelope-order v1; shown under layout answer-first v1');
  assert.equal(footLine([publishesView(ANSWER_FIRST_NODE.nodeId)]), 'Shown under layout answer-first v1');
  assert.equal(footLine([]), 'Shown under layout answer-first v1', 'no attestation: the same line');
});

test('W4 P2 (5) an id the site does not hold shows the not-held sentence, not the published-under form', () => {
  const line = footLine([publishesView(NOT_HELD_ID)]);
  assert.equal(line, 'Shown under layout answer-first v1. This site does not hold the layout this record was published under.');
  assert.doesNotMatch(line, /Published under/);
});

test('W4 P2 (5) an attestation whose signature fails, or whose signer does not match, shows none', () => {
  assert.equal(footLine([publishesView(ENVELOPE_NODE.nodeId)]), 'Published under layout envelope-order v1; shown under layout answer-first v1');
  assert.equal(footLine([publishesView(ENVELOPE_NODE.nodeId, { signatureValid: false })]), 'Shown under layout answer-first v1');
  assert.equal(footLine([publishesView(ENVELOPE_NODE.nodeId, { signerMatchesTarget: false })]), 'Shown under layout answer-first v1');
  assert.equal(footLine([publishesView(ENVELOPE_NODE.nodeId, { signatureValid: null })]), 'Shown under layout answer-first v1', 'no signed node to verify');
});

test('W4 P2 reading 9: the line compares against the layout shown, not the instance’s default', () => {
  const shownEnvelope = { default: ENVELOPE_ORDER, offered: [ENVELOPE_ORDER, ANSWER_FIRST] };
  assert.equal(footLine([publishesView(ENVELOPE_NODE.nodeId)], shownEnvelope), 'Shown under layout envelope-order v1');
  assert.equal(footLine([publishesView(ANSWER_FIRST_NODE.nodeId)], shownEnvelope), 'Published under layout answer-first v1; shown under layout envelope-order v1');
});
