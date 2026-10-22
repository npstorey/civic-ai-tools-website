// #516 P7 — the privacy page, rendered, and every statement on it traced.
//
// WHAT IS DRIVEN. The real page component (`page.tsx`) and the real facts
// module (`src/lib/privacy-facts.ts`), rendered to static markup with
// `react-dom/server` under `node --test`, under five configurations: the
// default, `plausible`, `google-analytics`, a custom model endpoint, and an
// egress proxy (#516 WF) (plus one with every optional part configured, so no
// section is checked only in its absent form). `module.registerHooks()` maps `@/` to `src/` and runs
// `.ts`/`.tsx` under `src/` through the TypeScript compiler, as
// `src/components/notebook/chat-notebook-output-layout.test.ts` does. One
// module is replaced: `next/script`, which renders nothing under
// `renderToStaticMarkup`; the replacement renders a plain `<script>` with the
// props it was given, so the tag's `src` can be compared with the page.
//
// THE TRACE RULE. The page renders headings and statements and nothing else.
// Each statement element carries `data-trace`: `env:NAME` for a variable it
// reads, `const:<module>#<export>` for a code constant it states. The check
// below fails on any text outside a traced element, on an `env:` name that
// `ENV_SPEC` (scripts/preflight-env.mjs) does not declare, and on a `const:`
// whose module has no such export. It is shown failing on fixtures first.
//
// THE CONSTANTS THE PAGE STATES BUT ANOTHER MODULE HOLDS are pinned to that
// module here: the daily limits to the real limiter, the cookie names to the
// sign-in library's `defaultCookies`, the account columns to the `users`
// table, the driver defaults to `DRIVER_SEAMS`, and each analytics host to
// the tag `AnalyticsTags` renders.
//
// A CLAIM CHECKED IN NODE, NOT IN THE BUILT ARTIFACT: analytics is inlined at
// `next build`, so that the page and the tag agree in a build is checked
// against `.next/` (the phase's acceptance 5), not here.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types 'src/app/(app)/privacy/privacy-page.test.ts')

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
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
// Never on disk: served by the load hook. It sits under `src/` so its own
// `import 'react'` resolves to this repository's React.
const SCRIPT_STUB_URL = pathToFileURL(path.join(SRC, '__civic-516-p7-next-script-stub.mjs')).href;
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

function candidatesFor(base: string): string[] {
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/script') return { url: SCRIPT_STUB_URL, format: 'module', shortCircuit: true };
    // A trace may name a route handler's export; its module imports Next's
    // server entry, which plain ESM resolves only with its file extension.
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`privacy page test hook: cannot resolve ${specifier}`);
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

const { default: PrivacyPage } = (await import('./page.tsx')) as unknown as { default: ComponentType };
const facts = await import(pathToFileURL(path.join(SRC, 'lib', 'privacy-facts.ts')).href);
const { ANALYTICS_SERVICES, AnalyticsTags } = await import(pathToFileURL(path.join(SRC, 'lib', 'analytics.tsx')).href);
const { ENV_SPEC, DRIVER_SEAMS } = await import(pathToFileURL(path.join(REPO, 'scripts', 'preflight-env.mjs')).href);
const routing = await import(pathToFileURL(path.join(SRC, 'lib', 'host-routing.ts')).href);

const DECLARED = new Set<string>((ENV_SPEC as { name: string }[]).map((row) => row.name));

// --- Configurations -------------------------------------------------------------

const LOWER_CASE_PROXY_NAMES = ['http_proxy', 'https_proxy', 'no_proxy'];

