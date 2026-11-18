// UX-2 P6 + P10 (#729): the landing of "Ask with this source" (contract p6p10.md v5.2, criterion 6's landing and
// no-state parts; item 7; 0d item 9) and RL-1 on the three surfaces where the limit's refusal renders (criterion 17).
//
// THE RULE. The landing: on `/` and `/ask`, a `?source=<id>` this instance offers opens the Settings overlay on Data
// sources (a push to `/settings?source=<id>`, measured intercepted with the query kept); the overlay marks the list that
// holds the target row (`data-target-source="<id>"`) inside its dialog, also with S3-B's picker open beneath it; an
// unknown or unoffered id opens nothing; and the landing writes no state (only GETs, no cookie, the consent and the picks
// unchanged). RL-1: a 429 renders "You have no questions left today, so this question went no further than this site.
// Ask again after the count resets at midnight UTC." on the home page's results box, under the Sandbox heading on
// `/ask`, and in `/explore`'s error.
//
// WHAT IS DRIVEN. The real home page, `/ask`'s surface and `/explore`'s diagram, and the Settings overlay, on the surface
// harness; the consent written through the real consent route; the query routes answering 429.
//
// WHAT MAKES IT ABLE TO FAIL. At the base nothing reads `?source=`: no push, no target. The unoffered id is a source
// the router knows and this instance does not offer (`nyc-charter`), so a landing keyed on the manifest alone opens the
// overlay there. The 429 drive checks first that a refusal rendered at all (the base's words or RL-1's), so its red is
// the words, not a drive that reached nothing.
//
// BLIND SPOTS, stated. No router and no browser: the interception itself, the row's scroll into view and focus on Close
// were measured in Chrome at stage 1 and are instrument 8 (d)'s reads. `/ask`'s page component (a server component that
// reads the session) is read as source for its mount; the landing's behaviour there is driven on the surface it mounts.
//
// Run with: npm test

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { Fragment, type ComponentType, type ReactElement } from 'react';
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
} from './sources/surface-test-harness.ts';
import { within } from './ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  './BpmnViewer': 'export default function BpmnViewer() { return null; }',
});

for (const name of [
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY',
  'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'BOSTON_OPENCONTEXT_MCP_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

const ORIGIN = 'https://site.fixture.example';
const storage = new Map<string, string>();
const target = { addEventListener() {}, removeEventListener() {} };
const location = { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/', search: '' };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location,
    history: { replaceState() {}, pushState() {} },
    scrollTo() {},
    scrollBy() {},
    innerHeight: 852,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target, querySelector: () => null, querySelectorAll: () => [] },
});
/** The address the page is at, per case. */
function at(pathname: string, search = ''): void {
  location.pathname = pathname;
  location.search = search;
  location.href = `${ORIGIN}${pathname}${search}`;
}

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const SourceLanding = (await load('components/SourceLanding.tsx')).default as ComponentType;
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const picksStore = await load('components/composer/picks/store.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const statement = await buildFlowsStatement();
/** The sources the statement lists, read from it, never a fixed list (the P3b-2 rider). */
const IDS: string[] = statement.sources.map((s: { sourceId: string }) => s.sourceId);

// --- The answers ----------------------------------------------------------------------------------------------------

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let refuse = false;
let queries: string[] = [];
/** How the notebook route answers (fix round 2, A5): the site's own limiter's 429 unless a test says otherwise. */
const LIMIT_429 = () => json({ error: 'Rate limit exceeded' }, 429);
let notebookAnswer: () => Response = LIMIT_429;
function answers() {
  queries = [];
  return installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model', tag: 'recommended' }] }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': () => json({ routing: 'in-loop', store: true }),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => json({ remaining: refuse ? 0 : 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: sessions.server !== null }),
    '/api/compare-stream': async (request: Request) => {
      queries.push('/api/compare-stream');
      await request.text();
      if (refuse) return json({ error: 'Rate limit exceeded' }, 429);
      return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    },
    '/api/query-notebook': async (request: Request) => {
      queries.push('/api/query-notebook');
      await request.text();
      return notebookAnswer();
    },
  });
}
async function consentWith(states: Record<string, string> = {}, rest = 'on'): Promise<void> {
  const all = Object.fromEntries(IDS.map((id) => [id, states[id] ?? rest]));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: all, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, `premise: the consent write was refused: ${await written.text()}`);
}

