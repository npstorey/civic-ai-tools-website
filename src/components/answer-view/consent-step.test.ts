// #644 W2 criterion 3 (a), (b), (c) and (h), and criterion 4's step: the
// consent card (`ConsentStep.tsx`), rendered and clicked.
//
// THE CARD names the source by its reader name, never a tool's exposed name,
// and says, in the Sources panel's own form (R6 PL): what the source is and
// whose connector reaches it, running where (`sourceRowLines`, never
// "Published by"); each posture row as `KeptByLines` renders it, with its
// date or "not stated"; the hosts it would reach; the privacy page and the
// guide's address or the sentence that says this site names none (R6's D10);
// Allow and Not now, equal in size and style; and after a decision, its
// outcome. A pause that does not hold says the source can be turned On in
// the panel for the next question, and shows no buttons.
//
// WHAT IS DRIVEN. The real card and the real Sources panel on R6's surface
// harness (`src/components/sources/surface-test-harness.ts`), which runs
// their hooks; this file sits outside `src/components/sources/`, as
// `src/components/evidence/attestation-dialog-consent.test.ts` does. The
// decision route is answered by the test, which records each request. The
// panel's row reads the pause from the bus in `useSourceConsent.ts`
// (`reportConsentPause`), as the streaming hooks feed it.
//
// THE FIXTURE CAN FAIL. Its three posture rows differ in every way the card
// could flatten: one dated with a retention, one "not stated", one stated by
// this site's operator.
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
} from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

