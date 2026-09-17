#!/usr/bin/env node
/**
 * POC MCP-WARM-VM — backstop: find, and optionally stop, sandboxes THIS SPIKE
 * left alive.
 *
 * THIS PROJECT SCOPE IS SHARED WITH PRODUCTION. The reference site's notebook
 * executor creates python3.13 sandboxes here for visitors' runs, so this
 * script never stops anything by status alone — an earlier version did, and
 * could have stopped a visitor's notebook mid-execution. A sandbox is stopped
 * only when it is claimed by the rule in sandbox-ops.mjs (classifyAlive):
 *   - named explicitly with --id, or
 *   - matching a spike's signature — runtime node22, a route on the port that
 *     spike exposes (3000 by default; --port 3100 for the live-source spike),
 *     created at or after --since.
 * Every other alive sandbox is reported "NOT OURS — left running".
 *
 * The listing is read across ALL pages: a bare `Sandbox.list()` returns 20
 * rows, and a check that reads one page cannot see an alive sandbox on page
 * two.
 *
 * Usage:
 *   node scripts/poc-warm-vm/stop-strays.mjs                         report; claims nothing
 *   node scripts/poc-warm-vm/stop-strays.mjs --since <ISO>           report which match the signature
 *   node scripts/poc-warm-vm/stop-strays.mjs --stop --since <ISO>    stop signature matches only
 *   node scripts/poc-warm-vm/stop-strays.mjs --port 3100 --since <ISO>  the live-source spike's VMs
 *   node scripts/poc-warm-vm/stop-strays.mjs --stop --id sbx_… [--id sbx_…]   stop exactly these
 *   add --snapshots to list snapshots (REPORT ONLY — never deleted here)
 *
 * `--stop` with neither --id nor --since is refused.
 * run-poc.mjs prints its run start as "run start (API clock): <ISO>" — that
 * value is the --since for a run.
 */
import { Snapshot } from '@vercel/sandbox';
import {
  resolveAuth, listAllSandboxes, classifyAlive, stopClaimed, describeNotOurs,
  ALIVE_STATES, OUR_SIGNATURE,
} from './sandbox-ops.mjs';

// ------------------------------------------------------------------ args ---
const argv = process.argv.slice(2);
const doStop = argv.includes('--stop');
const wantSnapshots = argv.includes('--snapshots');
const explicitIds = new Set();
let sinceMs = null;
let port = OUR_SIGNATURE.port;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--id') {
    const id = argv[i + 1];
    if (!id || !id.startsWith('sbx_')) { console.error(`--id needs a sandbox id (sbx_…), got "${id ?? ''}"`); process.exit(2); }
    explicitIds.add(id); i++;
  } else if (argv[i] === '--port') {
    // POC MCP-LIVE-SOURCE: which spike's VMs this invocation may claim. The
    // default is the warm-VM spike's 3000; the live-source spike exposes 3100.
    const n = Number(argv[i + 1]);
    if (!Number.isInteger(n) || n <= 0) { console.error(`--port needs a port number, got "${argv[i + 1] ?? ''}"`); process.exit(2); }
    port = n; i++;
  } else if (argv[i] === '--since') {
    const raw = argv[i + 1];
    const parsed = raw ? Date.parse(raw) : NaN;
    if (Number.isNaN(parsed)) { console.error(`--since needs an ISO timestamp, got "${raw ?? ''}"`); process.exit(2); }
    sinceMs = parsed; i++;
  }
}

if (doStop && explicitIds.size === 0 && sinceMs == null) {
  console.log('REFUSED: --stop needs --id <sbx_…> or --since <ISO>.');
  console.log('This project scope also runs production’s notebook executor, so nothing is');
  console.log('stopped by status alone. Nothing was stopped.');
  process.exit(2);
}

const auth = resolveAuth();

// --------------------------------------------------------------- report ---
const { rows } = await listAllSandboxes(auth);
const alive = rows.filter((r) => ALIVE_STATES.includes(r.status));
console.log(`${rows.length} sandbox(es) in scope (all pages); ${alive.length} alive.`);
console.log(`signature: runtime ${OUR_SIGNATURE.runtime} + route on port ${port} + created at/after ` +
  `${sinceMs == null ? '(no --since given)' : new Date(sinceMs).toISOString()}` +
  `${explicitIds.size ? `; named ids: ${[...explicitIds].join(' ')}` : ''}`);

const { ours, notOurs, namedNotAlive } = await classifyAlive({
  auth, explicitIds, runStartMs: sinceMs, signature: { ...OUR_SIGNATURE, port },
});

for (const o of ours) {
  console.log(`  CLAIMED [${o.by}]: ${o.row.id}  status=${o.row.status}  runtime=${o.row.runtime}  created=${new Date(o.row.createdAt).toISOString()}`);
}
for (const n of notOurs) console.log(`  NOT OURS — left running: ${describeNotOurs(n)}`);
for (const n of namedNotAlive) console.log(`  named but not alive: ${n.id} (${n.status})`);

// ----------------------------------------------------------------- stop ---
if (!doStop) {
  console.log(`\n${ours.length} claimed, ${notOurs.length} not ours. Report only${ours.length ? ' — add --stop to stop the claimed ones' : ''}.`);
} else if (!ours.length) {
  console.log(`\nSTOPPED: 0 (nothing claimed). NOT OURS left running: ${notOurs.length}.`);
} else {
  const remaining = await stopClaimed(ours, auth);
  const stopped = ours.filter((o) => !remaining.includes(o));
  console.log(`\nSTOPPED: ${stopped.length} ${stopped.map((o) => o.row.id).join(' ')}`.trimEnd());
  if (remaining.length) {
    console.log(`STOP FAILED: ${remaining.length} ${remaining.map((o) => `${o.row.id}${o.stopError ? ` (${o.stopError})` : ''}`).join(' ')}`);
    process.exitCode = 1;
  }
  console.log(`NOT OURS left running: ${notOurs.length}.`);
}

// ------------------------------------------------------------ snapshots ---
if (wantSnapshots) {
  const snaps = await Snapshot.list({ ...auth, limit: 100 });
  const snapRows = snaps?.json?.snapshots;
  if (!Array.isArray(snapRows)) {
    console.error('\ncould not read a snapshots array.');
  } else {
    const kept = snapRows.filter((r) => r.status === 'created');
    console.log(`\n${kept.length} snapshot(s) not deleted (REPORT ONLY — delete by id, deliberately):`);
    for (const r of kept) {
      console.log(`  ${r.id}  ${(r.sizeBytes / 1e6).toFixed(0)}MB  created=${new Date(r.createdAt).toISOString()}  src=${r.sourceSandboxId}`);
    }
    console.log('  NOTE: the notebook executor’s SANDBOX_SNAPSHOT_ID lives in this scope. Do not delete it.');
    if (snaps?.json?.pagination?.next != null) console.log('  (more snapshots exist beyond the first 100 — not listed)');
  }
}
