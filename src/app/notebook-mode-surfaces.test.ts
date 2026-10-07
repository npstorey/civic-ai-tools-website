// #547 C3 and C5 (anchor #555, ruling G0-4 A) — how the query form, on both
// mounts that offer notebook mode, follows `EXECUTOR_DRIVER=none`, and what
// docs/deploy.md says about it.
//
// WHY SOURCE. `QueryForm.tsx`, the provider and `layout.tsx` are JSX, which
// `--experimental-strip-types` cannot parse. The decisions they make are
// driven in `src/lib/notebook-availability.test.ts`; this file pins that the
// components make them through those functions, in the places that matter.
// The precedent is `src/app/api/portal-lock-ordering.test.ts` (#436), whose
// switch reaches the same form through the same root layout.
//
// HOW THE VALUE REACHES BOTH MOUNTS. `/ask` and the home page both render
// `QuerySurface`, which renders `QueryForm`. The home page is a client
// component, so no server prop reaches it; the root layout wraps every page in
// `NotebookModeProvider`, as it wraps every page in `DefaultPortalProvider`.
//
// WHAT MAKES THESE ABLE TO FAIL. Each pin names the exact expression the form
// or the layout must carry, and the branch-order pins compare two positions
// that must both exist (`at` asserts presence). A missing file reads as empty,
// so an absent provider fails at an assertion rather than at a read.
//
// BLIND SPOT, stated. A source read cannot tell that the branch it finds is the
// one that renders; a second, unreached copy would satisfy it. The form has one
// response-mode block, and `useStoredMode(` is called once.
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

const FORM = 'src/components/QueryForm.tsx';
const PROVIDER = 'src/components/NotebookModeProvider.tsx';
const LAYOUT = 'src/app/layout.tsx';

test('#547 C3: the form derives notebook mode from sign-in AND whether this instance runs notebooks', () => {
  const form = read(FORM);
  at(form, "import { useNotebooksOffered } from '@/components/NotebookModeProvider';", FORM);
  at(form, 'const notebooksOffered = useNotebooksOffered();', FORM);
  at(form, 'notebookModeAffordance({ signedIn: isAuthenticated, notebooksOffered })', FORM);
  // The mode is enabled only where the toggle is offered, so under `none` the
  // form starts in standard mode whatever the mount or the stored choice says.
  assert.equal(count(form, 'useStoredMode('), 2, 'useStoredMode is declared once and called once');
  at(form, "useStoredMode(notebookAffordance === 'toggle', defaultMode)", FORM);
  assert.ok(!form.includes('useStoredMode(isAuthenticated'), 'the mode is still enabled by sign-in alone');
});

test('#547 C3: the form shows notebook mode unavailable, with its reason, before the sign-in prompt', () => {
  const form = read(FORM);
  const toggle = at(form, "notebookAffordance === 'toggle' ? (", FORM);
  const radio = at(form, 'aria-label="Response mode"', FORM);
  const unavailable = at(form, "notebookAffordance === 'unavailable' ? (", FORM);
  const reason = at(form, '{NOTEBOOK_MODE_UNAVAILABLE_REASON}', FORM);
  const signIn = at(form, 'Sign in to execute in a signed sandbox', FORM);
  assert.ok(toggle < radio, 'the toggle branch does not render the response-mode control');
  assert.ok(radio < unavailable, 'the unavailable branch opens inside the toggle branch');
  assert.ok(unavailable < reason && reason < signIn, 'the reason is not in the unavailable branch, ahead of the sign-in prompt');
  // Shown, not hidden: the unavailable branch renders the notebook option,
  // disabled, beside the standard one.
  const branch = form.slice(unavailable, signIn);
  assert.match(branch, /Execute in a signed sandbox/, 'the unavailable branch hides the notebook option');
  assert.match(branch, /aria-disabled="true"/, 'the notebook option is not marked disabled');
  assert.ok(!/signIn\(/.test(branch), 'the unavailable branch offers sign-in');
  assert.equal(count(form, '{isAuthenticated ? ('), 0, 'the response-mode block still branches on sign-in alone');
});

test('#547 C3: the root layout carries the setting to every page, the way it carries the default portal', () => {
  const layout = read(LAYOUT);
  at(layout, "import { NotebookModeProvider } from '@/components/NotebookModeProvider';", LAYOUT);
  at(layout, "import { notebooksOffered } from '@/lib/notebook-availability';", LAYOUT);
  const open = at(layout, '<NotebookModeProvider offered={notebooksOffered()}>', LAYOUT);
  const close = at(layout, '</NotebookModeProvider>', LAYOUT);
  const children = at(layout, '<main>{children}</main>', LAYOUT);
  assert.ok(at(layout, '<Providers>', LAYOUT) < open, 'the provider sits outside the client providers');
  assert.ok(open < children && children < close, 'the provider does not wrap the page');
  assert.ok(close < at(layout, '</Providers>', LAYOUT));
});

test('#547 C3: outside the provider, and with nothing passed, an instance runs notebooks (unset is unchanged)', () => {
  const provider = read(PROVIDER);
  assert.match(provider, /^'use client';/, 'the provider is not a client component');
  assert.match(provider, /createContext<boolean>\(true\)/, 'outside the provider the form must offer notebook mode');
  assert.match(provider, /offered = true/, 'a provider passed nothing must offer notebook mode');
});

test('#547 C3: both mounts render the same form, and /ask keeps its notebook default', () => {
  const ask = read('src/app/(app)/ask/page.tsx');
  const home = read('src/app/(marketing)/page.tsx');
  at(ask, '<QuerySurface', 'ask/page.tsx');
  at(ask, 'defaultMode="notebook"', 'ask/page.tsx');
  at(home, '<QuerySurface>', '(marketing)/page.tsx');
  const surface = read('src/components/shared/QuerySurface.tsx');
  at(surface, '<QueryForm', 'QuerySurface.tsx');
});

test('#547 C5: docs/deploy.md documents EXECUTOR_DRIVER=none', () => {
  const doc = read('docs/deploy.md');
  assert.match(
    doc,
    /^\| Notebook executor \| `EXECUTOR_DRIVER` \| `vercel-sandbox`, `container`, `lambda`, `none` \|/m,
    'the driver-decision table does not list none',
  );
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /`EXECUTOR_DRIVER=none`/, 'the guide never names EXECUTOR_DRIVER=none');
  assert.match(flat, /501/, 'the guide does not state what the route answers');
  assert.match(flat, /`notebooks_not_offered`/, 'the guide does not state the code');
  assert.match(flat, /What `none` does not do/, 'the guide does not say what none does not do');
});
