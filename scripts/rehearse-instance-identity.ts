#!/usr/bin/env node
/**
 * ADR-0020 config rehearsal — the "instance identity is config, not code"
 * built bar (S3a P3, #166; S3a acceptance §3).
 *
 * With ZERO code edits, configuration only, this script:
 *
 *   1. generates an EPHEMERAL Ed25519 keypair in-process (never the real
 *      `EVIDENCE_SIGNING_KEY`; nothing is read from or written to any
 *      secret store — the keypair lives and dies with this run);
 *   2. builds a local trust-registry JSON from the docs/instance-setup.md §3
 *      template, carrying the ephemeral PUBLIC key under a rehearsal kid;
 *   3. runs the app's produce path under a fully alternate identity
 *      (`EVIDENCE_SITE_ORIGIN` / `EVIDENCE_PUBLICATION_HOST` /
 *      `EVIDENCE_SIGNER_*` / registry URLs pointed at the local registry);
 *   4. verifies the emitted package OFFLINE (verify-core §9.2 checks) against
 *      that local registry, resolved from the sidecar's own
 *      `trustRegistryUrl` — the same bootstrap a third-party verifier uses.
 *
 * PASS means: the emitted package carries the alternate identity throughout
 * (envelope signer, sidecar registry URLs, environment-extension host, PROV
 * platform agent, notebook attribution) and verifies cleanly against a
 * registry that contains only the ephemeral key — i.e. an instance needs no
 * code edits to become its own publisher.
 *
 * Run (an operator can run this as-is; it touches no network and no DB):
 *
 *   node --experimental-strip-types scripts/rehearse-instance-identity.ts
 *
 * Exit code 0 on PASS, 1 on any failed step. Also exercised by `npm test`
 * via src/lib/evidence/instance-rehearsal.test.ts, which spawns exactly the
 * command above.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';

// --- The alternate identity (pure config; every value is synthetic) --------

const REHEARSAL_ORIGIN = 'https://rehearsal.example.org';
const REHEARSAL_HOST = 'rehearsal.example.org';
const REHEARSAL_KID = 'platform:evidence-rehearsal';
const REHEARSAL_SIGNER = {
  bindingTier: 'platform',
  identifier: 'platform:rehearsal-instance',
  displayName: 'Rehearsal Instance',
} as const;
const REHEARSAL_AGENT_ID = 'rehearsal-instance';

/** Fixed ISO instants for fixture fields (guard-safe: no epoch-milliseconds). */
const FIXED_ISO = '2026-08-01T00:00:00.000Z';

