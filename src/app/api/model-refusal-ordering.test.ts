// Where a query route refuses, and what it refuses with
// (civic-ai-tools-website#30 P6, cold-read findings F1 and F3).
//
// TWO DEFECTS, ONE SHAPE. Both were failures of ORDER and of ATTRIBUTION on
// the three routes that run a query:
//
//   F1 — `/api/compare` and `/api/compare-stream` resolved a caller's model id
//        TOLERANTLY: an id the catalog did not describe was carried through on
//        both sides of the wire/identity pair. That was justified on the
//        premise that these routes record no identity. False for
//        `/api/compare-stream`, which writes `analysis.model` onto the root
//        span and `gen_ai.request.model` onto every inference span — and the
//        publish dialog carries that trace into a signed package. A
//        caller-supplied deployment alias therefore became its own "declared
//        identity" and was signed. The byte-level half of this proof lives in
//        `src/lib/model-identity.test.ts`; what is pinned HERE is that the
//        routes take the strict path at all, and take it early.
//
//   F3 — `/api/query-notebook` never called `getMissingModelCredentialError()`,
//        so a typed `ModelConfigurationError` naming (say) MODEL_API_VERSION
//        was raised deep in the pipeline, classified to `model_not_configured`
//        and rendered as that kind's copy: "no AI model API key configured …
//        set MODEL_API_KEY". With a valid key present, that copy is false and
//        points at the wrong variable. It also spent a reader's daily
//        allowance to say it, because `incrementRateLimit` ran first.
//
// WHY THE ROUTES ARE READ AS SOURCE. They import `next/server`, `next-auth`
// and `next/headers`, none of which loads under `node --test` — the same
// constraint `rate-limit-split.test.ts` and `segment-alias.test.ts` work
// under, and the same technique. Ordering is therefore asserted as the
// relative position of the calls in the file, which is exactly what "before
// any upstream call" means for a straight-line request handler. The BEHAVIOR
// each ordering protects is asserted dynamically below and in the two library
// suites, so neither half stands alone.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  _resetDefaultModelClientForTests,
  getMissingModelCredentialError,
} from '../../lib/model-client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The three routes that run a query against the model endpoint. */
const QUERY_ROUTES = ['compare/route.ts', 'compare-stream/route.ts', 'query-notebook/route.ts'];

/** The two routes F1 is about. */
const COMPARE_ROUTES = ['compare/route.ts', 'compare-stream/route.ts'];

function routeSource(relative: string): string {
  return readFileSync(join(HERE, relative), 'utf8');
}

/** Position of a call in the file, asserted to exist. */
function at(source: string, needle: string, route: string): number {
  const index = source.indexOf(needle);
  assert.ok(index > 0, `${route} should contain ${needle}`);
  return index;
}

// --- F1: the compare routes refuse an unoffered id -------------------------

test('#30 P6 F1: both compare routes resolve a caller id strictly', () => {
  for (const route of COMPARE_ROUTES) {
    const source = routeSource(route);
    assert.ok(
      source.includes('resolveModelIdentity(modelId)'),
      `${route} resolves the caller's id against the catalog`,
    );
    // The tolerant helper is what carried an unknown id through. It has other,
    // legitimate callers (POST /api/records, the evaluation preview) — but not
    // these two, and a reintroduction here is the regression.
    assert.ok(
      !source.includes('modelIdentityForValue'),
      `${route} must not carry an unresolved id through`,
    );
  }
});

test('#30 P6 F1: the refusal is the existing one — 400 for the caller, 503 for the operator', () => {
  for (const route of COMPARE_ROUTES) {
    const source = routeSource(route);
    // Reused, not minted: the same typed error and the same two statuses the
    // notebook route has raised since P2. No new reader copy was written for
    // this, which is deliberate — the message already names the ids on offer.
    assert.ok(
      source.includes('error instanceof ModelNotOfferedError'),
      `${route} handles the typed not-offered refusal`,
    );
    assert.ok(
      source.includes('error instanceof ModelConfigurationError'),
      `${route} keeps an unreadable catalog separate from a bad request`,
    );
    const notOffered = at(source, 'ModelNotOfferedError', route);
    const status400 = source.indexOf('400', notOffered);
    const status503 = source.indexOf('503', notOffered);
    assert.ok(status400 > 0 && status503 > status400, `${route} answers 400 then 503`);
  }
});

test('#30 P6 F1: the refusal precedes every upstream call and the rate limiter', () => {
  for (const route of COMPARE_ROUTES) {
    const source = routeSource(route);
    const resolve = at(source, 'resolveModelIdentity(modelId)', route);

    // `buildSystemPrompt` fetches skill guidance over the network: the first
    // thing a request spends. `/api/compare` used to resolve the model AFTER
    // it, and after the rate limiter too.
    assert.ok(
      resolve < at(source, 'buildSystemPrompt(portal)', route),
      `${route} refuses before the skill fetch`,
    );
    // Nothing may be charged to a reader for a request that was never going to
    // run. Same rule F3 restates for the notebook route.
    assert.ok(
      resolve < at(source, 'incrementRateLimit(', route),
      `${route} refuses before spending the reader's daily allowance`,
    );
  }
});

// --- F3: the notebook route names the variable that is missing -------------

