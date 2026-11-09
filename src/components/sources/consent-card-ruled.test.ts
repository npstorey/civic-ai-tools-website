// UX-2 P4b: the consent card's words and order, as the owner ruled them
// (#729 comment 6727853028: D1 = A, D2 = A with the owner's note, D3 = A,
// D4 = A).
//
// THE CARD, IN RENDER ORDER, BYTE FOR BYTE:
//   1. the heading, an `h2` and the section's `aria-labelledby` target;
//   2. while the statement loads, "Reading where a question can go…", under
//      the heading and above the buttons (the seat's default placement);
//   3. "Allow" and "Don't allow";
//   4. the effect sentence;
//   5. the change line, whose "Data source settings" is the one link to the
//      Settings overlay (`SETTINGS_HREF`);
//   6. "The privacy page has the full statement.", linked to `/privacy`;
//   7. the analytics line where analytics is configured, then the cookie line.
// REMOVED: the heading "Before your first question", the two-sentence lead
// (T1, T2), the earlier effect sentence and the separate settings line.
//
// WHAT IS DRIVEN. The real card on the surface harness, with the real flows
// and consent routes behind it, on an instance with analytics configured (so
// its line renders). The loading line is read with the flows route held, so
// the statement has not arrived.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the card opens with "Before your
// first question" and the lead, puts the effect and the privacy link above the
// buttons, and has a separate settings line below them.
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
process.env.EXECUTOR_DRIVER = 'none';
process.env.NEXT_PUBLIC_ANALYTICS_SERVICE = 'plausible';
process.env.NEXT_PUBLIC_ANALYTICS_ID = 'fixture.example';

const ORIGIN = 'https://site.fixture.example';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Card = (await load('components/sources/ConsentCard.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { SETTINGS_HREF } = await load('lib/sources/copy.ts');

// The ruled words, byte for byte (#729 comment 6727853028).
const HEADING = 'Allow this site to send your question to a model service?';
const LOADING = 'Reading where a question can go…';
const EFFECT = 'Allow sends your question to the model service. It sends the searches the model writes to data sources that are On or that you allow when asked.';
const CHANGE = 'You can change or withdraw this in Data source settings.';
const SETTINGS_LINK = 'Data source settings';
const FULL_STATEMENT = 'The privacy page has the full statement.';
const ANALYTICS = 'An analytics service counts page visits. The privacy page names it and says how to object.';
const COOKIE = 'We keep your answer for this browser session in a cookie.';
const RULED = [HEADING, 'Allow', "Don't allow", EFFECT, CHANGE, FULL_STATEMENT, ANALYTICS, COOKIE];

// What the ruling removes from the card.
const REMOVED = [
  'Before your first question',
  'To answer, this site sends your question to a model service, and sends the searches the model writes to the data sources that are On.',
  'Your question is not sent beyond this site before you answer.',
  "Allow: your question is sent to the model service. A data source is used only if it is On, or if it is set to Ask first and you allow it when asked. Don't allow: nothing is sent. You are asked again when you send a question.",
  "Don't allow: nothing is sent.",
  'You are asked again when you send a question.',
];

/** Mount the card; with `holdFlows`, the statement never arrives, so the loading line shows. */
async function card(holdFlows = false): Promise<Surface> {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  installFetch(ORIGIN, {
    '/api/flows': () => (holdFlows ? new Response(JSON.stringify({ error: 'fixture: held' }), { status: 503 }) : flowsRoute.GET()),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
  return mount(h(Card, { onAllow: () => undefined, onNotNow: () => undefined }));
}

const sectionOf = (s: Surface): HostElement => {
  const found = s.elements().filter((el) => el.type === 'section' && 'data-consent-card' in el.props);
  assert.equal(found.length, 1, `premise: one consent card section, found ${found.length}`);
  return found[0];
};

test('UX-2 P4b ruled card: its readable text, in order, is the seven ruled items byte for byte', async () => {
  const shown = await card();
  assert.equal(textOf(sectionOf(shown)), RULED.join(' '), 'the card does not read as ruled');
  shown.unmount();
});

test('UX-2 P4b ruled card: the heading is an h2 and the section\'s aria-labelledby target', async () => {
  const shown = await card();
  const section = sectionOf(shown);
  const headings = shown.elements().filter((el) => /^h[1-6]$/.test(el.type));
  assert.equal(headings.length, 1, `premise: one heading, found ${headings.length}`);
  assert.equal(headings[0].type, 'h2', 'the heading is not an h2');
  assert.equal(textOf(headings[0]), HEADING, 'the heading does not read as ruled');
  assert.equal(section.props['aria-labelledby'], headings[0].props.id, 'the section is not labelled by the heading');
  shown.unmount();
});

test('UX-2 P4b ruled card: the buttons come before the effect, and the change line\'s "Data source settings" is its one link to Settings', async () => {
  const shown = await card();
  const els = shown.elements();
  const allow = els.findIndex((el) => el.type === 'button' && textOf(el) === 'Allow');
  const dontAllow = els.findIndex((el) => el.type === 'button' && textOf(el) === "Don't allow");
  const effect = els.findIndex((el) => el.type === 'p' && textOf(el) === EFFECT);
  assert.ok(allow >= 0 && dontAllow >= 0, 'premise: the card has its two buttons');
  assert.ok(effect >= 0, `the card renders no paragraph reading the ruled effect: ${shown.text().slice(0, 500)}`);
  assert.ok(allow < effect && dontAllow < effect, 'the effect sentence comes before the buttons');
  const toSettings = els.filter((el) => el.type === 'a' && el.props.href === SETTINGS_HREF);
  assert.equal(toSettings.length, 1, `the card has ${toSettings.length} links to ${SETTINGS_HREF}`);
  assert.equal(textOf(toSettings[0]), SETTINGS_LINK, 'the Settings link does not read "Data source settings"');
  const line = els.filter((el) => el.type === 'p' && textOf(el) === CHANGE);
  assert.equal(line.length, 1, 'no paragraph reads the change line');
  assert.ok(els.indexOf(toSettings[0]) > els.indexOf(line[0]) && els.indexOf(toSettings[0]) < els.indexOf(line[0]) + 3, 'the Settings link is not inside the change line');
  const privacy = els.filter((el) => el.type === 'a' && el.props.href === '/privacy');
  assert.deepEqual(privacy.map((el) => textOf(el)), [FULL_STATEMENT], 'the privacy link does not read as ruled');
  shown.unmount();
});

test('UX-2 P4b ruled card: none of the removed strings render', async () => {
  const shown = await card();
  const text = shown.text();
  const present = REMOVED.filter((s) => text.includes(s));
  assert.deepEqual(present, [], `the card still renders: ${present.join(' | ')}`);
  shown.unmount();
});

test('UX-2 P4b ruled card: while the statement loads, the loading line sits under the heading and above the buttons', async () => {
  const shown = await card(true);
  const els = shown.elements();
  const heading = els.findIndex((el) => el.type === 'h2');
  const loading = els.findIndex((el) => el.type === 'p' && textOf(el) === LOADING);
  const allow = els.findIndex((el) => el.type === 'button' && textOf(el) === 'Allow');
  assert.ok(loading >= 0, `premise: the loading line shows while the statement is held: ${shown.text().slice(0, 300)}`);
  assert.equal(textOf(els[heading]), HEADING, 'the heading does not read as ruled');
  assert.ok(heading < loading && loading < allow, 'the loading line is not between the heading and the buttons');
  shown.unmount();
});
