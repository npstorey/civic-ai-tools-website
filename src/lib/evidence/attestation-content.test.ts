// #559 criterion 3 — the record page reads an attestation's content only through
// the app's attestation package route, and a failed read is never content.
//
// WHY TWO HALVES. `AttestationSection.tsx` is JSX, which `--experimental-strip-types`
// cannot parse, so the BEHAVIOUR lives in `./attestation-content.ts` and is
// driven here with a fetch the test controls: the path requested, what a 2xx
// body comes to, and what a 404, a 502, a dropped connection, a body that is
// not JSON and a body that is not an object each come to. The component's USE
// of that module, and the absence of any storage-address fetch under
// `src/components` and `src/app`, are asserted over the source.
// `src/app/api/evidence/attestation-package-route.test.ts` drives the same
// function against the real route handler, so a 404 there is the gate's own.
//
// WHAT MAKES THE ASSERTIONS ABLE TO FAIL. The refusal fixtures carry a JSON
// error body (`{"error":…}`) with their status, so a helper that returned
// whatever JSON came back would hand the page an error body as content and fail
// the `null` assertion. Shown red at #559's red commit against a stub that
// requested nothing and returned nothing.
//
// BLIND SPOTS, stated. The source assertions cannot tell that the effect and
// the toggle run at runtime, only that the file wires them so. The search for a
// storage-address fetch is textual: it finds `fetch(` whose argument names a
// `storageKey`, `storage_key`, `blobUrl` or `packageUrl`, and would miss an
// address laundered through a variable of another name; the component's own
// assertion (it no longer names `storageKey` at all) closes that for the one
// file that did it.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { attestationPackagePath, loadAttestationPackage } from './attestation-content.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Source with comments removed, so a comment cannot satisfy or trip an assertion. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const SLUG = 'noise-complaints-2026-q3-a1b2c3';
const ID = '0f8e1c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const STORED = '{"schemaVersion":"0.1.0","type":"expert_attestation","body":"café ☕","rating":"endorse","n":1.0}';

function harness(respond: () => Promise<Response>) {
  const requested: Array<{ input: string; init?: RequestInit }> = [];
  return {
    requested,
    deps: {
      fetch: async (input: string, init?: RequestInit) => {
        requested.push({ input, init });
        return respond();
      },
    },
  };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('#559 C3: the path is the app\'s attestation package route, encoded', () => {
  assert.equal(attestationPackagePath(SLUG, ID), `/api/records/${SLUG}/attestations/${ID}/package`);
  assert.equal(attestationPackagePath('a/b c', 'x?y'), '/api/records/a%2Fb%20c/attestations/x%3Fy/package');
});

test('#559 C3: a 2xx answer is the stored package, read from the route once, same-origin', async () => {
  const h = harness(async () => new Response(STORED, { status: 200, headers: { 'content-type': 'application/json' } }));
  assert.deepEqual(await loadAttestationPackage(SLUG, ID, h.deps), JSON.parse(STORED));
  assert.equal(h.requested.length, 1);
  assert.equal(h.requested[0].input, `/api/records/${SLUG}/attestations/${ID}/package`);
  assert.equal(h.requested[0].init?.credentials, 'same-origin');
});

test('#559 C3: a refusal is not content — 404 and 502 with JSON error bodies come to null', async () => {
  for (const [status, body] of [
    [404, { error: 'Not found' }],
    [502, { error: 'Package retrieval failed' }],
    [500, { error: 'Internal error', rating: 'endorse', body: 'not a review' }],
  ] as const) {
    const h = harness(async () => json(status, body));
    assert.equal(await loadAttestationPackage(SLUG, ID, h.deps), null, `status ${status}`);
    assert.equal(h.requested.length, 1, `status ${status} was asked once`);
  }
});

test('#559 C3: a dropped connection, a non-JSON body and a non-object body come to null', async () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ['dropped connection', async () => { throw new TypeError('Failed to fetch'); }],
    ['HTML at 200', async () => new Response('<!doctype html><p>sign in</p>', { status: 200 })],
    ['truncated JSON at 200', async () => new Response(STORED.slice(0, 20), { status: 200 })],
    ['an array at 200', async () => json(200, [{ body: 'x' }])],
    ['a string at 200', async () => json(200, 'review')],
    ['null at 200', async () => json(200, null)],
  ];
  for (const [name, respond] of cases) {
    const h = harness(respond);
    assert.equal(await loadAttestationPackage(SLUG, ID, h.deps), null, name);
    assert.equal(h.requested.length, 1, `${name} was asked once`);
  }
});

