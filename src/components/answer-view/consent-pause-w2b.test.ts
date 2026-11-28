// S4 W2b (npstorey/civic-ai-tools#335): the pause at scale, criterion B3, with the owner's rulings of 2026-11-24 (C3 = A,
// C3-ALL = A, C3-D = C, C4 = A, C6 = B) and of the second sitting (C3-D-H B, with N1 (b), N2 (b), OUTCOME_LINES A and
// POINTER (b)).
//
// WHAT IS DRIVEN. The real compact prompt (`ConsentPausePrompt`), the real step card and, at seven, the real Sources
// panel's row card, on R6's surface harness, through the bus in `useSourceConsent.ts` and the REAL `/api/flows`,
// `/api/sources/consent` and decision handlers over the fake decision store, on node:test's mocked clock. Three sizes:
//   - production's seven sources (one group of two, Socrata and NYC City Record): the pause is today's, renamed;
//   - the 200-source fixture, through the statement's test hook (A14) and the groups' (`reader-groups.ts`): Socrata's
//     157, and NYS Open Legislation alone;
//   - 300 sources (the fixture and 100 example packs over Socrata), with a cookie at its bound: 274 stored states.
//
// THE SHAPES THAT CAN FAIL. A class answer is given with a member set on its own to the OTHER setting, so an outcome
// that counted every member, or a write that moved it, is seen; the cookie is read back after the click. A thrown move
// is a row write that throws, signed in; a full cookie is the bound, signed out. The pointer is read present and absent
// on the same card, so an instrument that cannot see it is seen.
//
// RED AT W2a's HEAD (e783f69): the heading is "{name} is set to Ask first.", the step card says "The AI asked to use it
// for this question…", the prompt's choices sentence is in view, the facts are in view, the answers read Allow, Don't
// allow and "Allow all data sources" at every size, no class answer is offered, and the card reads no route `code`.
//
// BLIND SPOTS, stated. No layout: "closed" is the `<details>` element's `open` prop, and a disclosure's content is read
// in the markup whether it is open or not. Bold is a `<strong>` element; what a screen reader says is the group's
// `aria-label`.
//
// Run with: npm test

import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cloneElement, type ComponentType, type ReactNode } from 'react';
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
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'NYS_LEGISLATION_API_KEY', 'DATA_COMMONS_MCP_URL',
  'DATA_COMMONS_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL', 'CKAN_MCP_URL', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL',
  'DATABASE_URL',
]) delete process.env[name];
// Production's seven (as W1's driven suite and W2a's configure them).
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
process.env.NYC_CHARTER_HOSTING = 'sandbox';
process.env.NYC_CHECKBOOK_HOSTING = 'sandbox';
process.env.NYS_LEGISLATION_HOSTING = 'sandbox';
process.env.NYS_LEGISLATION_API_KEY = 'fixture-key';
process.env.CKAN_MCP_URL = 'https://ckan.fixture.example/mcp';
// A site that can ask at the pause: in loop, with the decision store.
process.env.SOURCE_ROUTING = 'in-loop';
process.env.KV_REST_API_URL = 'https://kv.fixture.example';
process.env.KV_REST_API_TOKEN = 'fixture-kv';
process.env.EXECUTOR_DRIVER = 'none';
process.env.RATE_LIMIT_SECRET = 'fixture';
const kv = new FakeDecisionKv();
(globalThis as unknown as { __w2DecisionKv: FakeDecisionKv }).__w2DecisionKv = kv;

const ORIGIN = 'https://site.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/', search: '' },
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
const STEP = stepModule.CONSENT_STEP_TEXT as Mod;
const SourcesPanel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType;
const bus = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');
const flows = await load('lib/flows/statement.ts');
const consent = await load('lib/sources/consent.ts');
const groups = await load('lib/sources/reader-groups.ts');
const fixture = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sources', 'fixtures', 'manifest-200.json'), 'utf8')) as { addresses: Record<string, string>; entries: Mod[] };

// --- The taken forms (planning's W2 words lists, byte for byte) --------------------------------------------------------

