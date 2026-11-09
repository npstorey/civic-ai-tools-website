// R6 W3 (#632, contract amendment 2, criteria 1 and 2): the consent texts as
// the owner ruled them at G7 (T1-T14, S2), rendered where each is placed.
//
// THE RULE. Every ruled string renders on its surface, in its place: the
// card (four configurations of `SITE_DEPLOYMENT_GUIDE_URL` and
// `SITE_OPERATOR_STATES_NO_TRAINING`, with a database, and once without
// one), the Sources panel (no consent; in force; a re-ask with stored
// states), the dashboard's Sources tab (in force; none), the notices, the Not
// now line, the Ask first line, and the privacy page's consent sections (with
// and without a database). The replaced wordings render on none of those
// surfaces. A source is named one way on all of them, and anywhere on the
// privacy page: "Data Commons", never "Google Data Commons", and never with
// " MCP Server" (T13).
//
// R9 P3 (#680; #660, D2 = A of the UX pass) replaced the card's R6 sentences
// with its short layer above the buttons and its recipients in a disclosure
// below them; the card's tests here read R9 P3's words, and one of R6's
// replaced wordings, "at any time", is allowed back on the card only, where
// that ruling put it (`RULED_BACK_ON_THE_CARD`).
//
// S2 (criterion 2). With the operator's statement set, the card's endpoint
// row keeps "what it keeps is for this site's operator to state." and gives
// the statement after it, in that order. The D3 test in
// `consent-texts-configured.test.ts` checks `includes(statement)`, which
// passes either way; this one reads the order.
//
// WHAT IS DRIVEN. The real card, panel, dashboard tabs and home page on the
// surface harness (`./surface-test-harness.ts`), with the REAL `/api/flows`
// and `/api/sources/consent` handlers behind them and a cookie jar between
// requests; the account's row held in memory; the privacy page's sections as
// `buildPrivacySections` builds them, and the page itself (`page.tsx`)
// rendered whole for the page-wide names. The configuration is the change
// log's reference one (`docs/flows-changelog.md`, the 2026-10-19 entry), with
// a database and the brand repository set.
//
// WHAT MAKES IT ABLE TO FAIL. Every expected string below is written out
// here, never read from `copy.ts`, so a text that was not changed fails. The
// notice fixture holds three notify changes on recipients and a source that
// the reference configuration has, so each of the three lines can be told
// apart. The names are written out per source id.
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

// `next/script` renders nothing outside Next; the analytics module imports it.
registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, 'next/script': 'export default function Script() { return null; }' });

// --- The configuration ----------------------------------------------------------------------

/** The change log's reference configuration (`src/lib/flows/changelog.test.ts`'s `FIRST_ENTRY_ENV`). */
const REFERENCE: Record<string, string> = {
  SOCRATA_MCP_URL: 'https://socrata-mcp.civicaitools.org',
  NYC_CHARTER_HOSTING: 'sandbox',
  VERCEL_ENV: 'production',
  GITHUB_CLIENT_ID: 'placeholder-client-id',
  GITHUB_CLIENT_SECRET: 'placeholder-client-value',
  EXECUTOR_DRIVER: 'vercel-sandbox',
  NEXT_PUBLIC_ANALYTICS_SERVICE: 'plausible',
  NEXT_PUBLIC_ANALYTICS_ID: 'placeholder-analytics-id',
};
const REPO = 'https://github.com/npstorey/civic-ai-tools-website';
const S1_ADDRESS = `${REPO}/blob/main/docs/deploy.md`;
const READ = [
  ...Object.keys(REFERENCE), 'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY',
  'BOSTON_OPENCONTEXT_MCP_URL', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'SITE_OPERATOR_STATES_NO_TRAINING',
  'DATABASE_URL', 'SITE_BRAND_REPO_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
];

interface Config { s1?: boolean; s2?: boolean; db?: boolean; boston?: boolean }

