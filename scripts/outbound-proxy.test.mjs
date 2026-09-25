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
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';

const UNRESOLVABLE = 'proxy-probe.invalid';

/**
 * The undici release `shouldProxyDestination` (`src/lib/outbound-proxy.ts`)
 * was ported from, line for line. See the test beside the NO_PROXY agreement
 * table for what changing this costs.
 */
const PORTED_FROM_UNDICI = '6.28.0';
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
 * The module that governs the SIGN-IN library's transport, discovered rather
 * than prescribed on the same terms: a global `fetch` dispatcher cannot reach
 * `node:http(s)`, so this path is governed at `openid-client`'s own seam
 * instead, and the file that reaches for that library is the one that does it.
 * No tracked source named `openid-client` before #483.
 */
function signInTransportInstaller() {
  return trackedSources().filter((p) => {
    let text;
    try { text = readFileSync(p, 'utf8'); } catch { return false; }
    return text.includes('openid-client');
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
  const headers = [];
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
    // Recorded beside the authority, so a test can ask what the tunnel
    // request carried and not only where it was pointed.
    headers.push(req.headers);
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
    headers,
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

  // The sign-in transport installer is re-evaluated on exactly the same terms
  // and for the same reason. Deliberately NOT asserted to exist: criterion 1
  // of #483 has to go red at the PROXY'S OWN COUNT, which is the measurement,
  // rather than at a precondition that would fail before anything was driven.
  for (const p of signInTransportInstaller()) {
    await import(`../${p}?probe=${Date.now()}-${Math.random()}`);
  }
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
 * The notebook executor's Lambda invoke, `EXECUTOR_DRIVER=lambda` (#530) —
 * like the S3 driver, an AWS SDK client whose default transport is
 * node:http(s). Driven through `executeNotebook`, so the client is the one the
 * driver builds; the SDK's own AWS_ENDPOINT_URL_LAMBDA points it at `endpoint`.
 * The two credential values are placeholders and authenticate against nothing.
 */
const LAMBDA_ENV = (endpoint) => ({
  EXECUTOR_DRIVER: 'lambda',
  EXECUTOR_LAMBDA_FUNCTION: 'probe-function',
  EXECUTOR_LAMBDA_REGION: 'us-east-1',
  AWS_ENDPOINT_URL_LAMBDA: endpoint,
  AWS_ACCESS_KEY_ID: 'probe',
  AWS_SECRET_ACCESS_KEY: 'probe',
  AWS_SESSION_TOKEN: null,
  AWS_PROFILE: null,
  AWS_CONFIG_FILE: '/nonexistent/aws-config',
  AWS_SHARED_CREDENTIALS_FILE: '/nonexistent/aws-credentials',
  AWS_EC2_METADATA_DISABLED: 'true',
});

async function driveLambda() {
  const { executeNotebook } = await fresh('src/lib/sandbox/execute.ts');
  await swallow(() => executeNotebook({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }));
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

/**
 * Rate-limit counter: `checkRateLimit` reads the KV store when
 * `KV_REST_API_URL` and `KV_REST_API_TOKEN` are both set. A failed read falls
 * back to memory, so the call returns either way; only the proxy's count says
 * where the request went.
 */
async function driveKv() {
  const { checkRateLimit } = await fresh('src/lib/rate-limit.ts');
  await swallow(() => checkRateLimit('proxy-probe', false));
}

/**
 * The sign-in provider leg (#483) — the kind that leaves through
 * `node:http(s)` and that no global `fetch` dispatcher can govern.
 *
 * TWO LEGS, ON PURPOSE. next-auth v4 builds its OAuth/OIDC client in
 * `next-auth/core/lib/oauth/client.js`, which for a `wellKnown` provider calls
 * `Issuer.discover(provider.wellKnown)` and then `new issuer.Client(...)`
 * (read as text and pinned by the test below, because that path is not
 * importable by specifier — next-auth's export map does not publish it). The
 * FIRST leg is discovery, reached through the Issuer class. The SECOND is the
 * token exchange, reached only through the client instance. They are separate
 * receivers in `openid-client`, so a fix that governed discovery alone would
 * pass on the first and fail on the second — which is the point of driving
 * both.
 *
 * THE PROVIDER CONFIG IS THIS REPOSITORY'S OWN. `buildProviders` supplies the
 * issuer, the discovery path and the client id, so the drive carries the URL
 * the app would really form rather than one hand-written here. The client
 * secret is a literal placeholder and authenticates against nothing.
 */
async function driveSignIn(base) {
  const { buildProviders } = await fresh('src/lib/auth-providers.ts');
  const [provider] = buildProviders({
    OIDC_ISSUER: base,
    OIDC_CLIENT_ID: 'probe',
    OIDC_CLIENT_SECRET: 'probe-not-a-real-secret',
  });
  const { Issuer } = await import('openid-client');

  // Leg 1 — discovery, exactly the call next-auth makes for this provider.
  await swallow(() => Issuer.discover(provider.wellKnown));

  // Leg 2 — the token exchange. Built without waiting for discovery to
  // succeed: the destination is unreachable in the proxied drives by design,
  // so a client that could only exist after a successful discovery could
  // never be driven there at all.
  const issuer = new Issuer({
    issuer: provider.issuer,
    token_endpoint: `${provider.issuer}/token`,
    userinfo_endpoint: `${provider.issuer}/userinfo`,
  });
  const client = new issuer.Client({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    redirect_uris: ['http://localhost:3000/api/auth/callback/oidc'],
  });
  await swallow(() => client.grant({ grant_type: 'authorization_code', code: 'probe' }));
}

/** Whether `openid-client` carries a transport hook right now, at each of the
 *  three receivers its own `request` helper reads one from. */
async function signInTransportHooks() {
  const { Issuer, custom } = await import('openid-client');
  const clientClass = new Issuer({ issuer: 'https://hook-probe.invalid' }).Client;
  const baseClient = Object.getPrototypeOf(clientClass);
  return [
    ['the Issuer class (discovery)', Issuer[custom.http_options]],
    ['an Issuer instance (jwks)', Issuer.prototype[custom.http_options]],
    ['the client class (token, userinfo)', baseClient.prototype[custom.http_options]],
  ];
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
    // #530: the same shape as the S3 row, and the same proof — the SDK's
    // default transport is node:http(s), so a request that reached the proxy
    // is proof the driver took the fetch transport.
    name: 'a notebook invoke on the lambda executor driver',
    env: (target) => LAMBDA_ENV(target.replace(/\/[^/]*$/, '')),
    run: () => driveLambda(),
    expectFetchCalls: true,
  },
  {
    name: "verification's read of a blob-referenced field",
    env: () => ({}),
    run: (target) => driveBlobRefRead(target.replace(/\/[^/]*$/, '')),
  },
  {
    // Cold read F1 (c), #470: the rate-limit counter's store is reached
    // through `@vercel/kv`, whose client (`@upstash/redis`) calls the global
    // `fetch` with no dispatcher of its own, so it is a "yes" row and an
    // in-network store needs its name in NO_PROXY. Measured here rather than
    // read off the library. The token is a placeholder the proxy never checks.
    name: 'a rate-limit counter read on the KV store',
    env: (target) => ({ KV_REST_API_URL: target.replace(/\/[^/]*$/, ''), KV_REST_API_TOKEN: 'probe-not-a-real-token' }),
    run: () => driveKv(),
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

test('the lambda executor driver makes no fetch call at all with the proxy variables unset (#530)', async () => {
  const origin = await loopbackOrigin();
  try {
    const { fetchCalls } = await drive({ ...noProxyEnv, ...LAMBDA_ENV(origin.base) }, () => driveLambda());
    assert.equal(
      fetchCalls,
      0,
      `the lambda driver made ${fetchCalls} fetch call(s) with no proxy configured; unset must leave its ` +
        "client on the SDK's node:http(s) transport, with no dispatcher built",
    );
    assert.equal(origin.seen.length, 1, 'the invoke never reached the origin, so the default path is broken');
    assert.equal(origin.seen[0].method, 'POST');
    assert.equal(origin.seen[0].url, '/2015-03-31/functions/probe-function/invocations');
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

// --- 7. the sign-in provider leg (#483) --------------------------------------
//
// WAS A DOCUMENTED LIMITATION, IS NOW A KIND. W6 (#468) measured this leg
// leaving through `node:http(s)` — `{fetch: 0, nodeHttp: 1}` — and wrote the
// "no" row that #483 was filed against. A global `fetch` dispatcher cannot
// govern that transport, so this path is governed at `openid-client`'s own
// documented seam instead (`custom.http_options`, the per-URL hook its
// `request` helper reads off the receiver). The four tests below are #483's
// four acceptance criteria, in order.

// Criterion 1: observed AT THE PROXY, driven the way W6 drives its six kinds.
test('a sign-in provider request is observed at the proxy and never resolves the destination', async () => {
  const proxy = await loopbackProxy();
  const counts = { nodeHttp: 0 };
  const realRequest = http.request;
  const realSecureRequest = https.request;
  http.request = function (...a) { counts.nodeHttp += 1; return realRequest.apply(this, a); };
  https.request = function (...a) { counts.nodeHttp += 1; return realSecureRequest.apply(this, a); };

  let fetchCalls;
  try {
    ({ fetchCalls } = await drive(proxyEnv(proxy.port), () => driveSignIn(`http://${UNRESOLVABLE}`)));
  } finally {
    http.request = realRequest;
    https.request = realSecureRequest;
    proxy.close();
  }

  assert.ok(
    proxy.seen.length >= 2,
    `the proxy saw ${proxy.seen.length} request(s); with HTTP_PROXY set, BOTH the sign-in provider's ` +
      'discovery leg and its token leg must arrive there. The destination is a reserved .invalid ' +
      'name, so a request that did NOT go through the proxy died in DNS and went nowhere — there is ' +
      'no direct path it could have taken instead. Two, not one: discovery is reached through the ' +
      'Issuer class and the token exchange only through the client class, and they are separate ' +
      "receivers of `openid-client`'s transport hook",
  );
  for (const observed of proxy.seen) {
    assert.ok(
      observed.includes(UNRESOLVABLE),
      `the proxy received "${observed}", which does not name the destination — whether it arrives as ` +
        'an absolute-form URL or as a CONNECT authority, the destination is what the proxy is told',
    );
  }

  // The transport measurement W6 made, kept rather than deleted: this leg is
  // proxied BECAUSE the node:http(s) seam is governed, not because the global
  // fetch dispatcher reached it. If the library ever switches to `fetch` the
  // dispatcher governs it and the module doing this can go.
  assert.ok(
    counts.nodeHttp >= 1,
    'the sign-in library made no node:http(s) request; if it now uses `fetch`, the global dispatcher ' +
      'reaches it on its own and the sign-in transport module is dead weight',
  );
  assert.equal(
    fetchCalls,
    0,
    `the sign-in library made ${fetchCalls} fetch call(s); the same conclusion as above, from the ` +
      'other side',
  );
});

// Criterion 1, the app's own path: next-auth reaches this library, and reaches
// it at the receivers the hook is installed on. Read as TEXT because
// next-auth's export map does not publish `core/lib/oauth/client.js`, so it
// cannot be imported by specifier and a deep file-path import would pin this
// suite to a layout the package never promised.
test("next-auth's provider leg still goes through openid-client's Issuer and client", () => {
  const src = readFileSync(
    new URL('../node_modules/next-auth/core/lib/oauth/client.js', import.meta.url),
    'utf8',
  );
  assert.match(
    src,
    /require\("openid-client"\)|from ['"]openid-client['"]/,
    "next-auth no longer reaches for `openid-client`; the sign-in transport module governs a library " +
      'this application does not use any more',
  );
  assert.match(
    src,
    /Issuer\.discover/,
    "next-auth no longer calls `Issuer.discover` for a wellKnown provider, so the discovery leg the " +
      'drive above imitates is no longer the one it makes',
  );
  assert.match(
    src,
    /new issuer\.Client/,
    'next-auth no longer builds its client from the discovered issuer, so the token leg is reached ' +
      'through a receiver the hook may not cover',
  );
});

// Criterion 1, the protocol the table does not otherwise reach. An `https://`
// destination is the case the shape of this fix turns on: `openid-client`
// passes a full URL, which names no port, so Node fills the port in from the
// AGENT's `defaultPort` — and it reads that before it knows the protocol.
// A single agent serving both transports therefore dials 80 for an `https://`
// destination, measured. Nothing else in this suite drives an `https://`
// sign-in destination, so without this the whole hazard is unmeasured.
test('an https sign-in destination is tunnelled to 443, not to the http default', async () => {
  const proxy = await loopbackProxy();
  try {
    await drive(proxyEnv(proxy.port), () => driveSignIn(`https://${UNRESOLVABLE}`));
  } finally {
    proxy.close();
  }

  assert.ok(
    proxy.seen.length >= 1,
    `the proxy saw ${proxy.seen.length} request(s); an https sign-in destination must reach it too, ` +
      'and the table above drives only http ones',
  );
  assert.ok(
    proxy.seen.includes(`${UNRESOLVABLE}:443`),
    `the proxy was told ${JSON.stringify(proxy.seen)}; an https destination that names no port is ` +
      'on 443, and a request tunnelled to 80 instead would reach the wrong service on every real ' +
      "provider — the symptom of one agent serving both transports, since Node resolves an agent's " +
      'defaultPort before it knows the protocol',
  );
});

// A proxy address may carry a user and password, which docs/deploy.md tells an
// operator they may use. The sign-in path builds its own tunnel request rather
// than handing the address to a library, so the one thing that turns that
// sentence from true into false is whether the request carries the header —
// driven here rather than read off the implementation. The values below are
// literal placeholders this loopback proxy never checks.
test('a proxy address carrying a user and password reaches the tunnel as Proxy-Authorization', async () => {
  const proxy = await loopbackProxy();
  const address = `http://probe-user:probe-pass@127.0.0.1:${proxy.port}`;
  try {
    await drive(
      { HTTP_PROXY: address, http_proxy: address, NO_PROXY: null, no_proxy: null },
      () => driveSignIn(`http://${UNRESOLVABLE}`),
    );
  } finally {
    proxy.close();
  }

  assert.ok(proxy.seen.length >= 1, 'nothing reached the proxy, so the header below is unmeasured');
  assert.ok(
    proxy.headers.length >= 1,
    'the request reached the proxy but not as a CONNECT, so no tunnel request line was recorded and ' +
      'the loop below would assert over nothing',
  );
  const expected = `Basic ${Buffer.from('probe-user:probe-pass').toString('base64')}`;
  for (const headers of proxy.headers) {
    assert.equal(
      headers['proxy-authorization'],
      expected,
      "the tunnel request carried " +
        `${headers['proxy-authorization'] ? 'a different Proxy-Authorization' : 'no Proxy-Authorization'}; ` +
        'a proxy that asks for one would refuse every sign-in call on an instance whose address names ' +
        'a user, which the deploy guide says is supported',
    );
  }
});

// THE AGREEMENT TABLE BELOW IS A SAMPLE, NOT A PROOF, AND THIS IS WHAT SAYS SO.
//
// undici does not export the routing decision `EnvHttpProxyAgent` makes, and
// the sign-in leg leaves through `node:http(s)`, which no global `fetch`
// dispatcher reaches — so that path has to make the SAME decision, and
// `shouldProxyDestination` is a deliberate port of `#shouldProxy` and
// `#parseNoProxy` rather than a second opinion.
//
// The table that follows drives one destination down both paths and fails when
// they part. What it CANNOT do is fail for a branch it does not exercise: bump
// undici, change a branch the table misses, and the agreement stays green while
// the two paths have already parted — surfacing, much later, as one instance's
// sign-in reaching a proxy its operator exempted. So the bump has to announce
// itself, and re-running the table is not what answers it. Reading it against
// the new `#shouldProxy` is.
test('the undici release the NO_PROXY matcher was ported from is the one installed', () => {
  const installed = JSON.parse(
    readFileSync(new URL('../node_modules/undici/package.json', import.meta.url), 'utf8'),
  ).version;
  assert.equal(
    installed,
    PORTED_FROM_UNDICI,
    `undici is ${installed} and \`shouldProxyDestination\` was ported from ${PORTED_FROM_UNDICI}. ` +
      'This is not asking for a re-run. Open that version\'s ' +
      '`lib/dispatcher/env-http-proxy-agent.js`, read `#shouldProxy` and `#parseNoProxy` against ' +
      '`shouldProxyDestination` in src/lib/outbound-proxy.ts, add a case to the table below for ' +
      'any branch that moved, and only then update this constant — a green table over a sample ' +
      'that no longer covers the branch structure is the failure this guard exists to prevent',
  );
});

// Criterion 2: the exempt set is the SAME set, asserted as agreement between
// the two paths rather than separately on each. Two tests that pass on their
// own terms is how the paths drift.
const NO_PROXY_AGREEMENT_CASES = [
  { name: 'no NO_PROXY at all', noProxy: null, host: 'agree-a.invalid' },
  { name: 'an exact host match', noProxy: 'agree-b.invalid', host: 'agree-b.invalid' },
  { name: 'a host the list does not name', noProxy: 'elsewhere.invalid', host: 'agree-c.invalid' },
  { name: 'the wildcard', noProxy: '*', host: 'agree-d.invalid' },
  { name: 'a leading-dot suffix', noProxy: '.invalid', host: 'agree-e.invalid' },
  { name: 'a leading-star suffix', noProxy: '*.invalid', host: 'agree-f.invalid' },
  { name: 'a suffix that does not match', noProxy: '.example', host: 'agree-g.invalid' },
  { name: 'an entry whose port matches', noProxy: 'agree-h.invalid:80', host: 'agree-h.invalid' },
  { name: 'an entry whose port does not match', noProxy: 'agree-i.invalid:8443', host: 'agree-i.invalid' },
  { name: 'an upper-case entry against a lower-case host', noProxy: 'AGREE-J.INVALID', host: 'agree-j.invalid' },
  { name: 'several entries, one of which matches', noProxy: 'a.invalid,agree-k.invalid,b.invalid', host: 'agree-k.invalid' },
  { name: 'a loopback default while an operator list is set', noProxy: 'elsewhere.invalid', loopback: true },
];

/**
 * Did the FETCH path proxy this destination? Driven through the signing leg,
 * which is the kind W6 uses for every NO_PROXY question it asks. The proxy is
 * created HERE and its port is what the drive's environment names, so the
 * server whose count is read is the server the request was pointed at.
 */
async function fetchPathProxied(noProxy, base) {
  const proxy = await loopbackProxy();
  try {
    await drive(
      { ...proxyEnv(proxy.port), NO_PROXY: noProxy, no_proxy: noProxy, TIMESTAMP_AUTHORITY_URL: `${base}/tsr` },
      () => driveSigning(),
    );
  } finally {
    proxy.close();
  }
  return proxy.seen.length > 0;
}

/** Did the SIGN-IN path proxy the same destination, under the same NO_PROXY? */
async function signInPathProxied(noProxy, base) {
  const proxy = await loopbackProxy();
  try {
    await drive(
      { ...proxyEnv(proxy.port), NO_PROXY: noProxy, no_proxy: noProxy },
      () => driveSignIn(base),
    );
  } finally {
    proxy.close();
  }
  return proxy.seen.length > 0;
}

test('the sign-in path and the fetch path exempt exactly the same destinations', async () => {
  const agreed = [];
  for (const kase of NO_PROXY_AGREEMENT_CASES) {
    // A loopback case needs a destination that really is loopback, so it gets
    // a live origin; every other case names a reserved `.invalid` host, which
    // resolves nowhere whichever way the decision goes.
    const origin = kase.loopback ? await loopbackOrigin() : null;
    const base = origin ? origin.base : `http://${kase.host}`;
    try {
      const onFetch = await fetchPathProxied(kase.noProxy, base);
      const onSignIn = await signInPathProxied(kase.noProxy, base);
      assert.equal(
        onSignIn,
        onFetch,
        `NO_PROXY=${JSON.stringify(kase.noProxy)} against ${base} (${kase.name}): the fetch path ` +
          `${onFetch ? 'proxied' : 'exempted'} it and the sign-in path ${onSignIn ? 'proxied' : 'exempted'} ` +
          'it. #483 criterion 2 is that the two paths apply the SAME exempt set — DEFAULT_NO_PROXY_HOSTS ' +
          "plus the operator's entries, prepended the same way — so an operator configures one thing, " +
          'not two that agree by accident until an edge case parts them',
      );
      agreed.push({ name: kase.name, proxied: onFetch });
    } finally {
      origin?.close();
    }
  }

  // THE INSTRUMENT MUST BE ABLE TO FAIL BOTH WAYS. "The two paths agree" is
  // also true when neither path ever reaches a proxy (nothing installed) and
  // when neither is ever exempt (no NO_PROXY read at all). The table is only
  // an agreement test if it contains both outcomes.
  assert.ok(
    agreed.some((r) => r.proxied),
    'no case in the table proxied on either path, so "they agree" says only that both are dead',
  );
  assert.ok(
    agreed.some((r) => !r.proxied),
    'every case in the table proxied on both paths, so no exemption was exercised and "they agree" ' +
      'says nothing about the exempt set',
  );
});

// Criterion 3: unset changes nothing — same transport, same host, same path,
// and the library is left exactly as it was found.
test('with the three variables unset the sign-in leg is untouched', async () => {
  const proxy = await loopbackProxy();
  const origin = await loopbackOrigin();
  let fetchCalls;
  try {
    ({ fetchCalls } = await drive(noProxyEnv, () => driveSignIn(origin.base)));
  } finally {
    proxy.close();
    origin.close();
  }

  assert.ok(
    origin.seen.length >= 1,
    'nothing arrived at the origin with the proxy variables unset, so the default sign-in path is ' +
      'broken rather than unchanged',
  );
  assert.equal(origin.seen[0].method, 'GET', 'the discovery request method changed');
  assert.equal(
    origin.seen[0].url,
    '/.well-known/openid-configuration',
    'the discovery request path changed',
  );
  assert.equal(
    origin.seen[0].host,
    `127.0.0.1:${origin.port}`,
    'the host the discovery request names changed',
  );
  assert.equal(fetchCalls, 0, 'the sign-in leg changed transport with no proxy configured');
  assert.equal(proxy.seen.length, 0, 'a sign-in request reached a proxy that nothing configured');

  for (const [where, hook] of await signInTransportHooks()) {
    assert.equal(
      hook,
      undefined,
      `${where} carries a transport hook with every proxy variable unset; defaults-off means the ` +
        'sign-in library is left exactly as the runtime gave it, not merely routed to the same place',
    );
  }
});

// Criterion 4: the row and the paragraph move together with the measurement.
test("docs/deploy.md's sign-in row says the proxy variables are honoured", () => {
  const section = egressProxySection();
  const row = /^\| Sign-in provider[^|]*\|[^|]*\|([^|]*)\|/m.exec(section);
  assert.ok(row, 'docs/deploy.md has no sign-in provider row in the proxy table');
  assert.doesNotMatch(
    row[1],
    /\bno\b/,
    `the sign-in provider row still reads "${row[1].trim()}"; #483 made that leg honour the three ` +
      'variables, so the row is a "yes" and an operator reading the table would otherwise still be ' +
      "told to put the provider's hosts on the network allowlist instead",
  );
  assert.match(row[1], /\byes\b/, `the sign-in provider row reads "${row[1].trim()}", not "yes"`);
});

test("docs/deploy.md no longer states the sign-in limitation it stated before #483", () => {
  const section = egressProxySection();
  assert.doesNotMatch(
    section.replace(/\s+/g, ' '),
    /The sign-in row is a real limitation/,
    'the paragraph calling the sign-in row a real limitation is still in the deploy guide, beside a ' +
      'row that now says the opposite',
  );
  assert.doesNotMatch(
    section.replace(/\s+/g, ' '),
    /sign-in configured against an external provider will not reach that provider/,
    'the deploy guide still tells an operator that sign-in cannot reach an external provider through ' +
      'these variables, which #483 made untrue',
  );
});

import { createRequire } from 'node:module';
import { EnvHttpProxyAgent } from 'undici';

// --- 8. the sandbox executor's API calls (#492) ------------------------------
//
// WAS A DOCUMENTED LIMITATION, IS NOW A KIND — the same arc as the sign-in leg
// above. Cold read F1 (#470) measured that `@vercel/sandbox` passes its own
// undici `Agent` (built with `bodyTimeout: 0`) as the `dispatcher` of every
// API request, which overrides the global one, and WF (#488) pinned the "no"
// row here. #492 routes those calls at the SDK's own `fetch` seam: with a
// proxy configured the driver hands `Sandbox.create` a `fetch` that swaps the
// SDK's agent for a proxy-aware dispatcher built by `createProxyDispatcher`.
//
// EVERY DRIVE BELOW IS OFFLINE. The lifecycle drives run the REAL driver
// (`createVercelSandboxDriver`) against the INSTALLED SDK with
// `globalThis.fetch` replaced by a recorder that answers each API route with a
// canned response the SDK's own validators accept, so each request's init —
// and with it the dispatcher it would have used — is read at the point it
// would have left the process. The credential triple is a placeholder no
// request forwards anywhere. The one drive that issues a real request sends it
// to a loopback proxy that records the CONNECT and refuses it, so nothing
// leaves the machine; it is interlocked so it will not run unless the fetch
// under test has first been shown to carry a proxy-aware dispatcher whose
// routing sends that host to the proxy.

/** The SDK's own nested undici (7.29.0 at 1.10.2), resolved the way the SDK
 *  resolves it — so "the SDK's agent" is identified by class, not by name. */
const SdkUndici = createRequire(new URL('../node_modules/@vercel/sandbox/package.json', import.meta.url))('undici');

const SANDBOX_PLACEHOLDER_AUTH = {
  VERCEL_TOKEN: 'probe-not-a-real-token',
  VERCEL_TEAM_ID: 'team_probe',
  VERCEL_PROJECT_ID: 'prj_probe',
  VERCEL_OIDC_TOKEN: null,
};
const SANDBOX_NO_AUTH = { VERCEL_TOKEN: null, VERCEL_TEAM_ID: null, VERCEL_PROJECT_ID: null, VERCEL_OIDC_TOKEN: null };

const SANDBOX_ID = 'sbx_probe';
const sandboxJson = (status) => ({
  id: SANDBOX_ID, memory: 2048, vcpus: 1, region: 'iad1', runtime: 'python3.13', timeout: 60000,
  status, requestedAt: 0, createdAt: 0, cwd: '/vercel/sandbox', updatedAt: 0,
});
const commandJson = (exitCode) => ({
  id: 'cmd_probe', name: 'python3', args: ['--version'], cwd: '/vercel/sandbox',
  sandboxId: SANDBOX_ID, exitCode, startedAt: 0,
});
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const ndjson = (lines) =>
  new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });

/** One canned answer per API route the driver's lifecycle reaches. An
 *  unrouted request is answered 400 and recorded, so a new route shows up in
 *  the record rather than hanging the drive. */
function cannedSandboxApi(method, pathname) {
  const base = `/api/v1/sandboxes`;
  if (method === 'POST' && pathname === base) return json({ sandbox: sandboxJson('running'), routes: [] });
  if (method === 'POST' && pathname === `${base}/${SANDBOX_ID}/cmd`) {
    return ndjson([{ command: commandJson(null) }, { command: commandJson(0) }]);
  }
  if (method === 'GET' && pathname === `${base}/${SANDBOX_ID}/cmd/cmd_probe/logs`) {
    return ndjson([{ stream: 'stdout', data: 'Python 3.13.0\n' }]);
  }
  if (method === 'POST' && pathname === `${base}/${SANDBOX_ID}/fs/write`) return json({});
  if (method === 'POST' && pathname === `${base}/${SANDBOX_ID}/fs/read`) {
    return new Response('probe-bytes', { status: 200, headers: { 'content-type': 'application/octet-stream' } });
  }
  if (method === 'POST' && pathname === `${base}/${SANDBOX_ID}/stop`) return json({ sandbox: sandboxJson('stopped') });
  return new Response(JSON.stringify({ error: { code: 'probe', message: 'unrouted' } }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

/** Name the dispatcher a request carried, in the terms the assertions use. */
function describeDispatcher(dispatcher, proxyAware) {
  if (dispatcher == null) return 'no dispatcher (the global one)';
  if (proxyAware && dispatcher === proxyAware) return "the driver's proxy-aware dispatcher";
  if (dispatcher instanceof SdkUndici.Agent) return "the SDK's own Agent (its nested undici)";
  if (dispatcher instanceof EnvHttpProxyAgent) return 'an EnvHttpProxyAgent the driver does not report having built';
  return `an unrecognised ${dispatcher?.constructor?.name}`;
}

const SANDBOX_STEPS = ['createSession', 'runCommand', 'writeFiles', 'readFileToBuffer', 'stop'];

/**
 * Drive the real driver through one whole session — create, run a command and
 * read its output, write a file, read it back, stop — with every API request
 * recorded at `globalThis.fetch` and answered from `cannedSandboxApi`. Returns
 * each request tagged with the step that issued it, the params the driver
 * handed `Sandbox.create`, and the dispatcher the driver reports having built.
 */
async function driveSandboxLifecycle(envValues) {
  const recorded = [];
  const createParams = [];
  let step = 'import';
  const { Sandbox } = await import('@vercel/sandbox');
  const realCreate = Sandbox.create;
  const realFetch = globalThis.fetch;
  const savedDispatcher = getGlobalDispatcher();
  try {
    return await withEnv(envValues, async () => {
      const mod = await fresh('src/lib/sandbox/vercel-sandbox.ts');
      Sandbox.create = function (params) {
        createParams.push(params);
        return realCreate.call(this, params);
      };
      globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        recorded.push({ step, method: init.method ?? 'GET', url: url.toString(), dispatcher: init.dispatcher });
        return cannedSandboxApi(init.method ?? 'GET', url.pathname);
      };

      const driver = mod.createVercelSandboxDriver();
      step = 'createSession';
      const session = await driver.createSession({ snapshotId: 'snap_probe', timeoutMs: 60000, env: {} });
      step = 'runCommand';
      const result = await session.runCommand({ cmd: 'python3', args: ['--version'] });
      const stdout = await result.stdout();
      step = 'writeFiles';
      await session.writeFiles([{ path: '/tmp/probe.txt', content: Buffer.from('probe') }]);
      step = 'readFileToBuffer';
      const read = await session.readFileToBuffer('/tmp/probe.txt');
      step = 'stop';
      await session.stop();
      step = 'done';

      return {
        recorded,
        createParams,
        stdout,
        read: read?.toString(),
        exitCode: result.exitCode,
        proxyAware: typeof mod.sandboxApiDispatcher === 'function' ? mod.sandboxApiDispatcher() : undefined,
      };
    });
  } finally {
    Sandbox.create = realCreate;
    globalThis.fetch = realFetch;
    setGlobalDispatcher(savedDispatcher);
  }
}

/** The drive must have measured something at every step, or its verdict on
 *  the dispatcher is a verdict on nothing. */
function assertEveryStepRecorded(drive) {
  assert.equal(drive.stdout, 'Python 3.13.0\n', 'the canned command output did not come back through the driver');
  assert.equal(drive.read, 'probe-bytes', 'the canned file did not come back through the driver');
  assert.equal(drive.exitCode, 0);
  for (const s of SANDBOX_STEPS) {
    const n = drive.recorded.filter((r) => r.step === s).length;
    assert.ok(
      n >= 1,
      `the ${s} step issued ${n} API request(s) through the seam; a step that recorded nothing says ` +
        'nothing about the dispatcher its requests would carry',
    );
  }
}

const sandboxProxyEnv = (port) => ({
  ...noProxyEnv,
  HTTP_PROXY: `http://127.0.0.1:${port}`,
  http_proxy: `http://127.0.0.1:${port}`,
  HTTPS_PROXY: `http://127.0.0.1:${port}`,
  https_proxy: `http://127.0.0.1:${port}`,
});

// #492 criterion 1: every request of every lifecycle step, through the seam.
test('with a proxy configured, every request of a sandbox lifecycle carries the proxy-aware dispatcher', async () => {
  const drive = await driveSandboxLifecycle({ ...sandboxProxyEnv(1), ...SANDBOX_PLACEHOLDER_AUTH });
  assertEveryStepRecorded(drive);

  for (const r of drive.recorded) {
    assert.ok(
      !(r.dispatcher instanceof SdkUndici.Agent),
      `${r.step}: ${r.method} ${r.url} carried ${describeDispatcher(r.dispatcher, drive.proxyAware)}; with a ` +
        "proxy configured the SDK's own agent overrides every global dispatcher, so this request would " +
        'never reach the proxy',
    );
    assert.ok(
      r.dispatcher instanceof EnvHttpProxyAgent,
      `${r.step}: ${r.method} ${r.url} carried ${describeDispatcher(r.dispatcher, drive.proxyAware)}, not a ` +
        "proxy-aware dispatcher from this repository's undici",
    );
  }
  assert.ok(drive.proxyAware, 'the driver reports having built no proxy-aware dispatcher under a proxy configuration');
  for (const r of drive.recorded) {
    assert.equal(
      r.dispatcher,
      drive.proxyAware,
      `${r.step}: ${r.method} ${r.url} carried a proxy-aware dispatcher other than the one the driver built`,
    );
  }
  assert.equal(drive.createParams.length, 1, 'the lifecycle made more than one Sandbox.create call');
  assert.equal(typeof drive.createParams[0].fetch, 'function', 'Sandbox.create was handed no fetch');
});

/** A loopback proxy that records each request it is asked to make — in either
 *  form — and refuses all of them, so a drive through it never leaves the
 *  machine. */
async function refusingProxy() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(403, { 'content-length': '0' });
    res.end();
  });
  server.on('connect', (req, socket) => {
    seen.push(req.url);
    socket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, port: server.address().port, close: () => server.close() };
}

// #492 criterion 2: that dispatcher reaches the proxy, and NO_PROXY holds.
test("the sandbox API's fetch reaches the proxy as CONNECT vercel.com:443, and NO_PROXY keeps an exempt host away", async () => {
  const proxy = await refusingProxy();
  const env = { ...sandboxProxyEnv(proxy.port), NO_PROXY: UNRESOLVABLE, no_proxy: UNRESOLVABLE, ...SANDBOX_NO_AUTH };
  const { Sandbox } = await import('@vercel/sandbox');
  const realCreate = Sandbox.create;
  const realFetch = globalThis.fetch;
  const savedDispatcher = getGlobalDispatcher();
  const handed = [];
  const outcomes = {};
  try {
    await withEnv(env, async () => {
      const mod = await fresh('src/lib/sandbox/vercel-sandbox.ts');
      const { resolveProxySettings, shouldProxyDestination } = await import('../src/lib/outbound-proxy.ts');
      // The fetch under test is the one the DRIVER hands the SDK, taken at
      // `Sandbox.create` and never passed on: no SDK request is made here.
      Sandbox.create = async (params) => {
        handed.push(params);
        throw new Error('probe: Sandbox.create captured, not called');
      };
      await swallow(() =>
        mod.createVercelSandboxDriver().createSession({ snapshotId: 'snap_probe', timeoutMs: 60000, env: {} }),
      );
      assert.equal(handed.length, 1, 'the driver made no Sandbox.create call to take the fetch from');
      const sandboxFetch = handed[0].fetch;
      assert.equal(
        typeof sandboxFetch,
        'function',
        'the driver handed Sandbox.create no fetch, so every sandbox API call keeps the SDK\'s own agent ' +
          'and never reaches the proxy',
      );

      // INTERLOCK. Before any real request: the fetch must swap in a
      // proxy-aware dispatcher, and that dispatcher's exempt set must send
      // vercel.com to the proxy. Otherwise the request below would go direct.
      const sdkAgent = new SdkUndici.Agent({ bodyTimeout: 0 });
      let swapped;
      globalThis.fetch = async (_input, init) => { swapped = init.dispatcher; return new Response('{}'); };
      await sandboxFetch('https://vercel.com/api/v1/sandboxes', { dispatcher: sdkAgent });
      globalThis.fetch = realFetch;
      assert.ok(
        swapped instanceof EnvHttpProxyAgent && swapped !== sdkAgent,
        `the sandbox fetch passed on ${describeDispatcher(swapped, null)}; refusing to issue a real request`,
      );
      assert.ok(shouldProxyDestination(new URL('https://vercel.com/api'), resolveProxySettings().noProxy));

      // The real requests. Each is refused (or dies in DNS, for the exempt
      // `.invalid` host), so each rejects; only the proxy's record matters.
      for (const [label, url] of [
        ['vercel', 'https://vercel.com/api/v1/sandboxes?teamId=team_probe'],
        ['exempt', `https://${UNRESOLVABLE}/api/v1/sandboxes`],
      ]) {
        try {
          await sandboxFetch(url, { method: 'GET', dispatcher: sdkAgent });
          outcomes[label] = 'resolved';
        } catch (err) {
          outcomes[label] = `rejected: ${err?.cause?.code ?? err?.cause?.message ?? err?.message}`;
        }
      }
      await sdkAgent.close();
    });
  } finally {
    Sandbox.create = realCreate;
    globalThis.fetch = realFetch;
    setGlobalDispatcher(savedDispatcher);
    proxy.close();
  }

  assert.deepEqual(
    proxy.seen,
    ['vercel.com:443'],
    `the proxy saw ${JSON.stringify(proxy.seen)} (outcomes ${JSON.stringify(outcomes)}); the sandbox API request ` +
      `must arrive as CONNECT vercel.com:443, and ${UNRESOLVABLE}, which NO_PROXY names, must not arrive at all`,
  );
  assert.match(outcomes.vercel, /^rejected/, 'the refused tunnel should have failed the request, not completed it');
});

/** Every undici dispatcher reachable from `root`: agents, their pools, and the
 *  clients that hold the connections. The proxy's own CONNECT client is left
 *  out — it carries only the tunnel request, whose response has no body; the
 *  tunnelled request's body is read by the client its agent builds, which is
 *  walked. */
function undiciDispatcherGraph(root) {
  const seen = new Set();
  const out = [];
  const visit = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v instanceof Map) { for (const x of v.values()) visit(x); return; }
    if (Array.isArray(v)) { for (const x of v) visit(x); return; }
    if (typeof v.dispatch !== 'function') return;
    out.push(v);
    for (const sym of Object.getOwnPropertySymbols(v)) {
      if (sym.description === 'proxy client') continue;
      visit(v[sym]);
    }
  };
  visit(root);
  return out;
}

const symbolValue = (obj, description) => {
  const sym = Object.getOwnPropertySymbols(obj).find((s) => s.description === description);
  return sym ? obj[sym] : undefined;
};

// #492 criterion 3: `bodyTimeout: 0` survives the replacement.
test("the sandbox API's proxy-aware dispatcher keeps the SDK's bodyTimeout: 0 on every connection it opens", async () => {
  const proxy = await loopbackProxy();
  const origin = await loopbackOrigin();
  const realFetch = globalThis.fetch;
  let dispatcher;
  let clients = [];
  let agentOptions = [];
  try {
    await withEnv(proxyEnv(proxy.port), async () => {
      const mod = await fresh('src/lib/sandbox/vercel-sandbox.ts');
      const { fetch: sandboxFetch } = mod.proxyAwareSandboxFetch();
      dispatcher = mod.sandboxApiDispatcher();
      // Both legs, for real, so the connections exist to be read: an exempt
      // (loopback) destination through the direct agent, and a proxied one
      // through the tunnel.
      await swallow(async () => (await sandboxFetch(`${origin.base}/direct`)).text());
      await swallow(async () => (await sandboxFetch(TARGET)).text());
      const graph = undiciDispatcherGraph(dispatcher);
      clients = graph.filter((d) => symbolValue(d, 'body timeout') !== undefined);
      agentOptions = graph.map((d) => symbolValue(d, 'options')).filter((o) => o && typeof o === 'object');
    });
  } finally {
    globalThis.fetch = realFetch;
    await dispatcher?.close?.();
    proxy.close();
    origin.close();
  }

  assert.ok(origin.seen.length >= 1 && proxy.seen.length >= 1, 'a leg never ran, so its connection cannot be read');
  assert.ok(
    clients.length >= 2,
    `found ${clients.length} connection client(s) under the dispatcher; the direct and the tunnelled leg each ` +
      'open one, and a count below two means a leg was not measured',
  );
  for (const c of clients) {
    assert.equal(
      symbolValue(c, 'body timeout'),
      0,
      `a connection under the sandbox API's dispatcher carries bodyTimeout ${symbolValue(c, 'body timeout')}; the ` +
        "SDK's own agent carries 0, and a long command-output stream would be cut off after that much silence",
    );
  }
  assert.ok(agentOptions.length >= 2, 'no agent options were found to read');
  for (const o of agentOptions) {
    assert.equal(o.bodyTimeout, 0, `an agent under the sandbox API's dispatcher is configured with bodyTimeout ${o.bodyTimeout}`);
  }
});

// #492 criterion 4: defaults unchanged, in both auth shapes.
test('with the three variables unset the sandbox SDK is called exactly as before and no dispatcher is built', async () => {
  const drive = await driveSandboxLifecycle({ ...noProxyEnv, ...SANDBOX_PLACEHOLDER_AUTH });
  assertEveryStepRecorded(drive);
  for (const r of drive.recorded) {
    assert.ok(
      r.dispatcher instanceof SdkUndici.Agent,
      `${r.step}: ${r.method} ${r.url} carried ${describeDispatcher(r.dispatcher, drive.proxyAware)} with no proxy ` +
        "configured; unset must leave every request on the SDK's own agent",
    );
  }
  assert.equal(drive.proxyAware ?? null, null, 'the driver built a proxy-aware dispatcher with no proxy configured');

  const expectedBase = {
    timeout: 60000,
    env: {
      SSL_CERT_FILE: '/etc/pki/tls/certs/ca-bundle.crt',
      REQUESTS_CA_BUNDLE: '/etc/pki/tls/certs/ca-bundle.crt',
      PIP_CERT: '/etc/pki/tls/certs/ca-bundle.crt',
    },
    source: { type: 'snapshot', snapshotId: 'snap_probe' },
  };
  const withTriple = { ...expectedBase, token: 'probe-not-a-real-token', teamId: 'team_probe', projectId: 'prj_probe' };
  assert.equal(drive.createParams.length, 1);
  assert.ok(!('fetch' in drive.createParams[0]), 'Sandbox.create received a fetch key with no proxy configured');
  assert.equal(JSON.stringify(drive.createParams[0]), JSON.stringify(withTriple), 'the triple-shape call changed');

  // The OIDC shape (no triple). Captured at Sandbox.create and not passed on:
  // with no triple the SDK would resolve OIDC credentials, which this suite
  // never reaches for.
  const { Sandbox } = await import('@vercel/sandbox');
  const realCreate = Sandbox.create;
  const handed = [];
  let proxyAware;
  try {
    await withEnv({ ...noProxyEnv, ...SANDBOX_NO_AUTH }, async () => {
      const mod = await fresh('src/lib/sandbox/vercel-sandbox.ts');
      Sandbox.create = async (params) => { handed.push(params); throw new Error('probe: captured'); };
      await swallow(() =>
        mod.createVercelSandboxDriver().createSession({ snapshotId: 'snap_probe', timeoutMs: 60000, env: {} }),
      );
      proxyAware = mod.sandboxApiDispatcher?.() ?? null;
    });
  } finally {
    Sandbox.create = realCreate;
  }
  assert.equal(handed.length, 1);
  assert.ok(!('fetch' in handed[0]), 'Sandbox.create received a fetch key with no proxy configured (OIDC shape)');
  assert.equal(JSON.stringify(handed[0]), JSON.stringify(expectedBase), 'the OIDC-shape call changed');
  assert.equal(proxyAware, null, 'the driver built a proxy-aware dispatcher with no proxy configured (OIDC shape)');
});

// #492 criterion 5: the row and the behaviour move together. Flipped from the
// WF (#488) pin, which held the "no" row to the SDK passing its own agent.
test("the sandbox executor's API calls honour the proxy variables exactly when docs/deploy.md's row says so", async () => {
  const drive = await driveSandboxLifecycle({ ...sandboxProxyEnv(1), ...SANDBOX_PLACEHOLDER_AUTH });
  assertEveryStepRecorded(drive);

  // The verdict is MEASURED, then compared with the row — so the row going
  // stale in either direction fails here, not only a regression in one.
  const honoured = drive.recorded.every((r) => r.dispatcher != null && r.dispatcher === drive.proxyAware);
  const row = /^\| Notebook execution, `EXECUTOR_DRIVER=vercel-sandbox` \|[^|]*\|([^|]*)\|$/m.exec(egressProxySection());
  assert.ok(row, 'docs/deploy.md has no EXECUTOR_DRIVER=vercel-sandbox row for this pin to hold');
  const rowSaysYes = /\byes\b/.test(row[1]) && !/\bno\b/.test(row[1]);
  assert.equal(
    rowSaysYes,
    honoured,
    `docs/deploy.md's EXECUTOR_DRIVER=vercel-sandbox row reads "${row[1].trim()}", but a driven lifecycle ` +
      `${honoured ? 'DOES' : 'does NOT'} carry the proxy-aware dispatcher on every request ` +
      `(${drive.recorded.map((r) => `${r.step}: ${describeDispatcher(r.dispatcher, drive.proxyAware)}`).join('; ')})`,
  );
  for (const { url } of drive.recorded) {
    const { hostname } = new URL(url);
    assert.ok(
      row[0].includes(hostname),
      `the SDK called ${hostname}, which the EXECUTOR_DRIVER=vercel-sandbox row in docs/deploy.md does not ` +
        'name; an operator allowlisting or exempting the documented host would miss this one',
    );
  }
  const prose = egressProxySection().replace(/\s+/g, ' ');
  assert.doesNotMatch(
    prose,
    /managed-sandbox executor row is a real limitation/,
    'the deploy guide still calls the managed-sandbox row a real limitation beside a row that now says yes',
  );
  assert.doesNotMatch(
    prose,
    /will not reach the sandbox API through these variables/,
    'the deploy guide still tells an operator that notebook execution cannot reach the sandbox API through ' +
      'these variables, which #492 made untrue',
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