for (const name of ['DATA_COMMONS_MCP_URL', 'NYC_CHARTER_HOSTING', 'SITE_DEPLOYMENT_GUIDE_URL', 'APP_HOST', 'NEXTAUTH_URL']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;

const ORIGIN = 'https://site.fixture.example';
const sourceName = await load('lib/sources/source-name.ts');
const copy = await load('lib/sources/copy.ts');
const bus = await load('components/sources/useSourceConsent.ts');
const panelModule = await load('components/sources/SourcesPanel.tsx');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

/** The card W2 adds (a path typed `string`, so the red commit type-checks). */
const CARD: string = pathToFileURL(path.join(SRC, 'components', 'answer-view', 'ConsentStep.tsx')).href;
const cardModule = (await import(CARD).catch(() => null)) as Mod | null;
function Card(): ComponentType<Json> {
  assert.ok(cardModule?.default, 'src/components/answer-view/ConsentStep.tsx does not exist');
  return cardModule!.default as ComponentType<Json>;
}

// --- The fixture -------------------------------------------------------------------------

const KEY = '0123456789abcdef0123456789abcdef'; // gitleaks:allow
const SOURCE = {
  sourceId: 'boston-opencontext',
  displayName: 'Boston OpenContext MCP Server',
  publisher: 'not stated',
  variant: { variant: 'remote', kind: 'remote', runsAt: 'government' },
  host: 'boston.fixture.example',
  freshness: 'Varies by dataset',
  recipients: [{
    id: 'source:boston-opencontext',
    key: 'MCP servers',
    role: 'source',
    host: 'boston.fixture.example',
    receives: 'the search terms and filters for your question',
    keptBy: [
      { holder: 'Fixture Host A', keeps: 'metadata', retention: '30 days.', statementUrl: 'https://a.fixture.example/privacy', readOn: '2026-10-18' },
      { holder: 'Fixture Host B', keeps: 'not-stated', statementUrl: 'https://b.fixture.example/privacy', readOn: '2026-10-19' },
      { holder: "This site's operator", keeps: 'operator-states' },
    ],
  }],
  version: '1'.repeat(64),
};
const PAUSE = {
  key: KEY,
  source: SOURCE,
  outbound: [],
  links: { privacy: '/privacy', deploymentGuideOmitted: copy.NO_GUIDE_SENTENCE },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  holds: true,
};
const NAME = 'Boston OpenContext';

let decisions: Array<{ body: string }> = [];
let answerStatus = 200;
function answers() {
  decisions = [];
  return installFetch(ORIGIN, {
    '/api/sources/consent/decision': async (request: Request) => {
      decisions.push({ body: await request.text() });
      return new Response(JSON.stringify(answerStatus === 200 ? { decision: 'allow', sourceId: SOURCE.sourceId } : { error: 'x' }), { status: answerStatus, headers: { 'Content-Type': 'application/json' } });
    },
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};

function* within(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) { for (const child of node) yield* within(child); return; }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as HostElement;
  if (typeof el.type === 'string') yield el;
  yield* within((el.props as { children?: unknown }).children);
}

/** The card's own element. */
function cardOf(surface: Surface): HostElement {
  const found = surface.elements().filter((el) => el.props['data-part'] === 'consent-step');
  assert.equal(found.length, 1, `expected one consent step, found ${found.length}: ${surface.text().slice(0, 400)}`);
  return found[0];
}

async function mountCard(pause: Json = PAUSE): Promise<Surface> {
  answers();
  bus.reportConsentPause?.(pause);
  return mount(h(Card(), { pause }));
}

// --- (a) every item, from the fixture ----------------------------------------------------

test('criterion 3 (a): the card names the source by its reader name, never a tool\'s exposed name', async () => {
  const card = await mountCard();
  const text = textOf(cardOf(card));
  assert.ok(text.startsWith(`${NAME} is set to Ask first.`), `the card opens: ${text.slice(0, 120)}`);
  assert.doesNotMatch(text, /MCP Server|boston__|load_source/);
  card.unmount();
});

test('criterion 3 (a): each posture row reads as KeptByLines renders it: dated, "not stated", and stated by the operator', async () => {
  const card = await mountCard();
  const text = textOf(cardOf(card));
  assert.ok(text.includes('Fixture Host A says it keeps facts about each request (how long: 30 days) (its statement, read 2026-10-18)'), text);
  assert.ok(text.includes('Fixture Host B: not stated (its statement, read 2026-10-19)'), text);
  assert.ok(text.includes(`This site's operator: ${copy.KEPT_FOR_OPERATOR}`), text);
  const links = [...within(cardOf(card))].filter((el) => el.type === 'a').map((el) => el.props.href);
  assert.ok(links.includes('https://a.fixture.example/privacy') && links.includes('https://b.fixture.example/privacy'), `the statements are not linked: ${links.join(', ')}`);
  card.unmount();
});

test('criterion 3 (a): the hosts it would reach, the privacy page, and the guide or the sentence that says there is none', async () => {
  const card = await mountCard();
  const element = cardOf(card);
  const text = textOf(element);
  assert.ok(text.includes('It would reach: boston.fixture.example.'), text);
  const privacy = [...within(element)].filter((el) => el.type === 'a' && el.props.href === '/privacy');
  assert.equal(privacy.length, 1, 'the card does not link the privacy page once');
  assert.equal(textOf(privacy[0]), copy.PANEL_PRIVACY_LINK);
  assert.ok(text.includes(copy.NO_GUIDE_SENTENCE), 'the card does not say this site names no guide');
  card.unmount();
  const withGuide = await mountCard({ ...PAUSE, links: { privacy: '/privacy', deploymentGuide: 'https://guide.fixture.example/deploy' }, outbound: ['api.fixture.example', 'data.fixture.example'] });
  const guided = cardOf(withGuide);
  assert.ok([...within(guided)].some((el) => el.type === 'a' && el.props.href === 'https://guide.fixture.example/deploy'), 'the guide is not linked');
  assert.ok(!textOf(guided).includes(copy.NO_GUIDE_SENTENCE));
  assert.ok(textOf(guided).includes('It would reach: api.fixture.example, data.fixture.example.'), textOf(guided));
  withGuide.unmount();
});

test('criterion 3 (a): Allow and Not now, one button each, equal in size and style', async () => {
  const card = await mountCard();
  const allow = card.button('Allow');
  const notNow = card.button('Not now');
  assert.deepEqual(allow.props.style, notNow.props.style, 'the two buttons are styled differently');
  card.unmount();
});

// --- (h) the panel's own lines ------------------------------------------------------------

test('criterion 3 (h): the card\'s lines are sourceRowLines\', the panel\'s, and read neither "Published by" nor ", published by"', async () => {
  const card = await mountCard();
  const text = textOf(cardOf(card));
  const lines = sourceName.sourceRowLines(SOURCE);
  assert.ok(lines.what, 'premise: Boston has a what-line');
  const what = lines.what.charAt(0).toUpperCase() + lines.what.slice(1);
  const reach = lines.reach.map((part: string | { text: string }) => (typeof part === 'string' ? part : part.text)).join('');
  assert.ok(text.includes(what), `the card lacks the what-line "${what}": ${text}`);
  assert.ok(text.includes(reach), `the card lacks the reach sentence "${reach}": ${text}`);
  const publisher = lines.reach.find((part: unknown) => typeof part !== 'string') as { link: string; text: string };
  assert.ok([...within(cardOf(card))].some((el) => el.type === 'a' && el.props.href === publisher.link && textOf(el) === publisher.text), 'the publisher is not linked to its repository');
  for (const old of ['Published by', ', published by']) assert.ok(!text.includes(old), `the card reads "${old}"`);
  card.unmount();
});

// --- (b) the outcome ------------------------------------------------------------------------

for (const [label, decision, outcome] of [
  ['Allow', 'allow', 'You chose Allow. It is On now.'],
  ['Not now', 'not-now', 'You chose Not now. Nothing is sent to it for this question.'],
] as const) {
  test(`criterion 3 (b): after ${label}, the card posts its own key and shows the outcome, with no buttons`, async () => {
    answerStatus = 200;
    const card = await mountCard();
    await card.click(card.button(label));
    assert.deepEqual(decisions.map((d) => JSON.parse(d.body)), [{ key: KEY, decision }]);
    const text = textOf(cardOf(card));
    assert.ok(text.includes(outcome), `the card after ${label}: ${text}`);
    assert.equal(card.buttons('Allow').length + card.buttons('Not now').length, 0, 'the buttons stay after a decision');
    card.unmount();
  });
}

test('criterion 3 (b): a decision the route refuses as gone says the question is no longer waiting', async () => {
  answerStatus = 404;
  const card = await mountCard();
  await card.click(card.button('Allow'));
  assert.ok(textOf(cardOf(card)).includes('This question is no longer waiting for an answer.'), textOf(cardOf(card)));
  answerStatus = 200;
  card.unmount();
});

// --- Criterion 4: a pause that does not hold -----------------------------------------------

test('criterion 4: a pause that does not hold says the source can be turned On in the panel for the next question, with no buttons', async () => {
  const { key: _key, ...rest } = PAUSE;
  void _key;
  const card = await mountCard({ ...rest, holds: false });
  const text = textOf(cardOf(card));
  assert.ok(text.includes('This question cannot stop to ask you, so it was not used.'), text);
  assert.ok(text.includes('You can turn it On in the panel for your next question.'), text);
  assert.equal(card.buttons('Allow').length + card.buttons('Not now').length, 0);
  card.unmount();
});

// --- (c) the panel's row, fed through the bus ------------------------------------------------

test('criterion 3 (c): while a decision is pending, the panel\'s row for that source shows the card, below its state control', async () => {
  ANON();
  answers();
  const statement = await buildFlowsStatement();
  const put = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, s.sourceId === 'boston-opencontext' ? 'ask-first' : 'on'])), flowsVersion: statementHash(statement) }) });
  assert.equal(put.status, 200, 'premise: the consent write was refused');
  const panel = await mount(h(panelModule.default as ComponentType));
  const rowOf = (id: string) => panel.elements().find((el) => el.props['data-source'] === id)!;
  assert.equal([...within(rowOf('boston-opencontext'))].filter((el) => el.props['data-part'] === 'consent-step').length, 0, 'premise: a card before any pause');
  const live = { ...PAUSE, source: statement.sources.find((s: { sourceId: string }) => s.sourceId === 'boston-opencontext') };
  assert.equal(typeof bus.reportConsentPause, 'function', 'useSourceConsent.ts has no pause slot (reportConsentPause)');
  bus.reportConsentPause(live);
  await panel.settle();
  const row = rowOf('boston-opencontext');
  const inRow = [...within(row)];
  const cardAt = inRow.findIndex((el) => el.props['data-part'] === 'consent-step');
  const controlAt = inRow.findIndex((el) => el.props.role === 'radiogroup');
  assert.ok(cardAt > controlAt && controlAt >= 0, 'the row shows no card below its state control');
  assert.ok(inRow.some((el) => el.type === 'button' && textOf(el) === 'Allow'), 'the row\'s card has no Allow');
  const socrata = [...within(rowOf('socrata'))];
  assert.ok(!socrata.some((el) => el.props['data-part'] === 'consent-step'), 'another source\'s row shows the card');
  bus.reportConsentPause(null);
  await panel.settle();
  assert.ok(![...within(rowOf('boston-opencontext'))].some((el) => el.props['data-part'] === 'consent-step'), 'the row keeps the card after the run moved on');
  panel.unmount();
});
