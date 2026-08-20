// Drift guard for the record/evidence segment pair (civic-ai-tools#160 P3).
//
// WHAT THE SETTLEMENT ASKS FOR. Appendix J of the Typed Standards
// specification retires "evidence" from the artifact and infrastructure brand
// and names `/api/records/*` and `/records/*` the canonical segments, with
// `/api/evidence/*` and `/evidence/*` served as PERMANENT aliases — migration
// class `alias-permanent`, explicitly not a deprecation window, because
// published links carry the prior-era form and nothing already published may
// stop resolving.
//
// WHICH DIRECTION THE ALIASING RUNS, AND WHY IT WAS MEASURED RATHER THAN
// ASSUMED. Two shapes were available: move the seventeen handlers and two
// pages to the `records/` paths and leave re-export shims at the `evidence/`
// paths, or leave the implementations where they are and add the shims at the
// `records/` paths. Both single-source the handlers and both produce an
// honest diff (git detects the renames either way), so those two criteria did
// not decide it. Three measurements did:
//
//   1. WHERE THE RISK LANDS. This phase's hard constraint is that production
//      behavior on the EXISTING names must not change. Leaving the
//      implementations in place makes that structural rather than asserted:
//      the live route and page files are byte-identical, so no property of the
//      re-export mechanism can reach them. Under the inverse, all seventeen
//      live paths — the ones with links in the wild — would newly depend on a
//      mechanism this repo cannot execute locally (below), and the new,
//      unadvertised segment would be the safe one. That is the wrong way
//      round.
//   2. A MEASURED ASYMMETRY, not a general worry. Next reads route-segment
//      config by parsing each route file's own source (`getPageStaticInfo`),
//      which sees initialized `export const` declarations and not re-export
//      bindings. `src/app/(app)/evidence/page.tsx` declares
//      `dynamic = 'force-dynamic'`; a shim standing in front of it must
//      re-declare that literal, and a future editor who forgets silently turns
//      a per-request page into a prerendered one. Whichever file is the shim
//      carries that hazard — so it should be the address with no published
//      links behind it. (The `dynamic` mirror is asserted below, so the hazard
//      is guarded wherever it sits.)
//   3. NOTHING ELSE POINTS AT THE PATHS. Nothing in the build tooling
//      addresses these files by path — `next.config.ts`'s
//      `outputFileTracingIncludes` names `/api/query-notebook` only, and the
//      standalone-asset checker names no route directory — so the move was
//      never forced by the build either.
//
// The consequence to keep in view: the implementation sits at the PRIOR-ERA
// path while the CANONICAL name is `records`. That inversion is deliberate and
// PERMANENT — it is invisible from outside, because which file holds the body
// never crosses a public surface, and moving it would put the seventeen live
// handlers behind the re-export mechanism for no external gain. The cutover
// phase (P5) flipped what the site EMITS without moving any implementation;
// the emissions half is guarded separately in `emissions-form.test.ts`.
//
// WHAT THIS FILE CAN AND CANNOT PROVE. It reads source text. It can prove
// that both segments exist, that they are paired one-for-one in both
// directions, that the alias side re-exports rather than reimplements, that
// the exported HTTP methods agree, and that the page-level route-segment
// config is mirrored. It CANNOT prove that a request to either address
// reaches a handler: this repo has no route-handler harness (`npm test` is
// `node --test` over modules that resolve neither the `@/` alias nor Next's
// request plumbing), so handler dispatch is proven by `next build` registering
// both route entries and, authoritatively, by CI and the preview deployment.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `src/app` — this file lives at `src/app/api/records/`. */
const APP_DIR = path.resolve(HERE, '..', '..');
const REPO_SRC = path.resolve(APP_DIR, '..');

/** The two segment families, prior-era first. */
const API_PRIOR = path.join(APP_DIR, 'api', 'evidence');
const API_SETTLEMENT = path.join(APP_DIR, 'api', 'records');
const PAGES_PRIOR = path.join(APP_DIR, '(app)', 'evidence');
const PAGES_SETTLEMENT = path.join(APP_DIR, '(app)', 'records');

/** Repo-relative path, for assertion messages that read cold. */
function rel(abs: string): string {
  return path.relative(path.resolve(REPO_SRC, '..'), abs);
}

/**
 * Every routable file under `dir`, keyed by its path RELATIVE to `dir` — so
 * `[slug]/commitment/route.ts` is the key on both sides of a pair and the two
 * trees compare as sets.
 */
