// R6 W2 (#632, the ORCH's ruling on premise 7): `docs/flows-changelog.md` is
// the dated log of what the flows statement says, and each entry's versions
// are the code's under the configuration the entry names.
//
// THE FIXTURE CAN FAIL. The entry's base version and its three source
// versions are read from the log's text and compared with
// `buildFlowsStatementFor(null)` under that configuration: a change to a
// recipient, a posture or a variant moves a version and fails here until the
// log has an entry for it.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFlowsStatementFor } from './statement.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG = fs.readFileSync(path.resolve(HERE, '..', '..', '..', 'docs', 'flows-changelog.md'), 'utf8');

/** The configuration the first entry names; credential values are placeholders no version reads. */
const FIRST_ENTRY_ENV: Record<string, string> = {
  SOCRATA_MCP_URL: 'https://socrata-mcp.civicaitools.org',
  NYC_CHARTER_HOSTING: 'sandbox',
  VERCEL_ENV: 'production',
  GITHUB_CLIENT_ID: 'placeholder-client-id',
  GITHUB_CLIENT_SECRET: 'placeholder-client-value',
  EXECUTOR_DRIVER: 'vercel-sandbox',
};
const CLEARED = [
  'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME',
  'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL',
];

test('the first entry\'s base version and source versions are the code\'s under its configuration', () => {
  const names = [...Object.keys(FIRST_ENTRY_ENV), ...CLEARED];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of CLEARED) delete process.env[name];
    Object.assign(process.env, FIRST_ENTRY_ENV);
    const statement = buildFlowsStatementFor(null);
    const entry = LOG.slice(LOG.indexOf('## 2026-10-19'));
    assert.ok(entry.startsWith('## 2026-10-19'), 'the log has no 2026-10-19 entry');
    assert.ok(entry.includes(`**Base \`version\`:** \`${statement.version}\``), `the entry's base version is not ${statement.version}`);
    assert.deepEqual(statement.sources.map((s) => s.sourceId), ['socrata', 'data-commons', 'nyc-charter']);
    for (const source of statement.sources) {
      assert.ok(entry.includes(`| \`${source.sourceId}\` | \`${source.version}\` |`), `the entry's ${source.sourceId} version is not ${source.version}`);
    }
    assert.equal(statement.date, '2026-10-19');
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
