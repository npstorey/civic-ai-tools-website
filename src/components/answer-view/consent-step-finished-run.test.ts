// R10 P1 criterion 3 (#667): the finished executed run keeps its consent steps
// and their outcomes.
//
// THE DEFECT AT THE BASE. While an executed run is under way, `NotebookOutput`
// hands `notebookSteps` the run's progress log, so a load that paused to ask
// the reader shows its consent step. When the notebook arrives the live view
// unmounts and `adaptNotebook` builds the finished one, whose `notebookSteps`
// call passed no progress log: the consent step, and the answer it records,
// were gone from the finished run.
//
// P-B, MEASURED HERE. The step's outcome is not in the progress log: it is the
// bus slot `pauseEntry(consent.pauses, key)`, and the bus empties when its
// last listener leaves (`useSourceConsent.ts`, `subscribe`). This file mounts
// the real `/ask` surface (`QuerySurface`, notebook mode) on R6's surface
// harness, feeds it a held stream through the real `useNotebookStream`, has
// the reader answer two pauses in the live view (Allow on one, Not now on the
// other, each under its own key), then sends the notebook, so the live view
// unmounts and the finished view mounts, as `NotebookOutput.tsx` swaps them.
// Each finished card must read its own outcome in `ConsentStep`'s words
// (`CONSENT_STEP_TEXT`, read from the module, never copied). Had the bus
// emptied at the swap, each card would read `CONSENT_STEP_TEXT.ended`.
//
// THE SHAPE THAT CAN FAIL. Two pauses with two answers, so a card that read
// the other's slot, or the last decision, fails one of them; the cards are
// read after the swap only, inside the finished view's steps part (it carries
// the closing rows, which the live view's steps do not).
//
// HARNESS NOTES (#670). The harness can leave bus subscriptions after
// `unmount()`, so every test mints its own pause keys, and the teardown ends
// every hold still open (`cancelConsentPauses`) after unmounting.
//
// Run with: npm test

import { afterEach, test } from 'node:test';
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

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, './BpmnViewer': 'export default function BpmnViewer() { return null; }' });

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

const ORIGIN = 'https://site.fixture.example';
const storage = new Map<string, string>();
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location: { href: `${ORIGIN}/ask`, origin: ORIGIN, pathname: '/ask' },
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const { CONSENT_STEP_TEXT } = await load('components/answer-view/ConsentStep.tsx');
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

// --- The stream, the route answers, the pauses -----------------------------------------------

interface Held { response: Response; push: (event: Json) => void; close: () => void }
function heldStream(): Held {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const enc = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (event) => { if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)); },
    close: () => { if (!closed) { closed = true; controller.close(); } },
  };
}

const mounted: Surface[] = [];
let streams: Held[] = [];
let decisions: Json[] = [];
afterEach(() => {
  for (const s of streams) s.close();
  for (const p of mounted.splice(0)) p.unmount();
  cancelConsentPauses();
});

const statement = await buildFlowsStatement();
const src = (id: string) => {
  const found = statement.sources.find((s: { sourceId: string }) => s.sourceId === id);
  assert.ok(found, `premise: the statement names ${id}`);
  return found;
};
const A = 'boston-opencontext';
const B = 'data-commons';
let run = 0;
let KEY_A = '';
let KEY_B = '';
const keyOf = (prefix: string) => `${prefix}${String(run).padStart(8, '0')}10a1c0de4b1d2c3e`;
const pauseOf = (id: string, key: string) => ({ key, source: src(id), outbound: [], links: statement.links, expiresAt: new Date(Date.now() + 60_000).toISOString(), holds: true });

