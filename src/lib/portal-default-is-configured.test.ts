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
 * project has tested, as the fixed domain of a named data-source server, or as
 * documentation — never as a run-input default. The second test below holds
 * that line. `EXCEPTIONS` is populated as of #407, so that test is no longer
 * vacuous: it is the only assertion that can fail when someone tries to keep a
 * run-input default by excepting it.
 *
 * THE TEST OF A RUN-INPUT DEFAULT, since the list is now a set of claims about
 * which hostnames are not one. A hostname is a run-input default when a run
 * that named no portal INHERITS it — when it becomes the `portal` argument of a
 * call, a span attribute on the trace, or a line in a document derived from the
 * record. It is not one when it is data captured from a past run, prose about a
 * deployment, a menu of portals offered as choices, the fixed home of a server
 * this codebase routes to by name, or a comment. Each entry below states which,
 * and a wrong classification is a claim standing in the tree.
 *
 * TWO EXTENSIONS #407 MADE, AND WHY EACH WAS NEEDED.
 *
 *   - `server-endpoint` joined the classifications. `api.datacommons.org` and
 *     `data.boston.gov` are not one instance's city and cannot be configured
 *     away: they are where a NAMED server this codebase routes to lives, or
 *     where the data that server fronts actually is. Sweeping them in with the
 *     city defaults would have said something false about them, and excepting
 *     them as "documentation" would have said nothing at all.
 *   - EVERY EXCEPTION DECLARES ITS HIT COUNT, and the first test checks it.
 *     Exceptions are matched by PATH, so without this a file on the list is
 *     unguarded for as long as it stays on it — and the list's own first
 *     customer, `components/QueryForm.tsx`, is a file that carried a run-input
 *     default AND a reference table in the same 12 lines. A count is stable
 *     under every edit that does not add a hostname, and fails on the one that
 *     does: a sixth portal added to a five-portal menu, or a run-input default
 *     written into a file whose other hostnames are legitimately excepted. It
 *     is bidirectional for the same reason the model-call registry's
 *     assertions are — it fails when the tree grows past the claim AND when the
 *     claim outlives the tree.
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
  /**
   * The fixed domain of a NAMED data-source server this codebase routes to —
   * its own host, or the host the data it fronts actually lives on. Not one
   * instance's city and not configurable per instance: an operator who points
   * at a different server names a different server, they do not re-home this
   * one.
   */
  | 'server-endpoint'
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
  /**
   * How many hostname occurrences this classification covers. Checked, so the
   * exception guards the file rather than exempting it: adding a hostname to an
   * excepted file fails until someone states what the new one is.
   */
  readonly hits: number;
  /** Why this hostname is not a run-input default, in one sentence. */
  readonly why: string;
}

/**
 * The classified universe, measured at `77e51bd`: 102 hits across 24 files, of
 * which #407 routed 6 files to zero through the resolver in `site-config.ts`
 * (the two compare routes, the notebook route, `QuerySurface`, `McpFlowDiagram`
 * and `McpResponseDisplay`) and classified the 18 below. An entry here is a
 * claim that the hostnames at that path are not a default any run can inherit.
 */
