// Tests for the host-topology decision logic (app front-door v0.1.0, P3;
// portable default flipped in #259 P3).
//
// THE CORE PROPERTY CHANGED, and this file is where the change is pinned.
// It used to be "with none of APP_HOST / MARKETING_HOST / APP_ONLY set,
// every (host, path) pair resolves to `serve`". The portable default is now
// APP-ONLY: an instance that configures nothing withholds the marketing
// routes and hops `/` to `/ask`, because the marketing face is the
// reference deployment's own website rather than part of what an instance
// ships. The former default did not disappear — it is `SERVE_MARKETING=1`,
// and both halves are pinned side by side below.
//
// The full matrix (two-host split × every route class, app-only × every
// route class, UNNAMED hosts in both knob states, partial configuration,
// and the canonicalization non-interaction) is pinned below.
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
  instanceServesMarketing,
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
/** Nothing configured — the PORTABLE DEFAULT, app-only since #259 P3. */
const UNSET = readHostRoutingConfig({});
/** Nothing configured but the knob: the pre-#259 pass-through default. */
const SERVE_MARKETING = readHostRoutingConfig({ SERVE_MARKETING: '1' });
/** A split-host instance that also keeps unnamed hosts (previews) passing through. */
const SPLIT_SERVING = readHostRoutingConfig({
  APP_HOST: 'app.example.org',
  MARKETING_HOST: 'example.org',
  SERVE_MARKETING: '1',
});

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

// --- THE PORTABLE DEFAULT and the knob that restores the old one -------------

// Every host an unconfigured instance can be addressed on, including the
// degenerate no-Host-header case, which takes the same branch on purpose.
const UNNAMED_HOSTS = [
  'example.org',
  'app.example.org',
  'localhost:3000',
  'preview-abc.vercel.app',
  '127.0.0.1:3000',
  null,
];

test('portable default: nothing configured serves the app surface only', () => {
  for (const host of UNNAMED_HOSTS) {
    // The marketing face is withheld — this is the flip, and the whole
    // reason instances need no deletion script to not ship it.
    for (const path of MARKETING_SAMPLES) {
      assert.deepEqual(decideRoute(host, path, UNSET), { kind: 'withhold' }, `${host} ${path}`);
    }
    // The app front door hops to the query mount...
    assert.deepEqual(decideRoute(host, ROOT, UNSET), APP_ROOT_ACTION, String(host));
    // ...and everything the app surface owns still serves.
    for (const path of [...APP_PRIVATE_SAMPLES, ...DUAL_SAMPLES, ...OTHER_SAMPLES]) {
      assert.deepEqual(decideRoute(host, path, UNSET), { kind: 'serve' }, `${host} ${path}`);
    }
  }
});

test('portable default and APP_ONLY agree on every (host, path) pair', () => {
  // APP_ONLY stays honored as the EXPLICIT form (it is the only way to say
  // "app-only even though a marketing host is named"), and where both apply
  // they must not disagree — two spellings of one behavior, not two
  // behaviors. Redundancy here is the property, not an accident.
  for (const host of UNNAMED_HOSTS) {
    for (const path of EVERY_PATH) {
      assert.deepEqual(
        decideRoute(host, path, UNSET),
        decideRoute(host, path, APP_ONLY),
        `${host} ${path}`,
      );
    }
  }
});

test('SERVE_MARKETING=1 restores the pre-#259 universal pass-through', () => {
  for (const host of UNNAMED_HOSTS) {
    for (const path of EVERY_PATH) {
      assert.deepEqual(
        decideRoute(host, path, SERVE_MARKETING),
        { kind: 'serve' },
        `SERVE_MARKETING must serve ${path} on host ${host}`,
      );
    }
  }
});

test('the knob is a boolean parsed exactly like APP_ONLY — nothing else turns it on', () => {
  for (const on of ['1', 'true', 'TRUE', ' True ']) {
    assert.equal(readHostRoutingConfig({ SERVE_MARKETING: on }).serveMarketing, true, on);
    assert.equal(resolveHostRole('anything.example.net', readHostRoutingConfig({ SERVE_MARKETING: on })), 'passthrough', on);
  }
  for (const off of [undefined, '', '0', 'false', 'yes', 'on', 'marketing']) {
    const config = readHostRoutingConfig({ SERVE_MARKETING: off });
    assert.equal(config.serveMarketing, false, String(off));
    assert.equal(resolveHostRole('anything.example.net', config), 'app', String(off));
  }
});

