// #516 P7 — the privacy page's recipients stay in step with the outbound
// traffic the code makes. Checked in both directions.
//
// THE SOURCE. docs/deploy.md's outbound-kinds table ("What the proxy carries,
// and what it cannot", inside "## Outbound traffic through an egress proxy"):
// one row per kind of outbound traffic, with the module it leaves through.
// `scripts/outbound-proxy.test.mjs` already reads that section, by the same
// heading (`egressProxySection`) and row shape (`^| <kind> |`), and pins rows
// of it to measured behaviour; that function is local to that suite, so the
// section anchor is repeated here rather than imported. Analytics leaves from
// the reader's browser, not the server, so it has no row there: the source
// adds each value of `ANALYTICS_SERVICES` (`src/lib/analytics.tsx`). What a
// platform holds rather than what the site sends (the hosting platform's
// function logs, the sandbox platform a hosted source runs on) has no row
// either: the source adds each value of `PLATFORM_HELD_KINDS`
// (`src/lib/flows/statement.ts`, R6 W2 ruling 1).
//
// WHY THIS IS A DERIVATION AND NOT A LIST. Neither side is typed here. The rows
// are read from the guide, and the guide's executor rows are themselves pinned
// to the code by `outbound-proxy.test.mjs` (a row per `ExecutorDriverName`
// value, and the driven sandbox lifecycle against its row). The statement keys
// are read from `RECIPIENT_STATEMENTS` and `ANALYTICS_RECIPIENTS` in
// `src/lib/privacy-facts.ts`. A new row, or a new analytics service, fails
// here until the page has a statement for it; a statement whose row is gone
// fails here until it is removed.
//
// A THIRD CHECK: each module a row says its traffic leaves through
// (a backticked `src/…` path) exists in the tree, so a row cannot keep a
// statement alive after the code it describes has moved.
//
// WHAT THIS DOES NOT SEE. Outbound traffic that has no row in the table. The
// table is the guide's inventory of outbound kinds; a kind the guide never
// listed is invisible to this guard, as it is to the proxy suite.
//
// THE PROXY'S EXCEPTIONS (#516 WF) come from the same table: its last column
// says whether each kind honours the proxy variables, and a row that does not
// say "yes" needs an entry in `PROXY_EXCEPTIONS`, which the page states when
// that row's traffic is configured. Checked both ways, with a fixture each.
//
// THE FIXTURES live in this file: a recipient row with no statement, and a
// statement whose row is gone. Each must be reported, by name.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/privacy-recipients.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

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
const ANALYTICS_FILE = path.join(HERE, 'analytics.tsx');

// Never on disk: `next/script` is not resolvable from a plain ESM import, and
// this suite reads only a constant of the module that imports it.
const SCRIPT_STUB_URL = pathToFileURL(path.join(HERE, '__civic-516-p7-recipients-script-stub.mjs')).href;

