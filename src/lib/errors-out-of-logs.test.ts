// #503 WF — no server-side log line carries an error's message or a whole
// error object.
//
// WHY THE PROPERTY AND NOT A LIST. #503 P1 removed a reader's words from seven
// named log lines, and its cold read found the same leak at five more that no
// list had named: a model endpoint's refusal echoes the prompt back, the SDK
// puts that refusal in the error's `message`, and `console.error('x', err)`
// renders it. Phase WF was scoped by the property instead, and this file holds
// the property rather than the sites.
//
// TWO CARRIERS, both measured against the installed libraries, both driven
// here through the libraries' own constructors rather than hand-built
// look-alikes:
//
//   - the model SDK: `APIError.generate(400, { error: { message } }, …)` is the
//     function the SDK itself calls on a non-2xx answer, and the refusal body
//     lands in `message`;
//   - the ORM: `drizzle-orm`'s `queryWithCache` — the one method both of this
//     app's database drivers route every query through — wraps ANY failure as
//     `Failed query: <sql>\nparams: <every bound param>`. The error below is
//     produced by the REAL `node-postgres` driver running a real insert
//     against a loopback socket that hangs up, so it is the wrapper's own
//     output, not a copy of its format.
//
// Three more shapes ride with them: a `JSON.parse` failure (it quotes the text
// it could not parse — a malformed request body, or a source's malformed
// answer), a thrown value that is not an Error (the base logged it whole), and
// an Error whose own message is clean but whose `cause` carries the words
// (`console` renders the `cause` chain under the error).
//
// WHAT THIS FILE DOES, in three parts.
//
//   1. THE GUARD — the property, over every file. It reads every `console.*`
//      call in every server-side file `git ls-files` reports and fails on any
//      argument that names an error value — whole, by `.message`/`.stack`/
//      `.cause`, through `String(…)` or inside a template — unless it is
//      passed through the bound (`errorLogFacts`, `errorClassOf`,
//      `failureFacts`). The exemptions are listed, each with its measured
//      reason, and the list is bidirectional: an entry that no longer matches
//      a call fails too.
//   2. THE MATRIX — every site WF brought under the bound, driven with every
//      carrier. Each site's own `console` call is read out of its source file
//      and evaluated with the carrier bound to the name the site logs, so the
//      line that runs is the line in the tree, byte for byte.
//   3. THE INSTRUMENT'S OWN CHECK — the guard's classifier is run over one
//      specimen of every shape above and must flag each. An empty result from
//      a scanner is a broken instrument until shown otherwise.
//
// WHAT THE MATRIX REACHES AND WHAT IT CANNOT. It reaches the log call itself,
// with the real carrier value: what that line writes given that error. It
// does not reach the path INTO the `catch` — that a given route's failure
// arrives there carrying that carrier. That half is driven, for the sites
// where the carrier is reachable without a database, a signing key or a
// sandbox, by `src/lib/errors-out-of-logs-driven.test.ts`, which runs the real
// handlers. Neither file runs the Turbopack artifact; the bound's output in
// the artifact was verified by reading `.next/server` after a build (#503 G3
// and WF's gate record).
//
// THE INSTRUMENT HAS BEEN SEEN WORKING. Run unmodified against the base
// (`0b8079c`), the guard lists every site and the matrix finds the canary at
// every site that logged an error — shown in #503 WF's gate record.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/errors-out-of-logs.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import util from 'node:util';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);

/** Planted in every carrier; found in no log line. */
const CANARY = 'Wq3YtR8n-reader-question-canary';
/**
 * `JSON.parse` quotes at most ten characters of the text it rejects, so the
 * JSON carrier plants a canary short enough to be quoted whole. What that
 * carrier can leak is a fragment, and this is the fragment.
 */
const JSON_CANARY = 'Jz4qWv7k';

// --- Part 1: the guard ---------------------------------------------------------

/** Every tracked file of the JavaScript/TypeScript family, tests excluded. */
function trackedSourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' });
  return out
    .split('\n')
    .filter((f) => /\.(c|m)?[jt]sx?$/.test(f) && !/\.test\.(c|m)?[jt]sx?$/.test(f));
}

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/;

/**
 * Modules with no `'use client'` directive of their own that run only in the
 * browser: every file that imports them is a client module, which the guard
 * checks below rather than taking on trust. Their `console` is the reader's
 * devtools, not the platform's log store.
 */
