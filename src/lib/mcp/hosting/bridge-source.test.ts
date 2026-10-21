// #617 P3 criterion 3, the part that can be read without a sandbox: the bridge
// the website writes into one, held to its rules as text.
//
// The bridge never runs here (its packages are installed inside the sandbox,
// not in this repository), so this file checks what can be checked from the
// text, and says so: it parses as a module; its two packages are pinned
// exactly; the command it spawns is `process.execPath` with the one `bin` of
// the package its config names, refused at any installed version but the
// pinned one, and no request value reaches the spawn; the child is spoken to
// in `legacy` mode and given the SDK's default environment (so not the token);
// the HTTP side is the official handler; the token check is constant-time and
// precedes every path; `/health` reports `serverInfo` and the pinned version;
// a child that exits is restarted.
//
// What it cannot check — that the bridge answers the app's real client, in the
// modern era, with Charter's text, and refuses a missing or wrong token on the
// sandbox's public URL — is measured live against a real sandbox and recorded
// in the phase record.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/hosting/bridge-source.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BRIDGE_PACKAGES, BRIDGE_PACKAGE_JSON, BRIDGE_READY_LINE, BRIDGE_SOURCE, bridgeConfig as baseBridgeConfig } from './bridge-source.ts';

/** `bridgeConfig` typed wide, so the R8 W3 red commit (which adds `childEnv`) type-checks. */
const bridgeConfig = baseBridgeConfig as unknown as (config: Record<string, unknown>) => string;

test('the bridge parses as an ES module', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'r7-p3-bridge-'));
  try {
    const file = path.join(dir, 'bridge.mjs');
    writeFileSync(file, BRIDGE_SOURCE);
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, `node --check failed:\n${checked.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the bridge\'s own packages are pinned exactly, and its package.json names only them', () => {
  for (const [name, version] of Object.entries(BRIDGE_PACKAGES)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is not pinned to one version: ${version}`);
  }
  assert.deepEqual(Object.keys(BRIDGE_PACKAGES).sort(), ['@modelcontextprotocol/client', '@modelcontextprotocol/server']);
  const pkg = JSON.parse(BRIDGE_PACKAGE_JSON) as { type: string; dependencies: Record<string, string> };
  assert.equal(pkg.type, 'module');
  assert.deepEqual(pkg.dependencies, BRIDGE_PACKAGES);
  for (const name of Object.keys(BRIDGE_PACKAGES)) {
    assert.ok(BRIDGE_SOURCE.includes(`from '${name}`), `the bridge does not import ${name}`);
  }
});

test('one fixed command: the package\'s one bin at the pinned version, and nothing from a request reaches the spawn', () => {
  const spawnLine = BRIDGE_SOURCE.split('\n').find((line) => line.includes('new StdioClientTransport('));
  assert.ok(spawnLine, 'the bridge builds no stdio transport');
  assert.match(spawnLine!, /command: process\.execPath, args: \[ENTRY\]/, 'the command is not process.execPath with the derived entry');
  assert.doesNotMatch(spawnLine!, /\breq\b|request|url|headers|body/, 'a request value is on the spawn line');
  assert.match(BRIDGE_SOURCE, /const ENTRY = path\.resolve\(pkgDir, bins\[0\]\);/, 'the entry is not derived from the installed package\'s bin');
  assert.match(BRIDGE_SOURCE, /if \(pkg\.version !== config\.version\)/, 'the bridge does not refuse an installed version other than the pin');
  assert.match(BRIDGE_SOURCE, /if \(bins\.length !== 1\)/, 'the bridge does not refuse a package with no single command');
  const config = JSON.parse(bridgeConfig({ package: '@betanyc/nyc-charter-laws-rules', version: '0.3.1', pinDir: '/x', port: 8080 }));
  assert.deepEqual(Object.keys(config).sort(), ['package', 'pinDir', 'port', 'version']);
});

// R8 W3 (the owner's ruling of 2026-10-21, 16:03:34Z): the child is given the
// SDK's default environment and, on top of it, only the variables the config
// names (`childEnv`): a keyed variant's key variable, never the token. The
// function that builds it is driven below, out of the bridge's own text.
test('toward the child: legacy mode, and the SDK\'s default environment plus the config\'s allowlist, so never the token', () => {
  assert.match(BRIDGE_SOURCE, /versionNegotiation: \{ mode: 'legacy' \}/);
  assert.match(BRIDGE_SOURCE, /env: childEnvironment\(\)/, 'the child is not given the allowlisted environment');
  assert.doesNotMatch(BRIDGE_SOURCE, /env: process\.env|\.\.\.process\.env/, 'the child is handed the bridge\'s whole environment');
});

