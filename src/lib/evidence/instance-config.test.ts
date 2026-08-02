// Instance-identity configuration tests (S3a P2, #166; ADR-0020: instance
// identity is config, not code).
//
// NEW file — the pre-existing suites are the byte-compat oracle for the
// no-config path and are untouched. These tests cover the NEW behavior:
//
//   1. DEFAULTS: with no EVIDENCE_* identity env set, every config getter
//      returns the demo deployment's historical hardcoded value, and those
//      demo defaults cannot drift from the published packages' own demo
//      constants (the anti-drift pin).
//   2. OVERRIDES: alternate registry URLs, signer identity, publication
//      host, and platform agent flow through to the emitted sidecar, the
//      signed envelope surfaces, and the provenance graph.
//   3. The known packager constraint rides through the re-point: a v0.1
//      datHere input without a notebook extension throws (civic-ai-tools#116
//      P1 rider — a pinned invariant, not a bug).
//
// Config getters read the environment at CALL time, so tests set and restore
// process.env around each call (same pattern as signing.test.ts).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEMO_SITE_ORIGIN,
  DEMO_PUBLICATION_HOST,
  DEMO_TRUST_REGISTRY_CANONICAL_URL,
  DEMO_TRUST_REGISTRY_LEGACY_URL,
  DEMO_SIGNER_IDENTITY,
  DEMO_PLATFORM_TITLE,
  getEvidenceSiteOrigin,
  getPublicationHost,
  getSidecarTrustRegistryUrls,
  getEvidenceSignerIdentity,
  getPlatformAgentOverrides,
  getPlatformTitle,
} from '../site-config.ts';
import { buildCell0Source, buildFooterCellSource } from '../notebook-author/prompt.ts';
import { generateNotebook } from '../notebook.ts';
import {
  CIVICAITOOLS_PLATFORM_AGENT,
  CIVICAITOOLS_ENVIRONMENT_HOST,
} from '@typedstandards/civic-typed-harness';
import { getActiveSigner } from './signing.ts';
import {
  buildCommitmentView,
  CANONICAL_TRUST_REGISTRY_URL,
  LEGACY_TRUST_REGISTRY_URL,
} from './commitment.ts';
import { buildEvidencePackage, type PackageInput } from './packager.ts';
import { evidenceRecords, users } from '../db/schema.ts';

type EvidenceRecord = typeof evidenceRecords.$inferSelect;
type UserRecord = typeof users.$inferSelect;

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

// --- 1. Defaults + anti-drift pins ---

test('defaults: with no identity env set, every getter returns the demo value', () => {
  withIdentityEnv({}, () => {
    assert.equal(getEvidenceSiteOrigin(), DEMO_SITE_ORIGIN);
    assert.equal(getPublicationHost(), DEMO_PUBLICATION_HOST);
    const registry = getSidecarTrustRegistryUrls();
    assert.equal(registry.canonical, DEMO_TRUST_REGISTRY_CANONICAL_URL);
    assert.equal(registry.legacy, DEMO_TRUST_REGISTRY_LEGACY_URL);
    assert.deepEqual(getEvidenceSignerIdentity(), { ...DEMO_SIGNER_IDENTITY });
    assert.deepEqual(getActiveSigner(), { ...DEMO_SIGNER_IDENTITY });
    // No overrides → all undefined, so the packager passes the harness's own
    // default provenance config through untouched.
    assert.deepEqual(getPlatformAgentOverrides(), {
      id: undefined,
      title: undefined,
      url: undefined,
    });
  });
});

test('anti-drift: site-config demo defaults equal the published packages’ demo constants', () => {
  // If the harness bumps its demo identity (or the app edits one side only),
  // the "defaults are byte-identical" property silently breaks — this pin
  // makes the drift loud.
  assert.equal(DEMO_PUBLICATION_HOST, CIVICAITOOLS_ENVIRONMENT_HOST);
  assert.equal(DEMO_SITE_ORIGIN, CIVICAITOOLS_PLATFORM_AGENT.url);
  assert.equal(DEMO_PLATFORM_TITLE, CIVICAITOOLS_PLATFORM_AGENT.title);
  // The commitment module's exported constants are the same demo defaults the
  // sidecar emits with no config set (the existing commitment.test.ts
  // equality assertions depend on exactly this).
  assert.equal(CANONICAL_TRUST_REGISTRY_URL, DEMO_TRUST_REGISTRY_CANONICAL_URL);
  assert.equal(LEGACY_TRUST_REGISTRY_URL, DEMO_TRUST_REGISTRY_LEGACY_URL);
});

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