const W = {
  S146: { 2: 'The AI has asked to use NYC Checkbook. Nothing has been sent to it yet.', 3: 'The AI has asked to use NYS Open Legislation. Nothing has been sent to it yet.' },
  S147: { 2: 'The AI asked to use NYC Checkbook.', 3: 'The AI asked to use NYS Open Legislation.' },
  S100: ['Enable', "Don't enable"],
  S96: 'Enable all data sources',
  S98: "Enable: the AI's searches for this question are sent to it, and it is enabled for later questions. Don't enable: nothing is sent to it, and it is disabled for later questions. Enable all data sources: every data source is enabled, including any you disabled, and this question goes on without asking again.",
  S79: "Enable: the AI's searches for this question are sent to it, and it is enabled for later questions. Don't enable: nothing is sent to it, and it is disabled for later questions.",
  S12: 'Enable all 157 sources reached through Socrata',
  S13: "Don't enable any of the 157",
  S14: "Enable: the AI's searches for this question are sent to it, and it is enabled for later questions. Don't enable: nothing is sent to it, and it is disabled for later questions. Enable all 157 sources reached through Socrata: each is enabled, unless you set it on its own. Don't enable any of the 157: each is disabled, unless you set it on its own. After either answer for all 157, this question goes on without asking again about the sources it set.",
  S103: 'More about this source',
  S104: "Enable sends it the AI's searches, now and for later questions. Don't enable sends it nothing and disables it.",
  S105: 'What each answer does',
  S112: 'You chose Enable. It is enabled now.',
  S102: 'You chose Enable all data sources. Every data source is enabled now. A source added later is not enabled until you enable it.',
  S113: "You chose Enable. The AI's searches for this question are sent to it. It could not be enabled for later questions. You can enable it in Data source settings.",
  S16: 'You chose Enable all 157 sources reached through Socrata. They are enabled now.',
  S17: 'You chose Enable all 157 sources reached through Socrata. 156 are enabled now. One set on its own was left as it is.',
  S18: "You chose Don't enable any of the 157. The 157 sources reached through Socrata are disabled now, and nothing is sent to them.",
  S19: "You chose Don't enable any of the 157. 156 of the 157 sources reached through Socrata are disabled now, and nothing is sent to them. One set on its own was left as it is.",
  S27: "You chose Enable all 157 sources reached through Socrata. The AI's searches for this question can go to 156 of them. One set on its own was left as it is. They could not be enabled for later questions, because the cookie that keeps your settings is full.",
  S28: "You chose Don't enable any of the 157. Nothing is sent to the 157 sources reached through Socrata for this question. They could not be disabled for later questions, because the cookie that keeps your settings is full.",
  S29: "You chose Enable. The AI's searches for this question are sent to it. It could not be enabled for later questions, because the cookie that keeps your settings is full.",
  S30: "You chose Don't enable. Nothing is sent to it for this question. It could not be disabled for later questions, because the cookie that keeps your settings is full.",
  S25: 'If you sign in, your settings are kept on your account instead.',
  S126: { 1: 'You chose Enable, but it could not be enabled. You can enable it in Data source settings.', 2: 'You chose Enable, but it could not be enabled, because the cookie that keeps your settings is full.' },
  S154: "Enable: it is enabled for later questions. Don't enable: it is disabled for later questions.",
  S156: 'You chose Enable. It is enabled for later questions.',
  S157: "You chose Don't enable. It is disabled for later questions.",
  S158: { 1: "You chose Don't enable, but it could not be disabled. You can disable it in Data source settings.", 2: "You chose Don't enable, but it could not be disabled, because the cookie that keeps your settings is full." },
};
/** The pointer (item 13), `CONSENT_STEP_TEXT.pointer`: its words do not move. */
const POINTER = 'You can change this in Data source settings.';
/** `CONSENT_STEP_TEXT.asked` at the base, which C3-D-H B removes. */
const ASKED = 'The AI asked to use it for this question.';
const STILL = 'You can still answer for later questions.';

const T0 = Date.parse('2026-11-27T12:00:00.000Z');
const AUSTIN = 'datahub_austintexas_gov';
const SOCRATA_157 = fixture.entries.filter((e) => e.sourceId === 'socrata' || e.base === 'socrata').map((e) => e.sourceId as string);
const DB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// --- The fixtures through the hooks ------------------------------------------------------------------------------------

function fixtureInputs(extra = 0): Mod {
  const socrata = fixture.entries.find((e) => e.sourceId === 'socrata')!;
  const entries = [
    ...fixture.entries,
    ...Array.from({ length: extra }, (_, i) => ({
      kind: 'pack', sourceId: `example-pack-${String(i).padStart(3, '0')}`, alias: `example_pack_${i}`, displayName: `Example pack ${i}`,
      freshness: 'Example: an example pack.', base: 'socrata', consentDefault: 'on', hostings: socrata.hostings,
    })),
  ];
  return {
    manifest: entries,
    variantInForce: (entry: Mod) => entry.hostings[0],
    addressFor: (id: string) => fixture.addresses[entries.find((e) => e.sourceId === id)?.base ?? id],
  };
}
function hook(extra = 0): void {
  const inputs = fixtureInputs(extra);
  flows.setFlowsSourceInputsForTests(inputs);
  groups.setGroupManifestForTests(inputs.manifest);
}

