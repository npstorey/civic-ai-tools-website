// Tests for the host-topology decision logic (app front-door v0.1.0, P3).
//
// The core property, matching the seam convention everywhere else in this
// codebase: with none of APP_HOST / MARKETING_HOST / APP_ONLY set, every
// (host, path) pair resolves to `serve` — no withholding, no rewrites,
// anywhere. The full matrix (two-host split × every route class, app-only ×
// every route class, unmatched hosts, partial configuration) is pinned below.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bareHost,
  canonicalHostRedirect,
  classifyPath,
  decideRoute,
  isCanonicalizationExempt,
  normalizeHost,
  originFromHostValue,
  parseBooleanFlag,
  readHostRoutingConfig,
  resolveAppOrigin,
  resolveAskHref,
  resolveDashboardHref,
  resolveHostRole,
  resolvePublicSiteHref,
  APP_PRIVATE_PATHS,
  APP_ROOT_ACTION,
  CANONICALIZATION_EXEMPT_PREFIXES,
  MARKETING_PATHS,
} from './host-routing.ts';

// --- Fixtures ----------------------------------------------------------------

const SPLIT = readHostRoutingConfig({
  APP_HOST: 'app.example.org',
  MARKETING_HOST: 'example.org',
});
const APP_ONLY = readHostRoutingConfig({ APP_ONLY: '1' });
const UNSET = readHostRoutingConfig({});

// One representative per route class, plus depth and edge variants.
const ROOT = '/';
const MARKETING_SAMPLES = ['/about', '/explore', '/learn', '/project', '/roadmap', '/directory', '/explore/deep/link'];
const APP_PRIVATE_SAMPLES = ['/ask', '/dashboard', '/dashboard/settings', '/auth/device', '/dev/notebook-preview'];
const DUAL_SAMPLES = ['/evidence', '/evidence/some-published-slug'];
const OTHER_SAMPLES = [
  '/api/rate-limit', // matcher-excluded in prod, but the function must serve it regardless
  '/_next/static/chunk.js',
  '/.well-known/typed-publisher.json',
  '/bpmn/mcp-query-flow.bpmn',
  '/talks/some-deck.pdf',
  '/file.svg',
  '/no-such-page',
  '/authors', // prefix-collision guard: not /auth/device
  '/dashboard-widgets', // prefix-collision guard: not /dashboard
  '/asked', // prefix-collision guard: not /ask
];
const EVERY_PATH = [ROOT, ...MARKETING_SAMPLES, ...APP_PRIVATE_SAMPLES, ...DUAL_SAMPLES, ...OTHER_SAMPLES];

// --- Rule zero: unset config is a universal pass-through ---------------------

test('unset config: every route class on every host passes through', () => {
  const hosts = ['example.org', 'app.example.org', 'localhost:3000', 'preview-abc.vercel.app', null];
  for (const host of hosts) {
    for (const path of EVERY_PATH) {
      assert.deepEqual(
        decideRoute(host, path, UNSET),
        { kind: 'serve' },
        `unset config must serve ${path} on host ${host}`,
      );
    }
  }
});

// --- Split-host: the marketing host ------------------------------------------

test('split: the marketing host withholds exactly the app-private routes', () => {
  for (const path of APP_PRIVATE_SAMPLES) {
    assert.deepEqual(decideRoute('example.org', path, SPLIT), { kind: 'withhold' }, path);
  }
});

test('split: the marketing host serves root, marketing, evidence, and everything else', () => {
  for (const path of [ROOT, ...MARKETING_SAMPLES, ...DUAL_SAMPLES, ...OTHER_SAMPLES]) {
    assert.deepEqual(decideRoute('example.org', path, SPLIT), { kind: 'serve' }, path);
  }
});

test('split: every declared app-private prefix is withheld on the marketing host, nested too', () => {
  for (const prefix of APP_PRIVATE_PATHS) {
    assert.deepEqual(decideRoute('example.org', prefix, SPLIT), { kind: 'withhold' }, prefix);
    assert.deepEqual(decideRoute('example.org', `${prefix}/nested`, SPLIT), { kind: 'withhold' }, `${prefix}/nested`);
  }
});

