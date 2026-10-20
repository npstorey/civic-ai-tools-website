// LAYOUT-WEB W4 P2 criterion (9): the run's modes of scripts/publish-layout.ts,
// and what the real run writes (criterion (1) and (2) on the script's own file).
//
// The script is spawned as a child process, exactly the command an operator
// runs, under a throwaway Ed25519 key generated here for this run (a fixture;
// no real key is ever read). Its environment is an allowlist: PATH, HOME and
// the fixture variables, nothing of this process's own.
//
// THE DOUBLES are defined in this file and reached on loopback through the
// script's own settings: `TIMESTAMP_AUTHORITY_URL`, `TRANSPARENCY_LOG_URL`
// and `PUBLISHER_TRUST_REGISTRY_CANONICAL_URL`. What each accepts, and why:
//   - the timestamp authority accepts a POST of `application/timestamp-query`
//     whose body is a DER SEQUENCE carrying one 32-byte message imprint, and
//     records that imprint, which the test compares with the node id the run
//     wrote (the request carries only the hash). It answers fixed bytes: the
//     script, like the publish routes, carries the token and never parses it,
//     so no RFC 3161 parser is under test here;
//   - the log accepts a POST of a `hashedrekord` v0.0.1 proposal whose
//     `spec.data.hash` is SHA-512 over the node id's text, the value Rekor
//     stores for an Ed25519ph signature (verify-core's `rekorHashForPackage`),
//     and answers the entry shape produce-core's `parseRekorResponse` reads;
//   - the registry answers a trust registry holding the fixture key, or, for
//     one case, another key under the same kid.
// Each double counts its requests, in order, so the run's order is read at
// the doubles, not from the script's own words.
//
// Run with: npm test (or node --test scripts/publish-layout.test.mjs)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_LAYOUT, verifyRecord, rekorHashForPackage, parseStrictJson } from '@typedstandards/verify-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'publish-layout.ts');
const REPO = path.resolve(HERE, '..');

const KID = 'fixture:w4p2-layout-key';
const SIGNER = { bindingTier: 'platform', identifier: 'platform:w4p2-fixture', displayName: 'W4 P2 Fixture Platform' };

function keypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    priv: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    pub: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

const KEY = keypair();
const OTHER = keypair();

/** The doubles, on one loopback server. `mode` sets each one's answer for a case. */
async function startDoubles(mode) {
  const seen = [];
  const imprints = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (req.url === '/tsr') {
        seen.push('timestamp');
        // A DER SEQUENCE whose message imprint is an OCTET STRING of 32 bytes (0x04 0x20 …).
        const at = body.indexOf(Buffer.from([0x04, 0x20]));
        const ok = req.method === 'POST' && req.headers['content-type'] === 'application/timestamp-query' && body[0] === 0x30 && at > 0 && body.length >= at + 34;
        if (ok) imprints.push(body.subarray(at + 2, at + 34).toString('hex'));
        if (!ok || mode.timestamp === 'fail') { res.writeHead(ok ? 503 : 400); res.end(); return; }
        res.writeHead(200, { 'content-type': 'application/timestamp-reply' });
        res.end(Buffer.from('w4p2-fixture-token'));
        return;
      }
      if (req.url === '/log') {
        seen.push('log');
        let proposal = null;
        try { proposal = JSON.parse(body.toString('utf8')); } catch { /* refused below */ }
        const ok = req.method === 'POST' && proposal?.kind === 'hashedrekord' && proposal?.apiVersion === '0.0.1' &&
          proposal?.spec?.data?.hash?.algorithm === 'sha512' && typeof proposal?.spec?.signature?.content === 'string' &&
          imprints.length > 0 && proposal.spec.data.hash.value === rekorHashForPackage(imprints.at(-1));
        if (!ok || mode.log === 'fail') { res.writeHead(ok ? 503 : 400); res.end(); return; }
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          'w4p2fixtureentry0000000000000000000000000000000000000000000000000000': {
            logIndex: 7,
            body: Buffer.from('w4p2-fixture-entry-body').toString('base64'),
            verification: { inclusionProof: { logIndex: 7, treeSize: 8, rootHash: '00'.repeat(32), hashes: [], checkpoint: 'w4p2-fixture-checkpoint' } },
          },
        }));
        return;
      }
      if (req.url === '/registry.json') {
        seen.push('registry');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          keys: [{
            kid: KID,
            publicKey: mode.registryKey === 'other' ? OTHER.pub : KEY.pub,
            signerIdentity: SIGNER,
            status: 'active',
            activatedAt: '2026-01-01T00:00:00.000Z',
            deprecatedAt: null,
            revokedAt: null,
          }],
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, seen, imprints, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Spawns the script (async: a spawnSync would block the doubles this process serves). */
function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', SCRIPT, ...args], { cwd: REPO, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function envFor(doubles) {
  return {
    PATH: process.env.PATH,
    HOME: os.tmpdir(),
    PUBLISHER_SIGNING_KEY: KEY.priv,
    PUBLISHER_KEY_ID: KID,
    PUBLISHER_SIGNER_BINDING_TIER: SIGNER.bindingTier,
    PUBLISHER_SIGNER_IDENTIFIER: SIGNER.identifier,
    PUBLISHER_SIGNER_DISPLAY_NAME: SIGNER.displayName,
    PUBLISHER_SITE_ORIGIN: 'https://w4p2-fixture.invalid',
    PUBLISHER_TRUST_REGISTRY_CANONICAL_URL: `${doubles.base}/registry.json`,
    TIMESTAMP_AUTHORITY_URL: `${doubles.base}/tsr`,
    TRANSPARENCY_LOG_URL: `${doubles.base}/log`,
  };
}

