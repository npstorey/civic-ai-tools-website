// The publish scope under both accepted names (civic-ai-tools#160 P3).
//
// Group G of the 2026-08-19 vocabulary settlement renames the device-flow
// scope `evidence:publish` → `records:publish` as an alias-and-deprecate. Two
// properties have to hold together, and they pull in opposite directions:
//
//   AUTHORIZATION must be name-blind. Bearer tokens store their scope as a
//   string and live 90 days, so every token minted before this change carries
//   the prior-era name. A gate that checked one spelling would 403 a token
//   that was valid yesterday and has not expired.
//
//   MINTING must be literal. RFC 8628 clients compare the granted scope in
//   the response against what they asked for, so a client that explicitly
//   requests the prior-era name has to receive that exact string back — while
//   a client that asks for nothing gets the canonical one, which is how the
//   default moves.
//
// The last test is the one that will fire for someone else, later: it reads
// the route sources and fails if a publish gate is ever hand-rolled again
// instead of asking the shared predicate.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCEPTED_PUBLISH_SCOPES,
  MISSING_PUBLISH_SCOPE_ERROR,
  PRIOR_ERA_PUBLISH_SCOPE,
  PUBLISH_SCOPE,
  UNSCOPED_WILDCARD,
  isAcceptedMintScope,
  resolveMintScope,
  scopesAuthorizePublish,
} from './publish-scope.ts';

// --- The vocabulary -----------------------------------------------------------

test('the settlement names are what Appendix J says they are', () => {
  assert.equal(PUBLISH_SCOPE, 'records:publish');
  assert.equal(PRIOR_ERA_PUBLISH_SCOPE, 'evidence:publish');
  assert.deepEqual([...ACCEPTED_PUBLISH_SCOPES], [PUBLISH_SCOPE, PRIOR_ERA_PUBLISH_SCOPE]);
});

// --- Authorization: name-blind ------------------------------------------------

test('either spelling authorizes a publish', () => {
  assert.equal(scopesAuthorizePublish([PUBLISH_SCOPE]), true);
  assert.equal(
    scopesAuthorizePublish([PRIOR_ERA_PUBLISH_SCOPE]),
    true,
    'a token minted before the settlement — 90-day lifetime, still valid — ' +
      'must keep working against every gated route',
  );
});

test('cookie auth\'s wildcard still authorizes, and holding both is fine', () => {
  assert.equal(scopesAuthorizePublish([UNSCOPED_WILDCARD]), true);
  assert.equal(scopesAuthorizePublish([PUBLISH_SCOPE, PRIOR_ERA_PUBLISH_SCOPE]), true);
});

test('nothing else authorizes — the alias widened one name, not the gate', () => {
  assert.equal(scopesAuthorizePublish([]), false);
  assert.equal(scopesAuthorizePublish(['']), false);
  assert.equal(scopesAuthorizePublish(['records:read']), false);
  assert.equal(scopesAuthorizePublish(['publish']), false);
  assert.equal(scopesAuthorizePublish(['records:publish:extra']), false);
  // Prefix and case collisions: scope strings are compared whole and exact.
  assert.equal(scopesAuthorizePublish(['records']), false);
  assert.equal(scopesAuthorizePublish(['Records:Publish']), false);
  assert.equal(scopesAuthorizePublish([' records:publish']), false);
});

// --- Minting: literal ---------------------------------------------------------

test('an omitted scope mints the canonical name — this is how the default moves', () => {
  assert.equal(resolveMintScope(undefined), PUBLISH_SCOPE);
  assert.equal(resolveMintScope(''), PUBLISH_SCOPE);
  assert.equal(resolveMintScope('   '), PUBLISH_SCOPE);
});

test('an explicitly requested scope is granted VERBATIM, prior-era included', () => {
  assert.equal(resolveMintScope(PUBLISH_SCOPE), PUBLISH_SCOPE);
  assert.equal(
    resolveMintScope(PRIOR_ERA_PUBLISH_SCOPE),
    PRIOR_ERA_PUBLISH_SCOPE,
    'RFC 8628 clients compare the granted scope against what they asked for; ' +
      'silently upgrading the string fails that comparison for a client that ' +
      'did nothing wrong',
  );
  // Surrounding whitespace is trimmed, as the endpoint always did.
  assert.equal(resolveMintScope(`  ${PRIOR_ERA_PUBLISH_SCOPE}  `), PRIOR_ERA_PUBLISH_SCOPE);
});

test('both names are mintable; nothing else is', () => {
  assert.equal(isAcceptedMintScope(PUBLISH_SCOPE), true);
  assert.equal(isAcceptedMintScope(PRIOR_ERA_PUBLISH_SCOPE), true);
  assert.equal(isAcceptedMintScope('records:read'), false);
  assert.equal(isAcceptedMintScope(''), false);
});