const ANON = () => { sessions.server = null; sessions.client = { status: 'unauthenticated', data: null }; };
const SIGNED_IN = () => {
  sessions.server = { user: { id: 'gh-fixture-account' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};
const ASK = () => h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' });

const mounted: Surface[] = [];
beforeEach(() => {
  storage.clear();
  sessions.rows.clear();
  sessions.pushed.length = 0;
  refuse = false;
  notebookAnswer = LIMIT_429;
  picksStore.resetPicksForTests();
  at('/');
});
afterEach(() => {
  for (const p of mounted.splice(0)) p.unmount();
  cancelConsentPauses();
});
const settle = async (surface: Surface, ms = 50) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await surface.settle();
};
async function mountPage(element: ReactElement): Promise<Surface> {
  const p = await mount(element);
  mounted.push(p);
  await settle(p, 100);
  return p;
}

// --- Criterion 6: the landing -------------------------------------------------------------------------------------

const SETTINGS = (id: string) => `/settings?source=${id}`;
const settingsPushes = () => sessions.pushed.filter((u) => u.startsWith('/settings'));

test('premise: socrata is offered and nyc-charter, a source the router knows, is not', () => {
  assert.ok(IDS.includes('socrata') && !IDS.includes('nyc-charter'), `the statement's ids: ${JSON.stringify(IDS)}`);
});

test('criterion 6: on the home page, ?source=<offered id> opens the Settings overlay at that source (a push to /settings?source=<id>)', async () => {
  ANON();
  answers();
  at('/', '?source=socrata');
  await mountPage(h(Home));
  assert.deepEqual(settingsPushes(), [SETTINGS('socrata')]);
});

test('criterion 6: on /ask, ?source=<offered id> opens the Settings overlay at that source', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  at('/ask', '?source=socrata');
  await mountPage(h(Fragment, null, ASK(), h(SourceLanding)));
  assert.deepEqual(settingsPushes(), [SETTINGS('socrata')]);
});

test('criterion 6: /ask\'s page mounts the landing beside its surface (its source, read with the TypeScript compiler)', () => {
  const file = path.join(SRC, 'app', '(app)', 'ask', 'page.tsx');
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = sf.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
  assert.ok(imports.includes('@/components/SourceLanding'), `ask/page.tsx imports: ${JSON.stringify(imports)}`);
  let mounts = 0;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(sf) === 'SourceLanding') mounts += 1;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.equal(mounts, 1, 'SourceLanding elements in ask/page.tsx');
});

for (const [name, search] of [['an unknown id', '?source=nope'], ['an id this instance does not offer', '?source=nyc-charter'], ['no id', '']] as const) {
  test(`criterion 6 (guard): on the home page, ${name} opens nothing`, async () => {
    ANON();
    answers();
    at('/', search);
    await mountPage(h(Home));
    assert.deepEqual(settingsPushes(), []);
  });
}

