// Outbound calls honour HTTP_PROXY / HTTPS_PROXY / NO_PROXY — Wave N12 phase
// W6 (#468), anchor #470. Grown from the red instrument the ORCH put on a
// runner before the phase was issued (run 35347775726, attempt 1, head
// 44435dff — three subtests, three messages, all failing).
//
// WHY THE TARGET IS `.invalid` AND NOT LOOPBACK. The seat ruled that
// `NO_PROXY` covers loopback by default, so a local signing stub (#445) and a
// local MCP server stay direct. A red that asserted "a loopback request is
// observed at the proxy" could therefore never be turned green by a correct
// implementation — the converse of a criterion that cannot fail, and just as
// useless. So the *destination* is a reserved `.invalid` name, which nothing
// resolves, while the *proxy* is on loopback. `NO_PROXY` applies to the
// destination, not to the proxy, so a loopback default cannot exempt it.
//
// That choice is also what makes "and not on the direct path" airtight rather
// than asserted: `.invalid` is reserved by RFC 6761 and resolves nowhere, so a
// request that did not go through the proxy did not go anywhere. There is no
// direct path to observe because there is no direct path.
//
// WHY THE PROXY HANDLES `CONNECT`. Measured at undici 6.28.0:
// `EnvHttpProxyAgent` tunnels with `CONNECT host:80` even for an `http://`
// target, and sends NO absolute-form request. A proxy built only from
// `http.createServer` therefore records nothing however correct the
// implementation is — a red no fix could turn green. This one counts a request
// observed in EITHER form, so it does not prescribe which the dispatcher uses.
//
// EVERY REQUEST IS DRIVEN THROUGH REAL APPLICATION CODE — the signing leg, the
// model client, the MCP client, the object-store S3 driver and the
// blob-reference read verification makes — never through a bare `fetch`, so
// this measures the app's outbound path rather than the runtime's.
//
// THE DISPATCHER MODULE IS DISCOVERED, NOT PRESCRIBED: the scan looks for
// `setGlobalDispatcher` across tracked sources, so the file may be named
// anything, but it must be TRACKED, because the universe comes from
// `git ls-files` (the same universe the derived env guard uses).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';

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
 *
 * The tunnelled origin answers 200 with an empty JSON body. No client under
 * test needs that body to be meaningful — each one is asked only whether its
 * request reached the proxy — and every one of them tolerates a 200 it cannot
 * use by throwing, which the drivers below catch.
 */
async function loopbackProxy() {
  const seen = [];
  const origin = http.createServer((_q, s) => {
    s.writeHead(200, { 'content-type': 'application/json', 'content-length': '2' });
    s.end('{}');
  });
  await new Promise((r) => origin.listen(0, '127.0.0.1', r));
  const originPort = origin.address().port;

  const server = http.createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '2' });
    res.end('{}');
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

/**
 * A plain loopback ORIGIN — the direct path. Records the request line and the
 * `host` header of everything that arrives, which is what "the request URL and
 * host equal today's" is read off.
 */
async function loopbackOrigin() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, host: req.headers.host });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '2' });
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { seen, port, base: `http://127.0.0.1:${port}`, close: () => server.close() };
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

/**
 * Re-evaluate every dispatcher installer under the environment currently in
 * force. Cache-busting is load-bearing: an installer that reads the
 * environment at module evaluation would otherwise keep the FIRST drive's
 * dispatcher for every later one, and a suite of eight drives would be
 * measuring one installation eight times.
 */
async function installUnderCurrentEnv() {
  const installers = dispatcherInstaller();
  assert.ok(
    installers.length > 0,
    'no tracked file in this repository installs a global fetch dispatcher (no `setGlobalDispatcher` ' +
      'anywhere), so nothing can honour HTTP_PROXY / HTTPS_PROXY / NO_PROXY — this runtime\'s built-in ' +
      'fetch ignores them, measured at node v22',
  );
  for (const p of installers) await import(`../${p}?probe=${Date.now()}-${Math.random()}`);
}

/**
 * Run one drive: set the environment, install under it, count `fetch` calls,
 * and put the process's global dispatcher back afterwards so no test inherits
 * another's proxy.
 */
