/**
 * The census of where a pack's call is decided (S2-B F1, npstorey/civic-ai-tools#309).
 *
 * THE RULE. A pack's call is decided once, from the target the dispatch sends to. The loop core reads that target
 * through `ToolLoopOptions.dispatchTarget`, which each caller supplies beside the transport it sends with, from the
 * same selection. The option is optional: omitted, the core decides from the called name alone, as it did before,
 * which is right for a transport that sends with no selection and wrong for one that narrows. So an omission is not
 * caught by the compiler; it is caught here, and by the driven test each entry below names.
 *
 * WHAT THIS TEST SCANS. Every file of the JavaScript/TypeScript family this repository tracks (`git ls-files`, the
 * same universe `model-call-registry.test.ts` derives, tests excluded), for four constructs: a call of the loop core
 * (`runToolLoop(`), a call of the streaming loop (`queryWithMcpStreaming(`), the creation of an in-loop routing
 * (`createInLoopRouting(`), and a send with a selection (`callMcpTool(name, args, { selection` or the in-loop
 * transport's `callTool(name, args, { selection`). Comment lines are skipped; a function's own declaration is not a
 * call.
 *
 * WHAT IT ASSERTS, in both directions. The files holding each construct are exactly the files `ENTRIES` lists for it:
 * a new caller fails by name, and so does an entry that no longer describes the tree. Each entry that builds a
 * transport or forwards one names the decision in its code (`dispatchTarget`); each that delegates names the factory it
 * delegates to, which is itself an entry that supplies it. Each entry names the driven tests that hold its behaviour,
 * and each of those is a tracked file.
 *
 * WHAT IT CANNOT SEE, stated so no reader infers more:
 *   - A construct spelled another way: an import under another name, a call through a variable or a dynamic
 *     property, a send whose arguments are not named `name, args`, or code built at run time.
 *   - Whether a decision is supplied from the SAME selection as its send. A mention of `dispatchTarget` is presence,
 *     not agreement; the driven tests measure agreement, and `src/lib/mcp/dispatch-target-agrees-with-the-send.test.ts`
 *     measures the resolver against the send over every selection.
 *   - A file not yet `git add`ed, and a test file (excluded on purpose: tests drive the core with fakes).
 *
 * Run with: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

type Construct = 'runToolLoop' | 'queryWithMcpStreaming' | 'createInLoopRouting' | 'sendWithSelection';

const CONSTRUCTS: Record<Construct, RegExp> = {
  runToolLoop: /(?<!function )\brunToolLoop\(/,
  queryWithMcpStreaming: /(?<!function )\bqueryWithMcpStreaming\(/,
  createInLoopRouting: /(?<!function )\bcreateInLoopRouting\(/,
  sendWithSelection: /\b(?:callMcpTool|callTool)\(\s*name\s*,\s*args\s*,\s*\{\s*selection\b/,
};

interface Entry {
  constructs: Construct[];
  /** `'supplies'`: the file's code names `dispatchTarget`. Otherwise the factory file it delegates the decision to. */
  decision: 'supplies' | string;
  /** The driven tests that hold this entry's behaviour. */
  drivenBy: string[];
}

const DRIVEN = {
  core: 'src/lib/model-loop/a-pack-call-is-decided-by-its-target.test.ts',
  routes: 'src/app/api/a-pack-call-is-decided-by-its-target-routes-driven.test.ts',
  evalRow: 'scripts/eval-models-pack-call.test.mjs',
};

