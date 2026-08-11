// Instance content-source configuration tests (#241).
//
// Covers the /directory and /roadmap content-source getters in
// site-config.ts: with no environment set, each getter must return the
// demo deployment's historical hardcoded URL byte-identically (the
// byte-parity bar); with the corresponding variable set, the override must
// flow through at call time, not module load — same pattern as
// brand-config.test.ts.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  DEMO_DIRECTORY_DATA_URL,
  DEMO_ROADMAP_RAW_URL,
  DEMO_ROADMAP_GITHUB_URL,
  getDirectoryDataUrl,
  getRoadmapRawUrl,
  getRoadmapGithubUrl,
} from './site-config.ts';

const CONTENT_SOURCE_VARS = ['DIRECTORY_DATA_URL', 'ROADMAP_RAW_URL', 'ROADMAP_GITHUB_URL'];

afterEach(() => {
  for (const v of CONTENT_SOURCE_VARS) delete process.env[v];
});

describe('instance content-source getters (call-time env, demo defaults)', () => {
  test('unset environment yields the demo civic-ai-tools hub URLs (byte-parity bar)', () => {
    assert.equal(getDirectoryDataUrl(), DEMO_DIRECTORY_DATA_URL);
    assert.equal(
      getDirectoryDataUrl(),
      'https://raw.githubusercontent.com/npstorey/civic-ai-tools/main/data/mcp-servers.json'
    );
    assert.equal(getRoadmapRawUrl(), DEMO_ROADMAP_RAW_URL);
    assert.equal(
      getRoadmapRawUrl(),
      'https://raw.githubusercontent.com/npstorey/civic-ai-tools/main/ROADMAP.md'
    );
    assert.equal(getRoadmapGithubUrl(), DEMO_ROADMAP_GITHUB_URL);
    assert.equal(
      getRoadmapGithubUrl(),
      'https://github.com/npstorey/civic-ai-tools/blob/main/ROADMAP.md'
    );
  });

  test('set variables override at call time, not module load', () => {
    process.env.DIRECTORY_DATA_URL = 'https://example.org/mcp-servers.json';
    process.env.ROADMAP_RAW_URL = 'https://example.org/ROADMAP.md';
    process.env.ROADMAP_GITHUB_URL = 'https://github.com/example/repo/blob/main/ROADMAP.md';
    assert.equal(getDirectoryDataUrl(), 'https://example.org/mcp-servers.json');
    assert.equal(getRoadmapRawUrl(), 'https://example.org/ROADMAP.md');
    assert.equal(getRoadmapGithubUrl(), 'https://github.com/example/repo/blob/main/ROADMAP.md');
  });

  test('empty strings fall back to the defaults, matching the rest of site-config.ts', () => {
    process.env.DIRECTORY_DATA_URL = '';
    process.env.ROADMAP_RAW_URL = '';
    process.env.ROADMAP_GITHUB_URL = '';
    assert.equal(getDirectoryDataUrl(), DEMO_DIRECTORY_DATA_URL);
    assert.equal(getRoadmapRawUrl(), DEMO_ROADMAP_RAW_URL);
    assert.equal(getRoadmapGithubUrl(), DEMO_ROADMAP_GITHUB_URL);
  });

  test('each getter is independently overridable', () => {
    process.env.DIRECTORY_DATA_URL = 'https://example.org/mcp-servers.json';
    assert.equal(getDirectoryDataUrl(), 'https://example.org/mcp-servers.json');
    assert.equal(getRoadmapRawUrl(), DEMO_ROADMAP_RAW_URL);
    assert.equal(getRoadmapGithubUrl(), DEMO_ROADMAP_GITHUB_URL);
  });
});
