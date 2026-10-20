// R6 W3 (#632), criteria 4, 12 (the plan item), 13 and 15 (Q8): the privacy
// page's consent items, rendered, and the derived guard over them.
//
// WHAT W3 ADDS TO THE PAGE (#516 P7's items 3's cookie, 7, 10, 11's sentence
// and 12; design §4.7; C5):
//   - the consent sections, the owner's text (a candidate until R6 G7, in
//     `src/lib/sources/copy.ts`), each a heading and traced statements;
//   - the consent cookie by name (`CONSENT_COOKIE_NAME`), rendered whether or
//     not sign-in is configured: the cookie is set for anonymous readers too
//     (G0 premise 13), and the page says what it names (Q8);
//   - one row per configured source, derived from the flows statement
//     `/api/flows` serves: the source's name, its publisher, where it runs,
//     what its log holders say they keep, and how current its data is;
//   - the change log's address (`docs/flows-changelog.md`), where the
//     instance names its repository;
//   - the consent row among what the site keeps for a signed-in account (the
//     states, the flows statement they refer to, and the dates);
//   - "which plan this site's hosting account is on" among the operator's to
//     state, and the two operator items the held statements now cover (what
//     the hosting platform records of each visit; what it keeps of each
//     notebook run and data source) given way to those statements.
//
// THE GUARD (C5), two-way, as `src/lib/privacy-recipients.test.ts` is for the
// recipients: every fact below has its row on the page and every consent row
// on the page has its fact — the source rows against the flows statement's
// sources, the cookie against `CONSENT_COOKIE_NAME`, the change log against
// the file. It is shown failing on fixtures: a row removed, and a row whose
// fact is gone, each reported by name.
//
// WHAT IS DRIVEN. The real page and facts module, rendered to static markup
// under `node --test` with the hooks `privacy-page.test.ts` uses.
//
// WHAT MAKES IT ABLE TO FAIL. At the base none of these rows is on the page.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
// Typed here because the installed `@types/node` predates `registerHooks`.
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', '..');
const REPO = path.resolve(SRC, '..');
const SCRIPT_STUB_URL = pathToFileURL(path.join(SRC, '__civic-r6-w3-next-script-stub.mjs')).href;
const SCRIPT_STUB = `
  import { createElement } from 'react';
  export default function Script(props) {
    const { children, strategy, ...rest } = props;
    const inner = typeof children === 'string' ? { dangerouslySetInnerHTML: { __html: children } } : {};
    return createElement('script', { ...rest, 'data-strategy': strategy, ...inner });
  }`;

function firstFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}
const candidatesFor = (base: string) => [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/script') return { url: SCRIPT_STUB_URL, format: 'module', shortCircuit: true };
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`privacy consent test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && parent?.startsWith('file:') && fileURLToPath(parent).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(parent)), specifier)));
      if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl === SCRIPT_STUB_URL) return { format: 'module', source: SCRIPT_STUB, shortCircuit: true };
    if (loadUrl.startsWith('file:')) {
      const file = fileURLToPath(loadUrl);
      if (file.startsWith(SRC) && /\.tsx?$/.test(file)) {
        const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          fileName: file,
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        });
        return { format: 'module', source: out.outputText, shortCircuit: true };
      }
    }
    return nextLoad(loadUrl, context);
  },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const { default: PrivacyPage } = (await import('./page.tsx')) as unknown as { default: ComponentType };
const facts = (await import(pathToFileURL(path.join(SRC, 'lib', 'privacy-facts.ts')).href)) as Mod;
const consent = (await import(pathToFileURL(path.join(SRC, 'lib', 'sources', 'consent.ts')).href)) as Mod;
const flows = (await import(pathToFileURL(path.join(SRC, 'lib', 'flows', 'statement.ts')).href)) as Mod;
const { ENV_SPEC } = (await import(pathToFileURL(path.join(REPO, 'scripts', 'preflight-env.mjs')).href)) as Mod;

/** The copy W3 adds (a specifier typed `string`, so the red commit type-checks). */
const COPY: string = '@/lib/sources/copy';
const copy = (await import(COPY).catch(() => null)) as Mod | null;

const DECLARED: string[] = (ENV_SPEC as Array<{ name: string }>).map((row) => row.name);

// --- Configurations -------------------------------------------------------------

function withEnv<T>(config: Record<string, string>, run: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const name of [...DECLARED, 'http_proxy', 'https_proxy', 'no_proxy', ...Object.keys(config)]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  Object.assign(process.env, { RATE_LIMIT_SECRET: 'fixture' }, config);
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const REPO_URL = 'https://example.test/fixture/repo';
const CONFIGS: Record<string, Record<string, string>> = {
  // No sign-in, no database, no repository: the consent cookie is still set for an anonymous reader.
  default: {},
  // Sign-in, a database, a repository, every hosting kind, and the platform.
  full: {
    SITE_BRAND_REPO_URL: REPO_URL,
    GITHUB_CLIENT_ID: 'fixture',
    GITHUB_CLIENT_SECRET: 'fixture',
    DATABASE_URL: 'fixture',
    SOCRATA_MCP_URL: 'https://socrata.example.test',
    BOSTON_OPENCONTEXT_MCP_URL: 'https://boston.example.test',
    NYC_CHARTER_HOSTING: 'sandbox',
    VERCEL_ENV: 'production',
  },
};

interface Rendered { html: string; statement: Mod }
const RENDERED: Record<string, Rendered> = Object.fromEntries(
  Object.entries(CONFIGS).map(([name, config]) => [
    name,
    withEnv(config, () => ({ html: renderToStaticMarkup(createElement(PrivacyPage)), statement: flows.buildFlowsStatementFor(null) })),
  ]),
);

function text(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

interface TracedElement { id: string; traces: string[]; text: string; html: string }
function statements(html: string): TracedElement[] {
  return [...html.matchAll(/<(p|div)[^>]*data-statement="([^"]*)"[^>]*data-trace="([^"]*)"[^>]*>(.*?)<\/\1>/g)].map((m) => ({
    id: m[2],
    traces: m[3].split(' ').filter(Boolean),
    text: text(m[4]),
    html: m[4],
  }));
}
const headings = (html: string) => [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => text(m[1]));

// --- The guard (C5): each consent fact has its row, and each row its fact ---------------

const SOURCE_ROW = 'source-row-';
const COOKIE_TRACE = 'const:src/lib/sources/consent.ts#CONSENT_COOKIE_NAME';
const CHANGELOG = 'docs/flows-changelog.md';

/**
 * The facts a page must carry and the rows it carries, compared both ways:
 * `unstated` is a fact with no row, `unmatched` a consent row with no fact.
 */
function consentDrift(html: string, statement: Mod): { unstated: string[]; unmatched: string[] } {
  const rows = statements(html);
  const facts: string[] = [
    ...(statement.sources as Array<{ sourceId: string }>).map((s) => `${SOURCE_ROW}${s.sourceId}`),
    `cookie:${consent.CONSENT_COOKIE_NAME}`,
  ];
  const present: string[] = [
    ...rows.filter((r) => r.id.startsWith(SOURCE_ROW)).map((r) => r.id),
    ...rows.filter((r) => r.traces.includes(COOKIE_TRACE) && r.text.includes(consent.CONSENT_COOKIE_NAME)).map(() => `cookie:${consent.CONSENT_COOKIE_NAME}`),
  ];
  return { unstated: facts.filter((f) => !present.includes(f)), unmatched: [...new Set(present)].filter((p) => !facts.includes(p)) };
}

for (const name of Object.keys(CONFIGS)) {
  test(`criterion 4 (${name}): the guard finds every consent fact on the page, and no consent row without its fact`, () => {
    assert.deepEqual(consentDrift(RENDERED[name].html, RENDERED[name].statement), { unstated: [], unmatched: [] });
  });
}

test('criterion 4: the guard reports a source row removed from the page, and a row whose source is gone, by name', () => {
  const { html, statement } = RENDERED.full;
  const row = statements(html).find((s) => s.id === `${SOURCE_ROW}data-commons`);
  assert.ok(row, 'premise: the page has a row for Data Commons');
  const removed = html.replace(new RegExp(`<(p|div)[^>]*data-statement="${SOURCE_ROW}data-commons"[^>]*>.*?</\\1>`), '');
  assert.deepEqual(consentDrift(removed, statement).unstated, [`${SOURCE_ROW}data-commons`]);
  const gone = { ...statement, sources: statement.sources.filter((s: { sourceId: string }) => s.sourceId !== 'nyc-charter') };
  assert.deepEqual(consentDrift(html, gone).unmatched, [`${SOURCE_ROW}nyc-charter`]);
});

// --- Criterion 4: each source's row, from the flows statement ------------------------------

/** T13 (#632 G7): each source's one reader name, written out. */
const READER_NAME: Record<string, string> = { socrata: 'Socrata', 'data-commons': 'Data Commons', 'boston-opencontext': 'Boston OpenContext', 'nyc-charter': 'NYC Charter, Laws and Rules' };

test('criterion 4 (full): each source\'s row gives its name, publisher, where it runs, what its holders say they keep, and its freshness', () => {
  const { html, statement } = RENDERED.full;
  for (const source of statement.sources as Array<{ sourceId: string; displayName: string; publisher: string; freshness: string; recipients: Array<{ keptBy: Array<{ holder: string; keeps: string }> }> }>) {
    const row = statements(html).find((s) => s.id === `${SOURCE_ROW}${source.sourceId}`);
    assert.ok(row, `no row for ${source.sourceId}`);
    assert.ok(row!.text.includes(READER_NAME[source.sourceId]), `${source.sourceId}'s row does not name it ${READER_NAME[source.sourceId]}`);
    assert.ok(row!.text.includes(source.publisher), `${source.sourceId}'s row does not name its publisher (${source.publisher})`);
    assert.ok(/, running at [^.]/.test(row!.text), `${source.sourceId}'s row does not say where it runs (", running at")`);
    assert.ok(row!.text.includes(source.freshness), `${source.sourceId}'s row does not say how current its data is`);
    for (const k of source.recipients.flatMap((r) => r.keptBy)) {
      assert.ok(row!.text.includes(k.holder), `${source.sourceId}'s row does not name ${k.holder}`);
      if (k.keeps === 'not-stated') assert.ok(row!.text.includes('not stated'), `${source.sourceId}: ${k.holder}'s posture does not read "not stated"`);
    }
    assert.ok(row!.traces.some((t) => t.startsWith('const:src/lib/flows/statement.ts#')), `${source.sourceId}'s row is not traced to the flows statement`);
  }
});

