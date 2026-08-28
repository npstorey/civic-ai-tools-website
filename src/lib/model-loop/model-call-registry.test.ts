/**
 * The registry: who is allowed to call the model directly (#345).
 *
 * WHY A TEST AND NOT A CONVENTION. Wave N6 fixed six defects and its cold read
 * found three of them still alive elsewhere — each phase had fixed one copy of
 * a duplicated defect while honouring its blast zone exactly. The largest
 * family was the model-calling loop: three implementations, and every fix
 * landed on one of them. Nothing in the repository could say "there are three
 * of these" out loud, so nobody looked.
 *
 * This test says it out loud. Adding a `chat.completions.create` call to a
 * file that is not on the list below fails the suite, and the list carries one
 * line of justification per entry. Wave #345 consolidated every tool-calling
 * loop in the application onto one core; #356 then found a fourth loop outside
 * `src/`, in `scripts/eval-models.mjs`, and it has since been migrated too. So
 * the second list below names exactly one module, and a further entry
 * appearing on it is a regression this test reports by name.
 *
 * WHAT "A FILE" MEANS HERE, because getting this wrong is what #356 was — and
 * then nearly was again. The scan first rooted at `src/` and accepted only
 * `.ts`/`.tsx`, so a fourth tool-calling loop in `scripts/eval-models.mjs` was
 * invisible to it. Widening it to a two-directory list plus a one-level read of
 * the repository root fixed that instance and left the shape intact: a
 * hardcoded universe under a header that claimed the repository. That claim was
 * true only because every file of the JavaScript/TypeScript family this
 * repository tracks happened to sit in `src`, `scripts` or the root — true by
 * coincidence of layout, which is a thing one new directory falsifies with
 * nothing to notice it.
 *
 * The universe is now derived rather than listed. `git ls-files` supplies it:
 * every path this repository tracks, in whatever working tree the suite runs
 * in, of which the scan reads those whose name matches /\.(c|m)?[jt]sx?$/ and
 * does not match /\.test\.(c|m)?[jt]sx?$/. There is no directory list and no
 * depth limit. `node_modules`, `.next` and the build output are absent because
 * git does not track them, not because this file names them, and a file under a
 * top-level directory that does not exist yet is covered on the day it is
 * created.
 *
 * Two consequences, stated so no reader has to infer them. A file that exists
 * but has not been `git add`ed is not tracked and is not scanned — the guard
 * sees it the moment it is staged, which is before any commit, PR or merge can
 * carry it. And a tracked file deleted from the working tree is skipped,
 * because there is nothing to read. If git cannot answer at all, the scan
 * throws rather than falling back to something narrower: a guard whose header
 * overstates its reach is worse than no guard, because it is trusted, and a
 * guard that quietly reduces its own reach is the same failure with no diff to
 * point at.
 *
 * THREE ASSERTIONS, ONE INSTRUMENT. The first is the registry: who calls the
 * model at all. The second is narrower and is #345's own criterion: how many
 * modules carry a TOOL-CALLING loop, which is the thing that was triplicated. A
 * grep for `chat.completions.create` cannot answer the second (it counts
 * single-turn calls too) and a grep for `tools` cannot answer it either (it
 * hits every file that mentions the word), so the scanner below parses each
 * call's argument block and asks whether that call passes tools.
 *
 * The third asks what a call SENDS, and it is here because the first two could
 * not see the defect it measures. The adversarial-eval pair (#348) was two call
 * sites, neither of them a loop, sending the same rubric — legal under both
 * earlier lists for as long as it existed. Every assertion runs in both
 * directions: an unlisted file fails, and so does a list entry that no longer
 * describes the tree.
 *
 * WHAT THE SCANNER DOES NOT DO. It reads source text; it does not build a call
 * graph. A call assembled dynamically, or made through a helper that takes the
 * arguments as a value, is invisible to it — the same limitation
 * `ui-class-names.test.ts` and `design-tokens.test.ts` accept for their own
 * scans. It is a drift guard against the pattern that actually recurs here
 * (someone writes another loop), not a proof of exclusivity.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Every file permitted to call `chat.completions.create`, with the reason it
 * is on the list. An entry that names a phase is a debt with an owner; an
 * entry that does not is a call this wave deliberately leaves where it is.
 */