// --- Split-host: the app host -------------------------------------------------

test('split: the app host redirects / to the signed-in query mount', () => {
  assert.deepEqual(decideRoute('app.example.org', ROOT, SPLIT), {
    kind: 'redirect',
    destination: '/ask',
  });
});

test('the app root redirect terminates: its destination is served on the app host', () => {
  // Read the destination off the exported constant rather than repeating the
  // literal, so this stays a PROPERTY of whatever the app root points at:
  // wherever it points must be a path this same function serves there. The
  // companion half of the no-loop argument — that the destination page does
  // not itself redirect signed-out visitors — is the (app)/ask page's
  // sign-in-prompt-in-place rendering, documented at both ends.
  assert.equal(APP_ROOT_ACTION.kind, 'redirect');
  const destination = APP_ROOT_ACTION.kind === 'redirect' ? APP_ROOT_ACTION.destination : '';
  assert.deepEqual(decideRoute('app.example.org', destination, SPLIT), { kind: 'serve' });
  assert.deepEqual(decideRoute('gated.example.net', destination, APP_ONLY), { kind: 'serve' });
});

test('signed-out chain on the app host terminates: /dashboard → / → /ask, no cycle', () => {
  // The dashboard's own redirect('/') is the first hop (page-level, not this
  // module's); the proxy contributes the second. Walking the routing half
  // pins that it converges rather than cycling back to a redirect.
  const hops: string[] = [];
  let path = '/'; // where dashboard/page.tsx sends a session-less visitor
  for (let i = 0; i < 5; i++) {
    const action = decideRoute('app.example.org', path, SPLIT);
    if (action.kind !== 'redirect') break;
    path = action.destination;
    hops.push(path);
  }
  assert.deepEqual(hops, ['/ask']); // exactly one proxy hop, then a served page
  assert.deepEqual(decideRoute('app.example.org', path, SPLIT), { kind: 'serve' });
});

test('the query mount is app-private: served on the app host, withheld on the marketing host', () => {
  assert.equal(classifyPath('/ask'), 'app-private');
  assert.deepEqual(decideRoute('app.example.org', '/ask', SPLIT), { kind: 'serve' });
  assert.deepEqual(decideRoute('example.org', '/ask', SPLIT), { kind: 'withhold' });
  // ...and with no topology configured it serves everywhere, like every
  // other route on a single-host instance.
  for (const host of ['example.org', 'app.example.org', 'localhost:3000']) {
    assert.deepEqual(decideRoute(host, '/ask', UNSET), { kind: 'serve' }, host);
  }
});

test('split: the app host withholds every marketing route', () => {
  for (const path of MARKETING_SAMPLES) {
    assert.deepEqual(decideRoute('app.example.org', path, SPLIT), { kind: 'withhold' }, path);
  }
  for (const prefix of MARKETING_PATHS) {
    assert.deepEqual(decideRoute('app.example.org', prefix, SPLIT), { kind: 'withhold' }, prefix);
  }
});

test('split: the app host serves the full (app) group, evidence included', () => {
  for (const path of [...APP_PRIVATE_SAMPLES, ...DUAL_SAMPLES]) {
    assert.deepEqual(decideRoute('app.example.org', path, SPLIT), { kind: 'serve' }, path);
  }
});

test('split: the app host passes through assets, API paths, and unknown URLs', () => {
  for (const path of OTHER_SAMPLES) {
    assert.deepEqual(decideRoute('app.example.org', path, SPLIT), { kind: 'serve' }, path);
  }
});

// --- Split-host: hosts that match neither variable ---------------------------

test('split: an unmatched host (preview, IP, unnamed alias) is untouched everywhere', () => {
  for (const host of ['preview-abc.vercel.app', '127.0.0.1:3000', 'staging.example.net']) {
    for (const path of EVERY_PATH) {
      assert.deepEqual(decideRoute(host, path, SPLIT), { kind: 'serve' }, `${host} ${path}`);
    }
  }
});

test('a missing Host header is passthrough, never a role', () => {
  assert.deepEqual(decideRoute(null, '/dashboard', SPLIT), { kind: 'serve' });
  assert.deepEqual(decideRoute(undefined, '/', SPLIT), { kind: 'serve' });
});