async function drive(envValues, body) {
  const savedDispatcher = getGlobalDispatcher();
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (...args) => { fetchCalls += 1; return realFetch(...args); };
  try {
    return await withEnv(envValues, async () => {
      await installUnderCurrentEnv();
      const value = await body();
      return { value, fetchCalls: fetchCalls };
    });
  } finally {
    globalThis.fetch = realFetch;
    setGlobalDispatcher(savedDispatcher);
  }
}

/** Fresh module instance — the MCP registry and any other module-evaluation
 *  env read must be re-taken per drive for the same reason installers are. */
function fresh(path) {
  return import(`../${path}?probe=${Date.now()}-${Math.random()}`);
}

const swallow = async (fn) => { try { await fn(); } catch { /* the destination is unreachable by design */ } };

// --- the four outbound kinds, each driven through its own application code ---

/** Signing service: `getRfc3161Timestamp` POSTs to TIMESTAMP_AUTHORITY_URL. */
async function driveSigning() {
  const { getRfc3161Timestamp } = await fresh('src/lib/evidence/signing.ts');
  await swallow(() => getRfc3161Timestamp(SAMPLE_HASH));
}

/** Model endpoint: the `openai` SDK client this app builds. */
async function driveModel() {
  const { createModelClient } = await fresh('src/lib/model-client.ts');
  const client = createModelClient({ apiKey: 'probe-not-a-real-key' });
  await swallow(() =>
    client.chat.completions.create({ model: 'probe/model', messages: [{ role: 'user', content: 'probe' }] }),
  );
}

/** MCP server: `callMcpTool` initializes the session against the registry's
 *  endpoint, which is the first request any tool call makes. */
async function driveMcp() {
  const mcp = await fresh('src/lib/mcp/client.ts');
  await swallow(() => mcp.callMcpTool('get_data', { portal: 'probe', dataset_id: 'probe' }));
}

/**
 * Object store, `BLOB_DRIVER=s3` — the driver whose SDK does NOT use `fetch`
 * and is therefore the one a global dispatcher cannot reach on its own. The
 * config is passed in rather than read from the environment so this drive
 * needs no storage credential of any kind; the two key fields below are
 * literal placeholders and authenticate against nothing.
 */
async function driveS3(endpoint) {
  const { createS3Driver } = await fresh('src/lib/storage/s3.ts');
  const driver = createS3Driver({
    endpoint,
    region: 'us-east-1',
    bucket: 'probe-bucket',
    accessKeyId: 'probe',
    secretAccessKey: 'probe',
    forcePathStyle: true,
    publicBaseUrl: `${endpoint}/probe-bucket`,
  });
  await swallow(() => driver.put('probe/object.json', '{}', { contentType: 'application/json' }));
}

/**
 * Verification's own object-store read — the fourth kind, and the one the
 * ORCH's pre-measurement did not carry. A package may store a field BY
 * REFERENCE, and resolving that reference is a network call to this instance's
 * own object store made by `@typedstandards/verify-core` rather than by the
 * storage driver.
 */
async function driveBlobRefRead(base) {
  const { fetchBlobRefText } = await fresh('src/lib/evidence/blob-ref.ts');
  await swallow(() =>
    fetchBlobRefText({
      ref: `blob:sha256:${SAMPLE_HASH}`,
      url: `${base}/records/probe.json`,
      contentType: 'application/json',
      size: 2,
    }),
  );
}

const proxyEnv = (port) => ({
  HTTP_PROXY: `http://127.0.0.1:${port}`,
  http_proxy: `http://127.0.0.1:${port}`,
  NO_PROXY: null,
  no_proxy: null,
});

const noProxyEnv = { HTTP_PROXY: null, http_proxy: null, HTTPS_PROXY: null, https_proxy: null, NO_PROXY: null, no_proxy: null };

// --- 1. the declaration ------------------------------------------------------

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

// --- 2. one dispatcher, installed once --------------------------------------

test('exactly one tracked module installs a global dispatcher, and installing is idempotent', async () => {
  const installers = dispatcherInstaller();
  assert.deepEqual(
    installers.length,
    1,
    `${installers.length} tracked file(s) call setGlobalDispatcher (${installers.join(', ')}); the ` +
      'contract is ONE dispatcher, and two modules installing one means the second silently replaces ' +
      "the first's routing",
  );

  const proxy = await loopbackProxy();
  const savedDispatcher = getGlobalDispatcher();
  try {
    await withEnv(proxyEnv(proxy.port), async () => {
      const mod = await import(`../${installers[0]}?once=${Date.now()}`);
      // Module evaluation already installed it; a second call must not build
      // a second agent.
      const before = getGlobalDispatcher();
      const again = mod.installOutboundProxyDispatcher();
      assert.equal(again.installed, false, 'a repeat install reported installing a second dispatcher');
      assert.equal(
        getGlobalDispatcher(),
        before,
        'a repeat install replaced the global dispatcher; "installed once" means the same object stays in place',
      );
    });
  } finally {
    setGlobalDispatcher(savedDispatcher);
    proxy.close();
  }
});

