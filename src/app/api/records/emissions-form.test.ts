// Emissions-form guard for the settlement cutover (civic-ai-tools#160 P5).
//
// WHAT P3 LEFT AND P5 DID. The expand phase landed `/api/records/*` and
// `/records/*` as canonical segments with the prior-era ones as PERMANENT
// aliases, and deliberately left every EMISSION on the prior-era form: what
// the site served changed, what it *said* did not. This phase flips what it
// says. Both halves matter and they fail differently, so they are guarded
// separately — `segment-alias.test.ts` proves both addresses serve; this file
// proves the server names the canonical one.
//
// WHY SOURCE TEXT. `npm test` is `node --test` over modules that resolve
// neither the `@/` alias nor Next's request plumbing, so a route handler
// cannot be imported here (the same constraint documented at length in
// `segment-alias.test.ts`). Reading the emitting file's source is what is
// available; `next build`, CI, and the preview deployment are the
// authoritative legs for dispatch.
//
// WHAT WOULD BREAK WITHOUT THIS. A publish response carrying
// `url: "/evidence/<slug>"` is not an error — the alias serves forever, so
// nothing 404s and no test that only exercises resolution would notice. It
// would simply mean the reference publisher kept advertising the prior-era
// address indefinitely, which is exactly the outcome the settlement's
// "new emissions use the new vocabulary" rule (Appendix J §J.4.3) exists to
// prevent. Silence is the failure mode; hence a guard.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

/** Files that put a record's public address into a response body or into
 *  rendered page metadata. Each is the server SPEAKING, not serving. */
const EMITTING_SOURCES = [
  // Publish responses — the `url` an API client stores.
  'src/app/api/evidence/route.ts',
  'src/app/api/evidence/[slug]/publish/route.ts',
  // Canonical / OG / JSON-LD URLs and the commitment deep-link.
  'src/app/(app)/evidence/[slug]/page.tsx',
  // The detail URL embedded in an exported notebook bundle's cell 0.
  'src/app/api/evidence/[slug]/bundle/route.ts',
];

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

/** Strip line and block comments so prose ABOUT the prior-era form — which
 *  every one of these files legitimately carries, explaining that the old
 *  segment stays served — is not mistaken for an emission. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('emissions: no server-emitted URL still carries the prior-era segment', () => {
  for (const rel of EMITTING_SOURCES) {
    const body = code(read(rel));
    // Template-literal and plain-string address construction, both forms.
    const priorEra = /['"`]\/(?:api\/)?evidence\/\$\{|['"`]\/(?:api\/)?evidence['"`]/g;
    const hits = body.match(priorEra) ?? [];
    assert.deepEqual(
      hits,
      [],
      `${rel} still constructs a prior-era address in code: ${hits.join(', ')}`,
    );
  }
});

test('emissions: both publish routes emit the settlement-era url field', () => {
  for (const rel of [
    'src/app/api/evidence/route.ts',
    'src/app/api/evidence/[slug]/publish/route.ts',
  ]) {
    const body = code(read(rel));
    assert.ok(
      /url:\s*`\/records\/\$\{slug\}`/.test(body),
      `${rel} must emit url: \`/records/\${slug}\``,
    );
  }
});

test('emissions: the detail page declares the canonical address in its metadata', () => {
  const body = code(read('src/app/(app)/evidence/[slug]/page.tsx'));
  // Canonical/OG/citation URL and the JSON-LD url, both origin-prefixed.
  const canonical = body.match(/\$\{(?:origin|jsonLdOrigin)\}\/records\/\$\{slug\}/g) ?? [];
  assert.equal(
    canonical.length,
    2,
    'expected the canonical/OG URL and the JSON-LD url to both name /records',
  );
  // The commitment deep-link the verify badge hands to the neutral verifier.
  assert.ok(
    body.includes('/api/records/${slug}/commitment'),
    'the commitment deep-link must use the canonical API segment',
  );
});

test('emissions: first-party client fetches use the canonical API segment', () => {
  // Decided once and applied consistently (P5): every fetch this app makes to
  // its own publish/read API names `/api/records/*`. The prior-era segment
  // stays served for OTHER callers; the reference implementation should not be
  // the thing keeping it warm, and code copied out of this repo should be
  // canonical.
  for (const rel of [
    'src/components/PublishEvidenceDialog.tsx',
    'src/components/dashboard/DashboardTabs.tsx',
    'src/components/evidence/EvidenceActions.tsx',
    'src/components/evidence/EvidenceIndex.tsx',
    'src/components/evidence/AttestationDialog.tsx',
    'src/components/evidence/AttestationSection.tsx',
  ]) {
    const body = code(read(rel));
    const stale = body.match(/fetch\(\s*['"`]\/api\/evidence/g) ?? [];
    assert.deepEqual(stale, [], `${rel} still fetches the prior-era API segment`);
  }
});
