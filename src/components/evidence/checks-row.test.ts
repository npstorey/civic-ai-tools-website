// UX-2 P5 (X6's "Checks: <result>"; ruled by research check 2, C3): the
// integrity glance reads as the checks row once the verify result arrives.
// `<result>` is the label the glance already computes (`summarizeIntegrity`,
// `trust-signal.ts:770`), its tier unchanged, so no tier word is new. Driven
// on the surface harness: the real `EvidenceActions`, its verify request
// answered by this test.
//
// WHAT MAKES IT ABLE TO FAIL. Two results with different tiers (every check
// passing; a hash mismatch), so a row that printed a fixed word, or dropped the
// glance's own label, reads wrong on one of them. A failed request keeps its
// own sentence and shows no checks row.
//
// BLIND SPOT. The harness has no layout and no browser events.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_SURFACE_STUBS, h, mount, registerSurfaceHooks } from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

const { default: EvidenceActions } = await import('./EvidenceActions.tsx');
const { summarizeIntegrity } = await import('../../lib/evidence/trust-signal.ts');
const { CHECKS, SIGNATURE_MEANING } = await import('../../lib/evidence/trust-words.ts');

const PASSING = {
  hashMatch: true, signatureValid: true, keyTrust: { status: 'active' }, hasTimestamp: true, rekorVerified: true,
  blobRefsVerified: null, contentCanonicalization: null, contentHash: null, typeResolution: null, signerIdentity: null, captureMethodVocab: null,
};
const MISMATCH = { ...PASSING, hashMatch: false };

const props = {
  slug: 'fixture-slug', title: 'Fixture', creatorName: 'Fixture Author', createdAt: '2026-11-01T00:00:00.000Z',
  captureMethod: null, visibility: 'public', commitmentUrl: 'https://records.example.test/api/records/fixture-slug/commitment', brandName: null,
};

function answer(body: unknown, status = 200) {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
}

test('UX-2 P5 (X6, C3 ruled): the glance reads "Checks: <its own label>", for a passing result and a failing one', async () => {
  const labels: string[] = [];
  for (const result of [PASSING, MISMATCH]) {
    answer(result);
    const s = await mount(h(EvidenceActions, { ...props, signed: true }));
    const expected = CHECKS(summarizeIntegrity(result as never).label);
    assert.ok(s.text().includes(expected), `the actions read: ${s.text().slice(0, 300)}`);
    labels.push(expected);
    s.unmount();
  }
  assert.notEqual(labels[0], labels[1], 'premise: the two results read differently');
});

test('UX-2 P5 (X6): a failed check request keeps its own sentence and shows no checks row', async () => {
  answer({ error: 'fixture' }, 500);
  const s = await mount(h(EvidenceActions, { ...props, signed: true }));
  assert.ok(s.text().includes('Integrity check couldn’t be loaded.'));
  assert.ok(!s.text().includes('Checks: '));
  s.unmount();
});

test('UX-2 P5 (G0-5 A): the signature sentence renders only when the record is signed', async () => {
  answer(PASSING);
  const signed = await mount(h(EvidenceActions, { ...props, signed: true }));
  assert.equal(signed.text().split(SIGNATURE_MEANING).length - 1, 1);
  signed.unmount();
  const unsigned = await mount(h(EvidenceActions, { ...props, signed: false }));
  assert.ok(!unsigned.text().includes(SIGNATURE_MEANING));
  unsigned.unmount();
});
