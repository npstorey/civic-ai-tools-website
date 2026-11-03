// UX-1 P7: the six reading pages on P0's page frame, and the words ruled for
// them (anchor #719, part 2, "P7: the marketing pages"; criteria 1-4 and 6).
//
// WHAT IS DRIVEN. The real page components (`/about`, `/learn`, `/project`,
// `/roadmap`, `/talks`, `/privacy`) and the home page's `PositioningBand`,
// mounted on the surface harness (`../../components/sources/surface-test-harness.ts`).
// `about` and `roadmap` are async server components, and the harness renders a
// returned promise as nothing, so every page function is called and AWAITED
// first and the element it resolves to is what is mounted. Every request a page
// makes is answered here (`installFetch`): the roadmap's Markdown (a fixture
// with seven h2s, one holding a link, an h3 and an h4 under it) and the
// directory index the about page counts (the snapshot bundled with this
// codebase). `next/link` renders as a plain anchor; `next/script` (imported,
// never rendered) as nothing. The portal counts the about page reads are
// checked-in JSON outside `src/`, served by one load hook below as a module.
//
// HOW IT IS READ. From the harness's host tree, by element identity, with the
// shared readers P0 wrote (`../../components/ui/ui-test-helpers.ts`), except
// an attribute, which is read by the local `attr` below (see `ownTag`); a text is
// what a reader reads (tags removed, entities decoded, whitespace collapsed, a
// curly apostrophe read as a straight one).
//
// THE SPONSOR LINE (criterion 4). The instrument is "the page body renders
// none, and the root layout mounts exactly one": a sponsor is configured for
// the render (`SITE_SPONSOR_NAME`), so a `SponsorLine` on the page body shows up
// as text (with none configured it renders nothing, and the check could not
// fail), and `src/app/layout.tsx` is read with the TypeScript compiler for its
// `<SponsorLine>` elements. The layout is not rendered: it is the root
// document (fonts, analytics, the header), and P7 does not edit it.
//
// THE CONTACT SENTENCE (criterion 6). One component carries it, mounted on
// /project and in the home band: the sentence appears in exactly one tracked
// source file (from `git ls-files`, tests excluded; whitespace collapsed and
// `&apos;`, `&#39;`, `&rsquo;` and a curly apostrophe read as a straight one, so
// the sentence must sit in that file as one run of text), which is neither page,
// and both pages import that file.
//
// BLIND SPOTS, stated. No layout or CSS cascade: a width is read as the frame's
// class plus the declaration globals.css gives that class. No browser: a
// fragment is checked against the ids in the rendered tree, not scrolled to.
// The roadmap is driven on a fixture document, not the published one.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types 'src/app/(marketing)/marketing-pages.test.ts')

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as nodeModule from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { ReactElement } from 'react';
import {
  h,
  installFetch,
  mount,
  registerSurfaceHooks,
  NEXT_LINK_STUB,
  SRC,
  type HostElement,
  type Surface,
} from '../../components/sources/surface-test-harness.ts';
import { renderToStaticMarkup } from 'react-dom/server';
import { childrenOf, cssRules, one, readText, within } from '../../components/ui/ui-test-helpers.ts';

const REPO = path.resolve(SRC, '..');
const DATA_DIR = path.join(REPO, 'data');

// The about page's portal counts import `data/portals/*.json`, outside `src/`,
// which the harness's load hook does not serve; this one does, as a module.
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    load?: (url: string, context: unknown, nextLoad: (url: string, context?: unknown) => { format: string; source?: string }) => { format: string; source?: string; shortCircuit?: boolean };
  }): void;
};
registerHooks({
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith('file:')) {
      const file = fileURLToPath(loadUrl);
      if (file.startsWith(DATA_DIR + path.sep) && file.endsWith('.json')) {
        return { format: 'module', source: `export default ${fs.readFileSync(file, 'utf8')};`, shortCircuit: true };
      }
    }
    return nextLoad(loadUrl, context);
  },
});
// `next/script` is imported by the privacy page's analytics module (for the
// layout's tags) and never rendered by a page; plain ESM cannot resolve it.
registerSurfaceHooks({ 'next/link': NEXT_LINK_STUB, 'next/script': 'export default function Script() { return null; }' });