function log(line: string) {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  // --- 1. Ephemeral keypair (in-process; never persisted, never real) -----
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privB64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const pubB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  log('[1/6] ephemeral Ed25519 keypair generated (in-process only)');

  // --- 2. Local trust registry from the instance-setup.md §3 template -----
  const registry = {
    $comment:
      `Trust registry for ${REHEARSAL_HOST} evidence packages (ADR-0020 config ` +
      'rehearsal; ephemeral key, local file, discarded after the run). ' +
      'Verifiers fetch this file, match the (kid, publicKey) pair embedded in ' +
      "a package's signature, and apply the status semantics below.",
    generatedAt: FIXED_ISO,
    statusSemantics: {
      active: 'Valid for signing new packages and for verification.',
      deprecated:
        "Cannot sign new packages. Signatures are valid for verification only when the package's Rekor integratedTime precedes deprecatedAt.",
      revoked:
        'Never valid — any signature is treated as suspect regardless of when the package was integrated.',
    },
    keys: [
      {
        kid: REHEARSAL_KID,
        publicKey: pubB64,
        signerIdentity: { ...REHEARSAL_SIGNER },
        status: 'active',
        activatedAt: FIXED_ISO,
        deprecatedAt: null,
        revokedAt: null,
      },
    ],
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oes-rehearsal-'));
  const registryPath = path.join(tmpDir, 'typed-publisher.json');
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  const registryUrl = pathToFileURL(registryPath).href;
  log(`[2/6] local trust registry written from the instance-setup template`);

  // --- 3. Alternate identity via CONFIG ONLY (the ADR-0020 claim) ---------
  process.env.EVIDENCE_SIGNING_KEY = privB64;
  process.env.EVIDENCE_KEY_ID = REHEARSAL_KID;
  process.env.EVIDENCE_SITE_ORIGIN = REHEARSAL_ORIGIN;
  process.env.EVIDENCE_PUBLICATION_HOST = REHEARSAL_HOST;
  process.env.EVIDENCE_SIGNER_BINDING_TIER = REHEARSAL_SIGNER.bindingTier;
  process.env.EVIDENCE_SIGNER_IDENTIFIER = REHEARSAL_SIGNER.identifier;
  process.env.EVIDENCE_SIGNER_DISPLAY_NAME = REHEARSAL_SIGNER.displayName;
  process.env.EVIDENCE_TRUST_REGISTRY_CANONICAL_URL = registryUrl;
  process.env.EVIDENCE_TRUST_REGISTRY_LEGACY_URL = ''; // omit — no legacy client base
  process.env.EVIDENCE_PLATFORM_AGENT_ID = REHEARSAL_AGENT_ID;
  process.env.EVIDENCE_PLATFORM_AGENT_TITLE = REHEARSAL_SIGNER.displayName;

  // App modules are imported AFTER the environment is set (config getters
  // read at call time; the late import simply removes any load-order doubt).
  const { buildEvidencePackage, DEFAULT_CONTENT_TYPE } = await import(
    '../src/lib/evidence/packager.ts'
  );
  const { signPackage, getActiveSigner, getActiveKeyId } = await import(
    '../src/lib/evidence/signing.ts'
  );
  const { buildCommitmentView } = await import('../src/lib/evidence/commitment.ts');
  const { generateNotebook } = await import('../src/lib/notebook.ts');
  const { getInstanceAttribution } = await import('../src/lib/site-config.ts');

  // --- 4. Produce: build + sign a package under the alternate identity ----
  const notebook = generateNotebook(
    'How many permits were filed last year?',
    'data.example.gov',
    [
      {
        name: 'get_data',
        args: { type: 'query', portal: 'data.example.gov', dataset_id: 'abcd-efab' },
        operationType: 'query',
      },
    ],
    'About 1,200 permits were filed.',
    // #258 A2: attribution is threaded, not read from env inside the
    // builder — resolved here from the alternate-identity environment set
    // above, exactly as the server-side callers resolve it.
    getInstanceAttribution(),
  );

  const { pkg, hash: packageHash } = buildEvidencePackage({
    trace: { resourceSpans: [] },
    prompt: 'How many permits were filed last year?',
    output: 'About 1,200 permits were filed.',
    toolCalls: [
      {
        name: 'get_data',
        args: { type: 'query', portal: 'data.example.gov', dataset_id: 'abcd-efab' },
        resultSummary: { rows: 1, columns: 1 },
        operationType: 'query',
      },
    ],
    model: 'test/model',
    portal: 'data.example.gov',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'Rehearsal analysis',
    summary: 'A rehearsal package emitted under an alternate instance identity.',
    captureMethod: 'chat-flow-stream',
    contentProfile: 'datHere',
    type: DEFAULT_CONTENT_TYPE,
    signer: getActiveSigner(),
    extensions: { 'org.civicaitools.notebook': notebook },
  });

  const signResult = signPackage(packageHash);
  assert.ok(signResult, 'signPackage must sign under the ephemeral key');
  assert.equal(signResult.kid, REHEARSAL_KID, 'signature kid must be the rehearsal kid');
  assert.equal(getActiveKeyId(), REHEARSAL_KID);
  log('[3/6] produce path ran under alternate identity config (package built + signed)');

  // --- 5. Sidecar: the proof object a third party bootstraps from ---------
  // Synthetic row/creator fixtures (guard-safe: hex-letter ids, ISO dates).
  const record = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    slug: 'rehearsal-analysis-abcdef',
    creatorId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    title: 'Rehearsal analysis',
    summary: 'A rehearsal package emitted under an alternate instance identity.',
    model: 'test/model',
    promptHash: 'sha256:promptdigest',
    promptVisibility: 'full_text',
    promptText: 'How many permits were filed last year?',
    systemPromptHash: null,
    mcpServer: null,
    jurisdiction: null,
    civicContext: null,
    basePackageHash: packageHash,
    basePackageStorageKey: `${REHEARSAL_ORIGIN}/evidence-packages/feedface.json`,
    basePackageSignature: JSON.stringify({
      signature: signResult.signature,
      publicKey: signResult.publicKey,
      algorithm: signResult.algorithm,
      kid: signResult.kid,
    }),
    basePackageRfc3161Timestamp: null,
    basePackageRekorEntryId: null,
    basePackageRekorInclusionProof: null,
    basePackageRekorEntryBody: null,
    captureMethod: 'chat-flow-stream',
    contentProfile: 'datHere',
    verificationStatus: 'unverified',
    consistencyClassification: null,
    isPublic: true,
    visibility: 'published',
    withdrawnAt: null,
    withdrawnReason: null,
    withdrawalSignature: null,
    withdrawalTimestamp: null,
    reinstatedAt: null,
    reinstatedReason: null,
    reinstatementSignature: null,
    reinstatementTimestamp: null,
    createdAt: new Date(FIXED_ISO),
    updatedAt: new Date(FIXED_ISO),
  } as unknown as Parameters<typeof buildCommitmentView>[0];

  const creator = {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    githubId: 'abcdef',
    displayName: 'Rehearsal Operator',
    githubProfileUrl: 'https://github.com/octocat',
    createdAt: new Date(FIXED_ISO),
  } as unknown as Parameters<typeof buildCommitmentView>[1];

  const sidecar = buildCommitmentView(record, creator, pkg) as Record<string, unknown>;

  assert.equal(
    sidecar.trustRegistryUrl,
    registryUrl,
    'sidecar trustRegistryUrl must point at the LOCAL registry',
  );
  assert.equal(
    'trustRegistryUrlLegacy' in sidecar,
    false,
    'legacy registry URL must be omitted (empty-string config)',
  );
  log('[4/6] sidecar carries the local registry URL (legacy path omitted)');

  // --- 6. Verify OFFLINE against the local registry (§9.2) ----------------
  // The registry is resolved from the SIDECAR's own trustRegistryUrl — the
  // same bootstrap a third-party verifier performs — then passed to
  // verify-core as data. No network anywhere in this run.
  const {
    recomputePackageHash,
    verifySignature,
    resolveContentCanonicalization,
    verifyContentHash,
    resolvePackageType,
    checkSignerIdentity,
    checkCaptureMethodVocab,
    validateRegistry,
    verifyKeyTrust,
  } = await import('@typedstandards/verify-core');

  const pkgJson = pkg as unknown as Record<string, unknown>;
  const sidecarSig = sidecar.signature as {
    signature: string;
    publicKey: string;
    algorithm?: string;
    kid?: string;
  };

  // #1/#13 envelope integrity: the bytes hash to the signed nodeId.
  assert.equal(recomputePackageHash(pkgJson), packageHash, '#1 envelope hash must match');
  // #2 signature mathematics, from the sidecar's carried envelope.
  assert.equal(
    verifySignature(packageHash, sidecarSig.signature, sidecarSig.publicKey, sidecarSig.algorithm),
    true,
    '#2 signature must verify',
  );
  // #3/#4 content canonicalization + content hash.
  const canon = resolveContentCanonicalization(pkgJson);
  assert.equal(canon.status, 'ok', '#3 canonicalization rule must resolve');
  assert.equal(verifyContentHash(pkgJson, canon).status, 'ok', '#4 content hash must verify');
  // #5 key trust — against the LOCAL registry, resolved via the sidecar URL.
  const loadedRegistry = validateRegistry(
    JSON.parse(fs.readFileSync(fileURLToPath(sidecar.trustRegistryUrl as string), 'utf-8')),
  );
  assert.ok(loadedRegistry, 'local registry must validate structurally');
  const keyTrust = verifyKeyTrust(sidecarSig.publicKey, sidecarSig.kid!, undefined, loadedRegistry);
  assert.equal(keyTrust.status, 'active', '#5 ephemeral key must be active in the local registry');
  // #12 type resolution.
  assert.equal(resolvePackageType(pkgJson).status, 'ok', '#12 type must resolve');
  // #14 signer identity ↔ registry cross-check — THE identity check: the
  // envelope's alternate signer claim must match what the local registry
  // binds to the rehearsal kid.
  assert.equal(
    checkSignerIdentity(pkgJson, sidecarSig.kid, loadedRegistry).status,
    'ok',
    '#14 signer identity must match the local registry entry',
  );
  // #15 captureMethod vocabulary conformance.
  assert.equal(checkCaptureMethodVocab(pkgJson).status, 'ok', '#15 captureMethod must conform');
  log('[5/6] verify-core §9.2 offline checks PASS against the local registry (#1 #2 #3 #4 #5 #12 #14 #15)');

  // --- Alternate identity throughout the emitted output -------------------
  assert.deepEqual(pkg.signer, { ...REHEARSAL_SIGNER }, 'envelope signer must be the alternate identity');

  const env = pkg.extensions?.['org.civicaitools.environment'] as Record<string, unknown>;
  assert.ok(env, 'environment extension must be present (datHere)');
  assert.equal(env.host, REHEARSAL_HOST, 'environment host must be the alternate host');

  const agent = pkg.provenance!['@graph'].find(
    (n) => n['@id'] === `urn:civic-evidence:platform:${REHEARSAL_AGENT_ID}`,
  );
  assert.ok(agent, 'PROV platform agent must carry the alternate id');
  assert.equal(agent!['dcterms:title'], REHEARSAL_SIGNER.displayName);
  assert.equal(agent!['civic:url'], REHEARSAL_ORIGIN);

  const notebookJson = JSON.stringify(pkg.extensions?.['org.civicaitools.notebook']);
  assert.ok(
    notebookJson.includes(`via [${REHEARSAL_HOST}](${REHEARSAL_ORIGIN})`),
    'notebook attribution must carry the alternate host',
  );
  assert.ok(
    notebookJson.includes(`Generated by [${REHEARSAL_SIGNER.displayName}](${REHEARSAL_ORIGIN})`),
    'notebook attribution must carry the alternate instance name',
  );

  // Tier-2 guard (docs/instance-setup.md "Do not parameterize"): vocabulary
  // identifiers are NOT instance identity — the civic: namespace must still
  // point at the shared vocabulary URL even under a fully alternate identity.
  assert.ok(
    JSON.stringify(pkg.provenance!['@context']).includes('https://civicaitools.org/ns/evidence/'),
    'civic: vocabulary namespace must remain unparameterized (Tier-2 guard)',
  );
  log('[6/6] alternate identity present throughout: signer, sidecar registry URLs, environment host, PROV agent, notebook attribution; vocabulary identifiers unchanged');

  fs.rmSync(tmpDir, { recursive: true, force: true });

  log('');
  log('REHEARSAL PASS — alternate instance identity emitted and verified against the local registry with zero code edits (ADR-0020 "built" bar).');
}

main().catch((err) => {
  console.error('REHEARSAL FAIL:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