async function under<T>(config: Config, body: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(READ.map((name) => [name, process.env[name]]));
  for (const name of READ) delete process.env[name];
  Object.assign(process.env, REFERENCE, { SITE_BRAND_REPO_URL: REPO });
  if (config.db ?? true) process.env.DATABASE_URL = 'fixture-database-address';
  if (config.s1) process.env.SITE_DEPLOYMENT_GUIDE_URL = S1_ADDRESS;
  if (config.s2) process.env.SITE_OPERATOR_STATES_NO_TRAINING = '1';
  if (config.boston) process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
  try {
    return await body();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const ORIGIN = 'https://site.fixture.example';
const storage = new Map<string, string>();
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/' },
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

// --- The modules ------------------------------------------------------------------------------

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Card = (await load('components/sources/ConsentCard.tsx')).default as ComponentType<Record<string, unknown>>;
const Panel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const PrivacyPage = (await load('app/(app)/privacy/page.tsx')).default as ComponentType;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { consentInForce } = await load('lib/sources/consent-gate.ts');
const { buildFlowsStatement, statementHash, computeBaseVersion } = await load('lib/flows/statement.ts');
const { encodeConsentCookie, CONSENT_COOKIE_NAME } = await load('lib/sources/consent.ts');
const facts = await load('lib/privacy-facts.ts');
const { ENDPOINT_NO_TRAINING } = await load('lib/sources/copy.ts');

// --- The ruled texts, written out (#632, amendment 2) ---------------------------------------------

/** R6's card-only sentences, which R9 P3 (#660) replaced with the short layer below: none renders on the card. */
const R6_CARD_ONLY = [
  'A data source gets the searches the model writes, which can include words from your question.',
  "After you allow, you can set each source to On, Ask first or Off in the panel beside the question box, and withdraw consent there, or on your dashboard's Sources tab if you are signed in.",
  'After you allow, you can set each source to On, Ask first or Off in the panel beside the question box, and withdraw consent there.',
  'To answer, this site sends your question to a model endpoint, the service that runs the model.',
  'Each recipient is listed below with what it says it keeps.',
];
/** T2 on the privacy page; the card's own timing sentence is R9 P3's (`CARD_T2`). */
const T2 = 'Your question is not sent beyond this site before you answer.';
// R9 P3 (#680; #660): the card's short layer as ruled on 2026-10-30, T1, T2, T5 and T7 of that ruling.
const CARD_T1 = 'To answer, this site sends your question to a model service, and sends the searches the model writes to the data sources that are On.';
// Amendment 1: the card's T2 is the privacy page's ruled sentence, so the two say the same.
const CARD_T2 = T2;
const CARD_T5_DB = "You can set each source to On, Ask first or Off beside the question box at any time. You can withdraw consent there, or on your dashboard's Sources tab if you are signed in.";
const CARD_T5_NO_DB = 'You can set each source to On, Ask first or Off beside the question box at any time. You can withdraw consent there.';
const CARD_T7 = '"Allow" turns on the sources shown as On and sends your question. "Not now" sends nothing.';
// UX-2 P4b (D6 B, ASK1 = A): the card's effect sentence (item 37 without its Allow-all half) and ASK1's line replace
// T5 and T7 above the buttons; R9 P3's T1 and T2 stay (item 34).
const CARD_EFFECT_P4B = "Allow: your question is sent to the model service. A data source is used only if it is On, or if it is set to Ask first and you allow it when asked. Don't allow: nothing is sent. You are asked again when you send a question.";
const CARD_ASK1 = 'You can change or withdraw this in Data source settings.';
// The owner's card ruling (#729 comment 6727853028: D1 = A, D2 = A with the owner's note): the heading is a
// question and stands alone above the buttons; the effect is re-worded and moves below them with ASK1's line. T1, T2
// and the earlier effect sentence leave the card (the privacy page keeps T2 and, as T7, the earlier effect).
const CARD_HEADING_RULED = 'Allow this site to send your question to a model service?';
const CARD_EFFECT_RULED = 'Allow sends your question to the model service. It sends the searches the model writes to data sources that are On or that you allow when asked.';
/** R6's replaced wording that R9 P3's ruling puts back on the card, and only there: "at any time" (T5). */
const RULED_BACK_ON_THE_CARD = ['at any time'];
// UX-2 P4b, item 41 (X2b): the privacy page's sentence on where to set each source.
const T3_TEXT1 = 'You can set each data source to On, Ask first or Off in Data source settings at any time.';
const T4_EACH = [
  "Each source's row gives who publishes its connector, where it runs, who holds its logs and what they say they keep, and how current its data is.",
  "Where we read the holder's own page, the logs line gives that page and the date we read it.",
];
const T4_KEEP = [
  'For each recipient, we state what it says it keeps, and for how long when it gives a time.',
  'Where it says so on a page, we give that page and the date we read it.',
];
// UX-2 P4b, item 46: the line after the card's "Don't allow".
const T5 = "You chose Don't allow. Nothing was sent. Edit this question or write a new one, and you will be asked again before it is sent.";
const T6 = 'Ask first: nothing is sent to this source until you turn it On.';
// UX-2 P4b, items 38/49: the privacy page's effect sentence is item 37's words, byte for byte (the card's own
// effect was re-worded apart from it by the owner's card ruling).
const T7 = CARD_EFFECT_P4B;
const T8_DB = 'We keep your answer for this browser session in a cookie, or on your account if signed in.';
const T8_NO_DB = 'We keep your answer for this browser session in a cookie.';
// R9 P2 (#661, D3 = A of the UX pass): the panel's lead before consent counts the states Allow will use, at the
// reference configuration's three sources, all On by default. It replaces row 2(a)'s "Allow uses these settings."
const T9_PANEL = 'These are the settings Allow will use: three sources On. Set them now, or change them after you allow.';
const T9_TAB = 'This site asks before your next question.';
const T10 = "A dated log of every change to where a question can go is kept with the site's code.";
const T11 = (holder: string) => `${holder}: what it keeps is for this site's operator to state`;
const T12_PANEL_LINK = 'Where a question can go, in full';
// UX pass row 14(a), 2026-10-22: the version sentence in words, the date in words and the version's first 8 hex.
const T12_TAB = (version: string, date: string) => `It refers to the statement of where a question can go as it stood on ${inWords(date)} (version ${version.slice(0, 8)}).`;
/** An ISO date (or timestamp) as the Sources tab writes it, in words: "2026-10-20" → "20 October 2026" (UX pass row 14). */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const inWords = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const T12_LOGS = "This site's hosting logs";
const T12_REMOVED = (label: string) => `${label}: removed from the recipients.`;
const T12_LESS = (label: string) => `${label}: its holder now says it keeps less.`;
const T14 = `${REPO}/blob/HEAD/docs/flows-changelog.md`;
/** The privacy page's own withdraw statement, unchanged by T3. */
const WITHDRAW_PRIVACY_DB = 'To withdraw consent, open Data source settings.';
const WITHDRAW_PRIVACY_NO_DB = WITHDRAW_PRIVACY_DB;
/** UX-2 P4b: item 41's X2b puts "at any time" back on the privacy page, in its ruled sentence. */
const RULED_BACK_ON_THE_PRIVACY_PAGE = ['at any time'];

/** The replaced wordings: none renders on the card, the panel, the tab, the notices or the privacy page's consent sections. */
const REPLACED = [
  'not your question', 'Nothing is sent', 'at any time', 'four dated facts', 'listed as On', 'Change your question',
  'left out of your questions', 'We keep your choice', 'You have not answered yet', 'no consent in force',
  'every change to these statements', ": for this site's operator to state", "The hosting platform's logs",
  'flows statement version', 'Where a question goes, in full', '/blob/main/docs/flows-changelog.md',
  'Allow uses these settings',
];
/** T13: nowhere on those surfaces, and nowhere on the privacy page. */
const NAMES_REPLACED = ['Google Data Commons', ' MCP Server'];
/** T13: one name per source, from one function. */
const NAME: Record<string, string> = {
  socrata: 'Socrata',
  'data-commons': 'Data Commons',
  'boston-opencontext': 'Boston OpenContext',
  'nyc-charter': 'NYC Charter, Laws and Rules',
};

function assertNoneReplaced(text: string, where: string, except: readonly string[] = []): void {
  for (const old of [...REPLACED, ...NAMES_REPLACED].filter((o) => !except.includes(o))) {
    assert.ok(!text.includes(old), `${where} still renders "${old}": …${text.slice(Math.max(0, text.indexOf(old) - 120), text.indexOf(old) + 120)}…`);
  }
}

/** What a reader reads, with every link's address beside its text, so an address can be read for a replaced string too. */
function readWithLinks(surface: Surface): string {
  const hrefs = surface.elements().filter((el) => el.type === 'a').map((el) => String(el.props.href ?? ''));
  return `${surface.text()} ${hrefs.join(' ')}`;
}

// --- The answers ------------------------------------------------------------------------------

const QUERY_ROUTES = ['/api/compare-stream', '/api/query-notebook', '/api/compare'];

function answers() {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    ...Object.fromEntries(QUERY_ROUTES.map((p) => [p, async (request: Request) => {
      const decision = await consentInForce(request, sessions.server);
      if (!decision.ok) return new Response(JSON.stringify(decision.payload), { status: 403, headers: { 'Content-Type': 'application/json' } });
      return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }])),
  });
}