// --- Criterion 13 and Q8: the consent cookie, named, with or without sign-in ----------------

for (const name of Object.keys(CONFIGS)) {
  test(`criterion 13, Q8 (${name}): the page names the consent cookie, ${consent.CONSENT_COOKIE_NAME}`, () => {
    const named = statements(RENDERED[name].html).filter((s) => s.html.includes(`<code`) && s.text.includes(consent.CONSENT_COOKIE_NAME));
    assert.equal(named.length, 1, `${name}: the page does not name the consent cookie`);
    assert.ok(named[0].traces.includes(COOKIE_TRACE), `${name}: the cookie's name is not traced to CONSENT_COOKIE_NAME`);
  });
}

// --- Criterion 4: the consent sections, the change log -----------------------------------------

for (const name of Object.keys(CONFIGS)) {
  test(`criterion 4 (${name}): the page carries the consent sections, each heading and each sentence traced`, () => {
    assert.ok(copy && Array.isArray(copy.PRIVACY_CONSENT_SECTIONS), `${COPY} exports no PRIVACY_CONSENT_SECTIONS`);
    const html = RENDERED[name].html;
    const shown = headings(html);
    const traced = statements(html).filter((s) => s.traces.some((t) => t.startsWith('const:src/lib/sources/copy.ts#')));
    for (const section of copy!.PRIVACY_CONSENT_SECTIONS as Array<{ heading: string; sentences: string[] }>) {
      assert.ok(shown.includes(section.heading), `${name}: no "${section.heading}" heading`);
      for (const sentence of section.sentences) {
        assert.ok(traced.some((s) => s.text.includes(sentence)), `${name}: "${section.heading}" does not say: ${sentence}`);
      }
    }
    assert.ok(text(html).includes(copy!.NO_GUIDE_SENTENCE), `${name}: with no guide address, the page does not say so`);
  });
}

