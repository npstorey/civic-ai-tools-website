/**
 * Guard: every environment variable the deployed app reads is declared (#434 P1).
 *
 * WHY A DERIVED UNIVERSE. `scripts/check-compose-env.mjs` proves the compose
 * file can deliver every variable `ENV_SPEC` declares. It cannot see a
 * variable the code reads and `ENV_SPEC` omits: a name missing from both files
 * passes a check that compares one file with the other. Four footer variables
 * sat in exactly that gap — `SITE_BRAND_REPO_URL`, `SITE_SPONSOR_NAME`,
 * `SITE_SPONSOR_PREFIX`, `SITE_SPONSOR_URL` — documented in `docs/deploy.md`,
 * read by the root layout, and unset in every compose deployment whatever the
 * operator's env file said. This file closes the chain from the other end: it
 * derives, from the code, every name the app reads, and fails on a name
 * `ENV_SPEC` does not declare. At `ea1164c` it failed naming exactly those four.
 *
 * THE UNIVERSE, DERIVED. `git ls-files` supplies it: every tracked path whose
 * name matches /\.(c|m)?[jt]sx?$/, wherever it sits — `src/`, the root config
 * files (`next.config.ts`; `drizzle.config.ts`, which the image's migrate
 * target runs), and any directory created later. Two exclusions, each for a
 * reason:
 *
 *   - Tests (/\.test\.(c|m)?[jt]sx?$/). `node --test` runs them; neither the
 *     build nor the server loads one. A test sets variables for itself; it
 *     does not ask a deployment for them.
 *   - `scripts/`, except the files a build or serve command runs. The rest is
 *     operator and CI tooling run by hand — key generation, backfills,
 *     rehearsals, the model-eval harness, this repository's own checks — and a
 *     variable only such a tool reads is the operator's shell's business, not
 *     something a deployment must deliver. (`ENV_SPEC` enumerates a few of them
 *     as `external-tool` for completeness; this guard neither demands nor
 *     forbids that.) The exception is derived, not listed: starting from the
 *     `package.json` scripts that build or serve the app (`BUILD_AND_RUN`
 *     below, plus npm's `pre`/`post` hooks for each) and following every
 *     `npm run`, any `scripts/…` file those commands name is back in the
 *     universe. At this commit that is `scripts/check-standalone-assets.mjs`,
 *     which the image build runs through `build:standalone`.
 *
 * BUILD_AND_RUN IS THE ONE HAND LIST HERE, AND IT IS CROSS-CHECKED. Every
 * `npm run <x>` in a RUN, CMD or ENTRYPOINT of the Dockerfile that the compose
 * app service builds must be on it (the fifth assertion), so a new image entry
 * point cannot fall outside the universe without failing. What stays by hand,
 * and why: the hosted platform's build (`build`, which its Next.js preset runs;
 * `vercel.json` declares no build command), local `dev` and `start`, and
 * `db:migrate` (the image's migrate target runs `drizzle-kit migrate` itself,
 * and its config sits at the root, in the universe anyway).
 *
 * Git answers or the scan throws: there is no narrower fallback, because a
 * guard that quietly shrinks its own reach is trusted for reach it no longer
 * has. A new file that is not yet staged is not tracked and not scanned; it is
 * seen the moment it is staged, before any commit can carry it. (The precedent
 * is `src/lib/model-loop/model-call-registry.test.ts`.)
 *
 * HOW A FILE IS READ. Each file is parsed into a TypeScript syntax tree
 * (`typescript`, already a dependency). A comment is not a node of that tree,
 * so a name that appears only in prose — `publisher-env.ts:24-25`,
 * `model-client.ts:318` at this commit — is never counted. Neither is a name
 * inside an ordinary string, nor a WRITE (`env[k] = v` into an object being
 * built, `process.env.X = v`).
 *
 * WHAT AN ENV RECORD IS. `process.env` (also reached as `globalThis.process`,
 * or as `env` imported from `node:process`); a parameter named `env` — the
 * convention every injectable reader here follows, with a `process.env`
 * default or without one (`src/lib/mcp/registry.ts`'s has none); and any
 * parameter or variable whose default or initialiser is an env record,
 * including through `??`, `||` or a ternary (`const env = ports.env ??
 * process.env`). A parameter named `env` that provably never holds the
 * environment is listed in NOT_ENV_RECORDS with its reason: one at this
 * commit, `buildDockerEnvFlags` in `sandbox/container.ts`, whose `env` is a
 * notebook's own variables being turned into `docker exec -e` flags, typed
 * `Record<string, string>`, which `process.env` cannot satisfy under strict
 * null checks. A name is counted when it is shaped like a variable
 * (/^[A-Z][A-Z0-9_]*$/), so an `env` parameter that holds a config object with
 * camelCase fields (`env.socrataUrl`) is not read for them.
 *
 * THE READ FORMS, with where the tree carries each at this commit. The first
 * assertion fails if the scan stops seeing a form the tree carries, and its
 * fixture exercises every form, including the two the tree does not carry:
 *
 *   1. `process.env.NAME` — the common form.
 *   2. `env.NAME` through an env record handed in — `host-routing`,
 *      `unsigned-tier`, `auth-providers`, `storage/s3`, `sandbox/*`, and more.
 *   3. A literal key — `process.env['NAME']`, or `'NAME' in env`. None in the
 *      tree today.
 *   4. A bracket read through a string constant — `auth-allowlist.ts`,
 *      `model-client.ts`, `sandbox/execute.ts`, `sandbox/container.ts`,
 *      `sandbox/vercel-sandbox.ts`. The constant must be a `const` in the
 *      same file bound to a string literal; anything else is an unresolved
 *      site (below).
 *   5. A helper that takes the name — a function whose body reads
 *      `env[<its parameter>]`, resolved at each call site in its own file:
 *      `readSetting('…')` in `model-client.ts` and, separately, in
 *      `model-resolver.ts`. A helper that is EXPORTED is an unresolved site,
 *      because its callers in other files are not followed.
 *   6. Destructuring — `const { NAME } = process.env`, or a parameter pattern
 *      whose default is an env record. None in the tree today.
 *   7. A computed name — `env[canonicalEnvName(suffix)]` in
 *      `publisher-env.ts`. The scan cannot evaluate an expression, so every
 *      computed site must be listed in COMPUTED beside the module export that
 *      enumerates its names; the guard imports that export and checks each
 *      name like any other read.
 *
 * UNRESOLVED IS LOUD, NOT SILENT. A computed key that COMPUTED does not list, a
 * helper argument that is neither a literal nor a same-file constant, an
 * exported helper, and a whole-record read (`...process.env`,
 * `Object.keys(process.env)`, `for (k in process.env)`) each name no variable
 * the scan can check, so each fails the third assertion, by file and line,
 * until it is resolved or listed.
 *
 * FIVE ASSERTIONS; EVERY LIST IS CHECKED IN BOTH DIRECTIONS.
 *   - The scan measures: the universe is derived as stated, every read form
 *     the tree carries is seen at a named site, and a fixture source that
 *     exercises all seven forms — plus a comment, a string, a write and a
 *     config field that must NOT count — yields exactly the names it should.
 *   - Every name read is declared in ENV_SPEC (as `name` or `priorEraName`)
 *     or sits on ALLOW with a reason. Every ALLOW entry must still be read and
 *     still be undeclared.
 *   - Every read site is resolved. Every COMPUTED entry must still name a
 *     site, and every NOT_ENV_RECORDS entry must still exempt a parameter the
 *     scan met.
 *   - THE SWEEP. An UPPER_SNAKE property read (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/)
 *     on anything the scan does not recognise as an env record fails, so an
 *     env record held under another name (`cfg.SOME_VARIABLE`) is reported
 *     rather than skipped. The tree has no such read at this commit, so
 *     NOT_ENV — the list of objects that legitimately carry such fields — is
 *     empty.
 *   - BUILD_AND_RUN names every npm script the app image runs (above).
 *
 * BLIND SPOTS, stated so nobody has to infer them:
 *   - Reads inside dependencies. `node_modules` is not tracked: the sign-in
 *     library's own reads, the storage and sandbox SDKs' credential lookups,
 *     and Next.js's (`PORT`, `HOSTNAME`, `NEXT_*`) are invisible here.
 *     `ENV_SPEC` declares the ones an operator must set; this guard cannot
 *     tell whether it declares all of them.
 *   - An env record held under another name and read with a name that has no
 *     underscore (`cfg.PORT`), or destructured from a parameter with no
 *     `process.env` default (`function f({ NAME }: Env)`). The sweep sees only
 *     UPPER_SNAKE property reads, and destructuring is not a property read.
 *   - An env record stored on an object property (`this.env = process.env`)
 *     and read later is not recognised as one; the sweep reports its
 *     UPPER_SNAKE reads.
 *   - A constant or helper imported from another module is not followed. It
 *     surfaces as an unresolved site, which fails, so this gap is loud.
 *   - Whether a read is reachable. A read in dead code, or in a module only a
 *     test imports, still counts: over-reporting is the safe direction for an
 *     inventory.
 *   - Delivery. A declared name can still fail to reach the process. That is
 *     `scripts/check-compose-env.mjs`'s job: it checks the compose file
 *     against ENV_SPEC and, since #434, the `ARG` lines of the Dockerfile
 *     stage that runs the build against both. A hosting platform's own
 *     configuration is checked by nothing in this repository.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENV_SPEC } from './preflight-env.mjs';
import { parseComposeService, parseDockerfile } from './check-compose-env.mjs';

const ts = createRequire(import.meta.url)('typescript');

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const SOURCE = /\.(c|m)?[jt]sx?$/;
const TEST = /\.test\.(c|m)?[jt]sx?$/;
/** A name shaped like an environment variable. */
const ENV_SHAPED = /^[A-Z][A-Z0-9_]*$/;
/** What the sweep looks for on objects that are not env records. */
const SWEEP_SHAPED = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/** The `package.json` scripts that build or serve the app — the roots of the
 *  `scripts/` derivation (see the header). The image build runs
 *  `build:standalone`, the hosted platform `build`, and the migrate target
 *  `drizzle-kit migrate` (`db:migrate`). */
