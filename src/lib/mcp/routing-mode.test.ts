// #644 W1 criterion 2 — the mode: `SOURCE_ROUTING` takes `all-sources` (the
// default, also when unset) and `in-loop`.
//
// Two places read the value, and they answer a third value differently, on
// purpose (D9; the contract's two measured precedents):
//   - the preflight (`scripts/preflight-env.mjs`) refuses it, naming the
//     variable and both values and never the value, through the same
//     `allowedValues` field `NYC_CHARTER_HOSTING` uses;
//   - the running app runs it as `all-sources`, today's bytes, and logs one
//     line naming the variable and its two values, never the value. Nothing
//     runs the preflight on a hosted build, so the app cannot rely on it.
//
// That unset and `all-sources` send today's request is driven at the routes,
// in `src/app/api/in-loop-routing-driven.test.ts`, beside the in-loop request
// that differs from it.
//
// Criterion 7, the guide: `docs/deploy.md` has an "In-loop routing" section
// before "Tool names across sources", and its table is the quote test's
// twenty rows, byte for byte. The file the rows come from (`summary.md` of run
// `2026-10-19-quote-184845`, sha256 1701fd27…) is not in this repository, so
// the table is pinned here by the hash of its 22 lines (the header, the
// separator and the 20 rows), taken from that file.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/routing-mode.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { evaluateEnv, renderReport, ENV_SPEC } from '../../../scripts/preflight-env.mjs';
import { parseSourceRouting, sourceRoutingMode, SOURCE_ROUTING_MODES } from './routing-mode.ts';

const SENTINEL = 'value-SENTINEL-DO-NOT-LEAK';

function envWithAllRequired(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const spec of ENV_SPEC as Array<{ name: string; tier: string }>) {
    if (spec.tier === 'required') env[spec.name] = 'present';
  }
  return env;
}

test('the mode: the preflight passes SOURCE_ROUTING unset, all-sources and in-loop (trimmed)', () => {
  for (const value of [undefined, 'all-sources', ' in-loop ']) {
    const env = { ...envWithAllRequired(), ...(value === undefined ? {} : { SOURCE_ROUTING: value }) };
    const result = evaluateEnv(env);
    assert.equal(result.ok, true, `SOURCE_ROUTING=${JSON.stringify(value)} failed the preflight`);
    assert.deepEqual(result.valueErrors, []);
  }
  const row = (ENV_SPEC as Array<{ name: string; tier: string; hasFallback?: boolean }>).find((s) => s.name === 'SOURCE_ROUTING');
  assert.ok(row, 'ENV_SPEC declares no SOURCE_ROUTING row');
  assert.equal(row!.tier, 'optional');
  assert.equal(row!.hasFallback, true);
});

test('the mode: the preflight refuses a third value, naming the variable and both values, never the value', () => {
  for (const value of ['on', 'In-Loop', 'picker', SENTINEL]) {
    const result = evaluateEnv({ ...envWithAllRequired(), SOURCE_ROUTING: value });
    assert.equal(result.ok, false, `"${value}" passed the preflight`);
    assert.deepEqual(result.valueErrors, [{ name: 'SOURCE_ROUTING', allowed: ['all-sources', 'in-loop'] }]);
    const report = renderReport(result);
    assert.match(report, /SOURCE_ROUTING \(expected unset, or one of: all-sources, in-loop\)/);
    if (value === SENTINEL) assert.ok(!report.includes(SENTINEL), 'the value reached the report');
  }
});

test('the mode: unset, empty and all-sources run as all-sources and log nothing; in-loop runs in-loop', () => {
  const lines: string[] = [];
  const warn = (line: string) => lines.push(line);
  assert.equal(parseSourceRouting(undefined, warn), 'all-sources');
  assert.equal(parseSourceRouting('', warn), 'all-sources');
  assert.equal(parseSourceRouting('  ', warn), 'all-sources');
  assert.equal(parseSourceRouting('all-sources', warn), 'all-sources');
  assert.equal(parseSourceRouting(' in-loop ', warn), 'in-loop');
  assert.deepEqual(lines, []);
  assert.deepEqual([...SOURCE_ROUTING_MODES], ['all-sources', 'in-loop']);
});