// --- Partial configuration ----------------------------------------------------

test('APP_HOST alone: app role on that host, NO withholding anywhere else', () => {
  const config = readHostRoutingConfig({ APP_HOST: 'app.example.org' });
  // The app host takes its role...
  assert.deepEqual(decideRoute('app.example.org', '/about', config), { kind: 'withhold' });
  assert.deepEqual(decideRoute('app.example.org', '/', config), { kind: 'redirect', destination: '/ask' });
  // ...and every other host keeps today's behavior — withholding on the
  // marketing face starts only when MARKETING_HOST is set (incremental
  // rollout: stand up the app host first, flip the apex second).
  for (const path of EVERY_PATH) {
    assert.deepEqual(decideRoute('example.org', path, config), { kind: 'serve' }, path);
  }
});

test('MARKETING_HOST alone: withholding on that host, all other hosts untouched', () => {
  const config = readHostRoutingConfig({ MARKETING_HOST: 'example.org' });
  assert.deepEqual(decideRoute('example.org', '/dashboard', config), { kind: 'withhold' });
  assert.deepEqual(decideRoute('example.org', '/', config), { kind: 'serve' });
  for (const path of EVERY_PATH) {
    assert.deepEqual(decideRoute('app.example.org', path, config), { kind: 'serve' }, path);
  }
});

// --- App-only single-host instances (contract amendment 1) --------------------

test('app-only: every host gets the app role', () => {
  for (const host of ['gated.example.net', 'preview-abc.vercel.app', 'localhost:3000']) {
    assert.deepEqual(decideRoute(host, '/', APP_ONLY), { kind: 'redirect', destination: '/ask' });
    assert.deepEqual(decideRoute(host, '/ask', APP_ONLY), { kind: 'serve' });
    assert.deepEqual(decideRoute(host, '/dashboard', APP_ONLY), { kind: 'serve' });
    assert.deepEqual(decideRoute(host, '/auth/device', APP_ONLY), { kind: 'serve' });
    assert.deepEqual(decideRoute(host, '/evidence/some-slug', APP_ONLY), { kind: 'serve' });
    for (const path of MARKETING_SAMPLES) {
      assert.deepEqual(decideRoute(host, path, APP_ONLY), { kind: 'withhold' }, `${host} ${path}`);
    }
    for (const path of OTHER_SAMPLES) {
      assert.deepEqual(decideRoute(host, path, APP_ONLY), { kind: 'serve' }, `${host} ${path}`);
    }
  }
});

test('app-only wins over host matching: APP_HOST/MARKETING_HOST are ignored', () => {
  const config = readHostRoutingConfig({
    APP_ONLY: 'true',
    APP_HOST: 'app.example.org',
    MARKETING_HOST: 'example.org',
  });
  // Even the configured marketing host gets the app role.
  assert.deepEqual(decideRoute('example.org', '/dashboard', config), { kind: 'serve' });
  assert.deepEqual(decideRoute('example.org', '/about', config), { kind: 'withhold' });
});

// --- Host normalization --------------------------------------------------------

test('host matching is case-, port-, and www-insensitive', () => {
  assert.deepEqual(decideRoute('App.Example.Org', '/about', SPLIT), { kind: 'withhold' });
  assert.deepEqual(decideRoute('app.example.org:443', '/about', SPLIT), { kind: 'withhold' });
  assert.deepEqual(decideRoute('www.example.org', '/dashboard', SPLIT), { kind: 'withhold' });
  assert.deepEqual(decideRoute('WWW.EXAMPLE.ORG:8443', '/dashboard', SPLIT), { kind: 'withhold' });
});

test('config values accept a full origin as well as a bare host', () => {
  const config = readHostRoutingConfig({
    APP_HOST: 'https://app.example.org/',
    MARKETING_HOST: 'http://localhost:3000',
  });
  assert.equal(resolveHostRole('app.example.org', config), 'app');
  assert.equal(resolveHostRole('localhost:4000', config), 'marketing'); // port never participates in matching
  assert.equal(resolveHostRole('other.example.org', config), 'passthrough');
});