// --- 3. one call of each kind, observed at the proxy -------------------------

const KINDS = [
  {
    name: 'a signing-service request',
    env: (target) => ({ TIMESTAMP_AUTHORITY_URL: target }),
    run: () => driveSigning(),
  },
  {
    name: 'a model-endpoint request',
    env: (target) => ({ MODEL_API_BASE_URL: target, MODEL_API_KIND: null, MODEL_CATALOG: null, MODEL_CATALOG_PATH: null }),
    run: () => driveModel(),
  },
  {
    name: 'an MCP tool call',
    env: (target) => ({ SOCRATA_MCP_URL: target }),
    run: () => driveMcp(),
  },
  {
    name: 'an object-store operation on the S3 driver',
    env: () => ({}),
    run: (target) => driveS3(target.replace(/\/[^/]*$/, '')),
    // The point of this row: the SDK's default transport is node:http(s), so a
    // request that reached the proxy is also proof the fetch transport was
    // taken. Asserted directly as well, so a regression names the cause.
    expectFetchCalls: true,
  },
  {
    name: "verification's read of a blob-referenced field",
    env: () => ({}),
    run: (target) => driveBlobRefRead(target.replace(/\/[^/]*$/, '')),
  },
];

for (const kind of KINDS) {
  test(`${kind.name} is observed at the proxy and never resolves the destination`, async () => {
    const proxy = await loopbackProxy();
    let fetchCalls;
    try {
      ({ fetchCalls } = await drive({ ...proxyEnv(proxy.port), ...kind.env(TARGET) }, () => kind.run(TARGET)));
    } finally {
      proxy.close();
    }
    if (kind.expectFetchCalls) {
      assert.ok(
        fetchCalls >= 1,
        `${kind.name} made ${fetchCalls} fetch call(s) with a proxy configured; the global dispatcher ` +
          'governs fetch and nothing else, so a kind that leaves through node:http(s) cannot be proxied ' +
          'by it however correct the dispatcher is',
      );
    }
    assert.ok(
      proxy.seen.length >= 1,
      `the proxy saw ${proxy.seen.length} request(s); with HTTP_PROXY set, ${kind.name} must arrive ` +
        'there. The destination is a reserved .invalid name, so a request that did NOT go through the ' +
        'proxy died in DNS and went nowhere — there is no direct path it could have taken instead',
    );
    for (const observed of proxy.seen) {
      assert.ok(
        observed.includes(UNRESOLVABLE),
        `the proxy received "${observed}", which does not name the destination — whether it arrives as ` +
          'an absolute-form URL or as a CONNECT authority, the destination is what the proxy is told',
      );
    }
  });
}

// --- 4. the S3 driver's transport swap, which is what makes kind 4 possible --

test('the S3 driver takes the fetch transport only when a proxy is configured', async () => {
  const { proxyAwareTransport } = await fresh('src/lib/storage/s3.ts');

  await withEnv(noProxyEnv, () => {
    assert.deepEqual(
      Object.keys(proxyAwareTransport()),
      [],
      'with no proxy configured the S3 client must carry no requestHandler override at all — the ' +
        "SDK's default node:http(s) transport is what this driver has always used",
    );
  });

  await withEnv({ HTTP_PROXY: 'http://127.0.0.1:1', http_proxy: 'http://127.0.0.1:1' }, () => {
    const handler = proxyAwareTransport().requestHandler;
    assert.ok(handler, 'with a proxy configured the S3 client must be given a requestHandler');
    assert.ok(
      handler instanceof FetchHttpHandler,
      `the handler is a ${handler?.constructor?.name}, not the SDK's fetch transport, so the S3 ` +
        "driver's requests still leave through node:http(s), which no global fetch dispatcher governs",
    );
  });
});

