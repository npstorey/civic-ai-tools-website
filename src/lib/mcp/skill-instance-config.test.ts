// Skill-text instance-identity override test (S3a P2 blast-zone extension,
// #166; ADR-0020).
//
// NEW file, and deliberately a SIBLING of instance-config.test.ts: the skill
// constants (`SOCRATA_SKILL_FALLBACK`, `DATA_COMMONS_SKILL`) are module-level
// template literals, so the instance host resolves at MODULE LOAD. Proving
// the override therefore requires setting the environment BEFORE the module's
// first import — node's test runner gives each test file its own process, so
// this file sets the env at top level and then dynamically imports. The
// default direction (no env → demo host baked in) is pinned in
// src/lib/evidence/instance-config.test.ts, whose process imports the same
// modules under a cleared identity env.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

// MUST run before the skill modules load (imports below are dynamic).
process.env.EVIDENCE_PUBLICATION_HOST = 'skills.example.org';

test('skill text: override host is baked into both skill constants at module load', async () => {
  const { SOCRATA_SKILL_FALLBACK } = await import('./socrata-skill.ts');
  const { DATA_COMMONS_SKILL } = await import('./data-commons-skill.ts');

  assert.ok(
    SOCRATA_SKILL_FALLBACK.includes('Web demo (skills.example.org)'),
    'socrata fallback skill should carry the override host',
  );
  assert.ok(
    !SOCRATA_SKILL_FALLBACK.includes('Web demo (civicaitools.org)'),
    'socrata fallback skill should not carry the demo host under override',
  );

  assert.ok(
    DATA_COMMONS_SKILL.includes(
      'published as an evidence package on skills.example.org',
    ),
    'data-commons skill should carry the override host',
  );
  assert.ok(
    !DATA_COMMONS_SKILL.includes(
      'published as an evidence package on civicaitools.org',
    ),
    'data-commons skill should not carry the demo host under override',
  );
});
