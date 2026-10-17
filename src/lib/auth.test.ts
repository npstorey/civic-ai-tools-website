// #516 P5 — the sign-in provider's access token is not kept in the session token.
//
// FOUR CLAIMS, the first, second and fourth driven through the real callbacks
// in `src/lib/auth.ts`, imported unmodified:
//
//   1. SIGN-IN. The `jwt` callback, given an `account` that carries the
//      provider's `access_token`, `refresh_token` and `id_token`, returns a
//      token in which none of the three values appears — under any key, at any
//      depth. The search is over the serialized token for each VALUE, not a
//      check of one key name, so a write under a new key fails it too.
//   2. AN EXISTING TOKEN. Given a token that already carries `accessToken`
//      and no `account` — what next-auth 4.24.15 passes on every session read
//      (`node_modules/next-auth/core/routes/session.js`, the `callbacks.jwt`
//      call) — the callback returns the token without it and with every other
//      field it was given, value for value. The same file re-encodes that result
//      into the session cookie, so a cookie minted before the change loses the
//      value on its next pass through `/api/auth/session`.
//   3. NO READER. A property check over `git ls-files`: no tracked source of the
//      JavaScript/TypeScript family (tests excluded) refers to the session
//      token's `accessToken` property, except the fix's own removal. Its header
//      is at "THE PROPERTY CHECK" below.
//   4. UNCHANGED. The `session` callback sets `user.id` and `dbId` exactly as it
//      did before, for the same inputs.
//
// STUBS. `@/lib/db` only, and only so that a sign-in with `DATABASE_URL` set
// can be driven without a database: the fake answers the one query the `jwt`
// callback makes (`select … from users … where … limit 1`) with the rows a test
// puts in `globalThis.__p5Rows`, and records how often it was asked. Everything
// else `auth.ts` imports — the provider list, the allowlist, the sign-in proxy
// transport (inert with no proxy configured), the schema — is the real module.
// No network address of any kind is reached.
//
// WHAT IS NOT REACHED. next-auth's own routes: the callbacks are called the way
// `core/routes/callback.js` and `core/routes/session.js` call them, by reading
// those files at 4.24.15, not by running a sign-in. `getToken`
// (`api/session-status/route.ts`) decodes the cookie without running any
// callback, so a cookie minted before the change still carries the value there
// until a session read has re-encoded it — the removal is on the callback's
// pass, which is what this phase claims, not on every decode.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/auth.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { NextAuthOptions, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

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
const SRC = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(SRC, '..');

// --- Module hooks -------------------------------------------------------------

const STUB_URL = 'file:///civic-r3-p5-stub/db.mjs';
const DB_STUB_SOURCE = `
  export const db = {
    select() {
      return { from() { return { where() { return { async limit() {
        globalThis.__p5DbQueries = (globalThis.__p5DbQueries ?? 0) + 1;
        return globalThis.__p5Rows ?? [];
      } }; } }; } };
    },
  };`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/db') return { url: STUB_URL, format: 'module', shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
      throw new Error(`#516 P5 test hook: cannot resolve ${specifier}`);
    }
    // Next's bundler resolves an extensionless relative import; Node's ESM
    // resolver does not. `auth.ts` has two (`./auth-providers`, `./auth-allowlist`).
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && !path.extname(specifier) && parent?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl === STUB_URL) return { format: 'module', source: DB_STUB_SOURCE, shortCircuit: true };
    return nextLoad(loadUrl, context);
  },
});

const { authOptions } = (await import('./auth.ts')) as { authOptions: NextAuthOptions };

type JwtParams = {
  token: JWT;
  user?: { id: string; name?: string | null; email?: string | null; image?: string | null };
  account?: Record<string, unknown> | null;
  profile?: Record<string, unknown>;
  isNewUser?: boolean;
  trigger?: 'signIn' | 'signUp' | 'update';
  session?: unknown;
};
const jwt = authOptions.callbacks!.jwt as unknown as (params: JwtParams) => Promise<JWT>;
const sessionCallback = authOptions.callbacks!.session as unknown as (params: {
  session: Session;
  token: JWT;
}) => Promise<Session>;

