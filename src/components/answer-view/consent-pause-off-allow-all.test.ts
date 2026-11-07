// UX-2 P4b, criteria 5 and 6 at the pause (D7 = C; ASK2 = B with S4; H1, L1).
//
// THE PAUSE RENDERS TWICE: the step card (`ConsentStep`'s default export, in
// the run's steps and in a Sources panel row) and the compact prompt at the top
// of the results (`ConsentPausePrompt`). The buttons and the choices sentence
// land on both:
//   - "Don't allow" (item 8) posts the Off value, `off`: the source is turned
//     Off in the store (here the cookie, signed out) and reads Off in the panel;
//   - "Allow all data sources" (item 9) is a third button below the pair, full
//     width, lighter than the pair (its border colour and font weight; M5), and
//     posts `allow-all`, which writes every configured source On.
// The outcome sentences land on the step card and the row card only (L1):
// item 21 after "Don't allow", B4b after "Allow all", each with item 13's one
// pointer ("You can change this in Data source settings", once, never twice).
//
// WHAT IS DRIVEN. The real step card, the real prompt and the real Sources
// panel on R6's surface harness, the bus in `useSourceConsent.ts`, and the
// REAL decision and consent routes over the fake store of
// `decision-store-for-tests.ts`, on node:test's mocked clock. The consent is
// the session cookie, written through the real consent route. Three sources
// are configured, Boston Ask first and Data Commons Off, so "every configured
// source On" cannot hold by coincidence.
//
// THE DECOY (M5). `lighter` is shown to read NO when the third button is given
// the pair's own style, before its YES on the rendered button is trusted.
//
// BLIND SPOTS, stated. No layout: "full width" is read as the button's own
// style (`width: 100%`, or a flex basis of 100%), and "below the pair" as the
// third button sitting outside the pair's row, after it in document order. The
// measured width is the criterion 8 instrument's.
//
// WHAT MAKES IT ABLE TO FAIL. At the base both renderings offer "Allow" and
// "Not now" only, and the decision route refuses `off` and `allow-all` (400).
//
// Run with: npm test

import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType, CSSProperties } from 'react';
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
import { FAKE_VERCEL_KV_MODULE, FakeDecisionKv } from '../../lib/sources/decision-store-for-tests.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, '@vercel/kv': FAKE_VERCEL_KV_MODULE });

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'DATABASE_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';
process.env.SOURCE_ROUTING = 'in-loop';
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.KV_REST_API_URL = 'https://kv.fixture.example';
process.env.KV_REST_API_TOKEN = 'fixture-kv-token';

const kv = new FakeDecisionKv();
(globalThis as unknown as { __w2DecisionKv: FakeDecisionKv }).__w2DecisionKv = kv;

const ORIGIN = 'https://site.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/' },
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target, querySelectorAll: () => [], querySelector: () => null },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;

const stepModule = await load('components/answer-view/ConsentStep.tsx');
const Card = stepModule.default as ComponentType<Json>;
const Prompt = stepModule.ConsentPausePrompt as ComponentType;
const SourcesPanel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType;
const bus = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { readConsentCookie } = await load('lib/sources/consent.ts');

// --- The words (the research check's text) ------------------------------------------------------

const ALLOW = 'Allow';
const DONT_ALLOW = "Don't allow";
const ALLOW_ALL = 'Allow all data sources';
const CHOICES = "Allow: this question is sent to it, and it is turned On for later questions. Don't allow: nothing is sent to it, and it is turned Off for later questions. Allow all data sources: every data source is turned On, and this question goes on without asking again.";
const DECLINED = "You chose Don't allow. Nothing is sent to it, and it is Off now.";
const ALLOWED_ALL = 'You chose Allow all data sources. Every data source is On now.';
const POINTER = 'You can change this in Data source settings';

// --- The fixture ----------------------------------------------------------------------------------

