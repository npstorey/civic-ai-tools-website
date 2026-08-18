// Drift guard: the route-class arrays in `host-routing.ts` vs. the actual
// `src/app/` filesystem (#259 P1).
//
// WHY THIS FILE EXISTS, and why it is separate from `host-routing.test.ts`.
//
// `MARKETING_PATHS`, `APP_PRIVATE_PATHS` and `DUAL_SERVED_PATHS` are a
// HAND-MAINTAINED MIRROR of the route groups under `src/app/`. Nothing in
// the type system, the build, or the runtime ties the two together: the
// module is deliberately free of Node builtins so it runs unchanged in the
// edge runtime, so it cannot read the directory it describes. That leaves
// the arrays as a comment that happens to be executable — and comments rot.
//
// The rot is silent in the worst direction. `classifyPath()` falls back to
// `'other'` for anything it does not recognize, and `'other'` is SERVED
// under every host role. So a page added under `src/app/(marketing)/`
// without a matching array entry does not 404 on an app-role host — it
// SERVES. Reference marketing content appears on an operator's instance,
// with nothing in the response, the logs, or any test to say so. The
// failure mode of forgetting is "leaks", not "breaks", which is exactly the
// kind of defect a test has to catch because a human never will.
//
// So: this file reads the filesystem, `host-routing.test.ts` does not. That
// split is the point of keeping them apart — the sibling file pins the pure
// decision logic and would run against a published copy of the module with
// no repo around it; this one is a statement about the shape of THIS
// repository and only makes sense inside it.
//
// These tests pass on today's tree. Their entire value is the failure they
// will produce for someone else, later — so the assertion messages are
// written to be read cold, by a contributor who has never opened
// `host-routing.ts`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyPath,
  APP_PRIVATE_PATHS,
  DUAL_SERVED_PATHS,
  MARKETING_PATHS,
  type PathClass,
} from './host-routing.ts';

// --- Route derivation ---------------------------------------------------------

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const MARKETING_GROUP = path.join(APP_DIR, '(marketing)');
const APP_GROUP = path.join(APP_DIR, '(app)');

/** A routable file and the URL path it answers on. */
interface DerivedRoute {
  /** URL pathname, e.g. `/about`. Dynamic segments keep their brackets. */
  url: string;
  /** Repo-relative source path, for the failure message. */
  file: string;
}

/** Files that define a route in the App Router. `page` and `route` cannot
 *  coexist in one segment, so no de-duplication is needed. */
const ROUTE_FILE = /^(page|route)\.(tsx|ts|jsx|js|mdx)$/;

/**
 * Segments that contribute nothing to the URL, or take the file out of
 * normal routing entirely:
 * - `(group)`  — route group: erased from the URL. This is why
 *                `(marketing)/about/page.tsx` is `/about` and not
 *                `/(marketing)/about`, and why `(marketing)/page.tsx` is the
 *                site root.
 * - `@slot`    — parallel-route slot: rendered into a layout, not addressed
 *                on its own.
 * - `_private` — underscore-prefixed folders are excluded from routing.
 *
 * None of the three exist under either group today; they are handled so that
 * the day one appears, this guard reports the truth rather than a fiction.
 * Intercepting routes (`(.)foo`) are not modeled — they would be read as
 * groups here. None exist, and one appearing under these groups would be a
 * routing change big enough to reach this file anyway.
 */
function segmentKind(segment: string): 'erased' | 'excluded' | 'literal' {
  if (segment.startsWith('(') && segment.endsWith(')')) return 'erased';
  if (segment.startsWith('@')) return 'excluded';
  if (segment.startsWith('_')) return 'excluded';
  return 'literal';
}

/** Every URL served by a route file under `groupDir`, in sorted order. */
function derivedRoutes(groupDir: string): DerivedRoute[] {
  const entries = readdirSync(groupDir, { withFileTypes: true, recursive: true });
  const routes: DerivedRoute[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !ROUTE_FILE.test(entry.name)) continue;

    // `entry.parentPath` is absolute; make it relative to the group root so
    // only the segments below the group are considered.
    const relDir = path.relative(groupDir, entry.parentPath);
    const segments = relDir === '' ? [] : relDir.split(path.sep);
    if (segments.some((s) => segmentKind(s) === 'excluded')) continue;

    const urlSegments = segments.filter((s) => segmentKind(s) === 'literal');
    routes.push({
      url: `/${urlSegments.join('/')}`.replace(/\/$/, '') || '/',
      file: path.relative(path.resolve(APP_DIR, '..', '..'), path.join(entry.parentPath, entry.name)),
    });
  }

  return routes.sort((a, b) => a.url.localeCompare(b.url));
}

