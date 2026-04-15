// Unit tests for the skill-composition pure function.
//
// Run with: node --test --experimental-strip-types src/lib/mcp/skill-composition.test.ts
//
// composeSkillPrompt accepts an injected registry so tests can stub source
// fetchText without mocking module imports. The default SKILL_REGISTRY is
// covered by manual end-to-end verification on the Vercel preview, not here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeSkillPrompt,
  type SkillRegistry,
  type SkillEntry,
  type SourceId,
} from './socrata-skill.ts';

const TODAY = '2026-04-15';
const PREAMBLE = 'PREAMBLE_BODY';
const INTRO_LINE = 'You are a helpful assistant with access to civic and statistical data via MCP tools.';
const TODAY_LINE = `Today's date is ${TODAY}. Always use this as the current date for interpreting relative time expressions like "last year" or "past two months."`;
const OUTRO = 'When you get results, summarize clearly and cite the dataset ID (for Socrata) or the variable DCID + source dataset (for Data Commons).';

function makeStubEntry(sourceId: SourceId, text: string): SkillEntry {
  return {
    sourceId,
    async fetchText() {
      return text;
    },
  };
}

function makePortalAwareEntry(sourceId: SourceId, prefix: string): SkillEntry {
  return {
    sourceId,
    async fetchText(ctx) {
      return `${prefix}(portal=${ctx.portal ?? 'none'}, today=${ctx.today})`;
    },
  };
}

function makeFailingEntry(sourceId: SourceId, message: string): SkillEntry {
  return {
    sourceId,
    async fetchText() {
      throw new Error(message);
    },
  };
}

const TWO_SOURCE_REGISTRY: SkillRegistry = {
  socrata: makeStubEntry('socrata', 'SOCRATA_BLOCK'),
  'data-commons': makeStubEntry('data-commons', 'DATA_COMMONS_BLOCK'),
};

test('Both sources, typical context: intro+preamble, both source blocks in order, outro — joined by \\n\\n---\\n\\n', async () => {
  const result = await composeSkillPrompt(
    ['socrata', 'data-commons'],
    { today: TODAY, preamble: PREAMBLE, portal: 'data.cityofnewyork.us' },
    TWO_SOURCE_REGISTRY,
  );

  const expected = [
    `${INTRO_LINE}\n\n${TODAY_LINE}\n\n${PREAMBLE}`,
    'SOCRATA_BLOCK',
    'DATA_COMMONS_BLOCK',
    OUTRO,
  ].join('\n\n---\n\n');

  assert.equal(result, expected);
});

test('activeSources order is preserved: data-commons before socrata renders DC first', async () => {
  const result = await composeSkillPrompt(
    ['data-commons', 'socrata'],
    { today: TODAY, preamble: PREAMBLE },
    TWO_SOURCE_REGISTRY,
  );

  const dcIndex = result.indexOf('DATA_COMMONS_BLOCK');
  const socrataIndex = result.indexOf('SOCRATA_BLOCK');
  assert.ok(dcIndex >= 0 && socrataIndex >= 0, 'both source blocks should appear');
  assert.ok(dcIndex < socrataIndex, 'data-commons should render before socrata when listed first');
});

test('Socrata only: no Data Commons block in output', async () => {
  const result = await composeSkillPrompt(
    ['socrata'],
    { today: TODAY, preamble: PREAMBLE, portal: 'data.cityofnewyork.us' },
    TWO_SOURCE_REGISTRY,
  );

  assert.ok(result.includes('SOCRATA_BLOCK'), 'Socrata block should be present');
  assert.ok(!result.includes('DATA_COMMONS_BLOCK'), 'Data Commons block should be absent');

  const expected = [
    `${INTRO_LINE}\n\n${TODAY_LINE}\n\n${PREAMBLE}`,
    'SOCRATA_BLOCK',
    OUTRO,
  ].join('\n\n---\n\n');
  assert.equal(result, expected);
});

test('Data Commons only: no Socrata block in output', async () => {
  const result = await composeSkillPrompt(
    ['data-commons'],
    { today: TODAY, preamble: PREAMBLE },
    TWO_SOURCE_REGISTRY,
  );

  assert.ok(result.includes('DATA_COMMONS_BLOCK'), 'Data Commons block should be present');
  assert.ok(!result.includes('SOCRATA_BLOCK'), 'Socrata block should be absent');

  const expected = [
    `${INTRO_LINE}\n\n${TODAY_LINE}\n\n${PREAMBLE}`,
    'DATA_COMMONS_BLOCK',
    OUTRO,
  ].join('\n\n---\n\n');
  assert.equal(result, expected);
});

