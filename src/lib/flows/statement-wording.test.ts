// R6 W3 (#632), criteria 5 and 12: what the flows statement says, and that
// saying it differently re-asks no one.
//
// CRITERION 12 (G0 premises 9-11).
//   - The omitted-guide line (`links.deploymentGuideOmitted`) is Text 3's
//     no-guide sentence, the one the card, the panel, the tab and the privacy
//     page say (`NO_GUIDE_SENTENCE` in `src/lib/sources/copy.ts`).
//   - The sandbox line is two lines: this site's setting (the hosted source's
//     sandbox is created persistent and keeps its last snapshot,
//     `src/lib/mcp/hosting/lifecycle.ts`), and Vercel's own statement on how
//     long it keeps a snapshot, quoted with its page's address and the date it
//     was read.
//   - None of it moves a version: the base version covers the instance-level
//     recipients' arrangements and postures only (`computeBaseVersion`), and a
//     source's version its variant, host and postures (`computeSourceVersion`);
//     wording, addresses, dates and basis lines are none of those. So the
//     anonymous cookie and the signed-in row given against the first change
//     log entry are still in force (`cookieConsentInForce`,
//     `classifyFlowsChange`), and only the statement's hash moves, which the
//     log's new dated entry records.
//
// CRITERION 5 (D10). `/api/flows` carries the deployment guide's address from
// `SITE_DEPLOYMENT_GUIDE_URL` when it is set, and states the omission when it
// is not.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the omitted-guide line is W2's
// sentence, the sandbox line is one sentence holding both facts, no variable
// sets the guide's address, and the log has one entry. The three version
// checks are green at the base, and stay green: they are the guard that the
// wording change re-asks no one.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFlowsStatementFor, statementHash, type FlowsStatement } from './statement.ts';
import { classifyFlowsChange, cookieConsentInForce } from '../sources/consent.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const LOG = fs.readFileSync(path.join(REPO, 'docs', 'flows-changelog.md'), 'utf8');

/** The copy W3 adds (a specifier typed `string`, so the red commit type-checks). */
const COPY: string = '../sources/copy.ts';
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const copy = (await import(COPY).catch(() => null)) as Mod | null;

/** The first change log entry's configuration, as `changelog.test.ts` reads it. */
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
const ANALYTICS = { service: 'plausible' as const, id: 'placeholder-analytics-id' };
const CLEARED = [
  'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME',
  'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'APP_HOST', 'NEXTAUTH_URL',
];

function under(env: Record<string, string>): FlowsStatement {
  const names = [...Object.keys(FIRST_ENTRY_ENV), ...CLEARED, ...Object.keys(env)];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of CLEARED) delete process.env[name];
    Object.assign(process.env, FIRST_ENTRY_ENV, env);
    return buildFlowsStatementFor(ANALYTICS);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const STATEMENT = under({});
const GUIDE = 'https://guide.fixture.example/deploy';

/** The versions the first entry records, read from the log. */
const FIRST = LOG.slice(LOG.indexOf('## 2026-10-19'));
const LOGGED_BASE = /\*\*Base `version`:\*\* `([0-9a-f]{64})`/.exec(FIRST)?.[1];
const loggedSource = (id: string) => new RegExp(`\\| \`${id}\` \\| \`([0-9a-f]{64})\` \\|`).exec(FIRST)?.[1];

// --- The omitted-guide line, and the address (criteria 12 and 5) ---------------------------

test('criterion 12: unset, the statement\'s omitted-guide line is Text 3\'s no-guide sentence', () => {
  assert.ok(copy && typeof copy.NO_GUIDE_SENTENCE === 'string', `${COPY} exports no NO_GUIDE_SENTENCE`);
  assert.equal(STATEMENT.links.deploymentGuideOmitted, copy!.NO_GUIDE_SENTENCE);
});

test('criterion 5: set, /api/flows carries the deployment guide\'s address and states no omission', () => {
  const statement = under({ SITE_DEPLOYMENT_GUIDE_URL: GUIDE });
  const links = statement.links as unknown as Record<string, unknown>;
  assert.equal(links.deploymentGuide, GUIDE, `the statement does not carry the guide's address: ${JSON.stringify(links)}`);
  assert.equal(links.deploymentGuideOmitted, undefined, 'the statement says the guide is omitted while it names one');
});

// --- The sandbox line, split (criterion 12) -----------------------------------------------