const MARKETING_ROUTES = derivedRoutes(MARKETING_GROUP);
const APP_ROUTES = derivedRoutes(APP_GROUP);

/** `url  ← file` lines, for pasting into an assertion message. */
function listing(routes: DerivedRoute[]): string {
  const width = Math.max(...routes.map((r) => r.url.length));
  return routes.map((r) => `    ${r.url.padEnd(width)}  <-  ${r.file}`).join('\n');
}

// --- Sanity: the derivation itself works --------------------------------------
//
// If the walker silently found nothing, every assertion below would pass
// vacuously and this whole file would be decoration. Pin that it does not.

test('route derivation finds pages in both route groups', () => {
  assert.ok(
    MARKETING_ROUTES.length > 0,
    `Found no route files under src/app/(marketing)/. Either the route group moved\n` +
      `or this test's walker is broken — every other assertion in this file passes\n` +
      `vacuously when this happens, so fix it here rather than trusting the greens.`,
  );
  assert.ok(APP_ROUTES.length > 0, 'Found no route files under src/app/(app)/ — see above.');
});

test('the (marketing) group root is the site root, and stays out of MARKETING_PATHS', () => {
  // `(marketing)/page.tsx` is `/`, which classifyPath answers 'root' — a
  // class of its own, because the app host REDIRECTS `/` rather than
  // withholding it. Pinned so that nobody reading the guard below "fixes" a
  // failure by adding '/' to MARKETING_PATHS, which would make the app
  // host's front door 404 instead of redirecting to the query surface.
  assert.ok(
    MARKETING_ROUTES.some((r) => r.url === '/'),
    'Expected a page at src/app/(marketing)/page.tsx serving the site root.',
  );
  assert.equal(classifyPath('/'), 'root');
  assert.ok(
    !(MARKETING_PATHS as readonly string[]).includes('/'),
    "MARKETING_PATHS must not contain '/': the root is its own route class ('root'),\n" +
      'and the app host redirects it to the query surface. Listing it as a marketing\n' +
      'path would withhold the app surface\'s own front door.',
  );
});

// --- The guard: filesystem -> array -------------------------------------------

/** Routes under a group whose URL does not land in an expected class. */
function misclassified(routes: DerivedRoute[], expected: readonly PathClass[]): DerivedRoute[] {
  return routes.filter((r) => r.url !== '/' && !expected.includes(classifyPath(r.url)));
}

test('every page under src/app/(marketing)/ is covered by MARKETING_PATHS', () => {
  const undeclared = misclassified(MARKETING_ROUTES, ['marketing']);

  assert.deepEqual(
    undeclared.map((r) => r.url),
    [],
    `MARKETING_PATHS in src/lib/host-routing.ts is out of date.\n` +
      `\n` +
      `These pages exist under src/app/(marketing)/ but no entry in\n` +
      `MARKETING_PATHS covers their URL:\n` +
      `\n` +
      `${listing(undeclared)}\n` +
      `\n` +
      `FIX: add the first URL segment of each line above to MARKETING_PATHS\n` +
      `(nested pages are covered by prefix, so '/pricing' covers\n` +
      `'/pricing/enterprise' too). A page at a top-level DYNAMIC segment\n` +
      `('/[city]') cannot be covered by a static prefix and needs a routing\n` +
      `decision, not an array entry — bring it to the host-topology owner.\n` +
      `\n` +
      `WHY THIS IS NOT BOOKKEEPING: classifyPath() falls back to 'other' for\n` +
      `any path it does not recognize, and 'other' is SERVED under every host\n` +
      `role. A marketing page missing from this array therefore SERVES on an\n` +
      `app-role host instead of 404ing there. That is reference marketing\n` +
      `content appearing on an operator's own instance, silently: nothing in\n` +
      `the response says the page was never meant to be there, and no other\n` +
      `test in this repo will notice. The array is the only thing standing\n` +
      `between the two behaviors.`,
  );
});