const T0 = Date.parse('2026-11-07T12:00:00.000Z');
const statement = await buildFlowsStatement();
const CONFIGURED = (statement.sources as Mod[]).map((s) => s.sourceId as string);
const BOSTON = (statement.sources as Mod[]).find((s) => s.sourceId === 'boston-opencontext');
let run = 0;
/** A key per pause per test (the harness can leave subscriptions on the bus between tests). */
const nextKey = () => `b4b0${String(++run).padStart(4, '0')}0123456789abcdef01234567`;
const iso = (t: number) => new Date(t).toISOString();
const pauseAt = (key: string, start: number) => ({ key, source: BOSTON, outbound: [], links: statement.links, expiresAt: iso(start + 60_000), entryExpiresAt: iso(start + 600_000), holds: true });

const mounted: Surface[] = [];
afterEach(() => {
  for (const page of mounted.splice(0)) page.unmount();
  mock.timers.reset();
});

function answers() {
  return installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': (request: Request) => (decisionRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

function* within(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) { for (const c of node) yield* within(c); return; }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as HostElement;
  if (typeof el.type === 'string') yield el;
  yield* within((el.props as { children?: unknown }).children);
}

type Rendering = 'step card' | 'prompt' | 'row card';

/** The element that holds one rendering of the pause, or undefined. */
function renderingOf(page: Surface, which: Rendering): HostElement | undefined {
  if (which === 'prompt') return page.elements().find((el) => el.props['data-part'] === 'consent-pause-prompt');
  const place = which === 'step card' ? 'steps' : 'row';
  return page.elements().find((el) => el.props['data-part'] === 'consent-step' && el.props['data-consent-place'] === place);
}
const buttonsIn = (node: HostElement): HostElement[] => [...within(node.props.children)].filter((el) => el.type === 'button');
const outcomeIn = (node: HostElement): string | null => {
  const found = [...within(node.props.children)].find((el) => el.props['data-part'] === 'consent-outcome');
  return found ? textOf(found) : null;
};
function buttonOf(page: Surface, which: Rendering, label: string): HostElement {
  const node = renderingOf(page, which);
  assert.ok(node, `the ${which} is not rendered: ${page.text().slice(0, 300)}`);
  const found = buttonsIn(node!).filter((b) => textOf(b) === label);
  assert.equal(found.length, 1, `the ${which} has no one "${label}": ${buttonsIn(node!).map((b) => textOf(b)).join(', ')}`);
  return found[0];
}
function stateIn(page: Surface, sourceId: string): unknown {
  const row = page.elements().find((el) => el.props['data-source'] === sourceId);
  assert.ok(row, `premise: the panel has no ${sourceId} row`);
  return [...within(row!.props.children)].find((el) => el.type === 'input' && el.props.checked === true)?.props.value;
}
function cookieStates(net: ReturnType<typeof answers>): Record<string, string> {
  const cookie = readConsentCookie(new Request(`${ORIGIN}/`, { headers: { cookie: [...net.jar].map(([k, v]) => `${k}=${v}`).join('; ') } }));
  return Object.fromEntries(Object.entries((cookie?.states ?? {}) as Record<string, { state: string }>).map(([id, s]) => [id, s.state]));
}
const decisionsPosted = (net: ReturnType<typeof answers>) => net.sent.filter((r) => r.method === 'POST' && r.path === '/api/sources/consent/decision').map((r) => (JSON.parse(r.body) as Json).decision);

/** The clock at T0, a consent in the cookie (Boston Ask first, Data Commons Off), the entry and the pause, and the three renderings. */
async function paused(): Promise<{ page: Surface; key: string; net: ReturnType<typeof answers>; tick: (ms: number) => Promise<void> }> {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  const net = answers();
  const states = Object.fromEntries(CONFIGURED.map((id) => [id, id === 'boston-opencontext' ? 'ask-first' : id === 'data-commons' ? 'off' : 'on']));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, 'premise: the consent was written');
  const key = nextKey();
  assert.equal(await kv.set(`consent-decision:${key}`, { sourceId: 'boston-opencontext' }, { ex: 600, nx: true }), 'OK', 'premise: the entry was written');
  const pause = pauseAt(key, T0);
  bus.reportConsentPause(pause);
  const page = await mount(h('div', null, h(Prompt), h(Card, { pause }), h(SourcesPanel)));
  mounted.push(page);
  await page.settle();
  assert.equal(stateIn(page, 'boston-opencontext'), 'ask-first', 'premise: Boston is Ask first');
  net.clear();
  return { page, key, net, tick: async (ms: number) => { mock.timers.tick(ms); await page.settle(); } };
}

