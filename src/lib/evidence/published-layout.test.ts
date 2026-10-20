// LAYOUT-WEB W4 P2, the amendment's (b) and reading 7: the record page reads
// `layoutNodeId` from the record's publication attestation, only from one
// whose signature verified and whose signer matches the target's, preferring
// the signed node's value over the row's payload.
//
// WHAT IS DRIVEN. The real `resolveRecordAttestations` (`lifecycle.ts`), which
// builds a view of every attestation row and verifies each signed node, and
// the selection beside it (`published-layout.ts`). Two modules are replaced by
// module hooks: `@/lib/db` answers the rows a case sets, and `@/lib/storage`
// answers the signed node stored under a row's key. The publication
// attestation is built by produce-core and signed by a throwaway Ed25519 key
// generated for this run (a fixture).
//
// Each refused shape differs from the passing one in one property: one byte
// of the signature, or the target's signer.
//
// Run with: npm test (or node --test --experimental-strip-types src/lib/evidence/published-layout.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAttestationNode, signEnvelopeHash } from '@typedstandards/produce-core';

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
const STUB_PREFIX = 'file:///w4p2-published-layout-stub/';
const STUB_SOURCE: Record<string, string> = {
  '@/lib/db': `
    const chain = { from() { return chain; }, where() { return Promise.resolve(globalThis.__w4p2Rows); } };
    export const db = { select() { return chain; } };`,
  '@/lib/storage': `export async function getPackage(key) { return globalThis.__w4p2Blobs[key] ?? null; }`,
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
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

const g = globalThis as unknown as { __w4p2Rows: unknown[]; __w4p2Blobs: Record<string, unknown> };
g.__w4p2Rows = [];
g.__w4p2Blobs = {};

const { resolveRecordAttestations } = await import('./lifecycle.ts');

const { privateKey } = crypto.generateKeyPairSync('ed25519');
const KEY = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const KID = 'fixture:w4p2-attestations';
const SIGNER = { bindingTier: 'platform', identifier: 'platform:w4p2-fixture', displayName: 'W4 P2 Fixture Platform' };
const TARGET = 'e'.repeat(64);
const SIGNED_ID = '1'.repeat(64);
const PAYLOAD_ID = '2'.repeat(64);
const RECORD = { basePackageHash: TARGET, withdrawnAt: null, withdrawnReason: null, reinstatedAt: null, reinstatedReason: null };

/** One publishes row and its stored signed node; `layoutNodeId` on the node when given, `payloadId` on the row. */
function publishesRow(opts: { layoutNodeId?: string; payloadId?: string; alterSignature?: boolean } = {}) {
  const { node, nodeId } = buildAttestationNode({
    type: 'attestation/publishes/v1', targetNodeId: TARGET, signer: SIGNER, publicationHost: 'w4p2-fixture.invalid',
    packageId: 'w4p2-publishes', createdAt: '2026-10-20T00:00:00.000Z', signingKeyId: KID,
    ...(opts.layoutNodeId !== undefined ? { layoutNodeId: opts.layoutNodeId } : {}),
  });
  const signed = signEnvelopeHash(nodeId, KEY, KID);
  const sig = Buffer.from(signed.signature, 'base64');
  if (opts.alterSignature) sig[5] ^= 0x01;
  g.__w4p2Blobs[`blob/${nodeId}`] = JSON.parse(JSON.stringify(node));
  return {
    nodeId, targetNodeId: TARGET, type: 'attestation/publishes/v1', storageKey: `blob/${nodeId}`,
    signature: JSON.stringify({ nodeId, signature: sig.toString('base64'), publicKey: signed.publicKey, algorithm: signed.algorithm, kid: KID }),
    rfc3161Timestamp: null, rekorEntryId: null, rekorInclusionProof: null, signer: SIGNER,
    payload: { publicationHost: 'w4p2-fixture.invalid', releasedAt: '2026-10-20T00:00:00.000Z', ...(opts.payloadId !== undefined ? { layoutNodeId: opts.payloadId } : {}) },
    createdAt: new Date('2026-10-20T00:00:00.000Z'), creatorId: 'w4p2-creator',
  };
}

async function read(rows: unknown[], signer = SIGNER.identifier) {
  g.__w4p2Rows = rows;
  return resolveRecordAttestations(RECORD, signer);
}

test('W4 P2 (b) a verified, signer-matched publishes attestation: the signed node’s layoutNodeId, over the row’s payload', async () => {
  const r = await read([publishesRow({ layoutNodeId: SIGNED_ID, payloadId: PAYLOAD_ID })]);
  assert.equal(r.publishedLayoutNodeId, SIGNED_ID);
  assert.equal(r.lifecycle.status, 'active', 'the lifecycle reading is unchanged');
});

test('W4 P2 (b) one byte of the signature altered: no layoutNodeId is read', async () => {
  assert.equal((await read([publishesRow({ layoutNodeId: SIGNED_ID })])).publishedLayoutNodeId, SIGNED_ID);
  assert.equal((await read([publishesRow({ layoutNodeId: SIGNED_ID, alterSignature: true })])).publishedLayoutNodeId, null);
});

test('W4 P2 (b) a signer that does not match the target’s: no layoutNodeId is read', async () => {
  assert.equal((await read([publishesRow({ layoutNodeId: SIGNED_ID })])).publishedLayoutNodeId, SIGNED_ID);
  assert.equal((await read([publishesRow({ layoutNodeId: SIGNED_ID })], 'platform:another-publisher')).publishedLayoutNodeId, null);
});

test('W4 P2 (b) an attestation naming none, and a record with no attestation rows: null', async () => {
  assert.equal((await read([publishesRow()])).publishedLayoutNodeId, null);
  const legacy = await read([]);
  assert.equal(legacy.publishedLayoutNodeId, null);
  assert.equal(legacy.lifecycle.source, 'none');
});
