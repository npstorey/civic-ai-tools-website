// The executed notebook's validator is never run on a skeleton (#409 P2, #401).
//
// THE RULE, AND WHY IT NEEDS A TEST. `validateNotebookProvenance` accepts
// `"executed"` and nothing else. Since #401 the skeleton generator stamps the
// vocabulary's other value, so a skeleton put through `validateExecutedNotebook`
// now reports `expected "executed", got "skeleton"` — a document doing exactly
// what it should, reported as a defect. There are two ways to make that report
// go away and only one of them is right: stop calling the validator on a
// skeleton (right), or widen the accepted values (wrong — the validator exists
// to refuse a notebook that claims execution it cannot show, and a value it
// accepted would be a value that claim could hide behind). A SKELETON IS NOT A
// VALIDATION FAILURE AND CARRIES NO VERDICT.
//
// The wrong fix is already guarded: `skeleton-states-that-it-did-not-run.test.ts`
// fails if `validateNotebookProvenance` ever stops rejecting `"skeleton"`. This
// file guards the other half — that nothing on the skeleton path calls it — and
// that half cannot be asserted by calling a function. It is a fact about call
// sites, so call sites are what it reads.
//
// WHAT "A FILE" MEANS HERE. The universe comes from `git ls-files`, not from a
// directory list: every path this repository tracks whose name is of the
// JavaScript/TypeScript family, tests excluded. `src/lib/model-loop/model-call-
// registry.test.ts` is the pattern and its header carries the full argument for
// deriving rather than listing — a check scoped to a directory cannot see a
// defect scoped to a behaviour. If git cannot answer, this throws rather than
// falling back to something narrower.
//
// WHAT IT DOES NOT DO. It reads source text; it does not build a call graph. A
// call reached through a helper that takes the validator as a value is
// invisible to it, the same limitation `design-tokens.test.ts` and the registry
// test accept. It is a drift guard against the thing that actually recurs
// (someone validates the wrong document), not a proof of exclusivity.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** The validators this file tracks, matched as calls (name followed by `(`). */
const VALIDATOR_CALLS = ['validateExecutedNotebook', 'validateNotebookProvenance'];

/**
 * The module that DEFINES them. Its own text matches the call pattern (a
 * declaration is `name(` too, and `validateExecutedNotebook` composes
 * `validateNotebookProvenance` internally), so it is excluded by name rather
 * than by a cleverer regex that would also start hiding real call sites.
 */
const DEFINING_MODULE = 'src/lib/notebook-author/validate.ts';

/**
 * Every file permitted to call an executed-notebook validator, with the reason.
 * The assertion below is an equality, so this list fails in both directions: an
 * unlisted caller fails, and so does an entry that no longer calls one.
 */
const ALLOWED_VALIDATOR_CALLERS: Record<string, string> = {
  'src/app/api/query-notebook/route.ts':
    'The executed pipeline, validating the notebook the sandbox has just run. The only document in this repository that has been executed is the only one this validator sees.',
  'src/components/notebook/__dev__/sampleExecutedNotebook.ts':
    'The dev preview fixtures, which build EXECUTED notebooks (both are stamped by `stampExecutedNotebook`) and must carry the verdict the validator actually returns on them rather than a literal beside them (#400). Neither builder produces a skeleton.',
};

/**
 * The skeleton path, named explicitly. Redundant with the equality above and
 * kept anyway: an equality failure says "an unexpected file calls a validator",
 * while this says the rule that was actually broken. These are the modules that
 * produce a skeleton or render one.
 */
const SKELETON_PATH = [
  'src/lib/notebook.ts',
  'src/components/PublishEvidenceDialog.tsx',
  'src/components/shared/McpResponseDisplay.tsx',
  'src/components/evidence/NotebookSection.tsx',
];

function isSource(name: string): boolean {
  return /\.(c|m)?[jt]sx?$/.test(name) && !/\.test\.(c|m)?[jt]sx?$/.test(name);
}

function trackedSourceFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z', '--full-name'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const tracked = listing.split('\0').filter((name) => name !== '' && isSource(name));
  assert.ok(
    tracked.length > 0,
    'git ls-files reported no source files at all. The scan has stopped measuring, which looks ' +
      'exactly like a tree with nothing to find — see the header.',
  );
  return tracked.filter((name) => existsSync(join(REPO_ROOT, name)));
}

function validatorCallers(): string[] {
  return trackedSourceFiles()
    .filter((name) => name !== DEFINING_MODULE)
    .filter((name) => {
      const text = readFileSync(join(REPO_ROOT, name), 'utf8');
      return VALIDATOR_CALLS.some((fn) => text.includes(`${fn}(`));
    })
    .sort();
}

test('the executed-notebook validator has exactly the call sites the list names', () => {
  assert.deepEqual(
    validatorCallers(),
    Object.keys(ALLOWED_VALIDATOR_CALLERS).sort(),
    'a file gained or lost a call to validateExecutedNotebook / validateNotebookProvenance. If a new ' +
      'caller is legitimate, add it here with the reason it validates an EXECUTED notebook. If it ' +
      'validates a skeleton, the fix is the call site: a skeleton is not a validation failure and the ' +
      "validator's accepted values do not move.",
  );
});

test('nothing that produces or renders a skeleton runs the executed-notebook validator', () => {
  const callers = new Set(validatorCallers());
  for (const path of SKELETON_PATH) {
    assert.ok(
      existsSync(join(REPO_ROOT, path)),
      `${path} no longer exists — this list has stopped describing the skeleton path and must be updated`,
    );
    assert.equal(
      callers.has(path),
      false,
      `${path} is on the skeleton path and calls an executed-notebook validator. A stamped skeleton ` +
        'reports `expected "executed", got "skeleton"` there — an honest stamp read as a defect.',
    );
  }
});
