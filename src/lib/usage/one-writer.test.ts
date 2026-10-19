// R6 W5 (#632), criterion 3: the usage table has one writer and no reader.
//
// THE RULE (D9, W5 step 3). `usage_counts` is written only. No route, page or
// module reads it: the monthly file and any read path are later work. So
// exactly two files outside tests name the table, each for one job:
//   src/lib/db/schema.ts    defines it (`usageCounts`, `pgTable('usage_counts')`)
//   src/lib/usage/count.ts  writes it (`insert(usageCounts)`), and reads nothing
// The privacy page's statement is pinned to the table's columns by a test
// (`usage-privacy-statement.test.ts`), so `privacy-facts.ts` does not name
// the table either.
//
// THE UNIVERSE IS DERIVED, as in `model-call-registry.test.ts`: `git ls-files`
// supplies every tracked path, and the scan reads those of the
// JavaScript/TypeScript family (/\.(c|m)?[jt]sx?$/) that are not tests. There
// is no directory list. Two consequences: a file that exists but is not
// staged is not seen (stage it first), and if git cannot answer the scan
// throws rather than reading something narrower. SQL, JSON and Markdown are
// outside it: the migration, its snapshot and the deploy guide name the table
// by design and read nothing.
//
// BOTH DIRECTIONS. A file outside the list that names the table fails, by
// name; and an entry on the list that no longer does its job (the file is
// gone, untracked, names nothing, or the writer gains a read) fails too, so
// the list cannot outlive the tree it describes.
//
// WHAT MAKES IT ABLE TO FAIL. At the base `schema.ts` names no usage table and
// `count.ts` does not exist, so both entries fail. A staged decoy reader, and
// an entry renamed to a path that does not exist, are the mutation reds the
// phase report records.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

const NAMES = /\busageCounts\b|\busage_counts\b/;
const CODE = /\.(c|m)?[jt]sx?$/;
const TEST = /\.test\.(c|m)?[jt]sx?$/;

/** What each allowed file must do with the table, and must not. */
const ALLOWED: Record<string, { job: string; describes: (source: string) => string | null }> = {
  'src/lib/db/schema.ts': {
    job: 'defines the table',
    describes: (source) =>
      /export const usageCounts\s*=\s*pgTable\(\s*'usage_counts'/.test(source)
        ? null
        : 'does not define `export const usageCounts = pgTable(\'usage_counts\', …)`',
  },
  'src/lib/usage/count.ts': {
    job: 'writes the table and reads nothing',
    describes: (source) => {
      if (!/\.insert\(\s*usageCounts\s*\)/.test(source)) return 'does not insert into usageCounts';
      const read = /\.select\s*\(|\.selectDistinct\s*\(|\.from\s*\(|\.query\.|\.execute\s*\(|\.returning\s*\(|findFirst|findMany|\.update\s*\(|\.delete\s*\(/.exec(source);
      return read ? `does more than insert: \`${read[0]}\`` : null;
    },
  },
};

function trackedCode(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  const files = out.split('\0').filter((f) => f.length > 0);
  if (files.length === 0) throw new Error('git ls-files returned nothing: the scan cannot see the tree');
  return files.filter((f) => CODE.test(f) && !TEST.test(f));
}

const UNIVERSE = trackedCode();

function namers(): string[] {
  return UNIVERSE.filter((f) => {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) return false;
    return NAMES.test(fs.readFileSync(abs, 'utf8'));
  });
}

test('criterion 3: premise — the scan reads the tracked tree, the schema and the routes among it', () => {
  for (const f of ['src/lib/db/schema.ts', 'src/app/api/compare-stream/route.ts', 'src/app/api/query-notebook/route.ts', 'src/app/api/compare/route.ts']) {
    assert.ok(UNIVERSE.includes(f), `the scan does not see ${f}`);
  }
});

test('criterion 3: no file outside the list names the usage table', () => {
  const strays = namers().filter((f) => !Object.prototype.hasOwnProperty.call(ALLOWED, f));
  assert.deepEqual(strays, [], `files name usageCounts or usage_counts outside the one writer and the schema:\n${strays.join('\n')}`);
});

test('criterion 3: every entry on the list describes the tree: tracked, naming the table, doing its one job', () => {
  const problems: string[] = [];
  const named = new Set(namers());
  for (const [file, { job, describes }] of Object.entries(ALLOWED)) {
    if (!UNIVERSE.includes(file)) { problems.push(`${file} (${job}): not a tracked file`); continue; }
    if (!named.has(file)) { problems.push(`${file} (${job}): names no usage table`); continue; }
    const why = describes(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    if (why) problems.push(`${file} (${job}): ${why}`);
  }
  assert.deepEqual(problems, []);
});