const BUILD_AND_RUN = ['build', 'build:standalone', 'start', 'dev', 'db:migrate'];

/** Names the app reads that ENV_SPEC deliberately does not declare. */
const ALLOW = {
  NODE_ENV:
    'set by the Node.js / Next.js runtime (and by the Dockerfile runner stage), never by an operator',
  BUILD_STANDALONE:
    'set inline by `npm run build:standalone` itself (package.json) to select standalone output; an operator never sets it',
};

/** Computed read sites, each with the export that enumerates its names. */
const COMPUTED = [
  {
    file: 'src/lib/publisher-env.ts',
    keys: ['canonicalEnvName(suffix)', 'priorEraEnvName(suffix)'],
    reason:
      'the thirteen publisher variables under both prefixes, read through one resolver; the module exports both name lists',
    async names() {
      const mod = await import(pathToFileURL(join(REPO_ROOT, 'src/lib/publisher-env.ts')).href);
      return [...mod.PUBLISHER_ENV_NAMES, ...mod.PRIOR_ERA_ENV_NAMES];
    },
  },
];

/** Objects that legitimately carry UPPER_SNAKE fields and are not env records,
 *  keyed by the object expression's text. Empty at this commit. */
const NOT_ENV = {};

/** Functions whose parameter named `env` is not the environment, keyed
 *  `<file>#<function>`. Without an entry the naming convention would make it
 *  an env record, and its whole-record use an unresolved read. */
