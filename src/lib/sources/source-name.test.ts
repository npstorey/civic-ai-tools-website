// R6 W3 (#632), criterion 11 and G7's T13: a source's name as the reader
// surfaces show it (the panel, the card, the Sources tab, the notices and
// the privacy page). Every manifest `displayName` ends "MCP Server" (router
// 0.4.0), which is implementation language to a reader (design principles,
// P9). `readerSourceName` takes the source: it keys on `sourceId` with one
// override (`data-commons` reads "Data Commons", ruled at G7), and every
// other source's name is its `displayName` (or registry `label`) with a
// trailing " MCP Server" removed; a name without the suffix is shown whole,
// and the suffix is removed only at the end.
//
// THE RECORD NAME. The record page names a source through
// `displayNameForSource` (`src/lib/evidence/data-sources.ts`). The reader
// function does not import it (that would bring the registry and the harness
// into the client bundle through the panel and the card), so this test pins
// the two equal for every manifest entry: the reader name and the record
// name cannot drift. `displayNameForSource` is imported here, in the test
// only.
//
// WHAT MAKES IT ABLE TO FAIL. Before G7 the function stripped the suffix
// alone, which reads "Google Data Commons" where the record reads "Data
// Commons" (measured at 90ba21a).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { readerSourceName } from './source-name.ts';
import { displayNameForSource } from '../evidence/data-sources.ts';
import * as copyModule from './copy.ts';
import * as sourceNameModule from './source-name.ts';

test('T13: every manifest entry reads the record page\'s name, from its displayName and from a registry label alike', () => {
  assert.ok(CIVIC_MANIFEST.length >= 4, 'premise: the manifest has its four entries');
  for (const entry of CIVIC_MANIFEST) {
    assert.ok(entry.displayName.endsWith(' MCP Server'), `premise: ${entry.sourceId}'s name ends " MCP Server" (${entry.displayName})`);
    const record = displayNameForSource(entry.sourceId);
    assert.equal(readerSourceName({ sourceId: entry.sourceId, displayName: entry.displayName }), record, `${entry.sourceId}: the reader name and the record name differ`);
    assert.equal(readerSourceName({ sourceId: entry.sourceId, label: entry.displayName }), record, `${entry.sourceId}: a label reads differently from a displayName`);
    assert.ok(!record.includes('MCP Server'), `premise: the record name of ${entry.sourceId} carries no "MCP Server"`);
  }
  assert.equal(readerSourceName({ sourceId: 'data-commons', displayName: 'Google Data Commons MCP Server' }), 'Data Commons');
});

test('criterion 11: a name without the suffix is shown whole, and the suffix is removed only at the end', () => {
  for (const whole of ['Boston Open Data', 'An MCP Server Directory', 'MCP Server', 'Fixture MCP Servers']) {
    assert.equal(readerSourceName({ sourceId: 'fixture-source', displayName: whole }), whole, `"${whole}" was changed`);
  }
  assert.equal(readerSourceName({ sourceId: 'fixture-source', displayName: 'Fixture MCP Server' }), 'Fixture');
});

// --- R6 PL: the map of what each source is and whose connector reaches it ----------------------
//
// CRITERION 2: THE MAP IS PINNED TO THE MANIFEST, BOTH WAYS. `SOURCE_DESCRIPTIONS`
// (`./copy.ts`) has one entry per manifest source and names no other; each
// entry's publisher, after a leading "the " is removed, is the manifest's
// `publisher`; each entry's link is the address in the manifest entry's `id`,
// the part after the "@" that precedes "https://" (for `@betanyc/…` the first
// "@" is the package scope). ONE EXCEPTION, named here: Boston's `id` carries
// its endpoint (`…@https://data-mcp.boston.gov/mcp`), which is not a page, so
// its link is pinned to the ruled literal. The manifest is imported here, in
// the test only. The checker is a function, driven red on synthetic fixtures
// (a manifest with an extra entry, a map missing one, a publisher and a link
// that differ) before it is run on the real pair.
//
// THE FUNCTION (§2). `sourceRowLines` takes a statement source (`sourceId`,
// `publisher`, `host`, `variant`) and returns the what-line as stored (or
// null) and the reach sentence as segments, the publisher a link segment when
// the source has an entry. It is exported for every surface that prints a
// source's publisher.
//
// CRITERION 6: THE IMPORTS. The panel is a client component, so
// `source-name.ts` and what it imports by value import nothing from the
// router, `src/lib/mcp/` or `src/lib/evidence/`, and import
// `../flows/statement.ts` (which imports `node:crypto` and the router) by
// `import type` only. It reads the map and the reach sentence from
// `./copy.ts`. Read from the source text with the TypeScript parser, over the
// closure of local value imports. Blind spots: `import()` and `require()` are
// not read, and `import { type X }` without `import type` is counted as a
// value import (it can leave a bare `import {}` that still loads the module).
//
// WHAT MAKES IT ABLE TO FAIL. At the base `./copy.ts` has no map, there is no
// `sourceRowLines`, and `source-name.ts` imports neither the map nor the
// reach sentence.

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const copyExports = copyModule as unknown as Mod;
const sourceNameExports = sourceNameModule as unknown as Mod;