test('criterion 4 (full): the page links the dated change log, kept with the code', () => {
  const links = [...RENDERED.full.html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.some((href) => href.startsWith(REPO_URL) && href.endsWith(CHANGELOG)), `the page does not link ${CHANGELOG} in the repository: ${links.join(', ')}`);
  assert.ok(fs.existsSync(path.join(REPO, CHANGELOG)), `premise: ${CHANGELOG} exists`);
});

// --- Criterion 13: what the site keeps, and what is the operator's to state -----------------------

test('criterion 13 (full): what the site keeps for an account includes the consent: the states, the statement they refer to, and the dates', () => {
  const items = facts.ALSO_KEPT_ITEMS as string[];
  const item = items.find((i) => /consent/i.test(i));
  assert.ok(item, `ALSO_KEPT_ITEMS has no consent row: ${JSON.stringify(items)}`);
  assert.match(item!, /On, Ask first or Off|state/i, 'the consent row does not say it keeps the states');
  assert.match(item!, /statement/i, 'the consent row does not say it keeps the flows statement');
  assert.match(item!, /date/i, 'the consent row does not say it keeps the dates');
  const kept = statements(RENDERED.full.html).find((s) => s.id === 'also-kept');
  assert.ok(kept?.text.includes(item!), 'the page does not render the consent row');
  assert.ok(kept!.traces.includes('const:src/lib/db/schema.ts#sourceConsents'), 'the consent row is not traced to its table');
});

