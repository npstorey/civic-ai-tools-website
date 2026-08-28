// Tests for scripts/eval-models.mjs.
//
// TWO REFUSALS (civic-ai-tools#155 P1 E4). SOCRATA_MCP_URL used to default to
// https://socrata-mcp.civicaitools.org when unset, silently routing an
// unconfigured run's queries through infrastructure the caller does not
// operate. It now refuses with a named error instead. Spawned as a CHILD
// PROCESS so the refusal is exercised the same way an operator would trigger
// it, before any model/MCP call is made.
//
// AND THE RUNNER (#356). The harness imports the shared tool-calling loop from
// src/lib/model-loop/run-tool-loop.ts — a TypeScript module, imported from a
// `.mjs` file. Until #356 this file's own header asserted that could not work.
// It can, and the two spawns below prove it twice over: the refusal tests run
// the harness itself with no flags, so a broken import would fail them by not
// reaching the env gate at all, and the third test states the property on its
// own so a failure names the cause instead of looking like a config bug.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './eval-models.mjs',
);

const CORE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/lib/model-loop/run-tool-loop.ts',
);

test('refuses with a named error when OPENROUTER_API_KEY is unset', () => {
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  delete env.SOCRATA_MCP_URL;

  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8', timeout: 15_000, env });

  assert.equal(result.status, 1, `expected exit 1\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /OPENROUTER_API_KEY/);
});

test('refuses with a named error when SOCRATA_MCP_URL is unset (no reference-host default)', () => {
  const env = { ...process.env, OPENROUTER_API_KEY: 'not-a-real-key' };
  delete env.SOCRATA_MCP_URL;

  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8', timeout: 15_000, env });

  assert.equal(result.status, 1, `expected exit 1\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /SOCRATA_MCP_URL/);
  // The old default must not appear anywhere in the refusal.
  assert.doesNotMatch(result.stdout + result.stderr, /socrata-mcp\.civicaitools\.org/);
});

test('#356: a flagless `node` can import the shared tool-calling core', () => {
  // NO FLAGS, on purpose. `npm test` runs this suite under
  // --experimental-strip-types, and inheriting that flag here would hide the
  // one case an operator actually meets: `node scripts/eval-models.mjs`.
  const source =
    `import { runToolLoop } from ${JSON.stringify(pathToFileURL(CORE).href)};\n` +
    'process.stdout.write(typeof runToolLoop);\n';

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf-8',
    timeout: 30_000,
  });

  assert.equal(
    result.status,
    0,
    'a flagless `node` could not import src/lib/model-loop/run-tool-loop.ts, which ' +
      'scripts/eval-models.mjs imports at module scope. Node strips types from an imported `.ts` ' +
      'by default only from v22.18; below that the harness needs --experimental-strip-types, and ' +
      `package.json's engines.node is ">=22", which still admits those versions. Running ` +
      `${process.version}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(result.stdout, 'function');
});

test('#356: the harness drives the shared core rather than a loop of its own', () => {
  const source = readFileSync(SCRIPT, 'utf-8');

  assert.match(
    source,
    /import \{ runToolLoop \} from '\.\.\/src\/lib\/model-loop\/run-tool-loop\.ts';/,
    'the harness must import the shared loop, not reimplement one',
  );
  assert.match(source, /await runToolLoop\(\{/, 'the harness must actually call it');

  // This file's copy of the wave's own criterion, kept where the migration
  // happened. The class-wide statement — no second tool-calling loop anywhere
  // this repository tracks — lives in
  // src/lib/model-loop/model-call-registry.test.ts, which is where a scan
  // scoped to one file would be the #356 defect all over again.
  assert.doesNotMatch(
    source,
    /args\.portal\s*=[^=]/,
    'portal injection is the loop\'s, above the tool-call record and the trace span (#359)',
  );
  assert.doesNotMatch(
    source,
    /JSON\.parse\(toolCall\./,
    'parsing the arguments the model chose belongs inside the loop\'s failure path (#349)',
  );
});
