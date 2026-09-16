#!/usr/bin/env node
/**
 * POC MCP-WARM-VM — backstop: stop every sandbox that is still alive.
 *
 * Exists because this spike leaked one. A sandbox left running bills memory
 * per GB-hour until its timeout expires, and the SDK's own listing is easy to
 * misread: `Sandbox.list()` returns a Parsed WRAPPER, so the rows are at
 * `.json.sandboxes` and a reader that reaches for `.sandboxes` gets undefined
 * and reports "0 running" forever.
 *
 * Read-only unless something is actually alive. Run:
 *   node scripts/poc-warm-vm/stop-strays.mjs             # report only
 *   node scripts/poc-warm-vm/stop-strays.mjs --stop      # report, then stop
 *   node scripts/poc-warm-vm/stop-strays.mjs --snapshots # also list snapshots
 *
 * Snapshots are REPORTED, never deleted. This scope holds a long-lived
 * notebook-executor snapshot (`SANDBOX_SNAPSHOT_ID`, created 2026-05-22), and
 * a cleanup script that deletes "old" snapshots by age or size would take
 * production with it. Deleting one is a decision made by reading the id.
 */
import { Sandbox, Snapshot } from '@vercel/sandbox';

const ALIVE = ['running', 'pending', 'stopping', 'snapshotting'];
const doStop = process.argv.includes('--stop');

async function reportSnapshots() {
  if (!process.argv.includes('--snapshots')) return;
  const snaps = await Snapshot.list({});
  const rows = snaps?.json?.snapshots;
  if (!Array.isArray(rows)) { console.error('\ncould not read a snapshots array.'); return; }
  const liveSnaps = rows.filter((r) => r.status === 'created');
  console.log(`\n${liveSnaps.length} snapshot(s) not deleted (REPORT ONLY — delete by id, deliberately):`);
  for (const r of liveSnaps) {
    console.log(`  ${r.id}  ${(r.sizeBytes / 1e6).toFixed(0)}MB  created=${new Date(r.createdAt).toISOString()}  src=${r.sourceSandboxId}`);
  }
  console.log('  NOTE: one of these is the notebook executor\u2019s SANDBOX_SNAPSHOT_ID. Do not delete it.');
}

const listed = await Sandbox.list({});
const rows = listed?.json?.sandboxes;
if (!Array.isArray(rows)) {
  console.error(`could not read a sandboxes array (top-level keys: ${listed && Object.keys(listed)})`);
  process.exit(1);
}

console.log(`${rows.length} sandbox(es) known to this scope:`);
for (const s of rows) {
  console.log(`  ${s.id}  status=${s.status}  runtime=${s.runtime}  ${s.vcpus}vCPU/${s.memory}MB  created=${new Date(s.createdAt).toISOString()}`);
}

const alive = rows.filter((s) => ALIVE.includes(s.status));
console.log(`\n${alive.length} still alive.`);
if (!alive.length) { await reportSnapshots(); process.exit(0); }
if (!doStop) {
  console.log('Re-run with --stop to stop them.');
  await reportSnapshots();
  process.exit(0);
}
for (const s of alive) {
  const sb = await Sandbox.get({ sandboxId: s.id });
  await sb.stop({ blocking: true });
  console.log(`  STOPPED ${s.id}  activeCpuUsageMs=${sb.activeCpuUsageMs}  networkTransfer=${JSON.stringify(sb.networkTransfer)}`);
}

await reportSnapshots();
