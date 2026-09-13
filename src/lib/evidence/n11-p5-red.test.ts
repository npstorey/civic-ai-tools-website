// THROWAWAY — Wave N11 (#434) P5's reds on a runner. Not for merge.
//
// Four items, four independent reds, each with premises so a green cannot come
// from an inert fixture. `npm test` runs `.ts` and `.mjs` only and this repo
// has no component render harness, so a claim about a `.tsx` surface is made
// either by driving the `.ts` it renders from or by a derived scan over the
// tree — never by rendering.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { PackageInput, EvidencePackage } from './packager.ts';

const { REFERENCE_IDENTITY_ENV } = await import('./reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] = value;
process.env.PUBLISHER_KEY_ID = 'adopter:n11-p5-red-fixture';
process.env.EVIDENCE_KEY_ID = 'adopter:n11-p5-red-fixture';

const { buildEvidencePackage } = await import('./packager.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('./trace.ts');
const { describeQueryOutcome } = await import('./query-step.ts');
const { TOOL_CALL_KEY_POLICY } = await import('./tool-call-identity.ts');
const { displayNameForSource, CIVIC_SOURCE_REGISTRY } = await import('./data-sources.ts');

function read(p: string): string {
  return readFileSync(p, 'utf8');
}
function tracked(globs: string[]): string[] {
  return execFileSync('git', ['ls-files', '--', ...globs], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

// ===========================================================================
// F3 (#430) — the key policy is submitted but never shown beside the score
// ===========================================================================
//
// The consistency card renders "Tool overlap: N%". What that percentage MEANS
// depends entirely on the key two runs' calls were compared under — #363's
// whole lesson, where a collapsing key made two different searches score 100%
// inside a SIGNED attestation. The dialog that creates an attestation submits
// the policy sentence; the surface that shows the score does not.

const DIALOG = 'src/components/evidence/AttestationDialog.tsx';
const SECTION = 'src/components/evidence/AttestationSection.tsx';

test('F3 PREMISE: the policy is a real sentence and the dialog submits it', () => {
  assert.ok(TOOL_CALL_KEY_POLICY.length > 20, 'the policy must be a sentence, not a token');
  assert.match(read(DIALOG), /toolCallKeyPolicy:\s*TOOL_CALL_KEY_POLICY/, 'the dialog submits it');
});

test('F3 PREMISE: the section is the surface that shows the score', () => {
  const s = read(SECTION);
  assert.match(s, /Tool overlap/, 'the section renders the overlap percentage');
  assert.match(s, /consistencyClassification/, 'and the classification beside it');
});

test('F3 RED: the surface that shows the score also states the key the score was computed under', () => {
  const s = read(SECTION);
  assert.ok(
    s.includes('toolCallKeyPolicy'),
    `${SECTION} renders "Tool overlap: N%" and never names the key policy — not in its ` +
      'AttestationPackageData shape and not in any render site. A reader sees a percentage ' +
      'whose meaning is decided by a sentence only the submitting dialog shows.',
  );
});

// ===========================================================================
// F4 (#430, ruling D8) — a record that predates outcome marking says so, dated
// ===========================================================================

function packageWithNoOutcomeFields(): EvidencePackage {
  const b = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  b.startRoot('analysis', { 'analysis.portal': 'data.cityofnewyork.us' });
  b.endRoot();
  const input: PackageInput = {
    trace: b.finalize() as unknown as PackageInput['trace'],
    prompt: 'How many 311 noise complaints were filed last year?',
    output: 'About 412,000.',
    // Exactly the shape of a pre-N10 record: neither `failed` nor `resultRows`
    // on any entry, so the package asserts nothing about how the calls ended.
    toolCalls: [
      { name: 'get_data', args: { type: 'query', dataset_id: 'aaaa-1111' } },
      { name: 'get_data', args: { type: 'query', dataset_id: 'bbbb-2222' } },
    ] as unknown as PackageInput['toolCalls'],
    model: 'openai/gpt-4o',
    portal: 'data.cityofnewyork.us',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'N11 P5 red F4',
    summary: 'N11 P5 red F4.',
    type: 'content/analysis/v1',
  };
  return JSON.parse(JSON.stringify(buildEvidencePackage(input).pkg)) as EvidencePackage;
}

const NO_OUTCOME = packageWithNoOutcomeFields();

test('F4 PREMISE: the fixture really records no outcome on any entry', () => {
  const qs = NO_OUTCOME.queries as unknown as Record<string, unknown>[];
  assert.equal(qs.length, 2);
  for (const q of qs) {
    assert.equal(Object.prototype.hasOwnProperty.call(q, 'failed'), false, 'absent stays absent');
    assert.equal(Object.prototype.hasOwnProperty.call(q, 'resultRows'), false);
  }
});

test('F4 PREMISE: the per-entry formatter says nothing was recorded — but says it per entry, undated', () => {
  const text = describeQueryOutcome({} as never).text;
  assert.match(text, /No result summary was recorded/);
  assert.doesNotMatch(text, /\d{4}/, 'and carries no date, because it is a per-entry sentence');
});

test('F4 RED: some reader-facing formatter states, dated, that this record predates outcome marking', () => {
  // D8: "state the absence, dated" — a RECORD-level statement, not a per-entry
  // one. Collected from every `.ts` formatter the page can call over this
  // package; at base there is no such statement to collect.
  const sentences = (NO_OUTCOME.queries as unknown as Record<string, unknown>[])
    .map((q) => describeQueryOutcome(q as never).text);
  const recordLevel = sentences.find((s) => /\d{4}/.test(s) && /outcome|predate/i.test(s));
  assert.ok(
    recordLevel,
    'nothing states, with a date, that this package predates outcome marking. Its sources list ' +
      'still asserts the datasets were accessed, so a reader is told what was reached and ' +
      'nothing about whether any of it answered.',
  );
});

// ===========================================================================
// #405 (ruling D2) — badge colours by token, and a guard that can see them
// ===========================================================================

const BADGES = 'src/components/tool-badges.ts';
const GLOBALS = 'src/app/globals.css';
const TOKEN_GUARD = 'src/app/design-tokens.test.ts';

test('#405 PREMISE: one theme, and `search` already shows the token form works', () => {
  const css = read(GLOBALS);
  assert.equal(/prefers-color-scheme|data-theme/.test(css), false, 'light mode only (CLAUDE.md)');
  assert.match(read(BADGES), /rgba\(var\(--accent-rgb\)/, '`search` is already painted through tokens');
});

test('#405 RED: no badge colour is a quoted hex', () => {
  const hexes = [...read(BADGES).matchAll(/#[0-9A-Fa-f]{3,8}/g)].map((m) => m[0]);
  assert.deepEqual(
    hexes, [],
    `${BADGES} paints four operation types with literal hex. A literal opts that element out of ` +
      "an instance's brand: invisible here, wrong on every other instance (CLAUDE.md).",
  );
});

test('#405 RED: globals.css defines a tint token for every role a badge needs', () => {
  const css = read(GLOBALS);
  const missing = ['--info-tint', '--success-tint', '--caution-tint', '--error-tint']
    .filter((t) => !css.includes(t));
  assert.deepEqual(
    missing, [],
    'the badge table cannot name a token of matching role because none exists — which is the ' +
      "reason its own docstring gives for the hex. D2's five role tints are what unblock it.",
  );
});

test('#405 RED: the token guard can see the badge table at all', () => {
  const guard = read(TOKEN_GUARD);
  assert.ok(
    guard.includes('tool-badges'),
    `${TOKEN_GUARD} never names ${BADGES}, so a quoted hex there is invisible to the one test ` +
      'whose job is refusing colours that resolve to nothing.',
  );
});

// ===========================================================================
// hub #194 (ruling D4 = B) — the reader-facing source name, mapped at render
// ===========================================================================

test('#194 PREMISE: the registry carries both names, and they differ', () => {
  const r = CIVIC_SOURCE_REGISTRY as unknown as Record<string, { displayName?: string; agentTitle?: string }>;
  for (const id of ['socrata', 'data-commons']) {
    assert.ok(r[id]?.displayName && r[id]?.agentTitle, `${id} carries both names`);
    assert.notEqual(r[id]!.displayName, r[id]!.agentTitle, 'and they differ, or this asserts nothing');
  }
  assert.equal(displayNameForSource('socrata'), 'Socrata');
});

test('#194 PREMISE: the Data sources row is ALREADY mapped — this is not the gap', async () => {
  const { formatDataSourcesSummary } = await import('./data-sources.ts');
  const summary = formatDataSourcesSummary([
    { sourceId: 'socrata', datasetUrl: 'https://x/1', accessTimestamp: '2026-09-12T00:00:00Z' },
  ] as never);
  assert.match(String(summary), /Socrata/);
  assert.doesNotMatch(String(summary), /MCP Server/, 'the row already shows the reader-facing name');
});

test('#194 RED: the rendered graph description names no agent title', () => {
  // `ProvenanceGraphSection.getDescription` returns `dcterms:description`
  // VERBATIM from the signed graph and maps nothing, so whatever the builder
  // wrote reaches the reader. Read the same field the component reads.
  const section = read('src/components/evidence/ProvenanceGraphSection.tsx');
  assert.match(section, /dcterms:description/, 'PREMISE: the component reads that field');
  assert.ok(
    /displayNameForSource/.test(section),
    'ProvenanceGraphSection renders the graph\'s description with no render-time map, so a data ' +
      'response the builder could not describe by a portal reaches the reader as the agent\'s ' +
      'title — "Data response from Socrata MCP Server" — which is implementation language on a ' +
      'reader-facing surface. D4 = B maps it here; no signed byte moves.',
  );
});

test('#194 RED: no reader-facing surface renders an agentTitle string from the graph', () => {
  const r = CIVIC_SOURCE_REGISTRY as unknown as Record<string, { agentTitle?: string }>;
  const titles = Object.values(r).map((e) => e.agentTitle).filter(Boolean) as string[];
  assert.ok(titles.length >= 2, 'PREMISE: the registry has agent titles to find');
  // Derived: every tracked non-test component that reads a graph description.
  const readers = tracked(['src/components/**/*.tsx', 'src/app/**/*.tsx'])
    .filter((f) => !f.includes('.test.'))
    .filter((f) => /dcterms:description/.test(read(f)));
  assert.ok(readers.length >= 1, 'PREMISE: at least one component reads a graph description');
  const unmapped = readers.filter((f) => !/displayNameForSource/.test(read(f)));
  assert.deepEqual(
    unmapped, [],
    'these render a graph description with no source-name map: ' + unmapped.join(', '),
  );
});
