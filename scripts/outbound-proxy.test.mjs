// RED INSTRUMENT for Wave N12 phase W6 (#468), anchor #470.
//
// Three assertions, all failing at `d34d2fd`.
//
// WHY THE TARGET IS `.invalid` AND NOT LOOPBACK. The seat ruled that `NO_PROXY`
// covers loopback by default, so W4's stubs and local MCP servers stay direct.
// A red that asserted "a loopback request is observed at the proxy" could then
// never be turned green by a correct implementation — the converse of a
// criterion that cannot fail, and just as useless. So the *destination* is a
// reserved `.invalid` name, which nothing resolves, while the *proxy* is on
// loopback. `NO_PROXY` applies to the destination, not to the proxy, so a
// loopback default cannot exempt it.
//
// That choice also gives the red its shape: with no dispatcher installed, the
// request dies in DNS and the proxy records nothing. With one installed, the
// client connects to the proxy and never resolves the destination at all.
//
// WHY THE PROXY HANDLES `CONNECT`. Measured at undici 6.28.0: `EnvHttpProxyAgent`
// tunnels with `CONNECT host:80` even for an `http://` target, and sends NO
// absolute-form request. A proxy built only from `http.createServer` therefore
// records nothing however correct the implementation is — a red no fix could
// turn green. This one counts a request observed in EITHER form, so it does not
// prescribe which the dispatcher uses.
//
// The request is driven through REAL application code — the signing leg, whose
// address W4 made configurable — not through a bare `fetch`, so this measures
// the app's outbound path rather than the runtime's.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const UNRESOLVABLE = 'proxy-probe.invalid';
const TARGET = `http://${UNRESOLVABLE}/tsr`;
const SAMPLE_HASH = 'acdb56712cc0e735589e39d485dcd2c3d34a611b6752ab2f8b703e13008a3004';

/** Every tracked JS/TS file, the same universe the derived env guard uses. */
function trackedSources() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((p) => /\.(c|m)?[jt]sx?$/.test(p) && !/\.test\./.test(p));
}

/**
 * The module that installs a global fetch dispatcher, discovered rather than
 * prescribed: a phase that names the file something else still passes.
 */
function dispatcherInstaller() {
  return trackedSources().filter((p) => {
    let text;
    try { text = readFileSync(p, 'utf8'); } catch { return false; }
    return text.includes('setGlobalDispatcher');
  });
}

/**
 * A loopback forward proxy that observes a request in either form: an
 * absolute-form HTTP request, or a `CONNECT` tunnel. Tunnels terminate at a
 * local origin so the call completes rather than hanging.
 */
async function loopbackProxy() {
  const seen = [];
  const origin = http.createServer((_q, s) => {
    s.writeHead(200, { 'content-type': 'application/timestamp-reply', 'content-length': '7' });
    s.end('proxied');
  });
  await new Promise((r) => origin.listen(0, '127.0.0.1', r));
  const originPort = origin.address().port;

  const server = http.createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { 'content-type': 'application/timestamp-reply', 'content-length': '7' });
    res.end('proxied');
  });
  server.on('connect', (req, clientSocket, head) => {
    seen.push(req.url);
    const upstream = net.connect(originPort, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    seen,
    port: server.address().port,
    close: () => { server.close(); origin.close(); },
  };
}

async function withEnv(values, fn) {
  const saved = new Map();
  for (const [k, v] of Object.entries(values)) {
    saved.set(k, Object.hasOwn(process.env, k) ? process.env[k] : undefined);
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

/** Drive one real outbound call of the signing kind, returning the proxy's hits. */
async function driveSigningThroughProxy(extraEnv) {
  const installers = dispatcherInstaller();
  assert.ok(
    installers.length > 0,
    'no tracked file in this repository installs a global fetch dispatcher (no `setGlobalDispatcher` ' +
      'anywhere), so nothing can honour HTTP_PROXY / HTTPS_PROXY / NO_PROXY — this runtime\'s built-in ' +
      'fetch ignores them, measured at node v22',
  );
  const proxy = await loopbackProxy();
  try {
    await withEnv(
      {
        HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
        http_proxy: `http://127.0.0.1:${proxy.port}`,
        TIMESTAMP_AUTHORITY_URL: TARGET,
        NO_PROXY: null,
        no_proxy: null,
        ...extraEnv,
      },
      async () => {
        // Cache-bust: an installer that reads the environment at module
        // evaluation must be re-evaluated for each environment under test,
        // or the second drive silently reuses the first one's dispatcher.
        for (const p of installers) await import(`../${p}?probe=${Date.now()}-${Math.random()}`);
        const { getRfc3161Timestamp } = await import('../src/lib/evidence/signing.ts');
        await getRfc3161Timestamp(SAMPLE_HASH);
      },
    );
  } finally {
    proxy.close();
  }
  return proxy.seen;
}

test('the three proxy variables are declared in ENV_SPEC', async () => {
  const { ENV_SPEC } = await import('./preflight-env.mjs');
  const declared = new Set(ENV_SPEC.map((e) => e.name));
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']) {
    assert.ok(
      declared.has(name),
      `ENV_SPEC does not declare ${name}; the derived env guard refuses an undeclared read, so the ` +
        'dispatcher cannot read it',
    );
  }
});

test('an outbound call is observed at the proxy and never resolves the destination', async () => {
  const seen = await driveSigningThroughProxy({});
  assert.equal(
    seen.length,
    1,
    `the proxy saw ${seen.length} request(s); with HTTP_PROXY set, one signing-service call must ` +
      'arrive there. The destination is a reserved .invalid name, so a request that did NOT go ' +
      'through the proxy died in DNS and went nowhere',
  );
  assert.ok(
    seen[0].includes(UNRESOLVABLE),
    `the proxy received "${seen[0]}", which does not name the destination — whether it arrives as an ` +
      'absolute-form URL or as a CONNECT authority, the destination is what the proxy is told',
  );
});

test('NO_PROXY exempts a named host, and its absence does not', async () => {
  const withoutExemption = await driveSigningThroughProxy({});
  assert.equal(withoutExemption.length, 1, 'baseline: unexempted, the call goes through the proxy');

  const withExemption = await driveSigningThroughProxy({
    NO_PROXY: UNRESOLVABLE,
    no_proxy: UNRESOLVABLE,
  });
  assert.equal(
    withExemption.length,
    0,
    `with NO_PROXY naming ${UNRESOLVABLE} the proxy still saw ${withExemption.length} request(s); ` +
      'an exemption that changes nothing is not an exemption',
  );
});
