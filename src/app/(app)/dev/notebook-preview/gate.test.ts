// civic-ai-tools#155 P1 E15 — unit coverage for the production gate on
// /dev/notebook-preview. See gate.ts for why this logic is extracted out of
// page.tsx (JSX; not importable by this repo's plain-node test runner).
//
// This proves the GATE CONDITION is correct under `node --test
// --experimental-strip-types` (this repo's `npm test`), run locally. It does
// not by itself prove the deployed route 404s — that was verified
// separately via `NODE_ENV=production next build && next start`, hitting
// `/dev/notebook-preview` on the local server (see PR/gate notes).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNotebookPreviewGated } from './gate.ts';

test('isNotebookPreviewGated: true when NODE_ENV=production', () => {
  assert.equal(isNotebookPreviewGated({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), true);
});

test('isNotebookPreviewGated: false for development', () => {
  assert.equal(isNotebookPreviewGated({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), false);
});

test('isNotebookPreviewGated: false for test', () => {
  assert.equal(isNotebookPreviewGated({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), false);
});

test('isNotebookPreviewGated: false when NODE_ENV is unset', () => {
  assert.equal(isNotebookPreviewGated({} as NodeJS.ProcessEnv), false);
});

test('isNotebookPreviewGated: defaults to the real process.env, which this test run is not production', () => {
  // Confirms the default parameter actually reads `process.env` (not just
  // that a fixture object works) without mutating the ambient NODE_ENV,
  // which Next.js's type augmentation declares read-only. `npm test` never
  // runs with NODE_ENV=production, so this pins the negative case against
  // the real environment.
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.equal(isNotebookPreviewGated(), false);
});
