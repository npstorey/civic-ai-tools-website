// R6 W2 (#632, the ORCH's ruling on premise 7): `docs/flows-changelog.md` is
// the dated log of what the flows statement says, and each entry's versions
// are the code's under the configuration the entry names.
//
// THE FIXTURE CAN FAIL. The newest entry's base version and source versions
// are read from the log's text and compared with `buildFlowsStatementFor`
// under that configuration: a change to a recipient, a posture or a variant
// moves a version and fails here until the log has an entry for it.
//
// R8 G9 leg 4 (#644): the 2026-10-21 entry is the second configuration, the
// day the three switches turned on in production. Each entry's versions are
// read from that entry's own section, never the whole log: a base version and
// most source versions also appear in the older entries, so a search of the
// whole log could not fail on them.
//
// S2-B (npstorey/civic-ai-tools#309; the seat's ruling 3): since router 0.8.0
// NYC City Record is a pack over the Socrata server, so the code no longer
// produces the statements the earlier entries record (the 2026-10-19
// configuration now has a City Record row; the 2026-10-21 one's City Record
// variant is gone). An earlier entry is history: it is held to the versions
// it recorded, written out below, and its text to its bytes at f0c1eca. Only
// the newest entry is recomputed.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFlowsStatementFor } from './statement.ts';
import { cookieConsentInForce } from '../sources/consent.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG = fs.readFileSync(path.resolve(HERE, '..', '..', '..', 'docs', 'flows-changelog.md'), 'utf8');