test('criterion 6: the landing writes no state: with its source at Ask first, only GETs, no cookie set, the consent and the picks unchanged', async () => {
  ANON();
  const installed = answers();
  await consentWith({ socrata: 'ask-first' });
  const jarBefore = JSON.stringify([...installed.jar]);
  const consentBefore = await (await fetch('/api/sources/consent')).text();
  const picksBefore = JSON.stringify(picksStore.getPicks());
  installed.clear();
  at('/', '?source=socrata');
  await mountPage(h(Home));
  assert.deepEqual(settingsPushes(), [SETTINGS('socrata')], 'premise: the landing acted');
  assert.deepEqual(installed.sent.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`), [], 'a request that writes');
  assert.equal(JSON.stringify([...installed.jar]), jarBefore, 'a cookie was set');
  assert.equal(await (await fetch('/api/sources/consent')).text(), consentBefore, 'the consent changed');
  assert.equal(JSON.stringify(picksStore.getPicks()), picksBefore, 'the picks changed');
});

/** The lists inside the overlay's dialog that carry the landing's target. */
function targetLists(page: Surface): HostElement[] {
  const dialogs = page.elements().filter((el) => el.props.role === 'dialog');
  assert.equal(dialogs.length, 1, `role="dialog" elements: ${dialogs.length}`);
  return within(dialogs[0]).filter((el) => el.props['data-target-source'] !== undefined);
}
const rowsIn = (el: HostElement, id: string) => within(el).filter((x) => x.type === 'li' && x.props['data-source'] === id);

test('criterion 6: at /settings?source=<id> the overlay marks the list holding that row, inside its dialog, on Data sources', async () => {
  SIGNED_IN();
  answers();
  await consentWith({ socrata: 'ask-first' });
  at('/settings', '?source=socrata');
  const page = await mountPage(h(SettingsOverlay, { mount: 'page' }));
  const lists = targetLists(page);
  assert.deepEqual(lists.map((el) => el.props['data-target-source']), ['socrata']);
  assert.equal(rowsIn(lists[0], 'socrata').length, 1, 'the marked list does not hold the row');
});

test('criterion 6: with S3-B\'s picker open beneath it, the target is still the row inside the overlay\'s dialog', async () => {
  SIGNED_IN();
  answers();
  await consentWith({ socrata: 'ask-first' });
  at('/settings', '?source=socrata');
  const page = await mountPage(h(Fragment, null, ASK(), h(SettingsOverlay, { mount: 'intercepted' })));
  picksStore.choosePicking();
  await settle(page, 100);
  const everywhere = page.elements().filter((el) => el.type === 'li' && el.props['data-source'] === 'socrata');
  assert.ok(everywhere.length >= 2, `premise: the picker's row and the overlay's both render (${everywhere.length})`);
  const lists = targetLists(page);
  assert.deepEqual(lists.map((el) => el.props['data-target-source']), ['socrata']);
  assert.equal(rowsIn(lists[0], 'socrata').length, 1);
});

test('criterion 6 (guard): at /settings?source=nope the overlay marks nothing', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  at('/settings', '?source=nope');
  const page = await mountPage(h(SettingsOverlay, { mount: 'page' }));
  assert.deepEqual(targetLists(page).map((el) => el.props['data-target-source']), []);
});

// --- Criterion 17: RL-1 on the three surfaces -----------------------------------------------------------------------

const RL1 = 'You have no questions left today, so this question went no further than this site. Ask again after the count resets at midnight UTC.';
const BASE_RL = 'You’ve reached today’s request limit. Sign in for more requests, or try again tomorrow.';

async function ask(page: Surface, question: string): Promise<void> {
  const box = page.elements().find((el) => el.type === 'textarea');
  assert.ok(box, 'premise: the question box');
  await page.type(box!, question);
  const form = page.elements().find((el) => el.type === 'form' && within(el).some((x) => x.type === 'textarea'));
  await page.submit(form!);
  await settle(page, 300);
}
function refusalRendered(page: Surface): void {
  const text = page.text();
  assert.ok(text.includes(RL1) || text.includes(BASE_RL), `premise: the 429 rendered a refusal; the page reads: ${text.slice(0, 400)}`);
  assert.ok(text.includes(RL1), 'RL-1 is not rendered');
  assert.ok(!text.includes(BASE_RL), 'the base\'s words are still rendered');
}

test('criterion 17: on the home page a 429 renders RL-1 in the results box', async () => {
  ANON();
  answers();
  refuse = true;
  await consentWith();
  const page = await mountPage(h(Home));
  await ask(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  assert.ok(queries.includes('/api/compare-stream'), 'premise: the question was sent');
  refusalRendered(page);
});

test('criterion 17: on /ask in a Sandbox session a 429 renders RL-1 under the notebook heading', async () => {
  SIGNED_IN();
  answers();
  refuse = true;
  await consentWith();
  const page = await mountPage(ASK());
  await ask(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  assert.ok(queries.includes('/api/query-notebook'), `premise: the notebook route was called (${JSON.stringify(queries)})`);
  refusalRendered(page);
});

test('criterion 17: on /explore a 429 renders RL-1 in the live run\'s error', async () => {
  ANON();
  answers();
  refuse = true;
  await consentWith();
  const page = await mountPage(h(McpFlowDiagram));
  await page.click(page.button('Try your own'));
  await settle(page);
  await ask(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  await settle(page, 600);
  assert.ok(queries.includes('/api/compare-stream'), `premise: the live run was sent; the page reads: ${page.text().slice(0, 600)}`);
  refusalRendered(page);
});


// --- Fix round 2, A5 (b): the /ask Sandbox block on the daily limit's refusal (owner OA-942; seat #729 6949484128) --
//
// THE RULE. For the site's own daily limit's refusal (`rate_limit`), the notebook block holds RL-1 alone: no heading
// "Couldn't generate a reproducible notebook.", no "You can switch back…" line, no Retry, and it keeps `role="alert"`.
// Every other kind of error keeps the block as built: the heading, its message, the switch line and Retry (and the
// notebook's traceback where it has one).
//
// WHAT IS DRIVEN. /ask's surface in a Sandbox session, a question sent, and the notebook route answering per case:
// the limiter's own HTTP 429; a JSON refusal carrying each other kind's `code`, which `classifyStreamError` reads from
// the body; and two stream `error` events (a `rate_limit` one, and a `notebook_execution` one with its traceback).
// `consent_required` never reaches the block (the hook hands it to the consent card), and is checked as such.
//
// WHAT MAKES IT ABLE TO FAIL. The other 429-shaped kind, `model_rate_limited` (an upstream model's limit), must keep
// the block: a build keyed on the status or on "rate limit" in the words fails there. Each drive checks first that a
// block rendered at all.

const { STREAM_ERROR_KINDS, friendlyStreamError } = await load('lib/streaming.ts');
const NB_HEADING = "Couldn't generate a reproducible notebook.";
const NB_SWITCH = 'You can switch back to Standard mode and try the same question, or retry below.';
const sse = (events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

/** The notebook block after a Sandbox question: the one role="alert" element, with its text and its Retry buttons. */
async function notebookBlock(answer: () => Response): Promise<{ text: string; retry: number; page: Surface } | null> {
  SIGNED_IN();
  answers();
  notebookAnswer = answer;
  await consentWith();
  const page = await mountPage(ASK());
  await ask(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  assert.ok(queries.includes('/api/query-notebook'), `premise: the notebook route was called (${JSON.stringify(queries)})`);
  const alerts = page.elements().filter((el) => el.props.role === 'alert');
  if (alerts.length === 0) return null;
  assert.equal(alerts.length, 1, `role="alert" blocks: ${alerts.length}`);
  return { text: textOf(alerts[0]).replace(/[‘’]/g, "'"), retry: within(alerts[0]).filter((el) => el.type === 'button' && textOf(el) === 'Retry').length, page };
}

for (const [shape, answer] of [
  ['the limiter\'s HTTP 429', LIMIT_429],
  ['a stream error event carrying rate_limit', () => sse([{ type: 'error', code: 'rate_limit', message: 'Rate limit exceeded' }])],
] as const) {
  test(`fix round 2, A5 (b): ${shape} renders RL-1 alone in the Sandbox block (no heading, no switch line, no Retry)`, async () => {
    const block = await notebookBlock(answer);
    assert.ok(block, 'premise: the refusal rendered a role="alert" block');
    assert.ok(block!.text.includes(RL1) || block!.text.includes(BASE_RL), `premise: the block holds a refusal: ${block!.text}`);
    assert.equal(block!.text, RL1, 'the block holds more than RL-1');
    assert.ok(!block!.text.includes(NB_HEADING), 'the heading is still there');
    assert.ok(!block!.text.includes(NB_SWITCH), 'the switch line is still there');
    assert.equal(block!.retry, 0, 'Retry is still there');
  });
}

/** Every kind `classifyStreamError` returns but the limit's and consent's, which have their own tests. */
const KEPT_KINDS = (STREAM_ERROR_KINDS as readonly string[]).filter((k) => k !== 'rate_limit' && k !== 'consent_required');

test('fix round 2, A5 (premise): the kinds are the fourteen, and the twelve that keep the block are listed here', () => {
  assert.equal(STREAM_ERROR_KINDS.length, 14);
  assert.deepEqual(KEPT_KINDS, [
    'model_rate_limited', 'model_not_configured', 'model_auth_rejected', 'mcp_not_configured', 'mcp_timeout', 'mcp_unavailable',
    'connection', 'notebook_execution', 'not_offered', 'no_sources_on', 'no_picks_usable', 'generic',
  ]);
});

for (const kind of KEPT_KINDS) {
  test(`fix round 2, A5 (b): a ${kind} refusal keeps the block: the heading, its message, the switch line and Retry`, async () => {
    const block = await notebookBlock(() => json({ error: `fixture ${kind}`, code: kind }, 503));
    assert.ok(block, `premise: a ${kind} refusal rendered a role="alert" block`);
    const message = friendlyStreamError({ message: `fixture ${kind}`, code: kind }) as string;
    assert.ok(block!.text.startsWith(NB_HEADING), `the heading is gone: ${block!.text}`);
    assert.ok(block!.text.includes(message.replace(/[‘’]/g, "'")), `the message is gone: ${block!.text}`);
    assert.ok(block!.text.includes(NB_SWITCH), `the switch line is gone: ${block!.text}`);
    assert.equal(block!.retry, 1, 'Retry is gone');
  });
}

test('fix round 2, A5 (b): a notebook_execution error event keeps the block with its traceback, the switch line and Retry', async () => {
  const block = await notebookBlock(() => sse([{ type: 'error', code: 'notebook_execution', correlationId: 'fixture-ref', exitCode: 1, traceback: 'Traceback (fixture)' }]));
  assert.ok(block, 'premise: the notebook failure rendered a role="alert" block');
  assert.ok(block!.text.startsWith(NB_HEADING), `the heading is gone: ${block!.text}`);
  assert.ok(block!.text.includes('Traceback (fixture)') && block!.text.includes('fixture-ref'), `the traceback is gone: ${block!.text}`);
  assert.ok(block!.text.includes(NB_SWITCH), 'the switch line is gone');
  assert.equal(block!.retry, 1, 'Retry is gone');
});

test('fix round 2, A5: consent_required renders no block (the hook hands it to the consent card), as before', async () => {
  const block = await notebookBlock(() => json({ error: 'fixture consent', code: 'consent_required' }, 403));
  assert.equal(block, null, `a consent refusal rendered the block: ${block?.text}`);
});

// --- UX-2-FIX P2, item 11 (#790): the two error boxes are announced ------------------------------------------------
//
// THE RULE. The home page's results box (and `/ask`'s standard run, the same `QuerySurface` box) and `/explore`'s live
// run's error each carry `role="alert"`, as the notebook's failure block already does, with their words unchanged.
//
// WHAT IS DRIVEN. The same 429 drives as criterion 17 above. The box is the outermost element whose whole text is the
// refusal's words; a drive that rendered no such element reads red as a premise.

/** The outermost elements whose whole text is `words`, with their `role`. */
function boxesReading(page: Surface, words: string): Array<{ type: string; role: unknown }> {
  const exact = page.elements().filter((el) => textOf(el).replace(/\s+/g, ' ').trim() === words);
  const outer = exact.filter((el) => !exact.some((other) => other !== el && within(other).includes(el)));
  return outer.map((el) => ({ type: String(el.type), role: el.props.role }));
}

test('#790 item 11: the home page\'s error box carries role="alert", around the refusal\'s words', async () => {
  ANON();
  answers();
  refuse = true;
  await consentWith();
  const page = await mountPage(h(Home));
  await ask(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  assert.ok(queries.includes('/api/compare-stream'), 'premise: the question was sent');
  const boxes = boxesReading(page, RL1);
  assert.equal(boxes.length, 1, `premise: one box reads the refusal: ${JSON.stringify(boxes)}`);
  assert.deepEqual(boxes, [{ type: 'div', role: 'alert' }]);
});

test('#790 item 11: /explore\'s live error carries role="alert", around the refusal\'s words', async () => {
  ANON();
  answers();
  refuse = true;
  await consentWith();
  const page = await mountPage(h(McpFlowDiagram));
  await page.click(page.button('Try your own'));
  await settle(page);
  await ask(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  await settle(page, 600);
  assert.ok(queries.includes('/api/compare-stream'), 'premise: the live run was sent');
  const boxes = boxesReading(page, RL1);
  assert.equal(boxes.length, 1, `premise: one box reads the refusal: ${JSON.stringify(boxes)}`);
  assert.deepEqual(boxes, [{ type: 'div', role: 'alert' }]);
});