function answers() {
  streams = [];
  decisions = [];
  run += 1;
  KEY_A = keyOf('a10a10a1');
  KEY_B = keyOf('b10b10b1');
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': async (request: Request) => {
      if (request.method === 'GET') return new Response(JSON.stringify({ routing: 'in-loop', store: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      const body = JSON.parse(await request.text()) as Json;
      decisions.push(body);
      return new Response(JSON.stringify({ decision: body.decision, sourceId: body.key === KEY_A ? A : B }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/query-notebook': () => { const s = heldStream(); streams.push(s); return s.response; },
  });
}

async function consentWith(states: Record<string, string>): Promise<void> {
  const written = await fetch('/api/sources/consent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, states[s.sourceId] ?? 'on'])), flowsVersion: statementHash(statement) }),
  });
  assert.equal(written.status, 200, 'premise: the consent was written');
}

// --- Reading the cards ---------------------------------------------------------------------

function* within(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) { for (const c of node) yield* within(c); return; }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as HostElement;
  if (typeof el.type === 'string') yield el;
  yield* within((el.props as { children?: unknown }).children);
}

interface CardRead { source: string; place: string; outcome: string | null; buttons: string[]; element: HostElement }
function cardsIn(elements: HostElement[]): CardRead[] {
  return elements.filter((el) => el.props['data-part'] === 'consent-step').map((el) => {
    const inner = [...within(el.props.children)];
    const outcome = inner.find((x) => x.props['data-part'] === 'consent-outcome');
    return {
      source: String(el.props['data-consent-source']),
      place: String(el.props['data-consent-place']),
      outcome: outcome ? textOf(outcome) : null,
      buttons: inner.filter((x) => x.type === 'button').map((x) => textOf(x)),
      element: el,
    };
  });
}
const summary = (surface: Surface) => JSON.stringify(cardsIn(surface.elements()).map(({ source, place, outcome, buttons }) => ({ source, place, outcome, buttons })));

function one(surface: Surface, what: string, pick: (el: HostElement) => boolean): HostElement {
  const found = surface.elements().filter(pick);
  assert.equal(found.length, 1, `expected one ${what}, found ${found.length}`);
  return found[0];
}

async function ask(surface: Surface): Promise<void> {
  const box = one(surface, 'question box', (el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  await surface.type(box, 'How many service requests did Boston record in 2025?');
  await surface.submit(one(surface, 'form', (el) => el.type === 'form' && surface.elements().some((x) => x.type === 'textarea')));
}
const settle = async (surface: Surface) => {
  await new Promise((r) => setTimeout(r, 50));
  await surface.settle();
};

/** The button labelled `label` in the run's step card for `id`. */
function stepButton(surface: Surface, id: string, label: string): HostElement {
  const card = cardsIn(surface.elements()).find((c) => c.source === id && c.place === 'steps');
  assert.ok(card, `no step card for ${id}: ${summary(surface)}`);
  const button = [...within(card!.element.props.children)].find((x) => x.type === 'button' && textOf(x) === label);
  assert.ok(button, `the step card for ${id} has no ${label}: ${summary(surface)}`);
  return button!;
}

/** The finished view's steps part: the one that carries the closing rows. */
function finishedSteps(surface: Surface): HostElement {
  const parts = surface.elements().filter((el) => el.props['data-part'] === 'steps'
    && [...within(el.props.children)].some((x) => x.props['data-part'] === 'closing-row'));
  assert.equal(parts.length, 1, `expected the finished view's steps part, found ${parts.length}: ${surface.text().slice(0, 600)}`);
  return parts[0];
}

// The executed run's live progress events, as `query-notebook/route.ts` forwards them: no args (P-a).
const loadLine = (phase: 'tool_start' | 'tool_complete', label: string, iteration: number): Json =>
  ({ type: 'phase_a_progress', message: `Loading the ${label} source`, phase, iteration, toolName: 'load_source', operationType: 'load_source' });
const pauseLine = (id: string, key: string, label: string): Json =>
  ({ type: 'phase_a_progress', message: `Waiting for your answer about ${label}, which is set to Ask first`, phase: 'consent_pause', pause: pauseOf(id, key) });

const RUN_ANSWER = 'RUNANSWER-r10: **42** requests.';
const NOTEBOOK = {
  nbformat: 4, nbformat_minor: 5,
  metadata: {
    extensions: {
      'org.civicaitools.execution': { executedAt: '2026-10-30T12:00:00Z', executionDuration_ms: 4200, sandboxId: 'fixture-sandbox-r10', environment: { python: '3.13', libraries: {} } },
      'org.civicaitools.notebook': { provenance: 'executed' },
    },
  },
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Fixture notebook\n'] },
    { cell_type: 'code', metadata: { role: 'synthesis' }, execution_count: 1, source: ['display(Markdown(answer))\n'], outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/markdown': RUN_ANSWER } }] },
  ],
};

test('criterion 3 (#667), /ask in notebook mode: after Allow on one pause and Not now on another in the live view, the finished run keeps both consent steps in its steps part, each with its own outcome', async () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  sessions.rows.clear();
  answers();
  await consentWith({ [A]: 'ask-first', [B]: 'ask-first' });
  const page = await mount(h(QuerySurface, { showLocalSetupFootnote: false, presentation: 'answer-first', defaultMode: 'notebook' }));
  mounted.push(page);
  await ask(page);
  const stream = streams[0];
  assert.ok(stream, 'premise: the page started an executed run');

  // The live view: two loads pause, and the reader answers each in its step card.
  stream.push({ type: 'phase', name: 'A', message: 'Discovering datasets…' });
  stream.push(loadLine('tool_start', 'Boston OpenContext', 1));
  stream.push(pauseLine(A, KEY_A, 'Boston OpenContext'));
  await settle(page);
  await page.click(stepButton(page, A, 'Allow'));
  await settle(page);
  stream.push(loadLine('tool_complete', 'Boston OpenContext', 1));
  stream.push(loadLine('tool_start', 'Data Commons', 2));
  stream.push(pauseLine(B, KEY_B, 'Data Commons'));
  await settle(page);
  await page.click(stepButton(page, B, 'Not now'));
  await settle(page);
  stream.push(loadLine('tool_complete', 'Data Commons', 2));
  await settle(page);
  assert.deepEqual(decisions, [{ key: KEY_A, decision: 'allow' }, { key: KEY_B, decision: 'not-now' }], 'premise: each answer was posted under its own key');
  const live = cardsIn(page.elements()).filter((c) => c.place === 'steps');
  assert.deepEqual(live.map((c) => [c.source, c.outcome]), [[A, CONSENT_STEP_TEXT.allowed], [B, CONSENT_STEP_TEXT.declined]], `premise: the live view reads both outcomes: ${summary(page)}`);

  // The swap: the run's calls, then the notebook, so the live view unmounts and the finished view mounts.
  stream.push({ type: 'phase_a_tool_call', name: 'load_source', operationType: 'load_source', args: { alias: 'boston' }, duration_ms: 4000 });
  stream.push({ type: 'phase_a_tool_call', name: 'load_source', operationType: 'load_source', args: { alias: 'data_commons' }, duration_ms: 4000 });
  stream.push({ type: 'phase_a_answer', content: RUN_ANSWER });
  stream.push({ type: 'phase', name: 'B', message: 'Synthesizing notebook…' });
  stream.push({ type: 'phase', name: 'C', message: 'Executing in sandbox…' });
  stream.push({ type: 'notebook', notebook: NOTEBOOK, sandboxId: 'fixture-sandbox-r10', executionDuration_ms: 4200, validation: { ok: true, issues: [] } });
  stream.push({ type: 'phase', name: 'D', message: 'Finalizing…' });
  stream.push({ type: 'phase', name: 'complete', message: 'Done.' });
  stream.close();
  await settle(page);

  const steps = finishedSteps(page);
  const finished = cardsIn([...within(steps.props.children)]);
  assert.deepEqual(
    finished.map((c) => [c.source, c.outcome]),
    [[A, CONSENT_STEP_TEXT.allowed], [B, CONSENT_STEP_TEXT.declined]],
    `the finished run's consent steps: ${summary(page)}`,
  );
  for (const card of finished) {
    assert.deepEqual(card.buttons, [], `the finished card for ${card.source} offers buttons`);
    assert.notEqual(card.outcome, CONSENT_STEP_TEXT.ended, `the finished card for ${card.source} lost its answer`);
  }
});
