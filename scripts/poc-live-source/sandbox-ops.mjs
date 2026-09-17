/**
 * POC MCP-LIVE-SOURCE — provisioning for a source that must reach a LIVE city
 * service, factored the same way the warm-VM spike's is so that differences
 * between the two spikes' numbers are the thing measured rather than an
 * artefact of two spellings.
 *
 * WHAT IS REUSED, AND WHY. The bridge, the readiness poll, the all-pages
 * listing and the ownership-aware stray check are the predecessor's, imported
 * unchanged from `../poc-warm-vm/`. `bridge.mjs` in particular is fully
 * parameterised by environment (BRIDGE_PORT / BRIDGE_TOKEN / BRIDGE_TOOL_PREFIX
 * / BRIDGE_SERVER_CMD), so a second source needs no second bridge — importing
 * the existing component beats building a parallel one (CLAUDE.md).
 *
 * WHAT IS THIS SPIKE'S OWN, AND WHY:
 *
 *   - PORT 3100, not 3000. Two spikes share one Vercel project scope, and that
 *     scope also runs production's notebook executor. The exposed port is the
 *     only thing separating this spike's VMs from the warm-VM spike's, so it is
 *     also this spike's ownership signature — passed explicitly to every
 *     classify/stop call, never inherited from a module constant two runs share.
 *
 *   - FOUR network policies rather than two. The warm-VM spike only had to show
 *     that a source with BUNDLED data survives deny-all. A source that proxies a
 *     live service has a third state between "everything" and "nothing": an
 *     allowlist naming exactly its own upstream, which is the state a hosted
 *     instance would actually run in, and the one L1 measures.
 *
 *   - AN IN-VM PROBE FILE (`vm-probe.mjs`) rather than `sh -c` one-liners. See
 *     its header; the short version is that a probe whose quoting is wrong fails
 *     in ways that look like the finding it was measuring.
 */
import { Sandbox } from '@vercel/sandbox';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeBridge, waitForReady, resolveAuth, mcpEndpoint,
  listAllSandboxes, classifyAlive, stopClaimed, describeNotOurs,
  ownershipStrayCheck, ALIVE_STATES,
} from '../poc-warm-vm/sandbox-ops.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const RECORD_PACKAGE = '@betanyc/nyc-record-mcp@1.1.0';
/** The one host the source talks to. Read out of the package's code, not its README. */
export const UPSTREAM_HOST = 'data.cityofnewyork.us';
/** The one dataset every one of its seven tools queries. */
export const UPSTREAM_DATASET = 'dg92-zbpx';
export const BRIDGE_PORT = 3100;
export const TOOL_PREFIX = 'nyc_record__';
export const SANDBOX_VCPUS = 1;              // 2048 MB of memory per vCPU
export const SANDBOX_MEMORY_MB = 2048 * SANDBOX_VCPUS;
export const SANDBOX_TIMEOUT_MS = 45 * 60_000;

/**
 * THIS SPIKE'S OWNERSHIP SIGNATURE. A warm-VM spike sandbox (node22, port 3000)
 * and a production notebook sandbox (python3.13, no route) both read "NOT OURS"
 * against it. Driven on a real foreign-shaped sandbox rather than assumed.
 */
export const OUR_SIGNATURE = { runtime: 'node22', port: BRIDGE_PORT };

// --------------------------------------------------------------- policies ---
/** Boot-time concession: reach npm, and nothing else. Revoked before any measurement. */
export const INSTALL_POLICY = { allow: ['registry.npmjs.org', '*.npmjs.org', '*.npmjs.com'] };
/** L1: the steady state a hosted instance would run in — the source's upstream, and nothing else. */
export const UPSTREAM_ONLY_POLICY = { allow: [UPSTREAM_HOST] };
/** L1's contrast: nothing out at all. A live source must fail here, and fail honestly. */
export const DENY_ALL_POLICY = 'deny-all';
/** L2's control: no restriction, for reading the certificate chain with no policy applied. */
export const ALLOW_ALL_POLICY = 'allow-all';

export const policyCommand = (p) =>
  `sandbox.updateNetworkPolicy(${typeof p === 'string' ? `'${p}'` : JSON.stringify(p)})`;

export const CREATE_FRESH_COMMAND =
  `Sandbox.create({ runtime:'node22', ports:[${BRIDGE_PORT}], resources:{vcpus:${SANDBOX_VCPUS}}, ` +
  `timeout:${SANDBOX_TIMEOUT_MS}, networkPolicy:${JSON.stringify(INSTALL_POLICY)} })`;
export const CREATE_FROM_SNAPSHOT_COMMAND =
  `Sandbox.create({ source:{type:'snapshot',snapshotId:<id>}, ports:[${BRIDGE_PORT}], ` +
  `resources:{vcpus:${SANDBOX_VCPUS}}, timeout:${SANDBOX_TIMEOUT_MS} })`;