const BROWSER_ONLY: Record<string, string> = {
  'src/lib/sse-client.ts': 'the SSE reader behind the client hooks; it fetches from the browser',
  'src/lib/offered-model.ts': "fetches the relative URL '/api/models', which only a browser can resolve",
};

/**
 * Operator tooling, not the app. Nothing under `scripts/` runs inside the
 * server: the image's runtime command is `node server.js` and its migration
 * command is `drizzle-kit migrate` (both in `Dockerfile`), and neither is a
 * tracked script. #503 G5 ruled the harnesses there out of scope — they print
 * their own fixtures, and no reader is involved.
 */
function isOperatorTooling(rel: string): boolean {
  return rel.startsWith('scripts/');
}

/** The server-side universe: tracked source, minus client code and operator tooling. */
function serverSideFiles(): string[] {
  return trackedSourceFiles().filter(
    (f) => !isOperatorTooling(f) && !USE_CLIENT.test(read(f)) && !(f in BROWSER_ONLY),
  );
}

interface ConsoleCall { file: string; line: number; text: string; args: string }

/** Every `console.<method>(…)` call in a file, balanced to its closing paren. */
function consoleCalls(file: string, src: string): ConsoleCall[] {
  const calls: ConsoleCall[] = [];
  const re = /\bconsole\s*\.\s*(log|error|warn|info|debug|trace|dir|table|assert)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length;
    const close = matchingParen(src, open);
    calls.push({
      file,
      line: src.slice(0, m.index).split('\n').length,
      text: src.slice(m.index, close + 1),
      args: src.slice(open, close),
    });
  }
  return calls;
}

/** Index of the `)` closing the paren opened just before `from`, skipping strings. */
function matchingParen(src: string, from: number): number {
  let depth = 1;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i);
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  throw new Error(`unbalanced console call at offset ${from}`);
}

/** Index of the closing quote of the string literal opening at `at`. */
function skipString(src: string, at: number): number {
  const q = src[at];
  for (let i = at + 1; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
      i = matchingBrace(src, i + 2);
      continue;
    }
    if (src[i] === q) return i;
  }
  throw new Error(`unterminated string at offset ${at}`);
}

function matchingBrace(src: string, from: number): number {
  let depth = 1;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = skipString(src, i); continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error(`unbalanced template expression at offset ${from}`);
}

/**
 * The argument text with every string's static text removed and every template
 * expression kept: `'[x] error:'` becomes `''`, `` `a ${err} b` `` becomes
 * `` `${err}` ``. What is left is what the call EVALUATES.
 */
function expressionsOnly(args: string): string {
  let out = '';
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "'" || c === '"') { out += "''"; i = skipString(args, i); continue; }
    if (c === '`') {
      const end = skipString(args, i);
      let j = i + 1;
      out += '`';
      while (j < end) {
        if (args[j] === '\\') { j += 2; continue; }
        if (args[j] === '$' && args[j + 1] === '{') {
          const close = matchingBrace(args, j + 2);
          out += '${' + expressionsOnly(args.slice(j + 2, close)) + '}';
          j = close + 1;
          continue;
        }
        j++;
      }
      out += '`';
      i = end;
      continue;
    }
    out += c;
  }
  return out;
}

/** The functions that ARE the bound. An error passed through one of them is bounded. */
const BOUND_FUNCTIONS = ['errorLogFacts', 'errorClassOf', 'failureFacts'];

function withoutBoundCalls(expr: string): string {
  let out = expr;
  for (const fn of BOUND_FUNCTIONS) {
    let at: number;
    while ((at = out.search(new RegExp(`\\b${fn}\\s*\\(`))) !== -1) {
      const open = out.indexOf('(', at) + 1;
      const close = matchingParen(out, open);
      out = `${out.slice(0, at)}BOUND${out.slice(close + 1)}`;
    }
  }
  return out;
}

/** Names that hold an error in this file: catch bindings, `.catch` callback parameters, and error-named identifiers. */
function errorNames(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\.catch\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g)) names.add(m[1]);
  return names;
}

const ERROR_NAMED = /^(e|err|error|cause|reason|[a-z][\w$]*(Err|Error))$/;

/** Member reads on a receiver that is never allowed onto a log line. */
const CONTENT_MEMBERS = /\.\s*(message|stack|cause|statusText)\b/;