// --- The configuration every render reads ------------------------------------------

const SPONSOR = 'Fixture Sponsor P7';
const ROADMAP_ORIGIN = 'https://roadmap.fixture.test';
const DIRECTORY_ORIGIN = 'https://directory.fixture.test';
process.env.SITE_SPONSOR_NAME = SPONSOR;
process.env.SITE_SPONSOR_PREFIX = 'Supported by';
delete process.env.SITE_SPONSOR_URL;
process.env.ROADMAP_RAW_URL = `${ROADMAP_ORIGIN}/p7/ROADMAP.md`;
delete process.env.ROADMAP_GITHUB_URL;
process.env.DIRECTORY_DATA_URL = `${DIRECTORY_ORIGIN}/p7/directory.json`;

// Seven h2s (more than five, so the page owes a jump list), one carrying inline
// code and emphasis and one carrying a Markdown link (the shape on which an id
// taken from the raw Markdown and an id taken from the rendered text part), an
// h3, and an h4 under that h3.
const ROADMAP_FIXTURE = `# Fixture roadmap

**Last updated:** 2026-11-01

A fixture preamble paragraph.

---

## Now

The work underway.

### Underway

#### A detail under its h3

A detail.

## Next

Planned.

## Later

Further out.

## The \`cli\` and **host** work

Tooling.

## The [verifier](https://verifier.fixture.test/check) and its checks

A heading whose text is a link: its id comes from the text it renders, not its Markdown.

## Funding

Support.

## How this document changes

Revisions.
`;

const DIRECTORY_SNAPSHOT = fs.readFileSync(path.join(SRC, 'lib', 'mcp', 'directory-fallback.json'), 'utf8');

installFetch(ROADMAP_ORIGIN, {
  '/p7/ROADMAP.md': () => new Response(ROADMAP_FIXTURE, { status: 200, headers: { 'content-type': 'text/markdown' } }),
  '/p7/directory.json': () => new Response(DIRECTORY_SNAPSHOT, { status: 200, headers: { 'content-type': 'application/json' } }),
});

// --- The pages -------------------------------------------------------------------

type PageFn = () => ReactElement | Promise<ReactElement>;

const about = await import('@/app/(marketing)/about/page');
const learn = await import('@/app/(marketing)/learn/page');
const project = await import('@/app/(marketing)/project/page');
const roadmap = await import('@/app/(marketing)/roadmap/page');
const talks = await import('@/app/(marketing)/talks/page');
const privacy = await import('@/app/(app)/privacy/page');
const { default: PositioningBand } = await import('@/components/home/PositioningBand');
const { EXPRESS_INTEREST_URL } = await import('@/lib/site-config');

const PAGE_FNS: Record<string, PageFn> = {
  '/about': about.default as PageFn,
  '/learn': learn.default as PageFn,
  '/project': project.default as PageFn,
  '/roadmap': roadmap.default as PageFn,
  '/talks': talks.default as PageFn,
  '/privacy': privacy.default as PageFn,
};

/** The page function called and awaited (an async page renders empty otherwise), then mounted. */
async function renderPage(fn: PageFn): Promise<Surface> {
  const element = await fn();
  return mount(element);
}

const PAGES: Record<string, Surface> = {};
for (const [route, fn] of Object.entries(PAGE_FNS)) PAGES[route] = await renderPage(fn);
const BAND = await mount(h(PositioningBand));

// --- Readers -----------------------------------------------------------------------

