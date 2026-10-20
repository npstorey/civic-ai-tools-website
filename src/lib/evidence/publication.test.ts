// LAYOUT-WEB W4 P2 criteria (3) and (12): `emitPublicationPair`'s publishes
// attestation names the instance's default layout node, and its row's payload
// carries it; with no node, the attestation's bytes equal the base's.
//
// WHAT IS DRIVEN. The real `emitPublicationPair` (`publication.ts`), with the
// real attestation builder, signing module, site configuration and
// answer-layout modules. Three modules are replaced, here, by module hooks:
//   - `@/lib/db`: records the rows `insert().values()` is handed;
//   - `@/lib/storage`: records the node `putPackage` stores;
//   - `src/lib/answer-layout/committed-nodes.ts`: the committed nodes, read
//     from `globalThis.__w4p2Committed`, so a case can hold a node signed by
//     the fixture key (the repository commits none at this head).
// The signing key is a throwaway Ed25519 key generated for this run (a
// fixture). `fetch` answers nothing, so the timestamp and the log are null, as
// the routes' best-effort posture makes them.
//
// THE BYTES ARE THE BASE'S. With the envelope's two inputs from the clock and
// the RNG fixed (`crypto.randomUUID`, and `Date` under node:test's mock
// timers), the publishes node is deterministic. `publication-pair.base.golden.json`
// was captured by this driver on the base of W4 P2 (website main 9aa52eb),
// before any change to `publication.ts`: the no-node case must reproduce it
// byte for byte.
//
// Run with: npm test (or node --test --experimental-strip-types src/lib/evidence/publication.test.ts)

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLayoutNode, signEnvelopeHash } from '@typedstandards/produce-core';

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');
const GOLDEN = path.join(HERE, 'publication-pair.base.golden.json');