interface ManifestLike { sourceId: string; id: string; publisher?: string }
interface EntryLike { what: string; publisher: string; link: string }

/** Criterion 2's one exception: Boston's `id` carries its endpoint, not a page. */
const LINK_EXCEPTIONS: Readonly<Record<string, string>> = {
  'boston-opencontext': 'https://github.com/CityOfBoston/OpenContext',
};

/** The address in a manifest `id`: the part after the "@" that precedes "https://". */
function addressInId(id: string): string | null {
  const at = id.indexOf('@https://');
  return at < 0 ? null : id.slice(at + 1);
}

/** Every way the map and the manifest disagree, by source. */
function mapDrift(map: Readonly<Record<string, EntryLike>>, manifest: readonly ManifestLike[]): string[] {
  const problems: string[] = [];
  const ids = new Set(manifest.map((e) => e.sourceId));
  for (const entry of manifest) {
    const row = map[entry.sourceId];
    if (row === undefined) {
      problems.push(`${entry.sourceId}: no map entry`);
      continue;
    }
    const printed = row.publisher.replace(/^the /, '');
    if (printed !== (entry.publisher ?? 'not stated')) problems.push(`${entry.sourceId}: publisher "${row.publisher}" is not the manifest's "${entry.publisher}"`);
    const link = LINK_EXCEPTIONS[entry.sourceId] ?? addressInId(entry.id);
    if (row.link !== link) problems.push(`${entry.sourceId}: link ${row.link} is not ${link}`);
  }
  for (const sourceId of Object.keys(map)) if (!ids.has(sourceId)) problems.push(`${sourceId}: names no manifest source`);
  return problems;
}

test('PL criterion 2: the map is pinned to the manifest both ways, and the checker is red on an extra source, a missing entry, a publisher and a link', () => {
  const map = copyExports.SOURCE_DESCRIPTIONS as Record<string, EntryLike> | undefined;
  assert.ok(map && typeof map === 'object', './copy.ts exports no SOURCE_DESCRIPTIONS');
  const manifest = CIVIC_MANIFEST as unknown as ManifestLike[];
  const extra = [...manifest, { sourceId: 'fixture-extra', id: 'fixture-extra@https://github.com/fixture/extra', publisher: 'Fixture' }];
  assert.deepEqual(mapDrift(map!, extra), ['fixture-extra: no map entry'], 'a manifest with an extra entry is not reported');
  const missing = { ...map! };
  delete missing['data-commons'];
  assert.deepEqual(mapDrift(missing, manifest), ['data-commons: no map entry'], 'a map missing an entry is not reported');
  assert.deepEqual(mapDrift({ ...map!, 'fixture-stray': { what: 'a stray.', publisher: 'Nobody', link: 'https://github.com/fixture/stray' } }, manifest), ['fixture-stray: names no manifest source'], 'a map entry naming no manifest source is not reported');
  assert.deepEqual(mapDrift({ ...map!, socrata: { ...map!.socrata, publisher: 'Tyler Technologies' } }, manifest).length, 1, 'a publisher that differs is not reported');
  assert.deepEqual(mapDrift({ ...map!, 'nyc-charter': { ...map!['nyc-charter'], link: 'https://github.com/betanyc' } }, manifest).length, 1, 'a link that differs is not reported');
  assert.deepEqual(mapDrift(map!, manifest), [], 'the map and the manifest disagree');
  assert.ok(Object.values(map!).every((e) => typeof e.what === 'string' && e.what.length > 0), 'an entry has no what-line');
});