// An element's own opening tag, as react-dom/server writes it. P0's
// `openingTag` (ui-test-helpers.ts) takes the first tag of the element's markup,
// and when the subtree holds an <img>, react-dom/server writes a
// `<link rel="preload" as="image">` hint for it FIRST, so that reader returns
// the hint's tag: the /project page's frame (it holds the consortium logos)
// reads as having no class at all. These readers skip the hints.
function ownTag(el: HostElement): string {
  const markup = renderToStaticMarkup(el).replace(/^(?:<link [^>]*rel="preload"[^>]*\/>)+/, '');
  const match = /^<[^>]*>/.exec(markup);
  assert.ok(match, `no opening tag in the markup of a <${el.type}>`);
  return match[0];
}

function attr(el: HostElement, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\s${escaped}(?:="([^"]*)")?(?=[\\s/>])`).exec(ownTag(el));
  if (!match) return null;
  return match[1] ?? '';
}

function classesOf(el: HostElement): string[] {
  return (attr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
}

function hasClass(el: HostElement, name: string): boolean {
  return classesOf(el).includes(name);
}

function byClass(s: Surface, name: string): HostElement[] {
  return s.elements().filter((el) => hasClass(el, name));
}

/** What a reader reads: a curly apostrophe as a straight one, no space before punctuation. */
function plain(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/\s+([.,;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}

function pageText(s: Surface): string {
  return plain(s.text());
}

function headings(s: Surface): HostElement[] {
  return s.elements().filter((el) => /^h[1-6]$/.test(el.type));
}

function headingTexts(s: Surface): string[] {
  return headings(s).map((el) => plain(readText(el)));
}

/** The host elements with no host parent: what the page renders at its top. */
function topLevel(s: Surface): HostElement[] {
  const all = s.elements();
  const children = new Set<HostElement>();
  for (const el of all) for (const child of childrenOf(el)) children.add(child);
  return all.filter((el) => !children.has(el));
}

function ancestors(s: Surface, el: HostElement): HostElement[] {
  const all = s.elements();
  const out: HostElement[] = [];
  let current: HostElement | undefined = el;
  while (current) {
    const parent: HostElement | undefined = all.find((p) => childrenOf(p).includes(current as HostElement));
    if (parent) out.push(parent);
    current = parent;
  }
  return out;
}

function links(s: Surface): HostElement[] {
  return s.elements().filter((el) => el.type === 'a');
}

function linksReading(s: Surface, text: string): HostElement[] {
  return links(s).filter((a) => plain(readText(a)) === text);
}

// --- Criterion 1: every h4 has an h3 after the nearest preceding h2 ------------------

/** The h4s with no h3 between them and the nearest heading of level 2 or above before them. */
function orphanH4s(s: Surface): string[] {
  const out: string[] = [];
  let h3SinceH2 = false;
  for (const el of headings(s)) {
    if (el.type === 'h1' || el.type === 'h2') h3SinceH2 = false;
    else if (el.type === 'h3') h3SinceH2 = true;
    else if (el.type === 'h4' && !h3SinceH2) out.push(plain(readText(el)));
  }
  return out;
}

test('criterion 1 instrument: an h4 straight under an h2 is caught, and one under an h3 is not', async () => {
  const bad = await mount(h('div', null, h('h2', null, 'A'), h('h4', null, 'Orphan'), h('h3', null, 'B'), h('h4', null, 'Nested')));
  assert.deepEqual(orphanH4s(bad), ['Orphan']);
});

for (const route of Object.keys(PAGE_FNS)) {
  test(`criterion 1: ${route} renders every h4 under an h3 after the nearest preceding h2`, () => {
    const orphans = orphanH4s(PAGES[route]);
    assert.deepEqual(orphans, [], `${route}: h4s with no h3 after their h2: ${JSON.stringify(orphans)}`);
  });
}

test('criterion 1: the roadmap fixture is rendered (its h4 sits under its h3), so the check reads Markdown headings too', () => {
  const texts = headingTexts(PAGES['/roadmap']);
  assert.ok(texts.includes('A detail under its h3'), `the fixture's h4 is rendered; headings: ${JSON.stringify(texts)}`);
  assert.equal(PAGES['/roadmap'].elements().filter((el) => el.type === 'h2').length, 7, 'the fixture renders seven h2s');
});

// --- Criterion 2: one jump list on /learn, /privacy and /roadmap ---------------------

function jumpListProblems(s: Surface): string[] {
  const problems: string[] = [];
  const navs = s.elements().filter((el) => el.type === 'nav' && (attr(el, 'aria-label') ?? '') !== '');
  if (navs.length !== 1) return [`expected exactly one <nav aria-label> jump list, found ${navs.length}`];
  const nav = navs[0];
  const fragments = within(nav)
    .filter((el) => el.type === 'a')
    .map((a) => attr(a, 'href') ?? '')
    .filter((href) => href.startsWith('#'));
  if (fragments.length === 0) problems.push('the jump list has no fragment links');
  const all = s.elements();
  const targets: HostElement[] = [];
  for (const fragment of fragments) {
    const id = decodeURIComponent(fragment.slice(1));
    const named = all.filter((el) => el.props.id === id);
    if (named.length !== 1) problems.push(`${fragment} names ${named.length} elements, not one`);
    else targets.push(named[0]);
  }
  for (const h2 of all.filter((el) => el.type === 'h2')) {
    const reached = targets.some((t) => t === h2 || within(t).includes(h2));
    if (!reached) problems.push(`no fragment reaches the h2 "${plain(readText(h2))}"`);
  }
  return problems;
}

test('criterion 2 instrument: a fragment with no target, and two jump lists, are caught', async () => {
  const dangling = await mount(h('div', null, h('nav', { 'aria-label': 'Sections' }, h('a', { href: '#gone' }, 'Gone')), h('h2', { id: 'here' }, 'Here')));
  assert.deepEqual(jumpListProblems(dangling), ['#gone names 0 elements, not one', 'no fragment reaches the h2 "Here"']);
  const two = await mount(h('div', null, h('nav', { 'aria-label': 'A' }), h('nav', { 'aria-label': 'B' })));
  assert.deepEqual(jumpListProblems(two), ['expected exactly one <nav aria-label> jump list, found 2']);
});

// /project has four h2s; its jump list is the owner's ruling at the gate (G0-2 (ii)).
for (const route of ['/learn', '/privacy', '/roadmap', '/project']) {
  test(`criterion 2: ${route} renders exactly one <nav aria-label> jump list whose fragments each name one element id`, () => {
    const problems = jumpListProblems(PAGES[route]);
    assert.deepEqual(problems, [], `${route}: ${problems.join('; ')}`);
  });
}

// --- Criterion 3: the reading frame -----------------------------------------------

for (const route of Object.keys(PAGE_FNS)) {
  test(`criterion 3: ${route} renders inside the ui-page frame at the reading width (720 px)`, () => {
    const s = PAGES[route];
    const frames = byClass(s, 'ui-page');
    const frame = one(frames, `ui-page frame on ${route}`);
    assert.ok(hasClass(frame, 'ui-page--reading'), `${route}: ui-page--reading in [${classesOf(frame).join(' ')}]`);
    const top = topLevel(s);
    assert.ok(top.length === 1 && top[0] === frame, `${route}: everything the page renders is inside the frame (top-level elements: ${top.map((el) => `<${el.type} class="${attr(el, 'class') ?? ''}">`).join(', ')})`);
    assert.match(cssRules('.ui-page--reading').join(';'), /max-width\s*:\s*720px/, 'globals.css: .ui-page--reading max-width 720px');
  });
}

// --- Criterion 4: SponsorLine once on /about ------------------------------------

function jsxElementsNamed(file: string, name: string): number {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === name) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

test('criterion 4: /about renders SponsorLine once (the page body renders none; the root layout mounts the one)', () => {
  const s = PAGES['/about'];
  const onPage = s.elements().filter((el) => el.type === 'p' && readText(el).includes(SPONSOR)).length;
  const inLayout = jsxElementsNamed(path.join(SRC, 'app', 'layout.tsx'), 'SponsorLine');
  assert.equal(inLayout, 1, 'src/app/layout.tsx mounts SponsorLine once (its footer)');
  assert.equal(onPage, 0, `the /about page body renders the sponsor line ${onPage} time(s); with the layout's footer that is ${onPage + inLayout}`);
});

test('criterion 4 instrument: with a sponsor configured, a SponsorLine renders its name', async () => {
  const { default: SponsorLine } = await import('@/components/SponsorLine');
  const s = await mount(h(SponsorLine));
  assert.equal(s.elements().filter((el) => el.type === 'p' && readText(el).includes(SPONSOR)).length, 1);
});

// --- Criterion 6: the ruled words -------------------------------------------------

const W6 = 'How data tools connect AI to data';
const W7 = 'With data tools';
const CONTACT = "Interested in running this with your city's data, or learning about the verification standard behind it?";

test('criterion 6, W6: the /learn h2 reads "How data tools connect AI to data", and the body below defines MCP', () => {
  const s = PAGES['/learn'];
  const texts = headingTexts(s);
  assert.ok(!texts.includes('How MCP Connects AI to Data'), 'the old heading is gone');
  const h2 = one(s.elements().filter((el) => el.type === 'h2' && plain(readText(el)) === W6), `h2 "${W6}"`);
  const section = ancestors(s, h2).find((el) => el.type === 'section');
  assert.ok(section, 'the h2 sits in a section');
  assert.ok(within(section).some((el) => el.type === 'a' && plain(readText(el)) === 'MCP (Model Context Protocol)'), 'the section defines MCP at its first use');
});

// W7's pair in sentence case (gate ruling D2): "Without data tools" beside "With data tools".
test('criterion 6, W7: the /learn card headings read "Without data tools" and "With data tools"', () => {
  const texts = headingTexts(PAGES['/learn']);
  assert.ok(!texts.includes('With MCP'), `"With MCP" is no heading; headings: ${JSON.stringify(texts)}`);
  assert.equal(texts.filter((t) => t === W7).length, 1, `one heading reads "${W7}"`);
  assert.ok(!texts.includes('Without Data Tools'), `"Without Data Tools" is no heading; headings: ${JSON.stringify(texts)}`);
  assert.equal(texts.filter((t) => t === 'Without data tools').length, 1, 'its pair reads "Without data tools" (D2, sentence case)');
});

function normalizeSource(text: string): string {
  return text.replace(/&apos;|&#39;|&rsquo;|[‘’]/g, "'").replace(/\s+/g, ' ');
}

function trackedSourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' });
  return out
    .split('\0')
    .filter((f) => /\.(c|m)?[jt]sx?$/.test(f) && !/\.test\.(c|m)?[jt]sx?$/.test(f))
    .map((f) => path.join(REPO, f));
}

function filesHolding(text: string): string[] {
  return trackedSourceFiles().filter((file) => {
    try {
      return normalizeSource(fs.readFileSync(file, 'utf8')).includes(text);
    } catch {
      return false;
    }
  });
}

function resolvedImports(file: string): string[] {
  const info = ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true);
  const out: string[] = [];
  for (const { fileName } of info.importedFiles) {
    let base: string | null = null;
    if (fileName.startsWith('@/')) base = path.join(SRC, fileName.slice(2));
    else if (fileName.startsWith('.')) base = path.resolve(path.dirname(file), fileName);
    if (base === null) continue;
    const found = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find((c) => {
      try {
        return fs.statSync(c).isFile();
      } catch {
        return false;
      }
    });
    if (found) out.push(found);
  }
  return out;
}

const PROJECT_FILE = path.join(SRC, 'app', '(marketing)', 'project', 'page.tsx');
const BAND_FILE = path.join(SRC, 'components', 'home', 'PositioningBand.tsx');

test('criterion 6, contact: the ruled sentence sits in exactly one tracked source file, a component both mounts import', () => {
  const holding = filesHolding(CONTACT);
  assert.equal(holding.length, 1, `the contact sentence appears in ${holding.length} tracked source file(s): ${JSON.stringify(holding.map((f) => path.relative(REPO, f)))}`);
  const [component] = holding;
  assert.ok(component !== PROJECT_FILE && component !== BAND_FILE, `the sentence lives in a shared component, not in a page (${path.relative(REPO, component)})`);
  assert.ok(resolvedImports(PROJECT_FILE).includes(component), `project/page.tsx imports ${path.relative(REPO, component)}`);
  assert.ok(resolvedImports(BAND_FILE).includes(component), `PositioningBand.tsx imports ${path.relative(REPO, component)}`);
  for (const old of ['Interested in running this against your city', 'joining the work']) {
    const still = filesHolding(old);
    assert.deepEqual(still.map((f) => path.relative(REPO, f)), [], `the superseded wording "${old}" is in no tracked source file`);
  }
});

for (const [where, s] of [['/project', () => PAGES['/project']], ['the home band', () => BAND]] as const) {
  test(`criterion 6, contact: ${where} renders the ruled sentence once, beside "Get in touch" to EXPRESS_INTEREST_URL`, () => {
    const surface = s();
    const matching = surface.elements().filter((el) => plain(readText(el)) === CONTACT);
    const innermost = matching.filter((el) => !within(el).some((child) => matching.includes(child)));
    assert.equal(innermost.length, 1, `${where}: ${innermost.length} element(s) read exactly "${CONTACT}"`);
    const block = ancestors(surface, innermost[0]).find((el) => within(el).some((a) => a.type === 'a' && plain(readText(a)) === 'Get in touch'));
    assert.ok(block, `${where}: a "Get in touch" link sits beside the sentence`);
    const button = within(block).filter((a) => a.type === 'a' && plain(readText(a)) === 'Get in touch');
    assert.equal(button.length, 1, `${where}: one "Get in touch" link in the block`);
    assert.equal(attr(button[0], 'href'), EXPRESS_INTEREST_URL, `${where}: the link goes to EXPRESS_INTEREST_URL`);
    assert.ok(hasClass(button[0], 'ui-button') && hasClass(button[0], 'ui-button-primary'), `${where}: the link keeps ui-button ui-button-primary`);
  });
}

test('criterion 6, contact: the project page keeps its h2 "Contact us"', () => {
  assert.ok(headingTexts(PAGES['/project']).includes('Contact us'));
});

// --- Criterion 6: the noun rows ("analysis" stands; D1 A, D2 A, D7 A) -----------------

interface NounRow { where: string; surface: () => Surface; after: string[]; before: string[] }

const NOUN_ROWS: NounRow[] = [
  {
    where: 'the home band (PositioningBand.tsx:202-203, :222-223)',
    surface: () => BAND,
    after: [
      "and the analysis is signed, so a third party can confirm it hasn't been altered.",
      'The analysis shows how an answer was produced; it does not claim the answer is correct.',
      'publishable as a signed analysis others can verify without taking your word for it.',
    ],
    before: ['the record is signed, so', 'The record shows how an answer was produced', 'publishable as a signed record'],
  },
  {
    where: '/project (page.tsx:32, :97, :120-121)',
    surface: () => PAGES['/project'],
    after: [
      "The analysis also discloses what didn't work",
      'publish the result as a cryptographically signed analysis that others can verify independently.',
      'publish it as a signed analysis others can check without taking their word for it',
    ],
    before: ['The record also discloses', 'cryptographically signed record that', 'as a signed record others can check'],
  },
  {
    where: '/learn (page.tsx:39, :41-42, :480, :482)',
    surface: () => PAGES['/learn'],
    after: [
      'Responses can be published as signed analyses —',
      'Browse the Analysis page to see published analyses.',
      'When an author publishes an analysis they had kept private',
      'Analyses published earlier with GPT-4o or GPT-5.4 keep those model names.',
    ],
    before: ['signed record packages', 'record index', 'publishes a record they had kept private', 'Records published earlier'],
  },
  {
    where: '/about (page.tsx:110)',
    surface: () => PAGES['/about'],
    after: ['using reviews of published analyses to improve it'],
    before: ['reviews of published records'],
  },
];

for (const row of NOUN_ROWS) {
  test(`criterion 6, nouns: ${row.where} renders each ruled line`, () => {
    const text = pageText(row.surface());
    const missing = row.after.filter((line) => !text.includes(line));
    const stale = row.before.filter((line) => text.includes(line));
    assert.deepEqual({ missing, stale }, { missing: [], stale: [] }, `${row.where}: ruled lines missing ${JSON.stringify(missing)}; superseded lines present ${JSON.stringify(stale)}`);
  });
}

test('criterion 6, nouns: the ruled link texts (C19 on /project, C20 on /learn) each link to /records', () => {
  for (const [route, text] of [['/project', 'public registry of analyses'], ['/learn', 'signed analyses'], ['/learn', 'Analysis page']] as const) {
    const found = linksReading(PAGES[route], text);
    assert.equal(found.length, 1, `${route}: one link reads "${text}" (found ${found.length})`);
    assert.equal(attr(found[0], 'href'), '/records', `${route}: "${text}" links to /records`);
  }
});

test("criterion 6, nouns: the project page's description reads \"…and real published analyses.\" (page.tsx:11)", () => {
  const description = String((project as unknown as { metadata: { description?: unknown } }).metadata.description ?? '');
  assert.ok(description.endsWith('and real published analyses.'), `metadata.description: ${JSON.stringify(description)}`);
});

const KEPT: { where: string; surface: () => Surface; lines: string[] }[] = [
  {
    where: '/learn (:40, :115, :122, :129)',
    surface: () => PAGES['/learn'],
    lines: [
      'cryptographically signed, timestamped, and independently verifiable records of the question, tool calls, data sources, and model output.',
      'Cites specific datasets and records',
      'When asked about current government records',
      'it can query actual records',
    ],
  },
  {
    where: '/project (:105, :144, :148, :235-237)',
    surface: () => PAGES['/project'],
    lines: [
      'A record shows how an answer was produced; it does not claim the answer is correct.',
      'independently verifiable records, plus the open-source software',
      'records how that direction was decided.',
      'Each card links to the signed record, where everything stated here can be read and independently verified.',
      'A record documents how an answer was produced',
    ],
  },
  {
    where: 'the home band (:113-114, :156-184, :200, :275)',
    surface: () => BAND,
    lines: [
      'defines how an AI-generated answer is published as a signed record — so anyone can check',
      'signs, views and verifies records from a terminal.',
      'signs a record from Python or a Jupyter notebook',
      'serves signed records from a static site',
      'each relation is a signed record.',
      'checks any record package without relying on the site that published it.',
      'permanently records which datasets were used',
      'retrieves records with citations',
    ],
  },
  {
    where: '/roadmap (AudienceRoutingStrip.tsx:41, :55)',
    surface: () => PAGES['/roadmap'],
    lines: ['How the signed-record chain works', 'publish an analysis as a signed record.'],
  },
];

for (const row of KEPT) {
  test(`criterion 6, kept: ${row.where} renders each kept line unchanged`, () => {
    const text = pageText(row.surface());
    const missing = row.lines.filter((line) => !text.includes(line));
    assert.deepEqual(missing, [], `${row.where}: kept lines missing ${JSON.stringify(missing)}`);
  });
}