test('Empty activeSources: intro + preamble + outro, no source blocks', async () => {
  const result = await composeSkillPrompt(
    [],
    { today: TODAY, preamble: PREAMBLE },
    TWO_SOURCE_REGISTRY,
  );

  const expected = [
    `${INTRO_LINE}\n\n${TODAY_LINE}\n\n${PREAMBLE}`,
    OUTRO,
  ].join('\n\n---\n\n');
  assert.equal(result, expected);
  assert.ok(!result.includes('SOCRATA_BLOCK'));
  assert.ok(!result.includes('DATA_COMMONS_BLOCK'));
});

test('Missing preamble: intro alone in first block, no extra separator', async () => {
  const result = await composeSkillPrompt(
    ['socrata'],
    { today: TODAY },
    TWO_SOURCE_REGISTRY,
  );

  const expected = [
    `${INTRO_LINE}\n\n${TODAY_LINE}`,
    'SOCRATA_BLOCK',
    OUTRO,
  ].join('\n\n---\n\n');
  assert.equal(result, expected);
});

test('Unknown sourceId in activeSources: warning logged, source skipped, others render', async () => {
  // Capture console.warn output
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };

  try {
    const result = await composeSkillPrompt(
      ['socrata', 'mystery-source' as SourceId, 'data-commons'],
      { today: TODAY, preamble: PREAMBLE },
      TWO_SOURCE_REGISTRY,
    );

    assert.ok(result.includes('SOCRATA_BLOCK'), 'real sources still render');
    assert.ok(result.includes('DATA_COMMONS_BLOCK'), 'real sources still render');
    assert.ok(!result.includes('mystery-source'), 'unknown source name does not leak into prompt');
    assert.ok(
      warnings.some((w) => w.includes('mystery-source') && w.includes('Unknown sourceId')),
      'a warning was logged about the unknown sourceId',
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('Failing fetchText: error logged, source omitted, composition completes with other sources', async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };

  try {
    const registry: SkillRegistry = {
      socrata: makeFailingEntry('socrata', 'simulated socrata outage'),
      'data-commons': makeStubEntry('data-commons', 'DATA_COMMONS_BLOCK'),
    };
    const result = await composeSkillPrompt(
      ['socrata', 'data-commons'],
      { today: TODAY, preamble: PREAMBLE },
      registry,
    );

    assert.ok(result.includes('DATA_COMMONS_BLOCK'), 'surviving source still renders');
    assert.ok(!result.includes('SOCRATA_BLOCK'), 'failed source is omitted');
    assert.ok(
      warnings.some((w) => w.includes('socrata') && w.includes('simulated socrata outage')),
      'a warning was logged about the failed source',
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('Returning empty string from fetchText: source omitted with no separator', async () => {
  const registry: SkillRegistry = {
    socrata: makeStubEntry('socrata', ''),
    'data-commons': makeStubEntry('data-commons', 'DATA_COMMONS_BLOCK'),
  };
  const result = await composeSkillPrompt(
    ['socrata', 'data-commons'],
    { today: TODAY, preamble: PREAMBLE },
    registry,
  );

  // No double separator from the dropped Socrata block.
  assert.ok(!result.includes('---\n\n\n\n---'));
  // Data Commons block lands directly after the preamble block.
  assert.ok(result.includes(`${PREAMBLE}\n\n---\n\nDATA_COMMONS_BLOCK`));
});

test('Returning whitespace-only from fetchText: source omitted', async () => {
  const registry: SkillRegistry = {
    socrata: makeStubEntry('socrata', '   \n  \n  '),
    'data-commons': makeStubEntry('data-commons', 'DATA_COMMONS_BLOCK'),
  };
  const result = await composeSkillPrompt(
    ['socrata', 'data-commons'],
    { today: TODAY, preamble: PREAMBLE },
    registry,
  );

  assert.ok(result.includes('DATA_COMMONS_BLOCK'));
  assert.ok(!result.includes('   \n  \n  '));
});

test('SkillContext is threaded through to fetchText (portal + today visible)', async () => {
  const registry: SkillRegistry = {
    socrata: makePortalAwareEntry('socrata', 'SOCRATA_'),
    'data-commons': makePortalAwareEntry('data-commons', 'DC_'),
  };
  const result = await composeSkillPrompt(
    ['socrata', 'data-commons'],
    { today: TODAY, preamble: PREAMBLE, portal: 'data.cityofchicago.org' },
    registry,
  );

  assert.ok(result.includes('SOCRATA_(portal=data.cityofchicago.org, today=2026-04-15)'));
  assert.ok(result.includes('DC_(portal=data.cityofchicago.org, today=2026-04-15)'));
});

test('No-preamble + empty sources: intro joins directly to outro by separator (preamble omitted, no double separator)', async () => {
  const result = await composeSkillPrompt(
    [],
    { today: TODAY },
    TWO_SOURCE_REGISTRY,
  );

  const expected = `${INTRO_LINE}\n\n${TODAY_LINE}\n\n---\n\n${OUTRO}`;
  assert.equal(result, expected);
});
