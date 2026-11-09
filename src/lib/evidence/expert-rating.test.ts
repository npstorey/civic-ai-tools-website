// UX-2 P4a criterion 6: one rating check, and one aggregation into
// `RecordReviews`, shared by the registry's list route, the analysis page's
// reviews (P2) and the dashboard.
//
// WHAT IS READ.
//   (a) `git grep` over tracked `src/` files, tests excluded, for the check's
//       one expression (`EXPERT_RATINGS as readonly string`): exactly one site,
//       in the client-safe module `expert-rating.ts`. At the base there are two
//       (`api/evidence/list/route.ts:242`, `record-reviews.ts:60`). The
//       write-side validator (`expert-attestation.ts:68`) is a different
//       expression and is not read.
//   (b) Through the TypeScript compiler's parser: no function named `ratingOf`
//       is declared in the route or in `record-reviews.ts`; the route and the
//       dashboard page import the same names from the one server reader
//       (`@/lib/evidence/expert-rating-read`); `record-reviews.ts` and the
//       server reader both import the client-safe module.
//   (c) The client-safe module's import closure, followed through relative and
//       `@/` specifiers: no module in it is under `src/lib/storage/` or
//       `src/lib/db/`, and none imports a package or built-in (`drizzle-orm`,
//       `next/server`, `node:*`, `crypto`, `@aws-sdk/*`, `@vercel/blob`). A
//       decoy closure through a module that imports storage reads NO.
//   (d) The check and the aggregation, called: the vocabulary's words pass, a
//       word outside it and an unreadable payload give `null`, and the
//       aggregation counts the three kinds and keeps the order it is given.
//
// BLIND SPOTS, stated. (a) reads one expression: a second copy written
// another way (`EXPERT_RATINGS.some(…)`) is not seen; (b) and (d) are what
// keep the route, the page reviews and the dashboard on the one module. (c)
// follows static `import` declarations only, not `import()` calls.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expertRatingOf, tallyReviews } from './expert-rating.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const CHECK = 'EXPERT_RATINGS as readonly string';
const CLIENT_SAFE = 'src/lib/evidence/expert-rating.ts';
const SERVER_READER = '@/lib/evidence/expert-rating-read';
const ROUTE = 'src/app/api/evidence/list/route.ts';
const PAGE_REVIEWS = 'src/lib/evidence/record-reviews.ts';
const DASHBOARD = 'src/app/(app)/dashboard/page.tsx';

const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const parse = (file: string, source: string) =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Every static import of a source: its specifier and the names it binds. */
function importsOf(file: string, source: string): Array<{ specifier: string; names: string[] }> {
  const out: Array<{ specifier: string; names: string[] }> = [];
  for (const statement of parse(file, source).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const names: string[] = [];
    const clause = statement.importClause;
    if (clause?.name) names.push('default');
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) names.push((el.propertyName ?? el.name).text);
    }
    out.push({ specifier: statement.moduleSpecifier.text, names: names.sort() });
  }
  return out;
}

/** The names of every function declared in a source (declarations and `const f = (…) =>`). */
function functionNames(file: string, source: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) out.push(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) out.push(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(parse(file, source));
  return out;
}

// --- (a) one site --------------------------------------------------------------------

test('UX-2 P4a C6 (a): outside tests, the rating check is written once, in the client-safe module', () => {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-n', '-F', CHECK, '--', 'src'], { cwd: REPO, encoding: 'utf8' });
  } catch (error) {
    // git grep exits 1 when nothing matches.
    if ((error as { status?: number }).status !== 1) throw error;
  }
  const sites = out.split('\n').filter(Boolean).filter((line) => !/\.test\.[a-z]+:/.test(line));
  assert.deepEqual(
    sites.map((line) => line.slice(0, line.indexOf(':'))),
    [CLIENT_SAFE],
    `the check \`${CHECK}\` is written at: ${JSON.stringify(sites)}`,
  );
});

// --- (b) one reader, one aggregation --------------------------------------------------

test('UX-2 P4a C6 (b): the route and record-reviews.ts declare no ratingOf of their own', () => {
  for (const rel of [ROUTE, PAGE_REVIEWS]) {
    assert.ok(!functionNames(rel, read(rel)).includes('ratingOf'), `${rel} still declares its own ratingOf`);
  }
});

test('UX-2 P4a C6 (b): the route and the dashboard page import the same server reader', () => {
  const from = (rel: string) => importsOf(rel, read(rel)).filter((i) => i.specifier === SERVER_READER);
  const route = from(ROUTE);
  const page = from(DASHBOARD);
  assert.equal(route.length, 1, `${ROUTE} does not import ${SERVER_READER}`);
  assert.equal(page.length, 1, `${DASHBOARD} does not import ${SERVER_READER}`);
  assert.deepEqual(page[0].names, route[0].names, 'the route and the dashboard import different names from the reader');
  assert.ok(!importsOf(ROUTE, read(ROUTE)).some((i) => i.specifier === '@/lib/storage'), `${ROUTE} still reads storage itself`);
});