/** The bridge's `childEnvironment`, cut out of its text and run on a config and an environment. */
function childEnvironmentOf(config: Record<string, unknown>, env: Record<string, string>, base: Record<string, string>): Record<string, string> {
  const start = BRIDGE_SOURCE.indexOf('// CHILD_ENVIRONMENT_START');
  const end = BRIDGE_SOURCE.indexOf('// CHILD_ENVIRONMENT_END');
  assert.ok(start > 0 && end > start, 'the bridge holds no childEnvironment block');
  const body = BRIDGE_SOURCE.slice(start, end);
  const run = new Function('config', 'process', 'getDefaultEnvironment', `${body}\nreturn childEnvironment();`) as (c: unknown, p: unknown, g: () => Record<string, string>) => Record<string, string>;
  return run(config, { env }, () => ({ ...base }));
}

const SDK_DEFAULT = { HOME: '/home/fixture', PATH: '/usr/bin' };
const BRIDGE_ENV = { ...SDK_DEFAULT, SOURCE_BRIDGE_TOKEN: 'token-'.padEnd(40, 'x'), NYS_LEGISLATION_API_KEY: 'placeholder-not-a-key', OTHER: 'not-for-the-child' };

test('R8 W3: a variant with no key variable passes exactly the SDK\'s default environment, as at the base', () => {
  const config = JSON.parse(bridgeConfig({ package: '@betanyc/nyc-charter-laws-rules', version: '0.3.1', pinDir: '/x', port: 8080 }));
  assert.deepEqual(childEnvironmentOf(config, BRIDGE_ENV, SDK_DEFAULT), SDK_DEFAULT);
});

test('R8 W3: a keyed variant\'s child gets its key variable from the bridge\'s environment, and the token never', () => {
  const config = JSON.parse(bridgeConfig({ package: '@betanyc/nys-openlegislation-mcp', version: '2.4.0', pinDir: '/x', port: 8080, childEnv: ['NYS_LEGISLATION_API_KEY'] }));
  assert.deepEqual(config.childEnv, ['NYS_LEGISLATION_API_KEY']);
  assert.deepEqual(childEnvironmentOf(config, BRIDGE_ENV, SDK_DEFAULT), { ...SDK_DEFAULT, NYS_LEGISLATION_API_KEY: 'placeholder-not-a-key' });
  // A config naming the token, written by hand, still does not hand it on.
  assert.deepEqual(childEnvironmentOf({ childEnv: ['SOURCE_BRIDGE_TOKEN', 'NYS_LEGISLATION_API_KEY'] }, BRIDGE_ENV, SDK_DEFAULT), { ...SDK_DEFAULT, NYS_LEGISLATION_API_KEY: 'placeholder-not-a-key' });
  // A named variable the bridge does not hold is absent, not empty.
  assert.deepEqual(childEnvironmentOf(config, SDK_DEFAULT, SDK_DEFAULT), SDK_DEFAULT);
  // And the config refuses to name the token at all.
  assert.throws(() => bridgeConfig({ package: 'p', version: '1.0.0', pinDir: '/x', port: 8080, childEnv: ['SOURCE_BRIDGE_TOKEN'] }), /SOURCE_BRIDGE_TOKEN/);
});

test('toward the website: the official handler, the token checked in constant time before any path', () => {
  assert.match(BRIDGE_SOURCE, /createMcpHandler\(/);
  assert.match(BRIDGE_SOURCE, /timingSafeEqual\(/);
  assert.doesNotMatch(BRIDGE_SOURCE, /=== TOKEN|TOKEN ===|== TOKEN/, 'the token is compared with ===');
  const handler = BRIDGE_SOURCE.slice(BRIDGE_SOURCE.indexOf('http.createServer('));
  const authAt = handler.indexOf('if (!authorized(req)) return send(res, 401');
  assert.ok(authAt > 0, 'the server has no 401 for an unauthorized request');
  for (const path of ["'/health'", "'/mcp'"]) {
    assert.ok(handler.indexOf(path) > authAt, `${path} is served before the token check`);
  }
  assert.match(BRIDGE_SOURCE, /TOKEN\.length < 32/, 'the bridge starts with no token');
});

test('/health reports the child\'s serverInfo and the pinned version; the ready line; a restart on exit', () => {
  assert.match(BRIDGE_SOURCE, /serverInfo: c\.serverInfo/);
  assert.match(BRIDGE_SOURCE, /version: config\.version/);
  assert.ok(BRIDGE_SOURCE.includes(`console.log('${BRIDGE_READY_LINE} '`), 'the bridge prints no ready line');
  assert.match(BRIDGE_SOURCE, /client\.onclose = \(\) => \{/, 'nothing happens when the child exits');
  assert.match(BRIDGE_SOURCE, /ensureChild\(\)\.catch/, 'the child is not restarted');
});
