// The roadmap's relative links (C6 of the 2026-10-10 site-refresh inventory).
//
// /roadmap renders a markdown file fetched from another repository. Its
// relative links are written relative to that file, and rendered unchanged
// they resolved against this site: the five below all 404'd on
// civicaitools.org on 2026-10-10, read from the hub's ROADMAP.md at main.
// `resolveRoadmapHref` resolves them against the source file's page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractH2Headings, resolveRoadmapHref, roadmapLinkBase, splitRoadmapPreamble } from './format.ts';

const REFERENCE_RAW_URL = 'https://raw.githubusercontent.com/npstorey/civic-ai-tools/main/ROADMAP.md';
const BLOB = 'https://github.com/npstorey/civic-ai-tools/blob/main';

test('the five relative links in the reference roadmap resolve to the hub repository at the fetched ref', () => {
  const base = roadmapLinkBase(REFERENCE_RAW_URL);
  assert.equal(base, `${BLOB}/ROADMAP.md`);
  const cases: Array<[string, string]> = [
    ['README.md', `${BLOB}/README.md`],
    ['docs/research-agenda.md', `${BLOB}/docs/research-agenda.md`],
    ['docs/research/landscape-analysis.md', `${BLOB}/docs/research/landscape-analysis.md`],
    [
      'docs/disclosures.md#1-adr-0016-vocabulary-migration-shipped-ahead-of-the-notice-window-it-later-promised',
      `${BLOB}/docs/disclosures.md#1-adr-0016-vocabulary-migration-shipped-ahead-of-the-notice-window-it-later-promised`,
    ],
    [
      'docs/adr/0025-vocabulary-settlement-evidence-excision.md',
      `${BLOB}/docs/adr/0025-vocabulary-settlement-evidence-excision.md`,
    ],
  ];
  for (const [written, expected] of cases) {
    assert.equal(resolveRoadmapHref(written, base), expected, written);
  }
});

test('a relative link resolves against the source file\'s directory, at the source\'s ref', () => {
  const base = roadmapLinkBase(
    'https://raw.githubusercontent.com/example/plans/refs/heads/release/docs/roadmap/ROADMAP.md',
  );
  const blob = 'https://github.com/example/plans/blob/refs/heads/release';
  assert.equal(resolveRoadmapHref('archive/v1.md', base), `${blob}/docs/roadmap/archive/v1.md`);
  assert.equal(resolveRoadmapHref('./archive/v1.md', base), `${blob}/docs/roadmap/archive/v1.md`);
  assert.equal(resolveRoadmapHref('../adr/0001.md', base), `${blob}/docs/adr/0001.md`);
});

test('a source that is not on GitHub resolves against the fetched URL itself', () => {
  const base = roadmapLinkBase('https://plans.example.org/site/roadmap.md');
  assert.equal(resolveRoadmapHref('notes/q3.md', base), 'https://plans.example.org/site/notes/q3.md');
});

test('absolute URLs, other schemes, fragments and site paths are left as written', () => {
  const base = roadmapLinkBase(REFERENCE_RAW_URL);
  for (const href of [
    'https://github.com/npstorey/civic-ai-tools/issues/140',
    'http://example.org/x',
    'mailto:someone@example.org',
    '#5-now-next-later',
    '/records',
    '//example.org/x',
    '',
  ]) {
    assert.equal(resolveRoadmapHref(href, base), href, href);
  }
  assert.equal(resolveRoadmapHref(undefined, base), undefined);
});

// The preamble fold. Everything between the H1 and the first H2 renders behind a one-line
// summary; the shape below is the hub's ROADMAP.md at 6483894 (2026-10-12), cut short.

const REFERENCE_SHAPE = [
  '# civic-ai-tools — public roadmap',
  '',
  '**Last updated:** 2026-10-12',
  '**Next snapshot:** v2026.Q4, cut at quarter close (see Section 8)',
  '**Last change:** 2026-10-12 — the v2026.Q3 snapshot cut, late [civic#250].',
  '',
  '*This is the **live** roadmap.*',
  '',
  '*See also: [README](README.md) for project navigation.*',
  '',
  '---',
  '',
  '## 1. What this project is, and why',
  '',
  'A published analysis of open civic data should survive scrutiny.',
  '',
  '---',
  '',
  '## 2. Vision pillars',
  '',
].join('\n');

test('the reference preamble folds without its H1 or closing rule, and the summary reads its date', () => {
  const { preamble, body, lastUpdated } = splitRoadmapPreamble(REFERENCE_SHAPE);
  assert.equal(lastUpdated, '2026-10-12');
  assert.ok(preamble.startsWith('**Last updated:** 2026-10-12\n**Next snapshot:**'), preamble);
  assert.ok(preamble.endsWith('for project navigation.*'), preamble);
  assert.ok(!preamble.includes('public roadmap'), 'the H1 stays out of the fold');
  assert.ok(body.startsWith('## 1. What this project is, and why\n'), body);
  // Every section, and the rule between sections 1 and 2, stays in the body.
  assert.deepEqual(extractH2Headings(body), extractH2Headings(REFERENCE_SHAPE));
  assert.ok(body.includes('\n---\n\n## 2. Vision pillars'), body);
});

test('only the closing rule is dropped; a rule inside the preamble stays', () => {
  const { preamble } = splitRoadmapPreamble('# R\n\nFirst.\n\n***\n\nSecond.\n\n___\n\n## 1. One\n');
  assert.equal(preamble, 'First.\n\n***\n\nSecond.');
});

test('a preamble without a Last updated line still folds, with no date', () => {
  const { preamble, lastUpdated } = splitRoadmapPreamble('# R\n\nWhat this file is.\n\n## 1. One\n');
  assert.equal(preamble, 'What this file is.');
  assert.equal(lastUpdated, null);
});

test('nothing folds when the first section follows the H1 directly, or when there is no section', () => {
  assert.deepEqual(splitRoadmapPreamble('# R\n\n---\n\n## 1. One\nText.\n'), {
    preamble: '',
    body: '## 1. One\nText.\n',
    lastUpdated: null,
  });
  const flat = '# R\n\n**Last updated:** 2026-10-12\n\nNo sections.\n';
  assert.deepEqual(splitRoadmapPreamble(flat), { preamble: '', body: flat, lastUpdated: null });
});