// --- The style readers, and their decoy (M5) -------------------------------------------------------

const weight = (style: CSSProperties | undefined): number => Number(style?.fontWeight ?? 400);
function borderColour(style: CSSProperties | undefined): string {
  if (style?.borderColor !== undefined) return String(style.borderColor);
  const border = String(style?.border ?? '');
  const at = border.indexOf('solid');
  return at === -1 ? border.trim() : border.slice(at + 'solid'.length).trim();
}
/** Lighter than the pair: a lower font weight, and a border colour that is not the pair's. */
function lighter(third: CSSProperties | undefined, pair: CSSProperties | undefined): boolean {
  return weight(third) < weight(pair) && borderColour(third) !== borderColour(pair);
}
const fullWidth = (style: CSSProperties | undefined): boolean =>
  style?.width === '100%' || style?.flexBasis === '100%' || /\b100%/.test(String(style?.flex ?? ''));

test('decoy (M5): a third button given the pair\'s own style reads NO; a grey, regular one reads YES', () => {
  const pair: CSSProperties = { border: '1px solid var(--accent)', fontWeight: 600 };
  assert.equal(lighter(pair, pair), false, 'the reader calls the pair\'s own style lighter');
  assert.equal(lighter({ ...pair, fontWeight: 400 }, pair), false, 'the reader calls a regular weight in the accent border lighter');
  assert.equal(lighter({ border: '1px solid var(--border-color)', fontWeight: 600 }, pair), false, 'the reader calls a grey border at the pair\'s weight lighter');
  assert.equal(lighter({ border: '1px solid var(--border-color)', fontWeight: 400 }, pair), true, 'the reader does not call a grey, regular button lighter');
  assert.equal(fullWidth({ width: '100%' }), true);
  assert.equal(fullWidth({ flex: '1 1 0' }), false);
});

// --- Criterion 6: the third button on both renderings ----------------------------------------------

for (const which of ['step card', 'prompt'] as const) {
  test(`UX-2 P4b criterion 6 (${which}): "Allow all data sources" renders below the pair, full width, lighter than the pair; the choices sentence is item 39's with B4c`, async () => {
    const { page } = await paused();
    const node = renderingOf(page, which);
    assert.ok(node, `the ${which} is not rendered`);
    const labels = buttonsIn(node!).map((b) => textOf(b));
    assert.deepEqual(labels, [ALLOW, DONT_ALLOW, ALLOW_ALL], `the ${which}'s buttons, in order`);
    const [allow, dontAllow, third] = buttonsIn(node!);
    assert.deepEqual(allow.props.style, dontAllow.props.style, 'the pair are styled differently');
    // Below the pair: outside the element that holds the pair, and after it.
    const all = [...within(node!.props.children)];
    const pairRow = all.find((el) => [...within(el.props.children)].includes(allow) && [...within(el.props.children)].includes(dontAllow) && el.type !== 'p');
    assert.ok(pairRow, 'premise: the pair sit in one row');
    assert.ok(![...within(pairRow!.props.children)].includes(third), `the third button sits in the pair's row on the ${which}`);
    assert.ok(all.indexOf(third) > all.indexOf(dontAllow), 'the third button does not come after the pair');
    assert.ok(fullWidth(third.props.style as CSSProperties), `the third button is not full width: ${JSON.stringify(third.props.style)}`);
    assert.ok(lighter(third.props.style as CSSProperties, allow.props.style as CSSProperties), `the third button does not read lighter than the pair: ${JSON.stringify(third.props.style)} against ${JSON.stringify(allow.props.style)}`);
    assert.ok(textOf(node!).includes(CHOICES), `the ${which} does not read item 39's choices with B4c: ${textOf(node!).slice(0, 400)}`);
  });
}

