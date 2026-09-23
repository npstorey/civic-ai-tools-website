// #436 (Wave N16 P4, criteria 2 and 4) — where the three query routes refuse
// under the one-portal switch, what they refuse with, and what they hand the
// loop; and how the form and the root layout follow the switch.
//
// WHY SOURCE. The routes import `next/server`, `next-auth` and `next/headers`,
// none of which loads under `node --test`; `QueryForm.tsx` and `layout.tsx`
// are JSX, which `--experimental-strip-types` cannot parse. The precedent is
// `model-refusal-ordering.test.ts`: ORDER is asserted as the relative position
// of calls in a straight-line handler. The BEHAVIOUR each ordering protects —
// what the resolver returns, what the loop refuses, what the model is told,
// what the package lists — is driven in `src/lib/portal-lock.test.ts`, so
// neither half stands alone.
//
// WHAT MAKES THE ORDER ASSERTIONS ABLE TO FAIL. Each is a comparison of two
// positions that both must exist (`at` asserts presence), so moving the refusal
// below `checkRateLimit`, or deleting it, fails — shown at this phase's gate by
// doing exactly that to one route.
//
// BLIND SPOT, stated. A source read cannot tell that the block it finds is the
// one that runs; a second, unreached copy above the limiter would satisfy it.
// Each route is a single straight-line handler with one `resolveRunPortal`
// call, which the first assertion pins.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = [
  { file: 'compare/route.ts', tag: '[compare]' },
  { file: 'compare-stream/route.ts', tag: '[compare-stream]' },
  { file: 'query-notebook/route.ts', tag: '[query-notebook]' },
] as const;

const read = (relative: string) => readFileSync(join(HERE, relative), 'utf8');

function at(source: string, needle: string, where: string): number {
  const index = source.indexOf(needle);
  assert.ok(index > 0, `${where} should contain ${needle}`);
  return index;
}

const count = (source: string, needle: string) => source.split(needle).length - 1;

/** The refusal block: from the check to the line that unpacks the accepted resolution. */
function refusalBlock(source: string, where: string): string {
  const start = at(source, 'if (!portalResolution.ok) {', where);
  const end = at(source, 'const { portal, lockedPortal } = portalResolution;', where);
  assert.ok(end > start, `${where}: the resolution is unpacked before it is checked`);
  return source.slice(start, end);
}

test('#436 C2: every query route resolves its portal through the one resolver, once', () => {
  for (const { file } of ROUTES) {
    const source = read(file);
    assert.equal(count(source, 'resolveRunPortal('), 1, `${file} resolves its portal exactly once`);
    assert.ok(!source.includes('getDefaultPortal()'), `${file} still reads the default portal itself`);
    assert.doesNotMatch(source, /Portal\s*\|\|\s*getDefaultPortal/, `${file} still carries the pre-#436 line`);
  }
});

test('#436 C2: the lock refuses before the rate limiter, before the allowance is spent, and before the skill fetch', () => {
  for (const { file } of ROUTES) {
    const source = read(file);
    const refusal = at(source, 'if (!portalResolution.ok) {', file);
    assert.ok(refusal > at(source, 'resolveRunPortal(', file), `${file} checks the resolution after making it`);
    assert.ok(refusal < at(source, 'checkRateLimit(', file), `${file} refuses AFTER the rate limiter`);
    assert.ok(refusal < at(source, 'incrementRateLimit(', file), `${file} spends the reader's allowance before refusing`);
    assert.ok(refusal < at(source, 'buildSystemPrompt(portal)', file), `${file} fetches the skill text before refusing`);
    assert.ok(refusal < at(source, 'getServerSession(', file), `${file} reads the session before refusing`);
  }
});

test('#436 C2 (D1): a foreign portal is the caller\'s 400, carrying the refusal that names both portals', () => {
  for (const { file } of ROUTES) {
    const block = refusalBlock(read(file), file);
    const foreign = at(block, "portalRefusal.reason === 'foreign_portal'", file);
    const log = at(block, 'console.error(', file);
    const branch = block.slice(foreign, log);
    assert.match(branch, /error: portalRefusal\.message/, `${file}: the 400 does not carry the refusal's text`);
    assert.match(branch, /status: 400/, `${file}: a foreign portal is not answered 400`);
  }
});