const ALLOWED_MODEL_CALLERS: Record<string, string> = {
  'src/lib/model-loop/run-tool-loop.ts':
    'The shared tool-calling loop — the one implementation the wave consolidates onto.',
  'src/lib/openrouter-streaming.ts':
    'queryWithoutMcpStreaming: the no-tools A-side of the comparison. One turn, no loop, not loop-class.',
  'src/lib/openrouter.ts':
    'queryWithoutMcp: the no-tools A-side of the comparison. One turn, no loop, not loop-class.',
  'src/lib/evidence/adversarial-eval.ts':
    'The one rubric call, no loop. Both consumers reach it here since #348 — the publication gate on the platform credential, the interactive route on the caller\'s key.',
  'src/app/api/evidence/generate-summary/route.ts':
    'One summary call, no loop. Out of this wave.',
};

/**
 * Modules carrying a tool-calling loop — a `chat.completions.create` that
 * passes `tools`. Three in `src/` when wave #345 opened
 * (`openrouter-streaming.ts`, `evidence/[slug]/replay/route.ts`,
 * `openrouter.ts`), and a fourth its census could not see because the census
 * was scoped to `src/` and to `.ts`: `scripts/eval-models.mjs` (#356). One now.
 * That count is the criterion both waves were written around, and this is where
 * it is measured.
 *
 * A second entry appearing here is a regression, reported by name. The
 * assertions below run in both directions, so this list also cannot outlive
 * what it describes: an entry that stops being a real tool-calling loop fails
 * the suite exactly as an unlisted one does.
 */
const ALLOWED_TOOL_LOOPS: Record<string, string> = {
  'src/lib/model-loop/run-tool-loop.ts': 'The shared core — the one implementation.',
};

/**
 * The one module allowed to send the adversarial-evaluation rubric to a model.
 *
 * A THIRD LIST, because the rubric is the thing that was duplicated and neither
 * list above can see it. `ALLOWED_MODEL_CALLERS` counts call sites and
 * `ALLOWED_TOOL_LOOPS` counts loops; the eval pair (#348) was two call sites,
 * neither a loop, carrying the same rubric, the same prompt builder and the
 * same `max_tokens`, and differing only in where the key came from. Both lists
 * were satisfied by that arrangement for as long as it existed. What separates
 * a legitimate second call site from a copy is what it sends, so that is what
 * this measures — an equality, so it fails in both directions like the others.
 */
const ALLOWED_RUBRIC_CALLERS = ['src/lib/evidence/adversarial-eval.ts'];

/** The rubric identifier as it appears in a call's argument list. */
const RUBRIC = 'EVALUATION_RUBRIC';

const MODEL_CALL = 'chat.completions.create';

interface ModelCall {
  file: string;
  /** The text of the call's argument list, parens balanced. */
  args: string;
}

test('#345: every model call site is on the registry, and every registry entry is a real call site', () => {
  const calls = modelCallSites();
  assert.ok(calls.length > 0, 'the scanner found no model calls at all — it has stopped measuring');

  const callers = new Set(calls.map((c) => c.file));

  for (const file of callers) {
    assert.ok(
      file in ALLOWED_MODEL_CALLERS,
      `${file} calls ${MODEL_CALL} and is not on the registry in src/lib/model-loop/model-call-registry.test.ts. ` +
        'Add it with one line saying why it is a separate call site — or, better, call runToolLoop.',
    );
  }

  for (const file of Object.keys(ALLOWED_MODEL_CALLERS)) {
    assert.ok(
      callers.has(file),
      `${file} is on the registry but no longer calls ${MODEL_CALL}. Remove the entry — a stale allowlist is a false statement about the tree.`,
    );
  }
});

