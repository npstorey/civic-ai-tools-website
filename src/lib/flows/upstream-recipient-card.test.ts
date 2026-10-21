// R8 W3: the three new hosted sources as R6's surfaces render them, with each
// source's switch on (State legislation with a placeholder key, never a real
// one). R6's components are mounted, not edited: the real Sources panel and the
// real consent card on R6's surface harness (`src/components/sources/
// surface-test-harness.ts`, as `consent-card.test.ts` mounts them), each reading
// the REAL `/api/flows` handler.
//
// - Criterion 7: the panel row shows each new source's what-line, the stored
//   form with its first letter upper-cased (City Record's reads "Notices in The
//   City Record"), and the privacy page's source row prints it as stored.
// - Criterion 5 (b): the card names each upstream host as a recipient of its
//   own, "<source> (<upstream host>): …", after the sandbox line, and each row
//   still ends "running at this site's sandbox." (added with step 5).
//
// WHAT MAKES IT ABLE TO FAIL. Before the three map entries the rows carry no
// what-line; before the upstream recipient the card has one line per hosted
// source, naming where it runs.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import {
  CONSENT_SURFACE_STUBS,
  SRC,
  h,
  installFetch,
  mount,
  registerSurfaceHooks,
  sessions,
  textOf,
  type Surface,
} from '../../components/sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

const READ = [
  'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'VERCEL_ENV', 'EXECUTOR_DRIVER', 'EXECUTOR_LAMBDA_REGION',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'SOCRATA_MCP_URL', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL',
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING', 'NYS_LEGISLATION_API_KEY',
  'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL',
];

const ORIGIN = 'https://site.fixture.example';
/** A placeholder, never a real key: the key is never in a session. */
const PLACEHOLDER_KEY = 'placeholder-not-a-key-r8-w3';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const Panel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType<Record<string, unknown>>;
const facts = await load('lib/privacy-facts.ts');
const { buildFlowsStatement } = await load('lib/flows/statement.ts');

/** The three new sources, each with its switch. */
const NEW_SOURCES = [
  { sourceId: 'nyc-checkbook', env: { NYC_CHECKBOOK_HOSTING: 'sandbox' } },
  { sourceId: 'nyc-record', env: { NYC_RECORD_HOSTING: 'sandbox' } },
  { sourceId: 'nys-legislation', env: { NYS_LEGISLATION_HOSTING: 'sandbox', NYS_LEGISLATION_API_KEY: PLACEHOLDER_KEY } },
] as const;

/** The approved what-lines as the panel shows them (first letter upper-cased). */
const PANEL_WHAT: Record<string, string> = {
  'nyc-checkbook': "New York City's spending, contracts, budget figures and payroll, as the City Comptroller publishes them on Checkbook NYC.",
  'nyc-record': "Notices in The City Record, New York City's official journal: procurement, public hearings and other agency notices.",
  'nys-legislation': "New York State's bills and the votes on them, and the State's laws, from the State Senate's Open Legislation service.",
};
/** And as the privacy page prints them: as stored. */
const STORED_WHAT: Record<string, string> = {
  ...PANEL_WHAT,
  'nyc-record': "notices in The City Record, New York City's official journal: procurement, public hearings and other agency notices.",
};

