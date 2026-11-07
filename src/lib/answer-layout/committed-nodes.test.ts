// LAYOUT-WEB W4 P2 criteria (2) and (11), and reading 6: the committed layout
// nodes under `public/.well-known/layouts/`, and how they reach the code.
//
// (2) Every committed node document is read from disk here (a test may; the
// site may not) and its seven fields must equal those of the `answer-first`
// version it names: the script builds the node from that built-in and nothing
// else. UX-2 P2 (criterion 5) reads each node's OWN version: a node file is
// never removed, so the v1 node stays committed beside the v2 node `--apply`
// adds, and v1 is no longer a built-in. Its fields are `ANSWER_FIRST_V1` below,
// the spec's §8.14.1 example as the site shipped it until UX-2 P2. The directory holds two nodes, `770ed52e…` (v1)
// and `c1ed3951…` (v2), which the script wrote under the instance's key (none
// is committed under a test key); the per-file assertions run over them, as
// over every node committed after them, and the module agreement below runs
// over the same files. UX-2 P2 (5), after `--apply`: some committed node is
// the current built-in's, so a publish has a node to name (the last test).
//
// Reading 6: `committed-nodes.ts` is the script's output form over exactly the
// node files on disk, so a node file that no import names (it would never
// reach the build) and an import with no file (the build would fail) both fail
// here, and the module is what `scripts/publish-layout.ts` would write.
//
// (11) No non-test source reads the directory through the filesystem: the
// tracked files that name it are the module (its import specifiers) and the
// script (which writes there and reads only the module), and no other.
//
// Run with: npm test (or node --test --experimental-strip-types src/lib/answer-layout/committed-nodes.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeEnvelopeHash, parseStrictJson, CONTENT_LAYOUT } from '@typedstandards/verify-core';
import { ANSWER_FIRST, BUILT_IN_LAYOUTS, layoutId, type LayoutPayload } from './index.ts';
import { layoutFieldsOf } from './node-reading.ts';
import { COMMITTED_LAYOUT_DOCUMENTS } from './committed-nodes.ts';
import { committedModuleNodeIds, committedModuleSource } from '../../../scripts/publish-layout.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const LAYOUTS = path.join(REPO, 'public', '.well-known', 'layouts');
const MODULE = path.join(HERE, 'committed-nodes.ts');
const NODE_FILE = /^[0-9a-f]{64}\.json$/;

/** `answer-first` v1, the built-in until UX-2 P2 (copied by hand, as `index.test.ts` copies the spec's example). */
const ANSWER_FIRST_V1: LayoutPayload = {
  name: 'answer-first',
  version: 1,
  appliesTo: ['default', 'datHere'],
  order: ['status', 'answer', 'citation', 'steps', 'sources', 'disclosure', 'actions'],
  disclosure: {
    label: 'Learn more about how this analysis was produced',
    order: ['A', 'B', 'C', 'D', 'E', 'G', 'signers', 'attestations', 'verification'],
    openByDefault: false,
  },
  steps: { placement: 'beside', openByDefault: true },
  rendererVersion: 'answer-view/1',
};

/** Every `answer-first` a committed node may name: the built-in now, and the versions before it. */
const ANSWER_FIRST_VERSIONS: readonly LayoutPayload[] = [
  ...BUILT_IN_LAYOUTS.filter((l) => l.name === ANSWER_FIRST.name),
  ...(ANSWER_FIRST.version === ANSWER_FIRST_V1.version ? [] : [ANSWER_FIRST_V1]),
];

const nodeFiles = fs.existsSync(LAYOUTS) ? fs.readdirSync(LAYOUTS).filter((f) => NODE_FILE.test(f)).sort() : [];

test('W4 P2 reading 6: committed-nodes.ts imports exactly the node files on disk, in the form the script writes', () => {
  const source = fs.readFileSync(MODULE, 'utf8');
  const ids = nodeFiles.map((f) => f.slice(0, 64));
  assert.deepEqual(committedModuleNodeIds(source).sort(), ids, 'one import per node file, and none without a file');
  assert.equal(source, committedModuleSource(ids), 'the module is the script’s own output for these files');
  assert.equal(COMMITTED_LAYOUT_DOCUMENTS.length, ids.length, 'every import reaches the list');
  if (fs.existsSync(LAYOUTS)) {
    const others = fs.readdirSync(LAYOUTS).filter((f) => !NODE_FILE.test(f) && !/^[0-9a-f]{64}\.proofs\.json$/.test(f));
    assert.deepEqual(others, [], 'the directory holds node files and their proofs only');
  }
});

