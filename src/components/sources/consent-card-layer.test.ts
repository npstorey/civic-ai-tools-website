// R9 P3 (#680; #660, D2 = A of the UX pass): the first-consent card as a decision layer.
//
// CRITERION 1, AS UX-2 P4b CUTS THE CARD TO D6 B (ASK1 = A, ASK2 = B) AND THE OWNER'S CARD RULING
// (#729 comment 6727853028) MOVES ITS WORDS. Above its two buttons the card renders exactly the heading,
// a question. No kept-by line, no recipient line and no disclosure render anywhere on the card: the
// privacy page is its full layer. Below the buttons: the effect, ASK1's line with its link to Data
// source settings, T6 (the privacy link), the analytics line where analytics is on, and the cookie
// sentence. The two buttons keep their size and style. R9 P3's T3, T4, T5, T8, T10 and T11
// and the local-only offer left the card (D6 B); the sandbox definition's lifecycle pins left with T10.
//
// CRITERION 2 (the parts this file asserts). The flows statement, its base version and its hash, and
// the privacy page's statements, are byte-identical to the base's (`607d101`), pinned below by
// SHA-256 at the configurations this file drives (the privacy page's two values re-captured in
// UX-2 PW2, where G0-4 B moved two of its sentences; see `BASE`); the re-ask notice's words for the model
// (`consent.ts`) and the privacy page's endpoint heading stay "The model endpoint". "Where this
// question went" is asserted in `src/lib/flows/where-it-went.test.ts`.
//
// WHAT IS DRIVEN. The real card on the surface harness (`./surface-test-harness.ts`), reading the
// REAL `/api/flows` and `/api/sources/consent` handlers, at the reference instance's six sources
// (the change log's 2026-10-21 entry, with its five base recipients: 14 in all), at the consent-text
// tests' three sources (five recipients), and at two sources with no hosted one.
//
// WHAT MAKES IT ABLE TO FAIL. Every expected sentence is written out here, never read from
// `copy.ts`. Before P4b the card carried T3, T4, the offer, T5 and T7 above its buttons and the
// recipients' disclosure below them, each of which these assertions refuse.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import {
  CONSENT_SURFACE_STUBS,
  SRC,
  h,
  installFetch,
  mount,
  readableText,
  registerSurfaceHooks,
  sessions,
  type HostElement,
  type Surface,
} from './surface-test-harness.ts';

// `next/script` renders nothing outside Next; the analytics module imports it.
registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, 'next/script': 'export default function Script() { return null; }' });

// --- The configurations -------------------------------------------------------------------

const READ = [
  'SOCRATA_MCP_URL', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING',
  'NYS_LEGISLATION_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'MODEL_API_KIND', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'SITE_OPERATOR_STATES_NO_TRAINING', 'DATABASE_URL', 'EXECUTOR_DRIVER', 'EXECUTOR_LAMBDA_REGION',
];

type Config = 'six' | 'three' | 'two';

/** The reference instance's six sources and five base recipients; the consent-text tests' three; two with none hosted. */
const ENV: Record<Config, Record<string, string>> = {
  six: {
    SOCRATA_MCP_URL: 'https://socrata.fixture.example', NYC_CHARTER_HOSTING: 'sandbox', NYC_CHECKBOOK_HOSTING: 'sandbox',
    NYC_RECORD_HOSTING: 'sandbox', NYS_LEGISLATION_HOSTING: 'sandbox', NYS_LEGISLATION_API_KEY: 'fixture',
    EXECUTOR_DRIVER: 'vercel-sandbox', VERCEL_ENV: 'production', GITHUB_CLIENT_ID: 'fixture', GITHUB_CLIENT_SECRET: 'fixture',
    NEXT_PUBLIC_ANALYTICS_SERVICE: 'plausible', NEXT_PUBLIC_ANALYTICS_ID: 'fixture.example',
  },
  three: { SOCRATA_MCP_URL: 'https://socrata.fixture.example', NYC_CHARTER_HOSTING: 'sandbox', EXECUTOR_DRIVER: 'none' },
  two: { SOCRATA_MCP_URL: 'https://socrata.fixture.example', EXECUTOR_DRIVER: 'none' },
};