/** Fields of an error that are numbers or closed codes, and so may be logged bare. */
const NUMERIC_MEMBERS = new Set(['exitCode', 'status']);

/**
 * Why a call's arguments carry an error's content — or null when they do not.
 * This is the classifier the guard runs; `Part 3` below shows it flagging a
 * specimen of every shape before its silence over the tree is trusted.
 */
function violation(args: string, fileErrorNames: Set<string>): string | null {
  const expr = withoutBoundCalls(expressionsOnly(args));
  const member = CONTENT_MEMBERS.exec(expr);
  if (member) return `reads \`.${member[1]}\``;
  if (/\bString\s*\(/.test(expr)) return 'stringifies a value with `String(…)`';
  // An identifier that is not itself a member (`a.err` is `a`'s field) — but
  // a spread (`...err`) is the identifier, so a dot preceded by a dot does not
  // count as member access.
  for (const m of expr.matchAll(/(?<![\w$])(?<![^.]\.)([A-Za-z_$][\w$]*)(\s*\.\s*([A-Za-z_$][\w$]*))?/g)) {
    const [, name, , memberName] = m;
    if (!(fileErrorNames.has(name) || ERROR_NAMED.test(name))) continue;
    if (memberName && NUMERIC_MEMBERS.has(memberName)) continue;
    return memberName ? `reads \`${name}.${memberName}\`` : `logs \`${name}\` itself`;
  }
  return null;
}

/**
 * EXEMPTIONS — for the seat to rule, not decided by this phase (#503 G5).
 *
 * Each is a typed CONFIGURATION error logged by its message. Measured: every
 * message these classes carry is assembled from module constants, variable
 * NAMES and closed sets of accepted values (`src/lib/model-client.ts`,
 * `src/lib/model-resolver.ts`, `src/lib/mcp/registry.ts`); two interpolate a
 * value the OPERATOR configured (`MODEL_API_AUTH=${raw}`, and a catalog
 * validation message naming a catalog entry). None reads a request. Each
 * route returns the same text to the caller in its response, so the log line
 * adds no exposure the response does not already have — and it is the
 * operator's only actionable fact: bounding it would reduce "MODEL_API_VERSION
 * is required when …" to `ModelConfigurationError`.
 *
 * Keyed by file and the call's exact text, so an entry that stops matching a
 * call — edited, moved or removed — fails the guard instead of silently
 * exempting nothing.
 */
const EXEMPT: Array<{ file: string; call: string }> = [
  { file: 'src/app/api/compare-stream/route.ts', call: "console.error('[compare-stream]', credentialError.message)" },
  { file: 'src/app/api/compare-stream/route.ts', call: "console.error('[compare-stream]', error.message)" },
  { file: 'src/app/api/compare-stream/route.ts', call: "console.error('[compare-stream]', mcpRoutingError.message)" },
  { file: 'src/app/api/compare/route.ts', call: "console.error('[compare]', credentialError.message)" },
  { file: 'src/app/api/compare/route.ts', call: "console.error('[compare]', mcpRoutingError.message)" },
  { file: 'src/app/api/compare/route.ts', call: "console.error('[compare]', error.message)" },
  { file: 'src/app/api/evidence/[slug]/publish/route.ts', call: "console.error('[publish]', credentialError.message)" },
  { file: 'src/app/api/evidence/[slug]/publish/route.ts', call: "console.error('[publish]', error.message)" },
  { file: 'src/app/api/evidence/[slug]/replay/route.ts', call: "console.error('[replay]', mcpRoutingError.message)" },
  { file: 'src/app/api/evidence/generate-summary/route.ts', call: "console.error('[generate-summary]', error.message)" },
  { file: 'src/app/api/models/route.ts', call: "console.error('[api/models]', error.message)" },
  { file: 'src/app/api/query-notebook/route.ts', call: "console.error('[query-notebook]', credentialError.message)" },
  { file: 'src/app/api/query-notebook/route.ts', call: "console.error('[query-notebook]', error.message)" },
  { file: 'src/app/api/query-notebook/route.ts', call: "console.error('[query-notebook]', mcpRoutingError.message)" },
];

/** The guard's own reading of the tree: every call with the property, and which exemption each matched. */
function scanTree(): { violations: string[]; exemptionHits: Map<number, number>; scanned: number; files: number } {
  const violations: string[] = [];
  const exemptionHits = new Map<number, number>();
  let scanned = 0;
  const files = serverSideFiles();
  for (const file of files) {
    const src = read(file);
    const names = errorNames(src);
    for (const call of consoleCalls(file, src)) {
      scanned++;
      const why = violation(call.args, names);
      if (!why) continue;
      const flat = call.text.replace(/\s+/g, ' ').replace(/\(\s/g, '(').replace(/,?\s\)$/, ')');
      const hit = EXEMPT.findIndex((e) => e.file === file && e.call === flat);
      if (hit !== -1) {
        exemptionHits.set(hit, (exemptionHits.get(hit) ?? 0) + 1);
        continue;
      }
      violations.push(`${file}:${call.line} ${why}\n    ${flat.slice(0, 220)}`);
    }
  }
  return { violations, exemptionHits, scanned, files: files.length };
}

const TREE = scanTree();

test('guard: the scan read the tree — files and console calls, not an empty universe', () => {
  assert.ok(TREE.files > 100, `only ${TREE.files} server-side files — the universe is not being derived`);
  assert.ok(TREE.scanned > 40, `only ${TREE.scanned} console calls read — the scanner is not reading calls`);
});

test('guard: no server-side console call carries an error’s message or a whole error object', () => {
  assert.deepEqual(
    TREE.violations,
    [],
    `${TREE.violations.length} server-side log call(s) carry an error's content. Pass the error through ` +
      '`errorLogFacts` (src/lib/streaming.ts) instead:\n' + TREE.violations.join('\n'),
  );
});

test('guard: every exemption still describes exactly one call in the tree', () => {
  const stale = EXEMPT.filter((_, i) => TREE.exemptionHits.get(i) !== 1)
    .map((e) => `${e.file}: ${e.call}`);
  assert.deepEqual(stale, [], `exemption(s) that match no call, or more than one:\n${stale.join('\n')}`);
});

test('guard: every browser-only module is imported only by client modules', () => {
  const importers: string[] = [];
  for (const [mod, why] of Object.entries(BROWSER_ONLY)) {
    assert.ok(fs.existsSync(path.join(REPO, mod)), `${mod} (${why}) no longer exists — remove the entry`);
    const stem = path.basename(mod).replace(/\.ts$/, '');
    const pattern = new RegExp(`from\\s+['"][^'"]*/${stem}(\\.ts)?['"]`);
    for (const file of trackedSourceFiles()) {
      if (file === mod || !pattern.test(read(file))) continue;
      if (!USE_CLIENT.test(read(file))) importers.push(`${file} imports ${mod}`);
    }
  }
  assert.deepEqual(importers, [], `a server-side module imports a module this guard treats as browser-only:\n${importers.join('\n')}`);
});

// --- Part 3: the classifier flags every shape (run before its silence is trusted) ---

test('instrument: the classifier flags an error passed every way a log call can carry one', () => {
  const names = new Set(['boom']);
  const flagged: Array<[string, string]> = [
    ['positional', "'[x] failed:', err"],
    ['positional, catch-bound name', "'[x] failed:', boom"],
    ['by message', "'[x] failed:', err.message"],
    ['by message, ternary', "'[x]', err instanceof Error ? err.message : err"],
    ['by stack', "'[x]', { stack: error.stack }"],
    ['through cause', "'[x]', wrapped.cause"],
    ['String()', "'[x]', String(err)"],
    ['template literal', '`[x] failed: ${err}`'],
    ['template member', '`[x] failed: ${lastError.message}`'],
    ['inside an object', "'[x]', { error: err }"],
    ['spread', "'[x]', { ...revertErr }"],
    ['reason phrase', "'[x]', response.status, response.statusText"],
  ];
  for (const [shape, args] of flagged) {
    assert.notEqual(violation(args, names), null, `the classifier missed the ${shape} shape: ${args}`);
  }
  const clean: Array<[string, string]> = [
    ['bounded', "'[x] failed:', errorLogFacts(err)"],
    ['bounded in a template', '`[x] failed${failureFacts(error)}`'],
    ['class only', "'[x]', { errorClass: errorClassOf(err), exitCode: err.exitCode }"],
    ['word inside a string', "'[x] error: the source failed'"],
    ['operator facts', '`[MCP:${server.sourceId}] Tool ${name}: ${response.status}, ${text.length} bytes`'],
  ];
  for (const [shape, args] of clean) {
    assert.equal(violation(args, names), null, `the classifier flagged a clean ${shape} call: ${args}`);
  }
});

// --- Part 2: the matrix -------------------------------------------------------

// The carriers, built with the libraries' own machinery.

const { APIError } = require('openai') as {
  APIError: { generate(status: number, body: unknown, message: string, headers: Headers): Error };
};

/** The SDK's own error for an endpoint that refused and echoed the prompt. */
function sdkRefusal(): Error {
  return APIError.generate(
    400,
    { error: { message: `Input flagged: the reader asked ${CANARY} about noise complaints`, type: 'invalid_request_error' } },
    'Bad Request',
    new Headers(),
  );
}

/**
 * The ORM's own error for a failed insert: the real `node-postgres` driver,
 * the real `drizzle` wrapper, a loopback socket that hangs up on connect. No
 * database is reached and none is needed — the wrapper is what writes the
 * params into the message, and every query passes through it.
 */
async function ormFailure(): Promise<Error> {
  const { Pool } = require('pg') as typeof import('pg');
  const { drizzle } = require('drizzle-orm/node-postgres') as typeof import('drizzle-orm/node-postgres');
  const { pgTable, text } = require('drizzle-orm/pg-core') as typeof import('drizzle-orm/pg-core');
  const hangUp = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => hangUp.listen(0, '127.0.0.1', () => resolve()));
  const { port } = hangUp.address() as AddressInfo;
  const pool = new Pool({ connectionString: `postgresql://fixture@127.0.0.1:${port}/fixture` });
  const records = pgTable('evidence_records', { title: text('title'), prompt: text('prompt') });
  try {
    await drizzle(pool).insert(records).values({ title: 'Noise complaints', prompt: `the reader asked ${CANARY}` });
  } catch (err) {
    return err as Error;
  } finally {
    await pool.end().catch(() => {});
    hangUp.close();
  }
  throw new Error('the loopback insert succeeded — there is no database here, so the fixture is broken');
}

