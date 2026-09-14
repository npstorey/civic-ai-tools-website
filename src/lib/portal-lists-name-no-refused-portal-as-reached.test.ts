// No reader-facing list built from a run's tool calls names a portal that only
// a refused call carried as if it had been reached (Wave N11 #434 F-W, ruling
// D3). The two notebook covers go further and list such a portal separately,
// as refused.
//
// THE DEFECT, measured at b42acdf. Both notebook generators collected the
// cover's "Portals:" line from every call's `args.portal`, with no filter on
// refusals (`notebook.ts` `generateNotebook`, `notebook-author/synthesize.ts`
// `uniquePortals`). A run whose only call to a second portal was refused
// shipped a notebook — a signed extension of its record — whose cover named
// that portal beside the one the data came from.
//
// A SHAPE THAT HAD TO BE HANDLED. Filtering refused calls out naively makes an
// all-refused run's list empty, and both generators then fell back to the
// run's or the default portal, naming a portal NO call reached. The fallback
// now applies only when no call named a portal at all. The drive below hands
// the chat generator the very fallback its one caller derives — the first
// call's portal, which there is the refused one — so the fallback cannot hide
// behind a different value.
//
// THE UNIVERSE, derived, not listed. Part 2 reads every file `git ls-files`
// tracks in the JavaScript/TypeScript family (tests excluded, wherever it sits)
// and collects every site that reads a call's `args.portal` — the thing a
// portal list is built from. Every site must be classified below, and every
// classification must still describe a site in the tree (both directions), so
// a new builder in a directory nobody listed is unclassified the day it lands.
// Each class carries its own proof:
//   - `cover-split`: the one function both notebook covers read
//     (`notebook-author/cover-portals.ts`), driven through BOTH generators in
//     part 1.
//   - `answered-only`: the site reads only calls that were answered. Proven by
//     driving the exported formatter with a refused-only portal where one
//     exists, and otherwise by the filter being on the site's own line or in
//     the collection it iterates.
//   - `notebook-fallback`: a value handed to `generateNotebook` as its
//     fallback, proven harmless by part 1's all-refused drive.
//   - `per-call`: a single call's own portal for that call's own line, cell or
//     entry — no list. Proven by nothing accumulating it within the next lines.
//
// THE COPY HEADER (`McpResponseDisplay.tsx`, #384 P8 F2) is `answered-only`: it
// drops refused calls before collecting portals and does NOT list refused-only
// portals separately. It is a clipboard summary of the answer, not the signed
// notebook the ruling names, so this guard holds it to the property (no
// refused-only portal named as reached) and not to the separate listing.
//
// BLIND SPOTS. A portal read through a renamed alias (`const a = call.args;
// a.portal`) or a destructure is not collected. A destructure out of `x.args`
// is checked absent by the premise below; one out of a bare `args` is not,
// because run-level option objects are also named `args`
// (`api/query-notebook/route.ts`). Stored `queries[].portal` readers are
// a different field and out of this guard's universe.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { generateNotebook } from './notebook.ts';
import { synthesizeNotebook } from './notebook-author/synthesize.ts';
import { buildNarrativeSummary, buildProvenanceLine } from './streaming.ts';
import { summaryDataSourcesLine } from './evidence/summary-sources.ts';

const REACHED = 'data.cityofnewyork.us';
/** Named only by a refused call, and a portal `getPortalCity` knows, so a city
 *  name leaking through a formatter is caught too. */
const REFUSED_ONLY = 'data.cityofchicago.org';
const REFUSED_CITY = 'Chicago';
const DEFAULT = 'data.sfgov.org';

type Call = {
  name: string;
  operationType: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  failed?: boolean;
  failureKind?: 'unknown';
  duration_ms?: number;
};
const answered = (portal: string | undefined, dataset: string): Call => ({
  name: 'get_data',
  operationType: 'query',
  args: { type: 'query', ...(portal ? { portal } : {}), dataset_id: dataset, select: 'count(*)', limit: 5 },
  resultSummary: { rows: 5, columns: 3 },
  duration_ms: 90,
});
const refused = (portal: string, dataset: string): Call => ({
  name: 'get_data',
  operationType: 'query',
  args: { type: 'query', portal, dataset_id: dataset, select: 'count(*)', limit: 5 },
  failed: true,
  failureKind: 'unknown',
  duration_ms: 30,
});