const g = globalThis as unknown as { __p5Rows?: unknown[]; __p5DbQueries?: number };

/** Run `fn` with `DATABASE_URL` set to `value` (or unset), restoring it after. */
async function withDatabaseUrl<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.DATABASE_URL;
  if (value === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
}

// Values only a provider would hand back. Plain words, so no secret scanner
// mistakes them for a real credential.
const PROVIDER_ACCESS = 'p5-provider-access-value-q7m2';
const PROVIDER_REFRESH = 'p5-provider-refresh-value-k4x9';
const PROVIDER_ID_TOKEN = 'p5-provider-id-token-value-w8z1';
const PROVIDER_VALUES = [PROVIDER_ACCESS, PROVIDER_REFRESH, PROVIDER_ID_TOKEN];

/** The account `core/routes/callback.js` hands the callback after an OAuth sign-in. */
function oauthAccount(provider: string, providerAccountId: string): Record<string, unknown> {
  return {
    provider,
    type: 'oauth',
    providerAccountId,
    access_token: PROVIDER_ACCESS,
    refresh_token: PROVIDER_REFRESH,
    id_token: PROVIDER_ID_TOKEN,
    token_type: 'bearer',
    scope: 'read:user user:email',
  };
}

/** The token `core/routes/callback.js` builds before calling the callback. */
function defaultToken(userId: string): JWT {
  return { name: 'Example Reader', email: 'reader@example.org', picture: null, sub: userId };
}

function assertCarriesNoProviderValue(token: JWT, label: string): void {
  assert.equal(Object.prototype.hasOwnProperty.call(token, 'accessToken'), false,
    `${label}: the token still has an accessToken key`);
  const serialized = JSON.stringify(token);
  for (const value of PROVIDER_VALUES) {
    assert.equal(serialized.includes(value), false,
      `${label}: a provider token value is in the session token under some key`);
  }
}

test('criterion 1, instrument: a provider value under any other key, at any depth, is caught', () => {
  assert.throws(() => assertCarriesNoProviderValue({ sub: '1', providerToken: PROVIDER_ACCESS }, 'fixture'),
    /a provider token value is in the session token/);
  assert.throws(() => assertCarriesNoProviderValue({ sub: '1', nested: { r: PROVIDER_REFRESH } }, 'fixture'),
    /a provider token value is in the session token/);
  assert.throws(() => assertCarriesNoProviderValue({ sub: '1', accessToken: undefined }, 'fixture'),
    /still has an accessToken key/);
});

// --- 1. Sign-in -----------------------------------------------------------------

const SIGN_INS = [
  { label: 'GitHub', provider: 'github', providerAccountId: '424242', userId: '424242', dbKey: '424242' },
  {
    label: 'generic OIDC',
    provider: 'oidc',
    providerAccountId: 'subject-77',
    userId: 'subject-77',
    dbKey: 'oidc:subject-77',
  },
];