export const INSTALL_COMMAND = `npm install --no-audit --no-fund ${RECORD_PACKAGE}`;
export const START_BRIDGE_COMMAND = 'node /vercel/sandbox/bridge.mjs   (detached)';
export const READY_COMMAND = (url) => `GET ${url}/readyz  (Authorization: Bearer <token>), polled every 150ms`;
export const probeCommand = (...args) => `sandbox.runCommand({ cmd:'node', args:['/vercel/sandbox/vm-probe.mjs','${args.join("','")}'] })`;

/**
 * Sandbox-wide environment.
 *
 * `appToken` is the SOURCE'S OWN SECRET (L3). It reaches the VM through this
 * object and nowhere else: not a file written into the machine, not a command
 * line, not a log line, not the results file. The bridge spawns the upstream
 * server with `spawn(cmd, args, { stdio })` and no `env` option, so the child
 * inherits this environment — which is how `@betanyc/nyc-record-mcp` comes to
 * read `process.env.SOCRATA_APP_TOKEN` without anything in this repository
 * handing the value over call by call.
 *
 * `extraCaCerts` exists for L2: if the platform terminates TLS with its own
 * authority, Node's `fetch` (undici) will not trust it, and NODE_EXTRA_CA_CERTS
 * is the help it would need. Passed only once a measurement has shown it IS
 * needed — never speculatively, because a harness that always supplies the fix
 * cannot report whether the fix was required.
 */
export function bridgeEnv(bridgeToken, { appToken, extraCaCerts } = {}) {
  return {
    BRIDGE_PORT: String(BRIDGE_PORT),
    BRIDGE_TOKEN: bridgeToken,
    BRIDGE_TOOL_PREFIX: TOOL_PREFIX,
    BRIDGE_SERVER_CMD: '/vercel/sandbox/node_modules/.bin/nyc-record-mcp',
    BRIDGE_SERVER_ARGS: '[]',
    ...(appToken ? { SOCRATA_APP_TOKEN: appToken } : {}),
    ...(extraCaCerts ? { NODE_EXTRA_CA_CERTS: extraCaCerts } : {}),
  };
}

export async function createFresh(bridgeToken, opts = {}) {
  return Sandbox.create({
    runtime: 'node22',
    ports: [BRIDGE_PORT],
    resources: { vcpus: SANDBOX_VCPUS },
    timeout: SANDBOX_TIMEOUT_MS,
    networkPolicy: INSTALL_POLICY,
    env: bridgeEnv(bridgeToken, opts),
    ...resolveAuth(),
  });
}

export async function createFromSnapshot(snapshotId, bridgeToken, opts = {}) {
  return Sandbox.create({
    source: { type: 'snapshot', snapshotId },
    ports: [BRIDGE_PORT],
    resources: { vcpus: SANDBOX_VCPUS },
    timeout: SANDBOX_TIMEOUT_MS,
    env: bridgeEnv(bridgeToken, opts),
    ...resolveAuth(),
  });
}

export async function installRecordServer(sandbox) {
  const r = await sandbox.runCommand({
    cmd: 'npm',
    args: ['install', '--no-audit', '--no-fund', RECORD_PACKAGE],
    cwd: '/vercel/sandbox',
  });
  if (r.exitCode !== 0) {
    throw new Error(`npm install failed (${r.exitCode}): ${(await r.stderr()).slice(0, 1500)}`);
  }
  return r;
}

export async function startBridge(sandbox) {
  return sandbox.runCommand({
    cmd: 'node',
    args: ['/vercel/sandbox/bridge.mjs'],
    cwd: '/vercel/sandbox',
    detached: true,
  });
}

/** Copy the in-VM probe file in beside the bridge. */
export async function writeProbe(sandbox) {
  const content = fs.readFileSync(path.join(HERE, 'vm-probe.mjs'), 'utf8');
  await sandbox.writeFiles([{ path: '/vercel/sandbox/vm-probe.mjs', content }]);
}

/** Run one probe inside the machine and return its trimmed output (stdout + stderr). */
export async function probe(sandbox, ...args) {
  const r = await sandbox.runCommand({
    cmd: 'node',
    args: ['/vercel/sandbox/vm-probe.mjs', ...args],
  });
  const text = ((await r.stdout()) + (await r.stderr())).trim();
  return { text, exitCode: r.exitCode };
}

export {
  writeBridge, waitForReady, resolveAuth, mcpEndpoint,
  listAllSandboxes, classifyAlive, stopClaimed, describeNotOurs,
  ownershipStrayCheck, ALIVE_STATES,
};
