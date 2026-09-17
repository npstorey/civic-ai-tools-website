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

// ------------------------------------------------------------------------
// WHICH ALIVE SANDBOXES ARE OURS — one definition, used by run-poc.mjs's
// end-of-run stray check and by stop-strays.mjs.
//
// This project scope is SHARED with production: the reference site's notebook
// executor creates python3.13 sandboxes here for visitors' runs (one was
// observed alive-then-stopped in the scope during this spike). A cleanup that
// stops "every alive sandbox" can stop a visitor's notebook mid-execution. So
// nothing is stopped by status alone. A sandbox is claimed only when it is
//   - `recorded`:  its id was recorded by this run at creation, or
//   - `named`:     an operator passed its id explicitly, or
//   - `signature`: runtime node22 AND a route on port 3000 AND created at or
//                  after the run's start (server clock) — the shape of a VM
//                  this spike creates whose id bookkeeping never saw, e.g. a
//                  create whose response was lost to a throw.
// Everything else alive is reported as NOT OURS and left running.
// ------------------------------------------------------------------------

export const OUR_SIGNATURE = { runtime: 'node22', port: BRIDGE_PORT };
export const ALIVE_STATES = ['running', 'pending', 'stopping', 'snapshotting'];

/**
 * The run start is read from the sandbox API's own HTTP `Date` header, so it
 * is compared against `createdAt` on the SAME side of the wire. That header
 * has one-second resolution; the cushion absorbs it plus any drift between
 * the API edge and the control plane that stamps `createdAt`. Widening the
 * window backwards by 2 s can only admit a sandbox that ALSO matches the rest
 * of the signature — i.e. another run of this spike.
 */
const CLOCK_CUSHION_MS = 2000;

/**
 * Every sandbox in the scope, across ALL pages.
 *
 * Measured 2026-09-17: a bare `Sandbox.list()` returns 20 rows while the scope
 * held 37. A stray check that reads one page cannot see an alive sandbox on
 * page two and prints "STRAYS: 0" over it. Pages chain by passing
 * `pagination.next` back as `until`; checked against a single limit-100 read
 * (37 rows, 0 missing, 0 extra).
 */
export async function listAllSandboxes(auth = {}) {
  const byId = new Map();
  let until;
  let serverNowMs = null;
  for (let page = 0; ; page++) {
    if (page >= 200) throw new Error('sandbox listing did not terminate within 200 pages — refusing to report a partial list');
    const r = await Sandbox.list({ ...auth, limit: 100, ...(until != null ? { until } : {}) });
    if (serverNowMs == null) {
      const date = r?.response?.headers?.get('date');
      serverNowMs = date ? Date.parse(date) : null;
    }
    const rows = r?.json?.sandboxes;
    if (!Array.isArray(rows)) throw new Error(`no sandboxes array in the listing (keys: ${r && Object.keys(r)})`);
    for (const row of rows) byId.set(row.id, row);
    const next = r?.json?.pagination?.next;
    if (next == null || rows.length === 0) break;
    until = next;
  }
  return { rows: [...byId.values()], serverNowMs };
}

/**
 * Split the scope's ALIVE sandboxes into ours and not-ours.
 * Returns { ours: [{row, by}], notOurs: [{row, why}], namedNotAlive: [{id, status}] }.
 */
