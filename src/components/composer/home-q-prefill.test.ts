// UX-2 P3b-2 (#729), criterion 12 (2H; the seat, 6777902583 point 4) and fix 7 (#729 6865424128): `/learn`'s cards
// link `/?q=<the question>`, and the home page's box fills itself with it, once, after mount, sending nothing.
//
// THE RULE. On the home page's mount (`(marketing)/page.tsx` asks for it with `prefillFromAddress`), the box reads
// `q` from the address after mount and holds it, decoded. No request goes to a query route, the consent card does not
// open, and the address does not change. Mounted at `/`, the box is empty. `/ask` and `/explore` do not read `q`. The
// read is a hydration-safe snapshot of `window.location.search` (server snapshot `null`), so the server render and the
// first paint do not change (fix 7): no `useSearchParams`, which would make the prerendered page client-render.
//
// WHAT IS DRIVEN. The real home page and `/ask`'s mount on the surface harness, with the window's address set per case.
//
// WHAT MAKES IT ABLE TO FAIL. At P3b-2's base nothing on the home path reads `q`: the box is empty at `/?q=…`. The
// question carries a space, an ampersand and a non-ASCII letter, percent-encoded, so a raw read
// (`location.search.slice(3)`) or a half-decoded one (`decodeURI`, which leaves `%26`) reads differently.
//
// BLIND SPOTS, stated. The harness has no router and no hydration: a client navigation from `/learn` (a next/link to
// `/?q=…`) and the served HTML of `/` against `/?q=…` are read on the build (the instrument and 2-P1; fix 7 closes F2
// at the green), not here.
//
// Run with: npm test

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import { CONSENT_SURFACE_STUBS, SRC, h, installFetch, mount, registerSurfaceHooks, sessions, type Surface } from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

const ORIGIN = 'https://site.fixture.example';
const QUESTION = 'Noise & 311 complaints near the café, 2024?';
const storage = new Map<string, string>();
const history: string[] = [];
const target = { addEventListener() {}, removeEventListener() {} };
function at(pathname: string, search: string): void {
  Object.assign(globalThis as Record<string, unknown>, {
    window: {
      ...target,
      sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
      location: { href: `${ORIGIN}${pathname}${search}`, origin: ORIGIN, pathname, search },
      history: { replaceState: (_s: unknown, _t: string, url: string) => { history.push(`replace ${url}`); }, pushState: (_s: unknown, _t: string, url: string) => { history.push(`push ${url}`); } },
      scrollTo() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    },
    document: { ...target },
  });
}
at('/', '');

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
function answers() {
  return installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': () => json({ routing: 'in-loop', store: true }),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => json({ remaining: 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: false }),
  });
}

const mounted: Surface[] = [];
afterEach(() => { for (const p of mounted.splice(0)) p.unmount(); });
async function page(element: ReturnType<typeof h>): Promise<Surface> {
  const p = await mount(element);
  mounted.push(p);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await p.settle();
  return p;
}
const boxValue = (p: Surface): unknown => p.elements().find((el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data')?.props.value;

test('P3b-2 criterion 12 (2H): the home page at /?q=<question>: after mount the box holds the question, decoded; nothing is sent, the consent card is not open, and the address is unchanged', async () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  const search = `?q=${encodeURIComponent(QUESTION)}`;
  assert.ok(search.includes('%26') && search.includes('%C3%A9') && search.includes('%20'), `premise: the fixture is percent-encoded: ${search}`);
  at('/', search);
  history.length = 0;
  const net = answers();
  const p = await page(h(Home));
  assert.equal(boxValue(p), QUESTION, 'the box does not hold the question from the address, decoded');
  assert.deepEqual(net.sent.filter((r) => /^\/api\/(compare|query)/.test(r.path)).map((r) => r.path), [], 'a question was sent');
  assert.equal(p.elements().filter((el) => el.props['data-part'] === 'consent-card').length, 0, 'the consent card opened');
  assert.deepEqual(history, [], 'the address was changed');
  assert.equal((globalThis as unknown as { window: { location: { search: string } } }).window.location.search, search, 'the address was changed');
});

test('P3b-2 criterion 12 (2H): the home page at /, and /ask at /ask?q=<question>, leave the box empty', async () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  at('/', '');
  answers();
  const home = await page(h(Home));
  assert.equal(boxValue(home), '', 'the home page at / filled its box');
  sessions.server = { user: { id: 'gh-fixture-account' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  at('/ask', `?q=${encodeURIComponent(QUESTION)}`);
  answers();
  const ask = await page(h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }));
  assert.equal(boxValue(ask), '', '/ask read q');
});