/** One entry's section of the log: from its heading to the next heading, or `''` when the log has none. */
function entryOf(date: string): string {
  const start = LOG.indexOf(`\n## ${date}`);
  if (start === -1) return '';
  const end = LOG.indexOf('\n## ', start + 1);
  return LOG.slice(start + 1, end === -1 ? undefined : end);
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

// --- The earlier entries: history -----------------------------------------------------------

/** Each earlier entry's section, its SHA-256 at f0c1eca (the base of S2-B's website leg). */
const ENTRY_TEXT_AT_F0C1ECA: Readonly<Record<string, string>> = {
  '2026-10-21': 'de880afeeed2626e26c6aafebd3a95fee93e6d16ff79a49d30eebf8fb3bcefd2',
  '2026-10-20': '6bbab2956dafdd00bcc66128d056489352c64c29a85e27734e90beab67738ceb',
  '2026-10-19': '6069509eb78be587630eb8bf3649f1a3c6d09ce1a35cba2d36d7658e4c2d634c',
};

/** The versions each earlier entry recorded, as the code produced them under its configuration when it was written. */
const RECORDED: Readonly<Record<string, { base: string; sources: Readonly<Record<string, string>> }>> = {
  '2026-10-19': {
    base: '2489d0dda25a79b3286c380379c6d2c8202e66a77fe5b4f493f558a7ce190f9c',
    sources: {
      socrata: 'fe99ec852eb7bfa3c95ce0db20cf5d2c7411b79b1e61c5ddbad3c19190a61629',
      'data-commons': 'a0d757284510792921c7889ed537e75ebbc9890a1f96c71b0fe393bc46ceb334',
      'nyc-charter': 'e381ddafc6d461ef1fdb913270aaac637d51801909613f6d7dc495fbcf6c7e61',
    },
  },
  '2026-10-21': {
    base: '2489d0dda25a79b3286c380379c6d2c8202e66a77fe5b4f493f558a7ce190f9c',
    sources: {
      socrata: 'fe99ec852eb7bfa3c95ce0db20cf5d2c7411b79b1e61c5ddbad3c19190a61629',
      'data-commons': 'a0d757284510792921c7889ed537e75ebbc9890a1f96c71b0fe393bc46ceb334',
      'nyc-charter': 'e381ddafc6d461ef1fdb913270aaac637d51801909613f6d7dc495fbcf6c7e61',
      'nyc-checkbook': 'bb350a722fbf9a740096edbb561d00182bd4c9841d3254336a61ebfadeb17ec4',
      'nyc-record': 'd1f97a2e2eb4d52cd31119f384047a96c19fa60b3a386999d13b1bb58bf36f43',
      'nys-legislation': '83b334e65e930c58f4adca15b11fe59e04e212c978fbd60d1b645693d587adf8',
    },
  },
};

for (const [date, sha] of Object.entries(ENTRY_TEXT_AT_F0C1ECA)) {
  test(`the ${date} entry's text is its text at f0c1eca, byte for byte`, () => {
    const entry = entryOf(date);
    assert.ok(entry.startsWith(`## ${date}`), `the log has no ${date} entry`);
    assert.equal(sha256(entry), sha, `the ${date} entry was edited: an entry before the newest is history`);
  });
}

for (const [date, recorded] of Object.entries(RECORDED)) {
  test(`the ${date} entry states the base version and source versions it recorded`, () => {
    const entry = entryOf(date);
    assert.ok(entry.includes(`**Base \`version\`:** \`${recorded.base}\``), `the ${date} entry's base version is not ${recorded.base}`);
    for (const [sourceId, version] of Object.entries(recorded.sources)) {
      assert.ok(entry.includes(`| \`${sourceId}\` | \`${version}\` |`), `the ${date} entry's ${sourceId} version is not ${version}`);
    }
  });
}

test('the 2026-10-20 entry states the statement\'s date it moved to', () => {
  assert.ok(entryOf('2026-10-20').includes('**`date`:** 2026-10-20'), 'the 2026-10-20 entry does not state the date 2026-10-20');
});

// --- The newest entry: recomputed -----------------------------------------------------------

/** The newest entry. */
const NEWEST = '2026-11-14';

/**
 * The configuration the newest entry names: the 2026-10-21 entry's, without
 * City Record's switch (retired by router 0.8.0). The sign-in pair, the
 * analytics id, `VERCEL_ENV` and State legislation's key are read for their
 * presence only, so placeholders stand in, never the real key.
 */
const NEWEST_ENTRY_ENV: Record<string, string> = {
  SOCRATA_MCP_URL: 'https://socrata-mcp.civicaitools.org',
  NYC_CHARTER_HOSTING: 'sandbox',
  NYC_CHECKBOOK_HOSTING: 'sandbox',
  NYS_LEGISLATION_HOSTING: 'sandbox',
  NYS_LEGISLATION_API_KEY: 'placeholder-key',
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
 * the test below shows the id does not reach the versions.
 */
const ANALYTICS = { service: 'plausible' as const, id: 'placeholder-analytics-id' };
const CLEARED = [
  'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'SITE_DEPLOYMENT_GUIDE_URL', 'SITE_OPERATOR_STATES_NO_TRAINING', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME',
  'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL',
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'NYS_LEGISLATION_API_KEY',
];

/** The statement under the newest entry's configuration, with the environment put back after. */
function newestStatement() {
  const names = [...Object.keys(NEWEST_ENTRY_ENV), ...CLEARED];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of CLEARED) delete process.env[name];
    Object.assign(process.env, NEWEST_ENTRY_ENV);
    return { statement: buildFlowsStatementFor(ANALYTICS), anotherId: buildFlowsStatementFor({ ...ANALYTICS, id: 'another-id' }) };
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test(`the ${NEWEST} entry is the newest, and its base version, six source versions and date are the code's under its configuration`, () => {
  const { statement, anotherId } = newestStatement();
  assert.equal(anotherId.version, statement.version, 'the analytics id reaches the base version');
  const newest = LOG.slice(LOG.indexOf('\n## ') + 1);
  assert.ok(newest.startsWith(`## ${NEWEST}`), `the newest entry is not ${NEWEST}`);
  const entry = entryOf(NEWEST);
  assert.ok(entry.includes(`**Base \`version\`:** \`${statement.version}\``), `the ${NEWEST} entry's base version is not ${statement.version}`);
  assert.deepEqual(statement.sources.map((s) => s.sourceId), ['socrata', 'data-commons', 'nyc-charter', 'nyc-checkbook', 'nyc-record', 'nys-legislation']);
  for (const source of statement.sources) {
    assert.ok(entry.includes(`| \`${source.sourceId}\` | \`${source.version}\` |`), `the ${NEWEST} entry's ${source.sourceId} version is not ${source.version}`);
  }
  assert.ok(entry.includes(`**\`date\`:** ${statement.date}`), `the ${NEWEST} entry does not state the statement's date ${statement.date}`);
});

test(`the ${NEWEST} entry's consent effect, as measured: a consent given against the 2026-10-21 entry is asked again about City Record and nothing else`, () => {
  const { statement } = newestStatement();
  const recorded = RECORDED['2026-10-21'];
  const cookie = {
    v: 1 as const,
    flows: recorded.base,
    states: Object.fromEntries(Object.entries(recorded.sources).map(([sourceId, version]) => [sourceId, { state: 'on' as const, since: '2026-10-21', version }])),
  };
  assert.deepEqual(cookieConsentInForce(cookie, statement), { inForce: false, reask: { base: false, sources: ['nyc-record'] } });
  assert.ok(entryOf(NEWEST).includes('A reader who\n  answered before this change is asked again about City Record, and about\n  nothing else.'), `the ${NEWEST} entry does not state the consent effect as measured`);
});

// --- S2-B W8 (npstorey/civic-ai-tools#309): City Record through the Socrata server -------------
//
// Since router 0.8.0 City Record is a pack over the Socrata server: its
// requests reach `data.cityofnewyork.us` through that server, so its one
// recipient is the remote kind at the Socrata server's host with the Socrata
// roles, and no recipient is its own upstream (`source:nyc-record:<host>`).
// Under the 2026-10-21 entry's configuration less the retired switch, the base
// version is that entry's and every other source's version is too; City
// Record's moves. At f0c1eca (router 0.6.0) City Record is offered only by its
// switch, so with the switch unset the statement has no row for it.

test('S2-B W8: under the 2026-10-21 configuration less the retired switch, City Record is one remote recipient at the Socrata server\'s host', () => {
  const { statement } = newestStatement();
  const record = statement.sources.find((s) => s.sourceId === 'nyc-record');
  assert.ok(record, `the statement has no nyc-record row: ${statement.sources.map((s) => s.sourceId).join(', ')}`);
  const socrata = statement.sources.find((s) => s.sourceId === 'socrata');
  assert.ok(socrata, 'premise: the statement has a socrata row');
  const host = new URL(NEWEST_ENTRY_ENV.SOCRATA_MCP_URL).host;
  assert.equal(record!.variant.kind, 'remote', 'City Record is not the remote kind');
  assert.equal(record!.host, host, 'City Record\'s row is not at the Socrata server\'s host');
  assert.deepEqual(record!.recipients.map((r) => ({ id: r.id, role: r.role, host: r.host })), [{ id: 'source:nyc-record', role: 'source', host }], 'City Record does not have one recipient at the Socrata server\'s host');
  assert.deepEqual(record!.recipients[0].keptBy, socrata!.recipients[0].keptBy, 'City Record\'s recipient does not hold the Socrata roles');
  const everyRecipient = [...statement.recipients, ...statement.sources.flatMap((s) => s.recipients)];
  assert.deepEqual(everyRecipient.filter((r) => r.id.startsWith('source:nyc-record:')).map((r) => r.id), [], 'a recipient is City Record\'s own upstream');
  const recorded = RECORDED['2026-10-21'];
  assert.equal(statement.version, recorded.base, `the base version moved: ${statement.version}`);
  for (const source of statement.sources.filter((s) => s.sourceId !== 'nyc-record')) {
    assert.equal(source.version, recorded.sources[source.sourceId], `${source.sourceId}'s version moved: ${source.version}`);
  }
  assert.notEqual(record!.version, recorded.sources['nyc-record'], 'City Record\'s version did not move');
});