async function under<T>(env: Record<string, string>, body: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(READ.map((name) => [name, process.env[name]]));
  for (const name of READ) delete process.env[name];
  Object.assign(process.env, env);
  try {
    return await body();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// --- The modules -------------------------------------------------------------------------------

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Card = (await load('components/sources/ConsentCard.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const facts = await load('lib/privacy-facts.ts');
const copy = await load('lib/sources/copy.ts');

const ORIGIN = 'https://site.fixture.example';

async function card(): Promise<Surface> {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
  return mount(h(Card, { onAllow: () => undefined, onNotNow: () => undefined }));
}

// --- The ruled words, written out ------------------------------------------------------------

// UX-2 P4b (D6 B, ASK1 = A, ASK2 = B; then the owner's card ruling, #729 comment 6727853028): above the buttons the
// heading alone; below them the effect, ASK1's line with the link to Data source settings, T6, the analytics line and
// the cookie sentence. The ruling removed T1, T2 and the earlier effect sentence from the card; T3, T4, the local-only
// offer, T5, T8, T10 and T11 had left it with the recipients' disclosure. The privacy page is the card's full layer.
const HEADING = 'Allow this site to send your question to a model service?';
const EFFECT = 'Allow sends your question to the model service. It sends the searches the model writes to data sources that are On or that you allow when asked.';
const ASK1 = 'You can change or withdraw this in Data source settings.';
const T6 = 'The privacy page has the full statement.';
const COUNT: Record<Config, { n: number; words: string }> = { six: { n: 14, words: '14' }, three: { n: 5, words: 'five' }, two: { n: 4, words: 'four' } };
const SETTINGS_LINK = 'Data source settings';
const ANALYTICS = 'An analytics service counts page visits. The privacy page names it and says how to object.';
const COOKIE_NO_DB = 'We keep your answer for this browser session in a cookie.';
const COOKIE_DB = 'We keep your answer for this browser session in a cookie, or on your account if signed in.';

/** The buttons as the base styles them (D4 = A): equal, and unchanged by this phase. */
const BUTTON_STYLE = {
  flex: '1 1 0', minWidth: '120px', padding: '10px 16px', fontSize: '14px', fontWeight: 600, borderRadius: '6px',
  border: '1px solid var(--accent)', backgroundColor: 'var(--white)', color: 'var(--accent)', cursor: 'pointer',
};

/** Words that only a kept-by line carries. */
const KEPT_BY_WORDS = ['not stated', 'says it keeps facts', 'says it keeps what', 'says it keeps nothing', 'its statement', 'read 2026-', 'for this site\'s operator to state'];

interface Shown {
  surface: Surface;
  statement: Mod;
  elements: HostElement[];
  /** What a reader reads before the first button. */
  above: string;
  /** What a reader reads from the first button on. */
  below: string;
  firstButton: number;
}

async function show(config: Config, extra: Record<string, string> = {}): Promise<Shown> {
  return under({ ...ENV[config], ...extra }, async () => {
    const statement = await buildFlowsStatement();
    const surface = await card();
    const markup = surface.markup();
    const cut = markup.indexOf('<button');
    assert.ok(cut > 0, `premise: the card has its buttons: ${surface.text().slice(0, 300)}`);
    const elements = surface.elements();
    return {
      surface, statement, elements,
      above: readableText(markup.slice(0, cut)),
      below: readableText(markup.slice(cut)),
      firstButton: elements.findIndex((el) => el.type === 'button'),
    };
  });
}

const recipientsOf = (statement: Mod): Mod[] => [...statement.recipients, ...statement.sources.flatMap((s: Mod) => s.recipients)];

// --- Criterion 1, as UX-2 P4b cuts the card to D6 B ------------------------------------------

for (const config of ['six', 'three', 'two'] as const) {
  test(`criterion 1 (${config} sources; UX-2 P4b D6 B): above the buttons, exactly the cut layer`, async () => {
    const { surface, statement, above, below } = await show(config);
    try {
      assert.equal(statement.sources.length, { six: 6, three: 3, two: 2 }[config], 'premise: the configuration\'s sources');
      assert.equal(recipientsOf(statement).length, COUNT[config].n, 'premise: the statement\'s recipient count');
      // The owner's card ruling: only the heading stands above the buttons (it was the heading, T1, T2, the effect, ASK1 and T6).
      assert.equal(above, HEADING, 'the text above the buttons is not the cut layer');
      // The sentences that stood above the buttons, each where the ruling puts it: right after the two buttons.
      assert.ok(below.startsWith(['Allow', "Don't allow", EFFECT, ASK1, T6].join(' ')), `the buttons are not followed by the effect, ASK1's line and T6: ${below.slice(0, 400)}`);
      for (const words of KEPT_BY_WORDS) assert.ok(!above.includes(words), `a kept-by line renders above the buttons ("${words}")`);
    } finally {
      surface.unmount();
    }
  });

  test(`criterion 1 (${config} sources; UX-2 P4b D6 B): no recipient line and no disclosure; below the buttons the settings link, then analytics where on, then the cookie sentence`, async () => {
    const { surface, elements, below } = await show(config);
    try {
      assert.equal(elements.filter((el) => el.type === 'details' || el.type === 'summary').length, 0, 'the card still carries a disclosure');
      assert.equal(elements.filter((el) => typeof el.props['data-recipient'] === 'string' || typeof el.props['data-recipient-group'] === 'string').length, 0, 'the card still lists recipients');
      for (const words of KEPT_BY_WORDS) assert.ok(!surface.text().includes(words), `a kept-by line renders on the card ("${words}")`);
      assert.ok(!/model endpoint/i.test(surface.text()), 'the card still says "model endpoint"');
      const link = below.indexOf(SETTINGS_LINK);
      const cookie = below.indexOf(COOKIE_NO_DB);
      assert.ok(link > 0 && cookie > link, `the cookie sentence is not below the settings link: ${below}`);
      if (config === 'six') {
        const analytics = below.indexOf(ANALYTICS);
        assert.ok(analytics > link && analytics < cookie, 'the analytics line is not between the settings link and the cookie sentence');
      }
    } finally {
      surface.unmount();
    }
  });
}

test('criterion 1 (UX-2 P4b): with a database, the card names no dashboard, and the cookie sentence names the account', async () => {
  const { surface, above, below } = await show('three', { DATABASE_URL: 'fixture' });
  try {
    assert.ok(!above.includes('dashboard') && !below.includes('dashboard'), `the card names the dashboard: ${above} ${below}`);
    assert.ok(below.includes(COOKIE_DB), `the cookie sentence with a database: ${below}`);
  } finally {
    surface.unmount();
  }
});

test('criterion 1: the two buttons are unchanged in size and style, and read Allow and Don\'t allow (UX-2 P4b, item 8)', async () => {
  const { surface } = await show('six');
  try {
    const [allow] = surface.buttons('Allow');
    const [dontAllow] = surface.buttons("Don't allow");
    assert.ok(allow && dontAllow, 'the card does not offer Allow and Don\'t allow');
    assert.deepEqual(allow.props.style, BUTTON_STYLE, 'Allow\'s style changed');
    assert.deepEqual(dontAllow.props.style, BUTTON_STYLE, 'Don\'t allow\'s style changed');
    assert.equal(allow.props.className, dontAllow.props.className);
  } finally {
    surface.unmount();
  }
});

// --- Criterion 2: what this phase leaves byte for byte ---------------------------------------------

const sha = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

/**
 * Captured at the base (`607d101`) by this file's own computation, before any change.
 * The two `privacy` values were re-captured by the same computation in UX-2 PW2
 * (#729, G0-4 B), whose S4 and S6 move two privacy-page sentences to "analysis";
 * with only those two lines of `privacy-facts.ts` reverted, the base values return.
 * UX-2 P4b re-captured the two `privacy` values and the consent sections' hash by the
 * same computation: items 38, 40 and 41 and the seat's W1 re-word the privacy page's
 * consent sentences, and the privacy golden moves on exactly the five lines H2 names.
 * The flows statement, its base version and its hash are unchanged, so nobody is
 * asked again.
 */
const BASE: Record<'six' | 'three', { statement: string; version: string; hash: string; privacy: string }> = {
  six: {
    statement: 'df07040107fbcf939d9ad594cbdb8f21b22e538c90022b474483f0c2853f4669',
    version: '2489d0dda25a79b3286c380379c6d2c8202e66a77fe5b4f493f558a7ce190f9c',
    hash: '7683b5d59e2b39df3f941420a5ce44ad14539992d2b6850df60f7aa64fe4bc60',
    privacy: '1ee0511b3f88a11f333f31df5c2089d45a26c9a8518a50ecb9f68b5f14882dd1',
  },
  three: {
    statement: '522fc92cad73b13f15ede0acaf16ce32b139d4b1438a5ee84dbe0d414c88813a',
    version: 'ce0f4f09dff9d9d998a00cca59b12ee92486752ce9d94ed1eb310eae01c69325',
    hash: '159e0475172c58c49d51f654dec0b74e75d24639452c7b1ff73eaf0558242696',
    privacy: 'd07ebfb3bd2c2e59a388d715ec36a7a986313c69dcf8ddb8e30136021dff83d6',
  },
};
const BASE_PRIVACY_CONSENT_SECTIONS = '7a5ef839e4dc3ea1d4bad48c51ac0a3ffaaf37ddc902b8b102f10d4c05f2b698';

for (const config of ['six', 'three'] as const) {
  test(`criterion 2 (${config} sources): the flows statement, its base version and hash, and the privacy page's statements are the base's, byte for byte`, async () => {
    await under(ENV[config], async () => {
      const statement = await buildFlowsStatement();
      const now = {
        statement: sha(statement),
        version: statement.version,
        hash: statementHash(statement),
        privacy: sha(facts.buildPrivacySections(null)),
      };
      assert.deepEqual(now, BASE[config], 'the statement, its version or hash, or the privacy page moved: a re-ask, or a changed page');
    });
  });
}

test('criterion 2: the privacy page\'s consent sections, its endpoint heading and the re-ask notice\'s word for the model are unchanged', () => {
  assert.equal(sha(copy.PRIVACY_CONSENT_SECTIONS), BASE_PRIVACY_CONSENT_SECTIONS, 'the privacy page\'s consent sections changed');
  assert.equal(copy.PRIVACY_ENDPOINT_HEADING, 'The model endpoint');
  const consent = fs.readFileSync(path.join(SRC, 'lib/sources/consent.ts'), 'utf8');
  assert.ok(consent.includes("  'model-endpoint': 'The model endpoint',"), 'the re-ask notice\'s words for the model changed');
});
