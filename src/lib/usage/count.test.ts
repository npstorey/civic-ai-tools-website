// R6 W5 (#632), criterion 1, the CI half: the row the usage counter builds.
//
// THE RULE (D9, and the contract's table). A run is counted as one row of
// `usage_counts`, keyed on eight columns, every one from a closed set:
//   day              the UTC date when the run ends (never the server's local date)
//   environment      `hostingEnvironment()` read through a closed set
//                    (`USAGE_ENVIRONMENTS`): production, preview, development, or
//                    local off Vercel; any other value is recorded as `other`
//   surface          the route: `compare-stream`, `query-notebook` or `compare`
//   signed_in        whether the session carries an account id
//   model            the model's declared id
//   outcome          `complete` or `error`
//   sources_offered  the ids whose reason offers them (configured or selected),
//                    sorted and comma-joined; '' for none
//   sources_used     the ids with at least one call that answered, in the same
//                    form; a failed call is not use
// and `count`, 1 for the insert. No identifier and no text reach a column.
//
// WHAT IS DRIVEN. `usageRow`, the pure builder `src/lib/usage/count.ts`
// exports, given what a route holds when its run ends: the session as
// `getServerSession` returns it, the model identity, the offered reasons, the
// run's tool-call records with their arguments, and the route's source
// resolver. Canaries are planted in every value an identifier or a question
// could travel in: the account id, the `dbId`, the account's name and email,
// the question text inside a call's arguments, and the endpoint's model
// string. The scratch-database drive (the phase report's) plants the
// network address too, which this builder is never handed.
//
// WHAT MAKES EACH ASSERTION ABLE TO FAIL. At the base there is no module.
// Beyond that: the run ends at 01:30 UTC with the process in a timezone four
// hours behind, so a builder that reads the local date writes the day before;
// the calls arrive in two orders, so a builder that does not sort splits one
// combination into two rows; a call that failed is the only call to its
// source, so a builder that counts calls rather than answers names that
// source; and a reason that is not offered sits beside each offered one.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as nodeModule from 'node:module';
import * as schema from '../db/schema.ts';

// `next/server` resolves under `node --test` only by its file name; the module
// may write it either way, as the routes write it bare.
type NextResolve = (specifier: string, context?: unknown) => { url: string };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => { url: string } }): void;
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
  },
});

// Four hours behind UTC in October, so 01:30Z is the previous local day.
process.env.TZ = 'America/New_York';
delete process.env.VERCEL_ENV;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');

/** The module W5 adds, named by a specifier typed string so this file
 *  type-checks before it exists. */
const COUNT_MODULE: string = './count.ts';

type Surface = 'compare-stream' | 'query-notebook' | 'compare';
interface UsageRunInput {
  surface: Surface;
  session: unknown;
  model: { declared: string; endpointModel: string };
  outcome: 'complete' | 'error';
  sourcesOffered: ReadonlyArray<{ sourceId: string; alias?: string; reason: string }>;
  toolCalls: ReadonlyArray<{ name: string; args: Record<string, unknown>; failed?: boolean; failureKind?: string }>;
  resolveSource: (toolName: string) => string | undefined;
  endedAt: Date;
}
interface UsageModule {
  USAGE_WRITE_TIMEOUT_MS: number;
  USAGE_ENVIRONMENTS: readonly string[];
  usageRow(input: UsageRunInput): Record<string, unknown>;
}

async function loadCount(): Promise<UsageModule> {
  let mod: Partial<UsageModule>;
  try {
    mod = (await import(COUNT_MODULE)) as Partial<UsageModule>;
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND') assert.fail('no module at src/lib/usage/count.ts');
    throw error;
  }
  assert.equal(typeof mod.usageRow, 'function', 'count.ts exports no usageRow');
  return mod as UsageModule;
}

const CANARY = {
  accountId: 'canary-account-7f3a91',
  dbId: '0c0ffee0-cana-4ry0-db1d-000000005a5a',
  name: 'Canary Readername',
  email: 'canary-reader@example.org',
  question: 'canary question text about pothole repairs on elm street',
  endpointModel: 'canary-endpoint-deployment',
};

const SOURCE_OF: Record<string, string> = {
  socrata__get_data: 'socrata',
  socrata__search: 'socrata',
  datacommons__search_indicators: 'data-commons',
};
const resolveSource = (name: string): string | undefined => SOURCE_OF[name];

