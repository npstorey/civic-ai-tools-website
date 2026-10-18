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
// adds each value of `ANALYTICS_SERVICES` (`src/lib/analytics.tsx`).
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
const { analyticsKey, recipientDrift, recipientStatementKeys } = await import('./privacy-facts.ts');

// --- The source ---------------------------------------------------------------

interface OutboundRow {
  /** The first cell, exactly: the key a statement is held under. */
  kind: string;
  /** Every backticked `src/…` path in the second cell. */
  modules: string[];
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
    rows.push({ kind: cells[0], modules: [...(cells[1] ?? '').matchAll(/`(src\/[^`]+)`/g)].map((m) => m[1]) });
  }
  return rows;
}

const DOC = fs.readFileSync(path.join(REPO, 'docs', 'deploy.md'), 'utf8');
const ROWS = outboundRows(DOC);
const RECIPIENTS = [...ROWS.map((row) => row.kind), ...ANALYTICS_SERVICES.map(analyticsKey)];

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