test('UX-2 P4a C6 (b): record-reviews.ts and the server reader both build on the client-safe module', () => {
  const pageReviews = importsOf(PAGE_REVIEWS, read(PAGE_REVIEWS)).find((i) => i.specifier === './expert-rating.ts');
  assert.ok(pageReviews, `${PAGE_REVIEWS} does not import ./expert-rating.ts`);
  assert.deepEqual(pageReviews.names, ['expertRatingOf', 'tallyReviews'], `${PAGE_REVIEWS} imports ${JSON.stringify(pageReviews.names)}`);
  const reader = 'src/lib/evidence/expert-rating-read.ts';
  const serverReader = importsOf(reader, read(reader)).find((i) => i.specifier === './expert-rating.ts');
  assert.ok(serverReader, `${reader} does not import ./expert-rating.ts`);
  assert.deepEqual(serverReader.names, ['expertRatingOf', 'tallyReviews'], `${reader} imports ${JSON.stringify(serverReader.names)}`);
});

// --- (c) the client-safe module's imports ---------------------------------------------

const SERVER_PACKAGES = /^(drizzle-orm|next\/server|node:|crypto$|fs$|path$|@aws-sdk\/|@vercel\/blob)/;

/** Every module in the import closure of `start`, as repository paths, and every package specifier reached. */
function closure(start: string, readSource: (rel: string) => string): { modules: string[]; packages: string[] } {
  const modules: string[] = [];
  const packages: string[] = [];
  const queue = [start];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    if (modules.includes(rel)) continue;
    modules.push(rel);
    for (const { specifier } of importsOf(rel, readSource(rel))) {
      let target: string | null = null;
      if (specifier.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), specifier));
      else if (specifier.startsWith('@/')) target = `src/${specifier.slice(2)}`;
      else { packages.push(specifier); continue; }
      const found = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`].find((c) => {
        try { return readSource(c) !== null; } catch { return false; }
      });
      queue.push(found ?? target);
    }
  }
  return { modules, packages };
}

/** Why a closure is not client-safe; empty when it is. */
function serverReach(c: { modules: string[]; packages: string[] }): string[] {
  return [
    ...c.modules.filter((m) => m.startsWith('src/lib/storage/') || m.startsWith('src/lib/db/') || m === 'src/lib/storage.ts' || m === 'src/lib/db.ts')
      .map((m) => `module ${m}`),
    ...c.packages.filter((p) => SERVER_PACKAGES.test(p)).map((p) => `package ${p}`),
  ];
}

test('UX-2 P4a C6 (c): the client-safe module reaches no storage, database or server-only module', () => {
  const c = closure(CLIENT_SAFE, read);
  console.log(`# UX2-P4A-C6 client-safe closure modules=${JSON.stringify(c.modules)} packages=${JSON.stringify(c.packages)}`);
  assert.deepEqual(serverReach(c), [], `${CLIENT_SAFE} reaches server code`);
});

test('UX-2 P4a C6 (c) decoy: a closure through a module that imports storage reads NO', () => {
  const sources: Record<string, string> = {
    'src/lib/evidence/decoy.ts': "import { check } from './decoy-helper.ts';\nexport const x = check;\n",
    'src/lib/evidence/decoy-helper.ts': "import { getPackage } from '../storage/index.ts';\nimport { eq } from 'drizzle-orm';\nexport const check = [getPackage, eq];\n",
    'src/lib/storage/index.ts': '',
  };
  const readDecoy = (rel: string) => {
    if (!(rel in sources)) throw new Error(`no ${rel}`);
    return sources[rel];
  };
  const found = serverReach(closure('src/lib/evidence/decoy.ts', readDecoy));
  assert.deepEqual(found, ['module src/lib/storage/index.ts', 'package drizzle-orm']);
});

// --- (d) the check and the aggregation, called -------------------------------------------

test('UX-2 P4a C6 (d): the check passes the vocabulary\'s words and gives null for anything else', () => {
  assert.deepEqual(
    ['endorse', 'concerns', 'dispute', 'neutral'].map((rating) => expertRatingOf({ rating })),
    ['endorse', 'concerns', 'dispute', 'neutral'],
  );
  assert.equal(expertRatingOf({ rating: 'excellent' }), null, 'a word outside the vocabulary');
  assert.equal(expertRatingOf({ rating: 3 }), null, 'a rating that is not a string');
  assert.equal(expertRatingOf({}), null, 'a payload with no rating');
  assert.equal(expertRatingOf(null), null, 'a payload that could not be read');
  assert.equal(expertRatingOf(undefined), null, 'a payload not yet read');
});

test('UX-2 P4a C6 (d): the aggregation counts the three kinds, keeps the order given, and ignores the others', () => {
  const reviews = tallyReviews([
    { type: 'expert_attestation', rating: 'dispute' },
    { type: 'evaluation', rating: null },
    { type: 'correction', rating: null },
    { type: 'expert_attestation', rating: null },
    { type: 'consistency', rating: null },
    { type: 'expert_attestation', rating: 'endorse' },
    { type: 're_evaluation', rating: null },
    { type: 'consistency', rating: null },
  ]);
  assert.deepEqual(reviews, { expertRatings: ['dispute', null, 'endorse'], evaluations: 1, consistencyTests: 2 });
  assert.deepEqual(tallyReviews([]), { expertRatings: [], evaluations: 0, consistencyTests: 0 });
});
