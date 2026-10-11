// The roadmap's relative links (C6 of the 2026-10-10 site-refresh inventory).
//
// /roadmap renders a markdown file fetched from another repository. Its
// relative links are written relative to that file, and rendered unchanged
// they resolved against this site: the five below all 404'd on
// civicaitools.org on 2026-10-10, read from the hub's ROADMAP.md at main.
// `resolveRoadmapHref` resolves them against the source file's page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoadmapHref, roadmapLinkBase } from './format.ts';

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
