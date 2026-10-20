// R6 W5 (#632): the deploy guide's section on the usage table states what the
// table holds, from the same sources the code uses.
//
// THE SECTION. `docs/deploy.md`, "The usage table: `0018`", beside "The
// consent table: `0017`". It states what is counted, column by column; that
// nothing identifies a reader; the `environment` column and its values, and
// that an instance whose previews share production's `DATABASE_URL` gets their
// rows in the same table, marked `preview`; the order of applying, the
// read-back and the reversal; and the one path where a call that answered is
// not counted as used (`/api/compare`, when its no-data half fails first).
//
// THE PINS. Every column of `usageCounts` (`getTableColumns`) is named in the
// section by its SQL name, and every value of `USAGE_ENVIRONMENTS` (`count.ts`)
// is named in it: a column or an environment added later with no line in the
// guide fails here.
//
// WHAT MAKES IT ABLE TO FAIL. At the base there is no section, no table and no
// module.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath } from 'node:url';
import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema.ts';

type NextResolve = (specifier: string, context?: unknown) => { url: string };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => { url: string } }): void;
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
  },
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUIDE = path.resolve(HERE, '..', '..', '..', 'docs', 'deploy.md');
const COUNT_MODULE: string = './count.ts';

/** The section from its heading to the next heading of the same or a higher level. */
function section(markdown: string, heading: RegExp): string | null {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^#{2,6} /.test(l) && heading.test(l));
  if (start < 0) return null;
  const level = /^(#+)/.exec(lines[start])![1].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+) /.exec(lines[i]);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

const guide = fs.readFileSync(GUIDE, 'utf8');
const USAGE = section(guide, /The usage table: `0018`/);

test('the guide has a section "The usage table: `0018`" directly after "The consent table: `0017`"', () => {
  assert.ok(USAGE, 'docs/deploy.md has no "The usage table: `0018`" section');
  const consent = section(guide, /The consent table: `0017`/);
  assert.ok(consent, 'premise: the guide has the consent table section');
  const lines = guide.split('\n');
  const consentAt = lines.findIndex((l) => /^#{2,6} /.test(l) && /The consent table: `0017`/.test(l));
  const usageAt = lines.findIndex((l) => /^#{2,6} /.test(l) && /The usage table: `0018`/.test(l));
  const nextHeadingAfterConsent = lines.findIndex((l, i) => i > consentAt && /^#{2,6} /.test(l));
  assert.equal(usageAt, nextHeadingAfterConsent, 'the usage section is not the next section after the consent one');
});

test('the section names every column of usageCounts by its SQL name', () => {
  assert.ok(USAGE, 'no section');
  const table = (schema as Record<string, unknown>).usageCounts;
  assert.ok(table, 'schema.ts exports no usageCounts');
  for (const column of Object.values(getTableColumns(table as PgTable))) {
    assert.ok(USAGE.includes(`\`${column.name}\``), `the section does not name \`${column.name}\``);
  }
});

test('the section names every value of USAGE_ENVIRONMENTS, and says a preview sharing production\'s DATABASE_URL writes rows marked preview', async () => {
  assert.ok(USAGE, 'no section');
  let environments: readonly string[] | undefined;
  try {
    environments = ((await import(COUNT_MODULE)) as { USAGE_ENVIRONMENTS?: readonly string[] }).USAGE_ENVIRONMENTS;
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND') assert.fail('no module at src/lib/usage/count.ts');
    throw error;
  }
  assert.ok(environments && environments.length > 0, 'count.ts exports no USAGE_ENVIRONMENTS');
  for (const value of environments) assert.ok(USAGE.includes(`\`${value}\``), `the section does not name the environment \`${value}\``);
  assert.match(USAGE, /DATABASE_URL/);
  assert.match(USAGE, /share[^.]*`DATABASE_URL`[^.]*`preview`|`preview`[^.]*share[^.]*`DATABASE_URL`/, 'the section does not say a preview sharing production\'s DATABASE_URL writes rows marked preview');
});

test('the section gives the order of applying, the read-back, the reversal, and the one uncounted answered call', () => {
  assert.ok(USAGE, 'no section');
  assert.match(USAGE, /drizzle\/0018_usage_counts\.sql/);
  assert.match(USAGE, /\\d usage_counts/, 'no read-back');
  assert.match(USAGE, /DROP TABLE IF EXISTS usage_counts/, 'no reversal');
  assert.match(USAGE, /\*{0,2}before\*{0,2} the deploy/i, 'no order of applying');
  assert.match(USAGE, /`\/api\/compare`/, 'the section does not name the one path where an answered call is not counted');
});