for (const which of ['step card', 'prompt'] as const) {
  test(`UX-2 P4b criterion 6 (${which}): pressing "Allow all data sources" posts allow-all and writes every configured source On`, async () => {
    const { page, net } = await paused();
    await page.click(buttonOf(page, which, ALLOW_ALL));
    await page.settle();
    assert.deepEqual(decisionsPosted(net), ['allow-all'], 'the button did not post allow-all');
    const states = cookieStates(net);
    assert.deepEqual(Object.keys(states).sort(), [...CONFIGURED].sort(), `the cookie does not hold every configured source: ${JSON.stringify(states)}`);
    assert.ok(Object.values(states).every((s) => s === 'on'), `not every configured source is On: ${JSON.stringify(states)}`);
    for (const id of CONFIGURED) assert.equal(stateIn(page, id), 'on', `the panel does not show ${id} On`);
  });
}

test('UX-2 P4b criterion 6 (B4b, item 13): after "Allow all" the step card and the row card say every source is On, with one pointer', async () => {
  const { page } = await paused();
  await page.click(buttonOf(page, 'step card', ALLOW_ALL));
  await page.settle();
  for (const which of ['step card', 'row card'] as const) {
    const node = renderingOf(page, which);
    assert.ok(node, `the ${which} is not rendered after the answer`);
    assert.ok(outcomeIn(node!)?.startsWith(ALLOWED_ALL), `the ${which}'s outcome is not B4b's: ${outcomeIn(node!)}`);
    assert.equal(textOf(node!).split(POINTER).length - 1, 1, `the ${which} does not carry item 13's one pointer: ${textOf(node!).slice(0, 400)}`);
  }
});

// --- Criterion 5: "Don't allow" turns the source Off, on both renderings --------------------------

for (const which of ['step card', 'prompt'] as const) {
  test(`UX-2 P4b criterion 5 (${which}): "Don't allow" posts off, turns the source Off in the cookie, and the panel reads it Off`, async () => {
    const { page, net } = await paused();
    await page.click(buttonOf(page, which, DONT_ALLOW));
    await page.settle();
    assert.deepEqual(decisionsPosted(net), ['off'], 'the decline did not post the Off value');
    const states = cookieStates(net);
    assert.equal(states['boston-opencontext'], 'off', `the cookie does not hold Boston Off: ${JSON.stringify(states)}`);
    assert.equal(states.socrata, 'on', 'the Off write moved another source');
    assert.equal(states['data-commons'], 'off', 'the Off write moved another source');
    assert.equal(stateIn(page, 'boston-opencontext'), 'off', 'the panel does not read Boston Off');
  });
}

test('UX-2 P4b criterion 5 (items 13, 21): after "Don\'t allow" the step card and the row card say it is Off now, with one pointer', async () => {
  const { page } = await paused();
  await page.click(buttonOf(page, 'step card', DONT_ALLOW));
  await page.settle();
  for (const which of ['step card', 'row card'] as const) {
    const node = renderingOf(page, which);
    assert.ok(node, `the ${which} is not rendered after the answer`);
    assert.ok(outcomeIn(node!)?.startsWith(DECLINED), `the ${which}'s outcome is not item 21's: ${outcomeIn(node!)}`);
    assert.equal(textOf(node!).split(POINTER).length - 1, 1, `the ${which} does not carry item 13's one pointer: ${textOf(node!).slice(0, 400)}`);
  }
});

test('UX-2 P4b criterion 5 (L11, the row card): "Don\'t allow" after the hold reads item 39\'s declinedAfter, and the source reads Off', async () => {
  const { page, net, tick } = await paused();
  await tick(120_000);
  await page.click(buttonOf(page, 'row card', DONT_ALLOW));
  await page.settle();
  assert.deepEqual(decisionsPosted(net), ['off'], 'the row card did not post the Off value');
  const node = renderingOf(page, 'row card');
  assert.ok(node, 'the row card is gone after the answer');
  assert.ok(outcomeIn(node!)?.startsWith("You chose Don't allow. It is Off for later questions."), `the row card after Don't allow: ${outcomeIn(node!)}`);
  assert.equal(stateIn(page, 'boston-opencontext'), 'off', 'the source does not read Off');
});
