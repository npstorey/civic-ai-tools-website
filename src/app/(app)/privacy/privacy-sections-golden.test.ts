// UX-1 P7, criterion 5: a no-change guard. P7 moves the privacy page into P0's
// page frame and its jump list onto the shared `PageToc`; the page's words are
// KEPT. This test holds the text of the page's generated sections to a golden
// (`privacy-sections.golden.json`) created from the base of P7
// (d691a7f7ca23ce1e29d0c9ea3ba299520f74da5e) in P7's first commit.
//
// WHAT IS READ. The real page (`page.tsx`), mounted on the surface harness
// under two configurations: the default (every variable the preflight declares
// cleared) and one with every optional part on, so no section is held only in
// its absent form. For each `<section id>` in document order: its id, its h2's
// text, and each statement's id, traces and text (`data-statement`,
// `data-trace`), read with P0's shared reader (`readText`).
//
// THE GOLDEN IS NOT REGENERATED IN P7. Writing it again at P7's head would
// make the guard agree with whatever the head renders. It was written at the
// base by running this file with `P7_PRIVACY_GOLDEN=write`; that the file is
// byte-identical between P7's first commit and its head is the reviewer's
// check (`git diff <first>..<head> -- <this directory>/privacy-sections.golden.json`).
//
// Run with: npm test
//   (or: node --test --experimental-strip-types 'src/app/(app)/privacy/privacy-sections-golden.test.ts')

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { h, mount, registerSurfaceHooks, SRC, type Surface } from '../../../components/sources/surface-test-harness.ts';
import { attr, readText, within } from '../../../components/ui/ui-test-helpers.ts';

// `next/script` is imported by the analytics module the page reads, never rendered by it.
registerSurfaceHooks({ 'next/script': 'export default function Script() { return null; }' });

const REPO = path.resolve(SRC, '..');
const GOLDEN = path.join(SRC, 'app', '(app)', 'privacy', 'privacy-sections.golden.json');

const { default: PrivacyPage } = await import('@/app/(app)/privacy/page');
const { ENV_SPEC } = (await import(pathToFileURL(path.join(REPO, 'scripts', 'preflight-env.mjs')).href)) as { ENV_SPEC: { name: string }[] };

// The proxy resolver reads the lower-case spellings too; they are not ENV_SPEC names.
const CLEARED = [...ENV_SPEC.map((row) => row.name), 'http_proxy', 'https_proxy', 'no_proxy'];

// Every optional part on (the privacy page suite's `FULL`). Inert values: nothing is called.
const FULL: Record<string, string> = {
  SITE_BRAND_ATTRIBUTION: 'Run by a fixture operator',
  SITE_BRAND_REPO_URL: 'https://example.test/fixture/repo',
  GITHUB_CLIENT_ID: 'fixture',
  GITHUB_CLIENT_SECRET: 'fixture',
  OIDC_ISSUER: 'https://sso.example.test',
  OIDC_CLIENT_ID: 'fixture',
  OIDC_CLIENT_SECRET: 'fixture',
  OIDC_PROVIDER_NAME: 'Fixture SSO',
  SIGN_IN_ALLOWLIST: 'fixture',
  DATABASE_URL: 'fixture',
  CRON_SECRET: 'fixture',
  KV_REST_API_URL: 'https://kv.example.test',
  KV_REST_API_TOKEN: 'fixture',
  PUBLISHER_SIGNING_KEY: 'fixture',
  PUBLISHER_KEY_ID: 'fixture',
  SOCRATA_MCP_URL: 'https://socrata.example.test',
  BOSTON_OPENCONTEXT_MCP_URL: 'https://boston.example.test',
  ROADMAP_RAW_URL: 'https://roadmap.example.test/ROADMAP.md',
  SITE_SEAL_ONLY: '1',
  NYC_CHARTER_HOSTING: 'sandbox',
  NEXT_PUBLIC_ANALYTICS_SERVICE: 'plausible',
  NEXT_PUBLIC_ANALYTICS_ID: 'pa-fixture',
};

const CONFIGS: Record<string, Record<string, string>> = { default: {}, full: FULL };

interface GoldenSection {
  id: string;
  heading: string;
  statements: { id: string; trace: string; text: string }[];
}

async function withEnv<T>(config: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const name of [...CLEARED, ...Object.keys(config)]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  Object.assign(process.env, { RATE_LIMIT_SECRET: 'fixture' }, config);
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function sectionsOf(s: Surface): GoldenSection[] {
  return s
    .elements()
    .filter((el) => el.type === 'section' && typeof el.props.id === 'string')
    .map((section) => {
      const inner = within(section);
      const heading = inner.find((el) => el.type === 'h2');
      return {
        id: String(section.props.id),
        heading: heading ? readText(heading) : '',
        statements: inner
          .filter((el) => attr(el, 'data-statement') !== null)
          .map((el) => ({ id: attr(el, 'data-statement') ?? '', trace: attr(el, 'data-trace') ?? '', text: readText(el) })),
      };
    });
}

async function render(config: Record<string, string>): Promise<GoldenSection[]> {
  return withEnv(config, async () => sectionsOf(await mount(h(PrivacyPage))));
}

const rendered: Record<string, GoldenSection[]> = {};
for (const [name, config] of Object.entries(CONFIGS)) rendered[name] = await render(config);

if (process.env.P7_PRIVACY_GOLDEN === 'write') {
  fs.writeFileSync(GOLDEN, `${JSON.stringify(rendered, null, 2)}\n`);
}

const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as Record<string, GoldenSection[]>;

test('the golden holds sections with statements in both configurations (it can fail)', () => {
  for (const name of Object.keys(CONFIGS)) {
    assert.ok(golden[name]?.length > 5, `${name}: the golden holds the page's sections`);
    assert.ok(golden[name].every((s) => s.heading !== '' && s.statements.length > 0), `${name}: every golden section has a heading and statements`);
  }
});

for (const name of Object.keys(CONFIGS)) {
  test(`criterion 5: the privacy page's generated sections render the same text as at the base (${name})`, () => {
    assert.deepEqual(
      rendered[name].map((s) => s.id),
      golden[name].map((s) => s.id),
      `${name}: the sections, in order`,
    );
    for (const [i, section] of rendered[name].entries()) {
      assert.deepEqual(section, golden[name][i], `${name}: section "${section.id}" renders as at the base`);
    }
  });
}
