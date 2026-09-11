// #429's rule for the whole CLASS (Wave N11 P3, ruling R3, criterion A3): every
// file this repository tracks whose code sends an MCP `tools/call` treats a
// result carrying `isError: true` as a failure — by routing the result through
// `throwIfErrorResult` (`src/lib/mcp/tool-call-failure.ts`), the one function
// that reads the flag.
//
// THE UNIVERSE IS DERIVED (D10), not listed. `git ls-files` supplies it — every
// path this repository tracks, of which the scan reads the JavaScript/TypeScript
// family (/\.(c|m)?[jt]sx?$/), tests excluded, parsed as a TypeScript syntax
// tree (the `model-call-registry.test.ts` precedent for the universe).
//
// A SENDER is a file whose code carries the JSON-RPC method name `tools/call`
// as a whole string (a string literal, or a template with no substitutions) —
// however the request body around it is built — or that imports the MCP SDK's
// client (`@modelcontextprotocol/sdk/client…`), whose `callTool` hands back an
// `isError` result instead of throwing. A comment is not syntax, so a comment
// naming the method is no sender; nor is a longer string that contains it.
//
// ROUTING means the sender imports `throwIfErrorResult` from that module (by a
// relative path or the `@/` alias, renamed or not) and calls it. Not "reads
// `isError`": one function holds the behaviour and is driven —
// `is-error-is-a-rejected-call.test.ts` drives `client.ts` through the real
// loop to a built package, and `tool-call-failure.test.ts` holds the function
// to the flag's structure. A second hand-written reading of the flag in a
// second sender is how two senders drift apart.
//
// RED at f32b679, measured: two senders, `scripts/eval-models.mjs` and
// `src/lib/mcp/client.ts`, and neither routes — the function did not exist.
//
// BLIND SPOTS. A method name assembled at run time or read from data; a sender
// that calls the function on the wrong value (the call is found, its argument
// is not traced — the drive above holds the client; the evaluation harness is
// held by this routing check and by reading); a file git does not track. There
// is no hand list here: the senders, and the anchor module, are both derived,
// and the anchor is checked in both directions.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/tool-call-senders.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const METHOD = 'tools/call';
const SDK_CLIENT = '@modelcontextprotocol/sdk/client';
const ROUTE = 'throwIfErrorResult';
const ROUTE_HOME = 'src/lib/mcp/tool-call-failure.ts';

function trackedSourceFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z', '--full-name'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const tracked = listing
    .split('\0')
    .filter((name) => name !== '' && /\.(c|m)?[jt]sx?$/.test(name) && !/\.test\.(c|m)?[jt]sx?$/.test(name));
  assert.ok(tracked.length > 0, 'git ls-files reported no source files: the scan has stopped measuring');
  return tracked.filter((name) => existsSync(posix.join(REPO_ROOT, name)));
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX
    : /\.jsx$/.test(file) ? ts.ScriptKind.JSX
    : /\.(c|m)?ts$/.test(file) ? ts.ScriptKind.TS
    : ts.ScriptKind.JS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

/** Every node of a tree, depth first. */
function nodes(sf: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node): void => {
    out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const isWholeString = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

export function isSender(sf: ts.SourceFile): boolean {
  return nodes(sf).some((n) => {
    if (isWholeString(n) && n.text === METHOD) return true;
    if (ts.isImportDeclaration(n) && isWholeString(n.moduleSpecifier)) return n.moduleSpecifier.text.startsWith(SDK_CLIENT);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require') {
      const [first] = n.arguments;
      return first !== undefined && isWholeString(first) && first.text.startsWith(SDK_CLIENT);
    }
    return false;
  });
}

