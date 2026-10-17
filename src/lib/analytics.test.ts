// #516 P2 — page analytics is two variables, read at build:
// `NEXT_PUBLIC_ANALYTICS_SERVICE` and `NEXT_PUBLIC_ANALYTICS_ID`.
//
// THE RULE (G0-2, ruled (A)). If either new name is non-empty, the new pair
// alone decides. Otherwise a non-empty `NEXT_PUBLIC_GA_MEASUREMENT_ID` (the
// prior-era variable) means `google-analytics` with that id. Empty counts as
// absent for all three names. An unknown service, or one of the pair without
// the other, renders nothing, and preflight names the problem.
//
// WHAT IS DRIVEN. The real decision (`resolveAnalytics`) and the real
// component (`AnalyticsTags`) from `src/lib/analytics.tsx`, rendered to
// static markup with `react-dom/server`. One module is replaced, for that file
// only: `next/script`. The real one renders nothing under
// `renderToStaticMarkup` for `afterInteractive` (measured: `""`), so a test
// over it could not fail. The replacement records the props it is given and
// renders a plain `<script>` carrying them, so what is asserted is exactly
// what the component hands to Next. What Next then emits is checked against a
// built `.next/` (the phase's acceptance 2), not here.
//
// THE TWO EXPECTED SHAPES.
//   - Google Analytics: the two scripts the root layout carried at `41f4e40`
//     (`src/app/layout.tsx:230-245`), copied with their whitespace: the same
//     source and the same initialization text.
//   - Plausible: the vendor's own snippet, read 2026-10-17 from the
//     installation-instructions source of the vendor's open-source repository
//     (plausible/analytics, `lib/plausible_web/live/installation/instructions.ex`
//     at 2e385f14, lines 178-183): an `async` script from
//     `https://plausible.io/js/<id>.js` and a two-line inline initializer. The
//     vendor's docs page for Next.js points to a library that renders the same
//     two through `next/script`. The id is the per-site script key the
//     vendor's site settings show (`pa-` and a 21-character nanoid), not the
//     site's domain, which only the vendor's older script took.
//
// ALSO HERE: the preflight rows and group, the compose and Dockerfile
// declarations, and the deploy guide's Analytics section, so one file states
// every place a new name must be declared.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/analytics.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
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
const REPO = path.resolve(HERE, '..', '..');
const MODULE_FILE = path.join(HERE, 'analytics.tsx');
// Never on disk: served by the load hook below. It sits beside this file so
// its own `import 'react'` resolves to this repository's React.
const STUB_URL = pathToFileURL(path.join(HERE, '__civic-516-p2-next-script-stub.mjs')).href;

interface ScriptProps { [key: string]: unknown; children?: unknown }
const recorded: ScriptProps[] = [];
(globalThis as unknown as { __p2Scripts: ScriptProps[] }).__p2Scripts = recorded;