const DB_ID = '31313131-3131-4131-8131-313131313131';
const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};
const SIGNED_IN_DB = () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: DB_ID } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};

async function putStates(states: Record<string, string>): Promise<void> {
  const statement = await buildFlowsStatement();
  const response = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(response.status, 200, `premise: the consent write was refused: ${await response.text()}`);
}

function rowsOf(surface: Surface): HostElement[] {
  return surface.elements().filter((el) => typeof el.props['data-source'] === 'string');
}

/** Each source's row names it as T13 rules. */
function assertRowNames(surface: Surface, where: string, ids: string[]): void {
  const rows = rowsOf(surface);
  assert.deepEqual(rows.map((r) => r.props['data-source']), ids, `premise: ${where} has one row per configured source`);
  for (const row of rows) {
    const id = String(row.props['data-source']);
    const text = textOf(row);
    assert.ok(text.startsWith(NAME[id]), `${where}: ${id}'s row is not named "${NAME[id]}": ${text.slice(0, 120)}`);
  }
}

// --- The card: four configurations, and one without a database ----------------------------------

async function mountCard(): Promise<Surface> {
  ANON();
  answers();
  return mount(h(Card, {}));
}

const CARD_CONFIGS: Array<{ name: string; config: Config }> = [
  { name: 'both settings unset', config: {} },
  { name: 'S2 set', config: { s2: true } },
  { name: 'S1 set', config: { s1: true } },
  { name: 'both set', config: { s1: true, s2: true } },
];