for (const signIn of SIGN_INS) {
  test(`criterion 1: a ${signIn.label} sign-in writes no provider token into the session token (no database)`, async () => {
    await withDatabaseUrl(undefined, async () => {
      const token = await jwt({
        token: defaultToken(signIn.userId),
        user: { id: signIn.userId, name: 'Example Reader', email: 'reader@example.org' },
        account: oauthAccount(signIn.provider, signIn.providerAccountId),
        profile: { login: 'example-reader' },
        isNewUser: false,
        trigger: 'signIn',
      });
      assertCarriesNoProviderValue(token, `${signIn.label} sign-in`);
      assert.deepEqual(token, defaultToken(signIn.userId),
        'with no database, the sign-in token is the default token unchanged');
    });
  });

  test(`criterion 1: a ${signIn.label} sign-in writes no provider token, and still records the database id`, async () => {
    await withDatabaseUrl('postgres://p5-fixture.invalid/none', async () => {
      g.__p5Rows = [{ id: 'db-user-1' }];
      g.__p5DbQueries = 0;
      try {
        const token = await jwt({
          token: defaultToken(signIn.userId),
          user: { id: signIn.userId, name: 'Example Reader', email: 'reader@example.org' },
          account: oauthAccount(signIn.provider, signIn.providerAccountId),
          isNewUser: false,
          trigger: 'signIn',
        });
        assertCarriesNoProviderValue(token, `${signIn.label} sign-in with a database`);
        assert.equal(g.__p5DbQueries, 1, 'the callback looks the user up once');
        assert.deepEqual(token, { ...defaultToken(signIn.userId), dbUserId: 'db-user-1' });
      } finally {
        delete g.__p5Rows;
      }
    });
  });
}

// --- 2. An existing token -------------------------------------------------------

/** A decoded session cookie minted before the change: next-auth's claims plus ours. */
function preChangeToken(): JWT {
  return {
    name: 'Example Reader',
    email: 'reader@example.org',
    picture: 'https://avatars.example.org/u/424242',
    sub: '424242',
    dbUserId: 'db-user-1',
    accessToken: PROVIDER_ACCESS,
    iat: 1_760_000_000,
    exp: 1_762_592_000,
    jti: 'p5-fixture-jti',
  };
}

function withoutAccessToken(token: JWT): JWT {
  const copy: JWT = { ...token };
  delete copy.accessToken;
  return copy;
}

for (const databaseUrl of [undefined, 'postgres://p5-fixture.invalid/none']) {
  for (const trigger of [undefined, 'update'] as const) {
    test(`criterion 2: a session read (${trigger ?? 'no trigger'}, database ${databaseUrl ? 'set' : 'unset'}) drops a carried provider token and keeps every other field`, async () => {
      await withDatabaseUrl(databaseUrl, async () => {
        g.__p5DbQueries = 0;
        // The shape `core/routes/session.js` passes: no account, no user.
        const token = await jwt({ token: preChangeToken(), ...(trigger && { trigger }), session: undefined });
        assertCarriesNoProviderValue(token, 'a session read');
        assert.deepEqual(token, withoutAccessToken(preChangeToken()),
          'every field other than the provider token survives, value for value');
        assert.equal(g.__p5DbQueries, 0, 'a session read makes no database query');
      });
    });
  }
}

test('criterion 2: the sign-in token, read back through a session read, still carries no provider token', async () => {
  await withDatabaseUrl(undefined, async () => {
    const signedIn = await jwt({
      token: defaultToken('424242'),
      user: { id: '424242' },
      account: oauthAccount('github', '424242'),
      trigger: 'signIn',
    });
    const read = await jwt({ token: { ...signedIn, iat: 1, exp: 2, jti: 'j' } });
    assertCarriesNoProviderValue(read, 'sign-in then session read');
  });
});

// --- 4. The session callback is unchanged -----------------------------------------

/** The session next-auth builds from a decoded token before calling the callback. */
function baseSession(): Session {
  return { user: { name: 'Example Reader', email: 'reader@example.org', image: null }, expires: '2026-11-15T00:00:00.000Z' };
}

