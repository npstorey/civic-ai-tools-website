// #644 W2 criterion 6 [D]: the privacy page states the consent pause's use of
// the key-value store, one statement on each branch, only under
// `SOURCE_ROUTING=in-loop`.
//
// THE WORDS are fixed by the owner (card D, confirmed on the seat's 01:24:35Z
// relay) and built here byte for byte:
//   - with the store, where a reader code can exist (sign-in offered and
//     `DATABASE_URL` set, since a session carries a `dbId` only then): the
//     code text;
//   - with the store, where none can: the same, with the sentences about the
//     code replaced by "It holds no code for you.";
//   - with no store: the memory text.
// Under `all-sources` (unset, the default) none of the three renders, store
// or no store.
//
// WHAT IS DRIVEN. The real page and the real facts module, rendered to static
// markup as `privacy-page.test.ts` renders them, through this file's own
// copies of that test's loader (`registerHooks` and its helpers), `withEnv`
// and `render`: that file's configurations and renderer are not exported.
//
// THE FIVE SETTINGS CAN EACH FAIL. A build that branches on sign-in alone
// fails the no-`DATABASE_URL` setting; one keyed on `DATABASE_URL` alone
// fails the no-sign-in setting; one that ignores the mode fails the
// `all-sources` setting.
//
// THE MODE'S READER (R6-WEB-D's answer B, and the seat's ruling): the page
// reads the mode through the leaf module `src/lib/mcp/source-routing-mode.ts`,
// which imports nothing, by one import line after the registry's; and reads
// it inside the store's entry, at render.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types 'src/app/(app)/privacy/consent-pause-privacy-text.test.ts')

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
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', '..');
const REPO = path.resolve(SRC, '..');
const SCRIPT_STUB_URL = pathToFileURL(path.join(SRC, '__civic-r8-w2-next-script-stub.mjs')).href;
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
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`r8-w2 privacy test hook: cannot resolve ${specifier}`);
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
const { ENV_SPEC } = await import(pathToFileURL(path.join(REPO, 'scripts', 'preflight-env.mjs')).href);
const DECLARED = new Set<string>((ENV_SPEC as { name: string }[]).map((row) => row.name));

const LOWER_CASE_PROXY_NAMES = ['http_proxy', 'https_proxy', 'no_proxy'];

