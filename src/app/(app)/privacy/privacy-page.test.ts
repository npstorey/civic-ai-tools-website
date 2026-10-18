// #516 P7 — the privacy page, rendered, and every statement on it traced.
//
// WHAT IS DRIVEN. The real page component (`page.tsx`) and the real facts
// module (`src/lib/privacy-facts.ts`), rendered to static markup with
// `react-dom/server` under `node --test`, under four configurations: the
// default, `plausible`, `google-analytics`, and a custom model endpoint (plus
// a fifth with every optional part configured, so no section is checked only
// in its absent form). `module.registerHooks()` maps `@/` to `src/` and runs
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

/** Every variable the preflight declares is cleared, then the configuration is set. */
function withEnv<T>(config: Record<string, string>, run: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const name of [...DECLARED, ...Object.keys(config)]) {
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

function statements(html: string): TracedElement[] {
  return [...html.matchAll(/<p[^>]*data-statement="([^"]*)"[^>]*data-trace="([^"]*)"[^>]*>(.*?)<\/p>/g)].map((m) => ({
    id: m[1],
    traces: m[2].split(' ').filter(Boolean),
    text: text(m[3]),
  }));
}

// --- The trace check, and fixtures it must fail ---------------------------------

async function traceProblems(html: string): Promise<string[]> {
  const problems: string[] = [];
  // Text outside headings and traced statements.
  const untraced = text(
    html
      .replace(/<h[12][^>]*>.*?<\/h[12]>/g, '')
      .replace(/<p[^>]*data-trace="[^"]+"[^>]*>.*?<\/p>/g, ''),
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

// --- Acceptance 2: exactly the configured analytics service and model host -----

const ANALYTICS_TEXT = Object.entries(facts.ANALYTICS_RECIPIENTS as Record<string, { name: string; host: string }>);

for (const [name, expected] of [
  ['default', null],
  ['custom model endpoint', null],
  ['plausible', 'plausible'],
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