test('normalizeHost edge cases', () => {
  assert.equal(normalizeHost(undefined), null);
  assert.equal(normalizeHost(''), null);
  assert.equal(normalizeHost('   '), null);
  assert.equal(normalizeHost('Example.Org.'), 'example.org');
  assert.equal(normalizeHost('https://www.Example.org:8443/path?q=1'), 'example.org');
  assert.equal(normalizeHost('[::1]:3000'), '[::1]');
  assert.equal(normalizeHost('www.'), null);
});

test('identical APP_HOST and MARKETING_HOST: the app role wins (documented precedence)', () => {
  const config = readHostRoutingConfig({ APP_HOST: 'x.example.org', MARKETING_HOST: 'x.example.org' });
  assert.equal(resolveHostRole('x.example.org', config), 'app');
});

// --- Flag parsing ---------------------------------------------------------------

test('APP_ONLY parsing: 1/true (any case) on; everything else off', () => {
  for (const on of ['1', 'true', 'TRUE', ' True ']) assert.equal(parseBooleanFlag(on), true, on);
  for (const off of [undefined, null, '', '0', 'false', 'yes', 'on', 'app-only']) {
    assert.equal(parseBooleanFlag(off), false, String(off));
  }
});

// --- Path classification ---------------------------------------------------------

test('classifyPath covers every declared prefix and resists prefix collisions', () => {
  assert.equal(classifyPath('/'), 'root');
  for (const p of MARKETING_PATHS) assert.equal(classifyPath(p), 'marketing', p);
  for (const p of APP_PRIVATE_PATHS) assert.equal(classifyPath(p), 'app-private', p);
  assert.equal(classifyPath('/evidence'), 'dual-served');
  assert.equal(classifyPath('/evidence/slug/extra'), 'dual-served');
  assert.equal(classifyPath('/aboutus'), 'other');
  assert.equal(classifyPath('/dashboard-widgets'), 'other');
  assert.equal(classifyPath('/asked'), 'other');
  assert.equal(classifyPath('/auth'), 'other'); // no page lives at /auth itself
  assert.equal(classifyPath('/auth/device/extra'), 'app-private');
});

// --- URL helpers (AppChrome exit link, device-flow pairing origin) ---------------

test('resolvePublicSiteHref: unset topology keeps the relative link', () => {
  assert.equal(resolvePublicSiteHref({}), '/');
});

test('resolvePublicSiteHref: split-host points at the marketing origin', () => {
  assert.equal(resolvePublicSiteHref({ MARKETING_HOST: 'example.org' }), 'https://example.org');
  assert.equal(
    resolvePublicSiteHref({ MARKETING_HOST: 'http://localhost:3000/' }),
    'http://localhost:3000',
  );
});

test('resolvePublicSiteHref: app-only hides the affordance (null)', () => {
  assert.equal(resolvePublicSiteHref({ APP_ONLY: '1', MARKETING_HOST: 'example.org' }), null);
});

test('resolveDashboardHref: relative today and on app-only; app origin on a split host', () => {
  assert.equal(resolveDashboardHref({}), '/dashboard');
  assert.equal(resolveDashboardHref({ APP_ONLY: '1', APP_HOST: 'app.example.org' }), '/dashboard');
  assert.equal(
    resolveDashboardHref({ APP_HOST: 'app.example.org' }),
    'https://app.example.org/dashboard',
  );
  assert.equal(
    resolveDashboardHref({ APP_HOST: 'http://localhost:3000' }),
    'http://localhost:3000/dashboard',
  );
});

test('resolveAskHref: relative today and on app-only; app origin on a split host (#210)', () => {
  // The dual-served /evidence pages render the AppChrome strip on the
  // MARKETING host, where /ask is withheld — hence the origin.
  assert.equal(resolveAskHref({}), '/ask');
  assert.equal(resolveAskHref({ APP_ONLY: '1', APP_HOST: 'app.example.org' }), '/ask');
  assert.equal(resolveAskHref({ APP_HOST: 'app.example.org' }), 'https://app.example.org/ask');
  assert.equal(
    resolveAskHref({ APP_HOST: 'http://localhost:3000' }),
    'http://localhost:3000/ask',
  );
});

