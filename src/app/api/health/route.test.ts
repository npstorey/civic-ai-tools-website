// RED INSTRUMENT for Wave N12 phase W1 (#443), anchor #470.
//
// Three assertions, all failing at `0249928`, each able to fail again later for
// the reason it was written:
//
//   1. the app service's compose healthcheck probes the health route, not a
//      route named for signing;
//   2. the root-level path is exempt from host canonicalization;
//   3. the root-level path is outside the proxy matcher.
//
// (2) and (3) are the seat's rider on W1: `/api/health` inherits both properties
// from the `/api` prefix, so only the ROOT path needs its own assertion — and
// today it has neither property, which is exactly why the route cannot be served
// there yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isCanonicalizationExempt } from '../../../lib/host-routing.ts';

const HEALTH_PATHS = ['/api/health', '/health'] as const;

const composeText = readFileSync(new URL('../../../../docker-compose.yml', import.meta.url), 'utf8');
const proxyText = readFileSync(new URL('../../../proxy.ts', import.meta.url), 'utf8');

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

test('the app service healthcheck probes the health route', () => {
  const block = healthcheckBlock(composeText, 'app');
  const probed = block.match(/http:\/\/127\.0\.0\.1:\d+(\/[^'")\s]*)/);
  assert.notEqual(probed, null, 'the app healthcheck probes no http URL this test can read');
  assert.ok(
    HEALTH_PATHS.includes(probed![1] as (typeof HEALTH_PATHS)[number]),
    `the app healthcheck probes ${probed![1]}; it must probe one of ${HEALTH_PATHS.join(' or ')} ` +
      '— a platform is pointed at the health route, and a route named for something else is not it',
  );
});

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
