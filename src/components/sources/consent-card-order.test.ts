// UX-2 P4b, criteria 3, 5 and 6 on the consent card (D6 = B, ASK1 = A,
// ASK2 = B, D7 = C on the card).
//
// THE CARD, IN THIS ORDER (Task C, M2, as the owner's card ruling moves it,
// #729 comment 6727853028): the heading; "Allow" and "Don't allow" (item 8);
// the effect; ASK1's line, whose "Data source settings" (item 10) opens
// `/settings`; the privacy link; the analytics line; the cookie line. The
// ruling removed `CARD_LEAD` (item 34) and, by the owner's note on D2, item
// 11's words from the card.
//
// WHAT D6 B DROPS: `cardReachSentence`, `cardPointerSentence`,
// `<LocalOnlyOffer>`, the `<details>` recipients block and `CARD_CONTROLS_*`.
// No "Allow all data sources" on the card (S3). Item 11's words no longer
// render on it (the owner's note on D2; they rendered once before, M3).
// "Don't allow" on the card sends nothing and stores nothing (criterion 5's
// last line).
//
// WHAT IS DRIVEN. The real card on the surface harness, with the real flows and
// consent routes behind it, on an instance with analytics configured (so its
// line renders) and three sources (so the reach sentence would name them).
//
// WHAT MAKES IT ABLE TO FAIL. At the base the card renders the reach and
// pointer sentences, the local-only offer, `CARD_CONTROLS_*` and the
// disclosure, says "Not now", and has no ASK1 line and no settings link.
// Before the owner's card ruling it opened with "Before your first question"
// and the lead, and put the effect and the privacy link above the buttons.
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

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'OIDC_ISSUER', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'DATABASE_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'none';
process.env.NEXT_PUBLIC_ANALYTICS_SERVICE = 'plausible';
process.env.NEXT_PUBLIC_ANALYTICS_ID = 'fixture.example';