test('criterion 13: the operator items the held statements now cover give way to them, and each held statement names its holder and source', () => {
  const items = facts.OPERATOR_STATES_ITEMS as string[];
  assert.ok(!items.some((i) => /records about each visit/.test(i)), 'the hosting platform\'s records of each visit are still the operator\'s to state');
  assert.ok(!items.some((i) => /keeps of each notebook run and each data source/.test(i)), 'the platform\'s keeping of notebook runs and sources is still the operator\'s to state');
  const held = statements(RENDERED.full.html).filter((s) => s.id.startsWith('held-'));
  assert.deepEqual(held.map((s) => s.id).sort(), ['held-function-logs-vercel', 'held-sandbox-platform-nyc-charter'], 'premise: both held statements render under the full configuration');
  for (const s of held) {
    assert.ok(s.text.includes('Vercel'), `${s.id} does not name its holder`);
    assert.ok(/<a [^>]*href="https:\/\/vercel\.com\//.test(s.html), `${s.id} does not link its source`);
  }
});

test('criterion 12: which plan this site\'s hosting account is on joins what is the operator\'s to state', () => {
  const items = facts.OPERATOR_STATES_ITEMS as string[];
  assert.ok(items.some((i) => /which plan this site's hosting account is on/i.test(i) && /logs/i.test(i)), `no plan item: ${JSON.stringify(items)}`);
});

// --- R6 PL (D1 = A, D2 = A): what each source is, and whose connector reaches it ----------------
//
// The owner's rulings (R6 PL, 2026-10-20). Each source's row reads "<name>:
// <what-line as stored> This site reaches it through an MCP server, a
// connector that <publisher> publishes, running at <where>. Who holds its
// logs: …", the publisher's name a link to the connector's repository; the
// what-line is printed as stored, so a proper noun keeps its capital and a
// common word stays lower-case. The strings are written out here from the
// ruling, with `<where>` as the `full` configuration gives it (`sourceWhere`).
// The segments carry only the address; the page adds `target` and `rel`
// (`page.tsx`), so the link is read from the rendered page.
//
// THE FALLBACK AND THE CASE (criterion 3) are driven through `sourceRow` on
// synthetic statement sources, two of them with map entries the test adds to
// `SOURCE_DESCRIPTIONS` and removes after it.
//
// THE TRACES (criterion 6). The derived guard (`privacy-page.test.ts`) fails
// only on untraced text, an empty trace list, an undeclared `env:` or a
// `const:` that names no export, and C5 above matches rows by id: neither
// sees a row that stopped tracing the map or the reach sentence. The check
// below does, and is shown red on a page with either trace removed.
//
// WHAT MAKES IT ABLE TO FAIL. At the base each row reads "<name>, published
// by X, runs at Y.", with no what-line, no link and neither trace.

const sourceNameModule = (await import(pathToFileURL(path.join(SRC, 'lib', 'sources', 'source-name.ts')).href)) as Mod;
const PL_CONFIGURED = ['socrata', 'data-commons', 'boston-opencontext', 'nyc-charter'];

/** D1 = A, each what-line as stored (and as the privacy page prints it). */
const RULED_WHAT_STORED: Record<string, string> = {
  socrata: 'an open-data portal platform from Tyler Technologies. Many cities and states publish their data on its portals.',
  'data-commons': 'public statistics from government agencies and international organizations, gathered by Google.',
  'boston-opencontext': "the City of Boston's open data, from data.boston.gov.",
  'nyc-charter': "the text of New York City's Charter, Administrative Code and Rules.",
};
/** D2 = A: the publisher as the row prints it, and the connector's repository. */
const RULED_PUBLISHER: Record<string, { text: string; link: string }> = {
  socrata: { text: 'npstorey', link: 'https://github.com/npstorey/socrata-mcp-server' },
  'data-commons': { text: 'Google', link: 'https://github.com/datacommonsorg/agent-toolkit' },
  'boston-opencontext': { text: 'the City of Boston', link: 'https://github.com/CityOfBoston/OpenContext' },
  'nyc-charter': { text: 'BetaNYC', link: 'https://github.com/BetaNYC/nyc-charter-laws-rules' },
};
const reachSentence = (publisher: string, where: string) => `This site reaches it through an MCP server, a connector that ${publisher} publishes, running at ${where}.`;
const reachUnstated = (where: string) => `This site reaches it through an MCP server, a connector whose publisher is not stated, running at ${where}.`;

type PlSegment = string | { link: string; text: string } | { code: string };
const partsText = (parts: PlSegment[]) => parts.map((p) => (typeof p === 'string' ? p : 'link' in p ? p.text : p.code)).join('');

/** Every `<a>` in some markup, with its address, target, rel and text. */
function anchors(html: string): Array<{ href: string; target: string | null; rel: string | null; text: string }> {
  return [...html.matchAll(/<a([^>]*)>(.*?)<\/a>/g)].map((m) => ({
    href: /\shref="([^"]*)"/.exec(m[1])?.[1].replace(/&amp;/g, '&') ?? '',
    target: /\starget="([^"]*)"/.exec(m[1])?.[1] ?? null,
    rel: /\srel="([^"]*)"/.exec(m[1])?.[1] ?? null,
    text: text(m[2]),
  }));
}