/** Every file under `dir`, relative to it. */
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map(String).filter((p) => fs.statSync(path.join(dir, p)).isFile()).sort();
}

async function inCase(mode, args, check) {
  const doubles = await startDoubles(mode);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'w4p2-publish-layout-'));
  try {
    const result = await run([...args, '--root', root], envFor(doubles));
    await check({ result, doubles, root, files: filesUnder(root) });
  } finally {
    await doubles.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('W4 P2 (9) DRY, the default: the timestamp and the key check run; no log request, no file; it says the printed id never ships', async () => {
  await inCase({}, [], ({ result, doubles, files }) => {
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(doubles.seen, ['timestamp', 'registry'], 'the doubles were reached in this order, and the log never');
    assert.deepEqual(files, [], 'nothing was written');
    const id = /node from answer-first v1: ([0-9a-f]{64})/.exec(result.stdout)?.[1];
    assert.ok(id, result.stdout);
    assert.deepEqual(doubles.imprints, [id], 'the timestamp request carried the node id and nothing else');
    assert.match(result.stdout, /the signing key matches the key it carries/);
    assert.match(result.stdout, /verifyRecord on the built view: envelope verified, signature true, type ok \(content\/layout\/v1\), key active, signer ok/);
    assert.match(result.stdout, new RegExp(`\\(${id}\\) never ships: the real run builds a new node`));
  });
});

test('W4 P2 (9) the real run: timestamp, checks, log, files, in that order; the view verifies and its fields are answer-first’s', async () => {
  await inCase({}, ['--apply'], ({ result, doubles, root, files }) => {
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(doubles.seen, ['timestamp', 'registry', 'log']);
    assert.equal(files.length, 3, files.join(', '));
    const id = doubles.imprints[0];
    assert.deepEqual(files, [
      path.join('public', '.well-known', 'layouts', `${id}.json`),
      path.join('public', '.well-known', 'layouts', `${id}.proofs.json`),
      path.join('src', 'lib', 'answer-layout', 'committed-nodes.ts'),
    ].sort());
    const doc = parseStrictJson(fs.readFileSync(path.join(root, 'public', '.well-known', 'layouts', `${id}.json`)));
    const proofs = JSON.parse(fs.readFileSync(path.join(root, 'public', '.well-known', 'layouts', `${id}.proofs.json`), 'utf8'));
    const moduleSource = fs.readFileSync(path.join(root, 'src', 'lib', 'answer-layout', 'committed-nodes.ts'), 'utf8');
    return (async () => {
      assert.equal(doc.packageHash, id);
      assert.equal(doc.captureMethod, null, 'ruling D5 = A');
      assert.equal(doc.visibility, 'public');
      assert.equal('packageUrl' in doc, false);
      for (const k of ['rfc3161Timestamp', 'rekorEntryId', 'rekorInclusionProof', 'rekorEntryBody', 'signerIdentity', 'trustRegistryUrlLegacy']) {
        assert.equal(k in doc, false, `${k} is not in the view`);
      }
      assert.equal(doc.trustRegistryUrl, `${doubles.base}/registry.json`, 'the registry the instance publishes');
      assert.deepEqual(Object.keys(doc).sort(), [
        'captureMethod', 'contentCanonicalization', 'contentHash', 'contentProfile', 'package', 'packageHash',
        'protocolVersion', 'signature', 'signer', 'trustRegistryUrl', 'type', 'visibility',
      ], 'every key is one the cli\'s verify reads');
      const result2 = await verifyRecord({ package: doc.package, packageHash: doc.packageHash, signature: doc.signature }, { registry: { keys: [{ kid: KID, publicKey: KEY.pub, signerIdentity: SIGNER, status: 'active', activatedAt: '2026-01-01T00:00:00.000Z', deprecatedAt: null, revokedAt: null }] } });
      assert.equal(result2.envelopeIntegrity.status, 'verified');
      assert.equal(result2.signatureValid, true);
      assert.deepEqual(result2.typeResolution, { status: 'ok', type: CONTENT_LAYOUT });
      assert.equal(result2.nodeId, id);
      const { name, version, appliesTo, order, disclosure, steps, rendererVersion } = doc.package;
      assert.deepEqual({ name, version, appliesTo, order, disclosure, steps, rendererVersion }, {
        name: 'answer-first', version: 1, appliesTo: ['default', 'datHere'],
        order: ['status', 'answer', 'citation', 'steps', 'sources', 'disclosure', 'actions'],
        disclosure: { label: 'Learn more about how this analysis was produced', order: ['A', 'B', 'C', 'D', 'E', 'G', 'signers', 'attestations', 'verification'], openByDefault: false },
        steps: { placement: 'beside', openByDefault: true }, rendererVersion: 'answer-view/1',
      }, 'criterion (2) on the file the script wrote');
      assert.equal('captureMethod' in doc.package.metadata, false, 'the node states no capture method');
      assert.deepEqual(proofs, {
        packageHash: id,
        rfc3161Timestamp: Buffer.from('w4p2-fixture-token').toString('base64'),
        rekorEntryId: 'w4p2fixtureentry0000000000000000000000000000000000000000000000000000',
        rekorInclusionProof: JSON.stringify({ logIndex: 7, treeSize: 8, rootHash: '00'.repeat(32), hashes: [], checkpoint: 'w4p2-fixture-checkpoint' }),
        rekorEntryBody: Buffer.from('w4p2-fixture-entry-body').toString('base64'),
      });
      assert.ok(moduleSource.includes(`import node0 from '../../../public/.well-known/layouts/${id}.json' with { type: 'json' };`), moduleSource);
      assert.ok(moduleSource.includes('export const COMMITTED_LAYOUT_DOCUMENTS: readonly unknown[] = [\n  node0,\n];'), moduleSource);
    })();
  });
});

test('W4 P2 (9) a timestamp failure makes no log request and writes nothing', async () => {
  await inCase({ timestamp: 'fail' }, ['--apply'], ({ result, doubles, files }) => {
    assert.equal(result.code, 1, result.stdout);
    assert.deepEqual(doubles.seen, ['timestamp']);
    assert.deepEqual(files, []);
    assert.match(result.stdout, /returned no token\. No log request was made and nothing was written/);
  });
});

test('W4 P2 (9) a log failure writes nothing', async () => {
  await inCase({ log: 'fail' }, ['--apply'], ({ result, doubles, files }) => {
    assert.equal(result.code, 1, result.stdout);
    assert.deepEqual(doubles.seen, ['timestamp', 'registry', 'log']);
    assert.deepEqual(files, []);
    assert.match(result.stdout, /The transparency log returned no entry\. Nothing was written/);
  });
});

test('W4 P2 (9) a key that does not match the registry stops the run before the log', async () => {
  await inCase({ registryKey: 'other' }, ['--apply'], ({ result, doubles, files }) => {
    assert.equal(result.code, 1, result.stdout);
    assert.deepEqual(doubles.seen, ['timestamp', 'registry'], 'no log request');
    assert.deepEqual(files, []);
    assert.match(result.stdout, /the signing key does NOT match the key it carries/);
    assert.match(result.stdout, /Stopped before the log; nothing was written/);
  });
});

test('W4 P2 (9) an unresolved secret reference in place of the key is refused before anything is requested', async () => {
  const doubles = await startDoubles({});
  try {
    const result = await run(['--apply'], { ...envFor(doubles), PUBLISHER_SIGNING_KEY: 'op://Vault/Item/field' });
    assert.equal(result.code, 1, result.stdout);
    assert.deepEqual(doubles.seen, []);
    assert.match(result.stdout, /unresolved secret reference/);
  } finally {
    await doubles.close();
  }
});
