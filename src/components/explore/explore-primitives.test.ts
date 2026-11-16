// UX-2 P6 + P10 (#729), `/explore` on the site's primitives: contract p6p10.md v5.2, criteria 2 (`/explore`'s mode
// tabs), 4 (one disclosure mechanism in P6's files) and 5 (X28, the legend's ruled words).
//
// THE RULE. The mode tabs render through `Tabs` (`role="tablist"`, `role="tab"`, `aria-selected`, one selected); the
// "Understanding this diagram" block is a `Disclosure` (`details.ui-disclosure`) and `McpFlowDiagram.tsx` holds no bare
// `<details>`; the legend's first paragraph reads X28 byte for byte, with one link, on "BPMN 2.0", to today's address.
//
// WHAT IS DRIVEN. The real `McpFlowDiagram` (its BPMN canvas stubbed) on the surface harness, every request answered
// here; the source of `McpFlowDiagram.tsx` with comments blanked.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the tabs are two plain buttons, the block is a bare `<details>` at `:592`, and
// the legend reads "This is a BPMN 2.0 (Business Process Model and Notation) diagram — a standard way to visualize
// workflows."
//
// BLIND SPOTS, stated. No keyboard or focus: the arrow keys and the roving tabindex's focus are the preview read's
// (P6P10-1). The download link's style is not read.
//
// Run with: npm test

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import { CONSENT_SURFACE_STUBS, SRC, h, installFetch, mount, registerSurfaceHooks, textOf, type HostElement, type Surface } from '../sources/surface-test-harness.ts';
import { hasClass, within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  './BpmnViewer': 'export default function BpmnViewer() { return null; }',
});
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';

const ORIGIN = 'https://site.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: `${ORIGIN}/explore`, origin: ORIGIN, pathname: '/explore', search: '' },
    scrollTo() {},
    innerHeight: 852,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target, querySelector: () => null, querySelectorAll: () => [] },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
installFetch(ORIGIN, {
  '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }),
  '/api/flows': () => flowsRoute.GET(),
  '/api/sources/consent/decision': () => json({ routing: 'in-loop', store: true }),
  '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
});

const mounted: Surface[] = [];
afterEach(() => {
  for (const s of mounted.splice(0)) s.unmount();
});
async function explore(): Promise<Surface> {
  const s = await mount(h(McpFlowDiagram));
  mounted.push(s);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await s.settle();
  return s;
}

// --- Criterion 2: the mode tabs ---------------------------------------------------------------------------------

function tabs(s: Surface): HostElement[] {
  const lists = s.elements().filter((el) => el.props.role === 'tablist');
  assert.equal(lists.length, 1, `role="tablist" elements on /explore: ${lists.length}`);
  return within(lists[0]).filter((el) => el.props.role === 'tab');
}

test('criterion 2: /explore renders one tablist, "Example traces" and "Try your own", exactly one selected, and a click moves the selection', async () => {
  const s = await explore();
  assert.deepEqual(tabs(s).map((t) => [textOf(t), String(t.props['aria-selected'])]), [['Example traces', 'true'], ['Try your own', 'false']]);
  await s.click(tabs(s)[1]);
  await s.settle();
  assert.deepEqual(tabs(s).map((t) => String(t.props['aria-selected'])), ['false', 'true']);
});

// --- Criterion 4: no bare <details> in McpFlowDiagram.tsx; the block is a Disclosure ----------------------------------

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

test('criterion 4 (R14): McpFlowDiagram.tsx holds no bare <details> (a source scan, comments blanked)', () => {
  const source = withoutComments(fs.readFileSync(path.join(SRC, 'components', 'explore', 'McpFlowDiagram.tsx'), 'utf8'));
  const lines = source.split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => /<details\b/.test(l)).map(([n]) => n);
  assert.deepEqual(lines, [], 'lines with a bare <details>');
});

function legendDisclosure(s: Surface): HostElement {
  const found = s.elements().filter((el) => el.type === 'details'
    && within(el).some((x) => x.type === 'summary' && textOf(x) === 'Understanding this diagram'));
  assert.equal(found.length, 1, `<details> summarised "Understanding this diagram": ${found.length}`);
  return found[0];
}

test('criterion 4 (R14): "Understanding this diagram" renders as details.ui-disclosure', async () => {
  const details = legendDisclosure(await explore());
  assert.ok(hasClass(details, 'ui-disclosure'), `the block's classes: ${String(details.props.className ?? '')}`);
});

// --- Criterion 5: X28 -----------------------------------------------------------------------------------------------

const X28 = 'This diagram shows the steps in order. It uses a standard notation, BPMN 2.0 (the link explains it).';

test('criterion 5 (X28): the legend\'s first paragraph reads the ruled words, with one link, on "BPMN 2.0", to today\'s address', async () => {
  const details = legendDisclosure(await explore());
  const first = within(details).find((el) => el.type === 'p');
  assert.ok(first, 'the legend has no paragraph');
  assert.equal(textOf(first!), X28);
  const links = within(first!).filter((el) => el.type === 'a');
  assert.deepEqual(links.map((a) => [textOf(a), a.props.href]), [['BPMN 2.0', 'https://www.bpmn.org/']]);
});