const mounted: Surface[] = [];
beforeEach(() => {
  flows.setFlowsSourceInputsForTests(null);
  groups.setGroupManifestForTests(null);
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  sessions.rows.clear();
  delete process.env.DATABASE_URL;
});
afterEach(() => {
  for (const page of mounted.splice(0)) page.unmount();
  mock.timers.reset();
  flows.setFlowsSourceInputsForTests(null);
  groups.setGroupManifestForTests(null);
  delete process.env.DATABASE_URL;
});

type Net = ReturnType<typeof installFetch>;
function answers(): Net {
  return installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': (request: Request) => (decisionRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

let run = 0;
const nextKey = () => `b2b0${String(++run).padStart(4, '0')}0123456789abcdef01234567`;
const iso = (t: number) => new Date(t).toISOString();

interface Paused {
  page: Surface;
  key: string;
  net: Net;
  ids: string[];
  pause: Json;
  tick: (ms: number) => Promise<void>;
}

interface PauseSetup {
  sourceId: string;
  /** Stored states by id, the rest `fill`; ignored when `cookie` is given. */
  states?: Record<string, string>;
  own?: string[];
  fill?: string;
  /** A cookie built by hand, put in the jar in place of a first consent. */
  cookie?: (statement: Json) => string;
  signedIn?: boolean;
  panel?: boolean;
  runMovedOn?: boolean;
}

/** The clock at T0, a consent in force, the pause's entry and its report, and the prompt with the step card (and, with
 *  `panel`, the Sources panel and its row card). */
async function paused(setup: PauseSetup): Promise<Paused> {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });
  if (setup.signedIn) {
    sessions.server = { user: { id: 'gh-fixture', dbId: DB } };
    sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  }
  const net = answers();
  const statement = (await flows.buildFlowsStatement()) as Json;
  const ids = (statement.sources as Mod[]).map((s) => s.sourceId as string);
  if (setup.cookie) {
    net.jar.set(consent.CONSENT_COOKIE_NAME, setup.cookie(statement));
  } else {
    const all = Object.fromEntries(ids.map((id) => [id, setup.states?.[id] ?? setup.fill ?? 'ask-first']));
    const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: all, own: setup.own ?? [], flowsVersion: flows.statementHash(statement) }) });
    assert.equal(written.status, 200, `premise: the consent was written: ${await written.text()}`);
  }
  const key = nextKey();
  assert.equal(await kv.set(`consent-decision:${key}`, { sourceId: setup.sourceId }, { ex: 600, nx: true }), 'OK', 'premise: the entry was written');
  const source = (statement.sources as Mod[]).find((s) => s.sourceId === setup.sourceId);
  assert.ok(source, `premise: ${setup.sourceId} is configured`);
  const pause = { key, source, outbound: [], links: statement.links, expiresAt: iso(T0 + 60_000), entryExpiresAt: iso(T0 + 600_000), holds: true };
  bus.reportConsentPause(pause);
  await bus.refreshConsent();
  const page = await mount(h('div', null, h(Prompt), h(Card, { pause, runMovedOn: setup.runMovedOn === true }), setup.panel ? h(SourcesPanel) : null));
  mounted.push(page);
  await page.settle();
  assert.equal((await (await fetch('/api/sources/consent', { method: 'GET' })).json() as Json).inForce, true, 'premise: the consent is in force');
  net.clear();
  return { page, key, net, ids, pause, tick: async (ms: number) => { mock.timers.tick(ms); await page.settle(); } };
}

// --- Reading -----------------------------------------------------------------------------------------------------------

function* inside(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) { for (const c of node) yield* inside(c); return; }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as HostElement;
  if (typeof el.type === 'string') yield el;
  yield* inside((el.props as { children?: unknown }).children);
}
const all = (node: HostElement) => [...inside(node.props.children)];