// UX-2 P4b (D6 B), as the owner's card ruling moves it: the heading above the buttons; the effect sentence, ASK1's
// line with the settings link, T6, the analytics line and T8 below them. The recipients (T11, T13 on the source
// lines), T5 and T7 left it, and the ruling took T1, T2 and the earlier effect sentence off it; T11 and T13 are read
// on the privacy page's source rows below.
for (const { name, config } of CARD_CONFIGS) {
  test(`criterion 1, the card (${name}; UX-2 P4b D6 B): the heading above the buttons, the effect sentence and ASK1's line below, T8 below, and no recipient line`, async () => {
    await under(config, async () => {
      const card = await mountCard();
      const text = card.text();
      const buttons = text.indexOf("Allow Don't allow");
      assert.ok(buttons > 0, `premise: the card has its buttons: ${text.slice(0, 300)}`);
      const heading = text.indexOf(CARD_HEADING_RULED);
      assert.ok(heading >= 0 && heading < buttons, `the heading does not render above the buttons: "${CARD_HEADING_RULED}" in ${text.slice(0, buttons)}`);
      for (const [label, sentence] of [['the effect', CARD_EFFECT_RULED], ['ASK1', CARD_ASK1]] as const) {
        const at = text.indexOf(sentence);
        assert.ok(at > buttons, `${label} does not render below the buttons: "${sentence}" in ${text.slice(buttons)}`);
      }
      assert.ok(text.indexOf(CARD_EFFECT_RULED) < text.indexOf(CARD_ASK1), 'the layer is out of order');
      for (const old of [CARD_T1, CARD_T2, CARD_EFFECT_P4B, CARD_T5_DB, CARD_T5_NO_DB, CARD_T7, ...R6_CARD_ONLY]) assert.ok(!text.includes(old), `the card still renders "${old}"`);
      assert.ok(!text.includes('To withdraw consent, use the panel'), 'the card still adds the privacy page\'s withdraw sentence beside its own');
      assert.ok(text.indexOf(T8_DB) > buttons, `T8 (with a database) does not render below the buttons: ${text.slice(buttons)}`);
      assert.equal(card.elements().filter((el) => typeof el.props['data-recipient'] === 'string' || typeof el.props['data-recipient-group'] === 'string').length, 0, 'the card still lists recipients');
      assertNoneReplaced(readWithLinks(card), `the card (${name})`, RULED_BACK_ON_THE_CARD);
      card.unmount();
    });
  });
}

