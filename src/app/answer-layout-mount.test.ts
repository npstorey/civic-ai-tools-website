// LAYOUT-WEB W4 P1 fix 1 (F1) — the root layout hands every page this
// instance's answer layouts, resolved from the three settings.
//
// WHY SOURCE. `layout.tsx` is JSX that imports the whole app shell; rendering
// it under `node --test` would stub most of the tree. What it decides is
// driven elsewhere: `instanceAnswerLayouts()` against the environment in
// `src/lib/answer-layout/index.test.ts`, and the view under a provider in
// `src/components/answer-view/answer-view-layout.test.ts`. This file pins that
// the layout makes the call, mounts the provider around the page, and imports
// the small provider module rather than the view. The precedent is
// `src/app/notebook-mode-surfaces.test.ts`, for `NotebookModeProvider`.
//
// WHAT MAKES THESE ABLE TO FAIL. Each pin names the exact expression, and a
// missing file reads as empty, so an absent mount fails at an assertion. The
// built page is driven too: the report's F4 reads the prerendered home page.
//
// BLIND SPOT, stated. A source read cannot tell that the mount it finds is the
// one that renders; the layout has one `<AnswerLayoutsProvider`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

function read(relative: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
  } catch {
    return '';
  }
}

function at(source: string, needle: string, where: string): number {
  const index = source.indexOf(needle);
  assert.ok(index > 0, `${where} should contain ${needle}`);
  return index;
}

const count = (source: string, needle: string) => source.split(needle).length - 1;

const LAYOUT = 'src/app/layout.tsx';
const READING = 'src/lib/answer-layout/reading.ts';
const PROVIDER = 'src/components/answer-view/AnswerLayoutsProvider.tsx';

test('W4 P1 fix 1 (F1) the root layout mounts the answer-layout provider around every page, with the value the three settings resolve to', () => {
  const layout = read(LAYOUT);
  at(layout, "import { AnswerLayoutsProvider } from '@/components/answer-view/AnswerLayoutsProvider';", LAYOUT);
  at(layout, "import { instanceAnswerLayouts } from '@/lib/answer-layout/reading';", LAYOUT);
  assert.equal(count(layout, '<AnswerLayoutsProvider '), 1, 'one mount');
  const open = at(layout, '<AnswerLayoutsProvider value={instanceAnswerLayouts()}>', LAYOUT);
  const close = at(layout, '</AnswerLayoutsProvider>', LAYOUT);
  const notebookOpen = at(layout, '<NotebookModeProvider offered={notebooksOffered()}>', LAYOUT);
  const notebookClose = at(layout, '</NotebookModeProvider>', LAYOUT);
  const header = at(layout, '<Header', LAYOUT);
  assert.ok(notebookOpen < open && close < notebookClose, 'beside NotebookModeProvider, inside it');
  assert.ok(open < header && at(layout, '{children}', LAYOUT) < close, 'around the page');
});

test('W4 P1 fix 1 (F1) the value is read from the three names, by literal name, in one function', () => {
  const reading = read(READING);
  const fn = reading.slice(at(reading, 'export function instanceAnswerLayouts(): InstanceLayouts {', READING));
  for (const name of ['ANSWER_LAYOUT', 'ANSWER_LAYOUT_PATH', 'ANSWER_LAYOUT_URL']) {
    at(fn, `process.env.${name},`, `${READING} instanceAnswerLayouts`);
    assert.equal(count(reading, `process.env.${name},`), 1, `${name} is read once`);
  }
  at(fn, 'resolveAnswerLayouts(setting)', `${READING} instanceAnswerLayouts`);
});

test('W4 P1 fix 1 (F1) the root layout imports the provider module, not the view', () => {
  const layout = read(LAYOUT);
  assert.doesNotMatch(layout, /answer-view\/AnswerView['"]/, 'the root layout imports the view');
  const provider = read(PROVIDER);
  assert.ok(provider.startsWith("'use client';"), `${PROVIDER} is a client module`);
  assert.doesNotMatch(provider, /AnswerView|react-markdown|ProgressLog/, 'the provider module carries the view');
  const view = read('src/components/answer-view/AnswerView.tsx');
  at(view, "import { useAnswerLayouts } from '@/components/answer-view/AnswerLayoutsProvider';", 'AnswerView.tsx');
  assert.doesNotMatch(view, /createContext/, 'the view holds a context of its own');
});