const NOT_ENV_RECORDS = {
  'src/lib/sandbox/container.ts#buildDockerEnvFlags':
    "a notebook's own variables (built by buildNotebookEnv in sandbox/execute.ts from two declared names plus " +
    'caller extras), turned into `docker exec -e` flags; typed Record<string, string>, which process.env cannot satisfy',
};

// --- the universe ------------------------------------------------------------

/**
 * The `scripts/` files a build or serve command runs: from BUILD_AND_RUN,
 * following npm's `pre`/`post` hooks and every `npm run`, every `scripts/…`
 * source path a command names.
 */
export function scriptsTheAppRuns(packageJson) {
  const scripts = packageJson.scripts ?? {};
  const files = new Set();
  const visited = new Set();
  const queue = [...BUILD_AND_RUN];
  while (queue.length > 0) {
    const name = queue.shift();
    if (visited.has(name) || typeof scripts[name] !== 'string') continue;
    visited.add(name);
    queue.push(`pre${name}`, `post${name}`);
    for (const m of scripts[name].matchAll(/\bnpm run ([\w:.-]+)/g)) queue.push(m[1]);
    for (const m of scripts[name].matchAll(/(?:^|[\s'"=])(scripts\/[^\s'"&|;]+)/g)) {
      if (SOURCE.test(m[1])) files.add(m[1]);
    }
  }
  return files;
}

function universe() {
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const root of BUILD_AND_RUN) {
    assert.equal(
      typeof packageJson.scripts?.[root],
      'string',
      `package.json has no "${root}" script, so the scripts/ derivation lost a root — update BUILD_AND_RUN`,
    );
  }
  const scriptsRun = scriptsTheAppRuns(packageJson);
  const listing = execFileSync('git', ['ls-files', '-z', '--full-name'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = listing
    .split('\0')
    .filter((p) => p !== '' && SOURCE.test(p) && !TEST.test(p))
    .filter((p) => !p.startsWith('scripts/') || scriptsRun.has(p))
    // A tracked file deleted from the working tree has nothing to read.
    .filter((p) => existsSync(join(REPO_ROOT, p)));
  return { files, scriptsRun: [...scriptsRun] };
}

// --- the scanner -------------------------------------------------------------

function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(c|m)?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function unwrap(node) {
  let n = node;
  while (
    n &&
    (ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isTypeAssertionExpression(n) ||
      ts.isSatisfiesExpression(n))
  ) {
    n = n.expression;
  }
  return n;
}

function isProcess(node) {
  const n = unwrap(node);
  if (ts.isIdentifier(n)) return n.text === 'process';
  return (
    ts.isPropertyAccessExpression(n) &&
    n.name.text === 'process' &&
    ts.isIdentifier(n.expression) &&
    (n.expression.text === 'globalThis' || n.expression.text === 'global')
  );
}

function isProcessEnv(node) {
  const n = unwrap(node);
  return ts.isPropertyAccessExpression(n) && n.name.text === 'env' && isProcess(n.expression);
}

/** The node that declares `name` in `nameNode`'s binding, or undefined. */
function declares(nameNode, name, declaration) {
  if (ts.isIdentifier(nameNode)) return nameNode.text === name ? declaration : undefined;
  if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const element of nameNode.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const found = declares(element.name, name, element);
      if (found) return found;
    }
  }
  return undefined;
}

function declaredByStatement(statement, name) {
  if (ts.isVariableStatement(statement)) {
    for (const v of statement.declarationList.declarations) {
      const found = declares(v.name, name, v);
      if (found) return found;
    }
  } else if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
    statement.name?.text === name
  ) {
    return statement;
  } else if (ts.isImportDeclaration(statement) && statement.importClause) {
    const clause = statement.importClause;
    if (clause.name?.text === name) return clause;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) return bindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) if (element.name.text === name) return element;
    }
  }
  return undefined;
}

