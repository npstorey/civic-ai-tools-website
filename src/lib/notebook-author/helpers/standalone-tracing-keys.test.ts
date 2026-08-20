// Route-key validity for next.config.ts file tracing (wave N5 P1).
//
// Sibling to standalone-tracing.test.ts, which pins the *value* side of the
// `outputFileTracingIncludes` declaration (the helpers glob). This file pins
// the *key* side: every key in `outputFileTracingIncludes` AND
// `outputFileTracingExcludes` must match at least one route that actually
// exists, under the matching semantics of the installed Next.
//
// Why: during #179 P4 the key was written as 'src/app/api/query-notebook/route'
// — a source path. Next never matches keys against source paths, so the key
// was silently inert: the build succeeded, the include was dropped, and the
// only symptom was a runtime 500 in a standalone deployment. A key is config
// that LOOKS declarative but is really a pattern matched against generated
// route strings; nothing in the build validates it.
//
// The installed Next (16.3.0) consumes these keys in two places:
//
//   1. Webpack builds — next/dist/build/collect-build-traces.js
//      ("apply-include-excludes" span): each key is compiled with
//      `picomatch(key, { dot: true, contains: true })` and tested against
//      `normalizeAppPath(entryName)` for app routes (normalizePagePath for
//      pages/). entryName is like 'app/api/query-notebook/route', and
//      normalizeAppPath KEEPS the leading 'app' segment while stripping
//      route groups and the trailing 'page'/'route' segment, so the string
//      matched is '/app/api/query-notebook'. Includes and excludes use the
//      same route string. (Static pages and edge routes are skipped there,
//      so "matches a route" is necessary, not sufficient.)
//
//   2. Turbopack builds (this repo's default builder) — the matching lives in
//      the native binary; its source is crates/next-api/src/nft.rs at the
//      installed version's tag (v16.3.0). Keys are compiled with
//      `Glob::new(key, GlobOptions { contains: true, .. })` and tested against
//      a DIFFERENT string shape: `app{originalName}` for includes (e.g.
//      'app/api/query-notebook/route' — groups and the trailing segment are
//      NOT stripped) and `/app{originalName}` for excludes (tracing_exclude_glob
//      prefixes '/'). turbo-tasks-fs Glob is not callable from Node; for the
//      keys this config uses (literal paths and '**') its contains-mode
//      matching agrees with picomatch's, which is what this test uses for
//      those shapes too.
//
// A key is only trustworthy if it matches under BOTH consumers, so each key
// is asserted against the webpack-normalized shape and the Turbopack shape.
//
// The route inventory is DERIVED by walking src/app for page/route entry
// files — never hardcoded — so renaming or deleting a route cannot leave
// this test asserting against a stale inventory.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HELPERS_DIR, '../../../..');
const APP_DIR = path.join(REPO_ROOT, 'src', 'app');

// ---------------------------------------------------------------------------
// Next's own matcher and normalizer — the exact modules its webpack-path
// build code requires in collect-build-traces.js, not lookalikes.
// ---------------------------------------------------------------------------
const requireFromHere = createRequire(import.meta.url);

type Matcher = (candidate: string) => boolean;
type Picomatch = (pattern: string, options: { dot: boolean; contains: boolean }) => Matcher;

const picomatch = requireFromHere('next/dist/compiled/picomatch') as Picomatch;
const { normalizeAppPath } = requireFromHere(
  'next/dist/shared/lib/router/utils/app-paths',
) as { normalizeAppPath: (route: string) => string };

/** Compile a tracing key the way both consumers do: contains-mode glob. */
function keyMatcher(key: string): Matcher {
  return picomatch(key, { dot: true, contains: true });
}

// ---------------------------------------------------------------------------
// Route inventory, derived from the filesystem.
// ---------------------------------------------------------------------------

