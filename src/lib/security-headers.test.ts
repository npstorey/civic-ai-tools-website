// The rule: the site enforces its Content-Security-Policy, and sends a
// Referrer-Policy.
//
// WHAT IS DRIVEN. The site's own configuration, `next.config.ts`: its
// `headers()` is called, as `next build` calls it, under each analytics
// configuration `resolveAnalytics` (`src/lib/analytics-config.ts`) can
// resolve: none, each service, and the prior-era variable. What a built site
// serves is read with `curl -sI` against a build (the phase's acceptance 2),
// not here.
//
// THE EXPECTED POLICY, written out here rather than read from the builder, so
// a change to the builder is seen:
//   img-src 'self' data: https://typedstandards.org, then the analytics
//   service's own image hosts (Google Analytics: the two its CSP guide lists
//   for Analytics without Ads features; Plausible: none); object-src 'none';
//   base-uri 'self'; frame-ancestors 'none'.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

interface HeaderRoute { source: string; headers: { key: string; value: string }[] }
const config = (await import(pathToFileURL(path.join(REPO, 'next.config.ts')).href)).default as { headers?: () => Promise<HeaderRoute[]> };

const NAMES = ['NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID'] as const;
type Env = Partial<Record<(typeof NAMES)[number], string>>;

const BASE_IMG = "img-src 'self' data: https://typedstandards.org";
const REST = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const GOOGLE = 'https://www.googletagmanager.com https://*.google-analytics.com';

/** Each analytics configuration, and the policy it must produce. */
const CASES: [name: string, env: Env, service: string | null, policy: string][] = [
  ['no analytics', {}, null, `${BASE_IMG}; ${REST}`],
  ['Plausible', { NEXT_PUBLIC_ANALYTICS_SERVICE: 'plausible', NEXT_PUBLIC_ANALYTICS_ID: 'pa-fixture' }, 'plausible', `${BASE_IMG}; ${REST}`],
  ['Google Analytics', { NEXT_PUBLIC_ANALYTICS_SERVICE: 'google-analytics', NEXT_PUBLIC_ANALYTICS_ID: 'G-FIXTURE' }, 'google-analytics', `${BASE_IMG} ${GOOGLE}; ${REST}`],
  ['the prior-era Google Analytics variable', { NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-FIXTURE' }, 'google-analytics', `${BASE_IMG} ${GOOGLE}; ${REST}`],
  ['an unknown service', { NEXT_PUBLIC_ANALYTICS_SERVICE: 'fixture-unknown', NEXT_PUBLIC_ANALYTICS_ID: 'x' }, null, `${BASE_IMG}; ${REST}`],
];

async function headersUnder(env: Env): Promise<HeaderRoute[] | null> {
  const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  for (const n of NAMES) delete process.env[n];
  Object.assign(process.env, env);
  try {
    return typeof config.headers === 'function' ? await config.headers() : null;
  } finally {
    for (const n of NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
}

/** The headers every page carries: the route that matches every path. */
function everyPath(routes: HeaderRoute[] | null): Map<string, string> {
  assert.ok(routes !== null, 'next.config.ts has no headers()');
  const all = routes.filter((r) => r.source === '/:path*');
  assert.equal(all.length, 1, `not one route over every path: ${JSON.stringify(routes)}`);
  return new Map(all[0].headers.map((h) => [h.key.toLowerCase(), h.value]));
}

for (const [name, env, , policy] of CASES) {
  test(`the site enforces its Content-Security-Policy, and sends a Referrer-Policy: ${name}`, async () => {
    const headers = everyPath(await headersUnder(env));
    assert.equal(headers.get('content-security-policy'), policy, 'the policy is not enforced');
    assert.equal(headers.get('content-security-policy-report-only'), undefined, 'a report-only policy is still sent');
    assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  });
}

test("the policy's analytics part follows resolveAnalytics, for every service it can resolve", async () => {
  const resolver = await import(pathToFileURL(path.join(HERE, 'analytics-config.ts')).href).catch(() => null) as
    | { ANALYTICS_SERVICES: readonly string[]; resolveAnalytics: (env: Env) => { service: string } | null }
    | null;
  assert.ok(resolver !== null, 'the resolver is not importable from a module next.config.ts can load');
  for (const [name, env, service] of CASES) {
    assert.equal(resolver.resolveAnalytics(env)?.service ?? null, service, `premise: ${name} resolves as the case says`);
  }
  const covered = new Set(CASES.map(([, , service]) => service).filter((s): s is string => s !== null));
  assert.deepEqual([...resolver.ANALYTICS_SERVICES].filter((s) => !covered.has(s)), [], 'a service has no case here');
});