/** Whether an import specifier written in `file` names `target` (a repository-relative path). */
function resolvesTo(file: string, specifier: string, target: string): boolean {
  let base: string;
  if (specifier.startsWith('@/')) base = posix.join('src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(file), specifier));
  else return false;
  const stem = base.replace(/\.(c|m)?[jt]sx?$/, '');
  return [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.mjs`, posix.join(base, 'index.ts')].includes(target);
}

export function routes(file: string, sf: ts.SourceFile): boolean {
  const local = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !isWholeString(st.moduleSpecifier)) continue;
    if (!resolvesTo(file, st.moduleSpecifier.text, ROUTE_HOME)) continue;
    const clause = st.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const el of clause.namedBindings.elements) {
      if (!el.isTypeOnly && (el.propertyName ?? el.name).text === ROUTE) local.add(el.name.text);
    }
  }
  if (local.size === 0) return false;
  return nodes(sf).some((n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && local.has(n.expression.text));
}

// --- The instrument, against decoys --------------------------------------------

test('the instrument: a sender is found by its code, not its comments, and routing is an imported call, not a lookalike (decoys)', () => {
  const decoy = (file: string, lines: string[]) => ({ file, sf: parse(file, lines.join('\n')) });
  const body = "const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} });";

  const unrouted = decoy('src/lib/decoy/sender.ts', [body]);
  assert.equal(isSender(unrouted.sf), true, 'a body carrying the method is a sender');
  assert.equal(routes(unrouted.file, unrouted.sf), false);

  const relative = decoy('src/lib/decoy/sender.ts', ["import { throwIfErrorResult } from '../mcp/tool-call-failure.ts';", body, 'throwIfErrorResult(parsed.result);']);
  assert.equal(routes(relative.file, relative.sf), true, 'a relative import that is called routes');

  const aliased = decoy('src/lib/decoy/sender.ts', ["import { throwIfErrorResult as refuse } from '@/lib/mcp/tool-call-failure';", body, 'refuse(parsed.result);']);
  assert.equal(routes(aliased.file, aliased.sf), true, 'the `@/` alias, renamed, routes');

  const fromScripts = decoy('scripts/decoy.mjs', ["import { throwIfErrorResult } from '../src/lib/mcp/tool-call-failure.ts';", body, 'throwIfErrorResult(parsed.result);']);
  assert.equal(routes(fromScripts.file, fromScripts.sf), true, 'a script importing across the tree routes');

  const importedNotCalled = decoy('src/lib/decoy/sender.ts', ["import { throwIfErrorResult } from '../mcp/tool-call-failure.ts';", body]);
  assert.equal(routes(importedNotCalled.file, importedNotCalled.sf), false, 'an import that is never called does not route');

  const lookalike = decoy('src/lib/decoy/sender.ts', ['function throwIfErrorResult(r) { return r; }', body, 'throwIfErrorResult(parsed.result);']);
  assert.equal(routes(lookalike.file, lookalike.sf), false, 'a local function of the same name does not route');

  const comment = decoy('src/lib/decoy/comment.ts', ['// this module never sends tools/call', "/* method: 'tools/call' */", 'export const x = 1;']);
  assert.equal(isSender(comment.sf), false, 'a comment naming the method is not a sender');

  const longer = decoy('src/lib/decoy/longer.ts', ["throw new Error('tools/call failed');"]);
  assert.equal(isSender(longer.sf), false, 'a longer string containing the method is not a sender');

  const sdk = decoy('src/lib/decoy/sdk.ts', ["import { Client } from '@modelcontextprotocol/sdk/client/index.js';"]);
  assert.equal(isSender(sdk.sf), true, 'a file importing the SDK client is a sender');
});

// --- The anchor, both directions ---------------------------------------------------

test('the anchor: the module the senders route through declares throwIfErrorResult, and no other tracked module does', () => {
  const files = trackedSourceFiles();
  const declares = (file: string): boolean =>
    nodes(parse(file, readFileSync(posix.join(REPO_ROOT, file), 'utf8'))).some(
      (n) => (ts.isFunctionDeclaration(n) && n.name?.text === ROUTE) ||
        (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ROUTE),
    );
  assert.ok(files.includes(ROUTE_HOME), `${ROUTE_HOME} is not a tracked module: there is no one function a sender can route through`);
  assert.ok(declares(ROUTE_HOME), `${ROUTE_HOME} declares no ${ROUTE}`);
  const others = files.filter((f) => f !== ROUTE_HOME && declares(f));
  assert.deepEqual(others, [], `a second declaration of ${ROUTE} would let a sender route through a lookalike: ${others.join(', ')}`);
});

// --- The class ---------------------------------------------------------------------------

test('every tracked file that sends tools/call routes the result through throwIfErrorResult', () => {
  const senders = trackedSourceFiles().filter((file) => isSender(parse(file, readFileSync(posix.join(REPO_ROOT, file), 'utf8'))));
  console.log(`# senders the scan derived: ${senders.length}\n${senders.map((s) => `#   ${s}`).join('\n')}`);
  assert.ok(senders.length > 0, 'the scan found no sender at all — it has stopped measuring');
  const unrouted = senders.filter((file) => !routes(file, parse(file, readFileSync(posix.join(REPO_ROOT, file), 'utf8'))));
  assert.deepEqual(
    unrouted,
    [],
    `senders that do not route a tools/call result through ${ROUTE} (${ROUTE_HOME}) — each records a result ` +
      `carrying isError: true as an answer: ${unrouted.join(', ')}`,
  );
});
