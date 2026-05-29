// Unit tests for the PR2 canonicalization & hashing core (spec §8.2).
// Exercises the JCS wrapper, the multihash-contentHash detection rule that
// routes packages to the JCS vs legacy chain, the dual-chain envelope hash,
// and the per-rule off-log content hash.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import canonicalize from 'canonicalize';
import {
  jcs,
  isMultihashContentHash,
  computeEnvelopeHash,
  computeContentHashSha256,
  LEGACY_JSON_CANONICALIZATION,
  DATHERE_AG_JUPYTER_CANONICALIZATION,
  KNOWN_CANONICALIZATION_RULES,
} from './canonicalization.ts';

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// --- jcs() RFC 8785 wrapper ---

test('jcs: sorts object keys lexicographically, no whitespace', () => {
  assert.equal(jcs({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('jcs: preserves array order (arrays are order-significant)', () => {
  assert.equal(jcs({ x: [3, 1, 2] }), '{"x":[3,1,2]}');
});

test('jcs: deeply sorts nested objects', () => {
  assert.equal(jcs({ z: { d: 1, c: 2 }, a: 3 }), '{"a":3,"z":{"c":2,"d":1}}');
});

test('jcs: throws on a non-JSON-canonicalizable value (undefined)', () => {
  assert.throws(() => jcs(undefined), /no output/);
});

// --- isMultihashContentHash() detection rule (§8.2) ---

test('isMultihashContentHash: object of string digests → true', () => {
  assert.equal(isMultihashContentHash({ sha256: 'abc' }), true);
  assert.equal(isMultihashContentHash({ sha256: 'a', 'sha3-256': 'b' }), true);
});

test('isMultihashContentHash: external single hex string → false (pre-v0.1)', () => {
  assert.equal(isMultihashContentHash('deadbeef'), false);
});

test('isMultihashContentHash: absent / null / array / empty / non-string values → false', () => {
  assert.equal(isMultihashContentHash(undefined), false);
  assert.equal(isMultihashContentHash(null), false);
  assert.equal(isMultihashContentHash([]), false);
  assert.equal(isMultihashContentHash({}), false);
  assert.equal(isMultihashContentHash({ sha256: 123 }), false);
});

// --- computeEnvelopeHash() dual-chain (§8.2) ---

test('computeEnvelopeHash: multihash contentHash present → JCS chain', () => {
  const pkg = { b: 1, a: 2, contentHash: { sha256: 'x' } };
  assert.equal(computeEnvelopeHash(pkg), sha256Hex(canonicalize(pkg) as string));
});

test('computeEnvelopeHash: no contentHash → legacy JSON.stringify chain', () => {
  const pkg = { b: 1, a: 2 };
  assert.equal(computeEnvelopeHash(pkg), sha256Hex(JSON.stringify(pkg)));
});

test('computeEnvelopeHash: v0.1 chain is key-order-independent (JCS property)', () => {
  const a = { a: 1, b: 2, contentHash: { sha256: 'x' } };
  const b = { contentHash: { sha256: 'x' }, b: 2, a: 1 };
  assert.equal(computeEnvelopeHash(a), computeEnvelopeHash(b));
});

test('computeEnvelopeHash: legacy chain is key-order-DEPENDENT (JSON.stringify property)', () => {
  // This is the property that forces the storage round-trip to preserve
  // insertion order for pre-v0.1 packages — and why the detection rule keeps
  // them on the legacy chain rather than re-canonicalizing.
  const a = { a: 1, b: 2 };
  const b = { b: 2, a: 1 };
  assert.notEqual(computeEnvelopeHash(a), computeEnvelopeHash(b));
});

// --- computeContentHashSha256() per-rule off-log content (§8.2) ---

test('computeContentHashSha256: legacy-json/v1 fingerprints the package minus contentHash', () => {
  const pkg = { a: 1, b: 2, contentHash: { sha256: 'should-be-excluded' } };
  const expected = sha256Hex(canonicalize({ a: 1, b: 2 }) as string);
  assert.equal(computeContentHashSha256(pkg, LEGACY_JSON_CANONICALIZATION), expected);
});

test('computeContentHashSha256: legacy-json/v1 is identical whether contentHash is present or not (produce/verify symmetry)', () => {
  // The packager calls this on the base object (no contentHash yet); verify
  // calls it on the stored object (contentHash present). Both must agree.
  const base = { a: 1, b: 2 };
  const withHash = { a: 1, b: 2, contentHash: { sha256: 'x' } };
  assert.equal(
    computeContentHashSha256(base, LEGACY_JSON_CANONICALIZATION),
    computeContentHashSha256(withHash, LEGACY_JSON_CANONICALIZATION),
  );
});

test('computeContentHashSha256: dathere-ag-jupyter/v1 fingerprints the notebook extension', () => {
  const notebook = { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} };
  const pkg = { extensions: { 'org.civicaitools.notebook': notebook } };
  const expected = sha256Hex(canonicalize(notebook) as string);
  assert.equal(
    computeContentHashSha256(pkg, DATHERE_AG_JUPYTER_CANONICALIZATION),
    expected,
  );
});

test('computeContentHashSha256: dathere-ag-jupyter/v1 throws when the notebook extension is missing', () => {
  assert.throws(
    () => computeContentHashSha256({ extensions: {} }, DATHERE_AG_JUPYTER_CANONICALIZATION),
    /notebook/,
  );
});

// --- Rule registry ---

test('KNOWN_CANONICALIZATION_RULES contains both v0.1 reserved URIs', () => {
  assert.ok(KNOWN_CANONICALIZATION_RULES.includes(LEGACY_JSON_CANONICALIZATION));
  assert.ok(KNOWN_CANONICALIZATION_RULES.includes(DATHERE_AG_JUPYTER_CANONICALIZATION));
});