const TOOL_CALLS: UsageRunInput['toolCalls'] = [
  { name: 'socrata__search', args: { query: CANARY.question } },
  // The only call to Data Commons, and it failed: not use.
  { name: 'datacommons__search_indicators', args: { query: CANARY.question }, failed: true, failureKind: 'unavailable' },
  { name: 'socrata__get_data', args: { type: 'query', dataset_id: 'aaaa-1111', query: `SELECT * WHERE text = '${CANARY.question}'` } },
  // A call no configured server took: no source to name.
  { name: 'ckan__search_datasets', args: { query: CANARY.question }, failed: true, failureKind: 'not_configured' },
];

const SESSION = {
  user: { id: CANARY.accountId, dbId: CANARY.dbId, name: CANARY.name, email: CANARY.email },
  expires: '2026-11-18T00:00:00.000Z',
};

function input(overrides: Partial<UsageRunInput> = {}): UsageRunInput {
  return {
    surface: 'compare-stream',
    session: SESSION,
    model: { declared: 'vendor/model-fixture-1', endpointModel: CANARY.endpointModel },
    outcome: 'complete',
    sourcesOffered: [
      { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
      { sourceId: 'data-commons', alias: 'data_commons', reason: 'configured' },
      { sourceId: 'boston-opencontext', alias: 'boston', reason: 'not-configured' },
      { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'reader-off' },
    ],
    toolCalls: TOOL_CALLS,
    resolveSource,
    endedAt: new Date('2026-10-20T01:30:00.000Z'),
    ...overrides,
  };
}

const EXPECTED = {
  day: '2026-10-20',
  environment: 'local',
  surface: 'compare-stream',
  signedIn: true,
  model: 'vendor/model-fixture-1',
  outcome: 'complete',
  sourcesOffered: 'data-commons,socrata',
  sourcesUsed: 'socrata',
  count: 1,
};

test('criterion 1: the row is the eight key columns and a count of one, from what the route holds', async () => {
  assert.equal(new Date('2026-10-20T01:30:00.000Z').getDate(), 19, 'premise: the process is in a timezone where 01:30Z is the previous local day');
  const { usageRow } = await loadCount();
  assert.deepEqual(usageRow(input()), EXPECTED);
});

test('criterion 1: no canary reaches any column: no account id, dbId, name, email, question text or endpoint string', async () => {
  const { usageRow } = await loadCount();
  const bytes = JSON.stringify(usageRow(input()));
  for (const [what, canary] of Object.entries(CANARY)) {
    assert.ok(!bytes.includes(canary), `the row carries the ${what} canary: ${bytes}`);
  }
  // The question's words, one at a time, so a fragment cannot pass either.
  for (const word of CANARY.question.split(' ').filter((w) => w.length > 5)) {
    assert.ok(!bytes.includes(word), `the row carries "${word}" from the question: ${bytes}`);
  }
});

test('criterion 1: the row\'s keys are the schema\'s columns, in both directions', async () => {
  const { usageRow } = await loadCount();
  const table = (schema as Record<string, unknown>).usageCounts;
  assert.ok(table, 'schema.ts exports no usageCounts');
  assert.deepEqual(Object.keys(usageRow(input())).sort(), Object.keys(getTableColumns(table as PgTable)).sort());
});

test('criterion 1: one combination is one row whatever order its calls ran in', async () => {
  const { usageRow } = await loadCount();
  const reversed = usageRow(input({ toolCalls: [...TOOL_CALLS].reverse(), sourcesOffered: [...input().sourcesOffered].reverse() }));
  assert.deepEqual(reversed, usageRow(input()));
  const bothUsed = usageRow(input({
    toolCalls: [
      { name: 'datacommons__search_indicators', args: {} },
      { name: 'socrata__get_data', args: {} },
    ],
  }));
  const bothUsedReversed = usageRow(input({
    toolCalls: [
      { name: 'socrata__get_data', args: {} },
      { name: 'datacommons__search_indicators', args: {} },
    ],
  }));
  assert.equal(bothUsed.sourcesUsed, 'data-commons,socrata');
  assert.deepEqual(bothUsedReversed, bothUsed);
});

test('criterion 1: a run with no offered source and no answered call writes empty strings, not nulls', async () => {
  const { usageRow } = await loadCount();
  const row = usageRow(input({
    sourcesOffered: [{ sourceId: 'socrata', reason: 'not-selected' }, { sourceId: 'data-commons', reason: 'not-consented' }],
    toolCalls: [{ name: 'socrata__get_data', args: {}, failed: true, failureKind: 'not_offered' }],
    outcome: 'error',
  }));
  assert.equal(row.sourcesOffered, '');
  assert.equal(row.sourcesUsed, '');
  assert.equal(row.outcome, 'error');
});

test('criterion 1: signed_in is whether the session carries an account id, and nothing else of the session', async () => {
  const { usageRow } = await loadCount();
  assert.equal(usageRow(input({ session: null })).signedIn, false);
  assert.equal(usageRow(input({ session: { user: { name: CANARY.name } } })).signedIn, false);
  assert.equal(usageRow(input({ session: { user: { id: '' } } })).signedIn, false);
  assert.equal(usageRow(input()).signedIn, true);
});

test('criterion 1: environment is hostingEnvironment() through the closed set: VERCEL_ENV, local off Vercel, other for anything else', async () => {
  const { usageRow, USAGE_ENVIRONMENTS } = await loadCount();
  assert.deepEqual([...USAGE_ENVIRONMENTS], ['production', 'preview', 'development', 'local', 'other']);
  try {
    for (const [value, expected] of [
      [undefined, 'local'], ['production', 'production'], ['preview', 'preview'], ['development', 'development'], ['', 'local'],
      // hostingEnvironment() passes any [a-z]{1,16} through, for the sandbox name; the count does not.
      ['staging', 'other'], ['customenv', 'other'],
      // hostingEnvironment() reads this as `local`, so the count does too.
      ['Preview-2', 'local'],
    ] as const) {
      if (value === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = value;
      assert.equal(usageRow(input()).environment, expected, `VERCEL_ENV=${String(value)}`);
    }
  } finally {
    delete process.env.VERCEL_ENV;
  }
});

test('criterion 1: every column takes its value from a closed set', async () => {
  const { usageRow } = await loadCount();
  const rows: Array<Record<string, unknown>> = [];
  for (const surface of ['compare-stream', 'query-notebook', 'compare'] as const) {
    for (const outcome of ['complete', 'error'] as const) {
      for (const session of [SESSION, null]) rows.push(usageRow(input({ surface, outcome, session })));
    }
  }
  const SOURCE_IDS = new Set(['socrata', 'data-commons', 'boston-opencontext', 'nyc-charter']);
  const idList = (v: unknown) => typeof v === 'string' && (v === '' || v.split(',').every((id) => SOURCE_IDS.has(id)));
  const VALUE_SETS: Record<string, (v: unknown) => boolean> = {
    day: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
    environment: (v) => v === 'local' || v === 'production' || v === 'preview' || v === 'development' || v === 'other',
    surface: (v) => v === 'compare-stream' || v === 'query-notebook' || v === 'compare',
    signedIn: (v) => typeof v === 'boolean',
    model: (v) => v === 'vendor/model-fixture-1',
    outcome: (v) => v === 'complete' || v === 'error',
    sourcesOffered: idList,
    sourcesUsed: idList,
    count: (v) => v === 1,
  };
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), Object.keys(VALUE_SETS).sort(), 'a column with no value set');
    for (const [column, inSet] of Object.entries(VALUE_SETS)) {
      assert.ok(inSet(row[column]), `${column} = ${JSON.stringify(row[column])} is outside its set`);
    }
  }
  assert.deepEqual(new Set(rows.map((r) => r.surface)), new Set(['compare-stream', 'query-notebook', 'compare']));
});

test('criterion 1: the write is bounded at 10 s, by a named constant', async () => {
  const { USAGE_WRITE_TIMEOUT_MS } = await loadCount();
  assert.equal(USAGE_WRITE_TIMEOUT_MS, 10_000);
});

test('"offered" is one predicate: the router\'s isOfferedReason, which replay-loop.ts and count.ts both import', () => {
  const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
  const countFile = path.join(SRC, 'lib/usage/count.ts');
  assert.ok(fs.existsSync(countFile), 'no src/lib/usage/count.ts');
  for (const rel of ['lib/model-loop/replay-loop.ts', 'lib/usage/count.ts']) {
    const source = read(rel);
    assert.match(source, /\bisOfferedReason\b/, `${rel} does not use the shared predicate`);
    assert.doesNotMatch(source, /===\s*'configured'|===\s*'selected'/, `${rel} restates the predicate inline`);
  }
});