/** Every variable the preflight declares is cleared, then the configuration is set. */
function withEnv<T>(config: Record<string, string>, run: () => T): T {
  const saved: Record<string, string | undefined> = {};
  // The proxy resolver reads the lower-case spellings first, as undici does;
  // they are not ENV_SPEC names, so they are cleared here by name.
  for (const name of [...DECLARED, ...LOWER_CASE_PROXY_NAMES, ...Object.keys(config)]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  // The limiter refuses without its secret; the page never computes a key,
  // but the module is shared with routes that do.
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

const CUSTOM_MODEL_HOST = 'models.example.test';

const CONFIGS: Record<string, Record<string, string>> = {
  default: {},
  plausible: { NEXT_PUBLIC_ANALYTICS_SERVICE: 'plausible', NEXT_PUBLIC_ANALYTICS_ID: 'pa-fixture' },
  'google-analytics': { NEXT_PUBLIC_ANALYTICS_SERVICE: 'google-analytics', NEXT_PUBLIC_ANALYTICS_ID: 'G-FIXTURE' },
  'custom model endpoint': { MODEL_API_BASE_URL: `https://${CUSTOM_MODEL_HOST}/v1` },
  // #516 WF: an egress proxy, with the two configurations whose traffic it does
  // not carry, and analytics, which the browser loads.
  proxy: {
    HTTPS_PROXY: 'http://proxy.example.test:3128',
    DATABASE_URL: 'fixture',
    DB_DRIVER: 'node-postgres',
    EXECUTOR_DRIVER: 'container',
    NEXT_PUBLIC_ANALYTICS_SERVICE: 'plausible',
    NEXT_PUBLIC_ANALYTICS_ID: 'pa-fixture',
  },
  // R8 W3 (criterion 5 (a)): every hosted source on, router 0.6.0's three
  // beside NYC Charter, State legislation with a placeholder key, never a real
  // one; every page guard runs over it.
  'every hosted source': {
    SOCRATA_MCP_URL: 'https://socrata.example.test',
    NYC_CHARTER_HOSTING: 'sandbox',
    NYC_CHECKBOOK_HOSTING: 'sandbox',
    NYC_RECORD_HOSTING: 'sandbox',
    NYS_LEGISLATION_HOSTING: 'sandbox',
    NYS_LEGISLATION_API_KEY: 'placeholder-not-a-key-r8-w3',
  },
  // R8 W2 (criterion 6 [D]): the consent pause's store statements, on each
  // branch, and the all-sources page that states none of them; sign-in set as
  // `FULL` sets it. Every page guard runs over them.
  'pause, code': {
    SOURCE_ROUTING: 'in-loop',
    KV_REST_API_URL: 'https://kv.example.test',
    KV_REST_API_TOKEN: 'fixture',
    GITHUB_CLIENT_ID: 'fixture',
    GITHUB_CLIENT_SECRET: 'fixture',
    OIDC_ISSUER: 'https://sso.example.test',
    OIDC_CLIENT_ID: 'fixture',
    OIDC_CLIENT_SECRET: 'fixture',
    OIDC_PROVIDER_NAME: 'Fixture SSO',
    SIGN_IN_ALLOWLIST: 'fixture',
    DATABASE_URL: 'fixture',
  },
  'pause, no code': {
    SOURCE_ROUTING: 'in-loop',
    KV_REST_API_URL: 'https://kv.example.test',
    KV_REST_API_TOKEN: 'fixture',
    GITHUB_CLIENT_ID: 'fixture',
    GITHUB_CLIENT_SECRET: 'fixture',
    OIDC_ISSUER: 'https://sso.example.test',
    OIDC_CLIENT_ID: 'fixture',
    OIDC_CLIENT_SECRET: 'fixture',
    OIDC_PROVIDER_NAME: 'Fixture SSO',
    SIGN_IN_ALLOWLIST: 'fixture',
  },
  'pause, memory': {
    SOURCE_ROUTING: 'in-loop',
  },
  'pause, all-sources': {
    KV_REST_API_URL: 'https://kv.example.test',
    KV_REST_API_TOKEN: 'fixture',
    GITHUB_CLIENT_ID: 'fixture',
    GITHUB_CLIENT_SECRET: 'fixture',
    OIDC_ISSUER: 'https://sso.example.test',
    OIDC_CLIENT_ID: 'fixture',
    OIDC_CLIENT_SECRET: 'fixture',
    OIDC_PROVIDER_NAME: 'Fixture SSO',
    SIGN_IN_ALLOWLIST: 'fixture',
    DATABASE_URL: 'fixture',
  },
};

// Every optional part on, so no section is checked only in its absent form.
// Inert values throughout: nothing here is called.
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

function render(config: Record<string, string>): string {
  return withEnv(config, () => renderToStaticMarkup(createElement(PrivacyPage)));
}

const RENDERED: Record<string, string> = Object.fromEntries(
  [...Object.entries(CONFIGS), ['full', FULL] as const].map(([name, config]) => [name, render(config)]),
);

/** Visible text: tags dropped, the `<!-- -->` React writes between expressions dropped, entities decoded. */
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

interface TracedElement { id: string; traces: string[]; text: string }

// A statement is a `<p>`, or, when it carries a list, a `<div>` holding its
// lead, the list and any text after it. Neither nests inside itself.
function statements(html: string): TracedElement[] {
  return [...html.matchAll(/<(p|div)[^>]*data-statement="([^"]*)"[^>]*data-trace="([^"]*)"[^>]*>(.*?)<\/\1>/g)].map((m) => ({
    id: m[2],
    traces: m[3].split(' ').filter(Boolean),
    text: text(m[4]),
  }));
}

// --- The trace check, and fixtures it must fail ---------------------------------

async function traceProblems(html: string): Promise<string[]> {
  const problems: string[] = [];
  // Text outside headings and traced statements.
  const untraced = text(
    html
      .replace(/<h[12][^>]*>.*?<\/h[12]>/g, '')
      .replace(/<(p|div)[^>]*data-trace="[^"]+"[^>]*>.*?<\/\1>/g, ''),
  );
  if (untraced !== '') problems.push(`untraced text: "${untraced}"`);
  for (const element of statements(html)) {
    if (element.traces.length === 0) problems.push(`${element.id}: no trace`);
    for (const trace of element.traces) {
      const env = /^env:(.+)$/.exec(trace);
      const constant = /^const:(.+)#(.+)$/.exec(trace);
      if (env) {
        if (!DECLARED.has(env[1])) problems.push(`${element.id}: ${trace} is not an ENV_SPEC variable`);
      } else if (constant) {
        const [, module, name] = constant;
        const specifier = module.startsWith('src/') ? pathToFileURL(path.join(REPO, module)).href : module;
        let exported: Record<string, unknown> | null = null;
        try {
          exported = (await import(specifier)) as Record<string, unknown>;
        } catch {
          problems.push(`${element.id}: ${trace} names a module that does not load`);
          continue;
        }
        if (!Object.hasOwn(exported, name)) problems.push(`${element.id}: ${trace} names no export of ${module}`);
      } else {
        problems.push(`${element.id}: ${trace} is neither env: nor const:`);
      }
    }
  }
  return problems;
}

test('the trace check fails on a statement that traces to neither a variable nor a constant', async () => {
  assert.equal((await traceProblems('<p>An untraced sentence.</p>')).length, 1);
  assert.match((await traceProblems('<p data-statement="x" data-trace="env:NOT_A_DECLARED_VARIABLE">A.</p>'))[0], /not an ENV_SPEC variable/);
  assert.match(
    (await traceProblems('<p data-statement="x" data-trace="const:src/lib/privacy-facts.ts#NO_SUCH_EXPORT">A.</p>'))[0],
    /names no export/,
  );
  assert.match((await traceProblems('<p data-statement="x" data-trace="because">A.</p>'))[0], /neither env: nor const:/);
  assert.deepEqual(await traceProblems('<h2>Heading</h2><p data-statement="x" data-trace="env:SITE_SEAL_ONLY">A.</p>'), []);
});

test('the trace check fails on untraced text inside a list item, and passes a traced list', async () => {
  const traced =
    '<div data-statement="x" data-trace="env:SITE_SEAL_ONLY"><p>Lead:</p><ul><li>One.</li><li>Two.</li></ul><p>After.</p></div>';
  assert.deepEqual(await traceProblems(traced), []);
  const untraced = await traceProblems(`${traced}<ul><li>An untraced item.</li></ul>`);
  assert.equal(untraced.length, 1);
  assert.match(untraced[0], /untraced text: "An untraced item\."/);
  const emptyTrace = await traceProblems('<div data-statement="x" data-trace=""><ul><li>An item.</li></ul></div>');
  assert.ok(emptyTrace.some((problem) => /untraced text/.test(problem)), 'a list whose element carries no trace passed');
});

for (const name of [...Object.keys(CONFIGS), 'full']) {
  test(`${name}: every statement on the page traces to a configuration value or a named code constant`, async () => {
    const html = RENDERED[name];
    assert.ok(statements(html).length >= 8, `${name}: the page rendered ${statements(html).length} statement(s); expected at least 8`);
    assert.deepEqual(await traceProblems(html), []);
  });
}

// R8 W3 criterion 5 (a): every per-source statement traces its own source's
// hosting switch and no other source's (the check is
// `src/lib/privacy-hosted-switch-trace.ts`, shared with the stubbed-manifest
// test that shows it red on the base's code).
test('R8 W3 criterion 5 (a): every per-source statement traces its own source\'s switch and no other source\'s hosting switch', async () => {
  const check = await import(pathToFileURL(path.join(SRC, 'lib', 'privacy-hosted-switch-trace.ts')).href);
  const { CIVIC_MANIFEST } = await import('@typedstandards/civic-typed-router');
  const all = RENDERED['every hosted source'];
  for (const family of ['recipient-hosted-', 'recipient-hosted-exchange-', 'held-sandbox-platform-']) {
    const ids = statements(all).map((s) => s.id).filter((id) => check.perSourceStatement(id)?.family === family);
    assert.deepEqual(ids.map((id) => check.perSourceStatement(id).sourceId).sort(), ['nyc-charter', 'nyc-checkbook', 'nyc-record', 'nys-legislation'], `premise: ${family} states every hosted source`);
  }
  for (const name of [...Object.keys(CONFIGS), 'full']) {
    const found = statements(RENDERED[name]);
    assert.ok(found.some((s) => s.id === 'source-row-data-commons'), `premise: ${name} renders the remote Data Commons row`);
    assert.deepEqual(check.switchTraceProblems(found, CIVIC_MANIFEST), [], `${name}: a per-source statement traces a switch not its own`);
  }
});

// --- Acceptance 2: exactly the configured analytics service and model host -----

const ANALYTICS_TEXT = Object.entries(facts.ANALYTICS_RECIPIENTS as Record<string, { name: string; host: string }>);

for (const [name, expected] of [
  ['default', null],
  ['custom model endpoint', null],
  ['plausible', 'plausible'],
  ['proxy', 'plausible'],
  ['google-analytics', 'google-analytics'],
] as const) {
  test(`${name}: the page names exactly the configured analytics service`, () => {
    const page = text(RENDERED[name]);
    for (const [service, { name: label, host }] of ANALYTICS_TEXT) {
      if (service === expected) {
        assert.ok(page.includes(label) && page.includes(host), `${name}: the page does not name ${label} at ${host}`);
      } else {
        assert.ok(!page.includes(label) && !page.includes(host), `${name}: the page names ${label} or ${host}, which is not configured`);
      }
    }
    const analyticsStatements = statements(RENDERED[name]).filter((s) => s.id.startsWith('recipient-analytics'));
    assert.equal(analyticsStatements.length, expected === null ? 0 : 1);
  });
}

test('the page names exactly the configured model host', () => {
  for (const name of ['default', 'plausible', 'google-analytics']) {
    const model = statements(RENDERED[name]).find((s) => s.id === 'recipient-model');
    assert.ok(model?.text.includes('openrouter.ai'), `${name}: the model statement does not name the default host`);
  }
  const custom = statements(RENDERED['custom model endpoint']).find((s) => s.id === 'recipient-model');
  assert.ok(custom?.text.includes(CUSTOM_MODEL_HOST), 'the model statement does not name the configured host');
  assert.ok(!text(RENDERED['custom model endpoint']).includes('openrouter.ai'), 'the page names the default model host under a custom endpoint');
});

test("each analytics host on the page is the one the service's tag loads from", () => {
  assert.deepEqual(Object.keys(facts.ANALYTICS_RECIPIENTS).sort(), [...ANALYTICS_SERVICES].sort());
  for (const service of ANALYTICS_SERVICES as string[]) {
    const markup = renderToStaticMarkup(createElement(AnalyticsTags, { config: { service, id: 'fixture-id' } }));
    const sources = [...markup.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&')).host);
    assert.deepEqual(sources, [facts.ANALYTICS_RECIPIENTS[service].host], `${service}: tag sources ${sources.join(', ')}`);
  }
});

// --- Acceptance 3: nothing the app cannot read -----------------------------------

const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX|lorem|ipsum|placeholder|coming soon|to be (written|added|decided))\b|\[[^\]]*\]|\{\{/i;
const LEGAL = /\b(GDPR|CCPA|HIPAA|COPPA|lawful basis|legitimate interest|data controller|data processor|compliant|compliance|comply|complies|we (do not|never) sell)\b/i;
// A duration attached to a recipient's keeping: other parties' retention.
const OTHER_PARTY_RETENTION = /\b(keeps?|kept|retains?|retained|deletes?|deleted|stores?|stored)\b[^.]*\b\d+\s*(minutes?|hours?|days?|weeks?|months?|years?)\b/i;
// The account settings with the model service, stated as a setting.
const ENDPOINT_SETTING = /\b(does not|doesn't|never|will not|won't) (train|learn|use your|keep)\b|\bno[- ]training\b|\bzero data retention\b/i;

for (const name of [...Object.keys(CONFIGS), 'full']) {
  test(`${name}: the page states only what the app can read, and says what is the operator's to state`, () => {
    const html = RENDERED[name];
    const page = text(html);
    assert.ok(page.includes(facts.OPERATOR_STATES), `${name}: the page does not say what is the operator's to state`);
    for (const item of facts.OPERATOR_STATES_ITEMS as string[]) {
      assert.ok(page.includes(item), `${name}: the operator's-to-state list lacks "${item}"`);
    }
    assert.doesNotMatch(page, PLACEHOLDER, `${name}: placeholder text`);
    assert.doesNotMatch(page, LEGAL, `${name}: a legal position`);
    assert.doesNotMatch(page, ENDPOINT_SETTING, `${name}: the model service's account setting, stated`);
    for (const element of statements(html).filter((s) => s.id.startsWith('recipient-'))) {
      assert.doesNotMatch(element.text, OTHER_PARTY_RETENTION, `${name}: ${element.id} states how long another party keeps something`);
    }
  });
}

// --- The full configuration: every optional part is stated -----------------------

test('full: every configured part has its statement', () => {
  const ids = statements(RENDERED.full).map((s) => s.id);
  for (const id of [
    'operator',
    'source-code',
    'sign-in-gate',
    'cookies',
    'account-row',
    'prompt-text',
    'prompt-text-database',
    'record-title',
    'recipient-counter-store',
    'recipient-transparency-log',
    'recipient-source-socrata',
    'recipient-source-boston-opencontext',
    'recipient-sign-in-github',
    'recipient-sign-in-oidc',
    'recipient-database-neon',
    'recipient-hosted-nyc-charter',
    'recipient-hosted-exchange-nyc-charter',
    'recipient-analytics-plausible',
  ]) {
    assert.ok(ids.includes(id), `full: no "${id}" statement`);
  }
  const page = text(RENDERED.full);
  assert.match(page, /seals records only/, 'full: seal-only is not stated');
  assert.match(page, /deleted by a daily cleanup once they are 24 hours old/, 'full: the upload cleanup is not stated');
  assert.ok(page.includes('sso.example.test'), 'full: the sign-in provider host is not named');
  assert.ok(page.includes('roadmap.example.test'), 'full: the roadmap host is not named');
});

test('default: unset parts are omitted or stated as absent, never filled in', () => {
  const html = RENDERED.default;
  const ids = statements(html).map((s) => s.id);
  for (const id of ['operator', 'source-code', 'cookies', 'account-row', 'recipient-transparency-log', 'recipient-source-socrata']) {
    assert.ok(!ids.includes(id), `default: a "${id}" statement rendered with nothing configured`);
  }
  const page = text(html);
  assert.match(page, /no cleanup configured/);
  assert.match(page, /held in the server's memory only/);
  assert.match(page, /Vercel Sandbox/, 'default: the default executor is not stated');
});

test('the executor setting is stated under each value', () => {
  for (const [value, pattern] of [
    ['container', /in a container on the operator's own server/],
    ['lambda', /AWS Lambda function/],
    ['none', /does not run notebooks/],
    ['something-else', /does not recognize/],
  ] as const) {
    const page = text(render({ EXECUTOR_DRIVER: value }));
    assert.match(page, pattern, `EXECUTOR_DRIVER=${value}`);
  }
});

// --- #516 WF: the statements the cold read found missing -------------------------
//
// Each test below fails on the tree before WF, at its assertion: the statement
// it looks for is not on the page, or the constant it reads is not exported.

function statementOf(html: string, id: string): TracedElement | undefined {
  return statements(html).find((s) => s.id === id);
}

test("proxy: the operator's proxy is named, with what it does not carry here", () => {
  assert.equal(typeof facts.PROXY_STATEMENT, 'string', 'privacy-facts.ts exports no PROXY_STATEMENT');
  const proxy = statementOf(RENDERED.proxy, 'recipient-proxy');
  assert.ok(proxy, 'the page names no proxy while HTTPS_PROXY is set');
  assert.ok(proxy.text.includes(facts.PROXY_ALWAYS_EXEMPT), 'the exempt addresses are not stated');
  const exceptions = facts.PROXY_EXCEPTIONS as Record<string, string>;
  // Configured here: node-postgres and the container executor. Not configured: the rest.
  for (const [kind, configured] of [
    ['Database, `DB_DRIVER=node-postgres`', true],
    ['Notebook execution, `EXECUTOR_DRIVER=container`', true],
    ['Notebook execution, `EXECUTOR_DRIVER=lambda`', false],
    ['Notebook execution, `EXECUTOR_DRIVER=vercel-sandbox`', false],
  ] as const) {
    assert.equal(typeof exceptions[kind], 'string', `no proxy exception for "${kind}"`);
    assert.equal(proxy.text.includes(exceptions[kind]), configured, `"${kind}": its exception ${configured ? 'is missing' : 'is stated, but it is not configured'}`);
  }
  assert.ok(proxy.text.includes(facts.PROXY_NOT_ANALYTICS), 'with analytics configured, the page does not say analytics bypasses the proxy');
});

test('proxy: named under each spelling the resolver reads, and absent when no proxy is set', () => {
  for (const name of ['default', 'plausible', 'google-analytics', 'custom model endpoint']) {
    assert.equal(statementOf(RENDERED[name], 'recipient-proxy'), undefined, `${name}: a proxy statement with no proxy set`);
  }
  const spellings: Record<string, string>[] = [{ HTTP_PROXY: 'http://proxy.example.test:3128' }, { https_proxy: 'http://proxy.example.test:3128' }];
  for (const config of spellings) {
    const html = render(config);
    assert.ok(statementOf(html, 'recipient-proxy'), `${Object.keys(config)[0]}: the page names no proxy`);
    assert.ok(statementOf(html, 'recipient-proxy')?.text.includes(facts.PROXY_EXCEPTIONS['Notebook execution, `EXECUTOR_DRIVER=vercel-sandbox`']),
      'the default executor runs the notebook in a managed sandbox, and the page does not say its requests leave from there');
    assert.ok(!statementOf(html, 'recipient-proxy')?.text.includes(facts.PROXY_NOT_ANALYTICS), 'the analytics sentence with no analytics configured');
  }
});

test('analytics: the address the service receives carries what a reader types, stated per service', () => {
  const inputs = facts.READER_INPUT_ADDRESSES as { path: string; param: string; what: string }[] | undefined;
  assert.ok(Array.isArray(inputs) && inputs.length >= 2, 'privacy-facts.ts exports no READER_INPUT_ADDRESSES');
  for (const [config, service, kept] of [
    ['plausible', 'plausible', /discards the query part/],
    ['google-analytics', 'google-analytics', /page's full address, leaving out only any part after #/],
  ] as const) {
    const analytics = statementOf(RENDERED[config], `recipient-analytics-${service}`);
    assert.ok(analytics, `${config}: no analytics statement`);
    for (const entry of inputs) {
      assert.ok(analytics.text.includes(`${entry.path}?${entry.param}=…`), `${config}: ${entry.path}?${entry.param}= is not named`);
      assert.ok(analytics.text.includes(entry.what), `${config}: "${entry.what}" is not stated`);
    }
    assert.match(analytics.text, kept, `${config}: what the service keeps of the address is not stated`);
    const recipient = facts.ANALYTICS_RECIPIENTS[service] as { reads: { url: string; sentence: string; read: string }[] };
    assert.ok(recipient.reads.some((r) => /quer|URL/i.test(r.sentence) && r.read === facts.VENDOR_READ_DATE), `${service}: no dated read behind the address statement`);
  }
});

test("analytics: each tag sends the page's own address, with no override", () => {
  // The statement above rests on the services' defaults; a tag that set its own
  // page address would make it wrong.
  for (const service of ANALYTICS_SERVICES as string[]) {
    const markup = renderToStaticMarkup(createElement(AnalyticsTags, { config: { service, id: 'fixture-id' } }));
    assert.doesNotMatch(markup, /page_location|page_path|\burl\s*:|\bu\s*:/, `${service}: the tag overrides the page address`);
  }
  const plausible = renderToStaticMarkup(createElement(AnalyticsTags, { config: { service: 'plausible', id: 'fixture-id' } }));
  assert.match(plausible, /plausible\.init\(\)/, 'plausible.init is called with options');
});

// The query parameters the pages read, from the tree: `searchParams.get('x')`,
// `search.get('x')`, `params.get('x')` on a page's search parameters, a
// destructured `{ x } = await searchParams`, and `url.searchParams.has(X)`.
// Blind spot: a parameter read some other way (a raw `location.search` parse)
// is not seen; none exists in the tree this was written against.
const CHOICE_PARAMS = new Set([
  // `/directory`, both tabs: the tab and the filter, sort and page controls.
  'tab', 'domain', 'level', 'transport', 'official', 'platform', 'sort', 'country', 'govLevel', 'ownerType', 'page', 'pageSize',
  // `/ask`: the sign-in intent flag another host sets (`SIGN_IN_INTENT_PARAM`).
  'signin',
  // `/dev/notebook-preview`: a development page that 404s in production.
  'state',
]);

function pageQueryParams(): Map<string, string[]> {
  const files = execFileSync('git', ['ls-files', 'src'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith('src/app/api/'));
  const found = new Map<string, string[]>();
  const add = (param: string, file: string) => found.set(param, [...(found.get(param) ?? []), file]);
  for (const file of files) {
    const source = fs.readFileSync(path.join(REPO, file), 'utf8');
    for (const m of source.matchAll(/\b(?:searchParams|search)\.(?:get|has)\(\s*['"]([^'"]+)['"]/g)) add(m[1], file);
    for (const m of source.matchAll(/\{([^{};=]*)\}\s*=\s*await\s+searchParams\b/g)) {
      for (const part of m[1].split(',')) {
        const name = part.split(':')[0].trim();
        if (name) add(name, file);
      }
    }
    for (const m of source.matchAll(/\b(?:searchParams\.(?:get|has)|params)\[?\(?\s*(SIGN_IN_INTENT_PARAM)\b/g)) add(m[1], file);
  }
  return found;
}

test('every query parameter a page reads is a stated reader input or a choice from its own controls', async () => {
  const inputs = (facts.READER_INPUT_ADDRESSES ?? []) as { param: string }[];
  assert.ok(inputs.length > 0, 'privacy-facts.ts exports no READER_INPUT_ADDRESSES');
  const { SIGN_IN_INTENT_PARAM } = await import(pathToFileURL(path.join(SRC, 'lib', 'sign-in-intent.ts')).href);
  const found = pageQueryParams();
  if (found.has('SIGN_IN_INTENT_PARAM')) {
    found.set(SIGN_IN_INTENT_PARAM, found.get('SIGN_IN_INTENT_PARAM')!);
    found.delete('SIGN_IN_INTENT_PARAM');
  }
  assert.ok(found.has('q') && found.has('tab'), `the scan found ${[...found.keys()].join(', ') || 'nothing'}; it is not reading the tree`);
  const stated = new Set(inputs.map((entry) => entry.param));
  const unclassified = [...found.keys()].filter((param) => !stated.has(param) && !CHOICE_PARAMS.has(param));
  assert.deepEqual(unclassified, [], `query parameters no list accounts for: ${unclassified.map((p) => `${p} (${found.get(p)!.join(', ')})`).join('; ')}`);
  const unread = [...stated, ...CHOICE_PARAMS].filter((param) => !found.has(param));
  assert.deepEqual(unread, [], `listed parameters no page reads: ${unread.join(', ')}`);
});

test('the executor statements say the notebook sent to run includes the question, and the synthesizer bears it out', async () => {
  assert.equal(typeof facts.NOTEBOOK_CARRIES_QUESTION, 'string', 'privacy-facts.ts exports no NOTEBOOK_CARRIES_QUESTION');
  for (const [config, id] of [
    [{}, 'recipient-executor-vercel-sandbox'],
    [{ EXECUTOR_DRIVER: 'container' }, 'recipient-executor-container'],
    [{ EXECUTOR_DRIVER: 'lambda' }, 'recipient-executor-lambda'],
  ] as const) {
    const executor = statementOf(render(config), id);
    assert.ok(executor?.text.includes(facts.NOTEBOOK_CARRIES_QUESTION), `${id}: the question is not stated`);
  }
  const { synthesizeNotebook } = await import(pathToFileURL(path.join(SRC, 'lib', 'notebook-author', 'synthesize.ts')).href);
  const question = 'WF-QUESTION-CANARY-how many permits in 2026';
  const out = synthesizeNotebook({
    query: question,
    defaultPortal: 'data.example.test',
    modelName: 'fixture/model',
    modelAccess: 'fixture',
    finalAnswer: 'An answer that does not repeat it.',
    toolCalls: [],
    generatedAt: '2026-10-18T00:00:00.000Z',
  });
  assert.ok(JSON.stringify(out.notebook).includes(question), 'the notebook the synthesizer builds does not carry the question');
  // The route builds the notebook from the question as asked, before any
  // visibility exists: the publish dialog is reached only after the run.
  const route = fs.readFileSync(path.join(SRC, 'app', 'api', 'query-notebook', 'route.ts'), 'utf8');
  assert.match(route, /synthesizeNotebook\(\{\s*query:\s*body\.query,/, 'query-notebook no longer builds the notebook from the question as asked');
  assert.doesNotMatch(route, /promptVisibility|hash_only/, 'query-notebook now reads a visibility; the statement needs a caveat');
});

test("the page states a published record's creator attribution, and the list builder bears it out", async () => {
  assert.equal(typeof facts.CREATOR_ATTRIBUTION, 'string', 'privacy-facts.ts exports no CREATOR_ATTRIBUTION');
  const withDb = render({ DATABASE_URL: 'fixture', GITHUB_CLIENT_ID: 'fixture', GITHUB_CLIENT_SECRET: 'fixture' });
  assert.equal(statementOf(withDb, 'creator-attribution')?.text, facts.CREATOR_ATTRIBUTION);
  assert.equal(statementOf(RENDERED.full, 'creator-attribution'), undefined, 'seal-only: the attribution of a public record is stated, but nothing is public');
  const { buildRecordListItems } = await import(pathToFileURL(path.join(SRC, 'lib', 'evidence', 'record-list.ts')).href);
  const [item] = buildRecordListItems(
    [{ id: 'r', slug: 's', title: 't', summary: 'x', model: 'm', verificationStatus: 'unverified', withdrawnAt: null, reinstatedAt: null, createdAt: new Date(), creatorId: 'c' }],
    { creators: new Map([['c', { displayName: 'WF-CREATOR-NAME' }]]), attestationCounts: null },
  );
  assert.equal(item.creatorName, 'WF-CREATOR-NAME', 'the public list does not carry the creator name');
});

test('the page lists the device-client names, API token names and attestation text the site keeps, each pinned', async () => {
  assert.ok(Array.isArray(facts.ALSO_KEPT_ITEMS), 'privacy-facts.ts exports no ALSO_KEPT_ITEMS');
  const kept = statementOf(RENDERED.full, 'also-kept');
  assert.ok(kept, 'full: no "also-kept" statement');
  for (const item of facts.ALSO_KEPT_ITEMS as string[]) assert.ok(kept.text.includes(item), `"${item}" is not on the page`);
  assert.ok(kept.text.includes(facts.ATTESTATION_TEXT_IS_SERVED));
  assert.equal(statementOf(RENDERED.default, 'also-kept'), undefined, 'default: no database, yet the list renders');
  const { getTableColumns } = await import('drizzle-orm');
  const schema = await import(pathToFileURL(path.join(SRC, 'lib', 'db', 'schema.ts')).href);
  for (const [table, columns] of [
    ['deviceCodes', ['clientName']],
    ['apiTokens', ['name', 'scope', 'lastUsedAt']],
    ['attestationNodes', ['payload']],
  ] as const) {
    const present = Object.keys(getTableColumns(schema[table]));
    for (const column of columns) assert.ok(present.includes(column), `${table}.${column} is gone; the statement names it`);
  }
  // The text reaches the signed attestation: a lifecycle reason in the node,
  // a review's body in its payload.
  process.env.PUBLISHER_KEY_ID = 'fixture';
  try {
    const { buildAttestationNode, ATTESTATION_WITHDRAWS } = await import(pathToFileURL(path.join(SRC, 'lib', 'evidence', 'attestation.ts')).href);
    const { node } = buildAttestationNode({
      type: ATTESTATION_WITHDRAWS,
      targetNodeId: 'a'.repeat(64),
      signer: { bindingTier: 'self-asserted', identifier: 'fixture.invalid', displayName: 'Fixture' },
      reason: 'WF-REASON-CANARY',
    });
    assert.ok(JSON.stringify(node).includes('WF-REASON-CANARY'), 'a withdrawal reason does not reach the signed node');
  } finally {
    delete process.env.PUBLISHER_KEY_ID;
  }
  const { buildExpertAttestationPayload } = await import(pathToFileURL(path.join(SRC, 'lib', 'evidence', 'expert-attestation.ts')).href);
  const payload = buildExpertAttestationPayload(
    { body: 'WF-REVIEW-CANARY', expertise: 'fixture', rating: 'neutral' },
    { dbUserId: 'u', githubId: 'k', displayName: 'n', githubProfileUrl: 'https://example.test/n' },
    null,
    '2026-10-18T00:00:00.000Z',
  );
  assert.ok(JSON.stringify(payload).includes('WF-REVIEW-CANARY'), "a review's body does not reach its signed payload");
});

// R6 W3 (#632, criterion 13): what the hosting platform keeps of each data
// source it runs is no longer the operator's to state; the held statement
// says it, in Vercel's words with its page. Before W3 this test pinned the
// operator item; it now pins that the held statement has taken its place.
test("what the platform keeps of a hosted data source is stated by the held statement, not listed as the operator's to state", () => {
  const items = facts.OPERATOR_STATES_ITEMS as string[];
  assert.ok(!items.some((item) => /notebook run/.test(item) && /data source/.test(item)), "the operator's-to-state list still names the platform's keeping of data-source runs");
  assert.ok(statementOf(RENDERED.full, 'held-sandbox-platform-nyc-charter'), 'full: the held statement for the hosted source is not on the page');
});

test("the sealed-record sentence says the record's fingerprint can still be looked up", () => {
  assert.equal(typeof facts.SEALED_FINGERPRINT_LOOKUP, 'string', 'privacy-facts.ts exports no SEALED_FINGERPRINT_LOOKUP');
  for (const name of ['default', 'full']) {
    const sealed = statementOf(RENDERED[name], 'seal-only');
    assert.ok(sealed?.text.includes(facts.SEALED_FINGERPRINT_LOOKUP), `${name}: the fingerprint lookup is not stated`);
  }
});

// --- Constants stated here and held elsewhere, pinned to their holders ---------

test("the daily limits stated are the limiter's, by default and overridden", async () => {
  const rateLimit = await import(pathToFileURL(path.join(SRC, 'lib', 'rate-limit.ts')).href);
  process.env.RATE_LIMIT_SECRET = 'fixture';
  const anonymous = await rateLimit.checkRateLimit('fixture-reader', false);
  const signedIn = await rateLimit.checkRateLimit('fixture-account', true);
  assert.equal(anonymous.limit, facts.DEFAULT_ANONYMOUS_LIMIT);
  assert.equal(signedIn.limit, facts.DEFAULT_AUTHENTICATED_LIMIT);
  const limits = statements(render({ GITHUB_CLIENT_ID: 'fixture', GITHUB_CLIENT_SECRET: 'fixture', ANONYMOUS_RATE_LIMIT: '3', AUTHENTICATED_RATE_LIMIT: '7' }))
    .find((s) => s.id === 'daily-limits');
  assert.match(limits?.text ?? '', /ask 3 questions a day; signed in, 7\./);
});

test("the cookie names stated are the sign-in library's defaults, and src overrides none", () => {
  const require = nodeModule.createRequire(import.meta.url);
  const { defaultCookies } = require(path.join(REPO, 'node_modules', 'next-auth', 'core', 'lib', 'cookie.js')) as {
    defaultCookies(secure: boolean): Record<string, { name: string }>;
  };
  const stated = (facts.SIGN_IN_COOKIES as { name: string }[]).map((cookie) => cookie.name).sort();
  assert.deepEqual(Object.values(defaultCookies(false)).map((cookie) => cookie.name).sort(), stated);
  const secure = Object.values(defaultCookies(true)).map((cookie) => cookie.name);
  assert.ok(secure.every((name) => name.startsWith('__Secure-') || name.startsWith('__Host-')));
  assert.deepEqual(secure.filter((name) => name.startsWith('__Host-')), [`__Host-${facts.HOST_PREFIXED_COOKIE}`]);
  assert.doesNotMatch(fs.readFileSync(path.join(SRC, 'lib', 'auth.ts'), 'utf8'), /\bcookies\s*:/, 'auth.ts sets a cookies option');
});

test('the account columns stated are the users table, in both directions', async () => {
  const { getTableColumns } = await import('drizzle-orm');
  const { users } = await import(pathToFileURL(path.join(SRC, 'lib', 'db', 'schema.ts')).href);
  assert.deepEqual(Object.keys(facts.ACCOUNT_COLUMNS).sort(), Object.keys(getTableColumns(users)).sort());
});

test("the driver defaults stated are the preflight's", () => {
  assert.equal(facts.DEFAULT_DB_DRIVER, DRIVER_SEAMS.db.default);
  assert.equal(facts.DEFAULT_BLOB_DRIVER, DRIVER_SEAMS.blob.default);
});

// --- Acceptance 4: served on both hosts, linked from the footer ------------------

test('/privacy is dual-served: in DUAL_SERVED_PATHS, classified so, and served by every host role', () => {
  assert.ok((routing.DUAL_SERVED_PATHS as readonly string[]).includes('/privacy'));
  assert.equal(routing.classifyPath('/privacy'), 'dual-served');
  const SPLIT = routing.readHostRoutingConfig({ APP_HOST: 'app.example.org', MARKETING_HOST: 'example.org' });
  for (const host of ['app.example.org', 'example.org']) {
    assert.deepEqual(routing.decideRoute(host, '/privacy', SPLIT), { kind: 'serve' }, host);
  }
  assert.ok(fs.existsSync(path.join(HERE, 'page.tsx')), 'no page at src/app/(app)/privacy/page.tsx');
});

test('the footer, which the root layout renders on both surfaces, links to /privacy', () => {
  const layout = fs.readFileSync(path.join(SRC, 'app', 'layout.tsx'), 'utf8');
  const footer = /<footer[\s\S]*?<\/footer>/.exec(layout)?.[0] ?? '';
  assert.ok(footer.length > 0, 'src/app/layout.tsx has no <footer>');
  assert.match(footer, /href="\/privacy"/, 'the footer does not link to /privacy');
});

// --- UX pass row 6 (b): the order, the jump list, the page's own statement ------------------------
//
// The consent sections ("How consent works", "When we ask again", "What
// recipients keep") come first; "How this page is written" sits just above
// "What this page cannot tell you", and says in two sentences what the page
// is; under the title, a jump list of every heading, in page order, each a
// link to its section. The jump list is a traced element like every other:
// its words are the headings `buildPrivacySections` returns. The statements'
// ids and traces do not change. At the base the page opened with "How this
// page is written", had no jump list, and the statement was three sentences.

const NEW_BASIS = "What this site does with what you send it. Every line is read from the site's own settings or its code when the page is served, or from a named page with the date it was read.";
const h2s = (html: string) => [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => text(m[1]));
const sectionIds = (html: string) => [...html.matchAll(/<section[^>]*id="([^"]+)"/g)].map((m) => m[1]);

for (const name of [...Object.keys(CONFIGS), 'full']) {
  test(`UX pass row 6 (${name}): consent first, "How this page is written" above "What this page cannot tell you"`, () => {
    const shown = h2s(RENDERED[name]);
    assert.deepEqual(shown.slice(0, 3), ['How consent works', 'When we ask again', 'What recipients keep'], `${name}: the page opens with ${shown.slice(0, 3).join(' · ')}`);
    assert.equal(shown.at(-1), 'What this page cannot tell you');
    assert.equal(shown.at(-2), 'How this page is written', `${name}: the order ends ${shown.slice(-3).join(' · ')}`);
  });

  test(`UX pass row 6 (${name}): a jump list under the title links every heading, in page order`, () => {
    const html = RENDERED[name];
    const nav = /<nav[^>]*>(.*?)<\/nav>/.exec(html);
    assert.ok(nav, `${name}: no jump list`);
    assert.ok(html.indexOf('<nav') > html.indexOf('</h1>') && html.indexOf('<nav') < html.indexOf('<h2'), `${name}: the jump list is not between the title and the first heading`);
    const links = [...nav![1].matchAll(/<a href="#([^"]+)"[^>]*>(.*?)<\/a>/g)].map((m) => [m[1], text(m[2])]);
    const ids = sectionIds(html);
    assert.deepEqual(links.map(([, label]) => label), h2s(html), `${name}: the jump list is not the headings in page order`);
    assert.deepEqual(links.map(([id]) => id), ids, `${name}: a jump-list link does not reach its section`);
  });

  test(`UX pass row 6 (${name}): "How this page is written" says what the page is, in two sentences, with its id and trace`, () => {
    const basis = statements(RENDERED[name]).find((s) => s.id === 'basis');
    assert.ok(basis, 'premise: the basis statement renders');
    assert.equal(basis!.text, NEW_BASIS);
    assert.deepEqual(basis!.traces, ['const:src/lib/privacy-facts.ts#PAGE_BASIS']);
  });
}
