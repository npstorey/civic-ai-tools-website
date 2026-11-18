// CKAN-2-WEB P2 criterion 3 (npstorey/civic-ai-tools#329; Seat rulings 6991837731 fix 5 and 6992847297 fix 2): what
// the flows statement serves does not move at P2's merge where `CKAN_MCP_URL` is unset, and moves only by CKAN's
// portal line where it is set.
//
// WHY IT CAN MOVE. `statement.ts` imports from `../sources/copy.ts`, a file P2 edits, and P2 edits `statement.ts`
// itself, which holds `OPERATOR_NO_TRAINING_STATEMENT`, a sentence production's bytes carry.
//
// WHAT IS PINNED. `serializeFlowsStatement` (the bytes `/api/flows` serves) under three configurations, each computed
// at P2's base `c451a735` by the same builder:
//   - the 2026-11-14 change-log entry's (CKAN unset): sha256 `e8b9d621…`, 11,919 bytes;
//   - production's: that one plus `SITE_DEPLOYMENT_GUIDE_URL` at the deployment guide on `main` and
//     `SITE_OPERATOR_STATES_NO_TRAINING` set. sha256 `042d2c90…`, 12,048 bytes, the bytes the ORCH read from
//     production's `/api/flows` on both hosts at 22:00:30Z on 2026-11-18 (planning `temp/ckan/ckan2/web/p2-prod-flows/`);
//   - the 2026-11-14 entry's with `CKAN_MCP_URL` set to a fixture address: sha256 `33eeac21…`, 13,133 bytes. Here the
//     head's statement differs from the base's by exactly CKAN's portal line, CKAN's `version` and the `date`: put the
//     base's three back into the head's statement and the bytes are the base's, to the byte.
//
// WHAT MAKES IT ABLE TO FAIL. The first two are guards: they hold at the base and cannot be red there, so each was
// shown able to fail by a mutation run (an edit to `OPERATOR_NO_TRAINING_STATEMENT`, which only production's
// configuration reads, and an edit to the Socrata portal operator's line, which both read), run red and reverted
// (P2's report). The third is red at the base, at its look for the
// new holder: the base's CKAN row holds the City of Boston line. Any other change to the statement under that
// configuration fails its byte comparison.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildFlowsStatementFor, serializeFlowsStatement, type FlowsKeptBy, type FlowsStatement } from './statement.ts';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Every variable the statement reads that these configurations do not set (production's own and the test's). */
const CLEARED = [
  'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'SITE_DEPLOYMENT_GUIDE_URL', 'SITE_OPERATOR_STATES_NO_TRAINING', 'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY',
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'NYS_LEGISLATION_API_KEY',
  'CKAN_MCP_URL', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'DATABASE_URL',
];

/** The 2026-11-14 change-log entry's configuration (`changelog.test.ts`). Placeholders stand in for every key. */
const ENTRY_2026_11_14: Record<string, string> = {
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
const ANALYTICS = { service: 'plausible' as const, id: 'placeholder-analytics-id' };

/** Production's: the 2026-11-14 entry's plus the two settings production's served bytes show. */
const PRODUCTION: Record<string, string> = {
  ...ENTRY_2026_11_14,
  SITE_DEPLOYMENT_GUIDE_URL: 'https://github.com/npstorey/civic-ai-tools-website/blob/main/docs/deploy.md',
  SITE_OPERATOR_STATES_NO_TRAINING: '1',
};

const CKAN_HOST = 'ckan.fixture.example';
const WITH_CKAN: Record<string, string> = { ...ENTRY_2026_11_14, CKAN_MCP_URL: `https://${CKAN_HOST}` };

function statementUnder(env: Record<string, string>): FlowsStatement {
  const names = [...CLEARED, ...Object.keys(env)];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, env);
    return buildFlowsStatementFor(ANALYTICS);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('criterion 3: under the 2026-11-14 entry\'s configuration (CKAN unset), the served bytes are the base\'s', () => {
  const bytes = serializeFlowsStatement(statementUnder(ENTRY_2026_11_14));
  assert.equal(Buffer.byteLength(bytes), 11919, 'the bytes\' length moved');
  assert.equal(sha256(bytes), 'e8b9d621ec4376d73adf526058645fe8ebb17247d7b7ad43250a89dfaa3d1634');
});

test('criterion 3: under production\'s configuration (CKAN unset), the served bytes are the bytes production served before the merge', () => {
  const bytes = serializeFlowsStatement(statementUnder(PRODUCTION));
  assert.ok(bytes.includes('"operatorStatement"'), 'premise: the bytes carry the operator\'s no-training statement');
  assert.equal(Buffer.byteLength(bytes), 12048, 'the bytes\' length moved');
  assert.equal(sha256(bytes), '042d2c9046c28512bfed9e5fb1c8d93441595abaea23897431e2481741a0f7f6');
});

/** CKAN's portal line at the base (router 0.11.0's draft, form (i)), its row's `version` and the statement's `date`. */
const BASE_PORTAL_LINE: FlowsKeptBy = {
  holder: 'City of Boston',
  keeps: 'metadata',
  retention: "Under the City's records retention schedule; the statement gives no period for server logs.",
  statementUrl: 'https://www.boston.gov/government/cabinets/innovation-and-technology/terms-use-and-privacy-policy-city-boston-digital',
  readOn: '2026-11-16',
};
const BASE_CKAN_VERSION = '54302d5b21da2a5c5e1ff9ffbf18144086f32bda766ef7bf3065f28eb6c4895a';
const BASE_DATE = '2026-11-16';

test('criterion 3: with CKAN_MCP_URL set, the head differs from the base by exactly CKAN\'s portal line, CKAN\'s version and the date', () => {
  const head = statementUnder(WITH_CKAN);
  const ckan = head.sources.find((s) => s.sourceId === 'ckan-server');
  assert.ok(ckan, 'premise: the statement has a CKAN row');
  assert.equal(ckan!.recipients.length, 1, 'premise: CKAN\'s row has one recipient');
  assert.deepEqual(ckan!.recipients[0].keptBy, [
    { holder: `the operator of ${CKAN_HOST}`, keeps: 'operator-states' },
    { holder: 'the operator of each portal a call names (the record names each portal by its address)', keeps: 'not-read' },
  ], 'CKAN\'s holders are not the ruled two');
  assert.equal(head.date, '2026-10-20', 'the statement\'s date is not 2026-10-20');
  assert.notEqual(ckan!.version, BASE_CKAN_VERSION, 'CKAN\'s version did not move');
  // The base's three, put back: the bytes are the base's.
  const putBack = structuredClone(head);
  const row = putBack.sources.find((s) => s.sourceId === 'ckan-server')!;
  row.recipients[0].keptBy[1] = { ...BASE_PORTAL_LINE };
  row.version = BASE_CKAN_VERSION;
  putBack.date = BASE_DATE;
  const bytes = serializeFlowsStatement(putBack);
  assert.equal(Buffer.byteLength(bytes), 13133, 'another part of the statement moved (length)');
  assert.equal(sha256(bytes), '33eeac2141fed17a846b9ce608f58741cde6f59cab484dc03514363eaa0c7b35', 'another part of the statement moved');
});