test('#30 P6 F3: /api/query-notebook uses the shared endpoint guard, up front', () => {
  const source = routeSource('query-notebook/route.ts');
  assert.ok(
    source.includes('getMissingModelCredentialError()'),
    'the notebook route calls the same guard the compare routes do',
  );
  const guard = at(source, 'getMissingModelCredentialError()', 'query-notebook');

  // Ahead of the catalog read: an endpoint that cannot be described is the
  // more fundamental failure, and a catalog refusal raised first would send
  // the operator after the wrong variable again.
  assert.ok(
    guard < at(source, 'resolveModel(body.model)', 'query-notebook'),
    'the endpoint guard precedes the catalog read',
  );
  // …and ahead of the limiter, which is the second half of the finding.
  assert.ok(
    guard < at(source, 'incrementRateLimit(', 'query-notebook'),
    'a misconfigured instance must not burn a reader’s allowance to fail',
  );
});

test('#30 P6 F3: the guard reports the variable actually missing, not the key', () => {
  // The exact configuration the cold read measured: a VALID key, the Azure
  // dialect selected, and MODEL_API_VERSION absent. Before the fix the
  // operator was told "no AI model API key configured … set MODEL_API_KEY".
  const saved = {
    MODEL_API_KEY: process.env.MODEL_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    MODEL_API_KIND: process.env.MODEL_API_KIND,
    MODEL_API_BASE_URL: process.env.MODEL_API_BASE_URL,
    MODEL_API_VERSION: process.env.MODEL_API_VERSION,
    MODEL_API_AUTH: process.env.MODEL_API_AUTH,
  };
  try {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.MODEL_API_VERSION;
    delete process.env.MODEL_API_AUTH;
    process.env.MODEL_API_KEY = 'obviously-fake-key-for-tests-do-not-use';
    process.env.MODEL_API_KIND = 'azure-openai';
    process.env.MODEL_API_BASE_URL = 'https://example-resource.example.net';
    _resetDefaultModelClientForTests();

    const error = getMissingModelCredentialError();
    assert.ok(error, 'a missing api-version is a refusal');
    assert.match(error!.message, /MODEL_API_VERSION/);
    assert.doesNotMatch(
      error!.message,
      /No model API key is configured/,
      'the key is present; saying otherwise sends the operator the wrong way',
    );
    // The kind is unchanged — `model_not_configured` still classifies it. What
    // changed is that the TYPED message reaches the operator instead of being
    // replaced by the kind's generic copy, which is why the route returns
    // `error.message` rather than a classified payload.
    assert.equal(error!.code, 'model_not_configured');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetDefaultModelClientForTests();
  }
});

// --- The UI half of F1: what the clients actually send (#314) --------------
//
// F1's acceptance says the UI path still works "because the selector offers
// only /api/models ids". Measured, that was true of `QueryForm` and false of
// `/explore`: `McpFlowDiagram` had no selector at all, just a module constant
// — `anthropic/claude-sonnet-4`, an id that lives in HISTORICAL_MODELS and is
// deliberately never resolvable. Tolerant resolution was the only reason the
// page worked; making the routes strict without this would have turned
// /explore's headline feature into a 400 on every instance.

test('#30 P6 F1 / #314: no query client names a model id in its own source', () => {
  // website#30 P7 extracted /explore's fetch+parse into a plain module
  // (`offered-model.ts`) so its retry/caching policy is unit-testable by
  // node:test — McpFlowDiagram.tsx is JSX, which the test runner's
  // `--experimental-strip-types` cannot parse. So /explore's "client" for
  // this check is McpFlowDiagram.tsx plus the module it delegates to;
  // QueryForm still does its own fetch inline.
  const clients = [
    [
      ['../../components/explore/McpFlowDiagram.tsx', '../../lib/offered-model.ts'],
      '/explore’s live query',
    ],
    [
      ['../../components/QueryForm.tsx'],
      'the home/ask query form',
    ],
  ] as const;
  for (const [relatives, what] of clients) {
    const sources = relatives.map((relative) => readFileSync(join(HERE, relative), 'utf8'));
    const combined = sources.join('\n');
    // Read from the instance, not asserted here.
    assert.ok(combined.includes("'/api/models'"), `${what} reads the offered list`);
    assert.ok(combined.includes('parseModelsResponse'), `${what} uses the shared parser`);
    // A model id sent on the wire may not be a literal in a client. Comment
    // prose naming an id is fine and these files have some; what must not
    // appear is a literal in code, so the check is scoped to lines that are
    // not comments.
    const codeLines = combined
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
    for (const line of codeLines) {
      assert.ok(
        !/'(anthropic|openai|google)\/[a-z0-9.\-]+'/.test(line),
        `${what} must not name a model id in code: ${line.trim()}`,
      );
    }
  }
});

// --- Both findings, stated as one standing rule ---------------------------

test('#30 P6: no query route reaches the model before it has refused what it can', () => {
  for (const route of QUERY_ROUTES) {
    const source = routeSource(route);
    // Every one of the three checks the endpoint configuration up front. This
    // is the property that was asserted of all three at the P4 gate and was
    // true of only two.
    assert.ok(
      source.includes('getMissingModelCredentialError()'),
      `${route} checks the endpoint before running a query`,
    );
    assert.ok(
      at(source, 'getMissingModelCredentialError()', route) <
        at(source, 'incrementRateLimit(', route),
      `${route} guards before it charges`,
    );
  }
});