test('resolveAppOrigin: null without APP_HOST, https for bare hosts, scheme honored', () => {
  assert.equal(resolveAppOrigin({}), null);
  assert.equal(resolveAppOrigin({ APP_HOST: 'app.example.org' }), 'https://app.example.org');
  assert.equal(resolveAppOrigin({ APP_HOST: 'http://localhost:3000/' }), 'http://localhost:3000');
});

test('originFromHostValue trims and never emits a trailing slash', () => {
  assert.equal(originFromHostValue('  app.example.org  '), 'https://app.example.org');
  assert.equal(originFromHostValue('https://app.example.org///'), 'https://app.example.org');
  assert.equal(originFromHostValue(''), null);
  assert.equal(originFromHostValue(undefined), null);
});


// --- Host canonicalization (#263) -----------------------------------------
//
// THE RULE, stated once: matching is `www.`-insensitive, serving is not.
// When a request's host matches a CONFIGURED host by normalization but
// differs from it in `www.` presence, redirect (307) to the spelling the
// operator configured, carrying the path and query. Never for a host that
// matched nothing, never under APP_ONLY, never for the CORS-sensitive path
// families, and never for a difference that is only case, port or a
// trailing dot — those are one name written differently, and steering on
// them would break ports and loop on localhost.
//
// NOTE ON SCOPE: these tests pin the DECISION. None of them observes an
// HTTP response. The app-layer redirect also ships inert while the hosting
// platform's own domain redirect is enabled.

const WWW_MARKETING = readHostRoutingConfig({
  APP_HOST: 'app.example.org',
  MARKETING_HOST: 'www.example.org', // the inverse: operator configures www
});

test('canonicalize: www → the configured apex, path and query preserved', () => {
  assert.deepEqual(decideRoute('www.example.org', '/about', SPLIT), {
    kind: 'redirect',
    destination: 'https://example.org/about',
  });
  assert.deepEqual(decideRoute('www.example.org', '/explore', SPLIT, '?trace=abc'), {
    kind: 'redirect',
    destination: 'https://example.org/explore?trace=abc',
  });
  // Deep paths and the dual-served evidence surface too.
  assert.deepEqual(decideRoute('www.example.org', '/evidence/some-slug', SPLIT), {
    kind: 'redirect',
    destination: 'https://example.org/evidence/some-slug',
  });
  // And on the app host, toward ITS configured spelling.
  assert.deepEqual(decideRoute('www.app.example.org', '/evidence', SPLIT), {
    kind: 'redirect',
    destination: 'https://app.example.org/evidence',
  });
});

test('canonicalize: a request already on the configured spelling is untouched', () => {
  for (const path of [...MARKETING_SAMPLES, ...DUAL_SAMPLES]) {
    assert.deepEqual(decideRoute('example.org', path, SPLIT), { kind: 'serve' }, path);
  }
  // Case, port and trailing dot are the same name — never a redirect.
  for (const host of ['EXAMPLE.ORG', 'example.org:8443', 'example.org.']) {
    assert.deepEqual(decideRoute(host, '/about', SPLIT), { kind: 'serve' }, host);
  }
});

test('canonicalize: the inverse — an operator who configures www gets apex → www', () => {
  assert.deepEqual(decideRoute('example.org', '/about', WWW_MARKETING), {
    kind: 'redirect',
    destination: 'https://www.example.org/about',
  });
  assert.deepEqual(decideRoute('www.example.org', '/about', WWW_MARKETING), { kind: 'serve' });
});

test('canonicalize: a configured scheme and port are honored, not replaced by https', () => {
  const local = readHostRoutingConfig({ MARKETING_HOST: 'http://www.localhost:3000' });
  assert.deepEqual(decideRoute('localhost:3000', '/about', local), {
    kind: 'redirect',
    destination: 'http://www.localhost:3000/about',
  });
});