test('the S3 driver makes no fetch call at all with the proxy variables unset', async () => {
  const origin = await loopbackOrigin();
  try {
    const { fetchCalls } = await drive(noProxyEnv, () => driveS3(origin.base));
    assert.equal(
      fetchCalls,
      0,
      `the S3 driver made ${fetchCalls} fetch call(s) with no proxy configured; unset must leave this ` +
        "driver on the SDK's node:http(s) transport, byte for byte the path it took before #468",
    );
    assert.ok(
      origin.seen.length >= 1,
      'the S3 request never reached the origin, so the default path is broken rather than unchanged',
    );
    assert.equal(origin.seen[0].method, 'PUT');
    // `?x-id=PutObject` is the SDK's own operation marker and is part of the
    // request this driver has always made; pinned here rather than trimmed,
    // because the claim is byte-for-byte sameness and not approximate sameness.
    assert.equal(origin.seen[0].url, '/probe-bucket/probe/object.json?x-id=PutObject');
    assert.equal(origin.seen[0].host, `127.0.0.1:${origin.port}`);
  } finally {
    origin.close();
  }
});

// --- 5. NO_PROXY --------------------------------------------------------------

test('NO_PROXY exempts a named host, and its absence does not', async () => {
  const unexempted = await loopbackProxy();
  try {
    await drive({ ...proxyEnv(unexempted.port), TIMESTAMP_AUTHORITY_URL: TARGET }, () => driveSigning());
  } finally {
    unexempted.close();
  }
  assert.equal(unexempted.seen.length, 1, 'baseline: unexempted, the call goes through the proxy');

  const exempted = await loopbackProxy();
  try {
    await drive(
      {
        ...proxyEnv(exempted.port),
        NO_PROXY: UNRESOLVABLE,
        no_proxy: UNRESOLVABLE,
        TIMESTAMP_AUTHORITY_URL: TARGET,
      },
      () => driveSigning(),
    );
  } finally {
    exempted.close();
  }
  assert.equal(
    exempted.seen.length,
    0,
    `with NO_PROXY naming ${UNRESOLVABLE} the proxy still saw ${exempted.seen.length} request(s); ` +
      'an exemption that changes nothing is not an exemption',
  );
});

test('NO_PROXY=* still means never proxy, even with the loopback defaults prepended', async () => {
  // THE HAZARD THIS PINS. undici short-circuits on `noProxy === '*'`, and this
  // module PREPENDS the loopback defaults, so the composed string is never
  // exactly '*' and that short-circuit never fires. The wildcard survives only
  // because undici's per-entry branch treats a leading `*` as a suffix match
  // against the empty string. That is a property of how the list is composed,
  // so composing it differently could silently turn an operator's "never
  // proxy" into "always proxy" — measured here rather than reasoned about.
  const proxy = await loopbackProxy();
  try {
    await drive(
      { ...proxyEnv(proxy.port), NO_PROXY: '*', no_proxy: '*', TIMESTAMP_AUTHORITY_URL: TARGET },
      () => driveSigning(),
    );
  } finally {
    proxy.close();
  }
  assert.equal(
    proxy.seen.length,
    0,
    `with NO_PROXY='*' the proxy saw ${proxy.seen.length} request(s); the wildcard means "never ` +
      'proxy", and prepending the loopback defaults must not cost an operator that',
  );
});

test('loopback is exempt by default, so a local stub or MCP server stays direct', async () => {
  // THE BASELINE IS INSIDE THIS TEST ON PURPOSE. "The proxy saw nothing" is
  // also true when no dispatcher is installed at all, so the exemption half
  // alone is a criterion that cannot fail. The first drive proves the same
  // environment DOES proxy a non-loopback destination; only then does the
  // second drive's silence mean an exemption.
  const baselineProxy = await loopbackProxy();
  try {
    await drive(
      { ...proxyEnv(baselineProxy.port), TIMESTAMP_AUTHORITY_URL: TARGET },
      () => driveSigning(),
    );
  } finally {
    baselineProxy.close();
  }
  assert.equal(
    baselineProxy.seen.length,
    1,
    'baseline: under this environment a NON-loopback destination must reach the proxy, or the ' +
      'loopback result below says nothing about an exemption',
  );

  const proxy = await loopbackProxy();
  const origin = await loopbackOrigin();
  try {
    await drive(
      { ...proxyEnv(proxy.port), TIMESTAMP_AUTHORITY_URL: `${origin.base}/tsr` },
      () => driveSigning(),
    );
  } finally {
    proxy.close();
    origin.close();
  }
  assert.equal(
    proxy.seen.length,
    0,
    `a loopback destination reached the proxy (${proxy.seen.join(', ')}); the seat's rider is that ` +
      "loopback is exempt by default so #445's stub and a local MCP server are untouched by a proxy",
  );
  assert.equal(
    origin.seen.length,
    1,
    `the loopback origin saw ${origin.seen.length} request(s); the exemption must leave the call ` +
      'working, not merely keep it away from the proxy',
  );
  assert.equal(origin.seen[0].method, 'POST');
  assert.equal(origin.seen[0].url, '/tsr');
  assert.equal(origin.seen[0].host, `127.0.0.1:${origin.port}`);
});

