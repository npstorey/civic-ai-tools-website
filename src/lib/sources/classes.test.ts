// S4 W1 (npstorey/civic-ai-tools#335), criterion A6: the class function. A class is a server and the packs over it,
// identified by the server's source id, read from each manifest entry's `base` (G0-1 = A).
//
// WHAT IS DRIVEN. `src/lib/sources/classes.ts` over the real manifest (`CIVIC_MANIFEST`, router 0.12.0: eight
// entries, one pack) and over the 200-source fixture (`fixtures/manifest-200.json`: 21 servers, 179 packs over four
// bases), and over two sandbox packages with no outbound host.
//
// THE SHAPE THAT CAN FAIL. Each count is asserted exactly, and every pack's class is compared with its own `base`, so a
// function that grouped by anything else (a host, a holder, a hosting kind) is told apart: every fixture server is
// hosted alike, and the two sandbox packages share their hosting, their runs-at and their (empty) outbound list.
//
// RED AT THE BASE: there is no such module.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLASSES: string = pathToFileURL(path.join(HERE, 'classes.ts')).href;
const classes = (await import(CLASSES).catch(() => null)) as Mod | null;
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'manifest-200.json'), 'utf8')) as {
  entries: Array<{ kind: string; sourceId: string; base?: string }>;
};

function need(name: string): (...args: any[]) => any { // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(classes, 'src/lib/sources/classes.ts does not exist: no class function');
  assert.equal(typeof classes![name], 'function', `classes.ts exports no ${name}`);
  return classes![name];
}

test('A6: over the manifest\'s eight, Socrata and NYC City Record are one class identified by Socrata\'s id, and each other source is its own', () => {
  const sourceClasses = need('sourceClasses');
  assert.equal(CIVIC_MANIFEST.length, 8, 'premise: the manifest holds eight entries');
  const got = sourceClasses(CIVIC_MANIFEST) as Array<{ id: string; members: string[] }>;
  assert.deepEqual(got, [
    { id: 'socrata', members: ['socrata', 'nyc-record'] },
    { id: 'data-commons', members: ['data-commons'] },
    { id: 'boston-opencontext', members: ['boston-opencontext'] },
    { id: 'nyc-charter', members: ['nyc-charter'] },
    { id: 'nyc-checkbook', members: ['nyc-checkbook'] },
    { id: 'nys-legislation', members: ['nys-legislation'] },
    { id: 'ckan-server', members: ['ckan-server'] },
  ]);
  const classIdOf = need('classIdOf');
  for (const entry of CIVIC_MANIFEST) assert.equal(classIdOf(entry), entry.base ?? entry.sourceId, entry.sourceId);
});

test('A6: limited to the configured ids, a class lists only its configured members, and a class with none is left out', () => {
  const sourceClasses = need('sourceClasses');
  const classMembers = need('classMembers');
  const got = sourceClasses(CIVIC_MANIFEST, ['nyc-record', 'data-commons']) as Array<{ id: string; members: string[] }>;
  // In the order a class's first configured member appears: Data Commons is listed before NYC City Record.
  assert.deepEqual(got, [{ id: 'data-commons', members: ['data-commons'] }, { id: 'socrata', members: ['nyc-record'] }]);
  assert.deepEqual(classMembers(CIVIC_MANIFEST, 'socrata'), ['socrata', 'nyc-record']);
  assert.deepEqual(classMembers(CIVIC_MANIFEST, 'nyc-record'), [], 'a pack is not a class of its own');
});

test('A6: over the 200-source fixture, every pack is in its base\'s class: 21 classes, Socrata 157, Boston OpenContext 22, NYC Checkbook 2, Data Commons 2', () => {
  const sourceClasses = need('sourceClasses');
  const classIdOf = need('classIdOf');
  assert.equal(fixture.entries.length, 200, 'premise: the fixture holds 200 entries');
  const packs = fixture.entries.filter((e) => e.kind === 'pack');
  assert.equal(packs.length, 179, 'premise: 179 packs');
  for (const pack of packs) assert.equal(classIdOf(pack), pack.base, `${pack.sourceId} is not in its base's class`);
  const got = sourceClasses(fixture.entries) as Array<{ id: string; members: string[] }>;
  assert.equal(got.length, 21);
  const size = Object.fromEntries(got.map((c) => [c.id, c.members.length]));
  assert.equal(size.socrata, 157);
  assert.equal(size['boston-opencontext'], 22);
  assert.equal(size['nyc-checkbook'], 2);
  assert.equal(size['data-commons'], 2);
  assert.equal(got.filter((c) => c.members.length === 1).length, 17);
  assert.equal(got.reduce((n, c) => n + c.members.length, 0), 200, 'every source is in exactly one class');
});

test('A6: two sandbox packages with no outbound host are two classes', () => {
  const sourceClasses = need('sourceClasses');
  const hosting = [{ kind: 'npm-package', variant: 'sandbox', runsAt: 'instance-sandbox', package: '@example/x', version: '0.0.0-example', outbound: [], logging: [] }];
  const two = [
    { sourceId: 'example-sandbox-one', hostings: hosting },
    { sourceId: 'example-sandbox-two', hostings: hosting },
  ];
  assert.deepEqual(sourceClasses(two), [
    { id: 'example-sandbox-one', members: ['example-sandbox-one'] },
    { id: 'example-sandbox-two', members: ['example-sandbox-two'] },
  ]);
});
