// LAYOUT-WEB W4 P2 criterion (10) and reading 11: which node the instance
// names as `layoutNodeId`, and how "signed by this instance" is proved (by
// key). `default-node.ts`.
//
// Every "names none" shape below differs from a passing one in one property,
// and each test asserts the passing one first, so a function that names
// nothing at all fails here rather than passing every "none".
//
// Keys are throwaway Ed25519 keys generated for this run (fixtures). The
// committed nodes are handed in as data (the repository commits none at this
// head); the URL node is served by an injected fetcher, with the fixture
// registry handed in as the instance's.
//
// Run with: npm test (or node --test --experimental-strip-types src/lib/answer-layout/default-node.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildLayoutNode, signEnvelopeHash } from '@typedstandards/produce-core';
import { ANSWER_FIRST, ENVELOPE_ORDER, type LayoutPayload } from './index.ts';
import { buildLayoutNodeDocument } from './node-document.ts';
import { committedLayoutNodes } from './held.ts';
import { defaultLayoutNodeId, instanceSigningPublicKey } from './default-node.ts';
import { resolveAnswerLayouts } from './reading.ts';
import { readLayoutUrlOnce } from './node-reading.ts';

function keypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { priv: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), pub: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
}

const INSTANCE = keypair();
const OTHER = keypair();
const KID = 'fixture:w4p2-instance';
const SIGNER = { bindingTier: 'platform', identifier: 'platform:w4p2-fixture', displayName: 'W4 P2 Fixture Platform' };
const ENV = {
  PUBLISHER_SIGNING_KEY: INSTANCE.priv,
  PUBLISHER_KEY_ID: KID,
  PUBLISHER_SIGNER_BINDING_TIER: SIGNER.bindingTier,
  PUBLISHER_SIGNER_IDENTIFIER: SIGNER.identifier,
  PUBLISHER_SIGNER_DISPLAY_NAME: SIGNER.displayName,
};

/** A committed node: `layout`, signed by `key` under `kid`, with the instance's identity configuration. */
function committed(layout: LayoutPayload = ANSWER_FIRST, key = INSTANCE.priv, kid = KID, packageId = 'w4p2-default') {
  const { node, nodeId } = buildLayoutNode({ ...layout, packageId, createdAt: '2026-10-20T00:00:00.000Z', signingKeyId: kid, signer: SIGNER });
  const doc = buildLayoutNodeDocument(node, nodeId, signEnvelopeHash(nodeId, key, kid), 'https://w4p2-fixture.invalid/.well-known/typed-publisher.json');
  return { doc, nodeId, node: committedLayoutNodes([doc])[0] };
}

test('W4 P2 reading 11: the instance’s public key is derived without signing, and equals the one signPackage’s result carries', () => {
  assert.equal(instanceSigningPublicKey(ENV), INSTANCE.pub);
  assert.equal(signEnvelopeHash('a'.repeat(64), INSTANCE.priv, KID).publicKey, INSTANCE.pub);
  assert.equal(instanceSigningPublicKey({}), null, 'no key, no public key');
  assert.equal(instanceSigningPublicKey({ PUBLISHER_SIGNING_KEY: 'op://Vault/Item/field' }), null, 'a value that is not a key');
});

test('W4 P2 (10) a committed answer-first node signed by the instance’s key under its kid is named', async () => {
  const good = committed();
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [good.node] }), good.nodeId);
});

test('W4 P2 (10) the instance’s identity configuration but another key: names none', async () => {
  const good = committed();
  const otherKey = committed(ANSWER_FIRST, OTHER.priv);
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [good.node] }), good.nodeId);
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [otherKey.node] }), undefined);
});

test('W4 P2 (10) the instance’s key under another key id: names none', async () => {
  const good = committed();
  const otherKid = committed(ANSWER_FIRST, INSTANCE.priv, 'fixture:another-kid');
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [good.node] }), good.nodeId);
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [otherKid.node] }), undefined);
});

test('W4 P2 (10) seven fields other than answer-first’s: names none', async () => {
  const good = committed();
  const other = committed(ENVELOPE_ORDER);
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [good.node] }), good.nodeId);
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [other.node] }), undefined);
});