function jsonFailure(): Error {
  try {
    JSON.parse(JSON_CANARY);
  } catch (err) {
    return err as Error;
  }
  throw new Error('JSON.parse accepted the canary');
}

const CARRIERS: Record<string, () => unknown | Promise<unknown>> = {
  'model SDK refusal': sdkRefusal,
  'ORM query failure': ormFailure,
  'JSON.parse failure': jsonFailure,
  'non-Error thrown value': () => ({ code: 'mcp_unavailable', detail: `last query was ${CANARY}` }),
  'clean Error, content in cause': () => new Error('wrapped failure', { cause: sdkRefusal() }),
};

/** The one planted string each carrier can carry. */
function canaryOf(carrier: string): string {
  return carrier === 'JSON.parse failure' ? JSON_CANARY : CANARY;
}

interface Site {
  file: string;
  /** A literal unique to the site's console call — its log prefix. */
  anchor: string;
  /** The name the call logs the error under, or a function building its scope. */
  bind: string | ((carried: unknown) => Record<string, unknown>);
  /**
   * When the logged value is derived on an earlier line, the text that opens
   * the extract — so the derivation runs too.
   */
  from?: string;
}

/**
 * Every server-side site WF found with the property, in `#503 WF`'s derived
 * set. The two P1 already bounded (`openrouter-streaming.ts` and the notebook
 * route) are held by `logs-carry-no-reader-content.test.ts` and by the guard.
 */