const EXCEPTIONS: readonly Exception[] = [
  {
    path: 'lib/bpmn/traces.ts',
    classification: 'fixture',
    hits: 21,
    why: 'Captured tool-call arguments from past runs, replayed on /explore as a recording of what those runs did; nothing here starts a run.',
  },
  {
    path: 'lib/mcp/socrata-skill.ts',
    classification: 'reference-table',
    hits: 21,
    why: 'The Well-Tested Domains table, the per-portal Key Datasets lookup and the `data.<org>.<tld>` naming-convention templates the model is told to derive an unknown portal from — portals offered to the model as choices, while the one default this text states is interpolated from the resolved run portal and is absent when the run has none.',
  },
  {
    path: 'lib/mcp/tools.ts',
    classification: 'reference-table',
    hits: 11,
    why: "Worked examples of the `portal` argument's shape in the tool descriptions, plus the Boston server's own domain; a portal the model copies from one becomes a portal that call actually addressed, never a value substituted into a call that omitted it.",
  },
  {
    path: 'app/(marketing)/learn/page.tsx',
    classification: 'marketing-copy',
    hits: 6,
    why: 'Teaching copy on /learn quoting real skill text and a real tool call so a reader can see what one looks like; the page starts no run.',
  },
  {
    path: 'components/QueryForm.tsx',
    classification: 'reference-table',
    hits: 5,
    why: 'The `PORTALS` menu — the portals a reader may pick, beside an "All portals" entry; a selection made here is the reader\'s choice, and the form\'s own default now comes from `SITE_DEFAULT_PORTAL` through `DefaultPortalProvider`.',
  },
  {
    path: 'lib/streaming.ts',
    classification: 'reference-table',
    hits: 5,
    why: "`getPortalCity`'s portal-to-city display map, which translates a portal a run already named into a reader's word for it and supplies none when it does not recognise one.",
  },
  {
    path: 'lib/notebook-author/tool-to-cell.ts',
    classification: 'server-endpoint',
    hits: 4,
    why: 'Citation labels and dataset URLs for the Boston OpenContext server, which is CKAN-native and fronts exactly this domain — a resource id from that server is on that host, so the citation states where the fetched data actually lives.',
  },
  {
    path: 'components/SkillPromptDisclosure.tsx',
    classification: 'reference-table',
    hits: 3,
    why: 'Curated excerpts of the skill text, shown to a reader so they can see the dataset knowledge the model was given; a disclosure surface, not an input.',
  },
  {
    path: 'lib/mcp/boston-skill.ts',
    classification: 'server-endpoint',
    hits: 3,
    why: 'The domain the Boston OpenContext server fronts, named in the guidance that tells the model what that server covers and how to cite it.',
  },
  {
    path: 'lib/notebook-author/helpers/fetch_opencontext.py',
    classification: 'server-endpoint',
    hits: 3,
    why: "The CKAN DataStore API base URL of the Boston server this helper exists to call; it is that server's address, not a portal a run chooses.",
  },
  {
    path: 'components/notebook/__dev__/sampleExecutedNotebook.ts',
    classification: 'fixture',
    hits: 2,
    why: 'A hand-built executed-notebook sample for the dev preview route, never reachable from a run.',
  },
  {
    path: 'lib/mcp/registry.ts',
    classification: 'server-endpoint',
    hits: 2,
    why: "Google Data Commons' hosted MCP endpoint, already overridable through `DATA_COMMONS_MCP_URL` — a third-party public service every instance reaches at the same address, not one deployment's city, and the trace records it as real configured routing for exactly that reason (#258 A9).",
  },
  {
    path: 'lib/notebook-author/helpers/fetch_data_commons.py',
    classification: 'server-endpoint',
    hits: 2,
    why: "The Data Commons observation API this helper calls; the same third-party service address as the registry entry above.",
  },
  {
    path: 'app/(app)/dev/notebook-preview/NotebookPreviewClient.tsx',
    classification: 'fixture',
    hits: 1,
    why: 'The portal prop of the dev-only /dev/notebook-preview page, which states on its face that it drives no live traffic and renders the fixture above.',
  },
  {
    path: 'components/notebook/NotebookOutput.tsx',
    classification: 'documentation',
    hits: 1,
    why: 'A worked example inside the JSDoc of the `portal` prop, describing the shape of a value the caller supplies.',
  },
  {
    path: 'lib/mcp/client.ts',
    classification: 'documentation',
    hits: 1,
    why: "A code comment recording where the Data Commons hosted endpoint lives, beside the routing that reaches it.",
  },
  {
    path: 'lib/notebook-author/fixtures/README.md',
    classification: 'documentation',
    hits: 1,
    why: 'The recorded argument list that produced the checked-in pre-stamp package, written down so the fixture can be regenerated and audited.',
  },
  {
    path: 'lib/notebook-author/helpers/fetch_socrata.py',
    classification: 'documentation',
    hits: 1,
    why: "A worked example in the helper's docstring, describing the shape of the `portal` parameter its caller passes.",
  },
];

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

test('every exception still describes the tree, hostname for hostname', () => {
  const counted = new Map<string, number>();
  for (const hit of portalHits()) {
    counted.set(hit.path, (counted.get(hit.path) ?? 0) + 1);
  }

  // Bidirectional, and both directions are the point. An excepted file that
  // GREW a hostname is the run-input default someone parked behind a
  // classification that does not cover it; an excepted file that SHRANK is a
  // claim outliving the tree it describes. Both read as a mismatched pair.
  const drifted = EXCEPTIONS.flatMap((entry) => {
    const actual = counted.get(entry.path) ?? 0;
    return actual === entry.hits
      ? []
      : [`${entry.path} — classified ${entry.hits} as ${entry.classification}, found ${actual}`];
  });

  assert.deepEqual(
    drifted,
    [],
    `An exception states how many hostnames its classification covers, because ` +
      `exceptions are matched by PATH and would otherwise exempt a whole file ` +
      `(#407). A file that grew one: say what the new hostname is — if a run ` +
      `that named no portal can inherit it, it is a run-input default and ` +
      `belongs in the resolver, not on this list. A file that lost one, or that ` +
      `no longer exists: drop or correct the entry.\n\n${drifted.join('\n')}`,
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