// --- 6. defaults off ---------------------------------------------------------

test('with the three variables unset nothing is installed and the dispatcher is untouched', async () => {
  const savedDispatcher = getGlobalDispatcher();
  try {
    await withEnv(noProxyEnv, async () => {
      const before = getGlobalDispatcher();
      const [installer] = dispatcherInstaller();
      const mod = await import(`../${installer}?off=${Date.now()}`);
      assert.equal(
        getGlobalDispatcher(),
        before,
        'importing the dispatcher module replaced the global dispatcher with every proxy variable ' +
          'unset; defaults-off means the process keeps exactly the dispatcher Node gave it',
      );
      const result = mod.installOutboundProxyDispatcher();
      assert.equal(result.installed, false, 'a dispatcher was installed with no proxy configured');
      assert.deepEqual(result.honoured, [], 'a variable was reported honoured with none set');
      assert.equal(getGlobalDispatcher(), before, 'an explicit install call replaced the dispatcher anyway');
    });
  } finally {
    setGlobalDispatcher(savedDispatcher);
  }
});

test('with the three variables unset every kind reaches its destination directly, unchanged', async () => {
  const cases = [
    { name: 'signing service', run: () => driveSigning(), env: (o) => ({ TIMESTAMP_AUTHORITY_URL: `${o.base}/tsr` }), method: 'POST', url: '/tsr' },
    { name: 'model endpoint', run: () => driveModel(), env: (o) => ({ MODEL_API_BASE_URL: `${o.base}/v1`, MODEL_API_KIND: null }), method: 'POST', url: '/v1/chat/completions' },
    { name: 'MCP server', run: () => driveMcp(), env: (o) => ({ SOCRATA_MCP_URL: `${o.base}/mcp` }), method: 'POST', url: '/mcp' },
    { name: "verification's blob-reference read", run: (o) => driveBlobRefRead(o.base), env: () => ({}), method: 'GET', url: '/records/probe.json' },
  ];

  for (const c of cases) {
    const proxy = await loopbackProxy();
    const origin = await loopbackOrigin();
    try {
      await drive({ ...noProxyEnv, ...c.env(origin) }, () => c.run(origin));
    } finally {
      proxy.close();
      origin.close();
    }
    assert.ok(
      origin.seen.length >= 1,
      `${c.name}: nothing arrived at the origin with the proxy variables unset`,
    );
    assert.equal(origin.seen[0].method, c.method, `${c.name}: method changed`);
    assert.equal(origin.seen[0].url, c.url, `${c.name}: request path changed`);
    assert.equal(
      origin.seen[0].host,
      `127.0.0.1:${origin.port}`,
      `${c.name}: the host the request names changed`,
    );
    assert.equal(proxy.seen.length, 0, `${c.name}: a request reached a proxy that nothing configured`);
  }
});

// --- 7. the documented limitation, pinned ------------------------------------

