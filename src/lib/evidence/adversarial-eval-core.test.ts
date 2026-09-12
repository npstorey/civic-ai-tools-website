// Unit tests for the adversarial-eval pure core (civic-ai-tools#72 Phase 3):
// rubric version pinning, prompt assembly, and evaluator-response parsing.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  EVALUATION_RUBRIC,
  EVALUATION_CRITERIA,
  RUBRIC_ID,
  RUBRIC_VERSION_SHA256,
  buildEvaluationPrompt,
  parseEvaluationResponse,
} from './adversarial-eval-core.ts';
import type { EvidencePackage } from './packager.ts';

function validResponse(overrides: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = Object.fromEntries(
    EVALUATION_CRITERIA.map((k, i) => [k, { score: i + 4, comment: `note ${k}` }]),
  );
  return JSON.stringify({
    ...base,
    overallScore: 6.5,
    assessment: 'A reasonable analysis with caveats.',
    ...overrides,
  });
}

test('RUBRIC_VERSION_SHA256 pins the exact rubric text', () => {
  const expected = crypto.createHash('sha256').update(EVALUATION_RUBRIC).digest('hex');
  assert.equal(RUBRIC_VERSION_SHA256, expected);
  assert.equal(RUBRIC_VERSION_SHA256.length, 64);
  assert.ok(RUBRIC_ID.startsWith('civicaitools-adversarial-rubric/'));
});

test('parseEvaluationResponse: accepts a conformant response', () => {
  const parsed = parseEvaluationResponse(validResponse());
  assert.ok(parsed.ok);
  if (parsed.ok) {
    assert.equal(parsed.results.overallScore, 6.5);
    assert.equal(parsed.results.assessment, 'A reasonable analysis with caveats.');
    assert.equal(Object.keys(parsed.results.perCriterion).length, EVALUATION_CRITERIA.length);
    assert.equal(parsed.results.perCriterion.dataSourceIdentification.score, 4);
  }
});

test('parseEvaluationResponse: strips markdown fences', () => {
  const fenced = '```json\n' + validResponse() + '\n```';
  const parsed = parseEvaluationResponse(fenced);
  assert.ok(parsed.ok);
});

test('parseEvaluationResponse: recomputes overallScore when omitted', () => {
  const obj = JSON.parse(validResponse());
  delete obj.overallScore;
  const parsed = parseEvaluationResponse(JSON.stringify(obj));
  assert.ok(parsed.ok);
  if (parsed.ok) {
    // scores are 4..9 → mean 6.5
    assert.equal(parsed.results.overallScore, 6.5);
  }
});

test('parseEvaluationResponse: rejects invalid JSON with the raw text preserved', () => {
  const parsed = parseEvaluationResponse('I cannot evaluate this.');
  assert.ok(!parsed.ok);
  if (!parsed.ok) {
    assert.equal(parsed.error, 'Evaluator returned invalid JSON');
    assert.equal(parsed.raw, 'I cannot evaluate this.');
  }
});

test('parseEvaluationResponse: rejects a missing criterion by name', () => {
  const obj = JSON.parse(validResponse());
  delete obj.geographicScope;
  const parsed = parseEvaluationResponse(JSON.stringify(obj));
  assert.ok(!parsed.ok);
  if (!parsed.ok) {
    assert.match(parsed.error, /geographicScope/);
  }
});

test('parseEvaluationResponse: rejects a non-numeric score', () => {
  const obj = JSON.parse(validResponse());
  obj.limitationsNoted = { score: 'high', comment: 'x' };
  const parsed = parseEvaluationResponse(JSON.stringify(obj));
  assert.ok(!parsed.ok);
});

test('buildEvaluationPrompt: includes prompt text, tool calls, and output', () => {
  const pkg = {
    prompt: { text: 'How many noise complaints?', hash: 'h', visibility: 'full_text' },
    queries: [
      {
        tool: 'get_data',
        operationType: 'query',
        arguments: { dataset_id: 'erm2-nwe9' },
        resultRows: 12,
      },
    ],
    dataSources: [
      { datasetUrl: 'https://data.example/d/erm2-nwe9', accessTimestamp: '2026-06-12T00:00:00Z' },
    ],
    cost: { model: 'openai/gpt-4o' },
    output: 'There were 12 complaints.',
  } as unknown as EvidencePackage;
  const prompt = buildEvaluationPrompt(pkg);
  assert.match(prompt, /How many noise complaints\?/);
  assert.match(prompt, /get_data\(dataset_id="erm2-nwe9"\) → 12 rows/);
  assert.match(prompt, /https:\/\/data\.example\/d\/erm2-nwe9/);
  assert.match(prompt, /There were 12 complaints\./);
  assert.match(prompt, /openai\/gpt-4o/);
});

