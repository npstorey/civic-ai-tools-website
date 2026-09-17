#!/usr/bin/env node
/**
 * POC MCP-LIVE-SOURCE — the probes that must run INSIDE the machine.
 *
 * Written into the sandbox next to bridge.mjs and invoked with
 * `sandbox.runCommand({ cmd: 'node', args: ['/vercel/sandbox/vm-probe.mjs', <probe>, …] })`.
 *
 * WHY A FILE RATHER THAN `sh -c '…'`. Every probe here is a few lines of
 * JavaScript that has to survive being embedded in a JS template literal, then
 * in a shell word, then in an `awk` program. The warm-VM spike's one-liners
 * were at the edge of that; these are past it, and a probe whose quoting is
 * wrong fails in ways that look like the finding it was measuring. A file also
 * means the exact probe text is in the repository, so a reading can be re-driven
 * against the same code.
 *
 * SECRET HYGIENE IS THE POINT OF ONE OF THESE, so it is the rule for all of
 * them: this file prints variable NAMES and the words SET / UNSET. It never
 * prints a value, a length, a prefix, a suffix or a hash — a length is a fact
 * about a secret, and this spike's whole L3 claim is that no fact about the
 * token leaves the machine.
 *
 * Every probe prints ONE line per finding, prefixed with its own name, so the
 * driver can record the literal output beside the command that produced it.
 */
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const [probe, ...rest] = process.argv.slice(2);

/** The one variable this source reads. Named here so nothing has to guess it. */
const SECRET_NAME = 'SOCRATA_APP_TOKEN';

function out(line) { console.log(line); }

// --------------------------------------------------------------- outbound ---
// Can this VM reach `host` at all? Reports the failure CODE, which is what
// distinguishes a DNS-level block (ENOTFOUND) from a connection-level one
// (ECONNREFUSED / EHOSTUNREACH / ETIMEDOUT) — the difference decides whether a
// process that has already resolved a name can keep talking through a block.
async function outbound(host) {
  const t0 = Date.now();
  try {
    const r = await fetch(`https://${host}/`, { redirect: 'manual' });
    out(`OUTBOUND ${host} REACHED status=${r.status} in ${Date.now() - t0}ms`);
  } catch (e) {
    const code = e?.cause?.code || e?.cause?.message || e?.code || e?.message;
    out(`OUTBOUND ${host} BLOCKED ${code} in ${Date.now() - t0}ms`);
  }
}

// -------------------------------------------------------------------- TLS ---
// Who signed the certificate this VM is actually presented for `host`?
//
// `rejectUnauthorized: false` so the handshake COMPLETES even when the chain is
// untrusted: the question is what the peer certificate says, and a probe that
// aborts on an untrusted chain cannot answer it. `socket.authorized` is read
// separately and is the trust answer — it reports what Node's own default store
// made of the chain, and that is the same store `fetch` (undici) uses. So this
// one probe answers both halves of L2: who terminated the connection, and
// whether the source's own HTTP client would have accepted it unaided.
function tlsProbe(host) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, rejectUnauthorized: false, timeout: 15_000 },
      () => {
        const chain = [];
        const seen = new Set();
        let cert = socket.getPeerCertificate(true);
        while (cert && cert.fingerprint256 && !seen.has(cert.fingerprint256)) {
          seen.add(cert.fingerprint256);
          const subject = cert.subject?.CN || cert.subject?.O || '(no CN)';
          const issuer = cert.issuer?.CN || cert.issuer?.O || '(no CN)';
          chain.push(`${subject} <- ${issuer}`);
          cert = cert.issuerCertificate;
        }
        out(
          `TLS ${host} authorized=${socket.authorized} ` +
            `authorizationError=${socket.authorizationError || 'none'} ` +
            `protocol=${socket.getProtocol()} ` +
            `chain=[${chain.join(' | ')}]`,
        );
        socket.end();
        resolve();
      },
    );
    socket.on('timeout', () => { out(`TLS ${host} ERROR timeout`); socket.destroy(); resolve(); });
    socket.on('error', (e) => { out(`TLS ${host} ERROR ${e.code || e.message}`); resolve(); });
  });
}

// ----------------------------------------------------------------- secret ---
/**
 * L3 — is the source's secret set inside the machine, and in which processes?
 *
 * Reads only the NAMES out of each node process's environment block. The value
 * is never read into a variable that is printed, and no length is derived.
 *
 * Reporting it per-process rather than just for this probe's own process is the
 * part that matters: the claim is that the UPSTREAM SERVER can see the token, so
 * the evidence has to be about the bridge's child, not about a shell.
 */