const SITES: Site[] = [
  { file: 'src/app/api/auth/device/code/route.ts', anchor: "'[api/auth/device/code] insert failed after retries'", bind: 'lastError' },
  { file: 'src/app/api/compare-stream/route.ts', anchor: "'Stream error:'", bind: 'error' },
  { file: 'src/app/api/compare-stream/route.ts', anchor: "'Compare stream API error:'", bind: 'error' },
  { file: 'src/app/api/compare/route.ts', anchor: "'Compare API error:'", bind: 'error' },
  { file: 'src/app/api/cron/blob-gc/route.ts', anchor: "'[blob-gc] run failed:'", bind: 'err' },
  { file: 'src/app/api/evidence/[slug]/attestations/route.ts', anchor: "'[attestations] signing failed — review not stored:'", bind: (carried) => ({ signing: { cause: carried } }) },
  { file: 'src/app/api/evidence/[slug]/evaluate/route.ts', anchor: "'[evaluate] Error:'", bind: 'error' },
  { file: 'src/app/api/evidence/[slug]/publish/route.ts', anchor: "'[api/evidence/publish] evaluation failed:'", bind: 'err' },
  { file: 'src/app/api/evidence/[slug]/publish/route.ts', anchor: "'[api/evidence/publish] visibility revert failed:'", bind: 'revertErr' },
  { file: 'src/app/api/evidence/[slug]/publish/route.ts', anchor: "'[api/evidence/publish] pair emission failed:'", bind: 'err' },
  { file: 'src/app/api/evidence/[slug]/replay/route.ts', anchor: "'[replay] Error:'", bind: 'error' },
  { file: 'src/app/api/evidence/generate-summary/route.ts', anchor: "'[generate-summary] Error:'", bind: 'error' },
  { file: 'src/app/api/evidence/route.ts', anchor: "'[api/evidence] publication-pair emission failed (non-fatal):'", bind: 'err' },
  { file: 'src/app/api/evidence/route.ts', anchor: "'Evidence publish error:'", bind: 'error' },
  { file: 'src/app/api/rate-limit/route.ts', anchor: "'Rate limit API error:'", bind: 'error' },
  { file: 'src/lib/evidence/lifecycle.ts', anchor: "'[lifecycle] attestation_nodes query failed; falling back to legacy columns:'", bind: 'err' },
  { file: 'src/lib/evidence/signing.ts', anchor: "'[signing] RFC 3161 timestamp failed:'", bind: 'err' },
  { file: 'src/lib/evidence/signing.ts', anchor: "'[signing] Rekor publish failed:'", bind: 'err' },
  { file: 'src/lib/mcp/client.ts', anchor: 'Could not parse initialize response body for instructions:', bind: (carried) => ({ error: carried, server: { sourceId: 'socrata' } }) },
  { file: 'src/lib/mcp/client.ts', anchor: 'Could not initialize for instructions fetch:', bind: (carried) => ({ error: carried, sourceId: 'socrata' }) },
  { file: 'src/lib/mcp/directory-data.ts', anchor: "'[Directory] Failed to fetch the configured source, using bundled snapshot:'", bind: 'error' },
  { file: 'src/lib/mcp/socrata-skill.ts', anchor: "'[Skill] Failed to fetch skill guidance, using fallback:'", bind: 'error' },
  { file: 'src/lib/mcp/socrata-skill.ts', anchor: 'Failed to fetch text for', bind: (carried) => ({ error: carried, sourceId: 'socrata' }) },
  { file: 'src/lib/storage/index.ts', anchor: "'[storage] blob delete failed (non-fatal):'", bind: 'err' },
  { file: 'src/lib/roadmap/data.ts', anchor: "'[Roadmap] Failed to fetch the configured source:'", bind: 'error', from: 'const message = error instanceof Error' },
];