/** The declaration `name` resolves to from `from`, by a lexical walk outward. */
function declarationOf(from, name) {
  for (let scope = from.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      for (const p of scope.parameters ?? []) {
        const found = declares(p.name, name, p);
        if (found) return found;
      }
    }
    if (
      ts.isSourceFile(scope) ||
      ts.isBlock(scope) ||
      ts.isModuleBlock(scope) ||
      ts.isCaseClause(scope) ||
      ts.isDefaultClause(scope)
    ) {
      for (const statement of scope.statements) {
        const found = declaredByStatement(statement, name);
        if (found) return found;
      }
    }
    if (
      (ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) &&
      scope.initializer &&
      ts.isVariableDeclarationList(scope.initializer)
    ) {
      for (const v of scope.initializer.declarations) {
        const found = declares(v.name, name, v);
        if (found) return found;
      }
    }
    if (ts.isCatchClause(scope) && scope.variableDeclaration) {
      const found = declares(scope.variableDeclaration.name, name, scope.variableDeclaration);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Whether an expression evaluates to an env record (see the header). `ctx`
 * carries the file being scanned, the NOT_ENV_RECORDS keys, and the set of
 * keys that actually exempted something (for the stale-entry check).
 */
function isEnvRecordIn(ctx, node, depth = 0) {
  const n = unwrap(node);
  if (!n || depth > 8) return false;
  if (isProcessEnv(n)) return true;
  if (
    ts.isBinaryExpression(n) &&
    (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || n.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return isEnvRecordIn(ctx, n.left, depth + 1) || isEnvRecordIn(ctx, n.right, depth + 1);
  }
  if (ts.isConditionalExpression(n)) {
    return isEnvRecordIn(ctx, n.whenTrue, depth + 1) || isEnvRecordIn(ctx, n.whenFalse, depth + 1);
  }
  if (!ts.isIdentifier(n)) return false;
  const declaration = declarationOf(n, n.text);
  if (!declaration) return false;
  if (ts.isParameter(declaration) && ts.isIdentifier(declaration.name)) {
    if (declaration.initializer !== undefined && isEnvRecordIn(ctx, declaration.initializer, depth + 1)) return true;
    if (declaration.name.text !== 'env') return false;
    const key = `${ctx.file}#${helperBinding(declaration.parent)?.name ?? '(anonymous)'}`;
    if (ctx.notEnvRecords.has(key)) {
      ctx.exempted.add(key);
      return false;
    }
    return true;
  }
  if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
    return declaration.initializer !== undefined && isEnvRecordIn(ctx, declaration.initializer, depth + 1);
  }
  if (ts.isImportSpecifier(declaration)) {
    const moduleSpecifier = declaration.parent.parent.parent.moduleSpecifier;
    return (
      (declaration.propertyName ?? declaration.name).text === 'env' &&
      ts.isStringLiteral(moduleSpecifier) &&
      (moduleSpecifier.text === 'process' || moduleSpecifier.text === 'node:process')
    );
  }
  return false;
}

/** A plain assignment's target, or a `delete` operand: not a read. */
function isWriteTarget(node) {
  const parent = node.parent;
  return (
    (ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
    ts.isDeleteExpression(parent)
  );
}

/** Resolve a key expression to names, to a helper's parameter, or to nothing. */
function resolveKey(node, depth = 0) {
  const n = unwrap(node);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return { names: [n.text], via: 'literal' };
  if (ts.isIdentifier(n) && depth < 8) {
    const declaration = declarationOf(n, n.text);
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      ts.isIdentifier(declaration.name) &&
      declaration.parent.flags & ts.NodeFlags.Const &&
      declaration.initializer
    ) {
      const resolved = resolveKey(declaration.initializer, depth + 1);
      return resolved.names ? { names: resolved.names, via: 'constant' } : resolved;
    }
    if (declaration && ts.isParameter(declaration) && ts.isIdentifier(declaration.name)) return { param: declaration };
  }
  return { computed: n.getText() };
}

/** The node a helper is called by, when it has a name to be called by. */
function helperBinding(fn) {
  if (ts.isFunctionDeclaration(fn) && fn.name) return { binding: fn, name: fn.name.text };
  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    ts.isVariableDeclaration(fn.parent) &&
    ts.isIdentifier(fn.parent.name)
  ) {
    return { binding: fn.parent, name: fn.parent.name.text };
  }
  return undefined;
}

function isExported(binding, name, sourceFile) {
  const statement = ts.isVariableDeclaration(binding) ? binding.parent.parent : binding;
  if (statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return true;
  return sourceFile.statements.some(
    (s) =>
      (ts.isExportDeclaration(s) &&
        !s.moduleSpecifier &&
        s.exportClause &&
        ts.isNamedExports(s.exportClause) &&
        s.exportClause.elements.some((e) => (e.propertyName ?? e.name).text === name)) ||
      (ts.isExportAssignment(s) && ts.isIdentifier(s.expression) && s.expression.text === name),
  );
}

export const FORMS = {
  property: 'process.env.NAME',
  record: 'env.NAME through an env record handed in',
  literal: 'a literal key',
  constant: 'a bracket read through a constant',
  helper: 'a helper that takes the name',
  destructuring: 'destructuring',
  computed: 'a computed name',
};

/**
 * Scan one source text. Pure: returns every read it can name, every read site
 * it cannot, and every sweep hit. Exported so the fixture test drives exactly
 * the code the tree scan runs.
 */
export function scanSource(file, text, notEnvRecords = new Set()) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const ctx = { file, notEnvRecords, exempted: new Set() };
  const isEnvRecord = (node) => isEnvRecordIn(ctx, node);
  const reads = [];
  const unresolved = [];
  const sweep = [];
  const at = (node) => `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const add = (names, node, form) => {
    for (const name of names) if (ENV_SHAPED.test(name)) reads.push({ name, at: at(node), form });
  };
  const pendingHelpers = [];
  const keyed = (node, keyExpression) => {
    const resolved = resolveKey(keyExpression);
    if (resolved.names) {
      add(resolved.names, node, resolved.via === 'literal' ? FORMS.literal : FORMS.constant);
    } else if (resolved.param) {
      pendingHelpers.push({ param: resolved.param, at: at(node) });
    } else {
      unresolved.push({ file, at: at(node), kind: 'computed key', key: resolved.computed });
    }
  };

  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) && /^[A-Z]/.test(node.name.text)) {
      if (!isWriteTarget(node)) {
        if (isEnvRecord(node.expression)) {
          add([node.name.text], node, isProcessEnv(node.expression) ? FORMS.property : FORMS.record);
        } else if (SWEEP_SHAPED.test(node.name.text)) {
          sweep.push({ at: at(node), object: node.expression.getText(sf), name: node.name.text });
        }
      }
    }
    if (ts.isElementAccessExpression(node) && !isWriteTarget(node) && isEnvRecord(node.expression)) {
      keyed(node, node.argumentExpression);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      isEnvRecord(node.right)
    ) {
      keyed(node, node.left);
    }
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isEnvRecord(node.initializer)
    ) {
      for (const element of node.name.elements) {
        if (element.dotDotDotToken) {
          unresolved.push({ file, at: at(element), kind: 'whole-record read (rest element)' });
          continue;
        }
        const key = element.propertyName ?? element.name;
        if (ts.isIdentifier(key) || ts.isStringLiteral(key)) add([key.text], element, FORMS.destructuring);
        else unresolved.push({ file, at: at(element), kind: 'computed key', key: key.getText(sf) });
      }
    }
    if ((ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) && isEnvRecord(node.expression)) {
      unresolved.push({ file, at: at(node), kind: 'whole-record read (spread)' });
    }
    if (ts.isForInStatement(node) && isEnvRecord(node.expression)) {
      unresolved.push({ file, at: at(node), kind: 'whole-record read (for…in)' });
    }
    if (
      ts.isCallExpression(node) &&
      /^(Object|Reflect|JSON)\./.test(unwrap(node.expression).getText(sf)) &&
      node.arguments.some((a) => isEnvRecord(a))
    ) {
      unresolved.push({ file, at: at(node), kind: 'whole-record read (Object/Reflect/JSON call)' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Helpers: a function that reads `env[<its parameter>]` reads whatever its
  // callers pass. Resolved at each call site in this file, transitively when a
  // caller passes its own parameter on.
  const done = new Set();
  while (pendingHelpers.length > 0) {
    const { param, at: site } = pendingHelpers.shift();
    const fn = param.parent;
    const index = fn.parameters.indexOf(param);
    const key = `${fn.pos}:${index}`;
    if (done.has(key)) continue;
    done.add(key);
    const named = helperBinding(fn);
    if (!named) {
      unresolved.push({ file, at: site, kind: 'helper with no name to be called by' });
      continue;
    }
    if (isExported(named.binding, named.name, sf)) {
      unresolved.push({ file, at: site, kind: `exported helper \`${named.name}\` — callers in other files are not followed` });
      continue;
    }
    const findCalls = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        if (
          ts.isIdentifier(callee) &&
          callee.text === named.name &&
          declarationOf(callee, callee.text) === named.binding &&
          node.arguments[index]
        ) {
          const resolved = resolveKey(node.arguments[index]);
          if (resolved.names) add(resolved.names, node, FORMS.helper);
          else if (resolved.param) pendingHelpers.push({ param: resolved.param, at: at(node) });
          else unresolved.push({ file, at: at(node), kind: 'helper argument', key: resolved.computed });
        }
      }
      ts.forEachChild(node, findCalls);
    };
    findCalls(sf);
  }

  return { reads, unresolved, sweep, exempted: [...ctx.exempted] };
}

