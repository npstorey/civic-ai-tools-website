// The instance's default portal is configuration, behaviourally (#407).
//
// The guard beside this file (`portal-default-is-configured.test.ts`) is a
// SOURCE SCAN: it proves no file spells a portal hostname. That is a different
// claim from "the surfaces read the resolver, and absent one they say so", and
// a scan cannot make it — a literal deleted and replaced with nothing would
// pass it. This file drives the behaviour instead, under both env shapes the
// #407 contract names.
//
// THE TWO SHAPES, AND WHY THE SECOND ONE IS NOT THE REFERENCE PORTAL.
//
//   1. `SITE_DEFAULT_PORTAL` unset — a run carries no default, and every
//      surface that would have named a portal omits it.
//   2. `SITE_DEFAULT_PORTAL` set to a portal that is NOT the reference
//      deployment's. A fixture that set it to the very hostname the literals
//      spelled could not tell the resolver apart from the literal it replaced:
//      both produce the same bytes, so the assertion could not fail. `PORTAL`
//      below is deliberately a different city for that reason.
//
// WHAT IS PINNED HERE AND WHAT IS NOT. The resolver, the skeleton generator
// (`generateNotebook`), the executed generator (`synthesizeNotebook`) and a
// built record package are all executed. The three query routes and the four
// client components are NOT: they are Next request handlers and JSX, which
// `node --test` does not run. What holds them is the source guard plus the
// fact that each now reads this resolver — and that pairing is the blind spot
// worth naming, because a route could read the resolver and then do something
// dishonest with the result without either check noticing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getDefaultPortal } from './site-config.ts';
import { generateNotebook } from './notebook.ts';
import { synthesizeNotebook } from './notebook-author/synthesize.ts';
import { countReproducibleFetches } from './notebook-author/tool-to-cell.ts';
import { buildEvidencePackage } from './evidence/packager.ts';
import { TraceBuilder, hash, CIVICAITOOLS_TRACE_CONFIG } from './evidence/trace.ts';

// The packager refuses to build without a declared instance identity (#258)
// and without a key id (signing.ts). Neutral test values, local to this
// process — `node --test` runs each file in its own. No signing key is
// generated, displayed or handled anywhere in this file.
process.env.PUBLISHER_KEY_ID ??= 'platform:test-suite-kid';
process.env.PUBLISHER_SITE_ORIGIN ??= 'https://instance.example';
process.env.PUBLISHER_PLATFORM_AGENT_TITLE ??= 'Test Instance';
process.env.PUBLISHER_SIGNER_BINDING_TIER ??= 'self-asserted';
process.env.PUBLISHER_SIGNER_IDENTIFIER ??= 'https://instance.example';
process.env.PUBLISHER_SIGNER_DISPLAY_NAME ??= 'Test Instance';

/** A configured default that is NOT the hostname the literals spelled. */
const PORTAL = 'data.sfgov.org';
/** A portal a CALL names, different again, so "the call's" and "the run's"
 *  can never be confused for one another by a passing assertion. */
const CALL_PORTAL = 'data.seattle.gov';

const NO_ATTRIBUTION = { origin: null, host: null, platformTitle: null };

/** Every portal-shaped hostname in a value, however deeply nested. */
const HOSTNAME =
  /\b(?:data|opendata)\.[a-z0-9-]+\.(?:gov|us|org|com|net|io)\b|\b[a-z0-9-]+\.data\.socrata\.com\b|\bapi\.datacommons\.org\b/gi;
function hostnamesIn(value: unknown): string[] {
  const found = JSON.stringify(value)?.match(HOSTNAME) ?? [];
  return [...new Set(found.map((h) => h.toLowerCase()))].sort();
}

/** Run `body` with `SITE_DEFAULT_PORTAL` set to `value`, or unset for null.
 *  Restored afterwards: the getter reads at CALL time, so a leaked value
 *  would silently configure every test after it. */
function withDefaultPortal<T>(value: string | null, body: () => T): T {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'SITE_DEFAULT_PORTAL');
  const previous = process.env.SITE_DEFAULT_PORTAL;
  if (value === null) delete process.env.SITE_DEFAULT_PORTAL;
  else process.env.SITE_DEFAULT_PORTAL = value;
  try {
    return body();
  } finally {
    if (had) process.env.SITE_DEFAULT_PORTAL = previous;
    else delete process.env.SITE_DEFAULT_PORTAL;
  }
}

// --- The resolver ------------------------------------------------------------

test('#407: unset means this instance declared no default portal', () => {
  withDefaultPortal(null, () => {
    assert.equal(
      getDefaultPortal(),
      null,
      'absent configuration must resolve to null — the getInstanceAttribution ' +
        'disposition, not a substituted city',
    );
  });
});

test('#407: a configured portal resolves to exactly what the operator set', () => {
  withDefaultPortal(PORTAL, () => {
    assert.equal(getDefaultPortal(), PORTAL);
  });
});

