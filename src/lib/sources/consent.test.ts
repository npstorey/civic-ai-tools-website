// R6 W2 (#632), the consent store's pure half: the cookie, the selection, the
// reasons a record states, and the re-ask classifier (D3, D4, D5, D6, D12).
//
// WHAT IS DRIVEN. `src/lib/sources/consent.ts`, called directly with
// statements and states built here. The store's two backings (the row and the
// cookie) are driven through the consent endpoint in
// `src/app/api/sources/consent/consent-route-driven.test.ts`, and the gate
// through the four routes in `src/app/api/consent-gate-driven.test.ts`.
//
// THE CLASSIFIER'S RULES (design §4.4, D5 = A), each tested in both
// directions — the change that fires the rule, and the change that must not:
//   base scope (the instance-level recipients; re-asks everyone):
//     1. a recipient added re-asks; the same recipients do not;
//     2. a posture that worsens (none → metadata → content) re-asks; one that
//        improves notifies and does not re-ask;
//     3. a longer retention re-asks; a shorter one notifies;
//     4. a hosting arrangement that changes (the host, where it runs, or who
//        holds its logs) re-asks; an unchanged one does not;
//     5. a recipient removed notifies and does not re-ask;
//   source scope (one source's own row; re-asks for that source only):
//     6. its posture worsens: re-ask; improves: notify;
//     7. its variant changes: re-ask; unchanged: nothing;
//     8. a newly configured source is absent from the stored states: it is
//        Ask first (D6), and nothing is re-asked;
//     9. a source removed notifies;
//   the anonymous cookie (hashes only):
//    10. any change to a stored hash re-asks ("at the next session at the
//        latest"); a stored hash for a source the instance no longer has is
//        ignored, as the stale cookie is.
//
// THE FIXTURES CAN FAIL. Each pair differs in exactly the field its rule reads,
// so a classifier that ignored the field would answer the same for both.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/sources/consent.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The module this phase adds, named by a specifier typed `string` so the
 * compiler does not resolve it: the red commit holds this file before the
 * module exists, and must type-check (the seam `adapt-record.test.ts` uses).
 */
const CONSENT: string = './consent.ts';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mod = (await import(CONSENT).catch(() => null)) as Mod | null;