test('a token minted under EITHER name authorizes every gated route', () => {
  // The round trip the two properties above only describe separately: what
  // the mint side produces, the enforcement side must accept. Whichever
  // string a client ends up with, it can publish.
  for (const requested of [undefined, PUBLISH_SCOPE, PRIOR_ERA_PUBLISH_SCOPE]) {
    const minted = resolveMintScope(requested);
    assert.ok(isAcceptedMintScope(minted), `${minted} is grantable`);
    assert.equal(
      scopesAuthorizePublish([minted]),
      true,
      `a token minted as "${minted}" must authorize a publish`,
    );
  }
});

// --- The refusal message ------------------------------------------------------

test('the refusal names the canonical scope and says the prior-era one still works', () => {
  assert.match(MISSING_PUBLISH_SCOPE_ERROR, new RegExp(PUBLISH_SCOPE));
  assert.match(MISSING_PUBLISH_SCOPE_ERROR, new RegExp(PRIOR_ERA_PUBLISH_SCOPE));
  assert.match(MISSING_PUBLISH_SCOPE_ERROR, /also accepted/);
  // A client holding a prior-era token that hits this message for some other
  // reason must not read it as "your token is the wrong kind" and go mint a
  // replacement it does not need.
});

// --- The drift guard ----------------------------------------------------------
//
// The properties above are about one module. This one is about the repo: it
// reads the route sources and fails if a publish gate is ever hand-rolled
// again. Source text, not behavior — see the limits stated in the messages.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(HERE, '..', 'app', 'api');
const REPO_ROOT = path.resolve(HERE, '..', '..');

/** Every `route.ts` under `src/app/api`, repo-relative. */
function apiRouteFiles(): string[] {
  return readdirSync(API_DIR, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name === 'route.ts')
    .map((e) => path.relative(REPO_ROOT, path.join(e.parentPath, e.name)))
    .sort();
}

/**
 * Source with comments removed, so a doc comment that MENTIONS a scope name
 * is not read as code that hardcodes one. Crude on purpose: it is a scanner,
 * not a parser, and it does not model strings containing `//` (none of these
 * files has one). A false positive here fails loudly and is corrected by
 * reading the file; a parser that silently mis-scanned would be worse.
 */
function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('the route walker finds the API routes', () => {
  const files = apiRouteFiles();
  assert.ok(
    files.length > 10,
    `Found only ${files.length} route file(s) under src/app/api — the walker is\n` +
      `broken, and the guard below would pass vacuously.`,
  );
});

test('no API route hardcodes a publish-scope string; the vocabulary lives in one module', () => {
  const offenders = apiRouteFiles().filter((file) => {
    const code = codeWithoutComments(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    return ACCEPTED_PUBLISH_SCOPES.some((scope) => code.includes(scope));
  });

  assert.deepEqual(
    offenders,
    [],
    `These route files name a publish scope as a literal in code:\n` +
      `\n` +
      `${offenders.map((f) => `    ${f}`).join('\n')}\n` +
      `\n` +
      `FIX: import from src/lib/publish-scope.ts — \`hasPublishScope(auth)\` via\n` +
      `api-auth for a gate, \`MISSING_PUBLISH_SCOPE_ERROR\` for the refusal,\n` +
      `\`ACCEPTED_PUBLISH_SCOPES\` / \`resolveMintScope\` for the device-flow start.\n` +
      `\n` +
      `WHY THIS IS NOT STYLE: the scope has two accepted spellings and will have\n` +
      `one again after the prior-era name is dropped at a major version. A route\n` +
      `holding its own literal checks one of them. It does not fail closed and it\n` +
      `does not fail loudly — it 403s a token the neighbouring route accepts, and\n` +
      `the only symptom is a publish that half-works: the blob upload is granted\n` +
      `and the record POST is refused, or the other way round.`,
  );
});

test('no API route gates on the publish scope through the exact-match helper', () => {
  // `hasScope(auth, …)` is exact-match by design and stays, because a future
  // second scope will want it. Using it for THIS scope is the defect: it can
  // only name one of the two accepted spellings.
  const offenders = apiRouteFiles().filter((file) =>
    codeWithoutComments(readFileSync(path.join(REPO_ROOT, file), 'utf8')).includes(
      'hasScope(',
    ),
  );

  assert.deepEqual(
    offenders,
    [],
    `These route files call hasScope(...) directly:\n` +
      `\n` +
      `${offenders.map((f) => `    ${f}`).join('\n')}\n` +
      `\n` +
      `FIX: for the publish scope, call \`hasPublishScope(auth)\`. If you are\n` +
      `gating on a genuinely NEW scope, this guard is the wrong shape and should\n` +
      `be widened deliberately rather than by deleting the offending line.\n` +
      `\n` +
      `WHY: hasScope compares one string. The publish scope is two strings that\n` +
      `mean the same authorization (Appendix J, alias-and-deprecate), and live\n` +
      `90-day tokens carry the prior-era one.`,
  );
});
