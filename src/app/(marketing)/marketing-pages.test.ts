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

// UX-2 P6 + P10, P10-9 (outline B, "button only"): the sentence renders on /project only; the band keeps the button.
for (const [where, s] of [['/project', () => PAGES['/project']]] as const) {
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

test('UX-2 P6 + P10 criterion 9 (P10-9): the home band shows "Get in touch" alone, to EXPRESS_INTEREST_URL, with no sentence beside it', () => {
  const text = pageText(BAND);
  assert.ok(!text.includes(CONTACT), 'the band still renders the contact sentence');
  const button = linksReading(BAND, 'Get in touch');
  assert.equal(button.length, 1, `"Get in touch" links in the band: ${button.length}`);
  assert.equal(attr(button[0], 'href'), EXPRESS_INTEREST_URL);
  assert.ok(hasClass(button[0], 'ui-button') && hasClass(button[0], 'ui-button-primary'), 'the button keeps ui-button ui-button-primary');
});

test('criterion 6, contact: the project page keeps its h2 "Contact us"', () => {
  assert.ok(headingTexts(PAGES['/project']).includes('Contact us'));
});

// --- Criterion 6: the noun rows ("analysis" stands; D1 A, D2 A, D7 A) -----------------

interface NounRow { where: string; surface: () => Surface; after: string[]; before: string[] }

const NOUN_ROWS: NounRow[] = [
  {
    // UX-2 P6 + P10: the band's cards take P10-5 and P10-7, and its limit line P10-4 (C1 = A).
    where: 'the home band (P10-4, P10-5, P10-7)',
    surface: () => BAND,
    after: [
      'Each published analysis lists its datasets, queries and model, and is signed so anyone can check it is unchanged.',
      'A signed analysis shows how an answer was produced. It does not claim the answer is correct.',
      'or sign in to publish it as a signed analysis.',
    ],
    before: ['the record is signed, so', 'The record shows how an answer was produced', 'publishable as a signed record'],
  },
  {
    where: '/project (page.tsx:32, :97, :120-121)',
    surface: () => PAGES['/project'],
    after: [
      "The analysis also discloses what didn't work",
      // UX-2 P6 + P10, P10-10 (C1 = A).
      'Once signed in, they can publish the result as a signed analysis.',
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
      // UX-2 P6 + P10, P10-36 (C1 = A; D-3).
      'Earlier analyses keep the model names recorded with them.',
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
      // UX-2 P6 + P10: D-16 (A) at :127-128 and :232-234, and P10-14 (C1 = A) in pillar 3.
      'A signed analysis shows how an answer was produced. It does not claim the answer is correct.',
      'Typed Standards is an open protocol for publishing an AI-generated answer as a signed record.',
      'records how that direction was decided.',
      'Each card links to the signed record, where everything stated here can be read and independently verified.',
      'The record shows how an answer was produced. It does not claim the answer is correct.',
    ],
  },
  {
    // UX-2 P6 + P10: the band's list moves to /project (P10-15; its items verbatim but P10-16's); the stack's and the
    // boundaries' lines leave with their blocks (P10-12 to P10-14; "Where the line is today" to the hub's ROADMAP.md).
    where: '/project, the moved list (P10-15, P10-16)',
    surface: () => PAGES['/project'],
    lines: [
      'signs, views and verifies records from a terminal.',
      'signs a record from Python or a notebook.',
      'serves signed records from a static site',
      'each relation is a signed record.',
      'checks any record package without relying on the site that published it.',
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

// --- UX-2 P5 (X30, RULED removal; R18 C: no status word on any reader surface) ---------
// The project page's verification-status prose (`project/page.tsx:234-237` at
// `71460c3`) leaves with no replacement; the sentence before it (`:232-234`,
// "A record documents how an answer was produced — it does not certify that the
// answer is correct.") stays.
test('UX-2 P5 X30: /project no longer describes a verification status, and keeps the sentence before it', () => {
  const text = pageText(PAGES['/project']);
  // UX-2 P6 + P10, D-16 (A): the sentence that stays takes the record's limit in P10-4's predicate.
  assert.ok(text.includes('The record shows how an answer was produced. It does not claim the answer is correct.'), 'premise: the sentence that stays');
  for (const gone of ['Each record page also shows a verification status', 'unverified', 'it is separate from the check of the record']) {
    assert.ok(!text.toLowerCase().includes(gone.toLowerCase()), `/project still reads "${gone}"`);
  }
});

// --- EVAL-OW P3 (#740, criteria 3 and 4): MiMo-V2.6-Flash on /learn -------------------
// The model section gains a fourth card. Each October 2026 figure stays an
// October figure, and the sentences that compared Haiku 5.5 with "the other
// two" and "the three" name what they compared it with. The card's retention
// sentences are what docs/model-evaluation-2026-11.md records for the three
// providers that served the run's MiMo-V2.6-Flash requests (its providers
// table, Cohere, GMICloud and Xiaomi; the Cohere and GMICloud conflicts).

const NOVEMBER_DOC = 'https://github.com/npstorey/civic-ai-tools-website/blob/main/docs/model-evaluation-2026-11.md';

const P3_LEARN_LINES = [
  // UX-2 P6 + P10, D-1 = C (P10-35's lead, re-drafted; W2's paste-ready words).
  'In October 2026 we ran nine AI models on 14 of the civic data questions first used in March. We scored every answer against a rubric. For the 11 questions that need data, we also checked the main answer against figures read directly from the portals. Three of the four models that led that run are the Claude models below. In November 2026 we ran two of them again on 15 questions, beside three open-weight models. We added the open-weight model that came closest to them on answer quality. The November run did not check answers against figures from the portals. This site offers the four models below:',
  'at about half a cent a question in that run: under a tenth of what Sonnet 5.5 and Opus 5.5 cost. It was also the fastest of those three, with a median of 15 seconds.',
  // UX-2 P6 + P10, D-2 = B (P10-35's card).
  'Stronger analysis at moderate cost. In the October 2026 run it got the main answer right on 9 of 11 questions. It cost about 11 cents a question and took a median of 21 seconds.',
  'It was the slowest of the three in that run (a median of 27 seconds) and costs about 21 cents a question: worth it for complex or multi-step questions.',
  'An open-weight model: its maker, Xiaomi, publishes the trained model itself, not only access to it. In the November 2026 run it came closest of the three open-weight models to the Claude models on answer quality, at about a third of a cent a question, the lowest cost in that run. It was also the slowest model in that run, with a median of about 25 seconds.',
  // OA-863 = B (#740 comment 6902575273): the routing allows only the three
  // providers that served the run's MiMo-V2.6-Flash requests.
  // UX-2 P6 + P10, D-10 (C4 = (b), "this site").
  'This site reaches it through OpenRouter, which passes each question to one of several companies that run the model. This site lets only three of those companies answer its questions: Cohere, GMICloud and Xiaomi. OpenRouter picks among the three for each question, and if none of them can take it, the question fails rather than going to another company.',
  'In the November 2026 run its questions went to three of those companies: Cohere, GMICloud and Xiaomi. OpenRouter lists all three as keeping the prompts they receive: Cohere and Xiaomi for 30 days, and GMICloud for a period it does not state.',
  // The seat's wording ruling (#740 comment 6899621098): "The evaluation
  // recorded two conflicts." (Cohere's provider-level 30 days agrees with its
  // own page; its conflict is with the endpoint listing, doc :290), and
  // GMICloud's own word, "categorizing" (doc :293).
  "The evaluation recorded two conflicts. For this model, OpenRouter also lists Cohere as keeping nothing, while Cohere's own page says prompts are kept for 30 days and then deleted, unless zero retention has been approved. GMICloud's console terms say it does not keep a customer's inputs after categorizing them unless the customer opts in to prompt logging, and which GMICloud agreement covers OpenRouter's traffic is not stated.",
  "Each listing and each company's own words are recorded in the November 2026 evaluation.",
];

const P3_LEARN_GONE = [
  'The demo offers three of the four models that led:',
  'The demo offers all four:',
  'with careful caveats',
  'under a tenth of what the other two cost',
  'It was also the fastest of the three, with',
  'It is the slowest of the three',
  'Two of those listings conflict with what the companies themselves publish.',
  'after sorting them',
  'The demo does not pick the company, and the companies that serve its questions can change.',
];

test('EVAL-OW P3: /learn carries a MiMo-V2.6-Flash card beside the Claude cards, in the ruled terms', () => {
  const s = PAGES['/learn'];
  const texts = headingTexts(s);
  assert.deepEqual(
    texts.filter((t) => /\((recommended|balanced|premium|open-weight)\)$/.test(t)),
    ['Claude Haiku 5.5 (recommended)', 'Claude Sonnet 5.5 (balanced)', 'Claude Opus 5.5 (premium)', 'MiMo-V2.6-Flash (open-weight)'],
  );
  const text = pageText(s);
  const missing = P3_LEARN_LINES.filter((line) => !text.includes(line));
  const stale = P3_LEARN_GONE.filter((line) => text.includes(line));
  assert.deepEqual({ missing, stale }, { missing: [], stale: [] });
  // The card links to the November document's providers section.
  const link = one(linksReading(s, 'the November 2026 evaluation'), 'a link reading "the November 2026 evaluation"');
  assert.equal(attr(link, 'href'), `${NOVEMBER_DOC}#the-providers-a8`);
});

// --- UX-2 P6 + P10 (#729): the signed-out pages' words, moves and claims ------------------------------------------------
// Contract p6p10.md v5.2: criteria 9 (the band), 10 (the moves, with top change 9 on /roadmap), 11 (every ruled sentence
// byte for byte), 14 ("demo" in reader text), 15 (the claims), and 16's conditions that a test can hold. The words of
// record are planning `temp/ux-2/words-batch/report.md` (P10-1 to P10-48, C1 = A, C4 = (b)) and
// `temp/ux-2/words-p6p10/` (D-1 to D-25, OA-917). A placeholder there is today's page text here (`<model family>` is the
// family the page names, `<platform>` the platform it names). The sources sentence (P10-11) is read from this process's
// statement (`buildFlowsStatement()`), never typed: its N and names, in the statement's order.
//
// WHAT MAKES IT ABLE TO FAIL. At the base every REVISE and every new item reads its earlier words; the band holds the
// eyebrow, the stack, the boundaries and the reuse list; /project holds three pillar cards and no setup section.
// BLIND SPOTS, stated. The hub's ROADMAP.md items (P10-22 to P10-29, D-19, D-25) ride in the hub patch (PQ7) and are not
// rendered here; the band's "one screen" and its columns are instrument 19's reads.

const { buildFlowsStatement: buildStatementP10 } = await import('@/lib/flows/statement');
const { readerSourceName: readerNameP10 } = await import('@/lib/sources/source-name');
const STATEMENT_P10 = await buildStatementP10();
const NAMES_P10 = STATEMENT_P10.sources.map((s) => readerNameP10(s));
const listed = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
/** P10-11, the site form: N and the names read from the statement (N = 1 the singular). */
const SOURCES_SENTENCE = NAMES_P10.length === 1
  ? `This site answers from 1 data source: ${NAMES_P10[0]}.`
  : `This site answers from ${NAMES_P10.length} data sources: ${listed(NAMES_P10)}.`;

const RUN_IT_YOURSELF = '/project#run-it-yourself';

// --- Criterion 9: the home page below the box ---------------------------------------------------------------------

const HOME_FILE = path.join(SRC, 'app', '(marketing)', 'page.tsx');
const sourceText = (file: string) => normalizeSource(fs.readFileSync(file, 'utf8').replace(/<[^>]+>/g, ' ').replace(/&mdash;/g, '—')).replace(/\s+/g, ' ');

test('UX-2 P6 + P10 criterion 9 (Q3 = A): the home page has no "Go deeper", neither of its sentences, and no "Get Started"', () => {
  const home = sourceText(HOME_FILE);
  for (const gone of ['Go deeper', 'This demo has rate limits and runs simple queries.', 'Get Started']) {
    assert.ok(!home.includes(gone), `(marketing)/page.tsx still holds "${gone}"`);
  }
});

const BAND_CARDS: Array<{ label: string; body: string; link: string; href: string }> = [
  { label: 'If you set policy', body: 'Each published analysis lists its datasets, queries and model, and is signed so anyone can check it is unchanged.', link: 'See published analyses', href: '/records' },
  { label: 'If you own a data function', body: 'This site shows AI answering from public data, with citations, sign-in and a record of every query. It is all open source.', link: 'What a city could run', href: '/project#three-pillars' },
  { label: 'If you analyze data', body: 'Ask a question against live public data and see every query the AI runs. Download the answer as a notebook, or sign in to publish it as a signed analysis.', link: 'Watch it in action', href: '/explore' },
];

test('UX-2 P6 + P10 criterion 9 (Q1 = B): the band holds no eyebrow, the headline, P10-4 as its next sibling, and none of the moved blocks', () => {
  const text = pageText(BAND);
  for (const gone of ['Beyond the demo', 'What another city could reuse', 'Where the line is today', 'What you can use', '1. Protocol', '3. City implementations']) {
    assert.ok(!text.includes(gone), `the band still reads "${gone}"`);
  }
  const headline = one(BAND.elements().filter((el) => /^h[1-6]$/.test(el.type)
    && plain(readText(el)) === 'Civic AI Tools is the civic reference implementation of Typed Standards — an open protocol for independent verification of AI-generated answers.'), 'the headline (P10-3)');
  const parent = BAND.elements().find((el) => childrenOf(el).includes(headline));
  assert.ok(parent, 'the headline has no parent');
  const siblings = childrenOf(parent!);
  const next = siblings[siblings.indexOf(headline) + 1];
  assert.ok(next, 'nothing follows the headline');
  assert.equal(plain(readText(next)), 'A signed analysis shows how an answer was produced. It does not claim the answer is correct.');
});

for (const card of BAND_CARDS) {
  test(`UX-2 P6 + P10 criterion 9: the band's card "${card.label}" reads its ruled words and ends in one link, "${card.link}", to ${card.href}`, () => {
    const label = one(BAND.elements().filter((el) => plain(readText(el)) === card.label && childrenOf(el).length === 0), `the card label "${card.label}"`);
    const box = BAND.elements().find((el) => childrenOf(el).includes(label));
    assert.ok(box, 'the card label has no card');
    assert.ok(plain(readText(box!)).includes(card.body), `the card reads: ${plain(readText(box!))}`);
    const cardLinks = within(box!).filter((el) => el.type === 'a');
    assert.deepEqual(cardLinks.map((a) => [plain(readText(a)), attr(a, 'href')]), [[card.link, card.href]]);
    const last = within(box!)[within(box!).length - 1];
    assert.ok(last === cardLinks[0] || within(cardLinks[0]).includes(last), 'the link is not the card\'s last element');
  });
}

test('UX-2 P6 + P10 criterion 9 (P10-8): the band\'s foot holds "Run it yourself" to /project\'s setup section and "Learn how it works" to /learn', () => {
  assert.deepEqual(linksReading(BAND, 'Run it yourself').map((a) => attr(a, 'href')), [RUN_IT_YOURSELF]);
  assert.deepEqual(linksReading(BAND, 'Learn how it works').map((a) => attr(a, 'href')), ['/learn']);
});

// --- Criterion 10: the moves --------------------------------------------------------------------------------------

test('UX-2 P6 + P10 criterion 10 (P10-12, P10-14): /project\'s "Three pillars" is one list of three', () => {
  const section = one(PAGES['/project'].elements().filter((el) => el.type === 'section' && attr(el, 'id') === 'three-pillars'), 'section#three-pillars');
  const lists = within(section).filter((el) => el.type === 'ul' || el.type === 'ol');
  assert.equal(lists.length, 1, `lists in the pillars section: ${lists.length}`);
  const items = childrenOf(lists[0]).filter((el) => el.type === 'li');
  assert.equal(items.length, 3, `pillars: ${items.length}`);
  assert.ok(plain(readText(items[1])).includes('The reference implementation shows what a government could run.'), 'pillar 2 is not P10-12');
  assert.ok(plain(readText(items[2])).includes('Typed Standards is an open protocol for publishing an AI-generated answer as a signed record.'), 'pillar 3 is not P10-14');
});

const MOVED_LIST = [
  'A command line. npm install -g @typedstandards/cli signs, views and verifies records from a terminal.',
  'Python and notebooks. pip install typedstandards signs a record from Python or a notebook.',
  'Your own host. @typedstandards/host-core serves signed records from a static site, and a template does it on GitHub Pages.',
  'A live example. core-satellite.typedstandards.org maps how the standard relates to public projects; each relation is a signed record.',
  'An independent check. The verifier checks any record package without relying on the site that published it.',
  'Your own data connector. npx -y socrata-mcp-server --stdio runs the open-source Socrata server on your machine, so an MCP client such as Claude Desktop can query any Socrata open-data portal.',
];

test('UX-2 P6 + P10 criterion 10 (P10-15, P10-16): /project holds the moved list under its re-dated heading, five items verbatim and P10-16', () => {
  assert.ok(headingTexts(PAGES['/project']).includes('What you can use (last checked November 2026)'), `headings: ${JSON.stringify(headingTexts(PAGES['/project']))}`);
  const items = PAGES['/project'].elements().filter((el) => el.type === 'li').map((el) => plain(readText(el)));
  assert.deepEqual(MOVED_LIST.filter((line) => !items.includes(line)), [], 'moved items missing');
});

test('UX-2 P6 + P10 criterion 10 (P10-17, P10-18; Q3 = P): /project holds the setup section, #run-it-yourself, the band\'s and /learn\'s target', () => {
  const section = one(PAGES['/project'].elements().filter((el) => attr(el, 'id') === 'run-it-yourself'), '#run-it-yourself');
  const text = plain(readText(section));
  assert.ok(within(section).some((el) => /^h[23]$/.test(el.type) && plain(readText(el)) === 'Run it yourself'), 'the section\'s heading is not "Run it yourself"');
  for (const line of [
    'You can run the data connector on your own computer, with any AI assistant that supports MCP (Model Context Protocol). This site\'s daily question limit does not apply there.',
    'Not every AI assistant supports MCP. The MCP documentation lists the ones that do.',
  ]) assert.ok(text.includes(line), `the setup section lacks: ${line}`);
});

test('UX-2 P6 + P10 criterion 10 (P10-19, P10-20): /learn and /about keep one link each to the setup, and none of its text', () => {
  const learnText = pageText(PAGES['/learn']);
  assert.ok(learnText.includes('To run these tools on your own computer, see Run it yourself on the project page.'), '/learn lacks P10-19');
  assert.ok(!headingTexts(PAGES['/learn']).includes('Set Up Locally'), '/learn still holds the setup section');
  assert.ok(!learnText.includes('does not currently support MCP natively'), '/learn still holds the clients note');
  const aboutText = pageText(PAGES['/about']);
  assert.ok(aboutText.includes('To run these tools on your own computer, see Run it yourself on the project page.'), '/about lacks P10-20');
  for (const gone of ['Install it from npm with', 'Clone the repo and connect it to']) assert.ok(!aboutText.includes(gone), `/about still reads "${gone}"`);
  for (const route of ['/learn', '/about']) {
    assert.deepEqual(linksReading(PAGES[route], 'Run it yourself').map((a) => attr(a, 'href')), [RUN_IT_YOURSELF], `${route}: the link`);
  }
});

test('UX-2 P6 + P10 criterion 10 (top change 9, site Q6 = A): /roadmap\'s audience cards sit above the document', () => {
  const texts = PAGES['/roadmap'].elements().map((el) => plain(readText(el)));
  const strip = texts.findIndex((t) => t.startsWith('For deeper, audience-specific detail'));
  const doc = PAGES['/roadmap'].elements().findIndex((el) => el.type === 'h2');
  assert.ok(strip >= 0 && doc >= 0, `premise: the strip (${strip}) and the document's first h2 (${doc}) render`);
  assert.ok(strip < doc, 'the audience strip renders after the document');
});

// --- Criterion 11: every ruled sentence, byte for byte -------------------------------------------------------------

interface WordsRow { item: string; where: () => Surface; text: string }
const WORDS: WordsRow[] = [
  { item: 'P10-4 / D-16 (:127-128)', where: () => PAGES['/project'], text: 'A signed analysis shows how an answer was produced. It does not claim the answer is correct.' },
  { item: 'P10-10 with P10-11', where: () => PAGES['/project'], text: `Civic AI Tools is an open-source project built around that idea. Anyone can ask a plain-language question against live public data and watch every query the AI runs. Once signed in, they can publish the result as a signed analysis. ${SOURCES_SENTENCE}` },
  { item: 'P10-12', where: () => PAGES['/project'], text: 'The reference implementation shows what a government could run. It answers from public data, with citations, sign-in, a daily question limit and a record of every query. A city could run the same open-source software against its own data portals.' },
  { item: 'P10-14', where: () => PAGES['/project'], text: 'Typed Standards is an open protocol for publishing an AI-generated answer as a signed record. Anyone can check a record without trusting the site that published it. Open-source software implements it: this website, the data connectors and the verification library this site shares with the independent verifier. Civic AI Tools is one site built on it; other sectors can run their own. The roadmap records how that direction was decided.' },
  { item: 'P10-21', where: () => PAGES['/project'], text: 'Members of the consortium that supports the Typed Standards ecosystem.' },
  { item: 'D-16 (:232-234)', where: () => PAGES['/project'], text: 'The record shows how an answer was produced. It does not claim the answer is correct.' },
  { item: 'P10-30', where: () => PAGES['/learn'], text: 'The home page asks one AI model the same question twice. Once it answers from its training alone; once it reads live public data through MCP, the Model Context Protocol.' },
  { item: 'D-5', where: () => PAGES['/learn'], text: 'This is visible in the step-by-step progression users see on this site: the AI searches for datasets, examines their structure, then constructs targeted queries rather than trying to retrieve everything at once.' },
  { item: 'D-6', where: () => PAGES['/learn'], text: 'In this site\'s results, expand “How was the AI guided?” to see the specific instructions and domain knowledge that shaped the AI\'s approach to your question.' },
  { item: 'P10-32 (with P10-11)', where: () => PAGES['/learn'], text: `When you ask a question here, the AI searches catalogs of public datasets, examines their structure, then runs targeted queries. Each step is a tool call from the AI to a data source, which reads the data behind it. ${SOURCES_SENTENCE}` },
  { item: 'P10-33', where: () => PAGES['/learn'], text: 'Every AI answer is shaped by instructions most readers never see. Before your question, the AI here is given knowledge about datasets and a set of rules. One of the rules: report only what the data tools return, and never invent data.' },
  { item: 'C4 (b), :296-297', where: () => PAGES['/learn'], text: 'You can see a summary of these instructions under each answer that used data tools. Look for the “How was the AI guided?” section.' },
  { item: 'D-7', where: () => PAGES['/learn'], text: 'On this site, click “How is this narration generated?” near the step summary to see this explanation in context.' },
  { item: 'P10-34', where: () => PAGES['/learn'], text: 'Browser (this site) Quick questions, exploration A daily question limit' },
  { item: 'D-8', where: () => PAGES['/learn'], text: 'This site uses a fresh context for each query, maximizing room for reasoning.' },
  { item: 'D-1 = C', where: () => PAGES['/learn'], text: 'In October 2026 we ran nine AI models on 14 of the civic data questions first used in March. We scored every answer against a rubric. For the 11 questions that need data, we also checked the main answer against figures read directly from the portals. Three of the four models that led that run are the Claude models below. In November 2026 we ran two of them again on 15 questions, beside three open-weight models. We added the open-weight model that came closest to them on answer quality. The November run did not check answers against figures from the portals. This site offers the four models below:' },
  { item: 'D-9', where: () => PAGES['/learn'], text: 'The model this site starts on.' },
  { item: 'D-2 = B', where: () => PAGES['/learn'], text: 'Stronger analysis at moderate cost. In the October 2026 run it got the main answer right on 9 of 11 questions. It cost about 11 cents a question and took a median of 21 seconds.' },
  { item: 'D-10', where: () => PAGES['/learn'], text: 'This site reaches it through OpenRouter, which passes each question to one of several companies that run the model. This site lets only three of those companies answer its questions: Cohere, GMICloud and Xiaomi.' },
  { item: 'P10-36 (D-3)', where: () => PAGES['/learn'], text: 'When an author publishes an analysis they had kept private, a second model first reviews it against a fixed checklist. The reviewer is the first model on this site\'s list of reviewers that did not write the analysis. Earlier analyses keep the model names recorded with them.' },
  { item: 'P10-37', where: () => PAGES['/learn'], text: 'Even with live data access, AI answers can contain errors. With civic data questions, common failure patterns include:' },
  { item: 'D-11', where: () => PAGES['/learn'], text: 'Try these queries on the home page to see different capabilities:' },
  { item: 'P10-19', where: () => PAGES['/learn'], text: 'To run these tools on your own computer, see Run it yourself on the project page.' },
  { item: 'P10-39', where: () => PAGES['/about'], text: 'Civic AI Tools is the civic reference implementation of Typed Standards, an open protocol for independent verification of AI-generated answers. You ask a plain-language question, and the AI answers it from live public data. Once signed in, you can publish the answer as a signed analysis. A signed analysis shows how an answer was produced. It does not claim the answer is correct.' },
  { item: 'P10-40 with P10-11', where: () => PAGES['/about'], text: `${SOURCES_SENTENCE} The directory lists many more connectors for civic data. The civic-ai-tools starter project packages what you need to run the same kind of analysis on your own computer:` },
  { item: 'P10-41 (first part)', where: () => PAGES['/about'], text: 'The Socrata connector — this project\'s connector for open-data portals on Socrata, and one of this site\'s data sources. Browse the directory to see the' },
  { item: 'P10-42 (around its placeholder)', where: () => PAGES['/about'], text: 'Curated directory — a growing directory of data connectors for civic and government data, including official ones from' },
  { item: 'P10-42 (its end)', where: () => PAGES['/about'], text: 'The starter project sets up two of them. Know of one that should be listed? Get in touch.' },
  { item: 'P10-43', where: () => PAGES['/about'], text: 'This website — the reference implementation, where you can ask a question and watch the AI query live data. Signed in, you can also publish the answer. If you want to use it in teaching, get in touch.' },
  { item: 'P10-44', where: () => PAGES['/about'], text: 'Signed analyses — each published answer is a signed record of its queries, data sources and model. It says where something was not recorded.' },
  { item: 'P10-46', where: () => PAGES['/about'], text: 'The Learn page explains how these tools work and where they fail.' },
  { item: 'P10-47 (first part)', where: () => PAGES['/about'], text: 'Civic AI Tools is part of a growing ecosystem of projects connecting AI to government data. The directory lists' },
  { item: 'P10-47 (its middle)', where: () => PAGES['/about'], text: 'connectors for civic data. Our landscape research (April 2026) also found official government connectors from' },
  { item: 'P10-47 (its end)', where: () => PAGES['/about'], text: 'pilot in which query accuracy rose from near 0% to 95% with MCP, the Model Context Protocol.' },
  { item: 'P10-20', where: () => PAGES['/about'], text: 'To run these tools on your own computer, see Run it yourself on the project page.' },
  { item: 'D-24', where: () => PAGES['/roadmap'], text: 'This site. Try a query; publish an analysis as a signed record.' },
];

for (const row of WORDS) {
  test(`UX-2 P6 + P10 criterion 11: ${row.item} renders byte for byte`, () => {
    assert.ok(pageText(row.where()).includes(row.text), `not rendered: ${row.text}`);
  });
}

test('UX-2 P6 + P10 criterion 11 (P10-41, P10-47): the directory\'s counts in /about\'s lines are read from the data', () => {
  const text = pageText(PAGES['/about']);
  const servers = JSON.parse(DIRECTORY_SNAPSHOT).length;
  assert.ok(text.includes(`Browse the directory to see the ${servers} connectors it lists and the `), 'P10-41: the server count');
  assert.ok(text.includes(`The directory lists ${servers} connectors for civic data.`), 'P10-47: the server count');
});

test('UX-2 P6 + P10 criterion 11 (P10-38, C4 = (b)): both footer links read "← Ask a question" and go to /', () => {
  for (const route of ['/learn', '/about']) {
    assert.deepEqual(linksReading(PAGES[route], '← Ask a question').map((a) => attr(a, 'href')), ['/'], `${route}: the footer link`);
  }
});

test('UX-2 P6 + P10 criterion 11 (D-4): /learn\'s description reads "this site"', () => {
  const description = String((learn as unknown as { metadata: { description?: unknown } }).metadata.description ?? '');
  assert.equal(description, 'Learn how this site works, how AI connects to live civic data through MCP, and what shapes the quality of AI responses.');
});

test('UX-2 P6 + P10 criterion 11 (D-17, D-18, P10-33): the ruled links', () => {
  const verifier = linksReading(PAGES['/project'], 'the independent verifier');
  assert.equal(verifier.length, 1, '"the independent verifier" is not a link on /project');
  assert.match(String(attr(verifier[0], 'href')), /\/verify$/, 'D-18: the link is not the moved list\'s verifier address');
  assert.deepEqual(linksReading(PAGES['/project'], 'The verifier').map((a) => attr(a, 'href')), [attr(verifier[0], 'href')], 'D-18: the two verifier links part');
  assert.equal(linksReading(PAGES['/learn'], 'Read the full instructions').length, 1, 'P10-33: the link');
});

test('UX-2 P6 + P10 criterion 11 (P10-48): the /records lede reads its ruled words (source read; the page reads the database)', () => {
  const lede = sourceText(path.join(SRC, 'app', '(app)', 'evidence', 'page.tsx'));
  assert.ok(lede.includes('Published analyses of civic data, made with AI assistance. Each one records its queries, data sources and model, and says where something was not recorded. Anyone can check that an analysis is unchanged.'), 'P10-48 is not in the page');
});

test('UX-2 P6 + P10 criterion 11 (D-22, D-23): the two limits lines read "this site" (source read; they render mid-run)', () => {
  const live = sourceText(path.join(SRC, 'components', 'explore', 'LiveResponsePanel.tsx'));
  assert.ok(live.includes('This query is taking longer than usual. Complex queries on this site are subject to token and tool-call limits — the analysis may be cut short.'), 'D-22');
  const notice = sourceText(path.join(SRC, 'components', 'shared', 'McpResponseDisplay.tsx'));
  assert.ok(notice.includes('Analysis may be incomplete. This site has token and tool-call limits that can cut short complex queries.'), 'D-23');
});

const GONE: Array<[string, () => Surface, string]> = [
  ['the "Model Selection" card (item 13, top change 7)', () => PAGES['/learn'], 'lets you compare different models on the same query'],
  ['the second hallucination passage (P10-37)', () => PAGES['/learn'], 'In AI research, this is called'],
  ['the instructions excerpts (P10-33, top change 6)', () => PAGES['/learn'], 'Known datasets and fields'],
  ['P10-45', () => PAGES['/about'], 'without the token limits of the web demo'],
];
for (const [what, where, line] of GONE) {
  test(`UX-2 P6 + P10 criterion 11: ${what} is cut`, () => {
    assert.ok(!pageText(where()).includes(line), `still rendered: ${line}`);
  });
}

// --- Criterion 14: "demo" in reader text (C4 = (b); 0d item 5) -----------------------------------------------------

const P10_FILES = [
  'app/(marketing)/page.tsx', 'components/home/PositioningBand.tsx', 'components/ContactCallToAction.tsx', 'app/(marketing)/project/page.tsx',
  'app/(marketing)/learn/page.tsx', 'app/(marketing)/about/page.tsx', 'app/(marketing)/layout.tsx', 'app/(app)/evidence/page.tsx',
  // Item 22's four files (v3).
  'components/NarrationExplainer.tsx', 'components/explore/LiveResponsePanel.tsx', 'components/shared/McpResponseDisplay.tsx',
  'components/roadmap/AudienceRoutingStrip.tsx',
];

/** The reader text of a source: JSX text and string literals, comments dropped, a URL or a path not read. */
function readerStrings(file: string, source: string = fs.readFileSync(file, 'utf8')): Array<{ line: number; text: string }> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Array<{ line: number; text: string }> = [];
  const push = (node: ts.Node, text: string) => {
    if (/^(https?:|\/|\.|@\/)/.test(text.trim()) || /:\/\//.test(text)) return;
    out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isJsxText(node)) push(node, node.text);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) push(node, node.text);
    else if (ts.isTemplateExpression(node)) push(node, node.getText(sf));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

test('UX-2 P6 + P10 criterion 14 (instrument): the reader-text reader skips a comment and a URL, and reads a JSX text', () => {
  const decoy = "// the demo\nconst a = <a href=\"https://demo.example.org/\">the demo</a>;\n/* demo */\n";
  assert.deepEqual(readerStrings('decoy.tsx', decoy).filter((s) => /\bdemo\b/i.test(s.text)).map((s) => s.line), [2]);
});

test('UX-2 P6 + P10 criterion 14 (C4 = (b)): "demo" as a whole word appears in no P10 file\'s reader text, nor in item 22\'s four', () => {
  const found = P10_FILES.flatMap((rel) => readerStrings(path.join(SRC, rel)).filter((s) => /\bdemo\b/i.test(s.text)).map((s) => `${rel}:${s.line}`));
  assert.deepEqual([...new Set(found)], []);
});

// --- Criterion 15: the claims (Q7 = A; 0d item 4) ------------------------------------------------------------------

test('UX-2 P6 + P10 criterion 15: no P10 file holds a claim the reports could not confirm', () => {
  const CLAIMS = ['runs simple queries', 'unlimited access', 'more data sources', 'actual SoQL', 'publishes it to a GitHub Pages site', '(October 2026)', 'analysts stay in the loop', 'permanently records', 'permanently labeled'];
  const found: string[] = [];
  for (const rel of P10_FILES.slice(0, 8)) {
    const text = normalizeSource(fs.readFileSync(path.join(SRC, rel), 'utf8'));
    for (const claim of CLAIMS) if (text.includes(claim)) found.push(`${rel}: ${claim}`);
  }
  assert.deepEqual(found, []);
});

// --- Criterion 16: the conditions a test can hold -------------------------------------------------------------------

test('UX-2 P6 + P10 criterion 16 (P10-32): its last sentence ships only where the statement lists two sources or more', () => {
  const sentence = 'Tool calls are routed by name, so one answer can combine data from more than one source.';
  assert.equal(pageText(PAGES['/learn']).includes(sentence), NAMES_P10.length >= 2, `N = ${NAMES_P10.length}`);
  assert.ok(pageText(PAGES['/learn']).includes(SOURCES_SENTENCE), 'premise: P10-32 renders the sources sentence');
});

test('UX-2 P6 + P10 criterion 16 (NOTE 15): P10-7, P10-10, P10-39 and P10-43 each say that publishing needs sign-in', () => {
  const lines: Array<[string, () => Surface, string]> = [
    ['P10-7', () => BAND, 'or sign in to publish it as a signed analysis.'],
    ['P10-10', () => PAGES['/project'], 'Once signed in, they can publish the result as a signed analysis.'],
    ['P10-39', () => PAGES['/about'], 'Once signed in, you can publish the answer as a signed analysis.'],
    ['P10-43', () => PAGES['/about'], 'Signed in, you can also publish the answer.'],
  ];
  assert.deepEqual(lines.filter(([, where, line]) => !pageText(where()).includes(line)).map(([item]) => item), []);
});

test('UX-2 P6 + P10 criterion 16 (P10-33): its third sentence\'s rule is in the instructions its link opens (the pinned router\'s Socrata guidance)', async () => {
  assert.ok(pageText(PAGES['/learn']).includes('One of the rules: report only what the data tools return, and never invent data.'), 'P10-33 is not rendered');
  const router = fs.readFileSync(path.join(REPO, 'node_modules', '@typedstandards', 'civic-typed-router', 'dist', 'civic', 'socrata.js'), 'utf8');
  assert.ok(router.includes('Never hallucinate data — only report what tool calls return'), 'the rule is not in the instructions');
});

test('UX-2 P6 + P10 criterion 16 (D-15): the statement lists at least one source on an instance with none configured', () => {
  assert.ok(STATEMENT_P10.sources.length >= 1, `sources: ${STATEMENT_P10.sources.length}`);
});