let scanned;

/** Scan the whole universe once per process; resolve the COMPUTED sites. */
async function scan() {
  if (scanned) return scanned;
  const { files, scriptsRun } = universe();
  const reads = [];
  const unresolved = [];
  const sweep = [];
  const exempted = new Set();
  const notEnvRecords = new Set(Object.keys(NOT_ENV_RECORDS));
  for (const file of files) {
    const result = scanSource(file, readFileSync(join(REPO_ROOT, file), 'utf8'), notEnvRecords);
    reads.push(...result.reads);
    unresolved.push(...result.unresolved);
    sweep.push(...result.sweep);
    for (const key of result.exempted) exempted.add(key);
  }
  const computedSites = [];
  const stillUnresolved = [];
  for (const site of unresolved) {
    const entry =
      site.kind === 'computed key' && COMPUTED.find((c) => c.file === site.file && c.keys.includes(site.key));
    if (entry) computedSites.push({ site, entry });
    else stillUnresolved.push(site);
  }
  for (const entry of COMPUTED) {
    const sites = computedSites.filter((c) => c.entry === entry);
    if (sites.length === 0) continue;
    for (const name of await entry.names()) {
      reads.push({ name, at: `${entry.file} (via COMPUTED)`, form: FORMS.computed });
    }
  }
  scanned = { files, scriptsRun, reads, unresolved: stillUnresolved, computedSites, sweep, exempted };
  return scanned;
}

