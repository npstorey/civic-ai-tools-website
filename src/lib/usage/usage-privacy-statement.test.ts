// R6 W5 (#632), criterion 4: the privacy page says the site counts questions,
// pinned to the usage table's columns (ruling B = A).
//
// THE RULE. One statement, `usage-count`, beside the rate limiter's daily
// counts: in "What connects your activity to you", directly after the
// statement that describes the daily count codes (`daily-key`). It renders
// only when a database is configured (`env:DATABASE_URL`), as
// `prompt-text-database` does, since without one nothing is counted. On
// Vercel (`env:VERCEL_ENV`) one more sentence says that questions asked on
// test versions of the site are counted too, and marked as test counts; off
// Vercel every row reads `local`, so that sentence is not rendered.
//
// THE PIN. `USAGE_COUNT_COLUMNS` in `src/lib/privacy-facts.ts` maps each
// column of `usageCounts` (by its schema key) to the words that state it.
// This test reads `getTableColumns(usageCounts)` and requires the map's keys
// to equal the columns in both directions, and every column's words to be in
// the rendered statement (the `environment` column's only on Vercel). A column
// added later with no words fails here, and so do words left for a column
// that is gone.
//
// THE WORDING CHECK, from the owner's research on reader-facing text: an
// average under 15 words a sentence, none over 21, and "cannot" over "can't".
//
// WHAT MAKES IT ABLE TO FAIL. At the base there is no statement, no map and
// no table. The mutation the phase report records adds a schema column with
// no words.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema.ts';

type Segment = string | { link: string; text: string } | { code: string };
interface Statement { id: string; parts: Segment[]; traces: string[]; items?: Segment[][]; after?: Segment[] }
interface Section { id: string; heading: string; statements: Statement[] }

const facts = (await import('../privacy-facts.ts')) as unknown as {
  buildPrivacySections(analytics: null): Section[];
  USAGE_COUNT_COLUMNS?: Readonly<Record<string, string>>;
};

const text = (parts: Segment[] = []) => parts.map((p) => (typeof p === 'string' ? p : 'link' in p ? p.text : p.code)).join('');

const ENV_NAMES = ['DATABASE_URL', 'VERCEL_ENV'] as const;

function render(env: Partial<Record<(typeof ENV_NAMES)[number], string>>): Section[] {
  const saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  try {
    for (const n of ENV_NAMES) {
      if (env[n] === undefined) delete process.env[n];
      else process.env[n] = env[n];
    }
    return facts.buildPrivacySections(null);
  } finally {
    for (const n of ENV_NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
}

/** A placeholder, never opened: the facts module reads only its presence. */
const DATABASE = 'postgresql://fixture@127.0.0.1:9/fixture';

function usageStatement(sections: Section[]): { section: Section; index: number; statement: Statement } | null {
  for (const section of sections) {
    const index = section.statements.findIndex((s) => s.id === 'usage-count');
    if (index >= 0) return { section, index, statement: section.statements[index] };
  }
  return null;
}

function sentences(rendered: string): string[] {
  return rendered.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

const words = (sentence: string) => sentence.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));

function columns(): string[] {
  const table = (schema as Record<string, unknown>).usageCounts;
  assert.ok(table, 'schema.ts exports no usageCounts');
  return Object.keys(getTableColumns(table as PgTable));
}

test('criterion 4: with a database configured, the statement renders directly after the daily-key statement', () => {
  for (const vercel of [undefined, 'production']) {
    const found = usageStatement(render({ DATABASE_URL: DATABASE, VERCEL_ENV: vercel }));
    assert.ok(found, `no usage-count statement (VERCEL_ENV=${String(vercel)})`);
    assert.equal(found.section.id, 'links');
    assert.equal(found.section.statements[found.index - 1]?.id, 'daily-key', 'the statement does not follow the daily-key statement');
    assert.ok(found.statement.traces.includes('env:DATABASE_URL'), 'the statement does not trace DATABASE_URL');
    assert.ok(found.statement.traces.includes('env:VERCEL_ENV'), 'the statement does not trace VERCEL_ENV');
  }
});

test('criterion 4: with no database configured, nothing is counted and the statement is not rendered', () => {
  assert.equal(usageStatement(render({ VERCEL_ENV: 'production' })), null);
  assert.equal(usageStatement(render({})), null);
});

test('criterion 4: every column of usageCounts has words on the page, and every word has a column, both directions', () => {
  const map = facts.USAGE_COUNT_COLUMNS;
  assert.ok(map, 'privacy-facts.ts exports no USAGE_COUNT_COLUMNS');
  assert.deepEqual(Object.keys(map).sort(), columns().sort(), 'the map\'s keys are not the table\'s columns');
  for (const [column, phrase] of Object.entries(map)) assert.ok(phrase.trim().length > 0, `${column} has empty words`);
});

test('criterion 4: on Vercel the statement says every column, the test-version sentence included', () => {
  const map = facts.USAGE_COUNT_COLUMNS;
  assert.ok(map, 'privacy-facts.ts exports no USAGE_COUNT_COLUMNS');
  const found = usageStatement(render({ DATABASE_URL: DATABASE, VERCEL_ENV: 'preview' }));
  assert.ok(found, 'no usage-count statement on Vercel');
  const rendered = text(found.statement.parts);
  for (const column of columns()) assert.ok(rendered.includes(map[column]), `on Vercel the statement does not say "${map[column]}" (${column}):\n${rendered}`);
  assert.match(rendered, /test versions of this site/);
});

test('criterion 4: off Vercel every row reads local, so the test-version sentence is not rendered', () => {
  const map = facts.USAGE_COUNT_COLUMNS;
  assert.ok(map, 'privacy-facts.ts exports no USAGE_COUNT_COLUMNS');
  const found = usageStatement(render({ DATABASE_URL: DATABASE }));
  assert.ok(found, 'no usage-count statement off Vercel');
  const rendered = text(found.statement.parts);
  for (const column of columns().filter((c) => c !== 'environment')) {
    assert.ok(rendered.includes(map[column]), `off Vercel the statement does not say "${map[column]}" (${column}):\n${rendered}`);
  }
  assert.ok(!rendered.includes(map.environment), `off Vercel the statement says "${map.environment}":\n${rendered}`);
  assert.doesNotMatch(rendered, /test versions/);
});

test('criterion 4: the statement says what a count keeps none of: no account, no network address, no question text', () => {
  for (const vercel of [undefined, 'production']) {
    const found = usageStatement(render({ DATABASE_URL: DATABASE, VERCEL_ENV: vercel }));
    assert.ok(found, 'no usage-count statement');
    const rendered = text(found.statement.parts);
    assert.match(rendered, /no account/);
    assert.match(rendered, /no network address/);
    assert.match(rendered, /no question text/);
  }
});

test('criterion 4: the wording check: under 15 words a sentence on average, none over 21, and no "can\'t"', () => {
  for (const vercel of [undefined, 'production']) {
    const found = usageStatement(render({ DATABASE_URL: DATABASE, VERCEL_ENV: vercel }));
    assert.ok(found, 'no usage-count statement');
    const rendered = text(found.statement.parts);
    const counts = sentences(rendered).map((s) => words(s).length);
    const average = counts.reduce((a, b) => a + b, 0) / counts.length;
    assert.ok(average < 15, `average ${average.toFixed(1)} words a sentence (${counts.join(', ')}):\n${rendered}`);
    assert.ok(Math.max(...counts) <= 21, `a sentence of ${Math.max(...counts)} words:\n${rendered}`);
    assert.doesNotMatch(rendered, /can't|can’t/i);
  }
});