// --- The component's use of the module -------------------------------------------

const SECTION = code(read('src/components/evidence/AttestationSection.tsx'));

test('#559 C3: AttestationSection reads attestation content only through the module', () => {
  assert.doesNotMatch(SECTION, /storageKey/, 'the component still names a storage address');
  assert.match(
    SECTION,
    /import\s*\{[^}]*\bloadAttestationPackage\b[^}]*\}\s*from\s*'@\/lib\/evidence\/attestation-content'/,
    'the component imports the read module',
  );
  // Every `fetch(` is either the list route, which carries no content, or the
  // browser fetch handed to the module unbound.
  const fetches = [...SECTION.matchAll(/\bfetch\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(
    fetches,
    ['`/api/records/${slug}/attestations`', 'input, init', 'input, init'],
    'the only direct fetch is the list; the others are the module\'s injected fetch',
  );
  assert.equal(
    (SECTION.match(/fetch: \(input, init\) => fetch\(input, init\)/g) ?? []).length,
    2,
    'both injected fetches are the unbound browser fetch',
  );
});

test('#559 C3: the expert reviews load eagerly through the module, and a failed read is unavailable', () => {
  const effect = SECTION.indexOf("(a) => a.type === 'expert_attestation' && !(a.id in expertPayloads)");
  assert.ok(effect > 0, 'the eager expert load is present');
  const end = SECTION.indexOf('}, [slug, attestations, expertPayloads]);', effect);
  assert.ok(end > effect, 'the eager load\'s effect closes');
  const body = SECTION.slice(effect, end);
  assert.match(body, /loadAttestationPackage\(slug, a\.id, \{/, 'each expert review is read by slug and id');
  assert.match(body, /fetch: \(input, init\) => fetch\(input, init\)/, 'through the browser fetch, unbound');
  assert.doesNotMatch(body, /res\.json\(\)|\.ok\b/, 'the effect does not read a response itself');
  // The expert card's unavailable line, as before.
  assert.ok(SECTION.includes('[Review body could not be loaded; the stored package may be unavailable.]'));
});

test('#559 C3: a non-expert card\'s details load on expand through the module, and a failed read is unavailable', () => {
  const toggle = SECTION.indexOf('const toggleExpand = async (attestation: Attestation) => {');
  assert.ok(toggle > 0, 'toggleExpand is present');
  const end = SECTION.indexOf('\n  };', toggle);
  const body = SECTION.slice(toggle, end);
  assert.match(body, /loadAttestationPackage\(slug, attestation\.id, \{/, 'the details are read by slug and id');
  assert.match(body, /fetch: \(input, init\) => fetch\(input, init\)/, 'through the browser fetch, unbound');
  assert.match(body, /setExpandedPkgs\(prev => \(\{ \.\.\.prev, \[attestation\.id\]: data as AttestationPackageData \| null \}\)\)/, 'the result, null on failure, is stored');
  assert.doesNotMatch(body, /res\.json\(\)|\.ok\b/, 'the toggle does not read a response itself');

  const card = SECTION.indexOf('function AttestationCard(');
  assert.ok(card > 0, 'the card is present');
  const cardEnd = SECTION.indexOf('\nfunction ', card + 1);
  const cardBody = SECTION.slice(card, cardEnd);
  const unavailable = cardBody.indexOf('{isExpanded && expanded === null && (');
  assert.ok(unavailable > 0, 'an expanded card with a failed read renders a state');
  assert.ok(cardBody.indexOf('[Details could not be loaded; the stored package may be unavailable.]', unavailable) > unavailable,
    'and that state says the details are unavailable');
});

// --- The search: no storage-address fetch in client code -------------------------

test('#559 C3: no fetch of a storage address remains under src/components or src/app', () => {
  // The universe is derived from git, so a file added later is covered too.
  const files = execFileSync('git', ['ls-files', '--', 'src/components', 'src/app'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !/\.test\.(ts|tsx|mjs)$/.test(f));
  assert.ok(files.length > 50, `the search reads the tree (${files.length} files)`);
  assert.ok(files.includes('src/components/evidence/AttestationSection.tsx'), 'and includes the component');
  const hits: string[] = [];
  for (const file of files) {
    const src = code(read(file));
    for (const m of src.matchAll(/\bfetch\(\s*([^,)]*)/g)) {
      if (/storageKey|storage_key|blobUrl|packageUrl/i.test(m[1])) hits.push(`${file}: fetch(${m[1].trim()}`);
    }
  }
  assert.deepEqual(hits, [], 'a storage address is fetched in client code');
});