const SESSION_CASES: {
  label: string;
  databaseUrl: string | undefined;
  token: JWT;
  expectedUser: Session['user'];
}[] = [
  {
    label: 'database set, token with sub and dbUserId',
    databaseUrl: 'postgres://p5-fixture.invalid/none',
    token: { sub: '424242', dbUserId: 'db-user-1' },
    expectedUser: { name: 'Example Reader', email: 'reader@example.org', image: null, id: '424242', dbId: 'db-user-1' },
  },
  {
    label: 'database unset: id only, no dbId',
    databaseUrl: undefined,
    token: { sub: '424242', dbUserId: 'db-user-1' },
    expectedUser: { name: 'Example Reader', email: 'reader@example.org', image: null, id: '424242' },
  },
  {
    label: 'database set, no dbUserId on the token',
    databaseUrl: 'postgres://p5-fixture.invalid/none',
    token: { sub: 'oidc-subject-77' },
    expectedUser: { name: 'Example Reader', email: 'reader@example.org', image: null, id: 'oidc-subject-77' },
  },
  {
    label: 'no sub: the user is left as built',
    databaseUrl: 'postgres://p5-fixture.invalid/none',
    token: { dbUserId: 'db-user-1' },
    expectedUser: { name: 'Example Reader', email: 'reader@example.org', image: null },
  },
  {
    label: 'a pre-change token carrying the provider token',
    databaseUrl: 'postgres://p5-fixture.invalid/none',
    token: { sub: '424242', dbUserId: 'db-user-1', accessToken: PROVIDER_ACCESS },
    expectedUser: { name: 'Example Reader', email: 'reader@example.org', image: null, id: '424242', dbId: 'db-user-1' },
  },
];

for (const c of SESSION_CASES) {
  test(`criterion 4: the session callback's user.id and dbId are unchanged — ${c.label}`, async () => {
    await withDatabaseUrl(c.databaseUrl, async () => {
      const session = await sessionCallback({ session: baseSession(), token: c.token });
      assert.deepEqual(session, { ...baseSession(), user: c.expectedUser });
      assert.equal(JSON.stringify(session).includes(PROVIDER_ACCESS), false,
        'the session the browser reads carries no provider token');
    });
  });
}

// --- 3. THE PROPERTY CHECK ------------------------------------------------------
//
// THE PROPERTY. No tracked source reads the provider's access token from the
// session token. Before #516 P5 the session token held it under one key,
// `accessToken`, so the check is about that key: every syntactic reference to
// it is a finding, read or write, except the fix's own removal.
//
// THE UNIVERSE is derived, as in `model-loop/model-call-registry.test.ts`:
// `git ls-files -z --full-name`, filtered to /\.(c|m)?[jt]sx?$/ and not
// /\.test\.(c|m)?[jt]sx?$/. No directory list. A tracked file deleted from the
// working tree is skipped; a file that is not `git add`ed is not scanned. If git
// cannot answer, the scan throws rather than narrowing.
//
// READ VERSUS REMOVAL — BY SYNTAX, not by an exemption list. Each file is
// parsed with the TypeScript compiler (`ts.createSourceFile`). A finding is any
// identifier or string literal (including a template with no substitutions)
// whose text is exactly `accessToken`: a property access (`t.accessToken`,
// `t?.accessToken`), an element access (`t['accessToken']`), a destructuring
// binding (`{ accessToken }`, `{ accessToken: x }`), an object-literal key, a
// JSX attribute, an `in` test, an argument (`Reflect.get(t, 'accessToken')`),
// or a variable of that name. The one exempt form is the operand of `delete`
// (`delete t.accessToken`, `delete t['accessToken']`, parentheses allowed),
// which removes the value and cannot read it. Comments are not syntax, so the
// fix's comment naming the key is not a finding — the reason syntax was chosen
// over a text search.
//
// THE EXEMPT FORM IS STILL PINNED, two ways. The removals found must be
// exactly `EXPECTED_REMOVALS` (file plus the exact text of the `delete`
// expression): a removal that disappears from `auth.ts` fails, and so does a
// new one anywhere else, so the exemption always describes the tree.
//
// BLIND SPOTS. Code that reaches the value without naming the key: a spread or
// rest of the whole token (`{ ...token }`), `Object.values`/`entries`,
// `JSON.stringify(token)`, a key computed at run time (`t['access' + 'Token']`,
// a template with a substitution), a key spelled with Unicode escapes (the
// text pre-filter skips the file). A write under some OTHER key is not a
// reference to this one — criterion 1 above catches that, through the
// callback, by value. Files outside the JavaScript/TypeScript family, test
// files (excluded by the contract), and untracked files are not read. And a
// variable that merely shares the name is a finding: the check prefers a false
// alarm to a miss, and a rename settles it.