const ENTRIES: Record<string, Entry> = {
  // The four entry points of the loop core.
  'src/lib/openrouter-streaming.ts': { constructs: ['runToolLoop'], decision: 'supplies', drivenBy: [DRIVEN.core, DRIVEN.routes] },
  'src/app/api/compare/route.ts': { constructs: ['runToolLoop', 'createInLoopRouting'], decision: 'src/lib/model-loop/compare-loop.ts', drivenBy: [DRIVEN.core] },
  'src/app/api/evidence/[slug]/replay/route.ts': { constructs: ['runToolLoop'], decision: 'src/lib/model-loop/replay-loop.ts', drivenBy: [DRIVEN.core] },
  'scripts/eval-models.mjs': { constructs: ['runToolLoop', 'createInLoopRouting'], decision: 'supplies', drivenBy: [DRIVEN.evalRow] },
  // The two routes that hand the streaming loop its transport.
  'src/app/api/query-notebook/route.ts': { constructs: ['queryWithMcpStreaming', 'createInLoopRouting', 'sendWithSelection'], decision: 'supplies', drivenBy: [DRIVEN.routes] },
  'src/app/api/compare-stream/route.ts': { constructs: ['queryWithMcpStreaming', 'createInLoopRouting', 'sendWithSelection'], decision: 'supplies', drivenBy: [DRIVEN.routes] },
  // The two factories, and the in-loop transport.
  'src/lib/model-loop/compare-loop.ts': { constructs: ['sendWithSelection'], decision: 'supplies', drivenBy: [DRIVEN.core] },
  'src/lib/model-loop/replay-loop.ts': { constructs: ['createInLoopRouting', 'sendWithSelection'], decision: 'supplies', drivenBy: [DRIVEN.core] },
  'src/lib/mcp/routing-mode.ts': { constructs: ['sendWithSelection'], decision: 'supplies', drivenBy: [DRIVEN.core, DRIVEN.routes, DRIVEN.evalRow] },
};

const isSource = (name: string) => /\.(c|m)?[jt]sx?$/.test(name) && !/\.test\.(c|m)?[jt]sx?$/.test(name);

function trackedFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z', '--full-name'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const tracked = listing.split('\0').filter((name) => name !== '');
  assert.ok(tracked.length > 0, 'git ls-files reported nothing: the census has stopped measuring');
  return tracked;
}

/** The file's code lines: comment lines dropped, so a construct named in prose is not a call. */
function codeOf(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
}

const TRACKED = trackedFiles();
const SOURCES = TRACKED.filter((name) => isSource(name) && existsSync(join(REPO_ROOT, name)));
const CODE = new Map(SOURCES.map((file) => [file, codeOf(file)]));

for (const construct of Object.keys(CONSTRUCTS) as Construct[]) {
  test(`census: the files holding ${construct} are exactly the listed entries`, () => {
    const found = SOURCES.filter((file) => CONSTRUCTS[construct].test(CODE.get(file)!)).sort();
    const listed = Object.entries(ENTRIES).filter(([, entry]) => entry.constructs.includes(construct)).map(([file]) => file).sort();
    assert.ok(found.length > 0, `the scan found no ${construct} at all: it has stopped measuring`);
    assert.deepEqual(found, listed, `${construct}: a file holds it that the census does not list, or a listed file no longer holds it`);
  });
}

test("census: every entry names the decision, or delegates it to a factory that names it", () => {
  const missing: string[] = [];
  for (const [file, entry] of Object.entries(ENTRIES)) {
    const supplier = entry.decision === 'supplies' ? file : entry.decision;
    if (supplier !== file) assert.equal(ENTRIES[supplier]?.decision, 'supplies', `${file} delegates to ${supplier}, which is not an entry that supplies the decision`);
    if (!/\bdispatchTarget\b/.test(CODE.get(supplier) ?? '')) missing.push(supplier === file ? file : `${file} (through ${supplier})`);
  }
  assert.deepEqual(missing, [], 'these entries hand the loop a transport with no decision beside it');
});

test('census: every entry names driven tests, and each is a tracked file', () => {
  for (const [file, entry] of Object.entries(ENTRIES)) {
    assert.ok(entry.drivenBy.length > 0, `${file} names no driven test`);
    for (const driven of entry.drivenBy) assert.ok(TRACKED.includes(driven), `${file}'s driven test ${driven} is not tracked`);
  }
});