type Rendering = 'prompt' | 'step card' | 'row card';
function renderingOf(page: Surface, which: Rendering): HostElement | undefined {
  if (which === 'prompt') return page.elements().find((el) => el.props['data-part'] === 'consent-pause-prompt');
  const place = which === 'step card' ? 'steps' : 'row';
  return page.elements().find((el) => el.props['data-part'] === 'consent-step' && el.props['data-consent-place'] === place);
}
function need(page: Surface, which: Rendering): HostElement {
  const node = renderingOf(page, which);
  assert.ok(node, `the ${which} is not rendered: ${page.text().slice(0, 400)}`);
  return node!;
}
const buttonsIn = (node: HostElement) => all(node).filter((el) => el.type === 'button').map((b) => textOf(b));
function buttonIn(node: HostElement, label: string): HostElement {
  const found = all(node).filter((el) => el.type === 'button' && textOf(el) === label);
  assert.equal(found.length, 1, `no one "${label}" here: ${buttonsIn(node).join(' | ')}`);
  return found[0];
}
const outcomeIn = (node: HostElement): string | null => {
  const found = all(node).find((el) => el.props['data-part'] === 'consent-outcome');
  return found ? textOf(found) : null;
};
/** The heading: its text, the bold runs in it, and the group's accessible name. */
function headingOf(node: HostElement): { text: string; bold: string[]; name: string | null } {
  const heading = all(node).find((el) => el.props['data-part'] === 'consent-heading');
  assert.ok(heading, `no heading (data-part="consent-heading") here: ${textOf(node).slice(0, 300)}`);
  const bold = [heading!, ...all(heading!)].filter((el) => el.type === 'strong' || el.type === 'b' || Number((el.props.style as Json | undefined)?.fontWeight ?? 0) >= 600).map((el) => textOf(el));
  return { text: textOf(heading!), bold, name: (node.props['aria-label'] as string | undefined) ?? null };
}
/** The `<details>` whose summary reads `summary`, with its state and its content's text. */
function disclosure(node: HostElement, summary: string): { open: boolean; text: string } | null {
  const found = all(node).find((el) => el.type === 'details' && all(el).some((s) => s.type === 'summary' && textOf(s) === summary));
  if (!found) return null;
  return { open: Boolean(found.props.open), text: textOf(found) };
}
/** The text of `node` outside every `<details>`: what is in view while every disclosure is closed. */
function inView(node: HostElement): string {
  const strip = (el: unknown): unknown => {
    if (Array.isArray(el)) return el.map(strip);
    if (el === null || typeof el !== 'object' || !('props' in (el as object))) return el;
    const e = el as HostElement;
    if (e.type === 'details') return null;
    return cloneElement(e, undefined, strip((e.props as { children?: unknown }).children) as ReactNode);
  };
  return textOf(strip(node) as ReactNode);
}
const decisionsPosted = (net: Net) => net.sent.filter((r) => r.method === 'POST' && r.path === '/api/sources/consent/decision').map((r) => (JSON.parse(r.body) as Json).decision);
function cookieStates(net: Net, ids: string[]): Record<string, string> {
  const cookie = consent.readConsentCookie(new Request(`${ORIGIN}/`, { headers: { cookie: [...net.jar].map(([k, v]) => `${k}=${v}`).join('; ') } }), ids);
  return Object.fromEntries(Object.entries((cookie?.states ?? {}) as Record<string, { state: string }>).map(([id, s]) => [id, s.state]));
}
const pointers = (node: HostElement) => textOf(node).split(POINTER).length - 1;

async function answer(p: Paused, which: Rendering, label: string): Promise<void> {
  await p.page.click(buttonIn(need(p.page, which), label));
  await p.page.settle();
}

/** A cookie at the bound: 274 stored states of 300, Socrata and the last 25 with none (as W1's suite builds it). */
function atTheBound(statement: Json): string {
  const ids = (statement.sources as Mod[]).map((s) => s.sourceId as string);
  assert.equal(ids.length, 300, 'premise: the hook configures 300 sources');
  const stored = ids.filter((id) => id !== 'socrata').slice(0, 274);
  const versionOf = (id: string) => (statement.sources as Mod[]).find((s) => s.sourceId === id)?.version as string;
  const value = consent.encodeConsentCookie({ v: 2, flows: statement.version, states: Object.fromEntries(stored.map((id) => [id, { state: 'ask-first', since: '2026-11-01', version: versionOf(id) }])) });
  assert.equal(`${consent.CONSENT_COOKIE_NAME}=${value}`.length, 4084, 'premise: 274 states take 4,084 bytes');
  return value;
}

/** A row write that throws, as a database that refuses the write would (signed in). */
function rowWritesThrow(): () => void {
  const real = sessions.rows.set.bind(sessions.rows);
  sessions.rows.set = () => { throw new Error('fixture: the row write was refused'); };
  return () => { sessions.rows.set = real; };
}