test('#407: whitespace-only is absent, and a configured value is trimmed', () => {
  withDefaultPortal('   ', () => {
    assert.equal(getDefaultPortal(), null, 'whitespace is not a portal');
  });
  withDefaultPortal(`  ${PORTAL}\n`, () => {
    assert.equal(
      getDefaultPortal(),
      PORTAL,
      'a hostname with stray whitespace would build a broken URL; trim it once, here',
    );
  });
});

test('#407: the default portal is not a publisher-identity variable, so it has no prior-era alias', () => {
  // The `PUBLISHER_*` set answers to an `EVIDENCE_*` spelling through
  // `readPublisherEnv`. A default portal is a configuration seam, not a value
  // emitted inside signed output, so it is read as one name through plain
  // `process.env` — and this asserts that choice rather than describing it.
  // Minting an alias nothing ever set would give operators a second name that
  // silently works, and a second name to keep in step.
  const names = ['EVIDENCE_DEFAULT_PORTAL', 'PUBLISHER_DEFAULT_PORTAL'];
  for (const name of names) {
    const previous = process.env[name];
    process.env[name] = 'data.example.gov';
    try {
      withDefaultPortal(null, () => {
        assert.equal(
          getDefaultPortal(),
          null,
          `${name} must not resolve the default portal — one variable, one name`,
        );
      });
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  }
});

// --- The record-derived surface: the downloaded skeleton notebook ------------

const CALL_WITH_PORTAL = [{
  name: 'get_data',
  operationType: 'query' as const,
  args: { type: 'query', portal: CALL_PORTAL, dataset_id: 'abcd-1234', limit: 5 },
  resultSummary: { rows: 5, columns: 3 },
  duration_ms: 100,
}];

const CALL_WITHOUT_PORTAL = [{
  name: 'get_data',
  operationType: 'query' as const,
  args: { type: 'query', dataset_id: 'abcd-1234', limit: 5 },
  resultSummary: { rows: 5, columns: 3 },
  duration_ms: 100,
}];

function coverOf(notebook: { cells: { source: string[] }[] }): string {
  return notebook.cells[0].source.join('');
}

test('#407: a skeleton notebook whose run named no portal names none on its cover', () => {
  const cover = coverOf(
    generateNotebook('q?', null, CALL_WITHOUT_PORTAL as never, 'answer', NO_ATTRIBUTION) as never,
  );
  assert.ok(
    !/\*\*Portals?:\*\*/.test(cover),
    `the cover must omit its Portal line when nothing named one — got:\n${cover}`,
  );
  assert.deepEqual(
    hostnamesIn(generateNotebook('q?', null, CALL_WITHOUT_PORTAL as never, 'answer', NO_ATTRIBUTION)),
    [],
    'a document derived from a record must not name a portal the record does not carry',
  );
});

test("#407: the CALL's portal wins over the run's, and the run's over nothing", () => {
  // The narrowing order this surface has to keep. Driven with three DIFFERENT
  // hostnames so a wrong precedence cannot pass by coincidence.
  const fromCall = coverOf(
    generateNotebook('q?', PORTAL, CALL_WITH_PORTAL as never, 'a', NO_ATTRIBUTION) as never,
  );
  assert.match(fromCall, new RegExp(`\\*\\*Portal:\\*\\* ${CALL_PORTAL}`));
  assert.ok(!fromCall.includes(PORTAL), "the run's portal must not displace the call's");

  const fromRun = coverOf(
    generateNotebook('q?', PORTAL, CALL_WITHOUT_PORTAL as never, 'a', NO_ATTRIBUTION) as never,
  );
  assert.match(fromRun, new RegExp(`\\*\\*Portal:\\*\\* ${PORTAL}`));
});

// --- The record-derived surface: the executed notebook ----------------------

test('#407: an executed notebook writes no request it cannot address', () => {
  // The shape that could only exist once the compiled-in default was gone: a
  // `get_data` naming a dataset but no portal, on a run carrying no default.
  // The old literal filled it silently; an empty one would have written
  // `portal=""` — a cell that always raises, in a document whose cover tells
  // the reader its steps run.
  const { notebook } = synthesizeNotebook({
    query: 'q?',
    defaultPortal: '',
    modelName: 'test/model',
    modelAccess: 'through an API',
    finalAnswer: 'answer',
    generatedAt: '2026-01-01T00:00:00.000Z',
    toolCalls: CALL_WITHOUT_PORTAL as never,
  });
  const whole = JSON.stringify(notebook);
  assert.ok(!whole.includes('portal=\\"\\"'), 'no fetch may be written with an empty portal');
  assert.deepEqual(hostnamesIn(notebook), [], 'and none may be written with a substituted one');
  assert.match(
    coverOf(notebook as never),
    /re-runs a live request in 0 of its 1 analysis steps/,
    'the cover must claim what the document delivers: nothing re-runnable',
  );
});

test('#407: the cover\'s reproduction count is derived with the portal the steps are rendered with', () => {
  // `countReproducibleFetches` hardcoded '' while the steps rendered under the
  // configured portal. That was harmless only while the portal could not
  // change whether a call produced a data frame; it now can, and a claim
  // derived under one value while the document is built under another is the
  // claim-versus-document disagreement #341 and #371 exist to prevent.
  assert.equal(
    countReproducibleFetches(CALL_WITHOUT_PORTAL as never, ''),
    0,
    'with no portal anywhere, nothing is re-runnable',
  );
  assert.equal(
    countReproducibleFetches(CALL_WITHOUT_PORTAL as never, PORTAL),
    1,
    'with a configured portal the same call IS re-runnable — which is exactly ' +
      'why the count must be told which one the document uses',
  );

  const configured = synthesizeNotebook({
    query: 'q?',
    defaultPortal: PORTAL,
    modelName: 'test/model',
    modelAccess: 'through an API',
    finalAnswer: 'answer',
    generatedAt: '2026-01-01T00:00:00.000Z',
    toolCalls: CALL_WITHOUT_PORTAL as never,
  }).notebook;
  assert.match(
    coverOf(configured as never),
    /re-runs a live request in 1 of its 1 analysis steps/,
    'and under a configured portal the same document says so',
  );
});

// --- Signed bytes -----------------------------------------------------------

/**
 * The trace a query route writes, with and without a run-level portal, over a
 * run of `search` + `fetch` ONLY.
 *
 * That tool pair is what makes the assertion able to fail. `runToolLoop`
 * injects the run's portal into `get_data` and no other tool, so on a run of
 * `search` and `fetch` NO call carries a portal — and `analysis.portal` on the
 * root span is then the only place a run-level default can appear in the
 * package. A fixture built from `get_data` calls could not show this: the
 * injection would have put the run's portal on every call, so a package naming
 * it would be naming something a call really did carry, and the bytes would
 * look identical whether the value came from configuration or from a literal.
 */
function traceOf(runPortal: string | null): Record<string, unknown> {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {
    'analysis.prompt_hash': hash('q?'),
    'analysis.model': 'test/model',
    ...(runPortal ? { 'analysis.portal': runPortal } : {}),
  });
  const inference = builder.startSpan('llm_inference', undefined, { 'gen_ai.inference_index': '0' });
  builder.endSpan(inference, {
    'gen_ai.response.prompt_tokens': 10,
    'gen_ai.response.completion_tokens': 5,
  });
  for (const call of PORTALLESS_CALLS) {
    const spanId = builder.startSpan('mcp_tool_call', undefined, {
      'tool.name': call.name,
      'tool.operation_type': 'unknown',
      'tool.arguments': JSON.stringify(call.args),
      'mcp.source': 'socrata',
    });
    builder.endSpan(spanId, {
      'tool.response_hash': hash('result'),
      'tool.response_size_bytes': 6,
      'tool.duration_ms': 100,
    });
  }
  builder.endRoot();
  return builder.finalize() as unknown as Record<string, unknown>;
}