test('criterion 12: the sandbox line is two: this site\'s setting, and Vercel\'s own statement quoted with its page and read date', () => {
  const charter = STATEMENT.sources.find((s) => s.sourceId === 'nyc-charter');
  assert.ok(charter, 'premise: Charter is hosted under the first entry\'s configuration');
  const basis = charter!.recipients.flatMap((r) => r.keptBy).flatMap((k) => k.basis ?? []);
  // The defect was one sentence holding both: this site's setting and Vercel's statement.
  assert.ok(!basis.some((line) => /persistent/.test(line) && /vercel\.com/.test(line)), `one line still holds this site's setting and Vercel's statement: ${basis.find((l) => /persistent/.test(l))}`);
  const setting = basis.filter((line) => /persistent/.test(line) && /snapshot/.test(line));
  assert.equal(setting.length, 1, 'no line states this site\'s sandbox setting');
  assert.ok(setting[0].includes('src/lib/mcp/hosting/lifecycle.ts'), 'the setting is not read from lifecycle.ts');
  const vercel = basis.filter((line) => /https:\/\/vercel\.com\/docs\/vercel-sandbox\S*/.test(line) && /\b\d{4}-\d{2}-\d{2}\b/.test(line) && /["“][^"”]+["”]/.test(line));
  assert.equal(vercel.length, 1, `no line quotes Vercel's statement with its page and read date: ${JSON.stringify(basis)}`);
  assert.match(vercel[0], /30 days/, 'Vercel\'s quoted statement does not say how long it keeps a snapshot');
});

// Flag 3 (the ORCH's ruling): the statement cites lifecycle.ts's figure without
// importing it (the module does not export it, and it is read-only to W3), so
// the figure is read from that file's text and compared with the statement's.
test('criterion 12 (flag 3): the setting\'s figure is lifecycle.ts\'s SNAPSHOT_EXPIRATION_MS, read from the file', () => {
  const lifecycle = fs.readFileSync(path.join(REPO, 'src', 'lib', 'mcp', 'hosting', 'lifecycle.ts'), 'utf8');
  const m = /const SNAPSHOT_EXPIRATION_MS = ([0-9_ *]+);/.exec(lifecycle);
  assert.ok(m, 'premise: lifecycle.ts declares SNAPSHOT_EXPIRATION_MS as a product of literals');
  const ms = m![1].split('*').map((f) => Number(f.trim().replace(/_/g, ''))).reduce((a, b) => a * b, 1);
  const days = ms / (24 * 60 * 60 * 1000);
  const charter = STATEMENT.sources.find((s) => s.sourceId === 'nyc-charter');
  const setting = charter!.recipients.flatMap((r) => r.keptBy).flatMap((k) => k.basis ?? []).find((line) => /this site's setting/.test(line));
  assert.ok(setting, 'premise: the statement states this site\'s setting');
  const stated = /expire (\d+) days after its last use/.exec(setting!)?.[1];
  assert.equal(Number(stated), days, `the statement says ${stated} days; lifecycle.ts sets ${days}`);
});

// --- None of it re-asks (criterion 12; green at the base, and must stay green) ------------------

test('criterion 12 (guard): the base version and every source version are the first entry\'s', () => {
  assert.ok(LOGGED_BASE, 'premise: the log records a base version');
  assert.equal(STATEMENT.version, LOGGED_BASE, 'the wording change moved the base version: everyone would be asked again');
  for (const source of STATEMENT.sources) {
    assert.equal(source.version, loggedSource(source.sourceId), `the wording change moved ${source.sourceId}'s version`);
  }
});

test('criterion 12 (guard): an anonymous cookie given against the first entry is still in force', () => {
  const cookie = {
    v: 1 as const,
    flows: LOGGED_BASE!,
    states: Object.fromEntries(STATEMENT.sources.map((s) => [s.sourceId, { state: 'on' as const, since: '2026-10-19', version: loggedSource(s.sourceId)! }])),
  };
  assert.deepEqual(cookieConsentInForce(cookie, STATEMENT), { inForce: true, reask: { base: false, sources: [] } });
});

test('criterion 12 (guard): a signed-in row given against the statement before the change is not re-asked', () => {
  // The statement before W3's wording, rebuilt from the one in force: the same
  // recipients and sources, W2's omitted-guide line, and W2's one sandbox line.
  const before = JSON.parse(JSON.stringify(STATEMENT)) as FlowsStatement;
  before.links = { privacy: '/privacy', deploymentGuideOmitted: 'This instance names no public address for its deployment guide yet.' };
  for (const source of before.sources) for (const r of source.recipients) for (const k of r.keptBy) if (k.basis) k.basis = ['W2 basis'];
  const verdict = classifyFlowsChange(before, STATEMENT);
  assert.equal(verdict.verdict, 'same', `the wording change re-asks: ${JSON.stringify(verdict.changes)}`);
});

// --- The log's dated entry (criterion 12) ---------------------------------------------------

test('criterion 12: the change log has a dated entry after the first, recording the statement\'s new hash', () => {
  const entries = [...LOG.matchAll(/^## (\d{4}-\d{2}-\d{2})\b/gm)].map((m) => m[1]);
  assert.ok(entries.length >= 2, `the log has ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}; W3 adds one`);
  assert.ok(LOG.includes(statementHash(STATEMENT)), `no entry records the statement's hash under the first entry's configuration (${statementHash(STATEMENT)})`);
});