/** Every variable the preflight declares is cleared, then the configuration is set. */
function withEnv<T>(config: Record<string, string>, run: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const name of [...DECLARED, ...LOWER_CASE_PROXY_NAMES, ...Object.keys(config)]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
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

function render(config: Record<string, string>): string {
  return withEnv(config, () => renderToStaticMarkup(createElement(PrivacyPage)));
}

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

// --- The words, byte for byte ------------------------------------------------------------

const LEAD = 'A question can stop to ask about a data source set to Ask first. ' +
  'When it does, the site keeps a short entry in the same key-value store. ' +
  'The entry holds the source it asked about, and your answer once you give it.';
const EXPIRY = 'The site sets the entry to expire 10 minutes after it is made.';
const CODE_TEXT = `${LEAD} Signed in, it also holds a code. The site makes the code from your account and a secret only the operator holds. Not signed in, it holds no code for you. ${EXPIRY}`;
const NO_CODE_TEXT = `${LEAD} It holds no code for you. ${EXPIRY}`;
const MEMORY_TEXT = 'A question may need a data source set to Ask first. ' +
  'Then the site cannot stop to ask you, because it has no store to keep your answer in. ' +
  'The source is not used for that question. You can turn it On in the panel for your next question.';

// --- The settings ----------------------------------------------------------------------------

const SIGN_IN = {
  GITHUB_CLIENT_ID: 'fixture',
  GITHUB_CLIENT_SECRET: 'fixture',
  OIDC_ISSUER: 'https://sso.example.test',
  OIDC_CLIENT_ID: 'fixture',
  OIDC_CLIENT_SECRET: 'fixture',
  OIDC_PROVIDER_NAME: 'Fixture SSO',
  SIGN_IN_ALLOWLIST: 'fixture',
};
const PAIR = { KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 'fixture' };
const IN_LOOP = { SOURCE_ROUTING: 'in-loop' };

const SETTINGS = {
  code: { ...IN_LOOP, ...PAIR, ...SIGN_IN, DATABASE_URL: 'fixture' },
  'no code, no DATABASE_URL': { ...IN_LOOP, ...PAIR, ...SIGN_IN },
  'no code, no sign-in': { ...IN_LOOP, ...PAIR, DATABASE_URL: 'fixture' },
  memory: { ...IN_LOOP },
  'all-sources': { ...PAIR, ...SIGN_IN, DATABASE_URL: 'fixture' },
};
const PAGE = Object.fromEntries(Object.entries(SETTINGS).map(([name, config]) => [name, text(render(config))])) as Record<keyof typeof SETTINGS, string>;

test('criterion 6 [D], code: in-loop with the pair, sign-in and DATABASE_URL, the code text, byte for byte', () => {
  assert.ok(PAGE.code.includes(CODE_TEXT), 'the code text is not on the page');
  assert.ok(!PAGE.code.includes(MEMORY_TEXT));
});

test('criterion 6 [D], no code: in-loop with the pair and sign-in, no DATABASE_URL: "It holds no code for you.", and no code sentence', () => {
  const page = PAGE['no code, no DATABASE_URL'];
  assert.ok(page.includes(NO_CODE_TEXT), 'the no-code text is not on the page');
  assert.ok(page.includes('It holds no code for you.'));
  assert.ok(!page.includes('Signed in, it also holds a code.'), 'a page with no database says a signed-in reader gets a code');
});

test('criterion 6 [D], no code: in-loop with the pair and DATABASE_URL, no sign-in: "It holds no code for you.", and no code sentence', () => {
  const page = PAGE['no code, no sign-in'];
  assert.ok(page.includes(NO_CODE_TEXT), 'the no-code text is not on the page');
  assert.ok(!page.includes('Signed in, it also holds a code.'), 'a page with no sign-in says a signed-in reader gets a code');
});

test('criterion 6 [D], memory: in-loop with no pair, the memory text and neither store text', () => {
  assert.ok(PAGE.memory.includes(MEMORY_TEXT), 'the memory text is not on the page');
  assert.ok(!PAGE.memory.includes('A question can stop to ask'), 'a page with no store states the store text');
});

test('criterion 6 [D], all-sources: none of the three, with the pair, sign-in and DATABASE_URL', () => {
  const page = PAGE['all-sources'];
  assert.ok(!page.includes('A question can stop to ask'), 'an all-sources page states the pause\'s store');
  assert.ok(!page.includes('A question may need'), 'an all-sources page states the pause\'s memory text');
});

test('criterion 6 [D]: the store statements hold no sentence over 18 words', () => {
  for (const sentence of [CODE_TEXT, NO_CODE_TEXT, MEMORY_TEXT].flatMap((t) => t.split(/(?<=\.) /))) {
    assert.ok(sentence.split(/\s+/).length <= 18, `${sentence.split(/\s+/).length} words: ${sentence}`);
  }
});

test('criterion 6 [D]: "10 minutes" is the entry\'s own expiry, the export the statement traces', async () => {
  const decision = await import(pathToFileURL(path.join(SRC, 'lib', 'sources', 'decision.ts')).href);
  assert.equal(decision.DECISION_ENTRY_TTL_SECONDS, 10 * 60);
  const html = render(SETTINGS.code);
  const element = [...html.matchAll(/<p[^>]*data-statement="recipient-pause-store"[^>]*data-trace="([^"]*)"/g)];
  assert.equal(element.length, 1, 'no recipient-pause-store statement');
  const traces = element[0][1].split(' ');
  for (const trace of ['const:src/lib/sources/decision.ts#DECISION_ENTRY_TTL_SECONDS', 'env:SOURCE_ROUTING', 'env:DATABASE_URL', 'env:GITHUB_CLIENT_ID', 'env:OIDC_ISSUER', 'env:KV_REST_API_URL']) {
    assert.ok(traces.includes(trace), `the store statement does not trace ${trace}`);
  }
  const memory = [...render(SETTINGS.memory).matchAll(/data-statement="recipient-pause-memory"[^>]*data-trace="([^"]*)"/g)];
  assert.equal(memory.length, 1, 'no recipient-pause-memory statement');
  assert.ok(memory[0][1].split(' ').includes('env:SOURCE_ROUTING'));
});

// --- The mode's reader (R6-WEB-D's answer B, the seat's ruling) --------------------------------

test('criterion 6 (B): privacy-facts.ts imports the mode from the leaf module, by one line after the registry\'s, and reads it inside the store\'s entry only', () => {
  const source = fs.readFileSync(path.join(SRC, 'lib', 'privacy-facts.ts'), 'utf8');
  const lines = source.split('\n');
  const leaf = lines.findIndex((l) => l === "import { sourceRoutingMode } from './mcp/source-routing-mode.ts';");
  assert.ok(leaf > 0, 'privacy-facts.ts has no import line for the leaf module');
  assert.match(lines[leaf - 1], /from '\.\/mcp\/registry\.ts';$/, 'the import line does not follow the registry\'s');
  assert.ok(!/from '\.\/mcp\/routing-mode\.ts'/.test(source), 'privacy-facts.ts imports routing-mode.ts');
  const entryStart = source.indexOf("'Rate-limit counter, `KV_REST_API_URL` set': () =>");
  const entryEnd = source.indexOf("'Sign-in provider (GitHub / OIDC) discovery, token and userinfo calls'");
  assert.ok(entryStart > 0 && entryEnd > entryStart, 'premise: the store\'s entry is not where it was');
  const reads = [...source.matchAll(/sourceRoutingMode\(/g)].map((m) => m.index!);
  assert.ok(reads.length > 0, 'privacy-facts.ts never reads the mode');
  for (const at of reads) assert.ok(at > entryStart && at < entryEnd, 'the mode is read outside the store\'s entry');
});

test('criterion 6 (B): the leaf module imports nothing', () => {
  const source = fs.readFileSync(path.join(SRC, 'lib', 'mcp', 'source-routing-mode.ts'), 'utf8');
  assert.deepEqual([...source.matchAll(/^\s*(import|export)\b[^;]*\sfrom\s/gm)].map((m) => m[0]), []);
});