const NO_ATTRIBUTION = { origin: null, host: null, platformTitle: null };
const PORTAL_LINE = /^\*\*Portals?(?: with every request refused)?:\*\*.*$/gm;

function chatCover(calls: Call[], fallback: string | null): string {
  const nb = generateNotebook('q?', fallback, calls as never, 'a', NO_ATTRIBUTION) as { cells: { source: string[] }[] };
  return nb.cells[0].source.join('\n');
}
function skeletonCover(calls: Call[], defaultPortal: string): string {
  const { notebook } = synthesizeNotebook({
    query: 'q?', defaultPortal, modelName: 'test/model', modelAccess: 'through an API',
    finalAnswer: 'a', generatedAt: '2026-01-01T00:00:00.000Z', toolCalls: calls as never,
  });
  const cell = (notebook as { cells: { source: string | string[] }[] }).cells[0];
  return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
}
const portalLines = (cover: string) => (cover.match(PORTAL_LINE) ?? []).map((l) => l.trim());

/** The shapes, each chosen so the assertion on it can fail. */
const SHAPES: { name: string; calls: Call[]; fallback: string; lines: string[] }[] = [
  {
    name: 'an answered portal and a refused-only portal',
    calls: [answered(REACHED, 'aaaa-0001'), refused(REFUSED_ONLY, 'bbbb-0009')],
    fallback: DEFAULT,
    lines: [`**Portal:** ${REACHED}`, `**Portal with every request refused:** ${REFUSED_ONLY}`],
  },
  {
    // The fallback is the refused portal itself — what `McpResponseDisplay`
    // derives for the chat notebook — and a second default for the skeleton.
    name: 'every portal-naming call refused, with a fallback equal to the refused portal',
    calls: [refused(REFUSED_ONLY, 'bbbb-0009')],
    fallback: REFUSED_ONLY,
    lines: [`**Portal with every request refused:** ${REFUSED_ONLY}`],
  },
  {
    name: 'every portal-naming call refused, with a different default',
    calls: [refused(REFUSED_ONLY, 'bbbb-0009')],
    fallback: DEFAULT,
    lines: [`**Portal with every request refused:** ${REFUSED_ONLY}`],
  },
  {
    name: 'a portal both an answered and a refused call named is reached, and not listed as refused',
    calls: [refused(REACHED, 'bbbb-0009'), answered(REACHED, 'aaaa-0001')],
    fallback: DEFAULT,
    lines: [`**Portal:** ${REACHED}`],
  },
  {
    name: 'no call named a portal: the fallback is the only portal, as before',
    calls: [answered(undefined, 'aaaa-0001')],
    fallback: DEFAULT,
    lines: [`**Portal:** ${DEFAULT}`],
  },
  {
    name: 'two refused-only portals, pluralised',
    calls: [answered(REACHED, 'aaaa-0001'), refused(REFUSED_ONLY, 'bbbb-0009'), refused(DEFAULT, 'cccc-0003')],
    fallback: '',
    lines: [`**Portal:** ${REACHED}`, `**Portals with every request refused:** ${REFUSED_ONLY}, ${DEFAULT}`],
  },
];

// --- Part 1: both covers, driven ---------------------------------------------

for (const shape of SHAPES) {
  test(`D3 chat notebook cover: ${shape.name}`, () => {
    assert.deepEqual(portalLines(chatCover(shape.calls, shape.fallback)), shape.lines);
  });
  test(`D3 skeleton notebook cover: ${shape.name}`, () => {
    assert.deepEqual(portalLines(skeletonCover(shape.calls, shape.fallback)), shape.lines);
  });
}

test('D3: the all-refused cover names no reached portal in either document', () => {
  const calls = [refused(REFUSED_ONLY, 'bbbb-0009')];
  for (const cover of [chatCover(calls, REFUSED_ONLY), chatCover(calls, DEFAULT), skeletonCover(calls, DEFAULT)]) {
    assert.doesNotMatch(cover, /^\*\*Portals?:\*\*/m, 'a reached-portal line on a run no call of which was answered');
    assert.ok(!cover.includes(DEFAULT), 'the default portal is named though a call named a portal');
  }
});