test('APP_ONLY beats SERVE_MARKETING: the explicit form wins over the unnamed-host default', () => {
  const config = readHostRoutingConfig({ APP_ONLY: '1', SERVE_MARKETING: '1' });
  assert.equal(resolveHostRole('anything.example.net', config), 'app');
  assert.deepEqual(decideRoute('anything.example.net', '/about', config), { kind: 'withhold' });
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
  // ...and it serves on every host under BOTH portable defaults: it is
  // app-private, so the app role serves it, and `passthrough` serves
  // everything. There is no instance shape on which the app front door's
  // own destination fails to resolve.
  for (const host of ['example.org', 'app.example.org', 'localhost:3000']) {
    assert.deepEqual(decideRoute(host, '/ask', UNSET), { kind: 'serve' }, host);
    assert.deepEqual(decideRoute(host, '/ask', SERVE_MARKETING), { kind: 'serve' }, host);
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

const UNMATCHED = ['preview-abc.vercel.app', '127.0.0.1:3000', 'staging.example.net'];

test('split: an unmatched host takes the app role, named hosts unaffected', () => {
  // #259 P3. A host the operator never named is not a marketing host, so on
  // a split-host instance WITHOUT the knob it now behaves as the app
  // surface. This is the flip's one visible effect on a configured
  // deployment — and it is confined to hosts the configuration does not
  // mention, which is exactly the blast radius the knob was shaped for.
  for (const host of UNMATCHED) {
    for (const path of MARKETING_SAMPLES) {
      assert.deepEqual(decideRoute(host, path, SPLIT), { kind: 'withhold' }, `${host} ${path}`);
    }
    assert.deepEqual(decideRoute(host, ROOT, SPLIT), APP_ROOT_ACTION, host);
  }
});

test('split + SERVE_MARKETING: unmatched hosts are untouched, named hosts still split', () => {
  // The reference deployment's shape: preview URLs match neither variable
  // and cannot be made to (they are minted per deployment), so the knob is
  // the only thing that keeps them serving both route groups.
  for (const host of UNMATCHED) {
    for (const path of EVERY_PATH) {
      assert.deepEqual(decideRoute(host, path, SPLIT_SERVING), { kind: 'serve' }, `${host} ${path}`);
    }
  }
  // ...while the NAMED hosts behave identically with and without the knob.
  for (const host of ['app.example.org', 'example.org', 'www.example.org']) {
    for (const path of EVERY_PATH) {
      assert.deepEqual(
        decideRoute(host, path, SPLIT_SERVING),
        decideRoute(host, path, SPLIT),
        `${host} ${path}`,
      );
    }
  }
});

test('a missing Host header takes the unnamed-host branch, in both knob states', () => {
  // Maximally unnamed: it matched nothing, so it gets whatever an unnamed
  // host gets. Splitting it out would leave the withholding with a hole
  // that depends on whether a client sent a header HTTP/1.1 requires.
  assert.deepEqual(decideRoute(null, '/dashboard', SPLIT), { kind: 'serve' }); // app role serves it
  assert.deepEqual(decideRoute(null, '/about', SPLIT), { kind: 'withhold' });
  assert.deepEqual(decideRoute(undefined, '/', SPLIT), APP_ROOT_ACTION);
  assert.equal(resolveHostRole(null, SPLIT), 'app');
  assert.equal(resolveHostRole(undefined, SPLIT_SERVING), 'passthrough');
  assert.deepEqual(decideRoute(null, '/about', SPLIT_SERVING), { kind: 'serve' });
});

// --- Partial configuration ----------------------------------------------------

test('APP_HOST alone: app role on that host, and on every unnamed host too', () => {
  const config = readHostRoutingConfig({ APP_HOST: 'app.example.org' });
  // The app host takes its role...
  assert.deepEqual(decideRoute('app.example.org', '/about', config), { kind: 'withhold' });
  assert.deepEqual(decideRoute('app.example.org', '/', config), APP_ROOT_ACTION);
  // ...and since #259 P3 so does every host the operator has not named,
  // because naming NO marketing host is now a statement rather than a gap.
  for (const path of MARKETING_SAMPLES) {
    assert.deepEqual(decideRoute('example.org', path, config), { kind: 'withhold' }, path);
  }
});

test('APP_HOST alone + SERVE_MARKETING: the incremental-rollout stage, unnamed hosts intact', () => {
  // The rollout sequence gained a step at the front: set SERVE_MARKETING
  // FIRST, then APP_HOST, then MARKETING_HOST. This pins the middle stage —
  // the app host verifiable in isolation while the apex still serves
  // everything, which is what made the old sequence safe.
  const config = readHostRoutingConfig({ APP_HOST: 'app.example.org', SERVE_MARKETING: '1' });
  assert.deepEqual(decideRoute('app.example.org', '/about', config), { kind: 'withhold' });
  for (const path of EVERY_PATH) {
    assert.deepEqual(decideRoute('example.org', path, config), { kind: 'serve' }, path);
  }
});

test('MARKETING_HOST alone: withholding on that host, unnamed hosts take the app role', () => {
  const config = readHostRoutingConfig({ MARKETING_HOST: 'example.org' });
  assert.deepEqual(decideRoute('example.org', '/dashboard', config), { kind: 'withhold' });
  assert.deepEqual(decideRoute('example.org', '/', config), { kind: 'serve' });
  // The named marketing host still serves the marketing face; an unnamed
  // host no longer does.
  assert.deepEqual(decideRoute('example.org', '/about', config), { kind: 'serve' });
  assert.deepEqual(decideRoute('app.example.org', '/about', config), { kind: 'withhold' });
  assert.deepEqual(decideRoute('app.example.org', '/dashboard', config), { kind: 'serve' });
});

test('MARKETING_HOST alone + SERVE_MARKETING: unnamed hosts untouched', () => {
  const config = readHostRoutingConfig({ MARKETING_HOST: 'example.org', SERVE_MARKETING: '1' });
  assert.deepEqual(decideRoute('example.org', '/dashboard', config), { kind: 'withhold' });
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
  const origins = {
    APP_HOST: 'https://app.example.org/',
    MARKETING_HOST: 'http://localhost:3000',
  };
  const config = readHostRoutingConfig(origins);
  assert.equal(resolveHostRole('app.example.org', config), 'app');
  assert.equal(resolveHostRole('localhost:4000', config), 'marketing'); // port never participates in matching
  assert.equal(resolveHostRole('other.example.org', config), 'app'); // unnamed → the portable default
  assert.equal(
    resolveHostRole('other.example.org', readHostRoutingConfig({ ...origins, SERVE_MARKETING: '1' })),
    'passthrough',
  );
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

// --- instanceServesMarketing: the predicate the chrome branches on -----------

test('instanceServesMarketing mirrors resolveHostRole row for row', () => {
  // Explicit app-only: no, whatever else is set.
  assert.equal(instanceServesMarketing({ APP_ONLY: '1' }), false);
  assert.equal(instanceServesMarketing({ APP_ONLY: '1', MARKETING_HOST: 'example.org' }), false);
  assert.equal(instanceServesMarketing({ APP_ONLY: '1', SERVE_MARKETING: '1' }), false);
  // A NAMED marketing host serves marketing, on that host — true on both
  // hosts of a split instance, because the hrefs it gates are absolute.
  assert.equal(instanceServesMarketing({ MARKETING_HOST: 'example.org' }), true);
  assert.equal(
    instanceServesMarketing({ APP_HOST: 'app.example.org', MARKETING_HOST: 'example.org' }),
    true,
  );
  // No marketing host named: the unnamed-host default decides.
  assert.equal(instanceServesMarketing({ SERVE_MARKETING: '1' }), true);
  assert.equal(instanceServesMarketing({ APP_HOST: 'app.example.org', SERVE_MARKETING: '1' }), true);
  assert.equal(instanceServesMarketing({}), false); // ← the flip
  assert.equal(instanceServesMarketing({ APP_HOST: 'app.example.org' }), false);
  // Empty/whitespace values are unset, exactly as everywhere else here.
  assert.equal(instanceServesMarketing({ MARKETING_HOST: '   ', SERVE_MARKETING: '' }), false);
});

test('instanceServesMarketing agrees with what decideRoute actually serves', () => {
  // The predicate must not become a second, drifting reading of the
  // topology: whenever it says a marketing surface exists, SOME host must
  // actually serve a marketing path, and when it says none does, none may.
  const cases: Array<[Record<string, string | undefined>, string[]]> = [
    [{}, ['example.org', 'app.example.org', 'anything.example.net']],
    [{ SERVE_MARKETING: '1' }, ['example.org', 'anything.example.net']],
    [{ APP_ONLY: '1' }, ['example.org', 'anything.example.net']],
    [{ APP_HOST: 'app.example.org' }, ['app.example.org', 'other.example.net']],
    [{ APP_HOST: 'app.example.org', MARKETING_HOST: 'example.org' }, ['example.org', 'app.example.org']],
  ];
  for (const [env, hosts] of cases) {
    const config = readHostRoutingConfig(env);
    const anyHostServesMarketing = hosts.some(
      (h) => decideRoute(h, '/about', config).kind === 'serve',
    );
    assert.equal(
      instanceServesMarketing(env),
      anyHostServesMarketing,
      `predicate disagrees with routing for ${JSON.stringify(env)}`,
    );
  }
});

// --- Chrome affordances -------------------------------------------------------

test('resolvePublicSiteHref: nothing configured now HIDES the exit link (#259 P3)', () => {
  // It used to return '/', and after the flip '/' is the path that redirects
  // to /ask — so the "Public site" exit out of the app would have led back
  // into the app, past no error, to no public site. AppChrome guards on
  // this exact null.
  assert.equal(resolvePublicSiteHref({}), null);
  assert.equal(resolvePublicSiteHref({ APP_HOST: 'app.example.org' }), null);
});

test('resolvePublicSiteHref: SERVE_MARKETING keeps the relative link', () => {
  assert.equal(resolvePublicSiteHref({ SERVE_MARKETING: '1' }), '/');
  assert.equal(resolvePublicSiteHref({ APP_HOST: 'app.example.org', SERVE_MARKETING: '1' }), '/');
});

test('resolvePublicSiteHref never points at a path the same config withholds or hops', () => {
  // The property the '/' regression violated, stated directly: whatever
  // this returns as a RELATIVE path must `serve` on every host that config
  // can produce. An absolute origin is out of scope — it names another host.
  for (const env of [{}, { SERVE_MARKETING: '1' }, { APP_ONLY: '1' }, { APP_HOST: 'app.example.org' }]) {
    const href = resolvePublicSiteHref(env);
    if (href === null || href.startsWith('http')) continue;
    const config = readHostRoutingConfig(env);
    for (const host of ['example.org', 'app.example.org', 'anything.example.net']) {
      assert.deepEqual(
        decideRoute(host, href, config),
        { kind: 'serve' },
        `${JSON.stringify(env)} → ${href} does not serve on ${host}`,
      );
    }
  }
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
  // ...and the explicit form still beats the knob.
  assert.equal(resolvePublicSiteHref({ APP_ONLY: '1', SERVE_MARKETING: '1' }), null);
});

test('the app-private hrefs are UNCHANGED by the flip (audited, not assumed)', () => {
  // Both name app-private paths, and the flip gives an unnamed host the role
  // that SERVES app-private paths — so the relative fallbacks were already
  // right. Pinned so a future edit cannot quietly move them onto the
  // marketing predicate, which would be wrong for a different reason.
  for (const env of [{}, { SERVE_MARKETING: '1' }, { APP_ONLY: '1' }]) {
    const config = readHostRoutingConfig(env);
    for (const href of [resolveDashboardHref(env), resolveAskHref(env)]) {
      assert.ok(!href.startsWith('http'), `${JSON.stringify(env)} → ${href} should stay relative`);
      for (const host of ['example.org', 'anything.example.net']) {
        assert.deepEqual(
          decideRoute(host, href, config),
          { kind: 'serve' },
          `${JSON.stringify(env)} → ${href} does not serve on ${host}`,
        );
      }
    }
  }
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

test('canonicalize: nothing configured, nothing canonicalized — in either knob state', () => {
  // #259 P3 made this worth stating as its own property rather than folding
  // it into "everything serves". An unnamed host now has a ROLE, so for the
  // first time the canonicalization question is live on one — and the
  // answer must still be "never", because `matchedOrigin` keys on the MATCH
  // and not on the role. The assertion is therefore about the ABSENCE of a
  // host hop, not about the path decision, which legitimately differs.
  for (const config of [UNSET, SERVE_MARKETING]) {
    for (const host of ['www.example.org', 'example.org', 'www.app.example.org', 'WWW.Example.Org']) {
      for (const path of EVERY_PATH) {
        assert.equal(canonicalHostRedirect(host, path, config), null, `${host} ${path}`);
        const action = decideRoute(host, path, config);
        assert.ok(
          action.kind !== 'redirect' || action.destination === '/ask',
          `${host} ${path} must never redirect to another HOST (got ${JSON.stringify(action)})`,
        );
      }
    }
  }
});

test('canonicalize: an unnamed host is never steered, whatever role it takes', () => {
  // Preview URLs, IP health checks and unnamed aliases match no variable, so
  // there is no configured spelling to steer them toward. Under SPLIT they
  // now take the app role (the flip); under SPLIT_SERVING they pass
  // through. Neither is canonicalized, and the `www.` spellings are the
  // point — those are the ones a steer would have moved.
  for (const config of [SPLIT, SPLIT_SERVING]) {
    for (const host of ['www.preview-abc.vercel.app', 'preview-abc.vercel.app', '127.0.0.1:3000']) {
      for (const path of EVERY_PATH) {
        assert.equal(canonicalHostRedirect(host, path, config), null, `${host} ${path}`);
        const action = decideRoute(host, path, config);
        assert.ok(
          action.kind !== 'redirect' || action.destination === '/ask',
          `${host} ${path} must never redirect to another HOST (got ${JSON.stringify(action)})`,
        );
      }
    }
  }
  // ...and under the knob they are untouched entirely, as before.
  for (const path of EVERY_PATH) {
    assert.deepEqual(decideRoute('www.preview-abc.vercel.app', path, SPLIT_SERVING), { kind: 'serve' }, path);
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
