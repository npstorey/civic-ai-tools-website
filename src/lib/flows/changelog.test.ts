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
// R8 G9 leg 4 (#644): the 2026-10-21 entry is the second configuration, the
// day the three switches turned on in production. Its versions are read from
// that entry's own section, never the whole log: its base version and three
// of its six source versions also appear in the older entries, so a search of
// the whole log could not fail on them.
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

/** One entry's section of the log: from its heading to the next heading, or `''` when the log has none. */
function entryOf(date: string): string {
  const start = LOG.indexOf(`\n## ${date}`);
  if (start === -1) return '';
  const end = LOG.indexOf('\n## ', start + 1);
  return LOG.slice(start + 1, end === -1 ? undefined : end);
}

/**
 * The configuration the first entry names: the reference instance's, as its
 * privacy page stated it on 2026-10-19. The sign-in pair, the analytics id and
 * `VERCEL_ENV` are read for their presence only, so placeholders stand in.
 */
const FIRST_ENTRY_ENV: Record<string, string> = {
  SOCRATA_MCP_URL: 'https://socrata-mcp.civicaitools.org',
  NYC_CHARTER_HOSTING: 'sandbox',
  VERCEL_ENV: 'production',
  GITHUB_CLIENT_ID: 'placeholder-client-id',
  GITHUB_CLIENT_SECRET: 'placeholder-client-value',
  EXECUTOR_DRIVER: 'vercel-sandbox',
  NEXT_PUBLIC_ANALYTICS_SERVICE: 'plausible',
  NEXT_PUBLIC_ANALYTICS_ID: 'placeholder-analytics-id',
};
/**
 * What `resolveAnalytics` (`src/lib/analytics.tsx`) answers for the analytics
 * pair above. The statement reads only its `service`; the `.tsx` module is not
 * loadable under the test runner, so the resolved value is passed here, and
 * the second assertion below shows the id does not reach the versions.
 */
const ANALYTICS = { service: 'plausible' as const, id: 'placeholder-analytics-id' };
const CLEARED = [
  'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'SITE_DEPLOYMENT_GUIDE_URL', 'SITE_OPERATOR_STATES_NO_TRAINING', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME',
  'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL',
  'NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING', 'NYS_LEGISLATION_API_KEY',
];
/**
 * The configuration the 2026-10-21 entry names: the first entry's, with the
 * three switches the reference instance turned on in production that day
 * (R8 G9 leg 4) and State legislation's key. The key is read for its presence
 * only (with its switch on and the key unset, the source is not configured),
 * so a placeholder stands in, never the real key.
 */
const SWITCHES_ENTRY_ENV: Record<string, string> = {
  ...FIRST_ENTRY_ENV,
  NYC_CHECKBOOK_HOSTING: 'sandbox',
  NYC_RECORD_HOSTING: 'sandbox',
  NYS_LEGISLATION_HOSTING: 'sandbox',
  NYS_LEGISLATION_API_KEY: 'placeholder-key',
};

test('the first entry\'s base version and source versions are the code\'s under its configuration', () => {
  const names = [...Object.keys(FIRST_ENTRY_ENV), ...CLEARED];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of CLEARED) delete process.env[name];
    Object.assign(process.env, FIRST_ENTRY_ENV);
    const statement = buildFlowsStatementFor(ANALYTICS);
    assert.equal(buildFlowsStatementFor({ ...ANALYTICS, id: 'another-id' }).version, statement.version, 'the analytics id reaches the base version');
    assert.ok(statement.recipients.some((r) => r.id === 'analytics:plausible'), 'premise: the entry\'s configuration has Plausible analytics');
    const entry = LOG.slice(LOG.indexOf('## 2026-10-19'));
    assert.ok(entry.startsWith('## 2026-10-19'), 'the log has no 2026-10-19 entry');
    assert.ok(entry.includes(`**Base \`version\`:** \`${statement.version}\``), `the entry's base version is not ${statement.version}`);
    assert.deepEqual(statement.sources.map((s) => s.sourceId), ['socrata', 'data-commons', 'nyc-charter']);
    for (const source of statement.sources) {
      assert.ok(entry.includes(`| \`${source.sourceId}\` | \`${source.version}\` |`), `the entry's ${source.sourceId} version is not ${source.version}`);
    }
    // The content date moved with W3's re-read of Vercel's snapshots page
    // (2026-10-20); that day's entry states it, and no version moved with it.
    const consentSurfaces = entryOf('2026-10-20');
    assert.ok(consentSurfaces.startsWith('## 2026-10-20'), 'the log has no 2026-10-20 entry');
    assert.ok(consentSurfaces.includes(`**\`date\`:** ${statement.date}`), `the 2026-10-20 entry does not state the statement's date ${statement.date}`);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('the 2026-10-21 entry\'s base version and six source versions are the code\'s under its configuration', (t) => {
  const names = [...Object.keys(SWITCHES_ENTRY_ENV), ...CLEARED];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  // The keyless reading below logs one line naming the key; it is not this test's output.
  t.mock.method(console, 'warn', () => {});
  try {
    for (const name of CLEARED) delete process.env[name];
    Object.assign(process.env, SWITCHES_ENTRY_ENV);
    const statement = buildFlowsStatementFor(ANALYTICS);
    // Premises: the key's presence is what keeps State legislation in the
    // statement, and its value reaches no version.
    process.env.NYS_LEGISLATION_API_KEY = 'another-placeholder-key';
    const anotherKey = buildFlowsStatementFor(ANALYTICS);
    assert.deepEqual(anotherKey.sources.map((s) => s.version), statement.sources.map((s) => s.version), 'the key\'s value reaches a source version');
    delete process.env.NYS_LEGISLATION_API_KEY;
    assert.ok(!buildFlowsStatementFor(ANALYTICS).sources.some((s) => s.sourceId === 'nys-legislation'), 'premise: with the key unset, State legislation is not configured');
    const entry = entryOf('2026-10-21');
    assert.ok(entry.startsWith('## 2026-10-21'), 'the log has no 2026-10-21 entry');
    assert.ok(entry.includes(`**Base \`version\`:** \`${statement.version}\``), `the 2026-10-21 entry's base version is not ${statement.version}`);
    assert.deepEqual(statement.sources.map((s) => s.sourceId), ['socrata', 'data-commons', 'nyc-charter', 'nyc-checkbook', 'nyc-record', 'nys-legislation']);
    for (const source of statement.sources) {
      assert.ok(entry.includes(`| \`${source.sourceId}\` | \`${source.version}\` |`), `the 2026-10-21 entry's ${source.sourceId} version is not ${source.version}`);
    }
    // The three new sources' statements were read on or before 2026-10-20, so
    // the content date does not move; the newest entry states it.
    const newest = LOG.slice(LOG.indexOf('\n## ') + 1);
    assert.ok(newest.startsWith('## 2026-10-21'), 'the newest entry is not 2026-10-21');
    assert.ok(entry.includes(`**\`date\`:** ${statement.date}`), `the 2026-10-21 entry does not state the statement's date ${statement.date}`);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