// --- Part 2: every site that reads a call's portal, classified -----------------

const SOURCE_FAMILY = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.test\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
/** `x.args.portal`, `x.args?.portal`, `args.portal`, `x.args['portal']`. */
const PORTAL_READ = /(?:\b[A-Za-z_$][\w$]*\s*\.\s*)?\bargs\s*(?:\?\.|\.)\s*portal\b|\bargs\s*(?:\?\.)?\s*\[\s*['"]portal['"]\s*\]/g;

interface Site { file: string; line: number; text: string }

function derivedSites(): Site[] {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && SOURCE_FAMILY.test(f) && !TEST_FILE.test(f));
  assert.ok(files.length > 200, `PREMISE: derived ${files.length} source files; the scan is not reading the tree`);
  const sites: Site[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((raw, i) => {
      const code = raw.replace(/\/\/.*$/, '');
      if (/^\s*(?:\*|\/\*)/.test(code)) return;
      const reads = code.match(PORTAL_READ)?.length ?? 0;
      for (let n = 0; n < reads; n++) sites.push({ file, line: i + 1, text: raw.trim() });
    });
  }
  return sites;
}

type Kind = 'cover-split' | 'answered-only' | 'notebook-fallback' | 'per-call';
interface Classified { file: string; text: string; kind: Kind; why: string }

const CLASSIFIED: Classified[] = [
  { file: 'src/lib/notebook-author/cover-portals.ts', text: 'const portal = call.args.portal;', kind: 'cover-split',
    why: 'the one reached/refused split both notebook covers read; driven in part 1' },

  { file: 'src/components/shared/McpResponseDisplay.tsx', text: 'const firstPortal = answered.find(t => t.args.portal)?.args.portal as string | undefined;', kind: 'answered-only',
    why: 'linkDatasetIds borrows a portal for a link, only from answered calls (two reads on one line)' },
  { file: 'src/components/shared/McpResponseDisplay.tsx', text: 'const firstPortal = answered.find(t => t.args.portal)?.args.portal as string | undefined;', kind: 'answered-only', why: 'see above' },
  { file: 'src/components/shared/McpResponseDisplay.tsx', text: 'const portal = (tool.args.portal as string | undefined) || firstPortal;', kind: 'answered-only',
    why: 'linkDatasetIds iterates answered calls only' },
  { file: 'src/components/shared/McpResponseDisplay.tsx', text: 'toolsCalled.filter(t => !t.failed).map(t => t.args.portal as string).filter(Boolean)', kind: 'answered-only',
    why: 'the copy header (#384 P8 F2): answered portals only; refused-only portals are omitted, not listed' },
  { file: 'src/components/shared/McpResponseDisplay.tsx', text: 'const p = (toolsCalled.find(t => t.args.portal)?.args.portal as string) || portal || null;', kind: 'notebook-fallback',
    why: 'the chat notebook fallback; generateNotebook uses it only when no call named a portal (two reads on one line)' },
  { file: 'src/components/shared/McpResponseDisplay.tsx', text: 'const p = (toolsCalled.find(t => t.args.portal)?.args.portal as string) || portal || null;', kind: 'notebook-fallback', why: 'see above' },

  { file: 'src/lib/streaming.ts', text: 'const p = tool.args.portal as string | undefined;', kind: 'answered-only',
    why: 'buildNarrativeSummary: the "Using" portals and the dataset map read `answered` only (two sites); buildProvenanceLine skips failed (one site)' },
  { file: 'src/lib/streaming.ts', text: 'const p = tool.args.portal as string | undefined;', kind: 'answered-only', why: 'see above' },
  { file: 'src/lib/streaming.ts', text: 'const p = tool.args.portal as string | undefined;', kind: 'answered-only', why: 'see above' },
  { file: 'src/lib/streaming.ts', text: 'const portal = tool.args.portal as string | undefined;', kind: 'answered-only',
    why: 'buildProvenanceLine links each dataset of `queryTools`, which `isQueryCall` limits to answered calls' },
  { file: 'src/lib/streaming.ts', text: 'const portal = args.portal as string;', kind: 'per-call',
    why: 'one call’s own narration' },
  { file: 'src/lib/evidence/summary-sources.ts', text: 'const portal = tc.args?.portal;', kind: 'answered-only',
    why: 'summaryDataSources skips failed calls' },

  { file: 'src/lib/evidence/packager.ts', text: 'portal: (tc.args.portal as string) || undefined,', kind: 'per-call',
    why: 'the call’s own queries[] entry, which also carries its failed key' },
  { file: 'src/lib/notebook-author/tool-to-cell.ts', text: 'const portal = (call.args.portal as string) || ctx.defaultPortal;', kind: 'per-call',
    why: 'one call’s own cell (three sites)' },
  { file: 'src/lib/notebook-author/tool-to-cell.ts', text: 'const portal = (call.args.portal as string) || ctx.defaultPortal;', kind: 'per-call', why: 'see above' },
  { file: 'src/lib/notebook-author/tool-to-cell.ts', text: 'const portal = (call.args.portal as string) || ctx.defaultPortal;', kind: 'per-call', why: 'see above' },
  { file: 'src/lib/notebook.ts', text: 'const portal = nonEmptyString(args.portal);', kind: 'per-call',
    why: 'one call’s own step URL' },
  { file: 'src/components/ToolCallCard.tsx', text: 'const portal = args.portal as string;', kind: 'per-call',
    why: 'one call’s own card' },
  { file: 'src/lib/model-loop/run-tool-loop.ts', text: "if (portal && !argumentsMalformed && name === 'get_data' && !args.portal) args.portal = portal;", kind: 'per-call',
    why: 'the loop fills one call’s own portal before it runs (a read and a write on one line)' },
  { file: 'src/lib/model-loop/run-tool-loop.ts', text: "if (portal && !argumentsMalformed && name === 'get_data' && !args.portal) args.portal = portal;", kind: 'per-call', why: 'see above' },
  { file: 'src/lib/model-loop/run-tool-loop.ts', text: "...(args.portal ? { 'tool.portal_domain': String(args.portal) } : {}),", kind: 'per-call',
    why: 'one call’s own span (two reads on one line)' },
  { file: 'src/lib/model-loop/run-tool-loop.ts', text: "...(args.portal ? { 'tool.portal_domain': String(args.portal) } : {}),", kind: 'per-call', why: 'see above' },
];

const key = (s: { file: string; text: string }) => `${s.file} :: ${s.text}`;
function multiset(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

const SITES = derivedSites();

test('PREMISE: no portal is destructured out of a call’s `x.args` (a read this scan would not see)', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0').filter((f) => f && SOURCE_FAMILY.test(f) && !TEST_FILE.test(f));
  const hits = files.filter((f) => /\{[^}]*\bportal\b[^}]*\}\s*=\s*[\w$]+\s*\??\.\s*args\b/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
});