test('#436 C2: an unset portal under the lock is logged by variable name and reaches the reader as generic copy', () => {
  for (const { file, tag } of ROUTES) {
    const source = read(file);
    const block = refusalBlock(source, file);
    const unset = block.slice(at(block, 'console.error(', file));
    assert.ok(
      unset.includes(`console.error('${tag}', PORTAL_LOCK_NOT_CONFIGURED_MESSAGE)`),
      `${file}: the operator's log line does not carry the message that names SITE_DEFAULT_PORTAL`,
    );
    assert.ok(unset.includes("streamErrorPayload('generic')"), `${file}: the reader is not sent the generic copy`);
    assert.ok(!unset.includes('portalRefusal.message'), `${file}: the operator's message reaches the reader`);
    assert.ok(!unset.includes('PORTAL_LOCK_NOT_CONFIGURED_MESSAGE }') && !/error: PORTAL_LOCK/.test(unset), `${file}: the operator's message is in the response`);
  }
});

test('#436 C3: every query route hands the lock to the loop, the locked tool text to the model, and the lock section to the prompt', () => {
  for (const { file } of ROUTES) {
    const source = read(file);
    assert.ok(
      source.includes('withPortalLockGuidance(await buildSystemPrompt(portal), lockedPortal)'),
      `${file}: the prompt does not get the lock section`,
    );
  }
  for (const file of ['compare-stream/route.ts', 'query-notebook/route.ts']) {
    const source = read(file);
    assert.ok(source.includes('mcpToolsFor(lockedPortal)'), `${file}: the model is not handed the locked tool text`);
    assert.doesNotMatch(source, /^\s+mcpTools,$/m, `${file}: still hands the model the unlocked tools`);
    const options = at(source, '{ portal, toolTimeoutMs: MCP_TOOL_TIMEOUT_MS },', file);
    assert.match(
      source.slice(options, options + 400),
      /\{ portal, toolTimeoutMs: MCP_TOOL_TIMEOUT_MS \},\s*(?:\/\/[^\n]*\n\s*)*lockedPortal,\s*\)/,
      `${file}: the lock is not passed to queryWithMcpStreaming`,
    );
  }
  const compare = read('compare/route.ts');
  assert.match(compare, /compareLoopOptions\(\{[\s\S]*?\bportal,\s*lockedPortal,\s*\}\)/, 'compare/route.ts: the lock is not passed to the factory');
});

test('#436: the replay route takes no part in the lock', () => {
  const replay = read('evidence/[slug]/replay/route.ts');
  for (const needle of ['resolveRunPortal', 'lockedPortal', 'isPortalLocked', 'SITE_PORTAL_LOCKED', 'withPortalLockGuidance']) {
    assert.ok(!replay.includes(needle), `the replay route reads ${needle}`);
  }
});

test('#436 C4: the form drops its portal picker under the lock, and offers the examples the lock allows', () => {
  const form = read('../../components/QueryForm.tsx');
  assert.ok(form.includes('const portalLocked = usePortalLocked();'), 'the form does not read the lock');
  assert.ok(form.includes('offeredExampleQueries(portalLocked)'), 'the form does not filter its examples by the lock');
  assert.ok(form.includes('exampleQueries.map('), 'the form renders some other list of examples');
  assert.ok(!/const EXAMPLE_QUERIES\b/.test(form), 'the form keeps its own copy of the examples');
  // The picker is the block that renders the PORTALS menu. It must sit inside
  // a `!portalLocked` guard that opens before it and closes after it.
  const guard = at(form, '{!portalLocked && (', 'QueryForm.tsx');
  const picker = at(form, 'ref={portalDropdownRef}', 'QueryForm.tsx');
  const menu = at(form, 'PORTALS.map(', 'QueryForm.tsx');
  assert.equal(count(form, 'ref={portalDropdownRef}'), 1);
  assert.ok(guard < picker && picker < menu, 'the portal picker is not inside the lock guard');
  assert.ok(picker - guard < 300, 'the lock guard does not open immediately around the picker');
  const between = form.slice(guard, menu);
  assert.ok(!/\)\}\s*\n/.test(between.slice(0, between.indexOf('ref={portalDropdownRef}'))), 'the guard closes before the picker opens');

  const layout = read('../layout.tsx');
  assert.ok(
    layout.includes('<DefaultPortalProvider value={getDefaultPortal()} locked={isPortalLocked()}>'),
    'the root layout does not thread the lock to the form',
  );
  const provider = read('../../components/DefaultPortalProvider.tsx');
  assert.match(provider, /createContext<boolean>\(false\)/, 'outside the provider the form must read as unlocked');
  assert.match(provider, /locked = false/, 'a mount that passes no lock must be unlocked');
});