test('#345: only the named modules carry a tool-calling loop', () => {
  const loops = new Set(modelCallSites().filter(passesTools).map((c) => c.file));

  for (const file of loops) {
    assert.ok(
      file in ALLOWED_TOOL_LOOPS,
      `${file} calls ${MODEL_CALL} with tools — a second tool-calling loop. This is the shape wave #345 exists to end: call runToolLoop instead.`,
    );
  }
  for (const file of Object.keys(ALLOWED_TOOL_LOOPS)) {
    assert.ok(loops.has(file), `${file} is listed as carrying a tool loop but no longer does. Remove the entry.`);
  }
});

test('#348: exactly one module sends the evaluation rubric to a model', () => {
  const rubricCallers = [
    ...new Set(modelCallSites().filter((call) => call.args.includes(RUBRIC)).map((c) => c.file)),
  ].sort();

  assert.deepEqual(
    rubricCallers,
    [...ALLOWED_RUBRIC_CALLERS].sort(),
    'the set of modules sending EVALUATION_RUBRIC to a model has changed. A second one is the #348 ' +
      'shape returning: a caller that needs a different key, or different error handling, takes ' +
      'those as parameters of runAdversarialEval rather than as a reason for another copy. An entry ' +
      'here that no longer sends the rubric is a false statement about the tree and fails the same way.',
  );
});

/** True when this call passes `tools` — `tools,` shorthand or `tools:`. */
function passesTools(call: ModelCall): boolean {
  return /(^|[\s,{])tools\s*[,:]/.test(call.args);
}

function modelCallSites(): ModelCall[] {
  return trackedSourceFiles().flatMap((file) => {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8');
    const calls: ModelCall[] = [];
    let from = 0;
    for (;;) {
      const at = source.indexOf(MODEL_CALL, from);
      if (at === -1) break;
      from = at + MODEL_CALL.length;
      if (onACommentLine(source, at)) continue;
      calls.push({ file, args: argumentList(source, from) });
    }
    return calls;
  });
}

/**
 * True when the line holding `at` opens as a comment. Enough for this scan:
 * the only non-call occurrence in the tree is a doc comment in
 * `model-client.ts`, and a general comment stripper would have to reason about
 * regex literals and URLs in string literals to do no worse.
 */
function onACommentLine(source: string, at: number): boolean {
  const lineStart = source.lastIndexOf('\n', at) + 1;
  const before = source.slice(lineStart, at).trimStart();
  return before.startsWith('//') || before.startsWith('*') || before.startsWith('/*');
}

/**
 * The text between the `(` at or after `from` and its matching `)`. String and
 * template literals are skipped so a bracket inside one cannot unbalance the
 * scan; nesting inside a template's `${}` is not tracked, which is fine
 * because no call in this tree puts one in its argument list.
 */
function argumentList(source: string, from: number): string {
  const open = source.indexOf('(', from);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = endOfString(source, i);
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/** Index of the closing quote of the string literal opening at `start`. */
function endOfString(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === quote) return i;
  }
  return source.length;
}

/**
 * Every source file this repository tracks, as repository-relative paths — the
 * same form the two registries are keyed by, so no normalisation stands between
 * what is scanned and what is listed.
 *
 * `--full-name` makes the paths repository-relative however the suite is
 * invoked, and `-z` keeps a name containing a newline from splitting into two.
 * A failure to run git at all propagates: the scan has no narrower fallback on
 * purpose, because falling back is how a guard loses reach without a diff.
 */
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
  // The one exclusion: a tracked file deleted from the working tree has nothing
  // to read. Nothing a model call could hide in is removed by it.
  return tracked.filter((name) => existsSync(join(REPO_ROOT, name)));
}

/**
 * A source file of the JavaScript/TypeScript family, tests excluded — matched
 * against a repository-relative path, which the suffix test handles as readily
 * as a bare name. Written as one predicate over the whole family rather than as
 * `.tsx?`, because the gap #356 found was an extension the filter had never
 * been asked about.
 */
function isSource(name: string): boolean {
  return /\.(c|m)?[jt]sx?$/.test(name) && !/\.test\.(c|m)?[jt]sx?$/.test(name);
}