// `--experimental-strip-types` does not read `.tsx`; the analytics module is
// the one `.tsx` this suite imports, so it alone goes through the compiler.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier === 'next/script' && parent?.startsWith('file:') && fileURLToPath(parent) === ANALYTICS_FILE) {
      return { url: SCRIPT_STUB_URL, format: 'module', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl === SCRIPT_STUB_URL) return { format: 'module', source: 'export default function Script() { return null; }', shortCircuit: true };
    if (loadUrl.startsWith('file:') && fileURLToPath(loadUrl) === ANALYTICS_FILE) {
      const out = ts.transpileModule(fs.readFileSync(ANALYTICS_FILE, 'utf8'), {
        fileName: ANALYTICS_FILE,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      return { format: 'module', source: out.outputText, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

const { ANALYTICS_SERVICES } = (await import(pathToFileURL(ANALYTICS_FILE).href)) as { ANALYTICS_SERVICES: readonly string[] };
const facts = await import('./privacy-facts.ts');
const { analyticsKey, recipientDrift, recipientStatementKeys } = facts;

// --- The source ---------------------------------------------------------------

interface OutboundRow {
  /** The first cell, exactly: the key a statement is held under. */
  kind: string;
  /** Every backticked `src/…` path in the second cell. */
  modules: string[];
  /** The third cell, "Honours the proxy variables". */
  honours: string;
}

function outboundRows(doc: string): OutboundRow[] {
  const start = doc.indexOf('## Outbound traffic through an egress proxy');
  assert.notEqual(start, -1, 'docs/deploy.md has no egress-proxy section to read');
  const end = doc.indexOf('\n## ', start + 1);
  const section = doc.slice(start, end === -1 ? undefined : end);
  const lines = section.split('\n');
  const header = lines.findIndex((line) => /^\| Outbound kind \| Leaves through \|/.test(line));
  assert.notEqual(header, -1, "docs/deploy.md's egress-proxy section has no outbound-kinds table");
  const rows: OutboundRow[] = [];
  // Header, then the `| --- |` rule, then rows until the first non-table line.
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    rows.push({ kind: cells[0], modules: [...(cells[1] ?? '').matchAll(/`(src\/[^`]+)`/g)].map((m) => m[1]), honours: cells[2] ?? '' });
  }
  return rows;
}

const DOC = fs.readFileSync(path.join(REPO, 'docs', 'deploy.md'), 'utf8');
const ROWS = outboundRows(DOC);
// R6 W2 (#632, ruling 1): the third source, the kinds a platform holds
// (`PLATFORM_HELD_KINDS`), read from the flows statement's module, which names
// them; see the section at the end of this file.
const HELD_KINDS = (((await import('./flows/statement.ts' as string).catch(() => null)) as { PLATFORM_HELD_KINDS?: readonly string[] } | null)?.PLATFORM_HELD_KINDS ?? []);
const RECIPIENTS = [
  ...ROWS.map((row) => row.kind),
  ...ANALYTICS_SERVICES.map(analyticsKey),
  ...HELD_KINDS.map((kind) => `held:${kind}`),
];

// --- The derivation itself works ------------------------------------------------

test('the outbound-kinds table is read, with the rows #617 and #530 added', () => {
  // If the parse found nothing, every comparison below would pass vacuously.
  assert.ok(ROWS.length >= 16, `read ${ROWS.length} outbound-kinds row(s) from docs/deploy.md; expected at least 16`);
  const kinds = ROWS.map((row) => row.kind);
  for (const expected of [
    'Model endpoint',
    'Notebook execution, `EXECUTOR_DRIVER=lambda`',
    "Hosted source (`NYC_CHARTER_HOSTING=sandbox`): its sandbox's lifecycle",
    'Hosted source: the MCP exchange with its bridge',
  ]) {
    assert.ok(kinds.includes(expected), `the parse did not find the row "${expected}"`);
  }
  assert.ok(ANALYTICS_SERVICES.length >= 2, 'ANALYTICS_SERVICES read as fewer than two services');
});

// --- The guard, on this tree --------------------------------------------------

test('every outbound kind and analytics service has a statement on the privacy page', () => {
  const { unstated } = recipientDrift(RECIPIENTS, recipientStatementKeys());
  assert.deepEqual(
    unstated,
    [],
    `These recipients have no statement in src/lib/privacy-facts.ts:\n` +
      unstated.map((key) => `    ${key}`).join('\n') +
      `\n\nA row of docs/deploy.md's outbound-kinds table (or a value of ANALYTICS_SERVICES) is a kind of\n` +
      `traffic this site can send. Add a RECIPIENT_STATEMENTS entry keyed by the row's first cell exactly\n` +
      `(or an ANALYTICS_RECIPIENTS entry), saying in reader language what is sent and to whom.`,
  );
});

test('every statement on the privacy page has an outbound kind or analytics service behind it', () => {
  const { unmatched } = recipientDrift(RECIPIENTS, recipientStatementKeys());
  assert.deepEqual(
    unmatched,
    [],
    `These statements in src/lib/privacy-facts.ts name no row of docs/deploy.md's outbound-kinds table\n` +
      `and no value of ANALYTICS_SERVICES:\n` +
      unmatched.map((key) => `    ${key}`).join('\n') +
      `\n\nIf the traffic is gone, remove the statement. If the row was renamed, re-key the statement.`,
  );
});

test("every module an outbound-kinds row names exists in the tree", () => {
  const missing = ROWS.flatMap((row) => row.modules.filter((m) => !fs.existsSync(path.join(REPO, m))).map((m) => `${row.kind}: ${m}`));
  assert.deepEqual(missing, [], `outbound-kinds rows name modules that do not exist:\n${missing.join('\n')}`);
});

// --- The guard, on fixtures that must fail ------------------------------------

const FIXTURE_ROW = 'Fixture outbound kind, `FIXTURE_DRIVER=fixture`';
const FIXTURE_STATEMENT = 'Fixture statement for a row that is gone';

test('a recipient row with no statement is reported, by name', () => {
  const { unstated, unmatched } = recipientDrift([...RECIPIENTS, FIXTURE_ROW], recipientStatementKeys());
  assert.deepEqual(unstated, [FIXTURE_ROW]);
  assert.deepEqual(unmatched, []);
});

test('a statement whose row is gone is reported, by name', () => {
  const { unstated, unmatched } = recipientDrift(RECIPIENTS, [...recipientStatementKeys(), FIXTURE_STATEMENT]);
  assert.deepEqual(unstated, []);
  assert.deepEqual(unmatched, [FIXTURE_STATEMENT]);
});

test('a row removed from the source leaves its statement reported', () => {
  // The converse of the fixture above, over a real row: drop one row from the
  // source and its statement must surface as unmatched.
  const dropped = ROWS[0].kind;
  const { unmatched } = recipientDrift(RECIPIENTS.filter((key) => key !== dropped), recipientStatementKeys());
  assert.deepEqual(unmatched, [dropped]);
});

// --- #516 WF: what the egress proxy does not carry, from the same table -------
//
// A row whose last column does not begin with "yes" is traffic the proxy does
// not carry (or carries only in part). The page states each such row's
// exception when the row's traffic is configured, so each must have an entry
// in `PROXY_EXCEPTIONS`; and each entry must name a row of the table.

function proxyDrift(rows: readonly OutboundRow[], exceptionKeys: readonly string[]): { unstated: string[]; unmatched: string[] } {
  return {
    unstated: rows.filter((row) => !/^yes\b/.test(row.honours)).map((row) => row.kind).filter((kind) => !exceptionKeys.includes(kind)),
    unmatched: exceptionKeys.filter((key) => !rows.some((row) => row.kind === key)),
  };
}

const PROXY_EXCEPTION_KEYS = Object.keys(((facts as Record<string, unknown>).PROXY_EXCEPTIONS ?? {}) as Record<string, string>);

test('the honours column is read: some rows say yes, and some do not', () => {
  assert.ok(ROWS.every((row) => row.honours.length > 0), 'a row has no "Honours the proxy variables" cell');
  assert.ok(ROWS.filter((row) => /^yes\b/.test(row.honours)).length >= 10, 'fewer than ten rows read as "yes"');
  assert.ok(ROWS.filter((row) => !/^yes\b/.test(row.honours)).length >= 3, 'fewer than three rows read as not "yes"');
});

test('every row the proxy does not fully carry has its exception on the privacy page, and every exception names a row', () => {
  assert.ok(PROXY_EXCEPTION_KEYS.length > 0, 'privacy-facts.ts exports no PROXY_EXCEPTIONS');
  assert.deepEqual(proxyDrift(ROWS, PROXY_EXCEPTION_KEYS), { unstated: [], unmatched: [] });
});

test('a row the proxy does not carry, with no exception, is reported; so is an exception whose row is gone', () => {
  const fixture: OutboundRow = { kind: FIXTURE_ROW, modules: [], honours: '**no**' };
  assert.deepEqual(proxyDrift([...ROWS, fixture], PROXY_EXCEPTION_KEYS).unstated, [FIXTURE_ROW]);
  assert.deepEqual(proxyDrift(ROWS, [...PROXY_EXCEPTION_KEYS, FIXTURE_STATEMENT]).unmatched, [FIXTURE_STATEMENT]);
});

// --- R6 W2 (#632, ruling 1): what a platform holds, beside the table -----------
//
// THE THIRD SOURCE. The outbound-kinds table lists what the site SENDS; two
// recipients of the flows statement are what a platform HOLDS instead: the
// hosting platform's function logs, and the sandbox platform a hosted source
// runs on. `PLATFORM_HELD_KINDS` (`src/lib/flows/statement.ts`) names them, as
// `ANALYTICS_SERVICES` names the analytics services, and the privacy page holds
// one statement per kind in `PLATFORM_HELD_RECIPIENTS`, keyed `held:<kind>`
// (`heldKey`), as `ANALYTICS_RECIPIENTS` is keyed `analytics:<service>`.
//
// THE FLOWS STATEMENT READS THE SAME THREE SOURCES. Every recipient
// `/api/flows` names carries the key it is derived from: a row of the table,
// an analytics service, or a held kind. A statement naming a key outside the
// three fails here (criterion 3's two-way rule), so the page and the statement
// cannot name different recipients.

/** The module W2 adds (a specifier typed `string`; see `adapt-record.test.ts`). */
const FLOWS_STATEMENT: string = './flows/statement.ts';
type FlowsMod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const flows = (await import(FLOWS_STATEMENT).catch(() => null)) as FlowsMod | null;

function heldSource(): string[] {
  assert.ok(flows, `no flows statement module: ${FLOWS_STATEMENT} does not exist`);
  const kinds = flows!.PLATFORM_HELD_KINDS as readonly string[] | undefined;
  assert.ok(Array.isArray(kinds) && kinds.length > 0, `${FLOWS_STATEMENT} exports no PLATFORM_HELD_KINDS`);
  const heldKey = (facts as Record<string, unknown>).heldKey as ((kind: string) => string) | undefined;
  assert.equal(typeof heldKey, 'function', 'privacy-facts.ts exports no heldKey');
  return kinds!.map((kind) => heldKey!(kind));
}

test('R6 W2 ruling 1: the held kinds are the function logs and the sandbox platform', () => {
  assert.deepEqual(heldSource(), ['held:function-logs', 'held:sandbox-platform']);
});

test('R6 W2 ruling 1: every held kind has a statement on the privacy page, and every held statement a kind', () => {
  const held = heldSource();
  const keys = recipientStatementKeys();
  const { unstated, unmatched } = recipientDrift([...RECIPIENTS, ...held], keys);
  assert.deepEqual(unstated, [], `held kinds with no statement in privacy-facts.ts: ${unstated.join(', ')}`);
  assert.deepEqual(unmatched, [], `statements with no row, service or held kind behind them: ${unmatched.join(', ')}`);
  assert.ok(held.every((key) => keys.includes(key)), 'recipientStatementKeys() does not include the held keys');
});

test('R6 W2 ruling 1: a held kind with no statement, and a held statement with no kind, are each reported by name', () => {
  const held = heldSource();
  const fixtureKind = 'held:fixture-platform';
  assert.deepEqual(recipientDrift([...RECIPIENTS, ...held, fixtureKind], recipientStatementKeys()).unstated, [fixtureKind]);
  const dropped = held[0];
  assert.deepEqual(recipientDrift(RECIPIENTS.filter((key) => key !== dropped), recipientStatementKeys()).unmatched, [dropped]);
});

test('R6 W2 ruling 1: each held statement is derived like the analytics reads — the holder\'s quoted sentence, its address and its read date', () => {
  heldSource();
  const recipients = (facts as Record<string, unknown>).PLATFORM_HELD_RECIPIENTS as Record<string, { holder: string; reads: Array<{ url: string; read: string; sentence: string }> }> | undefined;
  assert.ok(recipients, 'privacy-facts.ts exports no PLATFORM_HELD_RECIPIENTS');
  for (const [kind, entry] of Object.entries(recipients!)) {
    assert.ok(entry.holder, `${kind}: no holder`);
    assert.ok(entry.reads.length > 0, `${kind}: no page read`);
    for (const read of entry.reads) {
      assert.match(read.url, /^https:\/\//, `${kind}: ${read.url}`);
      assert.match(read.read, /^\d{4}-\d{2}-\d{2}$/, `${kind}: ${read.read}`);
      assert.ok(read.sentence.length > 20, `${kind}: no sentence quoted from ${read.url}`);
    }
  }
});

/** The keys a built statement names, base and sources. */
function statementKeys(statement: { recipients: Array<{ key: string }>; sources: Array<{ recipients: Array<{ key: string }> }> }): string[] {
  return [...new Set([...statement.recipients.map((r) => r.key), ...statement.sources.flatMap((s) => s.recipients.map((r) => r.key))])];
}

test('R6 W2 criterion 3: every recipient /api/flows names, under the three configurations, is a key of the guard\'s source', async () => {
  const held = heldSource();
  const source = [...RECIPIENTS, ...held];
  const build = flows!.buildFlowsStatement as (() => Promise<{ recipients: Array<{ key: string }>; sources: Array<{ recipients: Array<{ key: string }> }> }>) | undefined;
  assert.equal(typeof build, 'function', `${FLOWS_STATEMENT} exports no buildFlowsStatement`);
  const names = ['SOCRATA_MCP_URL', 'MODEL_API_BASE_URL', 'NYC_CHARTER_HOSTING', 'EXECUTOR_DRIVER', 'VERCEL_ENV'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const seen = new Set<string>();
  try {
    for (const env of [
      { SOCRATA_MCP_URL: 'https://socrata.fixture.example', EXECUTOR_DRIVER: 'vercel-sandbox' },
      { SOCRATA_MCP_URL: 'https://socrata.fixture.example', MODEL_API_BASE_URL: 'https://models.fixture.example/v1', VERCEL_ENV: 'production' },
      { SOCRATA_MCP_URL: 'https://socrata.fixture.example', NYC_CHARTER_HOSTING: 'sandbox', EXECUTOR_DRIVER: 'lambda' },
    ]) {
      for (const name of names) delete process.env[name];
      Object.assign(process.env, env);
      const keys = statementKeys(await build!());
      for (const key of keys) seen.add(key);
      assert.deepEqual(recipientDrift(source, keys).unmatched, [], `under ${JSON.stringify(env)} the statement names a recipient the guard's source does not list`);
    }
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.ok(seen.has('held:function-logs') && seen.has('held:sandbox-platform') && seen.has('Model endpoint'), `premise: the three configurations exercised the held keys: ${[...seen].join(', ')}`);
});

test('R6 W2 criterion 3: a statement naming a recipient the guard\'s source does not list fails, by name', () => {
  const source = [...RECIPIENTS, ...heldSource()];
  const fixture = { recipients: [{ key: 'Model endpoint' }, { key: 'Fixture recipient no row lists' }], sources: [] };
  assert.deepEqual(recipientDrift(source, statementKeys(fixture)).unmatched, ['Fixture recipient no row lists']);
});

// --- R6 W2: the held statements' words, pinned (the ORCH's plain-language round) ---
//
// Each statement is rendered as the page renders it (a link as its text, a
// code segment as its text) and compared with the agreed words exactly.

type Segment = string | { link: string; text: string } | { code: string };
const rendered = (parts: Segment[]) => parts.map((p) => (typeof p === 'string' ? p : 'link' in p ? p.text : p.code)).join('');

function heldStatements(env: Record<string, string>): Record<string, string> {
  const names = ['VERCEL_ENV', 'NYC_CHARTER_HOSTING'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, env);
    const build = (facts as Record<string, unknown>).buildPrivacySections as (analytics: null) => Array<{ statements: Array<{ id: string; parts: Segment[] }> }>;
    return Object.fromEntries(build(null).flatMap((s) => s.statements).filter((st) => st.id.startsWith('held-')).map((st) => [st.id, rendered(st.parts)]));
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('R6 W2: the held statements read in short sentences, with the agreed words', () => {
  const LOGS = (facts as Record<string, unknown>).LOGS_STATEMENT as string;
  const on = heldStatements({ VERCEL_ENV: 'production', NYC_CHARTER_HOSTING: 'sandbox' });
  assert.equal(
    on['held-function-logs-vercel'],
    "This site runs on Vercel. Vercel keeps the logs the site's code writes for each request. " +
      'Each log line also holds basic facts about the request, such as its address on this site and its status. ' +
      "Vercel says it keeps these logs for 1 hour, 1 day, 3 days or 30 days, depending on the operator's plan (its runtime logs page, read 2026-10-19). " +
      'This site cannot read which plan applies. ' + LOGS +
      ' Your question travels in the body of a request, not in its address. ' +
      'So this site reads these facts as: Vercel keeps facts about requests, not your question. ' +
      "That is this site's reading, not a claim Vercel makes. " +
      'Some pages put what you type after a ? in the address. Whether Vercel keeps that part has not been checked.',
  );
  assert.equal(
    on['held-sandbox-platform-nyc-charter'],
    'The data source NYC Charter, Laws and Rules MCP Server runs in a Vercel Sandbox that this site keeps between uses. ' +
      "When the sandbox stops, Vercel keeps a copy of its files for up to 30 days (Vercel's sandbox page, read 2026-10-19, and this site's sandbox settings). " +
      "Vercel's sandbox pages do not say what else it keeps of what runs there. " +
      "The program this site runs beside the source writes no searches or queries to the sandbox's logs. " +
      "What the source's own software writes there has not been checked.",
  );
  const off = heldStatements({});
  assert.equal(
    off['held-function-logs-operator'],
    "This site's own logs are kept by whoever runs its server. " + LOGS + " How long they are kept is the operator's to state.",
  );
});