// =====================================================================================================================
// The heading (C3-D-H B, N1 (b), N2 (b)), and no line under it
// =====================================================================================================================

test('C3-D-H B (red): while the hold is open and unanswered, the prompt, the step card and the row card head with S146[2], only the name bold; the group\'s name is the heading without the bold', async () => {
  const p = await paused({ sourceId: 'nyc-checkbook', panel: true });
  for (const which of ['prompt', 'step card', 'row card'] as const) {
    const heading = headingOf(need(p.page, which));
    assert.equal(heading.text, W.S146[2], `the ${which}'s heading`);
    assert.deepEqual(heading.bold, ['NYC Checkbook'], `the ${which}: only the source's name is bold`);
    assert.equal(heading.name, W.S146[2], `the ${which}'s accessible name`);
  }
});

test('C3-D-H B (red): the step card has no line under its heading: CONSENT_STEP_TEXT.asked no longer shows, waiting or answered', async () => {
  const p = await paused({ sourceId: 'nyc-checkbook', panel: true });
  for (const which of ['step card', 'row card'] as const) assert.ok(!textOf(need(p.page, which)).includes(ASKED), `the ${which} still says "${ASKED}"`);
  await answer(p, 'prompt', W.S100[0]);
  for (const which of ['step card', 'row card'] as const) {
    const node = renderingOf(p.page, which);
    if (node) assert.ok(!textOf(node).includes(ASKED), `the ${which} says "${ASKED}" after an answer`);
  }
});

test('C3-D-H B (red): after an answer the step card heads with the past tense, S147[2]; the prompt is gone', async () => {
  const p = await paused({ sourceId: 'nyc-checkbook' });
  await answer(p, 'prompt', W.S100[0]);
  assert.equal(renderingOf(p.page, 'prompt'), undefined, 'premise: the prompt is gone once answered');
  const heading = headingOf(need(p.page, 'step card'));
  assert.equal(heading.text, W.S147[2]);
  assert.deepEqual(heading.bold, ['NYC Checkbook']);
  assert.equal(heading.name, W.S147[2]);
});

test('C3-D-H B (red): in every other closed state the step card heads with S147: the hold ended with no answer, after the hold while it takes an answer, the entry expired, and a run that cannot ask', async () => {
  const p = await paused({ sourceId: 'nys-legislation' });
  await p.tick(61_000);
  const ended = need(p.page, 'step card');
  assert.ok(buttonsIn(ended).length > 0, 'premise: after the hold the card still takes an answer');
  assert.equal(headingOf(ended).text, W.S147[3], 'after the hold, still taking an answer');
  await p.tick(600_000);
  assert.equal(headingOf(need(p.page, 'step card')).text, W.S147[3], 'the entry expired');
  // A run that cannot stop to ask.
  const statement = (await flows.buildFlowsStatement()) as Json;
  const source = (statement.sources as Mod[]).find((s) => s.sourceId === 'nys-legislation');
  const cannot = await mount(h(Card, { pause: { source, outbound: [], links: statement.links, expiresAt: iso(T0), holds: false } }));
  mounted.push(cannot);
  assert.equal(headingOf(renderingOf(cannot, 'step card')!).text, W.S147[3], 'cannotAsk');
});

test('C3-D-H B (red): a run that ends while the prompt still asks: the prompt keeps S146, the step card reads gone under S147', async () => {
  const p = await paused({ sourceId: 'nyc-checkbook', runMovedOn: true });
  const prompt = need(p.page, 'prompt');
  assert.equal(headingOf(prompt).text, W.S146[2], 'the prompt\'s heading');
  const card = need(p.page, 'step card');
  assert.equal(headingOf(card).text, W.S147[2], 'the step card\'s heading');
  assert.equal(outcomeIn(card), STEP.gone, 'premise: the step card reads gone');
});

// =====================================================================================================================
// C3-D = C: the prompt's short line and S105; the step card's facts behind S103
// =====================================================================================================================

test('C3-D = C (red): the prompt keeps S104 in view and puts S98 behind S105, closed; the change line stays in view', async () => {
  const p = await paused({ sourceId: 'nyc-checkbook' });
  const prompt = need(p.page, 'prompt');
  const view = inView(prompt);
  assert.ok(view.includes(W.S104), `S104 is not in view: ${view}`);
  assert.ok(!view.includes(W.S98), 'the choices sentence is in view');
  const what = disclosure(prompt, W.S105);
  assert.ok(what, `no disclosure "${W.S105}" in the prompt: ${textOf(prompt)}`);
  assert.equal(what!.open, false, 'S105 is open');
  assert.ok(what!.text.includes(W.S98), `S105 does not hold S98: ${what!.text}`);
  assert.ok(view.includes(STEP.change), 'the change line is not in view');
});