// --- 2. Overrides flow through to emitted output ---

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
    // The demo constants are untouched exports — the emitted value moved.
    assert.notEqual(view.trustRegistryUrl, CANONICAL_TRUST_REGISTRY_URL);
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

test('signed output: with no identity env set, the demo agent + host are emitted (byte-parity)', () => {
  withIdentityEnv({}, () => {
    const { pkg } = buildEvidencePackage(
      basePackageInput({ contentProfile: 'datHere' }),
    );
    const env = pkg.extensions?.['org.civicaitools.environment'] as Record<string, unknown>;
    assert.equal(env.host, CIVICAITOOLS_ENVIRONMENT_HOST);
    const agent = pkg.provenance!['@graph'].find(
      (n) => n['@id'] === `urn:civic-evidence:platform:${CIVICAITOOLS_PLATFORM_AGENT.id}`,
    );
    assert.ok(agent, 'demo platform agent node should be present');
    assert.equal(agent!['dcterms:title'], CIVICAITOOLS_PLATFORM_AGENT.title);
    assert.equal(agent!['civic:url'], CIVICAITOOLS_PLATFORM_AGENT.url);
  });
});

// --- 2b. Attribution sweep (blast-zone extension): notebook surfaces ---

test('notebook attribution: with no config the demo strings are emitted byte-identically', () => {
  withIdentityEnv({}, () => {
    assert.equal(getPlatformTitle(), DEMO_PLATFORM_TITLE);
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
    const nb = JSON.stringify(generateNotebook('q', 'data.example.gov', [], 'answer'));
    assert.ok(nb.includes('via [civicaitools.org](https://civicaitools.org)'));
    assert.ok(nb.includes('Generated by [Civic AI Tools](https://civicaitools.org)'));
  });
});

test('notebook attribution: origin + title overrides flow into authored and downloaded notebooks', () => {
  withIdentityEnv(
    {
      EVIDENCE_SITE_ORIGIN: 'https://evidence.example.org',
      EVIDENCE_PLATFORM_AGENT_TITLE: 'Example Instance',
    },
    () => {
      // Authored notebook (signed datHere section E): cell 0 + footer.
      const cell0 = buildCell0Source({
        query: 'How many permits?',
        generatedAt: '2026-06-01',
        portals: ['data.example.gov'],
      });
      assert.ok(cell0.includes('via [evidence.example.org](https://evidence.example.org)'));
      assert.ok(!cell0.includes('civicaitools.org'));
      const footer = buildFooterCellSource({
        citations: [],
        generatedAt: '2026-06-01',
        modelName: 'test/model',
      });
      assert.ok(footer.includes('Generated by [Example Instance](https://evidence.example.org).'));
      assert.ok(!footer.includes('civicaitools.org'));
      // Client-download notebook builder (server-resolvable path).
      const nb = JSON.stringify(generateNotebook('q', 'data.example.gov', [], 'answer'));
      assert.ok(nb.includes('via [evidence.example.org](https://evidence.example.org)'));
      assert.ok(nb.includes('Generated by [Example Instance](https://evidence.example.org)'));
      assert.ok(!nb.includes('civicaitools.org'));
    },
  );
});

test('skill text: with no config the demo host is baked at module load', async () => {
  // The skill constants are module-level template literals — this first (and
  // only) import in this process happens under a cleared identity env, so the
  // baked strings are the demo defaults. The override direction is proven in
  // src/lib/mcp/skill-instance-config.test.ts (its own process sets the env
  // BEFORE importing).
  await withIdentityEnvAsync({}, async () => {
    const { SOCRATA_SKILL_FALLBACK } = await import('../mcp/socrata-skill.ts');
    const { DATA_COMMONS_SKILL } = await import('../mcp/data-commons-skill.ts');
    assert.ok(
      SOCRATA_SKILL_FALLBACK.includes('Web demo (civicaitools.org)'),
      'fallback skill should carry the demo host by default',
    );
    assert.ok(
      DATA_COMMONS_SKILL.includes(
        'published as an evidence package on civicaitools.org',
      ),
      'data-commons skill should carry the demo host by default',
    );
  });
});

// --- 3. Known constraint rides through the re-point (#116 P1 rider) ---

test('known constraint: v0.1 datHere input WITHOUT a notebook extension throws', () => {
  // `computeContentHashSha256` refuses to fingerprint `dathere-ag-jupyter/v1`
  // content with no `org.civicaitools.notebook` extension. The app's real
  // publish flow always supplies one; the re-pointed packager keeps the
  // invariant rather than silently hashing something else.
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
