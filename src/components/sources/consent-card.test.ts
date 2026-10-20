// R6 W3 (#632), criteria 2, 5 and 11: the first-consent card, rendered.
//
// THE CARD (anchor W3 item 2). The owner's text (ruled at R6 G7, 2026-10-20, in
// `src/lib/sources/copy.ts`) with the recipient list derived from the flows
// statement: each recipient with its kept-by line — what its holder says it
// keeps, with the statement's address and the date it was read, or "not
// stated" — and the two answers, Allow and Not now. The local-only offer
// closes it, with the deployment guide's address (D10) or the sentence that
// says this site names none.
//
// WHAT IS DRIVEN. The real card on the surface harness, reading the REAL
// `/api/flows` handler, under the three configurations of W2's criterion 3:
// the default, a custom model endpoint, and `NYC_CHARTER_HOSTING=sandbox`.
// Each recipient's line is the element carrying `data-recipient="<id>"`, the
// recipient's id in the statement.
//
// WHAT MAKES IT ABLE TO FAIL. At the base there is no card.
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
  type HostElement,
  type Surface,
} from './surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

const READ = [
  'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'VERCEL_ENV', 'EXECUTOR_DRIVER', 'EXECUTOR_LAMBDA_REGION',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'SOCRATA_MCP_URL', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING',
  'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL',
];

const ORIGIN = 'https://site.fixture.example';
const GUIDE = 'https://guide.fixture.example/deploy';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement } = await load('lib/flows/statement.ts');

/** The modules W3 adds, by specifiers typed `string`, so the red commit type-checks. */
const CARD: string = '@/components/sources/ConsentCard';
const COPY: string = '@/lib/sources/copy';
const cardModule = (await import(CARD).catch(() => null)) as Mod | null;
const copy = (await import(COPY).catch(() => null)) as Mod | null;

interface KeptBy { holder: string; keeps: string; statementUrl?: string; readOn?: string }
interface Recipient { id: string; keptBy: KeptBy[] }