const DECLARED = new Set(ENV_SPEC.flatMap((e) => [e.name, e.priorEraName].filter(Boolean)));

// --- the assertions ----------------------------------------------------------

/**
 * One site per form the tree carries, named so the assertion says which form
 * went blind. Measured at this commit; a refactor that moves a site moves its
 * anchor with it.
 */
const TREE_ANCHORS = [
  { name: 'DATABASE_URL', form: FORMS.property, file: 'drizzle.config.ts' },
  { name: 'BUILD_STANDALONE', form: FORMS.property, file: 'next.config.ts' },
  { name: 'SITE_DEFAULT_PORTAL', form: FORMS.property, file: 'src/lib/site-config.ts' },
  { name: 'APP_HOST', form: FORMS.record, file: 'src/lib/host-routing.ts' },
  { name: 'SIGN_IN_ALLOWLIST', form: FORMS.constant, file: 'src/lib/auth-allowlist.ts' },
  { name: 'MODEL_API_KIND', form: FORMS.helper, file: 'src/lib/model-client.ts' },
  { name: 'PUBLISHER_KEY_ID', form: FORMS.computed, file: 'src/lib/publisher-env.ts' },
];

test('the scan measures: the universe is derived, and every read form is seen', async () => {
  const { files, scriptsRun, reads } = await scan();
  assert.ok(files.length > 100, `git ls-files yielded ${files.length} source files — the scan has stopped measuring`);
  assert.ok(!files.some((f) => TEST.test(f)), 'a test file reached the universe');
  assert.ok(files.includes('next.config.ts') && files.includes('drizzle.config.ts'), 'the root config files are in the universe');
  assert.ok(
    scriptsRun.length > 0 && scriptsRun.every((f) => files.includes(f)),
    `the build-command derivation found no scripts/ file, or found one the scan does not read: ${scriptsRun.join(', ')}`,
  );
  for (const anchor of TREE_ANCHORS) {
    assert.ok(
      reads.some((r) => r.name === anchor.name && r.form === anchor.form && r.at.startsWith(anchor.file)),
      `the scan no longer sees ${anchor.name} read as "${anchor.form}" in ${anchor.file} — the extractor went blind to that form, or the site moved`,
    );
  }

  const FIXTURE = [
    '// process.env.NOT_IN_A_LINE_COMMENT',
    '/* process.env.NOT_IN_A_BLOCK_COMMENT */',
    "const prose = 'process.env.NOT_IN_A_STRING';",
    'const a = process.env.FIX_PROPERTY;',
    "const b = process.env['FIX_LITERAL'];",
    "const KEY = 'FIX_CONSTANT';",
    'const c = process.env[KEY];',
    'function fromRecord(env = process.env) { return env.FIX_RECORD; }',
    'function injected(env: Record<string, string | undefined>) { return env.FIX_INJECTED ?? env.camelCaseField; }',
    'function readSetting(name: string) { return process.env[name]; }',
    "readSetting('FIX_HELPER');",
    'const { FIX_DESTRUCTURED, FIX_RENAMED: renamed } = process.env;',
    "const hasIt = 'FIX_IN' in process.env;",
    'const alias = ports.env ?? process.env;',
    'const d = alias.FIX_ALIAS;',
    'const built: Record<string, string> = {};',
    "built.NOT_A_READ_LOCAL_OBJECT = 'x';",
    "process.env.NOT_A_READ_WRITE = 'x';",
    'const dynamic = process.env[`PREFIX_${suffix}`];',
    'const everything = { ...process.env };',
    'function renamedRecord(cfg: Record<string, string>) { return cfg.FIX_SWEPT; }',
  ].join('\n');
  const fixture = scanSource('fixture.ts', FIXTURE);
  assert.deepEqual(
    fixture.reads.map((r) => `${r.name} ${r.form}`).sort(),
    [
      `FIX_ALIAS ${FORMS.record}`,
      `FIX_CONSTANT ${FORMS.constant}`,
      `FIX_DESTRUCTURED ${FORMS.destructuring}`,
      `FIX_HELPER ${FORMS.helper}`,
      `FIX_IN ${FORMS.literal}`,
      `FIX_INJECTED ${FORMS.record}`,
      `FIX_LITERAL ${FORMS.literal}`,
      `FIX_PROPERTY ${FORMS.property}`,
      `FIX_RECORD ${FORMS.record}`,
      `FIX_RENAMED ${FORMS.destructuring}`,
    ],
    'the extractor misread the fixture: every FIX_ name is a read in its stated form, and no NOT_ name is a read',
  );
  assert.deepEqual(
    fixture.unresolved.map((u) => u.kind).sort(),
    ['computed key', 'whole-record read (spread)'],
    'the computed key and the spread must surface as unresolved sites, not vanish',
  );
  assert.deepEqual(
    fixture.sweep.map((s) => `${s.object}.${s.name}`),
    ['cfg.FIX_SWEPT'],
    'the sweep must report an UPPER_SNAKE read on a record the scan does not recognise',
  );
});

