// Skill-text instance-identity override test (S3a P2 blast-zone extension,
// #166; ADR-0020 — updated for sprint 154 P4, portability charter 4).
//
// NEW file, and deliberately a SIBLING of instance-config.test.ts: the skill
// constants (`SOCRATA_SKILL_FALLBACK`, `DATA_COMMONS_SKILL`) are module-level
// template literals, so any instance-host interpolation resolves at MODULE
// LOAD. Proving behavior under an override therefore requires setting the
// environment BEFORE the module's first import — node's test runner gives each
// test file its own process, so this file sets the env at top level and then
// dynamically imports. The default direction (no env) is pinned in
// src/lib/evidence/instance-config.test.ts, whose process imports the same
// modules under a cleared identity env.
//
// What each constant does with the override, post-P4:
//   - DATA_COMMONS_SKILL still interpolates the publication host (unchanged).
//   - SOCRATA_SKILL_FALLBACK is GENERIC-ONLY: host-free Applies-to line, no
//     deployment posture, regardless of env. The override must NOT appear.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

// MUST run before the skill modules load (imports below are dynamic).
process.env.EVIDENCE_PUBLICATION_HOST = 'skills.example.org';

test('skill text: override host bakes into DATA_COMMONS_SKILL; SOCRATA fallback stays host-free', async () => {
  const { SOCRATA_SKILL_FALLBACK } = await import('./socrata-skill.ts');
  const { DATA_COMMONS_SKILL } = await import('./data-commons-skill.ts');

  // Socrata fallback (P4): generic-only. The Applies-to line is host-free
  // even when the instance declares a publication host.
  assert.ok(
    SOCRATA_SKILL_FALLBACK.includes(
      'Applies to: HTTP-connected web clients, on any deployment of the web app.',
    ),
    'socrata fallback should carry the host-free generic Applies-to line',
  );
  assert.ok(
    !SOCRATA_SKILL_FALLBACK.includes('skills.example.org'),
    'socrata fallback must not bake the override host',
  );
  assert.ok(
    !SOCRATA_SKILL_FALLBACK.includes('civicaitools.org'),
    'socrata fallback must not carry the reference host under any env',
  );

  // Data Commons skill: host interpolation unchanged (out of P4 scope).
  assert.ok(
    DATA_COMMONS_SKILL.includes(
      'published as a record package on skills.example.org',
    ),
    'data-commons skill should carry the override host',
  );
  assert.ok(
    !DATA_COMMONS_SKILL.includes(
      'published as a record package on civicaitools.org',
    ),
    'data-commons skill should not carry the demo host under override',
  );
});

test('skill text: the fallback carries no reference-demo posture under override env', async () => {
  const { SOCRATA_SKILL_FALLBACK } = await import('./socrata-skill.ts');

  // Posture markers that must never appear in the generic-only fallback
  // (the old posture text, the CTA, and the posture overlay's own heading).
  // Note: the marker for the row cap is the posture PHRASING, not the bare
  // number — the base guidance's Pagination section legitimately carries
  // "Never request more than 10,000 rows in a single call" (generic content,
  // civic-ai-tools docs/skills/base.md).
  for (const marker of [
    'This is a public demo',
    'github.com/npstorey/civic-ai-tools',
    'Web Demo Limits',
    'Reference-Demo Posture',
    'Local Tools CTA',
    'Limit queries to 10,000 rows max',
  ]) {
    assert.ok(
      !SOCRATA_SKILL_FALLBACK.includes(marker),
      `socrata fallback must not contain posture marker: ${marker}`,
    );
  }

  // The generic overlay's sections are all present.
  for (const heading of [
    '# Socrata MCP Skill — Web Overlay',
    '## Date Filter Enforcement',
    '## Deployment Limits',
    '## Token-Conscious Formatting',
    '## Suggesting a Local Client',
  ]) {
    assert.ok(
      SOCRATA_SKILL_FALLBACK.includes(heading),
      `socrata fallback must contain generic section: ${heading}`,
    );
  }
});
