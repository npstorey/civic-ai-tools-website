/**
 * POC MCP-WARM-VM — sandbox provisioning, factored so every measurement phase
 * boots the SAME way and differences between readings are the thing measured
 * rather than an artefact of two spellings.
 */
import { Sandbox } from '@vercel/sandbox';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpEndpoint, sleep } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const CHARTER_PACKAGE = '@betanyc/nyc-charter-laws-rules@0.2.0';
export const BRIDGE_PORT = 3000;
export const SANDBOX_VCPUS = 1;              // 2048 MB of memory per vCPU
export const SANDBOX_MEMORY_MB = 2048 * SANDBOX_VCPUS;
export const SANDBOX_TIMEOUT_MS = 45 * 60_000;

/**
 * Egress needed ONLY to install the package. M3 flips this to "deny-all"
 * afterwards and re-measures, so the allowlist is a boot-time concession and
 * not the steady state.
 */
export const INSTALL_POLICY = { allow: ['registry.npmjs.org', '*.npmjs.org', '*.npmjs.com'] };

export function resolveAuth() {
  const token = process.env.VERCEL_TOKEN?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  if (token && teamId && projectId) return { token, teamId, projectId };
  return {};   // fall through to VERCEL_OIDC_TOKEN, as vercel-sandbox.ts does
}

/** `Sandbox.create(...)` — the literal call, for the readout beside the number. */
export const CREATE_FRESH_COMMAND =
  `Sandbox.create({ runtime:'node22', ports:[${BRIDGE_PORT}], resources:{vcpus:${SANDBOX_VCPUS}}, ` +
  `timeout:${SANDBOX_TIMEOUT_MS}, networkPolicy:${JSON.stringify(INSTALL_POLICY)} })`;

export const CREATE_FROM_SNAPSHOT_COMMAND =
  `Sandbox.create({ source:{type:'snapshot',snapshotId:<id>}, ports:[${BRIDGE_PORT}], ` +
  `resources:{vcpus:${SANDBOX_VCPUS}}, timeout:${SANDBOX_TIMEOUT_MS} })`;

export async function createFresh(bridgeToken) {
  return Sandbox.create({
    runtime: 'node22',
    ports: [BRIDGE_PORT],
    resources: { vcpus: SANDBOX_VCPUS },
    timeout: SANDBOX_TIMEOUT_MS,
    networkPolicy: INSTALL_POLICY,
    env: bridgeEnv(bridgeToken),
    ...resolveAuth(),
  });
}

export async function createFromSnapshot(snapshotId, bridgeToken) {
  return Sandbox.create({
    source: { type: 'snapshot', snapshotId },
    ports: [BRIDGE_PORT],
    resources: { vcpus: SANDBOX_VCPUS },
    timeout: SANDBOX_TIMEOUT_MS,
    env: bridgeEnv(bridgeToken),
    ...resolveAuth(),
  });
}

/**
 * Sandbox-wide env. The bearer token reaches the VM this way and is never
 * written to a file, a log line or the results file.
 */
function bridgeEnv(bridgeToken) {
  return {
    BRIDGE_PORT: String(BRIDGE_PORT),
    BRIDGE_TOKEN: bridgeToken,
    BRIDGE_TOOL_PREFIX: 'nyc_charter__',
    BRIDGE_SERVER_CMD: '/vercel/sandbox/node_modules/.bin/nyc-charter-laws-rules',
    BRIDGE_SERVER_ARGS: '[]',
  };
}

export const INSTALL_COMMAND = `npm install --no-audit --no-fund ${CHARTER_PACKAGE}`;

export async function installCharter(sandbox) {
  const r = await sandbox.runCommand({
    cmd: 'npm',
    args: ['install', '--no-audit', '--no-fund', CHARTER_PACKAGE],
    cwd: '/vercel/sandbox',
  });
  if (r.exitCode !== 0) {
    throw new Error(`npm install failed (${r.exitCode}): ${(await r.stderr()).slice(0, 1500)}`);
  }
  return r;
}

export const START_BRIDGE_COMMAND = 'node /vercel/sandbox/bridge.mjs   (detached)';

export async function writeBridge(sandbox) {
  const content = fs.readFileSync(path.join(HERE, 'bridge.mjs'), 'utf8');
  await sandbox.writeFiles([{ path: '/vercel/sandbox/bridge.mjs', content }]);
}

export async function startBridge(sandbox) {
  return sandbox.runCommand({
    cmd: 'node',
    args: ['/vercel/sandbox/bridge.mjs'],
    cwd: '/vercel/sandbox',
    detached: true,
  });
}

export const READY_COMMAND = (url) => `GET ${url}/readyz  (Authorization: Bearer <token>), polled every 150ms`;

/** Poll the bridge's own readiness endpoint until it answers 200. */
export async function waitForReady(baseUrl, token, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'no attempt';
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl.replace(/\/$/, '')}/readyz`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 200) return true;
      lastErr = `HTTP ${r.status}`;
    } catch (e) { lastErr = e.message; }
    await sleep(150);
  }
  throw new Error(`bridge not ready within ${timeoutMs}ms (last: ${lastErr})`);
}

export { mcpEndpoint };
