// #547 (anchor #555, ruling G0-4 A) — the decisions `EXECUTOR_DRIVER=none`
// drives, as pure functions: whether this instance runs notebooks, how the
// query form offers notebook mode to one visitor, which mode the form starts
// in, and what `POST /api/query-notebook` answers.
//
// The components' use of these is pinned by source position in
// `src/app/notebook-mode-surfaces.test.ts`, and the route's answer is driven
// through the real handler in `src/app/api/query-notebook-none-driven.test.ts`.
//
// WHAT MAKES THESE ABLE TO FAIL. Every case under `none` is paired with the
// same case unset, and each pair asserts different outcomes, so a function
// that ignored the setting fails one half. The agreement test reads the
// executor's own resolver, so the form and the executor cannot disagree about
// which values mean "no notebooks".
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTEBOOK_MODE_UNAVAILABLE_REASON,
  NOTEBOOKS_NOT_OFFERED_MESSAGE,
  notebookModeAffordance,
  notebookRouteRefusal,
  notebooksOffered,
} from './notebook-availability.ts';
import { resolveEffectiveMode, type QueryMode } from './query-presentation.ts';
import { classifyStreamError } from './streaming.ts';
import { SSEError } from './sse-client.ts';
import { resolveExecutorDriverName } from './sandbox/execute.ts';

const UNCHANGED = [undefined, '', 'vercel-sandbox', 'container', 'lambda'] as const;

test('#547: an instance runs notebooks unless EXECUTOR_DRIVER is none', () => {
  for (const value of UNCHANGED) {
    assert.equal(notebooksOffered({ EXECUTOR_DRIVER: value }), true, `EXECUTOR_DRIVER=${String(value)}`);
  }
  assert.equal(notebooksOffered({}), true, 'unset');
  assert.equal(notebooksOffered({ EXECUTOR_DRIVER: 'none' }), false, 'none');
  // An unknown value is the executor's loud refusal at the first run, as
  // before; the form keeps offering the mode, as it always did.
  assert.equal(notebooksOffered({ EXECUTOR_DRIVER: 'kubernetes' }), true, 'unknown');
});

test('#547: the form and the executor agree on which values mean no notebooks', () => {
  for (const value of [...UNCHANGED, 'none']) {
    const env = { EXECUTOR_DRIVER: value };
    let executorRunsNone: boolean | string;
    try {
      executorRunsNone = (resolveExecutorDriverName(env) as string) === 'none';
    } catch (error) {
      executorRunsNone = `threw: ${(error as Error).message}`;
    }
    assert.equal(
      executorRunsNone,
      !notebooksOffered(env),
      `EXECUTOR_DRIVER=${String(value)}: the executor and the form disagree`,
    );
  }
});

test('#547 C3: the form offers notebook mode as a toggle, a sign-in prompt, or unavailable', () => {
  // Unset: exactly as before, by sign-in alone.
  assert.equal(notebookModeAffordance({ signedIn: true, notebooksOffered: true }), 'toggle');
  assert.equal(notebookModeAffordance({ signedIn: false, notebooksOffered: true }), 'sign-in');
  // None: unavailable, with its own reason, signed in or not. Not the sign-in
  // prompt (signing in would not turn it on) and not hidden.
  assert.equal(notebookModeAffordance({ signedIn: true, notebooksOffered: false }), 'unavailable');
  assert.equal(notebookModeAffordance({ signedIn: false, notebooksOffered: false }), 'unavailable');
});

/** The mode the form starts in, as QueryForm derives it. */
function startingMode(opts: {
  signedIn: boolean;
  notebooksOffered: boolean;
  chosen: QueryMode | null;
  defaultMode: QueryMode;
}): QueryMode {
  const affordance = notebookModeAffordance({ signedIn: opts.signedIn, notebooksOffered: opts.notebooksOffered });
  return resolveEffectiveMode({ enabled: affordance === 'toggle', chosen: opts.chosen, defaultMode: opts.defaultMode });
}

test('#547 C3: /ask starts in standard mode under none, for a signed-in visitor, whatever was stored', () => {
  for (const chosen of [null, 'notebook', 'standard'] as const) {
    assert.equal(
      startingMode({ signedIn: true, notebooksOffered: false, chosen, defaultMode: 'notebook' }),
      'standard',
      `none, stored ${String(chosen)}`,
    );
  }
  // Unset, unchanged: /ask's notebook default and the stored choice still win.
  assert.equal(startingMode({ signedIn: true, notebooksOffered: true, chosen: null, defaultMode: 'notebook' }), 'notebook');
  assert.equal(startingMode({ signedIn: true, notebooksOffered: true, chosen: 'notebook', defaultMode: 'notebook' }), 'notebook');
  assert.equal(startingMode({ signedIn: true, notebooksOffered: true, chosen: 'standard', defaultMode: 'notebook' }), 'standard');
  assert.equal(startingMode({ signedIn: false, notebooksOffered: true, chosen: 'notebook', defaultMode: 'notebook' }), 'standard');
});

test('#547 C3: the home page keeps a stored notebook choice from running under none', () => {
  assert.equal(startingMode({ signedIn: true, notebooksOffered: false, chosen: 'notebook', defaultMode: 'standard' }), 'standard');
  assert.equal(startingMode({ signedIn: true, notebooksOffered: true, chosen: 'notebook', defaultMode: 'standard' }), 'notebook');
});

test('#547 C3: the reason the form shows is in the reader\'s words', () => {
  assert.ok(NOTEBOOK_MODE_UNAVAILABLE_REASON.length > 0);
  for (const word of ['EXECUTOR_DRIVER', 'none', 'driver', 'executor', 'sandbox']) {
    assert.ok(!NOTEBOOK_MODE_UNAVAILABLE_REASON.includes(word), `the reason names "${word}"`);
  }
  assert.match(NOTEBOOK_MODE_UNAVAILABLE_REASON, /standard mode/);
});

test('#547 C2: the route refuses under none with a stated reason, status and code', () => {
  const refusal = notebookRouteRefusal({ EXECUTOR_DRIVER: 'none' });
  assert.ok(refusal, 'no refusal under EXECUTOR_DRIVER=none');
  assert.equal(refusal.status, 501);
  assert.equal(refusal.body.code, 'notebooks_not_offered');
  assert.match(refusal.body.error, /EXECUTOR_DRIVER=none/);
  for (const value of UNCHANGED) {
    assert.equal(notebookRouteRefusal({ EXECUTOR_DRIVER: value }), null, `EXECUTOR_DRIVER=${String(value)} refuses`);
  }
});

test('#547 C2: a client that meets the refusal shows the generic copy, not a data-source outage', () => {
  // `connectSSE` turns a non-2xx JSON body into an `SSEError` carrying its
  // `error` text; the form maps it through `friendlyStreamError`, which falls
  // back to matching that text. The text must not read as one of the outage
  // kinds (a refused notebook run is not "the live data source is
  // temporarily unavailable").
  const error = new SSEError(NOTEBOOKS_NOT_OFFERED_MESSAGE, 501, {
    error: NOTEBOOKS_NOT_OFFERED_MESSAGE,
    code: 'notebooks_not_offered',
  });
  assert.equal(classifyStreamError(error), 'generic');
});