test('criterion 1, the card without a database: T8 renders in its no-account form, and nothing names an account', async () => {
  await under({ db: false }, async () => {
    const card = await mountCard();
    const text = card.text();
    const buttons = text.indexOf("Allow Don't allow");
    assert.ok(buttons > 0, `premise: the card has its buttons: ${text.slice(0, 300)}`);
    assert.ok(!text.includes(CARD_T5_DB) && !text.includes(CARD_T5_NO_DB), 'the card still renders T5');
    assert.ok(text.indexOf(T8_NO_DB) > buttons, `T8 (without a database) does not render below the buttons: ${text.slice(buttons)}`);
    assert.ok(!text.includes(T8_DB), 'without a database, the card speaks of an account');
    assertNoneReplaced(readWithLinks(card), 'the card (without a database)', RULED_BACK_ON_THE_CARD);
    card.unmount();
  });
});

// --- Criterion 2 (S2): the operator's statement, on the privacy page (UX-2 P4b, D6 B) ------------------

test('criterion 2 (S2; UX-2 P4b D6 B): the card lists no endpoint row, set or unset; the privacy page states the operator\'s statement when set', async () => {
  for (const s2 of [true, false]) {
    await under({ s2 }, async () => {
      const card = await mountCard();
      assert.equal(card.elements().filter((el) => el.props['data-recipient'] === 'model-endpoint').length, 0, 'the card still lists the model endpoint');
      assert.ok(!card.text().includes(ENDPOINT_NO_TRAINING), 'the card states the operator\'s statement');
      card.unmount();
      const page = (facts.buildPrivacySections(null) as Section[]).map((x) => sectionText(x)).join(' ');
      assert.equal(page.includes(ENDPOINT_NO_TRAINING), s2, `the privacy page ${s2 ? 'does not state' : 'states'} the operator's statement`);
    });
  }
});

// --- The panel: no consent; in force; a re-ask with stored states -----------------------------------

const CONFIGURED = ['socrata', 'data-commons', 'nyc-charter'];

test('criterion 1, the panel with no consent: T9\'s lead, T12\'s link and T13\'s names', async () => {
  await under({}, async () => {
    ANON();
    answers();
    const panel = await mount(h(Panel));
    const text = panel.text();
    assert.ok(text.includes(T9_PANEL), `the panel's lead before consent is not T9's: ${text.slice(0, 300)}`);
    const links = panel.elements().filter((el) => el.type === 'a' && el.props.href === '/privacy');
    assert.ok(links.some((el) => textOf(el) === T12_PANEL_LINK), `the panel's privacy link does not read "${T12_PANEL_LINK}": ${links.map((el) => textOf(el)).join(' | ')}`);
    assertRowNames(panel, 'the panel', CONFIGURED);
    assertNoneReplaced(readWithLinks(panel), 'the panel (no consent)');
    panel.unmount();
  });
});

test('criterion 1, the panel in force: the Ask first line is T6\'s, on the Ask first row only', async () => {
  await under({}, async () => {
    ANON();
    answers();
    await putStates({ socrata: 'on', 'data-commons': 'ask-first', 'nyc-charter': 'on' });
    const panel = await mount(h(Panel));
    const row = (id: string) => textOf(rowsOf(panel).find((el) => el.props['data-source'] === id)!);
    assert.ok(row('data-commons').includes(T6), `the Ask first row does not read T6: ${row('data-commons')}`);
    assert.ok(!row('socrata').includes(T6), 'an On row reads the Ask first line');
    assert.ok(panel.elements().some((el) => el.type === 'a' && textOf(el) === T12_PANEL_LINK), `the panel's privacy link does not read "${T12_PANEL_LINK}"`);
    assertRowNames(panel, 'the panel', CONFIGURED);
    assertNoneReplaced(readWithLinks(panel), 'the panel (in force)');
    panel.unmount();
  });
});

test('criterion 1, the panel on a re-ask with stored states: no replaced wording, and T13\'s names', async () => {
  await under({}, async () => {
    ANON();
    const net = answers();
    const statement = await buildFlowsStatement();
    // A cookie given against an older base version: the base has changed since, so it is asked again.
    net.jar.set(CONSENT_COOKIE_NAME, encodeConsentCookie({
      v: 1,
      flows: 'b'.repeat(64),
      states: Object.fromEntries((statement.sources as Mod[]).filter((s) => s.sourceId !== 'nyc-charter').map((s) => [s.sourceId, { state: 'off', since: '2026-10-01', version: s.version }])),
    }));
    const panel = await mount(h(Panel));
    assert.ok(panel.elements().some((el) => el.type === 'a' && textOf(el) === T12_PANEL_LINK), `the panel's privacy link does not read "${T12_PANEL_LINK}"`);
    assertRowNames(panel, 'the panel', CONFIGURED);
    assertNoneReplaced(readWithLinks(panel), 'the panel (a re-ask)');
    panel.unmount();
  });
});

