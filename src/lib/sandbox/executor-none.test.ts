// #547 C1 (anchor #555, ruling G0-4 A) — `EXECUTOR_DRIVER=none` is a value.
//
// `none` declares that an instance runs no notebooks. The resolver returns it;
// unset, empty and the three drivers resolve as they always have; an unknown
// value still throws, now naming all four values. And if execution is reached
// anyway, it refuses with an `ExecutorSettingError` naming the variable, before
// any driver is loaded and before the timeout settings are read.
//
// WHAT MAKES THE REFUSAL ASSERTION ABLE TO FAIL. The run under `none` also sets
// `EXECUTOR_SESSION_TIMEOUT_S` to a malformed value. `executeNotebookWith`
// refuses that value with an `ExecutorSettingError` of its own, naming
// `EXECUTOR_SESSION_TIMEOUT_S`; so an `ExecutorSettingError` alone would not
// show that `none` refused first. The assertion is on the variable it names.
// Before this phase the resolver threw a plain `Error` ("Unsupported
// EXECUTOR_DRIVER") under `none`, which fails the class assertion.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeNotebook, ExecutorSettingError, resolveExecutorDriverName } from './execute.ts';
import type { Notebook } from '../notebook-author/cells.ts';

/** What the resolver returns for `env`, or the message it throws. */
function resolved(env: Record<string, string | undefined>): string {
  try {
    return resolveExecutorDriverName(env);
  } catch (error) {
    return `threw: ${(error as Error).message}`;
  }
}

test('#547 C1: EXECUTOR_DRIVER=none resolves to none', () => {
  assert.equal(resolved({ EXECUTOR_DRIVER: 'none' }), 'none');
});

test('#547 C1: unset, empty and the three drivers resolve as before', () => {
  assert.equal(resolved({}), 'vercel-sandbox');
  assert.equal(resolved({ EXECUTOR_DRIVER: '' }), 'vercel-sandbox');
  assert.equal(resolved({ EXECUTOR_DRIVER: 'vercel-sandbox' }), 'vercel-sandbox');
  assert.equal(resolved({ EXECUTOR_DRIVER: 'container' }), 'container');
  assert.equal(resolved({ EXECUTOR_DRIVER: 'lambda' }), 'lambda');
});

test('#547 C1: an unknown value still throws, naming all four values', () => {
  for (const value of ['kubernetes', 'None', ' none', 'off']) {
    const outcome = resolved({ EXECUTOR_DRIVER: value });
    assert.ok(outcome.startsWith('threw: '), `"${value}" was accepted as ${outcome}`);
    assert.match(outcome, new RegExp(`Unsupported EXECUTOR_DRIVER "${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    for (const name of ['vercel-sandbox', 'container', 'lambda', 'none']) {
      assert.ok(outcome.includes(`"${name}"`), `the refusal of "${value}" does not name "${name}": ${outcome}`);
    }
  }
});

test('#547 C1: under EXECUTOR_DRIVER=none, execution refuses with the setting named, before any driver or timeout', async () => {
  const saved = {
    EXECUTOR_DRIVER: process.env.EXECUTOR_DRIVER,
    EXECUTOR_SESSION_TIMEOUT_S: process.env.EXECUTOR_SESSION_TIMEOUT_S,
  };
  process.env.EXECUTOR_DRIVER = 'none';
  process.env.EXECUTOR_SESSION_TIMEOUT_S = 'not-a-number';
  try {
    const notebook = { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 } as unknown as Notebook;
    let caught: unknown = null;
    try {
      await executeNotebook(notebook);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught !== null, 'execution under EXECUTOR_DRIVER=none did not refuse');
    assert.ok(
      caught instanceof ExecutorSettingError,
      `the refusal is a ${(caught as Error).name}, not an ExecutorSettingError: ${(caught as Error).message}`,
    );
    assert.equal((caught as ExecutorSettingError).variable, 'EXECUTOR_DRIVER', 'the refusal names another setting');
    assert.match((caught as Error).message, /EXECUTOR_DRIVER is "none"/);
    assert.match((caught as Error).message, /runs no notebooks/);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
