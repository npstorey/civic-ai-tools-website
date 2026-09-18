// The liveness-probe guard (#443, Wave N12 W1, anchor #470).
//
// WHAT A PLATFORM PROBE NEEDS, AND WHAT EACH TEST HERE HOLDS DOWN.
// A deployment platform probes one fixed path on the container port and
// reads a non-200 — or a redirect it will not follow — as "this instance
// is down". Four independent things have to hold for that to be true, and
// three of them live outside the route file:
//
//   1. the route answers 200 with nothing configured (it must not be a
//      readiness check wearing a liveness name);
//   2. the two addresses are ONE handler, so they cannot drift apart;
//   3. the route imports nothing, asserted over its SOURCE — a runtime
//      200 proves nothing about what a later edit might pull in;
//   4. the root-level address is exempt from host canonicalization and
//      sits outside the proxy matcher, and the compose healthcheck and
//      the deploy doc name the same path.
//
// Tests 1-3 below (the compose probe, the canonicalization exemption, the
// matcher exclusion) were written and driven RED at `0249928`, before any
// of this existed — run 35284537002, check `build / test / lint /
// typecheck`, head b760d139de5990674deddec4d7e54576cfb45aed. They are kept
// verbatim in shape and can each fail again for the reason they were
// written.
//
// `/api/health` gets its exemption and its matcher exclusion from the
// `/api` prefix, which is guarded in `src/lib/host-routing.test.ts`. Only
// the ROOT path needs assertions of its own, so those are separate and
// specific below rather than folded into a loop over both paths.
//
// WHAT THIS FILE CANNOT PROVE. It calls the exported handler directly. It
// does not prove a request to either ADDRESS reaches that handler — this
// repo has no route-handler harness (`npm test` is `node --test` over
// modules that resolve neither the `@/` alias nor Next's request
// plumbing). Handler dispatch is proven by `next build` registering both
// route entries, and authoritatively by CI and the deployment.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isCanonicalizationExempt } from '../../../lib/host-routing.ts';

const HEALTH_PATHS = ['/api/health', '/health'] as const;

const composeText = readFileSync(new URL('../../../../docker-compose.yml', import.meta.url), 'utf8');
const proxyText = readFileSync(new URL('../../../proxy.ts', import.meta.url), 'utf8');
const deployDocText = readFileSync(new URL('../../../../docs/deploy.md', import.meta.url), 'utf8');
const apiRouteSource = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const rootRouteSource = readFileSync(new URL('../../health/route.ts', import.meta.url), 'utf8');

/**
 * Every dependency variable the route must not need, removed from the
 * environment BEFORE either route module is imported (the imports below
 * are dynamic for exactly that reason).
 *
 * This is the criterion's whole point: "returns 200" measured on a
 * machine where `DATABASE_URL` happens to be set is a green that could
 * not have gone red. The families are deleted by prefix, not by a
 * hand-written list of names, so a variable added to one of them later is
 * covered without anyone remembering to add it here.
 */
const UNSET: string[] = [];
for (const name of Object.keys(process.env)) {
  if (
    name === 'DATABASE_URL' ||
    name === 'SOCRATA_MCP_URL' ||
    name.startsWith('BLOB_') ||
    name.startsWith('MODEL_')
  ) {
    delete process.env[name];
    UNSET.push(name);
  }
}

const apiRoute = await import('./route.ts');
const rootRoute = await import('../../health/route.ts');

/**
 * The `healthcheck:` block of one top-level compose service, as raw text.
 *
 * Scoped to the named service on purpose: this file declares three
 * healthchecks (postgres, minio, app), so a whole-file scan would pass on
 * the wrong one and the assertion below could never fail for the right
 * reason.
 */
