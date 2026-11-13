// UX-2 P3b-2 (#729), v2 ruling 1 and the seat's check on fix 9 (#729 6865424128): one predicate decides whether a
// question can stop to ask about an Ask-first source, and it is the server's.
//
// THE RULE. `canPauseToAsk` (`useSourceConsent.ts`) is true only for routing `in-loop` with the decision store set,
// both read. The server's `canAsk` (`src/lib/sources/consent-gate.ts`) holds the same test; it keeps its own copy because
// its module reads the store and the database, which a client component cannot import. So the two copies are held
// equal here, on all four routing x store pairs and on an unread pair, which both read as cannot ask
// (`canAsk(undefined)` is false).
//
// WHAT IS READ. Both functions, called; and a source scan of the tracked components that word Ask first by it.
//
// WHAT MAKES IT ABLE TO FAIL. A client copy that reads `routing` alone is true on in-loop with no store; one that reads
// `store` alone is true on all-sources with the store; one that falls back to in-loop on an unread pair is true there.
// Each is a row below that would read differently from `canAsk`.
//
// BLIND SPOT, stated. `noSourceOnReason` (the guard's and the where-line's) treats an unread pair as able to ask, by
// ruling (v3 conflict ruling 1); it is not this predicate and is not compared here.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONSENT_SURFACE_STUBS, SRC, registerSurfaceHooks } from './surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const { canPauseToAsk } = await load('components/sources/useSourceConsent.ts');
const { canAsk } = await load('lib/sources/consent-gate.ts');
const ROOT = path.resolve(SRC, '..');

test('P3b-2 fix 9: the client predicate and the server\'s canAsk agree on every routing x store pair, and on an unread pair', () => {
  const rows: Array<[string, { routing: 'in-loop' | 'all-sources' | null; store: boolean | null }]> = [
    ['in-loop, store', { routing: 'in-loop', store: true }],
    ['in-loop, no store', { routing: 'in-loop', store: false }],
    ['all-sources, store', { routing: 'all-sources', store: true }],
    ['all-sources, no store', { routing: 'all-sources', store: false }],
    ['unread', { routing: null, store: null }],
    ['in-loop, store unread', { routing: 'in-loop', store: null }],
  ];
  const read = rows.map(([what, pair]) => {
    const server = pair.routing === null || pair.store === null ? canAsk(undefined) : canAsk({ routing: pair.routing, store: pair.store });
    return [what, canPauseToAsk(pair), server];
  });
  assert.deepEqual(read, [
    ['in-loop, store', true, true],
    ['in-loop, no store', false, false],
    ['all-sources, store', false, false],
    ['all-sources, no store', false, false],
    ['unread', false, false],
    ['in-loop, store unread', false, false],
  ]);
});

test('P3b-2 fix 9: the Settings row words Ask first by the predicate, not by its own copy of the test (a source scan)', () => {
  const row = fs.readFileSync(path.join(SRC, 'components', 'sources', 'SourceRow.tsx'), 'utf8');
  assert.match(row, /canPauseToAsk\(/, 'SourceRow.tsx does not call canPauseToAsk');
  assert.doesNotMatch(row, /routing === 'in-loop'/, 'SourceRow.tsx keeps its own copy of the routing test');
  const tracked = execFileSync('git', ['ls-files', '--', 'src'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'src/lib/sources/consent-gate.ts' && f !== 'src/components/sources/useSourceConsent.ts');
  const copies = tracked.filter((f) => /\.routing === 'in-loop' && [\w.]+\.store === true/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(copies, [], 'a component keeps its own copy of the in-loop-with-store test');
});

test('P3b-2 criterion 1 (v2 ruling 1): the Settings row and the harness menu call the one predicate (a source scan, as where-line.test.ts scans for noSourceOnReason)', () => {
  const callers = ['src/components/sources/SourceRow.tsx', 'src/components/composer/HarnessMenu.tsx'].map((f) => {
    const p = path.join(ROOT, f);
    return [f, fs.existsSync(p) && /canPauseToAsk\(/.test(fs.readFileSync(p, 'utf8'))];
  });
  assert.deepEqual(callers, [['src/components/sources/SourceRow.tsx', true], ['src/components/composer/HarnessMenu.tsx', true]]);
});