const NEXT_SCRIPT_STUB = `
  import { createElement } from 'react';
  export default function Script(props) {
    globalThis.__p2Scripts.push({ ...props });
    const { children, strategy, ...rest } = props;
    const inner = typeof children === 'string' ? { dangerouslySetInnerHTML: { __html: children } } : {};
    return createElement('script', { ...rest, 'data-strategy': strategy, ...inner });
  }`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier === 'next/script' && parent?.startsWith('file:') && fileURLToPath(parent) === MODULE_FILE) {
      return { url: STUB_URL, format: 'module', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl === STUB_URL) return { format: 'module', source: NEXT_SCRIPT_STUB, shortCircuit: true };
    if (loadUrl.startsWith('file:') && fileURLToPath(loadUrl) === MODULE_FILE) {
      const out = ts.transpileModule(fs.readFileSync(MODULE_FILE, 'utf8'), {
        fileName: MODULE_FILE,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      return { format: 'module', source: out.outputText, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

const { ANALYTICS_SERVICES, AnalyticsTags, resolveAnalytics } = await import(MODULE_FILE);
const { ENV_SPEC, ENV_GROUPS, evaluateEnv, renderReport } = await import(path.join(REPO, 'scripts/preflight-env.mjs'));
const { checkRepository } = await import(path.join(REPO, 'scripts/check-compose-env.mjs'));

const SERVICE = 'NEXT_PUBLIC_ANALYTICS_SERVICE';
const ID = 'NEXT_PUBLIC_ANALYTICS_ID';
const PRIOR = 'NEXT_PUBLIC_GA_MEASUREMENT_ID';

function render(env: Record<string, string>): { markup: string; scripts: ScriptProps[] } {
  recorded.length = 0;
  const markup = renderToStaticMarkup(createElement(AnalyticsTags, { config: resolveAnalytics(env) }));
  return { markup, scripts: recorded.map((p) => ({ ...p })) };
}

// The layout's text at 41f4e40, whitespace included.
const gaInit = (id: string) =>
  `\n              window.dataLayer = window.dataLayer || [];\n              function gtag(){dataLayer.push(arguments);}\n              gtag('js', new Date());\n              gtag('config', '${id}');\n            `;
const todaysGoogleScripts = (id: string): ScriptProps[] => [
  { src: `https://www.googletagmanager.com/gtag/js?id=${id}`, strategy: 'afterInteractive' },
  { id: 'ga4-init', strategy: 'afterInteractive', children: gaInit(id) },
];

// The vendor's two initializer lines, as instructions.ex@2e385f14:181-182 gives them.
const PLAUSIBLE_INIT_LINES = [
  'window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};',
  'plausible.init()',
];

function assertNothing(env: Record<string, string>, why: string) {
  const { markup, scripts } = render(env);
  assert.equal(markup, '', `${why}: rendered ${markup}`);
  assert.deepEqual(scripts, [], `${why}: handed props to next/script`);
}

function assertGoogle(env: Record<string, string>, id: string, why: string) {
  const { markup, scripts } = render(env);
  assert.deepEqual(scripts, todaysGoogleScripts(id), `${why}: not today's two scripts`);
  assert.equal(
    markup,
    `<script src="https://www.googletagmanager.com/gtag/js?id=${id}" data-strategy="afterInteractive"></script>` +
      `<script id="ga4-init" data-strategy="afterInteractive">${gaInit(id)}</script>`,
    why,
  );
}

function assertPlausible(env: Record<string, string>, id: string, why: string) {
  const { markup, scripts } = render(env);
  assert.equal(scripts.length, 2, `${why}: expected the vendor's two scripts, got ${JSON.stringify(scripts)}`);
  const [loader, init] = scripts;
  assert.deepEqual(loader, { async: true, src: `https://plausible.io/js/${id}.js`, strategy: 'afterInteractive' }, why);
  assert.equal(init.strategy, 'afterInteractive', why);
  assert.equal(typeof init.id, 'string', `${why}: next/script needs an id on an inline script`);
  assert.deepEqual(String(init.children).split('\n').map((l) => l.trim()).filter(Boolean), PLAUSIBLE_INIT_LINES, why);
  assert.ok(!markup.includes('googletagmanager'), `${why}: a Google tag in a Plausible configuration`);
}

// --- Acceptance 1: the four configurations ---------------------------------

test('none set: no tag, so no request to any analytics service', () => {
  assertNothing({}, 'nothing set');
});

test("google-analytics with an id: exactly today's two scripts", () => {
  assertGoogle({ [SERVICE]: 'google-analytics', [ID]: 'fixture' }, 'fixture', 'the new pair');
});

test("the prior-era id alone renders the same two scripts", () => {
  assertGoogle({ [PRIOR]: 'fixture' }, 'fixture', 'the prior-era id');
});

test("plausible with an id: the vendor's snippet, and no Google tag", () => {
  assertPlausible({ [SERVICE]: 'plausible', [ID]: 'fixture' }, 'fixture', 'plausible');
});

test('the new pair alone decides when either is set: a prior-era id beside it is not read', () => {
  assertPlausible({ [SERVICE]: 'plausible', [ID]: 'fixture', [PRIOR]: 'prior-fixture' }, 'fixture', 'plausible beside the prior-era id');
  assertGoogle({ [SERVICE]: 'google-analytics', [ID]: 'fixture', [PRIOR]: 'prior-fixture' }, 'fixture', 'google-analytics beside the prior-era id');
});

test('an unknown service renders nothing, with or without the prior-era id', () => {
  for (const unknown of ['matomo', 'Plausible', 'google', 'ga4']) {
    assertNothing({ [SERVICE]: unknown, [ID]: 'fixture' }, `service ${unknown}`);
    assertNothing({ [SERVICE]: unknown, [ID]: 'fixture', [PRIOR]: 'fixture' }, `service ${unknown} beside the prior-era id`);
  }
});

test('half of the pair renders nothing, with or without the prior-era id', () => {
  for (const service of ANALYTICS_SERVICES) {
    assertNothing({ [SERVICE]: service }, `${service} with no id`);
    assertNothing({ [SERVICE]: service, [PRIOR]: 'fixture' }, `${service} with no id, beside the prior-era id`);
  }
  assertNothing({ [ID]: 'fixture' }, 'an id with no service');
  assertNothing({ [ID]: 'fixture', [PRIOR]: 'fixture' }, 'an id with no service, beside the prior-era id');
});

// --- Acceptance 4: empty counts as absent, for all three names ---------------
// A build argument that is not passed can arrive as an empty string
// (scripts/preflight-env.mjs, the `readBy` notes), so `''` must read as unset.

test("empty: both new names '' and the prior-era id set renders the prior-era tag", () => {
  assertGoogle({ [SERVICE]: '', [ID]: '', [PRIOR]: 'fixture' }, 'fixture', "both new names ''");
  assertGoogle({ [SERVICE]: ' ', [ID]: '  ', [PRIOR]: 'fixture' }, 'fixture', 'both new names whitespace');
});

test("empty: a prior-era id of '' renders nothing", () => {
  assertNothing({ [PRIOR]: '' }, "prior-era id ''");
  assertNothing({ [SERVICE]: '', [ID]: '', [PRIOR]: '' }, "all three ''");
});

test("empty: a service with an id of '' is half a pair and renders nothing", () => {
  for (const service of ANALYTICS_SERVICES) {
    assertNothing({ [SERVICE]: service, [ID]: '' }, `${service} with id ''`);
    assertNothing({ [SERVICE]: service, [ID]: '', [PRIOR]: 'fixture' }, `${service} with id '', beside the prior-era id`);
  }
});

// --- Acceptance 3: both names declared; preflight names the problem ----------

const entry = (name: string) => (ENV_SPEC as Array<Record<string, unknown>>).find((s) => s.name === name);

function envWithAllRequired(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const s of ENV_SPEC as Array<{ name: string; tier: string }>) if (s.tier === 'required') env[s.name] = 'present';
  return env;
}

test('ENV_SPEC declares both new names as build-time, and keeps the prior-era row as its own', () => {
  for (const name of [SERVICE, ID, PRIOR]) {
    const row = entry(name);
    assert.ok(row, `ENV_SPEC has no ${name} row`);
    assert.equal(row.readBy, 'build', `${name} is not readBy: 'build'`);
    assert.equal(row.priorEraName, undefined, `${name} must not use priorEraName (G0-2: an empty canonical name would win)`);
  }
  assert.deepEqual(entry(SERVICE)!.allowedValues, [...ANALYTICS_SERVICES], 'preflight accepts a different service set from the app');
  assert.match(String(entry(PRIOR)!.purpose), /prior-era/, 'the prior-era row does not say it is prior-era');
});

test('preflight: an unknown service fails the run by name, and the value is never printed', () => {
  const canary = 'unknown-analytics-canary';
  const result = evaluateEnv({ ...envWithAllRequired(), [SERVICE]: canary, [ID]: 'fixture' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.valueErrors.map((e: { name: string }) => e.name), [SERVICE]);
  const report = renderReport(result);
  assert.ok(report.includes(SERVICE), 'the report does not name the variable');
  assert.ok(!report.includes(canary), 'the report echoed the value');
});

test('preflight: half of the pair is named, either half', () => {
  const group = (ENV_GROUPS as Array<{ name: string; members: string[] }>).find((g) => g.members.includes(SERVICE));
  assert.ok(group, 'no ENV_GROUPS entry holds the pair');
  assert.deepEqual([...group.members].sort(), [ID, SERVICE].sort());
  for (const [set, missing] of [[SERVICE, ID], [ID, SERVICE]]) {
    const value = set === SERVICE ? 'plausible' : 'fixture';
    const result = evaluateEnv({ ...envWithAllRequired(), [set]: value });
    const partial = result.partialGroups.find((g: { name: string }) => g.name === group.name);
    assert.ok(partial, `${set} alone is not reported`);
    assert.deepEqual(partial.missing, [missing]);
    assert.ok(renderReport(result).includes(missing), `the report does not name ${missing}`);
  }
  const complete = evaluateEnv({ ...envWithAllRequired(), [SERVICE]: 'plausible', [ID]: 'fixture' });
  assert.equal(complete.partialGroups.some((g: { name: string }) => g.name === group.name), false, 'a complete pair is reported');
  assert.deepEqual(complete.valueErrors, []);
  assert.equal(complete.ok, true);
});

test("preflight: empty counts as absent for the pair ('' is neither half a pair nor an unknown service)", () => {
  const result = evaluateEnv({ ...envWithAllRequired(), [SERVICE]: '', [ID]: '', [PRIOR]: 'fixture' });
  assert.deepEqual(result.partialGroups.filter((g: { missing: string[] }) => g.missing.includes(SERVICE) || g.missing.includes(ID)), []);
  assert.deepEqual(result.valueErrors, []);
  const half = evaluateEnv({ ...envWithAllRequired(), [SERVICE]: 'plausible', [ID]: '' });
  assert.ok(half.partialGroups.some((g: { missing: string[] }) => g.missing.includes(ID)), "an id of '' is not read as missing");
});

test('compose passes all three as build args, and the stage that runs the build declares each', () => {
  assert.equal(checkRepository().ok, true, 'check:compose-env fails on the repository');
  const compose = fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf8');
  for (const name of [SERVICE, ID, PRIOR]) {
    assert.equal(compose.split(new RegExp(`^\\s+${name}:\\s*$`, 'm')).length - 1, 1, `compose does not pass ${name} once`);
    assert.match(dockerfile, new RegExp(`^ARG ${name}$`, 'm'), `the Dockerfile declares no ARG ${name}`);
  }
});

// --- Acceptance 5: the deploy guide ------------------------------------------

function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, `docs/deploy.md has no "${heading}" heading`);
  const rest = doc.slice(start + heading.length + 2);
  const next = rest.search(/^#{2,3} /m);
  return next === -1 ? rest : rest.slice(0, next);
}

test('docs/deploy.md: an Analytics section states the variables, the services, the rule, and what reaches the service', () => {
  const doc = fs.readFileSync(path.join(REPO, 'docs/deploy.md'), 'utf8');
  const body = section(doc, '### Analytics');
  for (const needle of [SERVICE, ID, PRIOR, 'prior-era', 'rebuild', 'cookie', 'title', 'Read 2026-09-20']) {
    assert.ok(body.includes(needle), `the Analytics section does not mention ${needle}`);
  }
  for (const service of ANALYTICS_SERVICES) {
    assert.ok(body.includes(`\`${service}\``), `the Analytics section does not name the service ${service}`);
  }
  const overrides = doc.slice(doc.indexOf('**Merely overrides a default.**'), doc.indexOf('One build-time caveat'));
  for (const name of [SERVICE, ID, PRIOR]) assert.ok(overrides.includes(name), `"Merely overrides a default" does not name ${name}`);
});

test('docs/deploy.md: the model seam says the no-training setting is the operator\'s to state', () => {
  const doc = fs.readFileSync(path.join(REPO, 'docs/deploy.md'), 'utf8');
  const seam = section(doc, '### The model seam');
  assert.match(seam, /train/, 'the model seam does not name the training setting');
  assert.match(seam, /cannot read/, 'the model seam does not say the app cannot read it');
});