test('every environment variable the deployed app reads is declared in ENV_SPEC or allowlisted by reason', async () => {
  const { reads } = await scan();
  const undeclared = new Map();
  for (const r of reads) {
    if (DECLARED.has(r.name) || r.name in ALLOW) continue;
    if (!undeclared.has(r.name)) undeclared.set(r.name, []);
    undeclared.get(r.name).push(`${r.at} (${r.form})`);
  }
  const lines = [...undeclared].sort(([a], [b]) => a.localeCompare(b)).map(([n, sites]) => `${n} — ${sites.join('; ')}`);
  assert.deepEqual(
    lines,
    [],
    'read by the app but declared in neither scripts/preflight-env.mjs ENV_SPEC nor this file\'s ALLOW ' +
      '(an undeclared variable is one scripts/check-compose-env.mjs cannot see, so compose never delivers it):\n  ' +
      lines.join('\n  '),
  );
  for (const [name, reason] of Object.entries(ALLOW)) {
    assert.ok(reason.length > 0, `ALLOW.${name} states no reason`);
    assert.ok(!DECLARED.has(name), `${name} is on ALLOW and also declared in ENV_SPEC — drop the ALLOW entry`);
    assert.ok(reads.some((r) => r.name === name), `${name} is on ALLOW but nothing in the universe reads it — drop the entry`);
  }
});