const ORIGIN = 'https://site.fixture.example';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Card = (await load('components/sources/ConsentCard.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement } = await load('lib/flows/statement.ts');
const { readerSourceName } = await load('lib/sources/source-name.ts');
const copy = await load('lib/sources/copy.ts');

// The ruled words (the research check's text; `p4b-ruled-words.test.ts` pins the constants).
// The owner's card ruling (#729 comment 6727853028): D1 = A's heading, D2 = A's effect with the owner's note.
const HEADING = 'Allow this site to send your question to a model service?';
const EFFECT = 'Allow sends your question to the model service. It sends the searches the model writes to data sources that are On or that you allow when asked.';
const ITEM_11 = "Don't allow: nothing is sent. You are asked again when you send a question.";
const ASK1_LINE = 'You can change or withdraw this in Data source settings.';
const DONT_ALLOW = "Don't allow";
const ALLOW_ALL = 'Allow all data sources';
const SETTINGS_LINK = 'Data source settings';
const ANALYTICS = 'An analytics service counts page visits. The privacy page names it and says how to object.';
const COOKIE = 'We keep your answer for this browser session in a cookie.';

async function card(): Promise<{ shown: Surface; net: ReturnType<typeof installFetch>; declined: number[] }> {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  const net = installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
  const declined: number[] = [];
  const decline = () => { declined.push(1); };
  const shown = await mount(h(Card, { onAllow: () => undefined, onNotNow: decline, onDecline: decline }));
  return { shown, net, declined };
}

/** The document-order index of the first element `pick` accepts, or -1. */
const at = (els: HostElement[], pick: (el: HostElement) => boolean): number => els.findIndex(pick);
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

// The owner's card ruling moves the order: the lead is gone, the buttons follow the heading, and the settings link
// sits inside ASK1's line (it was a line of its own below the buttons).
test('UX-2 P4b criterion 3 (Task C, M2): the card renders heading, Allow and Don\'t allow, effect, ASK1\'s line with Data source settings, privacy link, analytics, cookie, in that order', async () => {
  const { shown } = await card();
  const els = shown.elements();
  const order: Record<string, number> = {
    heading: at(els, (el) => /^h[1-3]$/.test(el.type) && textOf(el) === HEADING),
    allow: at(els, (el) => el.type === 'button' && textOf(el) === 'Allow'),
    dontAllow: at(els, (el) => el.type === 'button' && textOf(el) === DONT_ALLOW),
    effect: at(els, (el) => el.type === 'p' && textOf(el) === EFFECT),
    ask1: at(els, (el) => el.type === 'p' && textOf(el) === ASK1_LINE),
    settings: at(els, (el) => el.type === 'a' && el.props.href === '/settings' && textOf(el) === SETTINGS_LINK),
    privacy: at(els, (el) => el.type === 'a' && el.props.href === '/privacy'),
    analytics: at(els, (el) => el.type === 'p' && textOf(el) === ANALYTICS),
    cookie: at(els, (el) => el.type === 'p' && textOf(el) === COOKIE),
  };
  const missing = Object.entries(order).filter(([, i]) => i < 0).map(([k]) => k);
  assert.deepEqual(missing, [], `the card does not render: ${missing.join(', ')}; it reads: ${shown.text().slice(0, 600)}`);
  const names = Object.keys(order);
  const sorted = [...names].sort((a, b) => order[a] - order[b]);
  assert.deepEqual(sorted, names, `the card's order is ${sorted.join(', ')}`);
  shown.unmount();
});

test('UX-2 P4b criterion 3 (D6 B): the card renders none of the reach and pointer sentences, the local-only offer, CARD_CONTROLS_* or the disclosure', async () => {
  const { shown } = await card();
  const text = shown.text();
  const statement = await buildFlowsStatement();
  // The reach and pointer sentences by their fixed words (R9 P3's T3 and T4), since D6 B retires the builders too.
  assert.ok(!text.includes('Your question can reach one model service and'), 'the card renders cardReachSentence');
  for (const name of statement.sources.map((s: Mod) => readerSourceName(s) as string)) assert.ok(!text.includes(`They are ${name}`) && !text.includes(`It is ${name}.`), `the card names ${name} in a reach sentence`);
  assert.ok(!text.includes('says it keeps is listed below, under'), 'the card renders cardPointerSentence');
  assert.ok(!text.includes(copy.LOCAL_ONLY_OFFER), 'the card renders <LocalOnlyOffer>');
  for (const controls of ['You can set each source to On, Ask first or Off beside the question box at any time.']) {
    assert.ok(!text.includes(controls), 'the card renders CARD_CONTROLS_*');
  }
  assert.equal(shown.elements().filter((el) => el.type === 'details' || typeof el.props['data-recipient'] === 'string').length, 0, 'the card renders the <details> recipients block');
  shown.unmount();
});

test('UX-2 P4b criterion 6 (S3): the consent card renders no "Allow all data sources"', async () => {
  const { shown } = await card();
  assert.ok(shown.buttons('Allow').length === 1, `premise: the card has its Allow: ${shown.text().slice(0, 300)}`);
  assert.equal(shown.elements().filter((el) => textOf(el) === ALLOW_ALL).length, 0, 'the card renders "Allow all data sources"');
  assert.ok(!shown.text().includes(ALLOW_ALL), 'the card names "Allow all data sources"');
  shown.unmount();
});

// The owner's note on D2 (#729 comment 6727853028) drops item 11's words from the card: the form's after-line says
// what "Don't allow" did, and the privacy page keeps the full sentence. This test asserted they rendered once (M3).
test('UX-2 P4b criterion 3 (the owner\'s note on D2): item 11\'s words do not render on the card', async () => {
  const { shown } = await card();
  assert.equal(count(shown.text(), ITEM_11), 0, `item 11's words render ${count(shown.text(), ITEM_11)} times`);
  shown.unmount();
});

test('UX-2 P4b criterion 5: the card\'s "Don\'t allow" calls no consent write and stores nothing', async () => {
  const { shown, net, declined } = await card();
  const buttons = shown.buttons(DONT_ALLOW);
  assert.equal(buttons.length, 1, `the card has no one "${DONT_ALLOW}": ${shown.text().slice(0, 300)}`);
  net.clear();
  await shown.click(buttons[0]);
  assert.deepEqual(net.sent.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`), [], '"Don\'t allow" wrote something');
  assert.equal(net.jar.size, 0, '"Don\'t allow" left a cookie');
  assert.equal(declined.length, 1, 'the surface was not told the reader declined');
  shown.unmount();
});