test('W4 P2 (2), as UX-2 P2 (5) reads it: every committed node’s seven fields equal the answer-first version it names, read from the file', () => {
  for (const file of nodeFiles) {
    const doc = parseStrictJson(fs.readFileSync(path.join(LAYOUTS, file))) as Record<string, unknown>;
    const pkg = doc.package as Record<string, unknown>;
    const id = file.slice(0, 64);
    assert.equal(doc.packageHash, id, `${file}: named for its node id`);
    assert.equal(computeEnvelopeHash(pkg), id, `${file}: the package recomputes to it`);
    assert.equal(pkg.type, CONTENT_LAYOUT, file);
    const fields = layoutFieldsOf(pkg);
    const named = layoutId(fields as Pick<LayoutPayload, 'name' | 'version'>);
    const own = ANSWER_FIRST_VERSIONS.find((l) => layoutId(l) === named);
    assert.ok(own, `${file}: names ${named}, which is answer-first's built-in or an earlier answer-first (${ANSWER_FIRST_VERSIONS.map(layoutId).join(', ')})`);
    assert.deepEqual(fields, { ...own }, `${file}: the seven fields of ${layoutId(own)}`);
    assert.equal('captureMethod' in (pkg.metadata as object), false, `${file}: no capture method (ruling D5 = A)`);
    const proofs = JSON.parse(fs.readFileSync(path.join(LAYOUTS, `${id}.proofs.json`), 'utf8')) as Record<string, unknown>;
    assert.equal(proofs.packageHash, id, `${file}: its proofs file names it`);
    for (const key of ['rfc3161Timestamp', 'rekorEntryId', 'rekorInclusionProof']) assert.equal(typeof proofs[key], 'string', `${file}: ${key}`);
  }
});

test('W4 P2 (11) no non-test source reads public/.well-known/layouts through the filesystem', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
  // A file the commit is about to add is not tracked yet; the two this phase adds are named here.
  const universe = [...new Set([...tracked, 'src/lib/answer-layout/committed-nodes.ts', 'scripts/publish-layout.ts'])]
    .filter((f) => /\.(c|m)?[jt]sx?$/.test(f) && !/\.test\.(c|m)?[jt]sx?$/.test(f) && fs.existsSync(path.join(REPO, f)));
  const naming = universe.filter((f) => fs.readFileSync(path.join(REPO, f), 'utf8').includes('.well-known/layouts')).sort();
  assert.deepEqual(naming, ['scripts/publish-layout.ts', 'src/lib/answer-layout/committed-nodes.ts']);
  assert.doesNotMatch(fs.readFileSync(MODULE, 'utf8'), /node:fs|from 'fs'|readFile|readdir/, 'the module only imports');
  const script = fs.readFileSync(path.join(REPO, 'scripts', 'publish-layout.ts'), 'utf8');
  assert.deepEqual([...script.matchAll(/fs\.(read\w*|opendir\w*|createReadStream)\(([^)]*)\)/g)].map((m) => `${m[1]}(${m[2]})`), [
    "readFileSync(modulePath, 'utf8')",
  ], 'the script reads the module, never the directory');
});

test('UX-2 P2 (5), after --apply: a committed node names the current built-in, so a publish has a node to name', () => {
  const named = nodeFiles.map((file) => {
    const doc = parseStrictJson(fs.readFileSync(path.join(LAYOUTS, file))) as Record<string, unknown>;
    return layoutId(layoutFieldsOf(doc.package as Record<string, unknown>) as Pick<LayoutPayload, 'name' | 'version'>);
  });
  assert.ok(named.includes(layoutId(ANSWER_FIRST)), `a committed node names ${layoutId(ANSWER_FIRST)}; the committed nodes name ${named.join(', ') || 'nothing'}`);
});