export async function classifyAlive({ auth = {}, recordedIds = new Set(), explicitIds = new Set(), runStartMs = null }) {
  const { rows } = await listAllSandboxes(auth);
  const alive = rows.filter((r) => ALIVE_STATES.includes(r.status));
  const ours = [];
  const notOurs = [];
  for (const row of alive) {
    if (recordedIds.has(row.id)) { ours.push({ row, by: 'recorded' }); continue; }
    if (explicitIds.has(row.id)) { ours.push({ row, by: 'named' }); continue; }
    const why = [];
    if (runStartMs == null) {
      why.push('no start time, so no signature match is possible');
    } else {
      if (row.runtime !== OUR_SIGNATURE.runtime) why.push(`runtime ${row.runtime}, not ${OUR_SIGNATURE.runtime}`);
      if (row.createdAt < runStartMs - CLOCK_CUSHION_MS) {
        why.push(`created ${new Date(row.createdAt).toISOString()}, before start ${new Date(runStartMs).toISOString()}`);
      }
      // Routes are one extra read per sandbox, so they are fetched only when
      // the two cheap criteria already match.
      if (!why.length) {
        try {
          const sb = await Sandbox.get({ sandboxId: row.id, ...auth });
          if (!(sb.routes || []).some((rt) => rt.port === OUR_SIGNATURE.port)) {
            why.push(`no route on port ${OUR_SIGNATURE.port}`);
          }
        } catch (e) {
          why.push(`routes unreadable (${e?.message}) — not provably ours`);
        }
      }
    }
    if (why.length) notOurs.push({ row, why: why.join('; ') });
    else ours.push({ row, by: 'signature' });
  }
  const aliveIds = new Set(alive.map((r) => r.id));
  const statusById = new Map(rows.map((r) => [r.id, r.status]));
  const namedNotAlive = [...explicitIds].filter((id) => !aliveIds.has(id))
    .map((id) => ({ id, status: statusById.get(id) ?? 'not found in this scope' }));
  return { ours, notOurs, namedNotAlive };
}

/** Stop the claimed sandboxes (blocking), then re-read. Returns the claimed ones still alive. */
export async function stopClaimed(ours, auth = {}) {
  for (const o of ours) {
    try {
      const sb = await Sandbox.get({ sandboxId: o.row.id, ...auth });
      await sb.stop({ blocking: true });
    } catch (e) {
      o.stopError = e?.message;
    }
  }
  const { rows } = await listAllSandboxes(auth);
  const stillAlive = new Set(rows.filter((r) => ALIVE_STATES.includes(r.status)).map((r) => r.id));
  return ours.filter((o) => stillAlive.has(o.row.id));
}

/** One-line description of a not-ours sandbox. */
export function describeNotOurs(n) {
  return `${n.row.id} (${n.why})`;
}

/**
 * The end-of-run stray check, as two printable lines: `notOursLine`, then
 * `strayLine` (always printed last). Same rule, same wording as the inline
 * block in run-poc.mjs, which is deliberately left as it was when it produced
 * the record run (f12d3fd); scripts written after the record use this.
 *
 * The STRAYS line names what was alive and claimed BEFORE the backstop acted,
 * so a leak can never read "STRAYS: 0". NOT OURS never changes it.
 */
export async function ownershipStrayCheck({ auth = {}, recordedIds = new Set(), runStartMs = null }) {
  const sinceIso = runStartMs ? new Date(runStartMs).toISOString() : '<run start>';
  try {
    const { ours, notOurs } = await classifyAlive({ auth, recordedIds, runStartMs });
    const notOursLine = notOurs.length
      ? `NOT OURS — left running: ${notOurs.length}  ${notOurs.map(describeNotOurs).join('  ')}`
      : 'NOT OURS — left running: 0';
    if (!ours.length) return { notOursLine, strayLine: 'STRAYS: 0', sinceIso };
    const label = ours.map((o) => `${o.row.id}[${o.by}]`).join(' ');
    const remaining = await stopClaimed(ours, auth);
    const strayLine = remaining.length
      ? `STRAYS: ${ours.length} ${label} (backstop FAILED; ${remaining.length} still alive: ${remaining.map((o) => o.row.id).join(' ')})`
      : `STRAYS: ${ours.length} ${label} (backstop stopped all ${ours.length}; 0 still alive)`;
    return { notOursLine, strayLine, sinceIso };
  } catch (e) {
    return {
      notOursLine: 'NOT OURS — left running: UNKNOWN (the listing could not be read)',
      strayLine: `STRAYS: UNKNOWN — could not read the sandbox list (${e?.name}: ${e?.message}); run: node scripts/poc-warm-vm/stop-strays.mjs --since ${sinceIso}`,
      sinceIso,
    };
  }
}