function need<T = any>(name: string): T { // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(mod, `no consent module: ${CONSENT} does not exist`);
  assert.ok(name in mod!, `${CONSENT} exports no ${name}`);
  return mod![name] as T;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const H = (c: string) => c.repeat(64);

// --- A statement, by hand: what the classifier compares ------------------------

interface KeptBy { holder: string; keeps: string; retention?: string; retentionDays?: number; statementUrl?: string; readOn?: string }
interface Recipient { id: string; key: string; role: string; host?: string; runsAt?: string; receives: string; keptBy: KeptBy[] }
interface Source { sourceId: string; displayName: string; publisher: string; variant: Record<string, unknown>; host?: string; freshness: string; recipients: Recipient[]; version: string }
interface Statement { version: string; date: string; recipients: Recipient[]; sources: Source[]; links: Record<string, unknown> }

function statement(): Statement {
  return {
    version: H('a'),
    date: '2026-10-19',
    recipients: [
      {
        id: 'model-endpoint',
        key: 'Model endpoint',
        role: 'model-endpoint',
        host: 'models.fixture.example',
        receives: 'your question, and the data the sources return for it',
        keptBy: [{ holder: 'models.fixture.example', keeps: 'metadata', retentionDays: 30 }],
      },
      {
        id: 'function-logs',
        key: 'held:function-logs',
        role: 'function-logs',
        runsAt: 'the hosting platform',
        receives: "what this site's own logs record of each step",
        keptBy: [{ holder: 'Fixture Platform', keeps: 'metadata', retentionDays: 1, statementUrl: 'https://platform.fixture.example/logs', readOn: '2026-10-19' }],
      },
    ],
    sources: [
      {
        sourceId: 'socrata',
        displayName: 'Socrata MCP Server',
        publisher: 'npstorey',
        variant: { variant: 'remote', kind: 'remote', runsAt: 'other' },
        host: 'socrata.fixture.example',
        freshness: 'Live.',
        recipients: [{ id: 'source:socrata', key: 'MCP servers', role: 'source', host: 'socrata.fixture.example', receives: 'the searches and queries', keptBy: [{ holder: 'the operator of socrata.fixture.example', keeps: 'operator-states' }] }],
        version: H('b'),
      },
      {
        sourceId: 'data-commons',
        displayName: 'Google Data Commons MCP Server',
        publisher: 'Google',
        variant: { variant: 'remote', kind: 'remote', runsAt: 'publisher' },
        host: 'api.datacommons.org',
        freshness: 'Live.',
        recipients: [{ id: 'source:data-commons', key: 'MCP servers', role: 'source', host: 'api.datacommons.org', receives: 'the searches and queries', keptBy: [{ holder: 'Google', keeps: 'metadata', statementUrl: 'https://policies.google.com/privacy?hl=en-US', readOn: '2026-10-18' }] }],
        version: H('c'),
      },
    ],
    links: { privacy: '/privacy' },
  };
}

const clone = (s: Statement): Statement => JSON.parse(JSON.stringify(s)) as Statement;

type Classify = (previous: Statement, current: Statement) => { verdict: 're-ask' | 'notify' | 'same'; changes: Array<{ scope: string; rule: string; effect: string; sourceId?: string }> };
const classify = (previous: Statement, current: Statement) => need<Classify>('classifyFlowsChange')(previous, current);
const rules = (r: ReturnType<Classify>) => r.changes.map((c) => `${c.scope}:${c.rule}:${c.effect}`);

// --- The cookie (D4, D12; criterion 2) ---------------------------------------------

test('criterion 2: the cookie has a name the privacy page can read, and is host-only, Secure, HttpOnly, SameSite=Lax, Path=/ and a session cookie', () => {
  const name = need<string>('CONSENT_COOKIE_NAME');
  assert.equal(typeof name, 'string');
  assert.match(name, /^[A-Za-z0-9_-]+$/, 'the cookie name is a plain token');
  const header = need<(value: string) => string>('consentCookieHeader')('fixture-value');
  const parts = header.split(';').map((p) => p.trim());
  assert.equal(parts[0], `${name}=fixture-value`);
  const attrs = parts.slice(1).map((p) => p.toLowerCase());
  for (const required of ['path=/', 'secure', 'httponly', 'samesite=lax']) {
    assert.ok(attrs.includes(required), `the consent cookie lacks ${required}: ${header}`);
  }
  assert.ok(!attrs.some((a) => a.startsWith('domain=')), `the consent cookie names a domain, so it is not host-only: ${header}`);
  assert.ok(!attrs.some((a) => a.startsWith('max-age=') || a.startsWith('expires=')), `the consent cookie outlives the session: ${header}`);
});

test('criterion 2: revoking clears the cookie by expiring it, with the same name, path and flags', () => {
  const name = need<string>('CONSENT_COOKIE_NAME');
  const header = need<() => string>('clearConsentCookieHeader')();
  const parts = header.split(';').map((p) => p.trim().toLowerCase());
  assert.ok(parts[0].startsWith(`${name.toLowerCase()}=`));
  assert.ok(parts.includes('max-age=0'), `the clearing header does not expire the cookie: ${header}`);
  for (const required of ['path=/', 'secure', 'httponly', 'samesite=lax']) assert.ok(parts.includes(required), header);
});

test('the cookie round-trips its version, the flows hash and the states, and refuses what it cannot read', () => {
  const encode = need<(c: unknown) => string>('encodeConsentCookie');
  const decode = need<(v: string | undefined) => unknown>('decodeConsentCookie');
  const cookie = { v: 1, flows: H('a'), states: { socrata: { state: 'on', since: '2026-10-19', version: H('b') }, 'data-commons': { state: 'off', since: '2026-10-19', version: H('c') } } };
  const value = encode(cookie);
  assert.match(value, /^[A-Za-z0-9_-]+$/, 'the value is cookie-safe (base64url)');
  assert.deepEqual(decode(value), cookie);
  for (const bad of [undefined, '', 'not-base64-json', encode({ v: 2, flows: H('a'), states: {} }), encode({ v: 1, flows: 'short', states: {} }), encode({ v: 1, flows: H('a'), states: { socrata: { state: 'maybe', since: '2026-10-19', version: H('b') } } })]) {
    assert.equal(decode(bad as string | undefined), null, `decoded ${JSON.stringify(bad)}`);
  }
});

test('the cookie is read from the request\'s Cookie header, among other cookies', () => {
  const name = need<string>('CONSENT_COOKIE_NAME');
  const encode = need<(c: unknown) => string>('encodeConsentCookie');
  const read = need<(request: Request) => unknown>('readConsentCookie');
  const cookie = { v: 1, flows: H('a'), states: { socrata: { state: 'on', since: '2026-10-19', version: H('b') } } };
  const request = new Request('https://site.fixture.example/api/compare-stream', { headers: { cookie: `next-auth.session-token=x; ${name}=${encode(cookie)}; other=1` } });
  assert.deepEqual(read(request), cookie);
  assert.equal(read(new Request('https://site.fixture.example/')), null);
});

// --- The selection and the reasons (D3, D6; criterion 4) -----------------------------

test('criterion 4: the selection is configured ∩ On; Off, Ask first and an absent configured source are not selected, and a stale id is ignored', () => {
  const select = need<(configured: string[], states: Record<string, string>) => string[]>('selectionFromStates');
  const configured = ['socrata', 'data-commons', 'nyc-charter'];
  assert.deepEqual(select(configured, { socrata: 'on', 'data-commons': 'off', 'retired-source': 'on' }), ['socrata']);
  assert.deepEqual(select(configured, { socrata: 'on', 'data-commons': 'on', 'nyc-charter': 'ask-first' }), ['socrata', 'data-commons']);
  assert.deepEqual(select(configured, {}), [], 'a configured source absent from the states is Ask first, so not selected');
});

test('criterion 4: the router\'s reasons are mapped from the stored state (D2 = A)', () => {
  const map = need<(offered: Array<{ sourceId: string; alias: string; reason: string }>, states: Record<string, string>) => Array<{ sourceId: string; alias: string; reason: string }>>('recordSourcesOffered');
  const offered = [
    { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
    { sourceId: 'data-commons', alias: 'data_commons', reason: 'not-selected' },
    { sourceId: 'boston-opencontext', alias: 'boston', reason: 'not-configured' },
    { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'not-selected' },
  ];
  // The table: not-configured stays whatever the state; selected/On is selected;
  // not-selected/Off is reader-off; not-selected with Ask first or no state is not-consented.
  assert.deepEqual(
    map(offered, { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'on', 'nyc-charter': 'ask-first' }).map((s) => s.reason),
    ['selected', 'reader-off', 'not-configured', 'not-consented'],
  );
  assert.deepEqual(
    map(offered, { socrata: 'on', 'data-commons': 'off' }).map((s) => s.reason),
    ['selected', 'reader-off', 'not-configured', 'not-consented'],
    'a configured source absent from the states (D6) is not-consented',
  );
  assert.deepEqual(map(offered, { socrata: 'on', 'retired-source': 'off' }).map((s) => s.sourceId), offered.map((s) => s.sourceId), 'a stale id adds no entry');
  assert.deepEqual(map(offered, {})[0], { sourceId: 'socrata', alias: 'socrata', reason: 'selected' }, 'the entry keeps its keys and their order');
});

// --- The re-ask classifier, signed in (D5 = A; criterion 6) ---------------------------

test('rule 1 (base): a recipient added re-asks; the same recipients do not', () => {
  const before = statement();
  const after = clone(before);
  after.recipients.push({ id: 'analytics:plausible', key: 'analytics:plausible', role: 'analytics', host: 'plausible.io', receives: 'the pages you visit', keptBy: [{ holder: 'Plausible', keeps: 'metadata' }] });
  assert.equal(classify(before, after).verdict, 're-ask');
  assert.ok(rules(classify(before, after)).includes('base:recipient-added:re-ask'));
  assert.equal(classify(before, clone(before)).verdict, 'same');
});

test('rule 2 (base): a posture that worsens re-asks, none → metadata and metadata → content; one that improves notifies', () => {
  const before = statement();
  for (const [from, to] of [['none', 'metadata'], ['metadata', 'content'], ['none', 'content']]) {
    const a = clone(before); a.recipients[0].keptBy[0].keeps = from;
    const b = clone(before); b.recipients[0].keptBy[0].keeps = to;
    assert.equal(classify(a, b).verdict, 're-ask', `${from} → ${to}`);
    assert.ok(rules(classify(a, b)).includes('base:posture-worse:re-ask'), `${from} → ${to}`);
    assert.equal(classify(b, a).verdict, 'notify', `${to} → ${from}`);
    assert.ok(rules(classify(b, a)).includes('base:posture-better:notify'), `${to} → ${from}`);
  }
});

test('rule 3 (base): a longer retention re-asks; a shorter one notifies', () => {
  const before = statement();
  const longer = clone(before); longer.recipients[1].keptBy[0].retentionDays = 30;
  assert.equal(classify(before, longer).verdict, 're-ask');
  assert.ok(rules(classify(before, longer)).includes('base:posture-worse:re-ask'));
  assert.equal(classify(longer, before).verdict, 'notify');
});

test('rule 4 (base): a hosting arrangement that changes re-asks — the host, where it runs, or who holds its logs; unchanged, nothing', () => {
  const before = statement();
  const host = clone(before); host.recipients[0].host = 'other-models.fixture.example';
  const runsAt = clone(before); runsAt.recipients[1].runsAt = "the operator's own server";
  const holder = clone(before); holder.recipients[1].keptBy[0].holder = 'Another Platform';
  for (const [what, after] of [['host', host], ['runsAt', runsAt], ['holder', holder]] as const) {
    assert.equal(classify(before, after).verdict, 're-ask', what);
    assert.ok(rules(classify(before, after)).includes('base:hosting-changed:re-ask'), what);
  }
  const reread = clone(before); reread.recipients[1].keptBy[0].readOn = '2026-11-01';
  assert.notEqual(classify(before, reread).verdict, 're-ask', 'a statement re-read on a later date, saying the same, is not a change of arrangement');
});

test('rule 5 (base): a recipient removed notifies and does not re-ask', () => {
  const before = statement();
  const after = clone(before); after.recipients.splice(1, 1);
  assert.equal(classify(before, after).verdict, 'notify');
  assert.ok(rules(classify(before, after)).includes('base:recipient-removed:notify'));
  assert.equal(classify(after, before).verdict, 're-ask', 'the converse is rule 1');
});

test('rule 6 (source): a source posture that worsens re-asks for that source; one that improves notifies', () => {
  const before = statement();
  const worse = clone(before); worse.sources[1].recipients[0].keptBy[0].keeps = 'content'; worse.sources[1].version = H('d');
  const r = classify(before, worse);
  assert.equal(r.verdict, 're-ask');
  assert.deepEqual(r.changes.filter((c) => c.effect === 're-ask').map((c) => [c.scope, c.rule, c.sourceId]), [['source', 'source-posture-worse', 'data-commons']]);
  assert.equal(classify(worse, before).verdict, 'notify');
  assert.ok(rules(classify(worse, before)).includes('source:source-posture-better:notify'));
});

test('rule 7 (source): a source whose variant changes re-asks for that source; an unchanged variant does nothing', () => {
  const before = statement();
  const moved = clone(before);
  moved.sources[0].variant = { variant: 'sandbox', kind: 'npm-package', runsAt: 'instance-sandbox', package: '@fixture/socrata', version: '1.0.0' };
  moved.sources[0].version = H('e');
  const r = classify(before, moved);
  assert.equal(r.verdict, 're-ask');
  assert.ok(r.changes.some((c) => c.scope === 'source' && c.rule === 'source-variant-changed' && c.effect === 're-ask' && c.sourceId === 'socrata'));
  const freshness = clone(before); freshness.sources[0].freshness = 'Live, and now cached for ten minutes.';
  assert.notEqual(classify(before, freshness).verdict, 're-ask', 'a freshness line is not a variant');
});

test('rule 8 (source): a newly configured source is Ask first, and nothing is re-asked or the base version moved', () => {
  const before = statement();
  const after = clone(before);
  after.sources.push({ sourceId: 'boston-opencontext', displayName: 'Boston OpenContext MCP Server', publisher: 'City of Boston', variant: { variant: 'remote', kind: 'remote', runsAt: 'government' }, host: 'boston.fixture.example', freshness: 'Live.', recipients: [{ id: 'source:boston-opencontext', key: 'MCP servers', role: 'source', host: 'boston.fixture.example', receives: 'the searches and queries', keptBy: [{ holder: 'City of Boston', keeps: 'metadata' }] }], version: H('f') });
  const r = classify(before, after);
  assert.notEqual(r.verdict, 're-ask');
  assert.ok(!r.changes.some((c) => c.effect === 're-ask'));
  assert.ok(rules(r).includes('source:source-added:ask-first'));
  assert.equal(after.version, before.version, 'premise: configuring a source leaves the base version alone');
});

test('rule 9 (source): a source removed notifies', () => {
  const before = statement();
  const after = clone(before); after.sources.splice(1, 1);
  assert.equal(classify(before, after).verdict, 'notify');
  assert.ok(rules(classify(before, after)).includes('source:source-removed:notify'));
});

// --- The re-ask rule for the anonymous cookie (D5 = A; criterion 6) -------------------

test('rule 10 (cookie): equal hashes keep the consent in force; any change to a stored hash re-asks; a stale source and a new one do not', () => {
  const inForce = need<(cookie: unknown, current: Statement) => { inForce: boolean; reask: { base: boolean; sources: string[] } }>('cookieConsentInForce');
  const current = statement();
  const cookie = { v: 1, flows: current.version, states: { socrata: { state: 'on', since: '2026-10-19', version: current.sources[0].version }, 'data-commons': { state: 'off', since: '2026-10-19', version: current.sources[1].version } } };
  assert.equal(inForce(cookie, current).inForce, true);

  const base = { ...cookie, flows: H('9') };
  assert.deepEqual(inForce(base, current), { inForce: false, reask: { base: true, sources: [] } });

  const source = { ...cookie, states: { ...cookie.states, 'data-commons': { ...cookie.states['data-commons'], version: H('8') } } };
  assert.deepEqual(inForce(source, current), { inForce: false, reask: { base: false, sources: ['data-commons'] } }, 'an improvement re-asks too: the cookie cannot tell one from a worsening');

  const stale = { ...cookie, states: { ...cookie.states, 'retired-source': { state: 'on', since: '2026-10-01', version: H('7') } } };
  assert.equal(inForce(stale, current).inForce, true, 'a stored hash for a source the instance no longer has is ignored');

  const fewer = { ...cookie, states: { socrata: cookie.states.socrata } };
  assert.equal(inForce(fewer, current).inForce, true, 'a configured source absent from the cookie is Ask first, not a re-ask');
});

// --- The guide names what W2 adds (criterion 7) ------------------------------------------

test('criterion 7: the deployment guide names the cookie, the table, both routes and what re-asks', () => {
  const name = need<string>('CONSENT_COOKIE_NAME');
  const guide = fs.readFileSync(path.join(REPO, 'docs', 'deploy.md'), 'utf8');
  const start = guide.indexOf('## Consent and the flows statement');
  assert.notEqual(start, -1, 'docs/deploy.md has no "## Consent and the flows statement" section');
  const end = guide.indexOf('\n## ', start + 1);
  const section = guide.slice(start, end === -1 ? undefined : end);
  for (const needle of [`\`${name}\``, '`source_consents`', '`/api/flows`', '`/api/sources/consent`', 're-ask', '`0017_source_consents.sql`', 'docs/flows-changelog.md']) {
    assert.ok(section.includes(needle), `the guide's consent section does not name ${needle}`);
  }
});

// --- Added at stage B, on the ORCH's rulings -------------------------------------------------

test('rule 4 (base): a change in what a recipient receives is a changed arrangement, and re-asks; the converse re-asks too', () => {
  const before = statement();
  const after = clone(before);
  after.recipients[0].receives = `${after.recipients[0].receives}, and your network address`;
  assert.equal(classify(before, after).verdict, 're-ask');
  assert.ok(rules(classify(before, after)).includes('base:hosting-changed:re-ask'));
  assert.equal(classify(after, before).verdict, 're-ask', 'receiving less is still a changed arrangement: the rule cannot rank a sentence');
  assert.equal(classify(before, clone(before)).verdict, 'same');
});

test('the unranked postures: any change to or from not-stated or operator-states re-asks, in both directions', () => {
  const before = statement();
  for (const [from, to] of [['metadata', 'not-stated'], ['not-stated', 'none'], ['operator-states', 'metadata'], ['content', 'operator-states'], ['not-stated', 'operator-states']]) {
    const a = clone(before); a.recipients[0].keptBy[0].keeps = from;
    const b = clone(before); b.recipients[0].keptBy[0].keeps = to;
    assert.equal(classify(a, b).verdict, 're-ask', `${from} → ${to}`);
    assert.equal(classify(b, a).verdict, 're-ask', `${to} → ${from}`);
  }
  const same = clone(before); same.recipients[0].keptBy[0].keeps = 'operator-states';
  assert.equal(classify(same, clone(same)).verdict, 'same', 'an unchanged unranked posture re-asks nothing');
});

test('since is a calendar date, YYYY-MM-DD, never a time', () => {
  const date = need<(now?: Date) => string>('consentDate');
  assert.equal(date(new Date('2026-10-19T23:59:59.999Z')), '2026-10-19');
  assert.match(date(), /^\d{4}-\d{2}-\d{2}$/);
  const decode = need<(v: string) => unknown>('decodeConsentCookie');
  const encode = need<(c: unknown) => string>('encodeConsentCookie');
  assert.equal(decode(encode({ v: 1, flows: H('a'), states: { socrata: { state: 'on', since: '2026-10-19T12:00:00Z', version: H('b') } } })), null, 'a cookie whose since is a time is refused');
});
