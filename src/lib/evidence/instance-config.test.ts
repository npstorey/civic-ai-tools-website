// Instance-identity configuration tests (S3a P2, #166; ADR-0020: instance
// identity is config, not code — and #258: REQUIRED for signing, never
// defaulted).
//
// What these tests cover, post-#258:
//
//   1. STRICT ABSENCE: with no EVIDENCE_* identity env set, the nullable
//      getters return null, the strict resolvers throw
//      `InstanceIdentityError` naming the missing variables, and the
//      packager/notebook surfaces refuse or honestly omit — nothing ever
//      falls back to the reference deployment's values.
//   2. BYTE PARITY BY EXPLICIT INJECTION: with the reference identity
//      injected as environment (reference-identity-fixture.ts — the same
//      variables the real deployment sets), every emitted surface carries
//      the historical bytes exactly. The anti-drift pin ties the fixture to
//      the published packages' own constants.
//   3. OVERRIDES: alternate registry URLs, signer identity, publication
//      host, and platform agent flow through to the emitted sidecar, the
//      signed envelope surfaces, and the provenance graph.
//   4. The known packager constraint rides through (#116 P1 rider).
//
// Config getters read the environment at CALL time, so tests set and restore
// process.env around each call (same pattern as signing.test.ts).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INSTANCE_IDENTITY_REQUIRED_VARS,
  InstanceIdentityError,
  getEvidenceSiteOrigin,
  getPublicationHost,
  requirePublicationHost,
  getSidecarTrustRegistryUrls,
  getEvidenceSignerIdentity,
  getConfiguredSignerIdentity,
  getPlatformAgentOverrides,
  getPlatformTitle,
  getInstanceAttribution,
} from '../site-config.ts';
import {
  REFERENCE_IDENTITY_ENV,
  REFERENCE_SITE_ORIGIN,
  REFERENCE_PUBLICATION_HOST,
  REFERENCE_TRUST_REGISTRY_CANONICAL_URL,
  REFERENCE_TRUST_REGISTRY_LEGACY_URL,
  REFERENCE_PLATFORM_TITLE,
  REFERENCE_PLATFORM_AGENT_ID,
  REFERENCE_SIGNER_IDENTITY,
} from './reference-identity-fixture.ts';
import { buildCell0Source, buildFooterCellSource } from '../notebook-author/prompt.ts';
import { generateNotebook } from '../notebook.ts';
import {
  CIVICAITOOLS_PLATFORM_AGENT,
  CIVICAITOOLS_ENVIRONMENT_HOST,
} from '@typedstandards/civic-typed-harness';
import { getActiveSigner } from './signing.ts';
import { buildCommitmentView } from './commitment.ts';
import { buildEvidencePackage, type PackageInput } from './packager.ts';
import { evidenceRecords, users } from '../db/schema.ts';

type EvidenceRecord = typeof evidenceRecords.$inferSelect;
type UserRecord = typeof users.$inferSelect;

// Packages built below carry `metadata.signingKeyId`, and there is no coded
// default for it (signing.ts) — an instance emits the kid it declared or
// none. Deliberately NOT one of IDENTITY_VARS: the helpers below unset every
// name in that list, and the kid is custody-side config the packager requires
// on every path. `node --test` runs each file in its own process.
process.env.EVIDENCE_KEY_ID ??= 'platform:test-suite-kid';

/** Every instance-identity variable the getters read. */
const IDENTITY_VARS = [
  'EVIDENCE_SITE_ORIGIN',
  'EVIDENCE_PUBLICATION_HOST',
  'EVIDENCE_TRUST_REGISTRY_CANONICAL_URL',
  'EVIDENCE_TRUST_REGISTRY_LEGACY_URL',
  'EVIDENCE_SIGNER_BINDING_TIER',
  'EVIDENCE_SIGNER_IDENTIFIER',
  'EVIDENCE_SIGNER_DISPLAY_NAME',
  'EVIDENCE_PLATFORM_AGENT_ID',
  'EVIDENCE_PLATFORM_AGENT_TITLE',
  'EVIDENCE_PLATFORM_AGENT_URL',
] as const;