// --- The notices, on the panel and the Sources tab ---------------------------------------------------

const UPDATED = new Date('2026-10-20T08:00:00.000Z');

/**
 * A row held against a statement the one in force differs from by three
 * notify changes and nothing else: this site's hosting logs now say they keep
 * less, a second hosting-logs recipient is gone, and Data Commons has one
 * recipient fewer (it now says it keeps less). The held statement's base
 * version is its own.
 */
async function rowWithNotices(): Promise<{ held: Mod; statement: Mod }> {
  const statement = await buildFlowsStatement();
  const held = JSON.parse(JSON.stringify(statement)) as Mod;
  const logs = held.recipients.find((r: Mod) => r.role === 'function-logs');
  assert.ok(logs && logs.keptBy[0].keeps === 'metadata', 'premise: this site\'s hosting logs say they keep facts about each request');
  logs.keptBy[0].keeps = 'content';
  held.recipients.push({ id: 'function-logs:former', key: 'Former hosting logs', role: 'function-logs', host: 'former-logs.fixture.example', receives: 'each request', keptBy: [{ holder: 'Former host', keeps: 'metadata' }] });
  const commons = held.sources.find((s: Mod) => s.sourceId === 'data-commons');
  commons.recipients.push({ id: 'data-commons:former', key: 'A former Data Commons recipient', role: 'source', host: 'former-commons.fixture.example', receives: 'the searches the model writes', keptBy: [{ holder: 'Former holder', keeps: 'content' }] });
  held.version = computeBaseVersion(held.recipients);
  SIGNED_IN_DB();
  sessions.rows.clear();
  sessions.rows.set(DB_ID, {
    userId: DB_ID,
    states: Object.fromEntries((statement.sources as Mod[]).map((s) => [s.sourceId, { state: 'on', since: '2026-10-01' }])),
    flowsHash: statementHash(held),
    flowsStatement: held,
    consentedAt: new Date('2026-10-01T08:00:00.000Z'),
    updatedAt: UPDATED,
  });
  return { held, statement };
}

function expectedNotices(statement: Mod): string[] {
  const logs = statement.recipients.find((r: Mod) => r.role === 'function-logs');
  const where = logs.host ?? logs.runsAt;
  return [
    T12_LESS(`${T12_LOGS} (${where})`),
    T12_REMOVED(`${T12_LOGS} (former-logs.fixture.example)`),
    `${NAME['data-commons']} now says it keeps less.`,
  ];
}

const noticeLines = (surface: Surface) => surface.elements().filter((el) => typeof el.props['data-notice'] === 'string').map((el) => textOf(el));

test('criterion 1, the notices on the panel: T12\'s two recipient lines, "This site\'s hosting logs", and T13\'s name', async () => {
  await under({}, async () => {
    const { statement } = await rowWithNotices();
    answers();
    const panel = await mount(h(Panel));
    assert.equal(panel.buttons('Allow').length, 0, 'premise: the three changes ask nothing');
    assert.deepEqual([...noticeLines(panel)].sort(), [...expectedNotices(statement)].sort(), 'the notice lines are not as ruled');
    assertNoneReplaced(readWithLinks(panel), 'the panel (with notices)');
    panel.unmount();
  });
});

/** UX-2 P4b (M7): the tab's states, notices and version line live in the Settings overlay's Data sources sub-page. */
async function sourcesTab(): Promise<Surface> {
  return mount(h(SettingsOverlay, {}));
}

test('criterion 1, Data sources in the Settings overlay (UX-2 P4b), with notices: the same lines, and T12\'s version sentence with the held statement\'s base version', async () => {
  await under({}, async () => {
    const { held, statement } = await rowWithNotices();
    answers();
    const tab = await sourcesTab();
    assert.deepEqual([...noticeLines(tab)].sort(), [...expectedNotices(statement)].sort(), 'the tab\'s notice lines are not as ruled');
    assert.ok(tab.text().includes(T12_TAB(held.version, held.date)), `the tab does not read "${T12_TAB(held.version, held.date)}": ${tab.text().slice(0, 600)}`);
    assertRowNames(tab, 'the Sources tab', CONFIGURED);
    assertNoneReplaced(readWithLinks(tab), 'the Sources tab (with notices)');
    tab.unmount();
  });
});

