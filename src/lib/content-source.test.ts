// Content-source description tests (#241).
//
// describeContentSource is what keeps a byline honest: the visible label and
// the link target come out of the same parse of the same URL, so an instance
// that re-points a page cannot end up with a correct link under a stale
// label. directorySourceNote is the /directory attribution decision in one
// pure function.

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { describeContentSource, directorySourceNote } from './content-source.ts';

describe('describeContentSource', () => {
  test('GitHub raw URL: collapses to repo/path and links to the file page', () => {
    assert.deepEqual(
      describeContentSource('https://raw.githubusercontent.com/npstorey/civic-ai-tools/main/ROADMAP.md'),
      {
        label: 'civic-ai-tools/ROADMAP.md',
        href: 'https://github.com/npstorey/civic-ai-tools/blob/main/ROADMAP.md',
      }
    );
  });

  test('GitHub raw URL, nested path: keeps the whole path in the label', () => {
    assert.deepEqual(
      describeContentSource(
        'https://raw.githubusercontent.com/npstorey/civic-ai-tools/main/data/mcp-servers.json'
      ),
      {
        label: 'civic-ai-tools/data/mcp-servers.json',
        href: 'https://github.com/npstorey/civic-ai-tools/blob/main/data/mcp-servers.json',
      }
    );
  });

  test('GitHub raw URL, fully-qualified refs/heads form', () => {
    assert.deepEqual(
      describeContentSource(
        'https://raw.githubusercontent.com/acme/city-data/refs/heads/main/docs/ROADMAP.md'
      ),
      {
        label: 'city-data/docs/ROADMAP.md',
        href: 'https://github.com/acme/city-data/blob/refs/heads/main/docs/ROADMAP.md',
      }
    );
  });

  test('GitHub blob URL: same label, and links to itself', () => {
    const url = 'https://github.com/acme/city-data/blob/main/ROADMAP.md';
    assert.deepEqual(describeContentSource(url), { label: 'city-data/ROADMAP.md', href: url });
  });

  test('non-GitHub URL: host and path, linking to itself', () => {
    const url = 'https://data.example.gov/plans/roadmap.md';
    assert.deepEqual(describeContentSource(url), {
      label: 'data.example.gov/plans/roadmap.md',
      href: url,
    });
  });

  test('bare host: the host alone', () => {
    assert.deepEqual(describeContentSource('https://data.example.gov/'), {
      label: 'data.example.gov',
      href: 'https://data.example.gov/',
    });
  });

  test('unparseable value: passed through, so a misconfiguration is visible', () => {
    assert.deepEqual(describeContentSource('not a url'), {
      label: 'not a url',
      href: 'not a url',
    });
  });

  test('a raw URL too short to name a file falls through to host and path', () => {
    const url = 'https://raw.githubusercontent.com/acme/city-data/main';
    assert.deepEqual(describeContentSource(url), {
      label: 'raw.githubusercontent.com/acme/city-data/main',
      href: url,
    });
  });
});

describe('directorySourceNote', () => {
  test('instance source: no note — the entries belong to this site', () => {
    assert.equal(directorySourceNote('instance', 'https://example.org/mcp-servers.json'), null);
  });

  test('community source: an attribution note naming the upstream file', () => {
    assert.deepEqual(
      directorySourceNote(
        'community',
        'https://raw.githubusercontent.com/npstorey/civic-ai-tools/main/data/mcp-servers.json'
      ),
      {
        kind: 'community',
        source: {
          label: 'civic-ai-tools/data/mcp-servers.json',
          href: 'https://github.com/npstorey/civic-ai-tools/blob/main/data/mcp-servers.json',
        },
      }
    );
  });

  test('bundled snapshot: its own note, whichever source was configured', () => {
    assert.deepEqual(directorySourceNote('snapshot', 'https://example.org/mcp-servers.json'), {
      kind: 'snapshot',
    });
  });
});