test('PL criterion 1 (full): each source\'s row reads "<name>: <what-line> <reach sentence>" up to "Who holds its logs", the publisher linked to its connector', () => {
  const { html, statement } = RENDERED.full;
  assert.deepEqual((statement.sources as Array<{ sourceId: string }>).map((s) => s.sourceId), PL_CONFIGURED, 'premise: the full configuration has the four sources');
  const sections = withEnv(CONFIGS.full, () => facts.buildPrivacySections(null)) as Array<{ heading: string; statements: Array<{ id: string; parts: PlSegment[] }> }>;
  const each = sections.find((s) => s.heading === 'Each data source');
  assert.ok(each, 'premise: the page has "Each data source"');
  for (const source of statement.sources as Array<{ sourceId: string }>) {
    const id = source.sourceId;
    const where: string = sourceNameModule.sourceWhere(source);
    const expected = `${READER_NAME[id]}: ${RULED_WHAT_STORED[id]} ${reachSentence(RULED_PUBLISHER[id].text, where)} Who holds its logs: `;
    const row = each!.statements.find((st) => st.id === `${SOURCE_ROW}${id}`);
    assert.ok(row, `no row for ${id}`);
    assert.ok(partsText(row!.parts).startsWith(expected), `${id}'s row does not start "${expected}": ${partsText(row!.parts).slice(0, 300)}`);
    const rendered = statements(html).find((s) => s.id === `${SOURCE_ROW}${id}`);
    assert.ok(rendered, `the page renders no row for ${id}`);
    assert.ok(rendered!.text.startsWith(expected.trimEnd()), `${id}'s rendered row does not start "${expected.trimEnd()}": ${rendered!.text.slice(0, 300)}`);
    const links = anchors(rendered!.html).filter((a) => a.href === RULED_PUBLISHER[id].link);
    assert.equal(links.length, 1, `${id}'s rendered row does not link ${RULED_PUBLISHER[id].link} once`);
    assert.equal(links[0].text, RULED_PUBLISHER[id].text, `${id}'s link does not read the publisher's name`);
    assert.equal(links[0].target, '_blank', `${id}'s link does not open a new tab`);
    assert.equal(links[0].rel, 'noopener noreferrer', `${id}'s link's rel is not "noopener noreferrer"`);
  }
});

for (const name of Object.keys(CONFIGS)) {
  test(`PL criterion 1 (${name}): the privacy page renders neither "Published by" nor ", published by"`, () => {
    const page = text(RENDERED[name].html);
    for (const old of ['Published by', ', published by']) {
      const at = page.indexOf(old);
      assert.ok(at < 0, `${name}: the page renders "${old}": …${page.slice(Math.max(0, at - 80), at + 80)}…`);
    }
  });
}

/** Criterion 3's synthetic sources: two with no map entry, two whose entries the test adds. */
const FIXTURE_SOURCES = [
  { sourceId: 'fixture-unmapped', name: 'Fixture Unmapped', publisher: 'Fixture Publisher', host: 'unmapped.fixture.example' },
  { sourceId: 'fixture-unstated', name: 'Fixture Unstated', publisher: 'not stated', host: 'unstated.fixture.example' },
  { sourceId: 'fixture-proper', name: 'Fixture Proper', publisher: 'Fixture Proper Org', host: 'proper.fixture.example' },
  { sourceId: 'fixture-lower', name: 'Fixture Lower', publisher: 'Fixture Lower Org', host: 'lower.fixture.example' },
];
const FIXTURE_ENTRIES: Record<string, { what: string; publisher: string; link: string }> = {
  'fixture-proper': { what: "New York State's fixture records, from a fixture portal.", publisher: 'Fixture Proper Org', link: 'https://proper.fixture.example/connector' },
  'fixture-lower': { what: 'an example fixture platform, for the case test.', publisher: 'Fixture Lower Org', link: 'https://lower.fixture.example/connector' },
};