test('C3-D = C (red): the step card keeps its heading and the wait line in view, and puts the source\'s facts behind S103, closed', async () => {
  const p = await paused({ sourceId: 'nyc-checkbook' });
  const card = need(p.page, 'step card');
  const view = inView(card);
  assert.ok(view.includes(W.S146[2]) && view.includes(STEP.wait), `the heading or the wait line is not in view: ${view}`);
  assert.ok(!view.includes('Who holds its logs'), `the facts are in view: ${view}`);
  const more = disclosure(card, W.S103);
  assert.ok(more, `no disclosure "${W.S103}" in the step card: ${textOf(card)}`);
  assert.equal(more!.open, false, 'S103 is open');
  assert.ok(more!.text.includes('Who holds its logs'), `S103 does not hold the facts: ${more!.text}`);
});

// =====================================================================================================================
// B3 at twelve or fewer: today's three answers, renamed (S100, S96, S98)
// =====================================================================================================================

test('B3 (red; pin at seven): the prompt and the row card offer S100 and S96, in that order; S98 is the choices sentence; a source in a group of two gets no class answer', async () => {
  for (const sourceId of ['nyc-checkbook', 'nyc-record']) {
    const p = await paused({ sourceId, panel: true });
    for (const which of ['prompt', 'row card'] as const) {
      const node = need(p.page, which);
      assert.deepEqual(buttonsIn(node), [...W.S100, W.S96], `${sourceId}: the ${which}'s answers`);
      assert.ok(textOf(node).includes(W.S98), `${sourceId}: the ${which} does not carry S98`);
    }
    for (const page of mounted.splice(0)) page.unmount();
    mock.timers.reset();
  }
});

test('B3 (red; pin at seven): Enable reads S112 and Enable all data sources reads S102, each in the step card', async () => {
  let p = await paused({ sourceId: 'nyc-checkbook' });
  await answer(p, 'prompt', W.S100[0]);
  assert.deepEqual(decisionsPosted(p.net), ['allow']);
  assert.equal(outcomeIn(need(p.page, 'step card')), W.S112);
  for (const page of mounted.splice(0)) page.unmount();
  mock.timers.reset();
  p = await paused({ sourceId: 'nyc-checkbook' });
  await answer(p, 'prompt', W.S96);
  assert.deepEqual(decisionsPosted(p.net), ['allow-all']);
  assert.equal(outcomeIn(need(p.page, 'step card')), `${W.S102} ${POINTER}`);
});

// =====================================================================================================================
// B3 above twelve: the class answers (S12, S13, S14), and a source alone (S79)
// =====================================================================================================================

test('B3 (red): at 200, a Socrata member\'s pause offers S100, then S12[1] and S13[1]; its choices sentence is S14[1], behind S105', async () => {
  hook();
  const p = await paused({ sourceId: AUSTIN });
  const prompt = need(p.page, 'prompt');
  assert.deepEqual(buttonsIn(prompt), [...W.S100, W.S12, W.S13], 'the prompt\'s answers at 200');
  const what = disclosure(prompt, W.S105);
  assert.ok(what?.text.includes(W.S14), `S105 does not hold S14[1]: ${what?.text}`);
  assert.ok(!buttonsIn(prompt).includes(W.S96), 'S96 is offered above twelve');
});

test('B3 (red): at 200, a source alone in its class has no third or fourth answer, and its choices sentence is S79[1]', async () => {
  hook();
  const p = await paused({ sourceId: 'nys-legislation' });
  const prompt = need(p.page, 'prompt');
  assert.deepEqual(buttonsIn(prompt), W.S100, 'a source alone is offered more than the pair');
  const what = disclosure(prompt, W.S105);
  assert.equal(what?.text, `${W.S105} ${W.S79}`, 'its choices sentence');
});