test('every page under src/app/(app)/ is covered by APP_PRIVATE_PATHS or DUAL_SERVED_PATHS', () => {
  const undeclared = misclassified(APP_ROUTES, ['app-private', 'dual-served']);

  assert.deepEqual(
    undeclared.map((r) => r.url),
    [],
    `APP_PRIVATE_PATHS / DUAL_SERVED_PATHS in src/lib/host-routing.ts are out of date.\n` +
      `\n` +
      `These pages exist under src/app/(app)/ but neither array covers their URL:\n` +
      `\n` +
      `${listing(undeclared)}\n` +
      `\n` +
      `FIX: decide which one each belongs in, then add it.\n` +
      `  - APP_PRIVATE_PATHS — the gated surface. Serves on the app host,\n` +
      `    404s on the marketing host.\n` +
      `  - DUAL_SERVED_PATHS — public product surface that happens to live in\n` +
      `    the (app) group for structural reasons. Serves on BOTH hosts.\n` +
      `    /evidence is here because published evidence URLs must keep\n` +
      `    resolving on the public face; that is a product decision, not a\n` +
      `    default. Do not add to this array to make a test pass.\n` +
      `\n` +
      `WHY THIS IS NOT BOOKKEEPING: unclassified paths fall to 'other', which\n` +
      `is SERVED under every host role — including the marketing host. A gated\n` +
      `page missing from APP_PRIVATE_PATHS is therefore reachable on the\n` +
      `public marketing face, which is the opposite of what putting it in the\n` +
      `(app) group was meant to express. (Withholding is topology, not\n` +
      `security — the access gate is still sign-in — but a route the topology\n` +
      `was supposed to hide showing up on the public host is a real defect.)`,
  );
});

// --- The reverse guard: array -> filesystem -----------------------------------
//
// Stale entries are the milder failure — a withheld URL that nothing serves
// anyway. They still matter: the array is read as the inventory of what
// exists, so a phantom entry misleads the next person, and it will quietly
// swallow a real page if one later appears at that URL in a DIFFERENT route
// group, classifying it 'marketing' and withholding it from the app host.

function entriesWithoutPages(
  declared: readonly string[],
  routes: DerivedRoute[],
): string[] {
  return declared.filter(
    (prefix) => !routes.some((r) => r.url === prefix || r.url.startsWith(`${prefix}/`)),
  );
}

test('every MARKETING_PATHS entry has a page behind it', () => {
  const orphans = entriesWithoutPages(MARKETING_PATHS, MARKETING_ROUTES);

  assert.deepEqual(
    orphans,
    [],
    `MARKETING_PATHS in src/lib/host-routing.ts has entries with no page behind them:\n` +
      `\n` +
      `${orphans.map((p) => `    ${p}`).join('\n')}\n` +
      `\n` +
      `Nothing under src/app/(marketing)/ serves these URLs.\n` +
      `\n` +
      `FIX: if the page was deleted, delete the entry. If it MOVED to another\n` +
      `route group, that is a routing change and not a cleanup — the URL now\n` +
      `classifies 'marketing' (withheld on the app host) while being served\n` +
      `from a group that expected otherwise, so work out where it should\n` +
      `classify before touching the array.`,
  );
});

test('every APP_PRIVATE_PATHS and DUAL_SERVED_PATHS entry has a page behind it', () => {
  const orphans = [
    ...entriesWithoutPages(APP_PRIVATE_PATHS, APP_ROUTES),
    ...entriesWithoutPages(DUAL_SERVED_PATHS, APP_ROUTES),
  ];

  assert.deepEqual(
    orphans,
    [],
    `APP_PRIVATE_PATHS / DUAL_SERVED_PATHS in src/lib/host-routing.ts have entries\n` +
      `with no page behind them:\n` +
      `\n` +
      `${orphans.map((p) => `    ${p}`).join('\n')}\n` +
      `\n` +
      `Nothing under src/app/(app)/ serves these URLs. If the page was deleted,\n` +
      `delete the entry; if it moved out of the (app) group, settle where the\n` +
      `URL should classify before editing the array.`,
  );
});
