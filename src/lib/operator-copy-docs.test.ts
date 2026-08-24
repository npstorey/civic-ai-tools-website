// The deploy guide quotes reader-facing error copy verbatim. This keeps the
// quotes true (civic-ai-tools-website#30 P4).
//
// WHY THIS EXISTS. `docs/deploy.md`'s model-seam section shows an operator
// exactly what they will see when the model endpoint is misconfigured, so an
// operator can match a string on their screen against the guide. That is only
// useful while the strings agree, and nothing made them agree: the copy for the
// two credential kinds named `OPENROUTER_API_KEY` for a full sprint after
// `MODEL_API_KEY` became the canonical variable, in the code AND in the guide,
// and both were found by reading rather than by any check.
//
// This is the cheap mechanical version of the sprint's "statements pass" rider:
// a rename's true surface is every statement it falsifies, and a documented
// quotation of a string constant is a statement that goes stale silently.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { streamErrorPayload, type StreamErrorKind } from './streaming.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Markdown prose uses typographic apostrophes and quotes inconsistently with a
 * TypeScript string literal, and wraps at the column the author happened to be
 * at. Neither difference is a drift, so both are normalized away; a changed
 * WORD still fails.
 */
function normalize(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const deployGuide = normalize(readFileSync(join(REPO, 'docs/deploy.md'), 'utf8'));

const QUOTED_IN_DEPLOY_GUIDE: StreamErrorKind[] = [
  'model_not_configured',
  'model_auth_rejected',
  'model_rate_limited',
];

test('#30 P4: docs/deploy.md quotes the model-seam copy verbatim', () => {
  for (const kind of QUOTED_IN_DEPLOY_GUIDE) {
    const copy = normalize(streamErrorPayload(kind).message);
    assert.ok(
      deployGuide.includes(copy),
      `docs/deploy.md no longer quotes the copy for "${kind}" verbatim. It should read:\n\n${streamErrorPayload(kind).message}\n`,
    );
  }
});

test('#30 P4: the deploy guide names the canonical credential variable', () => {
  // `OPENROUTER_API_KEY` still appears — it is a real, still-read prior-era
  // name and dropping it would lose a fact an existing operator needs. What
  // must not happen is the guide naming ONLY the prior-era name, which is what
  // it did before this phase.
  assert.ok(deployGuide.includes('MODEL_API_KEY'), 'the canonical name is named');
  const priorEraMentions = deployGuide.split('OPENROUTER_API_KEY').length - 1;
  const canonicalMentions = deployGuide.split('MODEL_API_KEY').length - 1;
  assert.ok(
    canonicalMentions >= priorEraMentions,
    `the guide leads with the canonical name (canonical ${canonicalMentions}, prior-era ${priorEraMentions})`,
  );
});

test('#30 P4: the setup guide’s model section exists and carries all three roles', () => {
  const setup = readFileSync(join(REPO, 'docs/instance-setup.md'), 'utf8');
  // Every variable the model layer reads, with nowhere else in the operator
  // documentation that classifies them against ADR-0024 §C.
  for (const variable of [
    'MODEL_API_KEY',
    'MODEL_API_KIND',
    'MODEL_API_BASE_URL',
    'MODEL_API_VERSION',
    'MODEL_API_AUTH',
    'MODEL_CATALOG',
    'MODEL_CATALOG_PATH',
  ]) {
    assert.ok(setup.includes(variable), `instance-setup.md documents ${variable}`);
  }
  // The three catalog roles. `summarizer` arrived last (website#30 P3) and is
  // the one an example is most likely to omit.
  for (const role of ['"default": true', '"evaluator"', '"summarizer": true']) {
    assert.ok(setup.includes(role), `the catalog example carries ${role}`);
  }
  // The honesty clause. Its absence would turn a checklist into a claim.
  assert.ok(
    /never been run against a real deployment-routed resource/i.test(setup),
    'the section states that the live leg is unverified',
  );
  assert.ok(
    setup.includes('**Streaming.**'),
    'the unverified list names streaming, the largest gap',
  );
});

test('#30 P4: the setup guide’s catalog example uses placeholder names only', () => {
  const setup = readFileSync(join(REPO, 'docs/instance-setup.md'), 'utf8');
  // No real resource hostnames and no real-looking key shapes may reach a
  // public repository's operator documentation.
  assert.ok(!/openai\.azure\.com/i.test(setup), 'no real resource host');
  assert.ok(!/\bsk-[a-z0-9-]{8,}/i.test(setup), 'no real-looking key shape');
  assert.ok(setup.includes('example-analysis-deployment'), 'deployment names are placeholders');
});