test('W4 P2 (10) ANSWER_LAYOUT (or ANSWER_LAYOUT_PATH) set: names none', async () => {
  const good = committed();
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [good.node] }), good.nodeId);
  assert.equal(await defaultLayoutNodeId({ ...ENV, ANSWER_LAYOUT: JSON.stringify(ANSWER_FIRST) }, { committed: [good.node] }), undefined);
  assert.equal(await defaultLayoutNodeId({ ...ENV, ANSWER_LAYOUT_PATH: '/w4p2/layout.json' }, { committed: [good.node] }), undefined);
});

test('W4 P2 (10) no signing key: names none (and the instance builds no publication attestation)', async () => {
  const good = committed();
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [good.node] }), good.nodeId);
  const keyless: Record<string, string> = Object.fromEntries(Object.entries(ENV).filter(([name]) => name !== 'PUBLISHER_SIGNING_KEY'));
  assert.equal(await defaultLayoutNodeId(keyless, { committed: [good.node] }), undefined);
});

test('W4 P2 (10) a signature that does not verify under the instance’s key: names none', async () => {
  const good = committed();
  const sig = good.doc.signature as Record<string, string>;
  const bytes = Buffer.from(sig.signature, 'base64');
  bytes[3] ^= 0x01;
  const broken = committedLayoutNodes([{ ...good.doc, signature: { ...sig, signature: bytes.toString('base64') } }])[0];
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [good.node] }), good.nodeId);
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [broken] }), undefined);
});

test('W4 P2 (10) several committed default nodes: the latest is named, and the id is computed from its bytes', async () => {
  const first = committed(ANSWER_FIRST, INSTANCE.priv, KID, 'w4p2-first');
  const { node, nodeId } = buildLayoutNode({ ...ANSWER_FIRST, packageId: 'w4p2-second', createdAt: '2026-10-21T00:00:00.000Z', signingKeyId: KID, signer: SIGNER });
  const second = committedLayoutNodes([buildLayoutNodeDocument(node, nodeId, signEnvelopeHash(nodeId, INSTANCE.priv, KID), 'https://w4p2-fixture.invalid/r.json')])[0];
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [second, first.node] }), nodeId);
  assert.equal(await defaultLayoutNodeId(ENV, { committed: [first.node, second] }), nodeId);
});

test('W4 P2 (10) with the URL set, the URL node’s id is named; with its fetch failing, the publish route names none and the pages refuse', async () => {
  const registry = { keys: [{ kid: 'fixture:w4p2-url', publicKey: OTHER.pub, signerIdentity: SIGNER, status: 'active' as const, activatedAt: '2026-01-01T00:00:00.000Z', deprecatedAt: null, revokedAt: null }] };
  const custom = { ...structuredClone(ENVELOPE_ORDER), name: 'w4p2-url-layout' };
  const { node, nodeId } = buildLayoutNode({ ...custom, packageId: 'w4p2-url', createdAt: '2026-10-20T00:00:00.000Z', signingKeyId: 'fixture:w4p2-url', signer: SIGNER });
  const doc = buildLayoutNodeDocument(node, nodeId, signEnvelopeHash(nodeId, OTHER.priv, 'fixture:w4p2-url'), 'https://w4p2-fixture.invalid/r.json');
  const good = committed();

  const url = 'https://layouts.w4p2-fixture.invalid/served.json';
  const served = (async () => new Response(JSON.stringify(doc))) as never;
  assert.equal(await defaultLayoutNodeId({ ...ENV, ANSWER_LAYOUT_URL: url }, { committed: [good.node], urlDeps: { fetch: served, registry } }), nodeId, 'the URL node, not the committed one');

  const down = 'https://layouts.w4p2-fixture.invalid/down.json';
  const failing = (async () => { throw new Error('connection refused'); }) as never;
  assert.equal(await defaultLayoutNodeId({ ...ENV, ANSWER_LAYOUT_URL: down }, { committed: [good.node], urlDeps: { fetch: failing, registry } }), undefined, 'the publish route names none');
  const reading = await readLayoutUrlOnce(down);
  assert.equal(reading.ok, false);
  assert.throws(() => resolveAnswerLayouts({ url: down }, { committed: [] }), /ANSWER_LAYOUT_URL: the layout node was refused \(fetch_failed\)/, 'the pages refuse, from the same kept reading');
});