const PORTALLESS_CALLS = [
  { name: 'search', args: { query: '311 noise' }, resultSummary: { rows: 3, columns: 2 }, duration_ms: 90 },
  { name: 'fetch', args: { id: 'dataset:abcd-1234' }, resultSummary: { rows: 5, columns: 4 }, duration_ms: 110 },
];

function packageFor(runPortal: string | null) {
  const built = buildEvidencePackage({
    trace: traceOf(runPortal),
    prompt: 'q?',
    output: 'answer',
    toolCalls: PORTALLESS_CALLS as never,
    model: 'test/model',
    portal: runPortal ?? '',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'A question',
    summary: 'answer',
    type: 'content/analysis/v1',
    extensions: {
      'org.civicaitools.notebook': generateNotebook(
        'q?', null, PORTALLESS_CALLS as never, 'answer', NO_ATTRIBUTION,
      ),
    },
  } as never);
  // Read back the way storage round-trips it, not the builder's live object.
  return JSON.parse(JSON.stringify(built.pkg)) as Record<string, unknown>;
}

test('#407: with no portal configured, a signed package names no portal at all', () => {
  const pkg = packageFor(null);
  assert.deepEqual(
    pkg.dataSources,
    [],
    'the fixture is only able to fail while no call carried a portal — if this ' +
      'is non-empty the run named one and the assertion below proves nothing',
  );
  assert.deepEqual(
    hostnamesIn(pkg),
    [],
    'a package built from a run that addressed no portal must not assert one — ' +
      'this is the byte that carried the reference deployment\'s city before ' +
      '#407, on the root span and on the notebook cover, under the signature',
  );
});

test('#407: with a portal configured, the package names that one and only on the run-level span', () => {
  const pkg = packageFor(PORTAL);
  assert.deepEqual(
    hostnamesIn(pkg),
    [PORTAL],
    'the configured portal, and nothing else — no city this instance never set',
  );
  const notebook = (pkg.extensions as Record<string, unknown>)['org.civicaitools.notebook'];
  assert.deepEqual(
    hostnamesIn(notebook),
    [],
    'and NOT on the notebook cover: the configured default is a fact about the ' +
      'run\'s inputs, not about where these calls went, so a document derived ' +
      'from the record still names nothing',
  );
});