function healthcheckBlock(text: string, service: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${service}:`);
  assert.notEqual(start, -1, `docker-compose.yml declares no "${service}" service`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^ {2}\S/.test(l));
  const body = end === -1 ? rest : rest.slice(0, end);

  const hcStart = body.findIndex((l) => l === '    healthcheck:');
  assert.notEqual(hcStart, -1, `the "${service}" service declares no healthcheck`);
  const hcRest = body.slice(hcStart + 1);
  const hcEnd = hcRest.findIndex((l) => /^ {4}\S/.test(l));
  return (hcEnd === -1 ? hcRest : hcRest.slice(0, hcEnd)).join('\n');
}

/** The `http://127.0.0.1:<port><path>` the app healthcheck probes. */
function probedUrl(): { port: string; path: string } {
  const block = healthcheckBlock(composeText, 'app');
  const probed = block.match(/http:\/\/127\.0\.0\.1:(\d+)(\/[^'")\s]*)/);
  assert.notEqual(probed, null, 'the app healthcheck probes no http URL this test can read');
  return { port: probed![1], path: probed![2] };
}

/** Source with comments removed, so a specifier named in prose is not read as one. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Every module specifier a file pulls in: static, re-exported, dynamic or required. */
function moduleSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const found = [
    ...code.matchAll(/^\s*(?:import|export)\b[^'";]*?\bfrom\s*'([^']+)'/gm),
    ...code.matchAll(/^\s*import\s*'([^']+)'/gm),
    ...code.matchAll(/\bimport\s*\(\s*'([^']+)'/g),
    ...code.matchAll(/\brequire\s*\(\s*'([^']+)'/g),
  ].map((m) => m[1]);
  return [...new Set(found)].sort();
}

/** `export const dynamic = 'force-dynamic'` → `{ dynamic: "'force-dynamic'" }`. */
function segmentConfig(source: string): Record<string, string> {
  const keys = ['dynamic', 'revalidate', 'runtime', 'fetchCache', 'dynamicParams', 'maxDuration'];
  const found: Record<string, string> = {};
  for (const key of keys) {
    const m = new RegExp(`^export\\s+const\\s+${key}\\s*=\\s*(.+?);`, 'm').exec(source);
    if (m) found[key] = m[1].trim();
  }
  return found;
}

// --- 1. The inherited red: the compose probe names the health route ----------

test('the app service healthcheck probes the health route', () => {
  const { path } = probedUrl();
  assert.ok(
    HEALTH_PATHS.includes(path as (typeof HEALTH_PATHS)[number]),
    `the app healthcheck probes ${path}; it must probe one of ${HEALTH_PATHS.join(' or ')} ` +
      '— a platform is pointed at the health route, and a route named for something else is not it',
  );
});

// --- 2 and 3. The inherited red: the ROOT path's two exemptions --------------
//
// `/api/health` inherits both from the `/api` prefix and is guarded in
// host-routing.test.ts; these two are the root path's own.

test('the root-level health path is exempt from host canonicalization', () => {
  assert.equal(
    isCanonicalizationExempt('/health'),
    true,
    '/health must serve on the host it was addressed on — a platform probe follows no redirect',
  );
});

test('the root-level health path is outside the proxy matcher', () => {
  const matcher = proxyText.match(/matcher:\s*\['([^']+)'\]/);
  assert.notEqual(matcher, null, 'src/proxy.ts declares no single-entry matcher this test can read');
  assert.equal(
    new RegExp(`^${matcher![1]}$`).test('/health'),
    false,
    '/health must not reach the proxy — the matcher is the mechanism that runs in production',
  );
});

// --- 4. 200 with nothing configured ------------------------------------------

test('both addresses answer 200 with every dependency variable unset', async () => {
  // Guard on the instrument itself: if the deletion loop above stopped
  // matching anything, the two assertions below would still pass and would
  // be measuring nothing. `DATABASE_URL` is not required to be set on a
  // developer machine, so the check is on the loop's reachability, not on
  // a specific name — an empty UNSET is reported, not asserted away.
  for (const name of ['DATABASE_URL', 'SOCRATA_MCP_URL', 'BLOB_READ_WRITE_TOKEN', 'MODEL_API_KEY']) {
    assert.equal(
      process.env[name],
      undefined,
      `${name} is still set after the unset loop — this test is not measuring what it claims ` +
        `(unset: ${UNSET.join(', ') || 'nothing'})`,
    );
  }

  for (const [label, mod] of [
    ['/api/health', apiRoute],
    ['/health', rootRoute],
  ] as const) {
    const response = await mod.GET();
    assert.equal(response.status, 200, `${label} answered ${response.status}, not 200`);
    assert.deepEqual(
      await response.json(),
      { status: 'ok' },
      `${label} did not return the documented body; docs/deploy.md promises {"status":"ok"}`,
    );
  }
});

// --- 5. One handler, two addresses -------------------------------------------

test('the two addresses share one function object', () => {
  assert.equal(
    rootRoute.GET,
    apiRoute.GET,
    'src/app/health/route.ts must RE-EXPORT the handler from src/app/api/health/route.ts, ' +
      'not define its own. Two copies of a probe endpoint drift silently: both keep ' +
      'returning 200 until one of them stops, and which address the platform was pointed ' +
      'at decides whether anyone finds out.',
  );
  assert.deepEqual(
    moduleSpecifiers(rootRouteSource),
    ['../api/health/route.ts'],
    'src/app/health/route.ts should pull in its twin and nothing else',
  );
});

test('the two route files declare the same route-segment config', () => {
  // Next reads segment config by parsing each route file's own source, so
  // a re-export binding is invisible to it and the literal has to be
  // repeated. Repetition drifts; this is the guard on it.
  assert.deepEqual(
    segmentConfig(rootRouteSource),
    segmentConfig(apiRouteSource),
    'src/app/health/route.ts must re-declare the same route-segment config literals as ' +
      'src/app/api/health/route.ts. Re-exporting them does not work — Next parses each ' +
      'file separately — and the consequence is one address rendering per request while ' +
      'the other answers a response frozen at build time.',
  );
  assert.equal(
    segmentConfig(apiRouteSource).dynamic,
    "'force-dynamic'",
    'the probe must observe the running process, not a response rendered during next build',
  );
});

// --- 6. The route depends on nothing, read from its source --------------------

test('the health route imports nothing at all', () => {
  assert.deepEqual(
    moduleSpecifiers(apiRouteSource),
    [],
    'src/app/api/health/route.ts must import nothing — not even next/server.\n' +
      '\n' +
      'The contract for this phase said "exactly next/server". That is one import more\n' +
      'than the route needs and one more than `npm test` can resolve: `next` publishes\n' +
      'no `exports` map, so plain ESM cannot resolve the extensionless `next/server`\n' +
      'specifier and the handler above could not be CALLED by a node --test module at\n' +
      'all. `Response.json()` is the Web API that `NextResponse.json()` wraps, and\n' +
      'returning a plain Response from a route handler is the App Router contract, so\n' +
      'the import buys nothing and costs the ability to measure the 200.\n' +
      '\n' +
      'This is asserted over the file SOURCE, not over what a call returns, because a\n' +
      'runtime 200 says nothing about what the module pulled in on the way. A database\n' +
      'client, an object-store client, a model client or an MCP client imported here\n' +
      'turns a liveness probe into a readiness probe by accident: the module-load side\n' +
      'effects run on the probe path, and the container gets killed and restarted for\n' +
      "someone else's outage.\n" +
      '\n' +
      'A readiness check against dependencies is a different route with its own issue\n' +
      '(#443, "Not asked") — it does not belong in this file.',
  );
});

// --- 7. The deploy doc and the compose file cannot disagree -------------------

test('docs/deploy.md names the probe path and port, and compose agrees', () => {
  const docPath = deployDocText.match(/^- \*\*Probe path:\*\* `([^`]+)`/m);
  const docPort = deployDocText.match(/^- \*\*Probe port:\*\* `([^`]+)`/m);
  const docAlternate = deployDocText.match(/^- \*\*Alternate path:\*\* `([^`]+)`/m);
  for (const [label, found] of [
    ['Probe path', docPath],
    ['Probe port', docPort],
    ['Alternate path', docAlternate],
  ] as const) {
    assert.notEqual(
      found,
      null,
      `docs/deploy.md declares no "- **${label}:** \`…\`" line. An operator configures a ` +
        `platform's probe from that document; if the line is gone, the path is undocumented ` +
        `and this test can no longer tell whether it drifted.`,
    );
  }

  const { port, path } = probedUrl();
  assert.equal(
    docPath![1],
    path,
    `docs/deploy.md names ${docPath![1]} as the probe path; docker-compose.yml probes ${path}. ` +
      'One of them is telling an operator to point a platform at the wrong address.',
  );
  assert.equal(
    docPort![1],
    port,
    `docs/deploy.md names port ${docPort![1]}; docker-compose.yml probes port ${port} inside ` +
      'the container.',
  );
  assert.deepEqual(
    [docPath![1], docAlternate![1]].sort(),
    [...HEALTH_PATHS].sort(),
    'the document must name both addresses the app serves, and only those',
  );
});