test('PL criterion 3 (privacy page): no map entry reads the reach sentence unlinked with no what-line; a stored what-line prints as stored', () => {
  assert.equal(typeof facts.sourceRow, 'function', 'privacy-facts exports no sourceRow to drive a synthetic source through');
  const map = copy?.SOURCE_DESCRIPTIONS as Record<string, unknown> | undefined;
  assert.ok(map && typeof map === 'object', `${COPY} exports no SOURCE_DESCRIPTIONS`);
  const base = (RENDERED.full.statement.sources as Mod[])[0];
  for (const [id, entry] of Object.entries(FIXTURE_ENTRIES)) map![id] = entry;
  try {
    const expected: Record<string, string> = {
      'fixture-unmapped': `Fixture Unmapped: ${reachSentence('Fixture Publisher', 'unmapped.fixture.example')} Who holds its logs: `,
      'fixture-unstated': `Fixture Unstated: ${reachUnstated('unstated.fixture.example')} Who holds its logs: `,
      'fixture-proper': `Fixture Proper: New York State's fixture records, from a fixture portal. ${reachSentence('Fixture Proper Org', 'proper.fixture.example')} Who holds its logs: `,
      'fixture-lower': `Fixture Lower: an example fixture platform, for the case test. ${reachSentence('Fixture Lower Org', 'lower.fixture.example')} Who holds its logs: `,
    };
    for (const f of FIXTURE_SOURCES) {
      const row = facts.sourceRow({ ...base, sourceId: f.sourceId, displayName: `${f.name} MCP Server`, publisher: f.publisher, host: f.host }) as { parts: PlSegment[] };
      assert.ok(partsText(row.parts).startsWith(expected[f.sourceId]), `${f.sourceId}: expected the row to start "${expected[f.sourceId]}": ${partsText(row.parts).slice(0, 300)}`);
      const named = row.parts.filter((p) => typeof p === 'object' && 'link' in p && p.text === f.publisher) as Array<{ link: string }>;
      const entry = FIXTURE_ENTRIES[f.sourceId];
      if (entry) {
        assert.equal(named.length, 1, `${f.sourceId}: the mapped publisher is not a link segment once`);
        assert.equal(named[0].link, entry.link, `${f.sourceId}: the link is not the entry's`);
      } else {
        assert.equal(named.length, 0, `${f.sourceId}: an unmapped publisher is linked`);
      }
    }
  } finally {
    for (const id of Object.keys(FIXTURE_ENTRIES)) delete map![id];
  }
});

const MAP_TRACE = 'const:src/lib/sources/copy.ts#SOURCE_DESCRIPTIONS';
const REACH_TRACE = 'const:src/lib/sources/copy.ts#REACH_SENTENCE';

/** Each mapped source's row that does not carry both the map's and the reach sentence's trace, by row and trace. */
function missingRowTraces(html: string, mapped: string[]): string[] {
  const missing: string[] = [];
  for (const id of mapped) {
    const row = statements(html).find((s) => s.id === `${SOURCE_ROW}${id}`);
    if (!row) {
      missing.push(`${SOURCE_ROW}${id}: no row`);
      continue;
    }
    for (const trace of [MAP_TRACE, REACH_TRACE]) if (!row.traces.includes(trace)) missing.push(`${SOURCE_ROW}${id}: ${trace}`);
  }
  return missing;
}

test('PL criterion 6: each mapped source\'s row traces the map and the reach sentence, and the check is red with either trace removed', () => {
  const { html, statement } = RENDERED.full;
  const map = copy?.SOURCE_DESCRIPTIONS as Record<string, unknown> | undefined;
  assert.ok(map && typeof map === 'object', `${COPY} exports no SOURCE_DESCRIPTIONS`);
  const mapped = (statement.sources as Array<{ sourceId: string }>).map((s) => s.sourceId).filter((id) => Object.hasOwn(map!, id));
  assert.deepEqual(mapped, PL_CONFIGURED, 'premise: the four configured sources are mapped');
  assert.deepEqual(missingRowTraces(html, mapped), [], 'a mapped row does not carry both traces');
  for (const trace of [MAP_TRACE, REACH_TRACE]) {
    const removed = html.replace(new RegExp(`(data-statement="${SOURCE_ROW}data-commons"[^>]*data-trace="[^"]*?) ?${trace.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`), '$1');
    assert.notEqual(removed, html, `premise: the fixture removed ${trace} from Data Commons' row`);
    assert.deepEqual(missingRowTraces(removed, mapped), [`${SOURCE_ROW}data-commons: ${trace}`], `the check does not report ${trace} removed`);
  }
});