function routeFiles(dir: string, filename: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && filename.test(e.name))
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();
}

const ROUTE_FILE = /^route\.ts$/;
const PAGE_FILE = /^page\.tsx$/;

const API_PRIOR_FILES = routeFiles(API_PRIOR, ROUTE_FILE);
const API_SETTLEMENT_FILES = routeFiles(API_SETTLEMENT, ROUTE_FILE);
const PAGE_PRIOR_FILES = routeFiles(PAGES_PRIOR, PAGE_FILE);
const PAGE_SETTLEMENT_FILES = routeFiles(PAGES_SETTLEMENT, PAGE_FILE);

/** HTTP methods a route file DEFINES (`export async function GET(`). */
function definedMethods(source: string): string[] {
  return [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Z]+)\s*\(/gm)]
    .map((m) => m[1])
    .sort();
}

/** Names a file RE-EXPORTS, with the specifier they come from. */
function reExports(source: string): { names: string[]; from: string }[] {
  return [...source.matchAll(/^export\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm)].map((m) => ({
    names: m[1]
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
      .sort(),
    from: m[2],
  }));
}

// --- Sanity: the walker found something ---------------------------------------
//
// Every assertion below compares two lists. Two empty lists compare equal, so
// without this the whole file could pass while describing nothing.

test('the segment walker finds both families', () => {
  assert.ok(
    API_PRIOR_FILES.length > 0,
    `Found no route.ts files under ${rel(API_PRIOR)}. Either the family moved or\n` +
      `this walker is broken — every pairing assertion below passes vacuously when\n` +
      `this happens, so fix it here rather than trusting the greens.`,
  );
  assert.ok(PAGE_PRIOR_FILES.length > 0, `Found no page.tsx under ${rel(PAGES_PRIOR)} — see above.`);
});

// --- The pairing guard, both directions ---------------------------------------

test('every /api/evidence route has a /api/records twin, and vice versa', () => {
  assert.deepEqual(
    API_SETTLEMENT_FILES,
    API_PRIOR_FILES,
    `The two API segment families have drifted apart.\n` +
      `\n` +
      `  ${rel(API_PRIOR)}:      ${API_PRIOR_FILES.length} route file(s)\n` +
      `  ${rel(API_SETTLEMENT)}: ${API_SETTLEMENT_FILES.length} route file(s)\n` +
      `\n` +
      `FIX: whichever side is missing an entry, add it. A NEW endpoint needs a\n` +
      `file in both trees — the implementation at the evidence/ path and a\n` +
      `re-export at the records/ path (see this file's header for why that\n` +
      `direction). A RETIRED endpoint has to be removed from both.\n` +
      `\n` +
      `WHY THIS IS NOT BOOKKEEPING: the settlement (Appendix J) promises that\n` +
      `both segments serve the same API forever. A one-sided endpoint breaks\n` +
      `that promise silently — the missing address just 404s, and nothing in\n` +
      `the response says an alias was supposed to exist.`,
  );
});

test('every /evidence page has a /records twin, and vice versa', () => {
  assert.deepEqual(
    PAGE_SETTLEMENT_FILES,
    PAGE_PRIOR_FILES,
    `The two page segment families have drifted apart:\n` +
      `  ${rel(PAGES_PRIOR)}:      ${PAGE_PRIOR_FILES.join(', ') || '(none)'}\n` +
      `  ${rel(PAGES_SETTLEMENT)}: ${PAGE_SETTLEMENT_FILES.join(', ') || '(none)'}\n` +
      `\n` +
      `FIX: add the missing page on whichever side lacks it. See the API twin\n` +
      `test above for the reasoning; it applies identically here.`,
  );
});

// --- The single-sourcing guard ------------------------------------------------