test('B3 (red): at 200, S12[1] posts allow-class and turns On, in one write, every Socrata member not set on its own; the one set on its own to Off stays Off; the step card reads S17[1] and the pointer', async () => {
  hook();
  const flagged = SOCRATA_157.find((id) => id !== AUSTIN && id !== 'socrata')!;
  const p = await paused({ sourceId: AUSTIN, states: { [flagged]: 'off' }, own: [flagged] });
  await answer(p, 'prompt', W.S12);
  assert.deepEqual(decisionsPosted(p.net), ['allow-class'], 'the third answer did not post allow-class');
  const states = cookieStates(p.net, p.ids);
  assert.equal(SOCRATA_157.filter((id) => states[id] === 'on').length, 156, 'not 156 members enabled');
  assert.equal(states[flagged], 'off', 'the source set on its own was moved');
  assert.equal(states['nys-legislation'], 'ask-first', 'a source outside the class was moved');
  assert.equal(outcomeIn(need(p.page, 'step card')), `${W.S17} ${POINTER}`);
});

test('B3 (red): at 200 with no member set on its own, S12[1] reads S16 in the step card', async () => {
  hook();
  const p = await paused({ sourceId: AUSTIN });
  await answer(p, 'prompt', W.S12);
  assert.equal(outcomeIn(need(p.page, 'step card')), `${W.S16} ${POINTER}`);
});

test('B3 (red; C3 = A): at 200, S13[1] posts off-class and turns Off every Socrata member not set on its own; the one set on its own to On stays On; the step card reads S19[1]', async () => {
  hook();
  const flagged = SOCRATA_157.find((id) => id !== AUSTIN && id !== 'socrata')!;
  const p = await paused({ sourceId: AUSTIN, states: { [flagged]: 'on' }, own: [flagged] });
  await answer(p, 'prompt', W.S13);
  assert.deepEqual(decisionsPosted(p.net), ['off-class'], 'the fourth answer did not post off-class');
  const states = cookieStates(p.net, p.ids);
  assert.equal(SOCRATA_157.filter((id) => states[id] === 'off').length, 156, 'not 156 members disabled');
  assert.equal(states[flagged], 'on', 'the source set on its own was moved');
  assert.equal(outcomeIn(need(p.page, 'step card')), `${W.S19} ${POINTER}`);
});

test('B3 (red; C3 = A): at 200 with no member set on its own, S13[1] reads S18[1]', async () => {
  hook();
  const p = await paused({ sourceId: AUSTIN });
  await answer(p, 'prompt', W.S13);
  assert.equal(outcomeIn(need(p.page, 'step card')), `${W.S18} ${POINTER}`);
});

test('B3 (red; C3 = A): after the hold the card offers the pair only, with S154 under stillAnswer; no class answer', async () => {
  hook();
  const p = await paused({ sourceId: AUSTIN });
  await p.tick(61_000);
  const card = need(p.page, 'step card');
  assert.deepEqual(buttonsIn(card), W.S100, 'after the hold the card offers more than the pair');
  const text = textOf(card);
  assert.ok(text.includes(`${STILL} ${W.S154}`), `S154 does not follow stillAnswer: ${text.slice(0, 500)}`);
});

// =====================================================================================================================
// C4 = A at the cookie's bound (S27 to S30, S25), and S126[2] and S158[2] after the hold
// =====================================================================================================================

test('C4 = A (red): the class outcomes at the bound are the templates of S27 and S28; their exact forms at 157 are S27[1] and S28[1]', () => {
  assert.equal(typeof STEP.classAllowedFull, 'function', 'CONSENT_STEP_TEXT has no classAllowedFull (S27)');
  assert.equal(typeof STEP.classDeclinedFull, 'function', 'CONSENT_STEP_TEXT has no classDeclinedFull (S28)');
  assert.equal(STEP.classAllowedFull(157, 'sources reached through Socrata', 1), W.S27);
  assert.equal(STEP.classDeclinedFull(157, 'sources reached through Socrata', 0), W.S28);
});

test('C4 = A (red): at the bound, signed out, Enable reads S29 and Don\'t enable S30, each with no pointer; the decision is saved', async () => {
  hook(100);
  for (const [label, form, decision] of [[W.S100[0], W.S29, 'allow'], [W.S100[1], W.S30, 'off']] as const) {
    const p = await paused({ sourceId: 'socrata', cookie: atTheBound });
    await answer(p, 'prompt', label);
    assert.deepEqual(decisionsPosted(p.net), [decision]);
    const card = need(p.page, 'step card');
    assert.equal(outcomeIn(card), form, `${decision} at the bound`);
    assert.equal(pointers(card), 0, `${decision} at the bound carries the pointer`);
    for (const page of mounted.splice(0)) page.unmount();
    mock.timers.reset();
  }
});

