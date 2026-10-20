// LAYOUT-WEB W4 P2 criterion (6), item 3 and readings 4-5: reading a layout
// node by URL (`node-reading.ts`), and the URL form of the instance's setting
// (`reading.ts`).
//
// The node documents are built here, in the shape `scripts/publish-layout.ts`
// writes (`node-document.ts`), and signed by a throwaway Ed25519 key generated
// for this run (a fixture). The URL is served from a loopback HTTP server in
// this file, and read with the real `fetch`. The instance's trust registry is
// handed in as data (the build-time import holds the reference deployment's
// key, which signs no fixture); a declared registry over `https:` is reached
// through an injected fetcher, since no TLS server runs here.
//
// Each refused shape differs from the accepted one in one property: one byte
// of the signature; the type, with the node otherwise re-hashed and re-signed
// so it is valid; the key's place in a registry.
//
// Run with: npm test (or node --test --experimental-strip-types src/lib/answer-layout/node-reading.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { buildLayoutNode, signEnvelopeHash, type LayoutNode } from '@typedstandards/produce-core';
import { computeContentHashSha256, computeEnvelopeHash, LEGACY_JSON_CANONICALIZATION } from '@typedstandards/verify-core';
import { ANSWER_FIRST, ENVELOPE_ORDER, layoutId, type LayoutPayload } from './index.ts';
import { buildLayoutNodeDocument } from './node-document.ts';
import { readLayoutNodeFromUrl, readLayoutUrlOnce, verifyLayoutDocument, type LayoutNodeReading } from './node-reading.ts';
import { AnswerLayoutConfigurationError, resolveAnswerLayouts } from './reading.ts';
import { committedLayoutNodes } from './held.ts';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const KEY = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const PUB = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const KID = 'fixture:w4p2-node-reading';
const SIGNER = { bindingTier: 'platform', identifier: 'platform:w4p2-fixture', displayName: 'W4 P2 Fixture Platform' };
const REGISTRY = {
  keys: [{ kid: KID, publicKey: PUB, signerIdentity: SIGNER, status: 'active' as const, activatedAt: '2026-01-01T00:00:00.000Z', deprecatedAt: null, revokedAt: null }],
};
const DECLARED = 'https://registry.w4p2-fixture.invalid/.well-known/typed-publisher.json';

const CUSTOM: LayoutPayload = { ...structuredClone(ENVELOPE_ORDER), name: 'w4p2-custom', version: 2 };

function signedDocument(layout: LayoutPayload, edit?: (node: LayoutNode) => Record<string, unknown>): { doc: Record<string, unknown>; nodeId: string } {
  const built = buildLayoutNode({ ...layout, packageId: 'w4p2-node', createdAt: '2026-10-20T00:00:00.000Z', signingKeyId: KID, signer: SIGNER });
  let node = built.node as unknown as Record<string, unknown>;
  let nodeId = built.nodeId;
  if (edit) {
    const base = Object.fromEntries(Object.entries(edit(built.node)).filter(([k]) => k !== 'contentHash'));
    node = { ...base, contentHash: { sha256: computeContentHashSha256(base, LEGACY_JSON_CANONICALIZATION) } };
    nodeId = computeEnvelopeHash(node);
  }
  return { doc: buildLayoutNodeDocument(node as unknown as LayoutNode, nodeId, signEnvelopeHash(nodeId, KEY, KID), DECLARED), nodeId };
}

