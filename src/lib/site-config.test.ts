// Instance content-source configuration tests (#241).
//
// Covers the /directory and /roadmap content-source getters in
// site-config.ts. The load-bearing property is what UNSET means: this
// instance has no content source of its own. The two pages then split —
// /directory keeps serving the shared community index (marked as such, so
// the page can attribute it), /roadmap resolves to null (no roadmap of our
// own, so none is presented as ours). Overrides are read at call time, not
// module load — same pattern as brand-config.test.ts.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  COMMUNITY_DIRECTORY_DATA_URL,
  COMMUNITY_DIRECTORY_SUBMIT_URL,
  DEFAULT_SPONSOR_PREFIX,
  getDirectorySource,
  getRoadmapSource,
  getSponsor,
} from './site-config.ts';

const CONTENT_SOURCE_VARS = [
  'DIRECTORY_DATA_URL',
  'ROADMAP_RAW_URL',
  'ROADMAP_GITHUB_URL',
  'SITE_SPONSOR_NAME',
  'SITE_SPONSOR_URL',
  'SITE_SPONSOR_PREFIX',
];

afterEach(() => {
  for (const v of CONTENT_SOURCE_VARS) delete process.env[v];
});

describe('getSponsor (#259 P4, D4 — a funding claim has no default)', () => {
  // This was a hardcoded non-null literal naming the reference deployment's
  // fiscal sponsor, rendered by the ROOT layout's footer — so it appeared on
  // the `(app)` surfaces of every instance, telling an operator's users that
  // their deployment was sponsored by an organization with no relationship
  // to it. There is no honest default for who funds a deployment.
  test('unset: no sponsor, so no line', () => {
    assert.equal(getSponsor(), null);
  });

  test('a URL alone is not a sponsor — the NAME is what gates the line', () => {
    process.env.SITE_SPONSOR_URL = 'https://example.org';
    process.env.SITE_SPONSOR_PREFIX = 'Funded by';
    assert.equal(getSponsor(), null);
  });

  test('name only: rendered unlinked, with the generic prefix', () => {
    process.env.SITE_SPONSOR_NAME = 'Alt City Civic Trust';
    assert.deepEqual(getSponsor(), {
      prefix: DEFAULT_SPONSOR_PREFIX,
      name: 'Alt City Civic Trust',
      url: null,
    });
  });

  test('full configuration, read at call time', () => {
    process.env.SITE_SPONSOR_NAME = 'Alt City Civic Trust';
    process.env.SITE_SPONSOR_URL = 'https://trust.example.org';
    process.env.SITE_SPONSOR_PREFIX = 'Funded by';
    assert.deepEqual(getSponsor(), {
      prefix: 'Funded by',
      name: 'Alt City Civic Trust',
      url: 'https://trust.example.org',
    });
  });

  test('the default prefix names a relationship, not an organization', () => {
    assert.equal(DEFAULT_SPONSOR_PREFIX, 'Fiscally sponsored by');
  });
});

describe('COMMUNITY_DIRECTORY_SUBMIT_URL (#259 P4, D7)', () => {
  test('points at the same project as the community index it feeds', () => {
    const submitHost = new URL(COMMUNITY_DIRECTORY_SUBMIT_URL).pathname.split('/').slice(1, 3).join('/');
    assert.equal(submitHost, 'npstorey/civic-ai-tools');
    assert.ok(COMMUNITY_DIRECTORY_DATA_URL.includes('npstorey/civic-ai-tools'));
  });
});

describe('getDirectorySource (shared community index when unconfigured)', () => {
  test('unset: the community index, marked as not belonging to this instance', () => {
    assert.deepEqual(getDirectorySource(), {
      url: COMMUNITY_DIRECTORY_DATA_URL,
      provenance: 'community',
    });
    assert.equal(
      COMMUNITY_DIRECTORY_DATA_URL,
      'https://raw.githubusercontent.com/npstorey/civic-ai-tools/main/data/mcp-servers.json'
    );
  });

  test('set: the source belongs to this instance, read at call time', () => {
    process.env.DIRECTORY_DATA_URL = 'https://example.org/mcp-servers.json';
    assert.deepEqual(getDirectorySource(), {
      url: 'https://example.org/mcp-servers.json',
      provenance: 'instance',
    });
  });

  test('empty string counts as unset, matching the rest of site-config.ts', () => {
    process.env.DIRECTORY_DATA_URL = '';
    assert.equal(getDirectorySource().provenance, 'community');
  });

  test('the roadmap variables do not affect the directory source', () => {
    process.env.ROADMAP_RAW_URL = 'https://example.org/ROADMAP.md';
    assert.equal(getDirectorySource().provenance, 'community');
  });
});

describe('getRoadmapSource (null when the instance has no roadmap of its own)', () => {
  test('unset: null — no fallback to any other roadmap', () => {
    assert.equal(getRoadmapSource(), null);
  });

  test('empty string counts as unset', () => {
    process.env.ROADMAP_RAW_URL = '';
    assert.equal(getRoadmapSource(), null);
  });

  test('raw URL alone: the view URL and label are derived from it', () => {
    process.env.ROADMAP_RAW_URL =
      'https://raw.githubusercontent.com/acme/city-data/main/ROADMAP.md';
    assert.deepEqual(getRoadmapSource(), {
      rawUrl: 'https://raw.githubusercontent.com/acme/city-data/main/ROADMAP.md',
      viewUrl: 'https://github.com/acme/city-data/blob/main/ROADMAP.md',
      label: 'city-data/ROADMAP.md',
    });
  });

  test('both set: the explicit view URL wins and the label follows IT, not the raw URL', () => {
    process.env.ROADMAP_RAW_URL = 'https://cdn.example.org/exports/plan.md';
    process.env.ROADMAP_GITHUB_URL = 'https://github.com/acme/city-data/blob/main/docs/PLAN.md';
    const source = getRoadmapSource();
    assert.ok(source);
    assert.equal(source.viewUrl, 'https://github.com/acme/city-data/blob/main/docs/PLAN.md');
    // The label-vs-link drift PR #242 flagged: one derivation, so the visible
    // label can never name a file the link does not point at.
    assert.equal(source.label, 'city-data/docs/PLAN.md');
  });

  test('view URL alone (no raw URL) does not conjure a roadmap', () => {
    process.env.ROADMAP_GITHUB_URL = 'https://github.com/acme/city-data/blob/main/ROADMAP.md';
    assert.equal(getRoadmapSource(), null);
  });

  test('the reference deployment configured explicitly renders the byline it has today', () => {
    process.env.ROADMAP_RAW_URL =
      'https://raw.githubusercontent.com/npstorey/civic-ai-tools/main/ROADMAP.md';
    process.env.ROADMAP_GITHUB_URL =
      'https://github.com/npstorey/civic-ai-tools/blob/main/ROADMAP.md';
    const source = getRoadmapSource();
    assert.ok(source);
    assert.equal(source.label, 'civic-ai-tools/ROADMAP.md');
    assert.equal(source.viewUrl, 'https://github.com/npstorey/civic-ai-tools/blob/main/ROADMAP.md');
  });
});