/** Recursively collect app-router entry files (page.* / route.*). */
function collectEntryFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Underscore-prefixed folders are private (not routable) in the App
      // Router — e.g. src/app/(marketing)/talks/_decks.
      if (entry.name.startsWith('_')) continue;
      found.push(...collectEntryFiles(path.join(dir, entry.name)));
    } else if (/^(page|route)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

/**
 * Entry names in the shape Next generates them: 'app/' + app-dir-relative
 * path without the extension, posix separators — e.g.
 * 'app/api/query-notebook/route', 'app/(marketing)/page'. This repo has no
 * pages/ directory, so the app router is the whole inventory.
 */
function deriveEntryNames(): string[] {
  return collectEntryFiles(APP_DIR).map((file) => {
    const rel = path.relative(APP_DIR, file).split(path.sep).join('/');
    return `app/${rel.replace(/\.(ts|tsx|js|jsx)$/, '')}`;
  });
}

const entryNames = deriveEntryNames();

// The three route-string shapes the installed Next matches keys against.
const webpackRoutes = entryNames.map((name) => normalizeAppPath(name)); // '/app/api/query-notebook'
const turbopackIncludeNames = entryNames; // 'app/api/query-notebook/route'
const turbopackExcludeRoutes = entryNames.map((name) => `/${name}`); // '/app/api/query-notebook/route'

/** Assert one tracing key matches at least one derived route in every shape-set. */
function assertKeyMatchesSomeRoute(
  key: string,
  configField: string,
  shapeSets: Array<{ label: string; routes: string[] }>,
): void {
  const isMatch = keyMatcher(key);
  for (const { label, routes } of shapeSets) {
    assert.ok(
      routes.some((route) => isMatch(route)),
      `${configField} key '${key}' matches no actual route under the ${label} ` +
        `semantics of the installed Next — it would be silently inert there ` +
        `(the #179 P4 trapdoor). Derived route strings checked: ${JSON.stringify(routes)}`,
    );
  }
}

// Load the real config with the standalone flag set, so the
// standalone-gated `outputFileTracingExcludes` block is present. The env
// write is process-local; node --test runs each test file in its own child
// process, so nothing leaks into other test files.
process.env.BUILD_STANDALONE = '1';
const configPromise = import('../../../../next.config.ts');

test('route inventory is derived and non-empty', () => {
  assert.ok(entryNames.length > 0, `no page/route entry files found under ${APP_DIR}`);
  for (const route of webpackRoutes) {
    // Shape invariant of the derivation: normalizeAppPath keeps the 'app'
    // segment, so every derived route string starts with '/app'. A failure
    // here means the walker or the normalizer is being fed the wrong thing.
    assert.match(route, /^\/app(\/|$)/, `unexpected normalized route shape: ${route}`);
  }
});

test('every outputFileTracingIncludes key matches at least one actual route', async () => {
  const { default: nextConfig } = await configPromise;
  const includes = nextConfig.outputFileTracingIncludes ?? {};
  const keys = Object.keys(includes);
  assert.ok(keys.length > 0, 'outputFileTracingIncludes vanished from next.config.ts — nothing left to validate');
  for (const key of keys) {
    assertKeyMatchesSomeRoute(key, 'outputFileTracingIncludes', [
      { label: 'webpack (normalized route)', routes: webpackRoutes },
      { label: 'Turbopack (app{originalName})', routes: turbopackIncludeNames },
    ]);
  }
});

test('every outputFileTracingExcludes key matches at least one actual route', async () => {
  const { default: nextConfig } = await configPromise;
  const excludes = nextConfig.outputFileTracingExcludes ?? {};
  const keys = Object.keys(excludes);
  assert.ok(
    keys.length > 0,
    'outputFileTracingExcludes is absent even with BUILD_STANDALONE=1 — the standalone trim (#179/#281) is gone',
  );
  for (const key of keys) {
    assertKeyMatchesSomeRoute(key, 'outputFileTracingExcludes', [
      { label: 'webpack (normalized route)', routes: webpackRoutes },
      { label: 'Turbopack (/app{originalName})', routes: turbopackExcludeRoutes },
    ]);
  }
});

test('negative control: the pre-#281 source-path key form matches nothing', () => {
  // Pins the matcher itself. If the matching here were wired so loosely that
  // any key passes, this is the assertion that would catch it: the exact key
  // shape that caused the #179 P4 incident must fail against every shape-set.
  const inertKey = 'src/app/api/query-notebook/route';
  const isMatch = keyMatcher(inertKey);
  for (const routes of [webpackRoutes, turbopackIncludeNames, turbopackExcludeRoutes]) {
    assert.equal(
      routes.some((route) => isMatch(route)),
      false,
      `source-path key '${inertKey}' unexpectedly matched a route — the matcher no longer mirrors Next's semantics`,
    );
  }
});