test('canonicalize: a bare-host config served on a port does NOT lose the port', () => {
  // The regression the literal-spelling rule would have caused: the config
  // string and the Host header differ, but only in port — not a redirect.
  const config = readHostRoutingConfig({ MARKETING_HOST: 'example.org' });
  assert.deepEqual(decideRoute('example.org:8443', '/about', config), { kind: 'serve' });
});

test('canonicalize: a scheme-carrying config never redirects to itself (no localhost loop)', () => {
  // `http://localhost:3000` never literally equals the `localhost:3000`
  // Host header a browser sends back — a literal-spelling rule would loop.
  const config = readHostRoutingConfig({ MARKETING_HOST: 'http://localhost:3000' });
  for (const host of ['localhost:3000', 'localhost', 'LOCALHOST:3000']) {
    assert.deepEqual(decideRoute(host, '/about', config), { kind: 'serve' }, host);
  }
});

test('canonicalize TERMINATES: the destination host is itself canonical, one hop', () => {
  for (const [host, config] of [
    ['www.example.org', SPLIT],
    ['www.app.example.org', SPLIT],
    ['example.org', WWW_MARKETING],
  ] as const) {
    // /evidence is dual-served, so it SERVES under either role — the point
    // here is the host hop, not the path decision.
    const first = decideRoute(host, '/evidence', config);
    assert.equal(first.kind, 'redirect', host);
    if (first.kind !== 'redirect') return;
    // Feed the redirect target's host back through: it must settle.
    const next = decideRoute(bareHost(first.destination), '/evidence', config);
    assert.deepEqual(next, { kind: 'serve' }, `${host} did not settle in one hop`);
  }
});

test('canonicalize: rule zero — nothing configured, nothing canonicalized', () => {
  for (const host of ['www.example.org', 'example.org', 'www.app.example.org']) {
    for (const path of EVERY_PATH) {
      assert.deepEqual(decideRoute(host, path, UNSET), { kind: 'serve' }, `${host} ${path}`);
    }
  }
});

test('canonicalize: a passthrough host has no configured spelling to steer toward', () => {
  // Preview URLs, IP health checks and unnamed aliases match no variable.
  for (const host of ['www.preview-abc.vercel.app', 'preview-abc.vercel.app', '127.0.0.1:3000']) {
    for (const path of EVERY_PATH) {
      assert.deepEqual(decideRoute(host, path, SPLIT), { kind: 'serve' }, `${host} ${path}`);
    }
  }
});

test('canonicalize: APP_ONLY ignores the host variables, so it canonicalizes nothing', () => {
  const config = readHostRoutingConfig({
    APP_ONLY: '1',
    APP_HOST: 'app.example.org',
    MARKETING_HOST: 'example.org',
  });
  assert.deepEqual(decideRoute('www.app.example.org', '/ask', config), { kind: 'serve' });
  assert.deepEqual(decideRoute('www.example.org', '/evidence', config), { kind: 'serve' });
  // The app-root hop stays a bare path — no host is imposed on it.
  assert.deepEqual(decideRoute('www.app.example.org', '/', config), APP_ROOT_ACTION);
});

test('canonicalize: the CORS-sensitive families are exempt on every host spelling', () => {
  const exempt = [
    '/api/evidence/some-slug/commitment',
    '/api/session-status',
    '/api',
    '/.well-known/typed-publisher.json',
    '/.well-known',
    '/_next/static/chunk.js',
    '/favicon.ico',
    '/robots.txt',
  ];
  for (const path of exempt) {
    for (const host of ['www.example.org', 'www.app.example.org']) {
      assert.deepEqual(decideRoute(host, path, SPLIT), { kind: 'serve' }, `${host} ${path}`);
    }
    assert.equal(canonicalHostRedirect('www.example.org', path, SPLIT), null, path);
  }
  // And the inverse configuration must not redirect them either.
  assert.deepEqual(
    decideRoute('example.org', '/api/evidence/x/commitment', WWW_MARKETING),
    { kind: 'serve' },
  );
});

