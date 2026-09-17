/** Shared helpers for the POC MCP-WARM-VM measurement scripts. */
import fs from 'node:fs';
import path from 'node:path';

export const RESULTS_DIR = process.env.POC_RESULTS_DIR
  || path.join(process.cwd(), 'temp', 'mcp-warm-vm-poc');

let jsonlPath = null;
export function openResults(runId) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  jsonlPath = path.join(RESULTS_DIR, `observations-${runId}.jsonl`);
  return jsonlPath;
}

/**
 * Record one observation. `command` is REQUIRED and is the literal command or
 * SDK expression that produced the number — the contract asks for the command
 * beside every reading, so the helper refuses an observation without one.
 */
export function record(o) {
  if (!o.command) throw new Error(`observation "${o.measurement}/${o.step}" has no command — every number prints the command that produced it`);
  const line = { at: new Date().toISOString(), ...o };
  if (jsonlPath) fs.appendFileSync(jsonlPath, JSON.stringify(line) + '\n');
  return line;
}

export function writeSummary(runId, summary) {
  const p = path.join(RESULTS_DIR, `summary-${runId}.json`);
  fs.writeFileSync(p, JSON.stringify(summary, null, 2));
  return p;
}

export const log = (...a) => console.log(...a);
export function section(title) { console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`); }

/** Print a measurement line in the fixed "value <- command" shape. */
export function readout(label, value, command) {
  console.log(`  ${label}: ${value}`);
  console.log(`      <- ${command}`);
}

export async function elapsed(fn) {
  const t0 = process.hrtime.bigint();
  const value = await fn();
  return { value, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalize a bridge base URL to the POST-able endpoint, as the registry does. */
export function mcpEndpoint(base) {
  const t = base.replace(/\/$/, '');
  return t.endsWith('/mcp') ? t : `${t}/mcp`;
}

/**
 * Import the app's MCP client bound to a SPECIFIC bridge address.
 *
 * `src/lib/mcp/client.ts` builds its registry ONCE at module load
 * (`const registry = buildMcpRegistry(readMcpEnvFromProcess())`), so a process
 * that points at two bridges in turn must re-evaluate the module. The query
 * suffix is what forces that: Node's ESM cache is keyed by the full specifier,
 * so a new `?bind=` gives a fresh module instance with fresh per-server state.
 * Nothing about the client is stubbed or bypassed — this is the shipped file.
 */
export async function importAppClientBoundTo(url, token, bindCounter) {
  process.env.NYC_CHARTER_MCP_URL = url;
  process.env.NYC_CHARTER_MCP_TOKEN = token;
  return import(`../../src/lib/mcp/client.ts?bind=${bindCounter}`);
}

/**
 * Silence the app client's own operator logging for the duration of a
 * measurement run.
 *
 * `src/lib/mcp/client.ts` console.logs every call, the RAW response body and
 * the formatted output — useful in a server log, unreadable in a transcript
 * meant to be pasted. Only calls whose FIRST argument is a string beginning
 * "[MCP" are dropped, so nothing this suite prints is ever suppressed. The
 * client is not modified; this is a filter on the way out.
 */
export function silenceAppClientLogs() {
  const real = console.log;
  console.log = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[MCP')) return;
    real(...args);
  };
  return () => { console.log = real; };
}

/** Print one "LABEL: value" line for the pasteable tail block. */
export function keyLine(label, value) {
  console.log(`  ${label.padEnd(34)} ${value}`);
}

/**
 * Copy everything this process writes to stdout and stderr into `logPath`,
 * while still writing it to the terminal. Installed before anything prints,
 * so the file is the whole run. Returns the path.
 */
export function teeOutputTo(logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, encoding, cb) => {
      try { fs.writeSync(fd, typeof chunk === 'string' ? chunk : Buffer.from(chunk)); } catch { /* the terminal copy still goes out */ }
      return write(chunk, encoding, cb);
    };
  }
  return logPath;
}