test('criterion 1, Data sources in the Settings overlay (UX-2 P4b), in force: T12\'s version sentence and T13\'s names', async () => {
  await under({}, async () => {
    SIGNED_IN_DB();
    sessions.rows.clear();
    answers();
    await putStates({ socrata: 'on', 'data-commons': 'off', 'nyc-charter': 'ask-first' });
    const statement = await buildFlowsStatement();
    const tab = await sourcesTab();
    assert.ok(tab.text().includes(T12_TAB(statement.version, statement.date)), `the tab does not read "${T12_TAB(statement.version, statement.date)}": ${tab.text().slice(0, 600)}`);
    assertRowNames(tab, 'the Sources tab', CONFIGURED);
    assertNoneReplaced(readWithLinks(tab), 'the Sources tab (in force)');
    tab.unmount();
  });
});

// UX-2 P4b (M1 of the v2 check): the overlay opens from the card before any consent and behaves as the panel does
// there, so with no consent it reads the panel's T9 lead, not the tab's T9 line.
test('criterion 1, Data sources in the Settings overlay with no consent: the panel\'s T9 lead, not the tab\'s T9 line', async () => {
  await under({}, async () => {
    SIGNED_IN_DB();
    sessions.rows.clear();
    answers();
    const tab = await sourcesTab();
    assert.ok(tab.text().includes(T9_PANEL), `the overlay with no consent does not read "${T9_PANEL}": ${tab.text().slice(0, 400)}`);
    assert.ok(!tab.text().includes(T9_TAB), 'the overlay reads the retired tab line');
    assertNoneReplaced(readWithLinks(tab), 'the Settings overlay (no consent)');
    tab.unmount();
  });
});

// --- The Not now line --------------------------------------------------------------------------------