const KEY = 'accessToken';

interface Site {
  file: string;
  line: number;
  text: string;
}

const EXPECTED_REMOVALS: { file: string; text: string }[] = [
  { file: 'src/lib/auth.ts', text: 'delete token.accessToken' },
];

function scriptKindFor(file: string): ts.ScriptKind {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.(c|m)?ts$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function lineText(sourceFile: ts.SourceFile, node: ts.Node): Site {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { file: sourceFile.fileName, line: line + 1, text: node.getText(sourceFile) };
}

/** The `delete` expression this key node is the removed property of, or null. */
function removalOf(node: ts.Node): ts.DeleteExpression | null {
  const access = node.parent;
  const isAccessedName =
    (ts.isPropertyAccessExpression(access) && access.name === node) ||
    (ts.isElementAccessExpression(access) && access.argumentExpression === node);
  if (!isAccessedName) return null;
  let outer: ts.Node = access;
  while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
  return ts.isDeleteExpression(outer.parent) && outer.parent.expression === outer ? outer.parent : null;
}

/** Every reference to the key in one source, split into findings and removals. */
function scanSource(file: string, source: string): { findings: Site[]; removals: Site[] } {
  const findings: Site[] = [];
  const removals: Site[] = [];
  if (!source.includes(KEY)) return { findings, removals };
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const visit = (node: ts.Node): void => {
    const named =
      (ts.isIdentifier(node) && node.text === KEY) ||
      (ts.isStringLiteralLike(node) && node.text === KEY);
    if (named) {
      const removal = removalOf(node);
      if (removal) removals.push(lineText(sourceFile, removal));
      else findings.push(lineText(sourceFile, node.parent));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { findings, removals };
}

function isSource(name: string): boolean {
  return /\.(c|m)?[jt]sx?$/.test(name) && !/\.test\.(c|m)?[jt]sx?$/.test(name);
}

function trackedSourceFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z', '--full-name'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const tracked = listing.split('\0').filter((name) => name !== '' && isSource(name));
  assert.ok(tracked.length > 0,
    'git ls-files reported no source files at all; the scan has stopped measuring');
  return tracked.filter((name) => fs.existsSync(path.join(REPO_ROOT, name)));
}

function scanTree(): { files: string[]; findings: Site[]; removals: Site[] } {
  const files = trackedSourceFiles();
  const findings: Site[] = [];
  const removals: Site[] = [];
  for (const file of files) {
    const result = scanSource(file, fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    findings.push(...result.findings);
    removals.push(...result.removals);
  }
  return { files, findings, removals };
}

/** The property, as an assertion: no finding, and the removals are exactly the expected ones. */
function assertProperty(findings: Site[], removals: Site[]): void {
  assert.deepEqual(
    findings.map((s) => `${s.file}:${s.line}: ${s.text}`),
    [],
    'a tracked source refers to the session token\'s provider-token key `accessToken`. The session token ' +
      'does not carry the sign-in provider\'s access token (#516 P5); see the header of src/lib/auth.test.ts.',
  );
  assert.deepEqual(
    removals.map((s) => ({ file: s.file, text: s.text })),
    EXPECTED_REMOVALS,
    'the removals of `accessToken` no longer match EXPECTED_REMOVALS in src/lib/auth.test.ts — a removal ' +
      'went missing, or a new one appeared; update the list only with the tree it describes',
  );
}

test('criterion 3: no tracked source reads the provider token from the session token', () => {
  const { files, findings, removals } = scanTree();
  assert.ok(files.includes('src/lib/auth.ts'), 'the scan does not reach src/lib/auth.ts');
  assert.ok(files.some((f) => f.endsWith('.mjs')) && files.some((f) => f.endsWith('.tsx')),
    'the scan does not reach the whole family');
  assertProperty(findings, removals);
});

// The instrument, red: fixtures that read it, defined here and never tracked as
// sources. Each must be a finding, and the property assertion must fail on it.
const READING_FIXTURES: { file: string; source: string; expected: number }[] = [
  { file: 'fixture/get-token.ts', source: 'export async function f(req: unknown) { const t = await getToken({ req }); return t?.accessToken; }', expected: 1 },
  { file: 'fixture/destructure.ts', source: 'export function f(token: Record<string, unknown>) { const { accessToken } = token; return accessToken; }', expected: 2 },
  { file: 'fixture/rename.mjs', source: 'export function f(token) { const { accessToken: p } = token; return p; }', expected: 1 },
  { file: 'fixture/element.js', source: "export const f = (token) => token['accessToken'];", expected: 1 },
  { file: 'fixture/template.cjs', source: 'module.exports = (token) => token[`accessToken`];', expected: 1 },
  { file: 'fixture/copy.ts', source: 'export function f(session: any, token: any) { session.accessToken = token.accessToken; }', expected: 2 },
  { file: 'fixture/in.ts', source: "export const has = (token: object) => 'accessToken' in token;", expected: 1 },
  { file: 'fixture/reflect.ts', source: "export const f = (token: object) => Reflect.get(token, 'accessToken');", expected: 1 },
  { file: 'fixture/jsx.tsx', source: 'export const C = ({ t }: any) => <Child accessToken={t.accessToken} />;', expected: 2 },
  { file: 'fixture/delete-then-read.ts', source: 'export function f(t: any) { const v = t.accessToken; delete t.accessToken; return v; }', expected: 1 },
];

for (const fixture of READING_FIXTURES) {
  test(`criterion 3, instrument: a source that reads it is a finding — ${fixture.file}`, () => {
    const { findings, removals } = scanSource(fixture.file, fixture.source);
    assert.equal(findings.length, fixture.expected, JSON.stringify(findings));
    assert.throws(() => assertProperty(findings, [...removals, ...EXPECTED_REMOVALS.map((r) => ({ ...r, line: 0 }))]),
      /refers to the session token's provider-token key/);
  });
}

// What the instrument must NOT call a read.
const NON_READING_FIXTURES: { file: string; source: string; removals: number }[] = [
  { file: 'fixture/remove.ts', source: 'export function f(token: any) { delete token.accessToken; return token; }', removals: 1 },
  { file: 'fixture/remove-element.mjs', source: "export function f(token) { delete token['accessToken']; delete (token.accessToken); }", removals: 2 },
  { file: 'fixture/comment.ts', source: '// the accessToken key is removed on every pass\nexport const x = 1;', removals: 0 },
  { file: 'fixture/provider-field.ts', source: 'export const f = (account: any) => account.access_token;', removals: 0 },
  { file: 'fixture/longer-name.ts', source: 'export const accessTokenTtl = 60; export const s = "accessToken expired";', removals: 0 },
];

for (const fixture of NON_READING_FIXTURES) {
  test(`criterion 3, instrument: not a read — ${fixture.file}`, () => {
    const { findings, removals } = scanSource(fixture.file, fixture.source);
    assert.deepEqual(findings, []);
    assert.equal(removals.length, fixture.removals);
  });
}

test('criterion 3, instrument: the removal list fails both ways', () => {
  // A removal missing from the tree.
  assert.throws(() => assertProperty([], []), /removals of `accessToken` no longer match/);
  // A removal the list does not name.
  const extra = scanSource('src/lib/other.ts', 'export function f(t: any) { delete t.accessToken; }').removals;
  assert.throws(
    () => assertProperty([], [...EXPECTED_REMOVALS.map((r) => ({ ...r, line: 1 })), ...extra]),
    /removals of `accessToken` no longer match/,
  );
});