test('the mode: a third value at run time runs as all-sources and logs one line with no value in it', () => {
  for (const value of ['on', 'In-Loop', SENTINEL]) {
    const lines: string[] = [];
    assert.equal(parseSourceRouting(value, (line) => lines.push(line)), 'all-sources');
    assert.equal(lines.length, 1, `"${value}" logged ${lines.length} lines`);
    assert.match(lines[0], /SOURCE_ROUTING/);
    assert.match(lines[0], /all-sources/);
    assert.match(lines[0], /in-loop/);
    assert.ok(!lines[0].includes(value), 'the value reached the log');
  }
});

test('the mode: sourceRoutingMode reads SOURCE_ROUTING at call time, and its log line goes to console.warn', () => {
  const saved = process.env.SOURCE_ROUTING;
  const realWarn = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    delete process.env.SOURCE_ROUTING;
    assert.equal(sourceRoutingMode(), 'all-sources');
    process.env.SOURCE_ROUTING = 'in-loop';
    assert.equal(sourceRoutingMode(), 'in-loop');
    process.env.SOURCE_ROUTING = SENTINEL;
    assert.equal(sourceRoutingMode(), 'all-sources');
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes(SENTINEL));
  } finally {
    console.warn = realWarn;
    if (saved === undefined) delete process.env.SOURCE_ROUTING;
    else process.env.SOURCE_ROUTING = saved;
  }
});

// --- Criterion 7: the guide -----------------------------------------------------------

/** sha256 of lines 5-26 of the quote test's `summary.md` (sha256 1701fd27…),
 *  joined by newlines: its table's header, separator and twenty rows. */
const QUOTE_TEST_TABLE_SHA256 = '1661cf45b79f71bde29c16440b94be7ed22486550667493edece1f2389d0eb4a';

function guideSection(): string {
  const guide = readFileSync(new URL('../../../docs/deploy.md', import.meta.url), 'utf8');
  const start = guide.indexOf('\n## In-loop routing\n');
  assert.notEqual(start, -1, 'docs/deploy.md has no "## In-loop routing" section');
  const next = guide.indexOf('\n## ', start + 1);
  assert.equal(guide.slice(next, next + '\n## Tool names across sources\n'.length), '\n## Tool names across sources\n', 'the section is not directly before "Tool names across sources"');
  return guide.slice(start + 1, next);
}

test('the guide: an "In-loop routing" section sits before "Tool names across sources"', () => {
  const section = guideSection();
  assert.match(section, /`SOURCE_ROUTING` sets how a question's data sources reach the model\./);
  assert.match(section, /run `2026-10-19-quote-184845`/);
});

test('the guide: its table is the quote test\'s twenty rows, byte for byte', () => {
  const lines = guideSection().split('\n');
  const start = lines.findIndex((line) => line.startsWith('| Model | Shape |'));
  assert.notEqual(start, -1, 'the section has no quote-test table');
  const table = lines.slice(start, start + 22);
  assert.equal(table.filter((line) => line.startsWith('| ')).length, 21, 'the table does not have a header and twenty rows');
  assert.equal(lines[start + 22], '', 'the table does not end after twenty rows');
  assert.equal(createHash('sha256').update(table.join('\n'), 'utf8').digest('hex'), QUOTE_TEST_TABLE_SHA256);
});

test('the guide: the environment reference row points to the section', () => {
  const guide = readFileSync(new URL('../../../docs/deploy.md', import.meta.url), 'utf8');
  const row = guide.split('\n').find((line) => line.startsWith('| `SOURCE_ROUTING` |'));
  assert.ok(row, 'the environment reference has no SOURCE_ROUTING row');
  assert.ok(row!.includes('(#in-loop-routing)'), 'the row does not link the section');
});