test('every environment read site resolves to the names it reads', async () => {
  const { unresolved, computedSites, exempted } = await scan();
  const lines = unresolved.map((u) => `${u.at} — ${u.kind}${u.key ? `: [${u.key}]` : ''}`);
  assert.deepEqual(
    lines,
    [],
    'environment read sites the scan cannot name a variable for. Resolve each (a literal or a same-file ' +
      'constant, an unexported helper), or list a computed site in COMPUTED with the export that enumerates its names:\n  ' +
      lines.join('\n  '),
  );
  for (const entry of COMPUTED) {
    assert.ok(entry.reason.length > 0, `COMPUTED ${entry.file} states no reason`);
    for (const key of entry.keys) {
      assert.ok(
        computedSites.some((c) => c.entry === entry && c.site.key === key),
        `COMPUTED lists ${entry.file} [${key}], but no such read site exists any more — drop or update the entry`,
      );
    }
  }
  for (const [key, reason] of Object.entries(NOT_ENV_RECORDS)) {
    assert.ok(reason.length > 0, `NOT_ENV_RECORDS ${key} states no reason`);
    assert.ok(exempted.has(key), `NOT_ENV_RECORDS lists ${key}, but the scan met no such \`env\` parameter — drop the entry`);
  }
});

test('the sweep: every UPPER_SNAKE property read sits on a recognised env record', async () => {
  const { sweep } = await scan();
  const lines = sweep.filter((s) => !(s.object in NOT_ENV)).map((s) => `${s.at} — ${s.object}.${s.name}`);
  assert.deepEqual(
    lines,
    [],
    'UPPER_SNAKE property reads on objects the scan does not recognise as env records. If one is an env ' +
      'record under another name, route it through `env` or `process.env`; if it is not, list the object in NOT_ENV ' +
      'with a reason:\n  ' +
      lines.join('\n  '),
  );
  for (const [object, reason] of Object.entries(NOT_ENV)) {
    assert.ok(reason.length > 0, `NOT_ENV.${object} states no reason`);
    assert.ok(sweep.some((s) => s.object === object), `NOT_ENV lists ${object}, which no longer carries such a read — drop it`);
  }
});

test('BUILD_AND_RUN names every npm script the app image runs', () => {
  const build = parseComposeService(readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf8')).build;
  assert.ok(build, 'the compose app service builds no image — this cross-check has nothing to read; restate it');
  const dockerfilePath = join(REPO_ROOT, build.context ?? '.', build.dockerfile ?? 'Dockerfile');
  const dockerfile = parseDockerfile(readFileSync(dockerfilePath, 'utf8'));
  const invoked = new Set();
  for (const stage of dockerfile.stages) {
    for (const { command } of [...stage.runs, ...stage.commands]) {
      for (const m of command.matchAll(/\bnpm\s+run(?:-script)?\s+([\w:.-]+)/g)) invoked.add(m[1]);
    }
  }
  assert.ok(invoked.size > 0, 'the app Dockerfile runs no npm script at all — the cross-check has stopped measuring');
  const missing = [...invoked].filter((name) => !BUILD_AND_RUN.includes(name));
  assert.deepEqual(
    missing,
    [],
    `the app image runs npm script(s) BUILD_AND_RUN does not list, so the scripts/ files they run fall outside ` +
      `the universe: ${missing.join(', ')}`,
  );
});