test('C4 = A (red): on a site with accounts, S25 follows S29', async () => {
  hook(100);
  process.env.DATABASE_URL = 'postgres://fixture.invalid/none';
  const p = await paused({ sourceId: 'socrata', cookie: atTheBound });
  await answer(p, 'prompt', W.S100[0]);
  assert.equal(outcomeIn(need(p.page, 'step card')), `${W.S29} ${W.S25}`);
});

test('C4 = A (red): at the bound, S12 and S13 read the templates of S27 and S28 at 257, with no pointer', async () => {
  hook(100);
  for (const [label, form] of [
    ['Enable all 257 sources reached through Socrata', "You chose Enable all 257 sources reached through Socrata. The AI's searches for this question can go to them. They could not be enabled for later questions, because the cookie that keeps your settings is full."],
    ["Don't enable any of the 257", "You chose Don't enable any of the 257. Nothing is sent to the 257 sources reached through Socrata for this question. They could not be disabled for later questions, because the cookie that keeps your settings is full."],
  ] as const) {
    const p = await paused({ sourceId: 'socrata', cookie: atTheBound });
    await answer(p, 'prompt', label);
    assert.equal(outcomeIn(need(p.page, 'step card')), form);
    for (const page of mounted.splice(0)) page.unmount();
    mock.timers.reset();
  }
});

test('OUTCOME_LINES A (red; S158[2], S126[2]): after the hold, at the bound, Don\'t enable reads S158[2] and Enable reads S126[2]; no pointer follows either', async () => {
  hook(100);
  for (const [label, form] of [[W.S100[1], W.S158[2]], [W.S100[0], W.S126[2]]] as const) {
    const p = await paused({ sourceId: 'socrata', cookie: atTheBound });
    await p.tick(61_000);
    await answer(p, 'step card', label);
    const card = need(p.page, 'step card');
    assert.equal(outcomeIn(card), form);
    assert.equal(pointers(card), 0, `the pointer follows "${form}"`);
    for (const page of mounted.splice(0)) page.unmount();
    mock.timers.reset();
  }
});

// =====================================================================================================================
// OUTCOME_LINES A and POINTER (b): a thrown move (S113, S158[1], S126[1]); S156 and S157 after the hold
// =====================================================================================================================

test('OUTCOME_LINES A (red; S158[1]): a thrown move, signed in: Don\'t enable reads S158[1] while the question waits and after the hold; no pointer follows', async () => {
  for (const after of [false, true]) {
    const p = await paused({ sourceId: 'nyc-checkbook', signedIn: true });
    if (after) await p.tick(61_000);
    const restore = rowWritesThrow();
    try {
      await answer(p, after ? 'step card' : 'prompt', W.S100[1]);
    } finally {
      restore();
    }
    const card = need(p.page, 'step card');
    assert.equal(outcomeIn(card), W.S158[1], after ? 'after the hold' : 'while the question waits');
    assert.equal(pointers(card), 0, 'the pointer follows S158[1]');
    for (const page of mounted.splice(0)) page.unmount();
    mock.timers.reset();
  }
});

test('OUTCOME_LINES A (red; S113, S126[1]): a thrown move, signed in: Enable reads S113 while the question waits and S126[1] after the hold', async () => {
  for (const [after, form] of [[false, W.S113], [true, W.S126[1]]] as const) {
    const p = await paused({ sourceId: 'nyc-checkbook', signedIn: true });
    if (after) await p.tick(61_000);
    const restore = rowWritesThrow();
    try {
      await answer(p, after ? 'step card' : 'prompt', W.S100[0]);
    } finally {
      restore();
    }
    assert.equal(outcomeIn(need(p.page, 'step card')), form);
    for (const page of mounted.splice(0)) page.unmount();
    mock.timers.reset();
  }
});

test('POINTER (b) (red): after the hold, Enable reads S156 and the pointer follows; Don\'t enable that moved reads S157 and the pointer follows', async () => {
  for (const [label, form, decision, state] of [[W.S100[0], W.S156, 'allow', 'on'], [W.S100[1], W.S157, 'off', 'off']] as const) {
    const p = await paused({ sourceId: 'nyc-checkbook', panel: true });
    await p.tick(61_000);
    await answer(p, 'row card', label);
    assert.deepEqual(decisionsPosted(p.net), [decision]);
    assert.equal(cookieStates(p.net, p.ids)['nyc-checkbook'], state, `premise: the setting moved to ${state}`);
    const row = need(p.page, 'row card');
    assert.equal(outcomeIn(row), `${form} ${POINTER}`, `${decision} after the hold`);
    assert.equal(pointers(row), 1);
    for (const page of mounted.splice(0)) page.unmount();
    mock.timers.reset();
  }
});