test('buildEvaluationPrompt: hash-only prompts render the unavailable marker', () => {
  const pkg = {
    prompt: { hash: 'h', visibility: 'hash_only' },
    queries: [],
    dataSources: [],
    cost: { model: 'm' },
    output: 'out',
  } as unknown as EvidencePackage;
  assert.match(buildEvaluationPrompt(pkg), /\[prompt text not available\]/);
});

// The pin is the assertion (#434 P-bump). `buildEvaluationPrompt` is
// re-exported from @typedstandards/civic-typed-harness, so what the evaluator
// reads is decided by the LOCKFILE, not by anything in this repository. Under
// 0.4.0 a call the source REJECTED rendered `→ ? rows` — the same line as a
// call whose row count was simply never recorded — and the rubric asks the
// evaluator to cross-check the answer's figures against the data the tool
// calls returned, so the conflation invited it to read data that was never
// returned as merely uncounted. Its score becomes a signed attestation.
// 0.4.1 (civic-ai-tools#203) states the rejection instead.
//
// These tests are red at harness 0.4.0 and green at 0.4.1. That is the point:
// without them a lockfile refresh is green either side and "the bump landed"
// rests on reading a diff. They also keep the pin honest afterwards — a
// downgrade turns them red.
function promptLines(pkg: EvidencePackage): string[] {
  return buildEvaluationPrompt(pkg)
    .split('\n')
    .filter(l => /^ {2}\d+\. /.test(l))
    // Strip the list index. It differs between any two entries for a reason
    // that has nothing to do with the outcome, so a comparison that leaves it
    // in can never fail (civic-ai-tools#203's own red had this defect).
    .map(l => l.replace(/^ {2}\d+\. /, ''));
}

function pkgWithQueries(queries: unknown[]): EvidencePackage {
  return {
    prompt: { text: 'How many noise complaints?', hash: 'h', visibility: 'full_text' },
    queries,
    dataSources: [],
    cost: { model: 'openai/gpt-4o' },
    output: 'out',
  } as unknown as EvidencePackage;
}

test('the pinned harness renders a rejected call as rejected, not as an unknown row count', () => {
  const [answered, rejected, unrecorded] = promptLines(
    pkgWithQueries([
      { tool: 'get_data', operationType: 'query', arguments: { dataset_id: 'aaaa-1111' }, resultRows: 12 },
      { tool: 'get_data', operationType: 'query', arguments: { dataset_id: 'bbbb-2222' }, failed: true },
      { tool: 'get_data', operationType: 'query', arguments: { dataset_id: 'cccc-3333' } },
    ]),
  );

  // Premises, so a green here cannot come from the fixture being inert.
  assert.equal(answered, 'get_data(dataset_id="aaaa-1111") → 12 rows');
  assert.equal(unrecorded, 'get_data(dataset_id="cccc-3333") → ? rows');

  // The rejection is stated, and no row count is claimed for it.
  assert.match(rejected, /REJECTED/);
  assert.doesNotMatch(rejected, /rows/);

  // And the conflation is gone: with the dataset id normalised away, the
  // rejected line and the never-recorded line must not read the same. A fix
  // that merely stopped printing `? rows` for a rejection would fail this.
  const norm = (l: string) => l.replace(/dataset_id="[a-z0-9-]+"/, 'dataset_id="X"');
  assert.notEqual(norm(rejected), norm(unrecorded));
});

test('the pinned harness treats absence as absence: only a literal failed:true is a rejection', () => {
  const [failedFalse, kindOnly] = promptLines(
    pkgWithQueries([
      { tool: 'get_data', operationType: 'query', arguments: { dataset_id: 'dddd-4444' }, failed: false, resultRows: 3 },
      // A kind with no assertion is not a rejection — the harness's own rule.
      { tool: 'get_data', operationType: 'query', arguments: { dataset_id: 'eeee-5555' }, failureKind: 'timeout' },
    ]),
  );
  assert.equal(failedFalse, 'get_data(dataset_id="dddd-4444") → 3 rows');
  assert.equal(kindOnly, 'get_data(dataset_id="eeee-5555") → ? rows');
});