test('every /api/records route re-exports its twin and implements nothing', () => {
  for (const file of API_SETTLEMENT_FILES) {
    const aliasPath = path.join(API_SETTLEMENT, file);
    const source = readFileSync(aliasPath, 'utf8');
    const exports = reExports(source);

    assert.equal(
      exports.length,
      1,
      `${rel(aliasPath)} should carry exactly one \`export { … } from '…';\` line\n` +
        `(found ${exports.length}). The settlement-era segment is an ALIAS: it names\n` +
        `the handlers its twin defines and adds nothing of its own.`,
    );
    assert.deepEqual(
      definedMethods(source),
      [],
      `${rel(aliasPath)} DEFINES a handler of its own.\n` +
        `\n` +
        `FIX: move the implementation to the twin under ${rel(API_PRIOR)} and\n` +
        `re-export it here.\n` +
        `\n` +
        `WHY: two addresses serving two copies of one endpoint is the failure this\n` +
        `alias layer exists to prevent. The copies drift, one of them gets the\n` +
        `bug fix, and which address a caller used decides which behavior it got.`,
    );

    const expectedSpecifier = `@/app/api/evidence/${file.replace(/\.ts$/, '')}`;
    assert.equal(
      exports[0].from,
      expectedSpecifier,
      `${rel(aliasPath)} re-exports from '${exports[0].from}' but its twin is\n` +
        `'${expectedSpecifier}'. An alias that points at the wrong endpoint serves\n` +
        `the wrong endpoint — silently, with a 200.`,
    );

    const twin = readFileSync(path.join(API_PRIOR, file), 'utf8');
    assert.deepEqual(
      exports[0].names,
      definedMethods(twin),
      `${rel(aliasPath)} re-exports [${exports[0].names.join(', ')}] but its twin\n` +
        `defines [${definedMethods(twin).join(', ')}].\n` +
        `\n` +
        `FIX: name every method the twin defines, and only those.\n` +
        `\n` +
        `WHY: an unnamed method does not 500 on the alias address — it 405s, as\n` +
        `though the endpoint did not support it. A caller reading the docs for\n` +
        `the canonical segment gets "Method Not Allowed" for a method that\n` +
        `demonstrably works one path over.`,
    );
  }
});

test('both /records pages re-export their twins and implement nothing', () => {
  for (const file of PAGE_SETTLEMENT_FILES) {
    const aliasPath = path.join(PAGES_SETTLEMENT, file);
    const source = readFileSync(aliasPath, 'utf8');
    const exports = reExports(source);

    assert.equal(
      exports.length,
      1,
      `${rel(aliasPath)} should carry exactly one \`export { … } from '…';\` line ` +
        `(found ${exports.length}).`,
    );
    const expectedSpecifier = `@/app/(app)/evidence/${file.replace(/\.tsx$/, '')}`;
    assert.equal(
      exports[0].from,
      expectedSpecifier,
      `${rel(aliasPath)} re-exports from '${exports[0].from}', not from its twin ` +
        `'${expectedSpecifier}'.`,
    );
    assert.ok(
      exports[0].names.includes('default'),
      `${rel(aliasPath)} does not re-export \`default\` — a page file without a ` +
        `default export is not a page.`,
    );
  }
});

// --- The route-segment-config mirror ------------------------------------------
//
// Measurement 2 in the header, turned into an assertion. `getPageStaticInfo`
// parses each file's own source, so a shim inherits none of its twin's
// segment config: the literals have to be repeated, and repetition drifts.

/** `export const dynamic = 'force-dynamic'` → `{ dynamic: 'force-dynamic' }`. */
function segmentConfig(source: string): Record<string, string> {
  const keys = ['dynamic', 'revalidate', 'runtime', 'fetchCache', 'dynamicParams', 'maxDuration'];
  const found: Record<string, string> = {};
  for (const key of keys) {
    const m = new RegExp(`^export\\s+const\\s+${key}\\s*=\\s*(.+?);`, 'm').exec(source);
    if (m) found[key] = m[1].trim();
  }
  return found;
}

test('each /records page mirrors its twin\'s route-segment config exactly', () => {
  for (const file of PAGE_SETTLEMENT_FILES) {
    const aliasPath = path.join(PAGES_SETTLEMENT, file);
    const twinPath = path.join(PAGES_PRIOR, file);
    assert.deepEqual(
      segmentConfig(readFileSync(aliasPath, 'utf8')),
      segmentConfig(readFileSync(twinPath, 'utf8')),
      `Route-segment config differs between ${rel(aliasPath)} and ${rel(twinPath)}.\n` +
        `\n` +
        `FIX: declare the same literals in both files. Re-exporting them does NOT\n` +
        `work: Next reads this config by parsing each file's own source, and a\n` +
        `re-export binding is invisible to that parse.\n` +
        `\n` +
        `WHY THIS IS NOT BOOKKEEPING: the config decides WHEN a page renders. A\n` +
        `\`dynamic = 'force-dynamic'\` that exists on one address and not the other\n` +
        `gives one URL fresh content per request and the other a copy frozen at\n` +
        `build time. Both return 200; only the content is wrong, and only\n` +
        `sometimes.`,
    );
  }
});