test('PL §2: sourceRowLines takes a statement source and returns the stored what-line and the reach sentence, the publisher a link segment when mapped', () => {
  const lines = sourceNameExports.sourceRowLines as ((source: unknown) => { what: string | null; reach: Array<string | { link: string; text: string }> }) | undefined;
  assert.equal(typeof lines, 'function', './source-name.ts exports no sourceRowLines');
  const variant = { variant: 'remote', kind: 'remote', runsAt: 'other' };
  const join = (reach: Array<string | { link: string; text: string }>) => reach.map((p) => (typeof p === 'string' ? p : p.text)).join('');
  const mapped = lines!({ sourceId: 'socrata', publisher: 'npstorey', host: 'socrata.fixture.example', variant });
  assert.equal(mapped.what, 'an open-data portal platform from Tyler Technologies. Many cities and states publish their data on its portals.');
  assert.equal(join(mapped.reach), 'This site reaches it through an MCP server, a connector that npstorey publishes, running at socrata.fixture.example.');
  assert.deepEqual(mapped.reach.filter((p) => typeof p !== 'string'), [{ link: 'https://github.com/npstorey/socrata-mcp-server', text: 'npstorey' }]);
  const unmapped = lines!({ sourceId: 'fixture-unmapped', publisher: 'Fixture Publisher', variant: { ...variant, runsAt: 'instance-sandbox' } });
  assert.equal(unmapped.what, null);
  assert.deepEqual(unmapped.reach, ["This site reaches it through an MCP server, a connector that Fixture Publisher publishes, running at this site's sandbox."]);
  const unstated = lines!({ sourceId: 'fixture-unstated', publisher: 'not stated', host: 'unstated.fixture.example', variant });
  assert.deepEqual(unstated.reach, ['This site reaches it through an MCP server, a connector whose publisher is not stated, running at unstated.fixture.example.']);
});

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = path.resolve(SRC, '..');
const ROUTER = '@typedstandards/civic-typed-router';
const STATEMENT = 'src/lib/flows/statement.ts';

interface ImportFact { from: string; resolved: string | null; typeOnly: boolean; names: string[] }

/** A file's static imports and re-exports, each resolved to a repository path when it is local. */
function importsOf(fileRel: string, sourceText: string): ImportFact[] {
  const file = ts.createSourceFile(fileRel, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const resolve = (from: string): string | null => {
    if (from.startsWith('@/')) return path.posix.join('src', from.slice(2));
    if (from.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(fileRel), from));
    return null;
  };
  const out: ImportFact[] = [];
  for (const node of file.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text) : [];
      out.push({ from: node.moduleSpecifier.text, resolved: resolve(node.moduleSpecifier.text), typeOnly: Boolean(clause?.isTypeOnly), names: named });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push({ from: node.moduleSpecifier.text, resolved: resolve(node.moduleSpecifier.text), typeOnly: node.isTypeOnly, names: [] });
    }
  }
  return out;
}

/** What a client-bundled file and its local value imports must not import, by file. */
function clientImportProblems(entryRel: string, read: (rel: string) => string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const queue = [entryRel];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const fact of importsOf(rel, read(rel))) {
      const at = `${rel}: ${fact.from}`;
      const problem =
        fact.from === ROUTER || fact.from.startsWith(`${ROUTER}/`) ? '(the router)'
        : fact.resolved?.startsWith('src/lib/mcp/') ? '(src/lib/mcp/)'
        : fact.resolved?.startsWith('src/lib/evidence/') ? '(src/lib/evidence/)'
        : fact.resolved === STATEMENT && !fact.typeOnly ? '(not `import type`)'
        : null;
      if (problem !== null) problems.push(`${at} ${problem}`);
      // A file already reported is not followed; any other local value import is.
      else if (fact.resolved !== null && !fact.typeOnly && fact.resolved !== STATEMENT && /\.tsx?$/.test(fact.resolved)) queue.push(fact.resolved);
    }
  }
  return problems;
}