test('criterion 1, the Don\'t allow line (home): T5 as item 46 re-words it (UX-2 P4b)', async () => {
  await under({}, async () => {
    ANON();
    sessions.rows.clear();
    answers();
    const page = await mount(h(Home));
    const box = page.elements().filter((el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
    assert.equal(box.length, 1, 'premise: the home page has its question box');
    await page.type(box[0], 'What was the median household income in the Bronx?');
    await page.submit(page.elements().filter((el) => el.type === 'form')[0]);
    assert.equal(page.buttons("Don't allow").length, 1, `premise: the home page shows the card: ${page.text().slice(0, 300)}`);
    await page.click(page.button("Don't allow"));
    assert.ok(page.text().includes(T5), `after Don't allow the home page does not read T5: ${page.text().slice(0, 600)}`);
    assert.ok(!page.text().includes('Change your question'), 'after Don\'t allow the home page reads the replaced line');
    page.unmount();
  });
});

// --- The privacy page: its consent sections, with and without a database; the page as a whole -------

interface Section { id: string; heading: string; statements: Array<{ id: string; parts: Array<string | { text?: string; code?: string; link?: string }> }> }

const partText = (p: Section['statements'][number]['parts'][number]) => (typeof p === 'string' ? p : p.text ?? p.code ?? '');
const statementText = (st: Section['statements'][number]) => st.parts.map(partText).join('');
const sectionText = (s: Section) => s.statements.map(statementText).join(' ');
/** The section's text with every link's address beside it. */
const sectionRead = (s: Section) => `${s.heading} ${sectionText(s)} ${s.statements.flatMap((st) => st.parts.flatMap((p) => (typeof p === 'object' && p.link ? [p.link] : []))).join(' ')}`;

function consentSections(): Section[] {
  const sections = (facts.buildPrivacySections({ service: 'plausible', id: 'placeholder-analytics-id' }) as Section[]).filter((s) => s.id.startsWith('consent'));
  assert.ok(sections.length >= 5, `premise: the privacy page has its consent sections: ${sections.map((s) => s.heading).join(' | ')}`);
  return sections;
}

function section(sections: Section[], heading: string): Section {
  const found = sections.find((s) => s.heading === heading);
  assert.ok(found, `the privacy page has no "${heading}" section: ${sections.map((s) => s.heading).join(' | ')}`);
  return found!;
}

for (const db of [true, false]) {
  test(`criterion 1, the privacy page's consent sections (${db ? 'with' : 'without'} a database): T2, T3, T4, T7, T10, T11, T13 and T14 as ruled, each in its section`, async () => {
    await under({ db }, async () => {
      const sections = consentSections();
      const how = sectionText(section(sections, 'How consent works'));
      for (const [label, sentence] of [['T2', T2], ['T7', T7], ['T3', T3_TEXT1]] as const) {
        assert.ok(how.includes(sentence), `${label} does not render in "How consent works": "${sentence}" in ${how}`);
      }
      assert.ok(how.includes(db ? WITHDRAW_PRIVACY_DB : WITHDRAW_PRIVACY_NO_DB), 'the privacy page\'s own withdraw statement changed (T3 keeps it)');
      const keep = sectionText(section(sections, 'What recipients keep'));
      for (const sentence of T4_KEEP) assert.ok(keep.includes(sentence), `T4 does not render in "What recipients keep": "${sentence}" in ${keep}`);
      const eachSection = section(sections, 'Each data source');
      const each = sectionText(eachSection);
      for (const sentence of T4_EACH) assert.ok(each.includes(sentence), `T4 does not render in "Each data source": "${sentence}" in ${each}`);
      const changesSection = section(sections, 'Changes');
      assert.ok(sectionText(changesSection).includes(T10), `T10 does not render in "Changes": ${sectionText(changesSection)}`);
      const links = changesSection.statements.flatMap((st) => st.parts.flatMap((p) => (typeof p === 'object' && p.link ? [p.link] : [])));
      assert.ok(links.includes(T14), `the change log is not linked at ${T14}: ${links.join(' ')}`);

      // T11 and T13 on the source rows.
      const statement = await buildFlowsStatement();
      const operator = statement.sources.flatMap((s: Mod) => s.recipients.flatMap((r: Mod) => r.keptBy)).find((k: Mod) => k.keeps === 'operator-states');
      assert.ok(each.includes(T11(operator.holder)), `T11 does not render on the source rows: "${T11(operator.holder)}"`);
      for (const id of CONFIGURED) {
        const row = eachSection.statements.find((st) => st.id === `source-row-${id}`);
        assert.ok(row, `premise: the privacy page has a row for ${id}`);
        assert.ok(statementText(row!).startsWith(`${NAME[id]}: `), `the privacy page's row for ${id} is not named "${NAME[id]}": ${statementText(row!).slice(0, 80)}`);
      }
      for (const s of sections) assertNoneReplaced(sectionRead(s), `the privacy page's "${s.heading}"`, RULED_BACK_ON_THE_PRIVACY_PAGE);
    });
  });
}

test('criterion 1, the privacy page as a whole (T13): no "Google Data Commons" and no " MCP Server" anywhere; R3\'s lines name each source by its one name', async () => {
  for (const config of [{}, { boston: true }] as Config[]) {
    await under(config, async () => {
      ANON();
      const page = await mount(h(PrivacyPage));
      const text = page.text();
      for (const old of NAMES_REPLACED) {
        const at = text.indexOf(old);
        assert.ok(at < 0, `the privacy page${config.boston ? ' (with Boston)' : ''} still renders "${old}": …${text.slice(Math.max(0, at - 120), at + 80)}…`);
      }
      assert.ok(text.includes(`The data source ${NAME['data-commons']}, at `), 'the recipient line does not name Data Commons by its one name');
      assert.ok(text.includes(`The data source ${NAME.socrata}, at `), 'the recipient line does not name Socrata by its one name');
      assert.ok(text.includes(`The data source ${NAME['nyc-charter']} runs in a Vercel Sandbox this site starts`), 'the hosted-source line does not name NYC Charter by its one name');
      assert.ok(text.includes(`The searches and queries the AI model writes for ${NAME['nyc-charter']}, which`), 'the hosted exchange line does not name NYC Charter by its one name');
      assert.ok(text.includes(`The data source ${NAME['nyc-charter']} runs in a Vercel Sandbox that this site keeps`), 'the sandbox platform line does not name NYC Charter by its one name');
      if (config.boston) assert.ok(text.includes(`The data source ${NAME['boston-opencontext']}, at `), 'the recipient line does not name Boston by its one name');
      page.unmount();
    });
  }
});