/** The source text of a site's console call — and its derivation, when `from` names one. */
function extractSite(site: Site): string {
  const src = read(site.file);
  const matches = consoleCalls(site.file, src).filter((c) => c.text.includes(site.anchor));
  assert.equal(matches.length, 1, `${site.file}: ${matches.length} console calls carry the anchor ${site.anchor} — re-point it, do not delete it`);
  if (!site.from) return matches[0].text;
  const callAt = src.indexOf(matches[0].text);
  const fromAt = src.lastIndexOf(site.from, callAt);
  assert.notEqual(fromAt, -1, `${site.file}: the derivation ${site.from} is gone`);
  return src.slice(fromAt, callAt + matches[0].text.length);
}

const streamingModule = (await import('./streaming.ts')) as Record<string, unknown>;

/** Runs a site's own call text with the carrier bound to its name; returns what it logged. */
function runSite(site: Site, carried: unknown): string[] {
  const code = extractSite(site);
  const lines: string[] = [];
  const capture = (...args: unknown[]) => { lines.push(util.format(...args)); };
  const bindings: Record<string, unknown> = {
    // Whatever the bound exports today. At the base none of these exist, and
    // no site's call names them, so the base run needs none.
    ...streamingModule,
    console: { log: capture, error: capture, warn: capture, info: capture, debug: capture },
    ...(typeof site.bind === 'string' ? { [site.bind]: carried } : site.bind(carried)),
  };
  const scope = new Proxy(bindings, { has: (target, key) => key in target });
  // `with` is what lets the call text run verbatim, free names and all: the
  // sloppy-mode Function body resolves every name the call uses through the
  // scope above, and anything the scope lacks falls through to globals.
  new Function('scope', `with (scope) { ${code}; }`)(scope);
  return lines;
}

