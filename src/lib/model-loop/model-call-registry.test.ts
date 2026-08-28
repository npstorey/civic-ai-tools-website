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
 * line of justification per entry. The wave closed with every tool-calling
 * loop in the application consolidated: the second list below names the shared
 * core and one script, and a further entry appearing on it is a regression
 * this test reports by name.
 *
 * WHAT "A FILE" MEANS HERE, because getting this wrong is what #356 was. The
 * scan first rooted at `src/` and accepted only `.ts`/`.tsx`, so a fourth
 * tool-calling loop in `scripts/eval-models.mjs` was invisible to it and the
 * claim in the paragraph above was false as written, with a live
 * counter-example in the tree. It now covers `src/`, `scripts/` and the
 * configuration files at the repository root — every JavaScript or TypeScript
 * file this repository tracks — in every extension of the family (`.ts`,
 * `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`). A guard whose header
 * overstates its reach is worse than no guard, because it is trusted.
 *
 * TWO ASSERTIONS, ONE INSTRUMENT. The first is the registry: who calls the
 * model at all. The second is narrower and is the wave's own criterion: how
 * many modules carry a TOOL-CALLING loop, which is the thing that was
 * triplicated. A grep for `chat.completions.create` cannot answer the second
 * (it counts single-turn calls too) and a grep for `tools` cannot answer it
 * either (it hits every file that mentions the word), so the scanner below
 * parses each call's argument block and asks whether that call passes tools.
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
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Where the scan looks. `src` and `scripts` are walked; the repository root is
 * read one level deep, which is where the four configuration modules live and
 * is what keeps `node_modules`, `.next` and the build output out of the walk.
 */
const SCAN_DIRECTORIES = ['src', 'scripts'];

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
    'One rubric call, no loop. Out of this wave by ruling D4; the eval pair is #348.',
  'src/app/api/evidence/[slug]/evaluate/route.ts':
    'The second copy of that same rubric call, caller-keyed. Out of this wave by ruling D4 (#348).',
  'src/app/api/evidence/generate-summary/route.ts':
    'One summary call, no loop. Out of this wave.',
  'scripts/eval-models.mjs':
    'The model-selection harness: a fourth tool-calling loop that carries the full class. Migration is the next wave’s (#356).',
};

/**
 * Modules carrying a tool-calling loop — a `chat.completions.create` that
 * passes `tools`. Three in `src/` when this wave opened
 * (`openrouter-streaming.ts`, `evidence/[slug]/replay/route.ts`,
 * `openrouter.ts`); one now. That count is the wave's own first acceptance
 * criterion, and this is where it is measured.
 *
 * The second entry is the debt #356 found, listed rather than fixed: the point
 * of naming it here is that it stops being invisible to the suite. It is not a
 * fourth application loop — nothing it writes is served, signed or
 * user-facing — but it is the same shape, and it chooses which models this
 * instance offers.
 */
const ALLOWED_TOOL_LOOPS: Record<string, string> = {
  'src/lib/model-loop/run-tool-loop.ts': 'The shared core.',
  'scripts/eval-models.mjs':
    'The model-selection harness: carries the full class; migration is the next wave’s (#356).',
};

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

/** True when this call passes `tools` — `tools,` shorthand or `tools:`. */
function passesTools(call: ModelCall): boolean {
  return /(^|[\s,{])tools\s*[,:]/.test(call.args);
}

function modelCallSites(): ModelCall[] {
  return scannedFiles().flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    const file = relative(REPO_ROOT, path).split(sep).join('/');
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

/** Every JavaScript/TypeScript source file in the scanned scope. */
function scannedFiles(): string[] {
  return [
    ...rootLevelFiles(),
    ...SCAN_DIRECTORIES.flatMap((dir) => sourceFiles(join(REPO_ROOT, dir))),
  ];
}

/** The configuration modules at the repository root — read, never walked. */
function rootLevelFiles(): string[] {
  return readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isSource(entry.name))
    .map((entry) => join(REPO_ROOT, entry.name));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return isSource(entry.name) ? [full] : [];
  });
}

/**
 * A source file of the JavaScript/TypeScript family, tests excluded. Written
 * as one predicate over the whole family rather than as `.tsx?`, because the
 * gap #356 found was an extension the filter had never been asked about.
 */
function isSource(name: string): boolean {
  return /\.(c|m)?[jt]sx?$/.test(name) && !/\.test\.(c|m)?[jt]sx?$/.test(name);
}