test('the exemption list mirrors the proxy matcher exclusions', () => {
  // If this drifts, #263 can come back through the other file. The matcher
  // in src/proxy.ts excludes exactly: api/, _next/, .well-known/,
  // favicon.ico, robots.txt.
  assert.deepEqual([...CANONICALIZATION_EXEMPT_PREFIXES], ['/api', '/_next', '/.well-known']);
  for (const p of ['/api', '/api/x', '/_next/x', '/.well-known/x', '/favicon.ico', '/robots.txt']) {
    assert.equal(isCanonicalizationExempt(p), true, p);
  }
  // Prefix-collision guards: these are pages, not exempt families.
  for (const p of ['/apiary', '/about', '/', '/robots.txt.bak', '/_nextish']) {
    assert.equal(isCanonicalizationExempt(p), false, p);
  }
});

test('canonicalize vs APP_ROOT_ACTION: ONE redirect to the canonical host + /ask', () => {
  // The precedence the contract asked to be pinned: composed, not stacked.
  assert.deepEqual(decideRoute('www.app.example.org', '/', SPLIT), {
    kind: 'redirect',
    destination: 'https://app.example.org/ask',
  });
  // The destination is served on the canonical host — so it settles.
  assert.deepEqual(decideRoute('app.example.org', '/ask', SPLIT), { kind: 'serve' });
  // On the canonical spelling the app root hop is unchanged (relative).
  assert.deepEqual(decideRoute('app.example.org', '/', SPLIT), APP_ROOT_ACTION);
  // The marketing host's root is a page, so it canonicalizes as a page.
  assert.deepEqual(decideRoute('www.example.org', '/', SPLIT), {
    kind: 'redirect',
    destination: 'https://example.org/',
  });
});

test('canonicalize: withholding wins — a withheld route 404s on the spelling asked', () => {
  // Not a redirect-then-404: the status must not depend on the spelling.
  for (const path of APP_PRIVATE_SAMPLES) {
    assert.deepEqual(decideRoute('www.example.org', path, SPLIT), { kind: 'withhold' }, path);
    assert.deepEqual(decideRoute('example.org', path, SPLIT), { kind: 'withhold' }, path);
  }
  for (const path of MARKETING_SAMPLES) {
    assert.deepEqual(decideRoute('www.app.example.org', path, SPLIT), { kind: 'withhold' }, path);
    assert.deepEqual(decideRoute('app.example.org', path, SPLIT), { kind: 'withhold' }, path);
  }
});

test('bareHost keeps www. and drops everything normalizeHost drops besides it', () => {
  assert.equal(bareHost('https://www.Example.org:8443/path?q=1'), 'www.example.org');
  assert.equal(bareHost('Example.Org.'), 'example.org');
  assert.equal(bareHost('[::1]:3000'), '[::1]');
  assert.equal(bareHost(''), null);
  assert.equal(bareHost(undefined), null);
  // The one dimension the two functions disagree on — and only that one.
  for (const h of ['example.org', 'EXAMPLE.ORG:443', 'https://example.org/x', 'example.org.']) {
    assert.equal(bareHost(h), normalizeHost(h), h);
  }
  assert.notEqual(bareHost('www.example.org'), normalizeHost('www.example.org'));
});

test('canonicalHostRedirect: null when there is nothing to canonicalize', () => {
  assert.equal(canonicalHostRedirect(null, '/about', SPLIT), null);
  assert.equal(canonicalHostRedirect(undefined, '/about', SPLIT), null);
  assert.equal(canonicalHostRedirect('www.example.org', '/about', UNSET), null);
  assert.equal(canonicalHostRedirect('unknown.example.net', '/about', SPLIT), null);
  assert.equal(
    canonicalHostRedirect('www.example.org', '/about', SPLIT),
    'https://example.org/about',
  );
});

test('canonicalize: APP_HOST precedence is the same one resolveHostRole uses', () => {
  // Both variables spelled the same host: the app role wins, so the app
  // spelling is the one canonicalized toward — never a cross-role steer.
  const config = readHostRoutingConfig({
    APP_HOST: 'www.x.example.org',
    MARKETING_HOST: 'x.example.org',
  });
  assert.equal(resolveHostRole('x.example.org', config), 'app');
  assert.deepEqual(decideRoute('x.example.org', '/evidence', config), {
    kind: 'redirect',
    destination: 'https://www.x.example.org/evidence',
  });
});