interface Cell { site: Site; carrier: string; lines: string[] }
const MATRIX: Cell[] = [];
const CARRIED = new Map<string, unknown>();
for (const [name, make] of Object.entries(CARRIERS)) CARRIED.set(name, await make());
for (const site of SITES) {
  for (const carrier of Object.keys(CARRIERS)) {
    MATRIX.push({ site, carrier, lines: runSite(site, CARRIED.get(carrier)) });
  }
}

test('premise: every carrier really carries its canary where console would render it', () => {
  for (const [name, value] of CARRIED) {
    assert.ok(
      util.format('%o', value).includes(canaryOf(name)) || util.format(value).includes(canaryOf(name)),
      `the ${name} carrier does not carry its canary — the matrix could only ever be green`,
    );
  }
  const orm = CARRIED.get('ORM query failure') as Error;
  assert.match(orm.message, /^Failed query: insert into "evidence_records"/, `the ORM carrier is not the wrapper's error: ${orm.message.slice(0, 120)}`);
  assert.match(orm.message, /\nparams: /, 'the ORM carrier does not list its params');
  const sdk = CARRIED.get('model SDK refusal') as Error & { status?: number };
  assert.equal(sdk.status, 400, 'the SDK carrier has no status');
});

test('premise: every site ran and logged — the matrix is not green because nothing was captured', () => {
  const silent = MATRIX.filter((c) => c.lines.length === 0).map((c) => `${c.site.file} ${c.site.anchor} × ${c.carrier}`);
  assert.deepEqual(silent, [], `site(s) that logged nothing:\n${silent.join('\n')}`);
});

for (const site of SITES) {
  test(`site ${site.file} ${site.anchor}: no carrier's content reaches the line`, () => {
    const leaks = MATRIX.filter((c) => c.site === site)
      .filter((c) => c.lines.some((l) => l.includes(canaryOf(c.carrier))))
      .map((c) => `  ${c.carrier}:\n${c.lines.map((l) => `    | ${l.slice(0, 300).replace(/\n/g, '\n    | ')}`).join('\n')}`);
    assert.deepEqual(leaks, [], `${site.file} ${site.anchor} logs the carrier's content:\n${leaks.join('\n')}`);
  });
}

test('every site: the line keeps the operator facts — the log prefix and a bounded error class', () => {
  const missing: string[] = [];
  for (const cell of MATRIX) {
    const text = cell.lines.join('\n');
    const prefix = cell.site.anchor.replace(/^'|'$/g, '');
    if (!text.includes(prefix)) missing.push(`${cell.site.file} × ${cell.carrier}: the log prefix is gone`);
    const cls = /errorClass: '([^']*)'/.exec(text)?.[1];
    if (!cls || !/^[A-Za-z][A-Za-z0-9]{0,62}$/.test(cls)) {
      missing.push(`${cell.site.file} ${cell.site.anchor} × ${cell.carrier}: no bounded errorClass field\n    | ${text.slice(0, 200)}`);
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('the SDK refusal keeps its status on the line — the fact that says who refused', () => {
  const noStatus = MATRIX.filter((c) => c.carrier === 'model SDK refusal')
    .filter((c) => !/status: 400/.test(c.lines.join('\n')))
    .map((c) => `${c.site.file} ${c.site.anchor}`);
  assert.deepEqual(noStatus, [], `site(s) that drop the SDK error's status:\n${noStatus.join('\n')}`);
});

// --- F4: a remote source's reason phrase --------------------------------------

test('src/lib/mcp/client.ts: a source’s HTTP reason phrase — text the source chose — is not on the line', () => {
  const site: Site = {
    file: 'src/lib/mcp/client.ts',
    anchor: 'Server error:',
    bind: () => ({ server: { sourceId: 'socrata' }, response: { status: 502, statusText: `Bad Gateway for ${CANARY}` } }),
  };
  const lines = runSite(site, undefined);
  assert.ok(lines.length > 0, 'the server-error line logged nothing');
  assert.ok(!lines.some((l) => l.includes(CANARY)), `the reason phrase reached the log:\n${lines.join('\n')}`);
  assert.match(lines.join('\n'), /502/, `the status is gone from the line:\n${lines.join('\n')}`);
});