/** Set the configuration, run `body`, and put the environment back. */
async function under<T>(env: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(READ.map((name) => [name, process.env[name]]));
  for (const name of READ) delete process.env[name];
  Object.assign(process.env, { SOCRATA_MCP_URL: 'https://socrata.fixture.example', EXECUTOR_DRIVER: 'vercel-sandbox' }, env);
  try {
    return await body();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function surface(component: ComponentType<Record<string, unknown>>, props: Record<string, unknown> = {}): Promise<Surface> {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
  return mount(h(component, props));
}

for (const { sourceId, env } of NEW_SOURCES) {
  test(`R8 W3 criterion 7 (${sourceId}): the panel row shows the what-line upper-cased, and the privacy row prints it as stored`, async () => {
    await under(env, async () => {
      const shown = await surface(Panel);
      const row = shown.elements().find((el) => el.props['data-source'] === sourceId);
      assert.ok(row, `premise: the panel has no row for ${sourceId} with its switch on`);
      const text = textOf(row!);
      shown.unmount();
      assert.ok(text.includes(PANEL_WHAT[sourceId]), `the panel row does not show "${PANEL_WHAT[sourceId]}": ${text}`);
      const source = ((await buildFlowsStatement()).sources as Array<{ sourceId: string }>).find((candidate) => candidate.sourceId === sourceId);
      assert.ok(source, `premise: the flows statement has no source ${sourceId}`);
      const statement = facts.sourceRow(source);
      const rendered = (statement.parts as Array<string | { text?: string }>).map((p) => (typeof p === 'string' ? p : p.text ?? '')).join('');
      assert.ok(rendered.includes(STORED_WHAT[sourceId]), `the privacy row does not print "${STORED_WHAT[sourceId]}" as stored: ${rendered}`);
    });
  });
}

// --- Criterion 5 (b): the upstream host, a recipient of its own -------------------

/** The lifecycle row's first cell, as W3 renames it (four places, one commit). */
const LIFECYCLE_KEY = "Hosted source (`<SOURCE>_HOSTING=sandbox`): its sandbox's lifecycle";
const UPSTREAM_RECEIVES = 'the requests the connector makes for data, which can include words from your question';
/** Each new source's one outbound host and its one manifest-stated holder. */
const UPSTREAM: Record<string, { host: string; holder: string }> = {
  'nyc-checkbook': { host: 'www.checkbooknyc.com', holder: 'Office of the New York City Comptroller' },
  'nyc-record': { host: 'data.cityofnewyork.us', holder: 'City of New York' },
  'nys-legislation': { host: 'legislation.nysenate.gov', holder: 'New York State Senate' },
};

interface FlowsRecipientLike { id: string; key: string; role: string; host?: string; runsAt?: string; receives: string; keptBy: Array<{ holder: string; keeps: string; statementUrl?: string; readOn?: string }> }
interface FlowsSourceLike { sourceId: string; host?: string; recipients: FlowsRecipientLike[] }
const { CIVIC_MANIFEST } = await import('@typedstandards/civic-typed-router');

for (const { sourceId, env } of NEW_SOURCES) {
  const { host, holder } = UPSTREAM[sourceId];
  test(`R8 W3 criterion 5 (b) (${sourceId}): /api/flows names ${host} as a recipient of its own, after the sandbox`, async () => {
    await under(env, async () => {
      const statement = await buildFlowsStatement();
      const row = (statement.sources as FlowsSourceLike[]).find((s) => s.sourceId === sourceId);
      assert.ok(row, `premise: no flows source for ${sourceId}`);
      assert.equal(row!.host, undefined, 'the row carries a host: an upstream host is never the source\'s host');
      assert.deepEqual(row!.recipients.map((r) => r.id), [`source:${sourceId}`, `source:${sourceId}:${host}`]);
      const [sandbox, upstream] = row!.recipients;
      assert.equal(sandbox.host, undefined, 'the sandbox recipient carries a host');
      assert.equal(sandbox.runsAt, 'instance-sandbox');
      assert.equal(sandbox.role, 'sandbox-platform');
      assert.deepEqual(sandbox.keptBy.map((k) => k.holder), ['Vercel'], 'the sandbox recipient keeps more than the instance-stated row');
      const entry = CIVIC_MANIFEST.find((e) => e.sourceId === sourceId)!;
      const variant = entry.hostings.find((v) => v.kind === 'npm-package')!;
      const stated = variant.logging.filter((p) => p.statedBy === 'manifest') as Array<{ holder: string; keeps: string; statementUrl: string; readOn: string }>;
      assert.deepEqual(stated.map((p) => p.holder), [holder], `premise: ${sourceId} states one upstream holder`);
      assert.deepEqual(upstream, {
        id: `source:${sourceId}:${host}`,
        key: LIFECYCLE_KEY,
        role: 'source',
        host,
        receives: UPSTREAM_RECEIVES,
        keptBy: stated.map((p) => ({ holder: p.holder, keeps: p.keeps, statementUrl: p.statementUrl, readOn: p.readOn })),
      });
    });
  });

  test(`R8 W3 criterion 5 (b) (${sourceId}): the card shows "<source> (${host}): …", and the row still runs at this site's sandbox`, async () => {
    await under(env, async () => {
      const Card = (await load('components/sources/ConsentCard.tsx')).default as ComponentType<Record<string, unknown>>;
      const card = await surface(Card, { onAllow: () => undefined, onNotNow: () => undefined });
      const line = card.elements().find((el) => el.props['data-recipient'] === `source:${sourceId}:${host}`);
      assert.ok(line, `the card has no line for ${host}`);
      const text = textOf(line!);
      card.unmount();
      const name = (await load('lib/sources/source-name.ts')).readerSourceName({ sourceId, displayName: CIVIC_MANIFEST.find((e) => e.sourceId === sourceId)!.displayName });
      assert.ok(text.startsWith(`${name} (${host}): `), `the card line reads: ${text}`);
      assert.ok(text.includes(holder), `the card line does not name ${holder}: ${text}`);
      const panel = await surface(Panel);
      const row = panel.elements().find((el) => el.props['data-source'] === sourceId);
      const rowText = textOf(row!);
      panel.unmount();
      assert.ok(rowText.includes("running at this site's sandbox."), `the row no longer says where the server runs: ${rowText}`);
      assert.ok(!rowText.includes(`running at ${host}`), `the row names the upstream host as where the server runs: ${rowText}`);
      // Each holder once, in the panel row and in the privacy row.
      assert.equal(rowText.split(holder).length - 1, 1, `the panel row names ${holder} other than once: ${rowText}`);
      const source = ((await buildFlowsStatement()).sources as Array<{ sourceId: string }>).find((s) => s.sourceId === sourceId)!;
      const privacy = (facts.sourceRow(source).parts as Array<string | { text?: string }>).map((p) => (typeof p === 'string' ? p : p.text ?? '')).join('');
      assert.equal(privacy.split(holder).length - 1, 1, `the privacy row names ${holder} other than once: ${privacy}`);
      assert.equal(privacy.split('Vercel').length - 1, 1, `the privacy row names Vercel other than once: ${privacy}`);
    });
  });
}

test('R8 W3 criterion 5 (b): NYC Charter\'s flows entry is byte-identical to the base\'s', async () => {
  // Captured at 2cb2a5e under the change log's configuration (render-flows.ts's), the
  // entry's JSON hashed: Charter's outbound is empty, so it gains no recipient.
  await under({ SOCRATA_MCP_URL: 'https://socrata-mcp.civicaitools.org', NYC_CHARTER_HOSTING: 'sandbox', VERCEL_ENV: 'production', EXECUTOR_DRIVER: 'vercel-sandbox' }, async () => {
    const charter = ((await buildFlowsStatement()).sources as Array<{ sourceId: string }>).find((s) => s.sourceId === 'nyc-charter');
    const { createHash } = await import('node:crypto');
    assert.equal(createHash('sha256').update(JSON.stringify(charter)).digest('hex'), '5ad4b9c3e333f4f62e5a014cc8a57960fbaa1eaebfb644d17540e294e7d17064');
  });
});