/** Set the configuration, run `body`, and put the environment back. */
async function under<T>(env: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(READ.map((name) => [name, process.env[name]]));
  for (const name of READ) delete process.env[name];
  Object.assign(process.env, { SOCRATA_MCP_URL: 'https://socrata.fixture.example', EXECUTOR_DRIVER: 'none' }, env);
  try {
    return await body();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function card(): Promise<Surface> {
  assert.ok(cardModule?.default, `no consent card: ${CARD} does not exist`);
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
  return mount(h(cardModule!.default as ComponentType<Record<string, unknown>>, { onAllow: () => undefined, onNotNow: () => undefined }));
}

function lineOf(surface: Surface, id: string): HostElement[] {
  return surface.elements().filter((el) => el.props['data-recipient'] === id);
}

const CONFIGURATIONS: Array<[string, Record<string, string>]> = [
  ['the default', {}],
  ['a custom model endpoint', { MODEL_API_BASE_URL: 'https://models.fixture.example/v1' }],
  ['NYC_CHARTER_HOSTING=sandbox', { NYC_CHARTER_HOSTING: 'sandbox' }],
];

for (const [name, env] of CONFIGURATIONS) {
  test(`criterion 2 (${name}): the card's recipient list carries one kept-by line per recipient`, async () => {
    await under(env, async () => {
      const shown = await card();
      const statement = await buildFlowsStatement();
      const recipients: Recipient[] = [...statement.recipients, ...statement.sources.flatMap((s: { recipients: Recipient[] }) => s.recipients)];
      assert.ok(recipients.length > 0, 'premise: the statement names recipients');
      const listed = shown.elements().filter((el) => typeof el.props['data-recipient'] === 'string').map((el) => el.props['data-recipient']);
      assert.deepEqual(listed, recipients.map((r) => r.id), 'the card does not list exactly the statement\'s recipients, one line each');
      for (const recipient of recipients) {
        const [line] = lineOf(shown, recipient.id);
        const text = textOf(line);
        for (const k of recipient.keptBy) {
          assert.ok(text.includes(k.holder), `${recipient.id}: the line does not name the holder ${k.holder}: ${text}`);
          if (k.keeps === 'not-stated') assert.ok(text.includes('not stated'), `${recipient.id}: a holder that states nothing does not read "not stated": ${text}`);
          if (k.statementUrl) {
            const links = [...shown.elements()].filter((el) => el.type === 'a' && el.props.href === k.statementUrl);
            assert.ok(links.length >= 1, `${recipient.id}: the line does not link the statement read (${k.statementUrl})`);
            assert.ok(text.includes(k.readOn ?? ''), `${recipient.id}: the line does not give the date the statement was read (${k.readOn})`);
          }
        }
      }
      shown.unmount();
    });
  });
}

/** T13 (#632 G7): each source's one reader name, written out. */
const READER_NAME: Record<string, string> = { socrata: 'Socrata', 'data-commons': 'Data Commons', 'boston-opencontext': 'Boston OpenContext', 'nyc-charter': 'NYC Charter, Laws and Rules' };

test('criterion 11: the card names each source without " MCP Server"', async () => {
  await under({ NYC_CHARTER_HOSTING: 'sandbox' }, async () => {
    const shown = await card();
    const statement = await buildFlowsStatement();
    for (const source of statement.sources as Array<{ sourceId: string; displayName: string }>) {
      const name = READER_NAME[source.sourceId];
      assert.ok(shown.text().includes(name), `the card does not name ${source.sourceId} as ${name}`);
    }
    assert.ok(!shown.text().includes('MCP Server'), `the card says "MCP Server": ${shown.text().slice(0, 400)}`);
    shown.unmount();
  });
});

test('criterion 2: the card carries the owner\'s text and the two answers', async () => {
  await under({}, async () => {
    const shown = await card();
    assert.ok(shown.buttons('Allow').length === 1 && shown.buttons('Not now').length === 1, 'the card does not offer Allow and Not now');
    assert.ok(copy?.CONSENT_CARD, `${COPY} exports no CONSENT_CARD`);
    const sentences: string[] = [copy!.CONSENT_CARD.heading, ...(copy!.CONSENT_CARD.sentences ?? [])];
    assert.ok(sentences.length > 1, `${COPY}'s CONSENT_CARD carries no sentences`);
    for (const sentence of sentences) assert.ok(shown.text().includes(sentence), `the card does not say: ${sentence}`);
    shown.unmount();
  });
});

test('criterion 5: unset, the card omits the guide link and says this site names no guide', async () => {
  await under({}, async () => {
    const shown = await card();
    assert.ok(copy?.LOCAL_ONLY_OFFER && copy?.NO_GUIDE_SENTENCE, `${COPY} exports no LOCAL_ONLY_OFFER / NO_GUIDE_SENTENCE`);
    assert.ok(shown.text().includes(copy!.LOCAL_ONLY_OFFER), 'the card makes no local-only offer');
    assert.ok(shown.text().includes(copy!.NO_GUIDE_SENTENCE), 'with no guide address, the card does not say so');
    assert.ok(!shown.elements().some((el) => el.type === 'a' && el.props.href === GUIDE), 'the card links a guide no one configured');
    shown.unmount();
  });
});

test('criterion 5: set, the card links to the deployment guide', async () => {
  await under({ SITE_DEPLOYMENT_GUIDE_URL: GUIDE }, async () => {
    const shown = await card();
    assert.equal(shown.elements().filter((el) => el.type === 'a' && el.props.href === GUIDE).length, 1, 'the card does not link to the configured guide');
    assert.ok(!copy?.NO_GUIDE_SENTENCE || !shown.text().includes(copy.NO_GUIDE_SENTENCE), 'the card says no guide is named while it links to one');
    shown.unmount();
  });
});
