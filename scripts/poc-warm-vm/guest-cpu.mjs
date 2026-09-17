/**
 * POC MCP-WARM-VM — per-call CPU on ONE VM, from the guest kernel's own
 * accounting.
 *
 * WHY THIS INSTRUMENT. The billed counter, `activeCpuUsageMs`, is reported
 * only once a VM has stopped (@vercel/sandbox@1.10.2), so per-call CPU from
 * it needs two boots and a difference — and the record run showed that
 * difference is noisier than 500 calls (reading 1: boot+500 4228 ms − boot
 * 5253 ms = −2.05 ms per call). Reading the guest's CPU time costs no extra
 * sandbox creation.
 *
 * WHAT IT IS NOT. Guest CPU time is not the billed counter: it cannot see
 * hypervisor or virtio work done outside the guest. It is reported under its
 * own name, beside the cost bound, never as "active CPU".
 *
 * Two readings of the same quantity:
 *   - VM-wide busy ticks from /proc/stat (user+nice+system+irq+softirq+steal);
 *   - utime+stime of every `node` process (the bridge and the Charter child).
 * Each call window is paired with an idle window of the same wall length,
 * bracketed by the same read, so background CPU and the cost of the read
 * itself are subtracted rather than attributed to calls.
 */

/** One shell command, run through `sandbox.runCommand({ cmd: 'sh', args: ['-c', …] })`. */
export const GUEST_CPU_COMMAND =
  "getconf CLK_TCK; head -1 /proc/stat; for p in $(ps -e -o pid=,comm= | awk '$2==\"node\"{print $1}'); do cat /proc/$p/stat 2>/dev/null; done";

/** Parse the command's stdout. Pure; exported for fixture checks. */
export function parseGuestCpu(stdout) {
  const lines = String(stdout).trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const clkTck = Number(lines[0]);
  if (!Number.isFinite(clkTck) || clkTck <= 0) throw new Error(`CLK_TCK unreadable: "${lines[0]}"`);
  const cpu = lines.find((l) => /^cpu\s/.test(l));
  if (!cpu) throw new Error('no aggregate "cpu" line from /proc/stat');
  // cpu user nice system idle iowait irq softirq steal guest guest_nice
  // guest/guest_nice are already counted inside user/nice, so they are not added again.
  const f = cpu.split(/\s+/).slice(1).map(Number);
  const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = f;
  const vmBusyTicks = user + nice + system + irq + softirq + steal;
  const vmIdleTicks = idle + iowait;
  const procs = [];
  for (const l of lines) {
    const close = l.lastIndexOf(')');
    if (!/^\d+ \(/.test(l) || close < 0) continue;
    const pid = Number(l.slice(0, l.indexOf(' ')));
    // Fields after "(comm)": state is field 3, so utime (14) and stime (15)
    // sit at offsets 11 and 12 of what follows the closing parenthesis.
    const rest = l.slice(close + 1).trim().split(/\s+/);
    procs.push({ pid, utime: Number(rest[11]), stime: Number(rest[12]) });
  }
  const nodeTicks = procs.reduce((a, p) => a + p.utime + p.stime, 0);
  return { clkTck, vmBusyTicks, vmIdleTicks, nodePids: procs.map((p) => p.pid).sort((a, b) => a - b), nodeTicks };
}

/**
 * Per-call guest CPU from one call window and the idle window after it.
 * Each window: { start, end, wallMs } where start/end are parseGuestCpu results.
 */
export function perCallGuestCpu({ callWin, idleWin, calls }) {
  const tickMs = 1000 / callWin.start.clkTck;
  const samePids = (a, b) => a.nodePids.join(',') === b.nodePids.join(',');
  const pidsStable = samePids(callWin.start, callWin.end) && samePids(idleWin.start, idleWin.end)
    && samePids(callWin.start, idleWin.end);
  const attributable = (key) => {
    const inCalls = callWin.end[key] - callWin.start[key];
    const inIdle = idleWin.end[key] - idleWin.start[key];
    const background = (inIdle / idleWin.wallMs) * callWin.wallMs;
    return { inCalls, inIdle, perCallMs: ((inCalls - background) * tickMs) / calls };
  };
  return {
    tickMs,
    calls,
    callWallMs: callWin.wallMs,
    idleWallMs: idleWin.wallMs,
    pidsStable,
    nodePids: callWin.start.nodePids,
    vm: attributable('vmBusyTicks'),
    node: attributable('nodeTicks'),
  };
}