test("the sign-in library's provider leg leaves through node:http(s), as docs/deploy.md says", async () => {
  // NOT A GAP THIS PHASE CLOSED — a measurement this phase made and wrote down.
  // next-auth's OAuth/OIDC leg runs through `openid-client`, which calls
  // `node:https` directly, so no global FETCH dispatcher can govern it. That is
  // stated in docs/deploy.md as a limitation an operator must plan around.
  // Pinned here so the statement goes RED rather than stale if the library ever
  // switches transport: at that point the row becomes "yes" and the paragraph
  // beside it has to go. Driven at the library, not through a full sign-in
  // cycle, because the transport is the library's and a request is all it takes
  // to read it.
  const { Issuer } = await import('openid-client');
  const counts = { fetch: 0, nodeHttp: 0 };
  const realFetch = globalThis.fetch;
  const realRequest = http.request;
  globalThis.fetch = (...a) => { counts.fetch += 1; return realFetch(...a); };
  http.request = function (...a) { counts.nodeHttp += 1; return realRequest.apply(this, a); };

  const origin = await loopbackOrigin();
  try {
    await swallow(() => Issuer.discover(origin.base));
  } finally {
    globalThis.fetch = realFetch;
    http.request = realRequest;
    origin.close();
  }

  assert.equal(origin.seen.length, 1, 'the probe never reached the origin, so it measured nothing');
  assert.equal(
    counts.fetch,
    0,
    `the sign-in library made ${counts.fetch} fetch call(s); if it now uses fetch, the global ` +
      'dispatcher DOES reach it and the "no" row in docs/deploy.md (sign-in provider) is wrong',
  );
  assert.ok(
    counts.nodeHttp >= 1,
    'the sign-in library made no node:http(s) request either, so neither half of the documented ' +
      'row is measured any more',
  );
});

test('docs/deploy.md names exactly the loopback hosts the dispatcher exempts', async () => {
  const [installer] = dispatcherInstaller();
  const { DEFAULT_NO_PROXY_HOSTS } = await import(`../${installer}?doc=${Date.now()}`);
  const doc = readFileSync(new URL('../docs/deploy.md', import.meta.url), 'utf8');
  const section = doc.slice(doc.indexOf('### Loopback is always exempt'));
  assert.ok(section.length > 0, 'docs/deploy.md has no loopback-exemption section to read');
  for (const host of DEFAULT_NO_PROXY_HOSTS) {
    assert.ok(
      section.includes(`\`${host}\``),
      `docs/deploy.md's loopback-exemption section does not name \`${host}\`, which the dispatcher ` +
        'exempts by default; an operator reading the document would not know it is exempt',
    );
  }
  assert.ok(
    /added\*\* to that set, not substituted/.test(section),
    'the section does not say that NO_PROXY is ADDED to the default set rather than replacing it — ' +
      'which is the property that keeps a local stub working when a proxy is turned on',
  );
});

// Cold read F1 (#470): notebook execution under the default driver leaves
// through the sandbox SDK's API client, which passes its own undici `Agent` as
// every request's `dispatcher`, so a global dispatcher cannot govern it. The
// table below the section's opening had a row for `container` only, and the
// opening said the app honours the proxy variables for every outbound call.
// The driver set is derived from `ExecutorDriverName`, not typed here.
const EXECUTOR_DRIVERS = (() => {
  const execute = readFileSync(new URL('../src/lib/sandbox/execute.ts', import.meta.url), 'utf8');
  const union = /export type ExecutorDriverName =([^;]+);/.exec(execute);
  return union ? [...union[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
})();

function egressProxySection() {
  const doc = readFileSync(new URL('../docs/deploy.md', import.meta.url), 'utf8');
  const start = doc.indexOf('## Outbound traffic through an egress proxy');
  assert.notEqual(start, -1, 'docs/deploy.md has no egress-proxy section to read');
  const end = doc.indexOf('\n## ', start + 1);
  return doc.slice(start, end === -1 ? undefined : end);
}

test('the executor driver set is derived from execute.ts, not empty', () => {
  assert.ok(
    EXECUTOR_DRIVERS.length >= 2,
    `derived ${EXECUTOR_DRIVERS.length} executor driver(s) from ExecutorDriverName; the rows below would check nothing`,
  );
});

for (const driver of EXECUTOR_DRIVERS) {
  test(`docs/deploy.md's proxy table has a row for EXECUTOR_DRIVER=${driver}`, () => {
    assert.match(
      egressProxySection(),
      new RegExp(`^\\| Notebook execution, \`EXECUTOR_DRIVER=${driver}\` \\|`, 'm'),
      `the proxy table has no row for EXECUTOR_DRIVER=${driver}, so an operator on a proxied ` +
        'network cannot tell whether notebook execution reaches its destination',
    );
  });
}

test('docs/deploy.md does not say the proxy variables govern every outbound call', () => {
  assert.doesNotMatch(
    egressProxySection().replace(/\s+/g, ' '),
    /honours them for every outbound call/,
    'the section still says the app honours the proxy variables for every outbound call, which ' +
      'its own "no" rows contradict',
  );
});
