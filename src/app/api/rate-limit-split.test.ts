// Drift guard for the two rate limits (civic-ai-tools-website#30 P4, G0 D6).
//
// THE DEFECT THIS EXISTS TO PREVENT. There are two entirely different limits
// in this app and they both surface as "429" somewhere:
//
//   1. THIS APP's per-day request budget (`src/lib/rate-limit.ts`). The query
//      routes check it before doing any work and answer HTTP 429 themselves.
//      Its kind is `rate_limit` and its copy offers the reader sign-in or
//      tomorrow — advice that only makes sense for their own allowance.
//   2. THE MODEL ENDPOINT limiting this server. It arrives as an SDK `APIError`
//      with `status: 429`, is classified structurally by `classifyModelError`,
//      and its kind is `model_rate_limited`.
//
// Before the split, (2) was reported as (1): every upstream rate limit told a
// reader they had personally exhausted a daily cap they had not touched. That
// matters most under a deployment-routed dialect, where quota is per-model and
// per-region and an upstream 429 is routine.
//
// The unit behavior is pinned in `src/lib/streaming.test.ts` and
// `src/lib/model-client.test.ts`. What is pinned HERE is the thing a unit test
// cannot see: that the routes carrying this app's own limiter still answer with
// this app's own limit, and were not "tidied" onto the new kind because the new
// kind has the word model in it. These files cannot be imported under
// `node --test` (they pull in `next/server`), so they are read as source — the
// same technique as `segment-alias.test.ts`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STREAM_ERROR_KINDS, friendlyStreamError } from '../../lib/streaming.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The routes that enforce THIS app's own per-day budget. */
const APP_LIMITER_ROUTES = [
  'compare/route.ts',
  'compare-stream/route.ts',
  'query-notebook/route.ts',
];

function routeSource(relative: string): string {
  return readFileSync(join(HERE, relative), 'utf8');
}

test('#30 P4: every app-limiter route still answers its own 429, unchanged', () => {
  for (const route of APP_LIMITER_ROUTES) {
    const source = routeSource(route);
    assert.ok(
      source.includes('isRateLimited(rateLimitInfo)'),
      `${route} still guards on this app's own limiter`,
    );
    assert.ok(
      source.includes("error: 'Rate limit exceeded'"),
      `${route} still answers with this app's own message`,
    );
    assert.ok(
      source.includes('status: 429'),
      `${route} still answers HTTP 429 for its own limit`,
    );
  }
});

test('#30 P4: no app-limiter route reports its own limit as the model service’s', () => {
  for (const route of APP_LIMITER_ROUTES) {
    const source = routeSource(route);
    // `compare/route.ts` may name the kind in its catch block, where it is
    // classified from an SDK error — so the check is scoped to the limiter
    // guard itself rather than to the whole file.
    const guardStart = source.indexOf('isRateLimited(rateLimitInfo)');
    assert.ok(guardStart > 0, `${route} has a limiter guard`);
    const guardBlock = source.slice(guardStart, guardStart + 600);
    assert.ok(
      !guardBlock.includes('model_rate_limited'),
      `${route}'s own limiter must not claim the model service refused`,
    );
  }
});

test('#30 P4: the two limits read differently to a reader', () => {
  const ownLimit = friendlyStreamError({ code: 'rate_limit' });
  const upstream = friendlyStreamError({ code: 'model_rate_limited' });
  assert.notEqual(ownLimit, upstream);
  // The reader's own allowance is the only one with an action attached.
  assert.match(ownLimit, /Sign in/);
  assert.doesNotMatch(upstream, /Sign in/);
  // And the upstream copy says explicitly that it is not the reader's limit,
  // which is the whole content of the fix.
  assert.match(upstream, /not your own daily limit/i);
});

test('#30 P4: both kinds exist and neither displaced the other', () => {
  assert.ok(STREAM_ERROR_KINDS.includes('rate_limit'));
  assert.ok(STREAM_ERROR_KINDS.includes('model_rate_limited'));
});