test('PL criterion 6: source-name.ts imports only types from ../flows/statement.ts, nothing from the router, src/lib/mcp/ or src/lib/evidence/, and reads the map from ./copy.ts', () => {
  const ENTRY = 'src/lib/sources/source-name.ts';
  const onDisk = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
  // The checker, red on fixtures first: each line below, added to the real file, is one problem.
  const real = onDisk(ENTRY);
  for (const [line, expected] of [
    ["import { buildFlowsStatementFor } from '../flows/statement.ts';", '(not `import type`)'],
    ["import { type FlowsSource } from '../flows/statement.ts';", '(not `import type`)'],
    ["import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';", '(the router)'],
    ["import { buildMcpRegistry } from '../mcp/registry.ts';", '(src/lib/mcp/)'],
    ["import type { DataSourceEntry } from '@/lib/evidence/data-sources';", '(src/lib/evidence/)'],
    ["export { x } from '../evidence/signing.ts';", '(src/lib/evidence/)'],
  ] as const) {
    const problems = clientImportProblems(ENTRY, (rel) => (rel === ENTRY ? `${line}\n${real}` : onDisk(rel)));
    assert.equal(problems.length, 1, `the check does not report one problem for: ${line} (${problems.join('; ')})`);
    assert.ok(problems[0].endsWith(expected), `the check reports "${problems[0]}" for: ${line}`);
  }
  // Then the real file and what it imports by value.
  assert.deepEqual(clientImportProblems(ENTRY, onDisk), [], 'source-name.ts, or a file it imports by value, imports what a client component must not');
  const fromCopy = importsOf(ENTRY, real).filter((f) => f.resolved === 'src/lib/sources/copy.ts' && !f.typeOnly).flatMap((f) => f.names);
  for (const name of ['SOURCE_DESCRIPTIONS', 'REACH_SENTENCE']) assert.ok(fromCopy.includes(name), `source-name.ts does not read ${name} from ./copy.ts`);
});

// R8 W3 criterion 7: the three what-lines the owner approved (21:11:34Z,
// relayed 23:46:16Z), each stored byte for byte as it reads mid-sentence, and
// each entry's publisher and link. Red before the three entries are added.
const W3_ENTRIES: Record<string, { what: string; publisher: string; link: string }> = {
  'nyc-checkbook': {
    what: "New York City's spending, contracts, budget figures and payroll, as the City Comptroller publishes them on Checkbook NYC.",
    publisher: 'BetaNYC',
    link: 'https://github.com/BetaNYC/nyc-checkbook-mcp',
  },
  'nyc-record': {
    what: "notices in The City Record, New York City's official journal: procurement, public hearings and other agency notices.",
    publisher: 'BetaNYC',
    link: 'https://github.com/BetaNYC/nyc-record-mcp',
  },
  'nys-legislation': {
    what: "New York State's bills and the votes on them, and the State's laws, from the State Senate's Open Legislation service.",
    publisher: 'BetaNYC',
    link: 'https://github.com/BetaNYC/nys-openlegislation-mcp',
  },
};

test('R8 W3 criterion 7: the three new entries are stored byte for byte as approved', () => {
  const map = copyExports.SOURCE_DESCRIPTIONS as Record<string, EntryLike> | undefined;
  for (const [sourceId, expected] of Object.entries(W3_ENTRIES)) {
    const entry = map?.[sourceId];
    assert.ok(entry, `${sourceId} has no map entry`);
    assert.equal(Buffer.from(entry!.what, 'utf8').toString('hex'), Buffer.from(expected.what, 'utf8').toString('hex'), `${sourceId}'s what-line is not the approved one, byte for byte`);
    assert.equal(entry!.publisher, expected.publisher);
    assert.equal(entry!.link, expected.link);
  }
  // Record's stored form starts lower-case: the panel upper-cases it, the
  // privacy page prints it as stored.
  assert.ok(W3_ENTRIES['nyc-record'].what.startsWith('notices in The City Record'));
});
