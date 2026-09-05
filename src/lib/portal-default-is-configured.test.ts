/**
 * Guard: no source file under `src/` spells an open-data portal hostname (#407).
 *
 * The instance's default portal is configuration, not a literal. A hostname
 * written into a route, a component or the skill text the model reads makes one
 * deployment's city the silent default of every instance built from this
 * repository — invisible on the reference instance, wrong everywhere else. It is
 * the same defect class as a hex colour written past a design token (#217), and
 * the same one the server carries in its own tree.
 *
 * WHAT THIS GUARD NAMES, AND WHAT IT DOES NOT
 *
 * It names a *convention*, not the five hostnames #407 happened to list: the
 * `data.<org>.<tld>` / `opendata.<org>.<tld>` / `<org>.data.socrata.com` shapes
 * that open-data portals are published under, plus the aggregate endpoints this
 * codebase reaches by name. Its blind spots are stated so no one reads a green
 * as more than it is:
 *
 *   - A portal outside that convention (`performance.cityofchicago.org` was one,
 *     a bare IP, a vanity domain) is NOT matched. The guard cannot enumerate
 *     every hostname a portal might use; it catches the shape they nearly all
 *     take.
 *   - `*.test.ts` and `*.test.tsx` are OUT of scope, deliberately. A test file is
 *     not a run input and reaches no reader. The cost of that boundary is real
 *     and worth writing down: a test that hardcodes a portal can keep passing
 *     while the resolver it should be exercising regresses, which is why the
 *     resolver is pinned by behaviour elsewhere and not only by this scan.
 *   - A hostname assembled at runtime from parts, or read from a fixture this
 *     list excepts, is not matched. This is a source scan.
 *
 * EVERY EXCEPTION CARRIES ITS CLASSIFICATION. A hostname may stay in the tree
 * only as a fixture, as marketing copy, as a reference table of portals the
 * project has tested, or as documentation — never as a run-input default. The
 * second test below holds that line. While `EXCEPTIONS` is empty that test is
 * vacuous, and it is said here rather than left to be discovered: it becomes
 * load-bearing the moment the first exception is written, and it is the only
 * assertion that can fail when someone tries to keep a run-input default by
 * excepting it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);

/** Why a portal hostname is allowed to remain at a given path. */
type Classification =
  /** Test or preview data that never reaches a run input or a reader. */
  | 'fixture'
  /** Prose about the reference deployment, on a marketing surface. */
  | 'marketing-copy'
  /** A table of portals the project has tested, offered as choices, not defaults. */
  | 'reference-table'
  /** Developer documentation, not shipped text. */
  | 'documentation'
  /**
   * A value a run is started with when the caller supplied none. Never
   * exceptable — this member exists so the rule can be asserted rather than
   * only described.
   */
  | 'run-input-default';

interface Exception {
  /** Path relative to `src/`. */
  readonly path: string;
  readonly classification: Classification;
  /** Why this hostname is not a run-input default, in one sentence. */
  readonly why: string;
}

/**
 * The classified universe. #407's phase populates this from a measured census
 * of every hit and removes the rest; an entry here is a claim that the hostname
 * at that path is not a default any run can inherit.
 */
const EXCEPTIONS: readonly Exception[] = [];

/**
 * The shapes an open-data portal hostname is published under, plus the named
 * aggregate endpoints. Not the five constants #407 listed — those are instances
 * of this class, and a guard written over them would pass the sixth.
 */
const PORTAL_HOSTNAME =
  /\b(?:data|opendata)\.[a-z0-9-]+\.(?:gov|us|org|com|net|io)\b|\b[a-z0-9-]+\.data\.socrata\.com\b|\bapi\.datacommons\.org\b/gi;

const SCANNED_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|py|md)$/;
const OUT_OF_SCOPE = /\.test\.tsx?$/;

interface Hit {
  readonly path: string;
  readonly line: number;
  readonly hostname: string;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (full === THIS_FILE) return [];
    if (OUT_OF_SCOPE.test(entry.name)) return [];
    return SCANNED_EXTENSIONS.test(entry.name) ? [full] : [];
  });
}

function portalHits(): Hit[] {
  return sourceFiles(SRC_ROOT).flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((text, index) => {
        const found = text.match(PORTAL_HOSTNAME);
        if (found === null) return [];
        return found.map((hostname) => ({
          path: path.relative(SRC_ROOT, file),
          line: index + 1,
          hostname: hostname.toLowerCase(),
        }));
      }),
  );
}

test('no source file under src/ spells a portal hostname unless the exception list classifies it', () => {
  const excepted = new Set(EXCEPTIONS.map((entry) => entry.path));
  const offenders = portalHits().filter((hit) => !excepted.has(hit.path));

  const report = offenders.map((hit) => `${hit.path}:${hit.line}  ${hit.hostname}`);

  assert.deepEqual(
    report,
    [],
    `A portal hostname is configuration, not a literal (#407). The instance's ` +
      `default portal comes from one nullable resolver in src/lib/site-config.ts; ` +
      `absent means the run inputs carry no default and say so. Either route this ` +
      `site through that resolver, or add an EXCEPTIONS entry above classifying ` +
      `the hostname as a fixture, marketing copy, a reference table or ` +
      `documentation — and note that 'run-input-default' is not an exception ` +
      `the list will accept.\n\n${report.join('\n')}`,
  );
});

test('no exception classifies a hostname as a run-input default', () => {
  const smuggled = EXCEPTIONS.filter(
    (entry) => entry.classification === 'run-input-default',
  ).map((entry) => `${entry.path} — ${entry.why}`);

  assert.deepEqual(
    smuggled,
    [],
    'A run-input default cannot be excepted; that is the defect #407 names. ' +
      'Route the site through the resolver in src/lib/site-config.ts instead.',
  );
});