/** Run `fn` with the given identity env vars set (and everything else in the
 *  identity set explicitly UNSET), restoring the prior environment after. */
function withIdentityEnv<T>(vars: Partial<Record<(typeof IDENTITY_VARS)[number], string>>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const name of IDENTITY_VARS) {
    saved[name] = process.env[name];
    const next = vars[name];
    if (next === undefined) delete process.env[name];
    else process.env[name] = next;
  }
  try {
    return fn();
  } finally {
    for (const name of IDENTITY_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

/** Async variant for tests that `await import()` under a controlled env. */
async function withIdentityEnvAsync<T>(
  vars: Partial<Record<(typeof IDENTITY_VARS)[number], string>>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const name of IDENTITY_VARS) {
    saved[name] = process.env[name];
    const next = vars[name];
    if (next === undefined) delete process.env[name];
    else process.env[name] = next;
  }
  try {
    return await fn();
  } finally {
    for (const name of IDENTITY_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

// --- 1. Strict absence: no env → null / refusal, never a reference value ---

test('absence: with no identity env set, the nullable getters return null', () => {
  withIdentityEnv({}, () => {
    assert.equal(getEvidenceSiteOrigin(), null);
    assert.equal(getPublicationHost(), null);
    assert.equal(getPlatformTitle(), null);
    assert.equal(getConfiguredSignerIdentity(), null);
    assert.deepEqual(getInstanceAttribution(), {
      origin: null,
      host: null,
      platformTitle: null,
    });
    assert.deepEqual(getPlatformAgentOverrides(), {
      id: undefined,
      title: undefined,
      url: undefined,
    });
  });
});

test('absence: the strict resolvers throw InstanceIdentityError naming the missing variables', () => {
  withIdentityEnv({}, () => {
    assert.throws(
      () => requirePublicationHost(),
      (err: unknown) =>
        err instanceof InstanceIdentityError &&
        err.missing.includes('EVIDENCE_SITE_ORIGIN'),
    );
    assert.throws(
      () => getSidecarTrustRegistryUrls(),
      (err: unknown) =>
        err instanceof InstanceIdentityError &&
        err.missing.includes('EVIDENCE_SITE_ORIGIN'),
    );
    assert.throws(
      () => getEvidenceSignerIdentity(),
      (err: unknown) =>
        err instanceof InstanceIdentityError &&
        err.missing.length === 3 &&
        err.missing.includes('EVIDENCE_SIGNER_BINDING_TIER') &&
        err.missing.includes('EVIDENCE_SIGNER_IDENTIFIER') &&
        err.missing.includes('EVIDENCE_SIGNER_DISPLAY_NAME'),
    );
  });
});

test('absence: a PARTIAL signer triple throws naming only the missing members', () => {
  withIdentityEnv(
    {
      EVIDENCE_SIGNER_BINDING_TIER: 'platform',
      EVIDENCE_SIGNER_IDENTIFIER: 'platform:partial',
    },
    () => {
      assert.throws(
        () => getEvidenceSignerIdentity(),
        (err: unknown) =>
          err instanceof InstanceIdentityError &&
          err.missing.length === 1 &&
          err.missing[0] === 'EVIDENCE_SIGNER_DISPLAY_NAME',
      );
      assert.equal(getConfiguredSignerIdentity(), null);
    },
  );
});

test('absence: the packager refuses — no reference agent or host can reach signed output', () => {
  withIdentityEnv({}, () => {
    assert.throws(
      () => buildEvidencePackage(basePackageInput({ contentProfile: 'datHere' })),
      (err: unknown) => err instanceof InstanceIdentityError,
    );
  });
});

test('absence: notebook surfaces honestly OMIT attribution (no host, no title, no reference values)', () => {
  withIdentityEnv({}, () => {
    const cell0 = buildCell0Source({
      query: 'How many permits?',
      generatedAt: '2026-06-01',
      portals: ['data.example.gov'],
    });
    assert.ok(cell0.includes('**Generated:** 2026-06-01'));
    assert.ok(!cell0.includes(' via ['), 'cell 0 must omit the via-attribution');
    assert.ok(!cell0.includes('civicaitools.org'));
    const footer = buildFooterCellSource({
      citations: [],
      generatedAt: '2026-06-01',
      modelName: 'test/model',
    });
    assert.ok(!footer.includes('Generated by ['), 'footer must omit Generated-by');
    assert.ok(!footer.includes('civicaitools.org'));
    // Client-download notebook builder: attribution is THREADED (#258 A2);
    // an unconfigured instance threads nulls and the lines are omitted.
    const nb = JSON.stringify(
      generateNotebook('q', 'data.example.gov', [], 'answer', getInstanceAttribution()),
    );
    assert.ok(!nb.includes(' via ['));
    assert.ok(!nb.includes('Generated by ['));
    assert.ok(!nb.includes('civicaitools.org'));
  });
});

test('skill text: with no config no host appears, and the fallback is generic-only', async () => {
  // The skill constants are module-level template literals — this first (and
  // only) import in this process happens under a cleared identity env.
  // DATA_COMMONS_SKILL interpolates the instance host and must honestly omit
  // it here; SOCRATA_SKILL_FALLBACK is generic-only post-P4 (sprint 154) —
  // host-free and posture-free under EVERY env. The override direction is
  // proven in src/lib/mcp/skill-instance-config.test.ts (its own process sets
  // the env BEFORE importing).
  await withIdentityEnvAsync({}, async () => {
    const { SOCRATA_SKILL_FALLBACK } = await import('../mcp/socrata-skill.ts');
    const { DATA_COMMONS_SKILL } = await import('../mcp/data-commons-skill.ts');
    assert.ok(
      SOCRATA_SKILL_FALLBACK.includes(
        'Applies to: HTTP-connected web clients, on any deployment of the web app.',
      ),
      'fallback skill should carry the host-free generic Applies-to line',
    );
    assert.ok(!SOCRATA_SKILL_FALLBACK.includes('civicaitools.org'));
    // Generic-only: no reference-demo posture text on the fallback path.
    for (const marker of [
      'This is a public demo',
      'github.com/npstorey/civic-ai-tools',
      'Web Demo Limits',
      'Reference-Demo Posture',
      'Local Tools CTA',
    ]) {
      assert.ok(
        !SOCRATA_SKILL_FALLBACK.includes(marker),
        `fallback skill must not contain posture marker: ${marker}`,
      );
    }
    assert.ok(
      DATA_COMMONS_SKILL.includes(
        'published as an evidence package, the evidence chain captures',
      ),
      'data-commons skill should omit the host with no identity declared',
    );
    assert.ok(
      !DATA_COMMONS_SKILL.includes('published as an evidence package on '),
    );
  });
});

// --- 2. Anti-drift pins: fixture ↔ published packages ---

test('anti-drift: the reference fixture equals the published packages’ demo constants', () => {
  // If the harness bumps its demo identity (or the fixture is edited alone),
  // the "reference env reproduces historical bytes" property silently breaks
  // — this pin makes the drift loud.
  assert.equal(REFERENCE_PUBLICATION_HOST, CIVICAITOOLS_ENVIRONMENT_HOST);
  assert.equal(REFERENCE_SITE_ORIGIN, CIVICAITOOLS_PLATFORM_AGENT.url);
  assert.equal(REFERENCE_PLATFORM_TITLE, CIVICAITOOLS_PLATFORM_AGENT.title);
  assert.equal(REFERENCE_PLATFORM_AGENT_ID, CIVICAITOOLS_PLATFORM_AGENT.id);
});

test('anti-drift: the gate’s required-variable list matches the strict getters’ needs', () => {
  assert.deepEqual([...INSTANCE_IDENTITY_REQUIRED_VARS], [
    'EVIDENCE_SITE_ORIGIN',
    'EVIDENCE_SIGNER_BINDING_TIER',
    'EVIDENCE_SIGNER_IDENTIFIER',
    'EVIDENCE_SIGNER_DISPLAY_NAME',
    'EVIDENCE_PLATFORM_AGENT_TITLE',
  ]);
  // The fixture env satisfies the required set (plus the agent id, which the
  // reference deployment also sets explicitly).
  for (const name of INSTANCE_IDENTITY_REQUIRED_VARS) {
    assert.ok(
      (REFERENCE_IDENTITY_ENV as Record<string, string>)[name],
      `fixture env must set ${name}`,
    );
  }
});

// --- 3. Byte parity by explicit injection (the reference deployment) ---

test('parity: injecting the reference env reproduces every historical getter value', () => {
  withIdentityEnv({ ...REFERENCE_IDENTITY_ENV }, () => {
    assert.equal(getEvidenceSiteOrigin(), REFERENCE_SITE_ORIGIN);
    assert.equal(getPublicationHost(), REFERENCE_PUBLICATION_HOST);
    const registry = getSidecarTrustRegistryUrls();
    assert.equal(registry.canonical, REFERENCE_TRUST_REGISTRY_CANONICAL_URL);
    assert.equal(registry.legacy, REFERENCE_TRUST_REGISTRY_LEGACY_URL);
    assert.deepEqual(getEvidenceSignerIdentity(), { ...REFERENCE_SIGNER_IDENTITY });
    assert.deepEqual(getActiveSigner(), { ...REFERENCE_SIGNER_IDENTITY });
    assert.equal(getPlatformTitle(), REFERENCE_PLATFORM_TITLE);
  });
});

test('parity: reference env → the demo agent + host are emitted byte-identically in signed output', () => {
  withIdentityEnv({ ...REFERENCE_IDENTITY_ENV }, () => {
    const { pkg } = buildEvidencePackage(
      basePackageInput({ contentProfile: 'datHere' }),
    );
    const env = pkg.extensions?.['org.civicaitools.environment'] as Record<string, unknown>;
    assert.equal(env.host, CIVICAITOOLS_ENVIRONMENT_HOST);
    const agent = pkg.provenance!['@graph'].find(
      (n) => n['@id'] === `urn:civic-evidence:platform:${CIVICAITOOLS_PLATFORM_AGENT.id}`,
    );
    assert.ok(agent, 'reference platform agent node should be present');
    assert.equal(agent!['dcterms:title'], CIVICAITOOLS_PLATFORM_AGENT.title);
    assert.equal(agent!['civic:url'], CIVICAITOOLS_PLATFORM_AGENT.url);
  });
});

test('parity: reference env → notebook attribution carries the historical strings byte-identically', () => {
  withIdentityEnv({ ...REFERENCE_IDENTITY_ENV }, () => {
    const cell0 = buildCell0Source({
      query: 'How many permits?',
      generatedAt: '2026-06-01',
      portals: ['data.example.gov'],
    });
    assert.ok(cell0.includes('via [civicaitools.org](https://civicaitools.org)'));
    const footer = buildFooterCellSource({
      citations: [],
      generatedAt: '2026-06-01',
      modelName: 'test/model',
    });
    assert.ok(footer.includes('Generated by [Civic AI Tools](https://civicaitools.org).'));
    const nb = JSON.stringify(
      generateNotebook('q', 'data.example.gov', [], 'answer', getInstanceAttribution()),
    );
    assert.ok(nb.includes('via [civicaitools.org](https://civicaitools.org)'));
    assert.ok(nb.includes('Generated by [Civic AI Tools](https://civicaitools.org)'));
  });
});

// --- 4. Derivation + overrides ---

test('derivation: EVIDENCE_SITE_ORIGIN alone re-points host, registry URLs, and agent URL', () => {
  withIdentityEnv({ EVIDENCE_SITE_ORIGIN: 'https://evidence.example.org/' }, () => {
    // Trailing slash trimmed; host and well-known paths derive.
    assert.equal(getEvidenceSiteOrigin(), 'https://evidence.example.org');
    assert.equal(getPublicationHost(), 'evidence.example.org');
    const registry = getSidecarTrustRegistryUrls();
    assert.equal(
      registry.canonical,
      'https://evidence.example.org/.well-known/typed-publisher.json',
    );
    assert.equal(
      registry.legacy,
      'https://evidence.example.org/.well-known/evidence-public-keys.json',
    );
    assert.equal(getPlatformAgentOverrides().url, 'https://evidence.example.org');
    // The `/evidence/<slug>` detail-URL composition used by the evidence
    // detail page (canonical/OG/JSON-LD) and the bundle route — those are
    // Next server modules that can't load under node --test, so the wiring
    // is proven at the getter level (the pages compose exactly this).
    assert.equal(
      `${getEvidenceSiteOrigin()}/evidence/some-slug`,
      'https://evidence.example.org/evidence/some-slug',
    );
  });
});

test('per-item overrides win over origin derivation; empty legacy URL means omit', () => {
  withIdentityEnv(
    {
      EVIDENCE_SITE_ORIGIN: 'https://evidence.example.org',
      EVIDENCE_PUBLICATION_HOST: 'alt-host.example.net',
      EVIDENCE_TRUST_REGISTRY_CANONICAL_URL: 'https://keys.example.net/registry.json',
      EVIDENCE_TRUST_REGISTRY_LEGACY_URL: '',
    },
    () => {
      assert.equal(getPublicationHost(), 'alt-host.example.net');
      const registry = getSidecarTrustRegistryUrls();
      assert.equal(registry.canonical, 'https://keys.example.net/registry.json');
      assert.equal(registry.legacy, undefined);
    },
  );
});

test('signer identity: EVIDENCE_SIGNER_* flows through getActiveSigner', () => {
  withIdentityEnv(
    {
      EVIDENCE_SIGNER_BINDING_TIER: 'organization',
      EVIDENCE_SIGNER_IDENTIFIER: 'org:example-instance',
      EVIDENCE_SIGNER_DISPLAY_NAME: 'Example Instance',
    },
    () => {
      assert.deepEqual(getActiveSigner(), {
        bindingTier: 'organization',
        identifier: 'org:example-instance',
        displayName: 'Example Instance',
      });
    },
  );
});

// --- 5. Overrides flow through to emitted output ---

function makeRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  const base = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    slug: 'sample-analysis-abcdef',
    creatorId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    title: 'Sample analysis',
    summary: 'A short summary.',
    model: 'test/model',
    promptHash: 'sha256:promptdigest',
    promptVisibility: 'full_text',
    promptText: 'prompt text',
    systemPromptHash: 'sha256:systemdigest',
    mcpServer: 'https://mcp.example.org',
    jurisdiction: 'NYC',
    civicContext: null,
    basePackageHash: 'feedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface',
    basePackageStorageKey: 'https://blobs.example.org/evidence-packages/feedface.json',
    basePackageSignature: JSON.stringify({
      signature: 'BASE64SIG',
      publicKey: 'BASE64PUBKEY',
      algorithm: 'Ed25519ph',
      kid: 'platform:test-key',
    }),
    basePackageRfc3161Timestamp: null,
    basePackageRekorEntryId: null,
    basePackageRekorInclusionProof: null,
    basePackageRekorEntryBody: null,
    captureMethod: 'chat-flow-stream',
    contentProfile: null,
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
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  } as EvidenceRecord;
  return { ...base, ...overrides };
}

function makeCreator(): UserRecord {
  return {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    githubId: '583231',
    displayName: 'Octocat',
    githubProfileUrl: 'https://github.com/octocat',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
  } as UserRecord;
}

test('sidecar: alternate registry config flows into the emitted commitment view', () => {
  withIdentityEnv({ EVIDENCE_SITE_ORIGIN: 'https://evidence.example.org' }, () => {
    const view = buildCommitmentView(makeRecord(), makeCreator(), null);
    assert.equal(
      view.trustRegistryUrl,
      'https://evidence.example.org/.well-known/typed-publisher.json',
    );
    assert.equal(
      view.trustRegistryUrlLegacy,
      'https://evidence.example.org/.well-known/evidence-public-keys.json',
    );
    assert.notEqual(view.trustRegistryUrl, REFERENCE_TRUST_REGISTRY_CANONICAL_URL);
  });
});

test('sidecar: empty legacy URL omits trustRegistryUrlLegacy entirely', () => {
  withIdentityEnv(
    {
      EVIDENCE_SITE_ORIGIN: 'https://evidence.example.org',
      EVIDENCE_TRUST_REGISTRY_LEGACY_URL: '',
    },
    () => {
      const view = buildCommitmentView(makeRecord(), makeCreator(), null);
      assert.equal('trustRegistryUrlLegacy' in view, false);
    },
  );
});

test('sidecar: with no identity declared the view REFUSES (never a reference registry URL)', () => {
  withIdentityEnv({}, () => {
    assert.throws(
      () => buildCommitmentView(makeRecord(), makeCreator(), null),
      (err: unknown) => err instanceof InstanceIdentityError,
    );
  });
});

function basePackageInput(overrides: Partial<PackageInput> = {}): PackageInput {
  return {
    trace: { resourceSpans: [] },
    prompt: 'How many permits were filed last year?',
    output: 'About 1,200.',
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
    title: 'Test',
    summary: 'Test summary.',
    ...overrides,
  };
}

test('signed output: publication host + platform agent overrides flow into the package', () => {
  withIdentityEnv(
    {
      EVIDENCE_SITE_ORIGIN: 'https://evidence.example.org',
      EVIDENCE_PLATFORM_AGENT_ID: 'example-instance',
      EVIDENCE_PLATFORM_AGENT_TITLE: 'Example Instance',
    },
    () => {
      const { pkg } = buildEvidencePackage(
        basePackageInput({ contentProfile: 'datHere' }),
      );
      // datHere environment host (inside canonical JSON → covered by the hash)
      // follows the instance host derived from the origin.
      const env = pkg.extensions?.['org.civicaitools.environment'] as Record<string, unknown>;
      assert.ok(env, 'environment extension should be present');
      assert.equal(env.host, 'evidence.example.org');
      // PROV platform agent (inside the signed graph) carries the override
      // identity, and its URL follows the origin.
      const agent = pkg.provenance!['@graph'].find(
        (n) => n['@id'] === 'urn:civic-evidence:platform:example-instance',
      );
      assert.ok(agent, 'platform agent node should carry the override id');
      assert.equal(agent!['dcterms:title'], 'Example Instance');
      assert.equal(agent!['civic:url'], 'https://evidence.example.org');
    },
  );
});

test('signed output: a missing agent id derives from the publication host (operator-grounded, never the reference URN)', () => {
  withIdentityEnv(
    {
      EVIDENCE_SITE_ORIGIN: 'https://evidence.example.org',
      EVIDENCE_PLATFORM_AGENT_TITLE: 'Example Instance',
      // no EVIDENCE_PLATFORM_AGENT_ID
    },
    () => {
      const { pkg } = buildEvidencePackage(
        basePackageInput({ contentProfile: 'datHere' }),
      );
      const agent = pkg.provenance!['@graph'].find(
        (n) => n['@id'] === 'urn:civic-evidence:platform:evidence.example.org',
      );
      assert.ok(agent, 'agent id should derive from the publication host');
      const referenceAgent = pkg.provenance!['@graph'].find(
        (n) => n['@id'] === `urn:civic-evidence:platform:${CIVICAITOOLS_PLATFORM_AGENT.id}`,
      );
      assert.equal(referenceAgent, undefined, 'the reference URN must not appear');
    },
  );
});

// --- 6. Known constraint rides through the re-point (#116 P1 rider) ---

test('known constraint: v0.1 datHere input WITHOUT a notebook extension throws', () => {
  // `computeContentHashSha256` refuses to fingerprint `dathere-ag-jupyter/v1`
  // content with no `org.civicaitools.notebook` extension. The app's real
  // publish flow always supplies one; the re-pointed packager keeps the
  // invariant rather than silently hashing something else. Identity env is
  // injected so the failure exercised is the CONSTRAINT, not the identity
  // refusal.
  withIdentityEnv({ ...REFERENCE_IDENTITY_ENV }, () => {
    assert.throws(() =>
      buildEvidencePackage(
        basePackageInput({
          type: 'content/analysis/v1',
          contentProfile: 'datHere',
          // no extensions['org.civicaitools.notebook']
        }),
      ),
    );
  });
});