const STUB_PREFIX = 'file:///w4p2-publication-stub/';
const STUB_SOURCE: Record<string, string> = {
  '@/lib/db': `export const db = { insert() { return { values: async (rows) => { globalThis.__w4p2Rows.push(rows); } }; } };`,
  '@/lib/storage': `export async function putPackage(nodeId, node) { globalThis.__w4p2Stored.push(JSON.stringify(node)); return 'stored/' + nodeId; }`,
  committed: `export const COMMITTED_LAYOUT_DOCUMENTS = globalThis.__w4p2Committed;`,
};
const COMMITTED_FILE = path.join(SRC, 'lib', 'answer-layout', 'committed-nodes.ts');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && parent?.startsWith('file:') && path.resolve(path.dirname(fileURLToPath(parent)), specifier) === COMMITTED_FILE) {
      return { url: `${STUB_PREFIX}committed.mjs`, format: 'module', shortCircuit: true };
    }
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(url.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const g = globalThis as unknown as { __w4p2Rows: unknown[][]; __w4p2Stored: string[]; __w4p2Committed: unknown[] };
g.__w4p2Rows = [];
g.__w4p2Stored = [];
g.__w4p2Committed = [];

// The fixture instance: a throwaway key, its kid, its identity.
const { privateKey } = crypto.generateKeyPairSync('ed25519');
const KEY = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const KID = 'fixture:w4p2-publication';
const SIGNER = { bindingTier: 'platform', identifier: 'platform:w4p2-fixture', displayName: 'W4 P2 Fixture Platform' };
const ENV: Record<string, string> = {
  PUBLISHER_SIGNING_KEY: KEY,
  PUBLISHER_KEY_ID: KID,
  PUBLISHER_SIGNER_BINDING_TIER: SIGNER.bindingTier,
  PUBLISHER_SIGNER_IDENTIFIER: SIGNER.identifier,
  PUBLISHER_SIGNER_DISPLAY_NAME: SIGNER.displayName,
  PUBLISHER_SITE_ORIGIN: 'https://w4p2-fixture.invalid',
};
for (const name of ['ANSWER_LAYOUT', 'ANSWER_LAYOUT_PATH', 'ANSWER_LAYOUT_URL', 'PUBLISHER_PUBLICATION_HOST', 'EVIDENCE_SIGNING_KEY', 'EVIDENCE_KEY_ID']) delete process.env[name];
Object.assign(process.env, ENV);

const { emitPublicationPair } = await import('@/lib/evidence/publication');
const { ANSWER_FIRST } = await import('@/lib/answer-layout');
const { buildLayoutNodeDocument } = await import('@/lib/answer-layout/node-document');

/** A committed node document of answer-first, signed by the fixture key under `kid`. */
function committedDocument(kid = KID, key = KEY) {
  const { node, nodeId } = buildLayoutNode({ ...ANSWER_FIRST, packageId: 'w4p2-committed-node', createdAt: '2026-10-20T00:00:00.000Z', signingKeyId: kid, signer: SIGNER });
  return { doc: buildLayoutNodeDocument(node, nodeId, signEnvelopeHash(nodeId, key, kid), 'https://w4p2-fixture.invalid/.well-known/typed-publisher.json'), nodeId };
}

const INPUT = { targetNodeId: 'f'.repeat(64), uri: 'https://w4p2-fixture.invalid/records/x/package', creatorId: 'w4p2-creator' };

/** One publication under fixed clock and RNG: the publishes node's bytes, and the publishes row. */
async function publishOnce(): Promise<{ publishesNode: string; publishesRow: Record<string, unknown> }> {
  g.__w4p2Rows = [];
  g.__w4p2Stored = [];
  const realUuid = crypto.randomUUID;
  const realFetch = globalThis.fetch;
  let n = 0;
  (crypto as { randomUUID: () => string }).randomUUID = () => `00000000-0000-4000-8000-00000000000${n++}`;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as typeof fetch;
  const warn = console.warn;
  console.warn = () => {};
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-20T12:00:00.000Z') });
  try {
    await emitPublicationPair(INPUT);
  } finally {
    mock.timers.reset();
    console.warn = warn;
    globalThis.fetch = realFetch;
    (crypto as { randomUUID: () => string }).randomUUID = realUuid;
  }
  const rows = g.__w4p2Rows[0] as Array<Record<string, unknown>>;
  const publishesRow = rows.find((r) => r.type === 'attestation/publishes/v1')!;
  const publishesNode = g.__w4p2Stored.find((s) => JSON.parse(s).type === 'attestation/publishes/v1')!;
  return { publishesNode, publishesRow };
}

test('W4 P2 (3) a configured default node: the publishes attestation names its id, and the row’s payload carries it', async () => {
  const { doc, nodeId } = committedDocument();
  g.__w4p2Committed.splice(0, g.__w4p2Committed.length, doc);
  try {
    const { publishesNode, publishesRow } = await publishOnce();
    assert.equal(JSON.parse(publishesNode).layoutNodeId, nodeId, 'the signed node names the default node');
    assert.equal((publishesRow.payload as Record<string, unknown>).layoutNodeId, nodeId, 'the row’s payload carries it');
    assert.deepEqual(Object.keys(publishesRow.payload as object), ['publicationHost', 'releasedAt', 'layoutNodeId']);
  } finally {
    g.__w4p2Committed.splice(0);
  }
});

test('W4 P2 (3)(12) no default node: no layoutNodeId anywhere, and the publishes node’s bytes equal the base’s', async () => {
  const { publishesNode, publishesRow } = await publishOnce();
  assert.equal('layoutNodeId' in JSON.parse(publishesNode), false);
  assert.deepEqual(Object.keys(publishesRow.payload as object), ['publicationHost', 'releasedAt']);
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as { publishesNode: string; publishesPayload: unknown };
  assert.equal(publishesNode, golden.publishesNode, 'byte for byte, the node the base built');
  assert.deepEqual(publishesRow.payload, golden.publishesPayload);
});

test('W4 P2 (3) a committed node under another key id names nothing, and the bytes stay the base’s', async () => {
  // One property from the passing case: the key id the node was signed under.
  const { doc } = committedDocument('fixture:another-kid');
  g.__w4p2Committed.splice(0, g.__w4p2Committed.length, doc);
  try {
    const { publishesNode } = await publishOnce();
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as { publishesNode: string };
    assert.equal(publishesNode, golden.publishesNode);
  } finally {
    g.__w4p2Committed.splice(0);
  }
});