/** Serves `body` at /node.json on loopback for the duration of `fn`. */
async function served<T>(body: string | Buffer, fn: (url: string) => Promise<T>, status = 200): Promise<T> {
  const server = http.createServer((req, res) => {
    if (req.url !== '/node.json') { res.writeHead(404); res.end(); return; }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}/node.json`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const refused = (r: LayoutNodeReading) => (r.ok ? 'accepted' : r.status);

test('W4 P2 (6) a verified node, read by URL, is accepted: its id recomputed from the bytes, its seven fields taken', async () => {
  const { doc, nodeId } = signedDocument(CUSTOM);
  const reading = await served(JSON.stringify(doc), (url) => readLayoutNodeFromUrl(url, { registry: REGISTRY }));
  assert.equal(refused(reading), 'accepted');
  assert.ok(reading.ok);
  assert.equal(reading.nodeId, nodeId);
  assert.deepEqual(reading.layout, CUSTOM);
});

test('W4 P2 (6) one byte of the signature altered: refused with the verifier’s status', async () => {
  const { doc } = signedDocument(CUSTOM);
  const sig = doc.signature as { signature: string };
  const bytes = Buffer.from(sig.signature, 'base64');
  bytes[10] ^= 0x01;
  const altered = { ...doc, signature: { ...sig, signature: bytes.toString('base64') } };
  const reading = await served(JSON.stringify(altered), (url) => readLayoutNodeFromUrl(url, { registry: REGISTRY }));
  assert.equal(refused(reading), 'signature_invalid');
});

test('W4 P2 (6) a type other than content/layout/v1, otherwise valid: refused at check #12', async () => {
  for (const type of ['content/analysis/v1', 'content/layout/v2']) {
    const { doc } = signedDocument(CUSTOM, (node) => ({ ...node, type }));
    // Otherwise valid: the same document under the layout type is accepted.
    const control = await verifyLayoutDocument(signedDocument(CUSTOM, (node) => ({ ...node })).doc, { registry: REGISTRY });
    assert.equal(refused(control), 'accepted');
    const reading = await served(JSON.stringify(doc), (url) => readLayoutNodeFromUrl(url, { registry: REGISTRY }));
    assert.match(refused(reading), /^type_/, type);
    assert.ok(!reading.ok && /check #12/.test(reading.message), type);
  }
});

test('W4 P2 item 3: a repeated member name, not JSON, and an HTTP error are refused before anything is verified', async () => {
  const { doc } = signedDocument(CUSTOM);
  const text = JSON.stringify(doc);
  const repeated = text.replace('"visibility":"public"', '"visibility":"public","visibility":"public"');
  assert.notEqual(repeated, text);
  assert.equal(refused(await served(repeated, (url) => readLayoutNodeFromUrl(url, { registry: REGISTRY }))), 'repeated_member_name');
  assert.equal(refused(await served('{"name": ', (url) => readLayoutNodeFromUrl(url, { registry: REGISTRY }))), 'not_json');
  assert.equal(refused(await served(text, (url) => readLayoutNodeFromUrl(url, { registry: REGISTRY }), 404)), 'fetch_failed');
});

test('W4 P2 reading 5: the instance’s registry first; else the registry the document declares, over https only', async () => {
  const { doc } = signedDocument(CUSTOM);
  const empty = { keys: [] };
  const declaredFetch = async (url: string) => {
    assert.equal(url, DECLARED, 'only the declared registry is fetched');
    return { ok: true, status: 200, json: async () => REGISTRY } as unknown as Response;
  };
  assert.equal(refused(await verifyLayoutDocument(doc, { registry: REGISTRY, fetch: async () => { throw new Error('not fetched'); } })), 'accepted', 'the instance’s registry holds the key');
  assert.equal(refused(await verifyLayoutDocument(doc, { registry: empty, fetch: declaredFetch as never })), 'accepted', 'the declared registry holds it');
  const overHttp = { ...doc, trustRegistryUrl: DECLARED.replace('https:', 'http:') };
  assert.equal(refused(await verifyLayoutDocument(overHttp, { registry: empty, fetch: declaredFetch as never })), 'unknown_key', 'a declared registry over http is not read');
  const elsewhere = { ...doc, trustRegistryUrl: 'https://another.w4p2-fixture.invalid/keys.json' };
  assert.equal(refused(await verifyLayoutDocument(elsewhere, { registry: empty, fetch: (async () => ({ ok: true, status: 200, json: async () => empty })) as never })), 'unknown_key', 'neither holds the key');
});

test('W4 P2 item 3: the URL form names the instance’s layout: the node is the default and is offered first', async () => {
  const { doc, nodeId } = signedDocument(CUSTOM);
  const reading = await verifyLayoutDocument(doc, { registry: REGISTRY });
  assert.ok(reading.ok && reading.nodeId === nodeId);
  const layouts = resolveAnswerLayouts({ url: 'https://layouts.w4p2-fixture.invalid/node.json' }, { urlReading: reading, committed: [] });
  assert.deepEqual(layouts.default, CUSTOM);
  assert.deepEqual(layouts.offered.map(layoutId), ['w4p2-custom@2', 'answer-first@1', 'envelope-order@1']);
});

test('W4 P2 item 3: a URL node that was refused refuses every page with the verifier’s status, never the built-ins', () => {
  const failed: LayoutNodeReading = { ok: false, status: 'signature_invalid', message: 'the signature does not verify under the key the document carries' };
  assert.throws(
    () => resolveAnswerLayouts({ url: 'https://layouts.w4p2-fixture.invalid/node.json' }, { urlReading: failed, committed: [] }),
    (err: Error) => err instanceof AnswerLayoutConfigurationError && /^ANSWER_LAYOUT_URL: the layout node was refused \(signature_invalid\)/.test(err.message),
  );
  assert.throws(
    () => resolveAnswerLayouts({ url: 'https://layouts.w4p2-fixture.invalid/never-read.json' }, { committed: [] }),
    /ANSWER_LAYOUT_URL is set to a URL this server has not read/,
  );
  assert.throws(
    () => resolveAnswerLayouts({ url: 'https://layouts.w4p2-fixture.invalid/node.json', inline: JSON.stringify(CUSTOM) }, { committed: [] }),
    /ANSWER_LAYOUT_URL is set beside ANSWER_LAYOUT, and they are two ways to name the instance's layout/,
  );
});

test('W4 P2 the amendment’s (b): a held name and version with other fields is refused, for the URL node and every committed node', async () => {
  const twinOfBuiltIn = { ...structuredClone(ANSWER_FIRST), order: [...ANSWER_FIRST.order].reverse() };
  const urlTwin = await verifyLayoutDocument(signedDocument(twinOfBuiltIn).doc, { registry: REGISTRY });
  assert.throws(() => resolveAnswerLayouts({ url: 'https://x.w4p2-fixture.invalid/n.json' }, { urlReading: urlTwin, committed: [] }), /named answer-first v1, a built-in's name and version, with different fields/);

  const committedTwin = committedLayoutNodes([signedDocument(twinOfBuiltIn).doc]);
  assert.throws(() => resolveAnswerLayouts({}, { committed: committedTwin }), /the committed layout node [0-9a-f]{64}: the layout is named answer-first v1, a built-in's name and version, with different fields/);

  // A committed node and the URL node under one name and version, with different fields.
  const committedCustom = committedLayoutNodes([signedDocument(CUSTOM).doc]);
  const otherCustom = { ...structuredClone(CUSTOM), order: [...CUSTOM.order].reverse() };
  const urlOther = await verifyLayoutDocument(signedDocument(otherCustom).doc, { registry: REGISTRY });
  assert.throws(() => resolveAnswerLayouts({ url: 'https://x.w4p2-fixture.invalid/n.json' }, { urlReading: urlOther, committed: committedCustom }), /the name and version of the committed layout node/);
  // The same fields under the same name are one layout, and accepted.
  const urlSame = await verifyLayoutDocument(signedDocument(CUSTOM).doc, { registry: REGISTRY });
  assert.deepEqual(resolveAnswerLayouts({ url: 'https://x.w4p2-fixture.invalid/n.json' }, { urlReading: urlSame, committed: committedCustom }).default, CUSTOM);
});

test('W4 P2 item 3: the pages and the publish route share one reading of a URL; it is fetched once', async () => {
  const { doc } = signedDocument(CUSTOM);
  let fetches = 0;
  const fetcher = (async () => { fetches += 1; return new Response(JSON.stringify(doc)); }) as never;
  const url = 'https://once.w4p2-fixture.invalid/node.json';
  const [a, b] = await Promise.all([readLayoutUrlOnce(url, { fetch: fetcher, registry: REGISTRY }), readLayoutUrlOnce(url, { fetch: fetcher, registry: REGISTRY })]);
  const c = await readLayoutUrlOnce(url);
  assert.equal(fetches, 1);
  assert.equal(a, b);
  assert.equal(a, c);
});