function secretProbe() {
  const here = process.env[SECRET_NAME];
  out(`SECRET ${SECRET_NAME} in this probe process: ${here ? 'SET (non-empty)' : 'UNSET or empty'}`);

  let pids = [];
  try {
    pids = fs
      .readdirSync('/proc')
      .filter((d) => /^\d+$/.test(d))
      .map(Number)
      .filter((pid) => {
        try { return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'node'; }
        catch { return false; }
      });
  } catch (e) {
    out(`SECRET could not enumerate processes: ${e.message}`);
    return;
  }

  for (const pid of pids.sort((a, b) => a - b)) {
    let names = [];
    let cmd = '(unreadable)';
    try {
      // NUL-separated NAME=VALUE pairs. Only the part before the first "=" is
      // ever kept, and the rest is dropped on the same line it is read.
      names = fs.readFileSync(`/proc/${pid}/environ`, 'utf8')
        .split('\0')
        .filter(Boolean)
        .map((pair) => pair.slice(0, pair.indexOf('=')));
      cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ').slice(0, 80);
    } catch {
      out(`SECRET pid ${pid}: environment unreadable`);
      continue;
    }
    const has = names.includes(SECRET_NAME);
    out(`SECRET pid ${pid} [${cmd}]: ${SECRET_NAME} ${has ? 'PRESENT' : 'ABSENT'} (${names.length} variables, names only)`);
  }
}

// ------------------------------------------------------------- CA material ---
/** L2's "if it needs help, say exactly what" — what trust material the image ships. */
function caProbe() {
  out(`CA node ${process.version}`);
  out(`CA NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS || '(unset)'}`);
  out(`CA bundled root certificates: ${tls.rootCertificates.length}`);
  for (const p of [
    '/etc/ssl/certs/ca-certificates.crt',
    '/etc/pki/tls/certs/ca-bundle.crt',
    '/etc/ssl/cert.pem',
  ]) {
    try {
      const st = fs.statSync(p);
      out(`CA ${p}: present, ${st.size} bytes`);
    } catch {
      out(`CA ${p}: absent`);
    }
  }
}

// --------------------------------------------------------- installed size ---
/** The Charter contrast: how much disk the pinned package actually costs. */
function sizeProbe() {
  const read = (p) => {
    try { return execSync(`du -sk ${p} 2>/dev/null | cut -f1`, { encoding: 'utf8' }).trim(); }
    catch { return 'n/a'; }
  };
  out(`SIZE node_modules: ${read('/vercel/sandbox/node_modules')} kB`);
  out(`SIZE @betanyc:     ${read('/vercel/sandbox/node_modules/@betanyc')} kB`);
  out(`SIZE package count: ${(() => {
    try { return execSync('ls /vercel/sandbox/node_modules | wc -l', { encoding: 'utf8' }).trim(); }
    catch { return 'n/a'; }
  })()}`);
}

// --------------------------------------------------------------- dns only ---
/**
 * Does the block cut names, or packets? Resolve the upstream through the DNS
 * resolver and, separately, open a raw TCP connection to a literal address.
 * A block that only removes the name leaves a warm process with a cached
 * address able to keep talking; one that drops packets does not.
 */
async function dnsProbe(host) {
  const dns = await import('node:dns/promises');
  let addr = null;
  try {
    const r = await dns.lookup(host);
    addr = r.address;
    out(`DNS ${host} resolved to ${addr}`);
  } catch (e) {
    out(`DNS ${host} FAILED ${e.code || e.message}`);
  }
  const target = addr || rest[1];
  if (!target) { out('DNS no address to test a raw connection against'); return; }
  await new Promise((resolve) => {
    const s = net.connect({ host: target, port: 443, timeout: 8000 }, () => {
      out(`DNS raw TCP to ${target}:443 CONNECTED`);
      s.destroy(); resolve();
    });
    s.on('timeout', () => { out(`DNS raw TCP to ${target}:443 TIMEOUT`); s.destroy(); resolve(); });
    s.on('error', (e) => { out(`DNS raw TCP to ${target}:443 ${e.code || e.message}`); resolve(); });
  });
}

switch (probe) {
  case 'outbound': await outbound(rest[0]); break;
  case 'tls': await tlsProbe(rest[0]); break;
  case 'secret': secretProbe(); break;
  case 'ca': caProbe(); break;
  case 'size': sizeProbe(); break;
  case 'dns': await dnsProbe(rest[0]); break;
  default:
    console.error(`unknown probe "${probe}" — one of: outbound <host> | tls <host> | secret | ca | size | dns <host> [addr]`);
    process.exit(2);
}