test('every site that reads a call’s portal is classified, and every classification is still in the tree', () => {
  const derived = multiset(SITES.map(key));
  const listed = multiset(CLASSIFIED.map(key));
  const unclassified = [...derived].filter(([k, n]) => (listed.get(k) ?? 0) < n)
    .map(([k]) => `${k}  (${SITES.filter((s) => key(s) === k).map((s) => `:${s.line}`).join(' ')})`);
  const stale = [...listed].filter(([k, n]) => (derived.get(k) ?? 0) < n).map(([k]) => k);
  assert.deepEqual(unclassified, [], 'a site reads a call’s portal and is not classified: if it builds a list a reader sees, it must not name a portal only refused calls carried as reached');
  assert.deepEqual(stale, [], 'a classification no longer describes a site in the tree');
});

test('answered-only: the formatters that can be driven drop a refused-only portal, and its city', () => {
  const calls = [answered(REACHED, 'aaaa-0001'), refused(REFUSED_ONLY, 'bbbb-0009')];
  const outputs = {
    buildNarrativeSummary: buildNarrativeSummary(calls),
    buildProvenanceLine: buildProvenanceLine(calls) ?? '',
    summaryDataSourcesLine: summaryDataSourcesLine(calls as never),
  };
  // PREMISE: each output names the reached portal or its dataset, so an
  // absence below is about the refusal and not an empty formatter.
  assert.match(outputs.buildNarrativeSummary + outputs.buildProvenanceLine, /NYC|aaaa-0001/);
  assert.match(outputs.summaryDataSourcesLine, new RegExp(REACHED.replace(/\./g, '\\.')));
  for (const [name, out] of Object.entries(outputs)) {
    assert.ok(!out.includes(REFUSED_ONLY), `${name} names a portal only a refused call carried: ${out}`);
    assert.ok(!out.includes(REFUSED_CITY), `${name} names the city of a portal only a refused call carried: ${out}`);
  }
});

