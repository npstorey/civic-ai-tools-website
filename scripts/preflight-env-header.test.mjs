// Guard: preflight-env.test.mjs's header does not claim it is excluded from
// `npm test`'s glob (#385, Wave N9).
//
// WHY. `scripts/preflight-env.test.mjs:5-6` reads, at `c342fe0`:
//
//   // (The repo's `npm test` globs src/**/*.test.ts; this scripts/ test is
//   // run explicitly — and would be wired into the cross-repo CI bundle,
//   // brief #5.)
//
// `package.json:18`'s `test` script is
// `node --test --experimental-strip-types 'src/**/*.test.ts' 'scripts/**/*.test.mjs'`
// — it globs `scripts/**/*.test.mjs` too, so `preflight-env.test.mjs` (and
// this file, which matches the same glob) already runs under `npm test`. The
// comment is stale, not aspirational: nothing needs to change for it to
// become true, only for it to stop claiming otherwise.
//
// BLIND SPOT, STATED. This reads two files as text. It does not run
// `npm test` and check that this file (or `preflight-env.test.mjs`) actually
// executes — the harness's own `npm test` run is the check that would show
// that; this guard only checks the header stopped making the false claim
// and that `package.json` still has the glob the header should agree with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PREFLIGHT_TEST_PATH = fileURLToPath(new URL('./preflight-env.test.mjs', import.meta.url));
const PACKAGE_JSON_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

// The claim wraps across two `//` comment lines in the source ("...this
// scripts/ test is run\n// explicitly — ..."), so the header is normalized —
// each line's leading `//` stripped, then joined with spaces — before
// matching. A regex anchored to one physical line would silently never match
// either the stale phrase or its fix.
const PREFLIGHT_HEADER = readFileSync(PREFLIGHT_TEST_PATH, 'utf8')
  .split('\n')
  .slice(0, 12)
  .map((line) => line.replace(/^\/\/\s?/, ''))
  .join(' ');
const PACKAGE_JSON = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));

test('#385: package.json test script globs scripts/**/*.test.mjs', () => {
  const testScript = PACKAGE_JSON.scripts && PACKAGE_JSON.scripts.test;
  assert.ok(testScript, 'package.json has no "test" script — update this guard if it moved');
  assert.ok(
    testScript.includes('scripts/**/*.test.mjs'),
    `package.json's test script no longer globs scripts/**/*.test.mjs: ${testScript}`,
  );
});

test('#385: preflight-env.test.mjs header does not say it is excluded from npm test', () => {
  assert.ok(
    !/this scripts\/ test is run\s+explicitly/i.test(PREFLIGHT_HEADER),
    'the header still claims npm test globs only src/**/*.test.ts and that this test is run ' +
      'explicitly outside it — package.json\'s test script globs scripts/**/*.test.mjs too (#385): ' +
      PREFLIGHT_HEADER,
  );
});