test('answered-only: a refused call’s portal changes nothing those formatters state', () => {
  // The name-absence check above cannot see every leak: `buildNarrativeSummary`
  // turns its portal list into a count ("2 NYC datasets" versus "NYC's A and
  // NYC's B"), never into the refused portal's name. So the property is driven
  // as a difference: the same run with the refused call's portal removed must
  // read identically. The refused call comes FIRST, so a list built from every
  // call would start with its portal.
  const withPortal = [refused(REFUSED_ONLY, 'bbbb-0009'), answered(REACHED, 'aaaa-0001'), answered(REACHED, 'aaaa-0002')];
  const withoutPortal = withPortal.map((c) => (c.failed ? { ...c, args: { ...c.args, portal: undefined } } : c));
  assert.equal(buildNarrativeSummary(withPortal), buildNarrativeSummary(withoutPortal));
  assert.equal(buildProvenanceLine(withPortal), buildProvenanceLine(withoutPortal));
  assert.equal(summaryDataSourcesLine(withPortal as never), summaryDataSourcesLine(withoutPortal as never));
});

test('answered-only: sites that cannot be driven carry the filter on their own line or in the collection they iterate', () => {
  for (const site of SITES) {
    const c = CLASSIFIED.find((x) => key(x) === key(site));
    if (!c || c.kind !== 'answered-only' || c.file !== 'src/components/shared/McpResponseDisplay.tsx') continue;
    const source = readFileSync(site.file, 'utf8');
    const filtersHere = /\.filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*!\s*\w+\.failed\s*\)/.test(site.text);
    const iteratesAnswered = /\banswered\b/.test(site.text) || (() => {
      // The line is inside `for (const tool of answered)`: find the nearest loop header above it.
      const above = source.split('\n').slice(0, site.line - 1).reverse();
      const header = above.find((l) => /\bfor\s*\(\s*const\s+\w+\s+of\s+\w+\s*\)/.test(l));
      return header !== undefined && /\bof\s+answered\s*\)/.test(header);
    })();
    const definesAnswered = /const\s+answered\s*=\s*toolsCalled\.filter\(\s*t\s*=>\s*!t\.failed\s*\)/.test(source);
    assert.ok(
      filtersHere || (iteratesAnswered && definesAnswered),
      `${site.file}:${site.line} is classified answered-only but neither filters refused calls on its line nor iterates \`answered\` defined as the non-failed calls: ${site.text}`,
    );
  }
});

test('per-call: nothing accumulates a per-call portal into a list', () => {
  for (const site of SITES) {
    const c = CLASSIFIED.find((x) => key(x) === key(site));
    if (!c || c.kind !== 'per-call') continue;
    const lines = readFileSync(site.file, 'utf8').split('\n');
    const window = lines.slice(site.line - 1, site.line + 6).join('\n');
    const assigned = /const\s+(\w+)\s*=/.exec(site.text)?.[1];
    if (assigned) {
      assert.doesNotMatch(
        window,
        new RegExp(`\\.(?:add|push|unshift)\\(\\s*${assigned}\\b`),
        `${site.file}:${site.line} is classified per-call but adds its portal to a collection within six lines`,
      );
    }
    assert.doesNotMatch(site.text, /\.(?:add|push|unshift)\(/, `${site.file}:${site.line} accumulates on its own line`);
  }
});
