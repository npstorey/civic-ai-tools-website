// #554 — the S3 driver's credential source: the S3 key pair when it is set,
// the AWS SDK's default chain when neither key is set, and a refusal naming
// the missing key when only one is.
//
// WHAT IS DRIVEN. Each case builds the REAL driver (`createS3Driver`) from the
// REAL resolver (`resolveS3ConfigFromEnv`) and sends a real `PutObject` through
// the SDK to a loopback S3 stand-in, which records the request's SigV4
// `Credential=` access key id and its `x-amz-security-token` header. That is
// the signing identity the request actually carried — not a reading of the
// client's configuration — so the "default chain" case can only pass if the
// SDK resolved credentials from the chain, and the "key pair" case can only
// pass if the pair beat the chain.
//
// THE CHAIN IS ISOLATED IN EVERY TEST. The SDK's default chain reads the
// environment, the shared files under the home directory, SSO caches, process
// sources, web identity, and the container and instance metadata endpoints.
// `isolateChain()` points both shared files at empty files in a fresh temp
// directory, unsets every chain variable (the profile, the container and web
// identity settings, the AWS key variables), and sets
// `AWS_EC2_METADATA_DISABLED=true`. Only the variables a case sets itself can
// answer. The "neither source" case is the isolation's own check: if anything
// outside the test answered, that case would resolve credentials and fail.
//
// THE LOG LINE. Driver construction emits one line naming the source. The
// test captures every `console` method (rendered with `util.format`, as
// `console` itself renders) and every write to stdout and stderr, through
// construction and a signed request, with distinctive values planted in the
// S3 pair and in AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and
// AWS_SESSION_TOKEN, and asserts that none of them appears. Blind spot: a
// value logged later, by a path these tests do not run (a list, a delete, a
// grant), is not captured here.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/storage/s3-credential-source.test.ts)

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import type { AddressInfo } from 'node:net';
import { createS3Driver, resolveS3ConfigFromEnv, type S3DriverConfig } from './s3.ts';

// Distinctive, obviously fake values. None authenticates against anything.
const S3_PAIR = { id: 'canary-s3-pair-key-id', secret: 'canary-s3-pair-secret-value' };
const ENV_CHAIN = {
  id: 'canary-env-chain-key-id',
  secret: 'canary-env-chain-secret-value',
  token: 'canary-env-chain-session-token',
};
const CANARIES = [S3_PAIR.id, S3_PAIR.secret, ENV_CHAIN.id, ENV_CHAIN.secret, ENV_CHAIN.token];

/** Every variable the SDK's default chain (or its profile selection) reads. */
const CHAIN_VARS = [
  'AWS_PROFILE',
  'AWS_DEFAULT_PROFILE',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_CREDENTIAL_EXPIRATION',
  'AWS_CREDENTIAL_SCOPE',
  'AWS_ACCOUNT_ID',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_CONFIG_FILE',
  'AWS_SDK_LOAD_CONFIG',
  'AWS_EC2_METADATA_DISABLED',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_ROLE_ARN',
  'AWS_ROLE_SESSION_NAME',
];

const saved = new Map<string, string | undefined>();
let scratch: string | null = null;

/** Cut the default chain off from everything outside this test. */
function isolateChain(extra: Record<string, string> = {}): void {
  for (const name of CHAIN_VARS) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-s3-chain-'));
  const sharedFile = path.join(scratch, 'shared-keys');
  const configFile = path.join(scratch, 'config');
  fs.writeFileSync(sharedFile, '');
  fs.writeFileSync(configFile, '');
  process.env.AWS_SHARED_CREDENTIALS_FILE = sharedFile;
  process.env.AWS_CONFIG_FILE = configFile;
  process.env.AWS_EC2_METADATA_DISABLED = 'true';
  Object.assign(process.env, extra);
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

interface Seen { method: string; url: string; accessKeyId: string | null; securityToken: string | null }

/** A loopback S3 stand-in: accepts every request, records its signing identity. */
async function withLoopbackS3<T>(fn: (endpoint: string, seen: Seen[]) => Promise<T>): Promise<T> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? '';
    const token = req.headers['x-amz-security-token'];
    seen.push({
      method: req.method ?? '',
      url: req.url ?? '',
      accessKeyId: /Credential=([^/]+)\//.exec(auth)?.[1] ?? null,
      securityToken: typeof token === 'string' ? token : null,
    });
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { ETag: '"p3"', 'Content-Length': '0' });
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`, seen);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Resolve through the real resolver; a throw is an assertion failure, not an error. */
function resolveOrFail(env: Record<string, string | undefined>): S3DriverConfig {
  let cfg: S3DriverConfig | undefined;
  assert.doesNotThrow(() => {
    cfg = resolveS3ConfigFromEnv(env);
  });
  return cfg as S3DriverConfig;
}

const BASE = { S3_BUCKET: 'p3-bucket', S3_REGION: 'us-east-1' };

// --- Criterion 1: the three cases ---------------------------------------------

test('#554 both keys unset: the config resolves, carrying no key pair', () => {
  const cfg = resolveOrFail({ ...BASE });
  assert.equal(cfg.accessKeyId, undefined);
  assert.equal(cfg.secretAccessKey, undefined);
});

test('#554 both keys empty: treated as unset (an empty string is not a key)', () => {
  const cfg = resolveOrFail({ ...BASE, S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' });
  assert.equal(cfg.accessKeyId, undefined);
  assert.equal(cfg.secretAccessKey, undefined);
});

test('#554 only S3_ACCESS_KEY_ID set: refused, naming S3_SECRET_ACCESS_KEY as the missing one', () => {
  for (const secret of [undefined, '']) {
    assert.throws(
      () => resolveS3ConfigFromEnv({ ...BASE, S3_ACCESS_KEY_ID: S3_PAIR.id, S3_SECRET_ACCESS_KEY: secret }),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.match(message, /requires S3_SECRET_ACCESS_KEY\b/);
        assert.doesNotMatch(message, /requires S3_ACCESS_KEY_ID\b/);
        for (const canary of CANARIES) assert.ok(!message.includes(canary), 'the refusal carries no value');
        return true;
      },
    );
  }
});

test('#554 only S3_SECRET_ACCESS_KEY set: refused, naming S3_ACCESS_KEY_ID as the missing one', () => {
  for (const id of [undefined, '']) {
    assert.throws(
      () => resolveS3ConfigFromEnv({ ...BASE, S3_ACCESS_KEY_ID: id, S3_SECRET_ACCESS_KEY: S3_PAIR.secret }),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.match(message, /requires S3_ACCESS_KEY_ID\b/);
        assert.doesNotMatch(message, /requires S3_SECRET_ACCESS_KEY\b/);
        for (const canary of CANARIES) assert.ok(!message.includes(canary), 'the refusal carries no value');
        return true;
      },
    );
  }
});

test('#554 both keys set: the config carries exactly that pair', () => {
  const cfg = resolveOrFail({ ...BASE, S3_ACCESS_KEY_ID: S3_PAIR.id, S3_SECRET_ACCESS_KEY: S3_PAIR.secret });
  assert.equal(cfg.accessKeyId, S3_PAIR.id);
  assert.equal(cfg.secretAccessKey, S3_PAIR.secret);
});

test('#554 driven, both keys unset: the request is signed by the default chain (its environment source)', async () => {
  isolateChain({
    AWS_ACCESS_KEY_ID: ENV_CHAIN.id,
    AWS_SECRET_ACCESS_KEY: ENV_CHAIN.secret,
    AWS_SESSION_TOKEN: ENV_CHAIN.token,
  });
  await withLoopbackS3(async (endpoint, seen) => {
    const cfg = resolveOrFail({ ...BASE, S3_ENDPOINT: endpoint });
    await createS3Driver(cfg).put('p3/object.json', '{}', { contentType: 'application/json' });
    assert.equal(seen.length, 1, 'one request reached the store');
    assert.equal(seen[0].accessKeyId, ENV_CHAIN.id, 'signed with the key the chain resolved');
    assert.equal(seen[0].securityToken, ENV_CHAIN.token, 'carrying the chain session token');
  });
});

test('#554 driven, both keys set: the request carries exactly the S3 pair, even with the chain populated', async () => {
  isolateChain({
    AWS_ACCESS_KEY_ID: ENV_CHAIN.id,
    AWS_SECRET_ACCESS_KEY: ENV_CHAIN.secret,
    AWS_SESSION_TOKEN: ENV_CHAIN.token,
  });
  await withLoopbackS3(async (endpoint, seen) => {
    const cfg = resolveOrFail({
      ...BASE,
      S3_ENDPOINT: endpoint,
      S3_ACCESS_KEY_ID: S3_PAIR.id,
      S3_SECRET_ACCESS_KEY: S3_PAIR.secret,
    });
    await createS3Driver(cfg).put('p3/object.json', '{}', { contentType: 'application/json' });
    assert.equal(seen.length, 1, 'one request reached the store');
    assert.equal(seen[0].accessKeyId, S3_PAIR.id, 'signed with the S3 pair, not the chain');
    assert.equal(seen[0].securityToken, null, 'no session token rides with a long-lived pair');
  });
});

test('#554 driven, neither source: the chain finds nothing, and no request leaves', async () => {
  isolateChain();
  await withLoopbackS3(async (endpoint, seen) => {
    const cfg = resolveOrFail({ ...BASE, S3_ENDPOINT: endpoint });
    await assert.rejects(
      createS3Driver(cfg).put('p3/object.json', '{}', { contentType: 'application/json' }),
      /Could not load credentials from any providers/,
    );
    assert.equal(seen.length, 0, 'nothing unsigned reached the store');
  });
});

test('#554 driven, default chain with a session token: a presigned upload URL carries the token', async () => {
  isolateChain({
    AWS_ACCESS_KEY_ID: ENV_CHAIN.id,
    AWS_SECRET_ACCESS_KEY: ENV_CHAIN.secret,
    AWS_SESSION_TOKEN: ENV_CHAIN.token,
  });
  const cfg = resolveOrFail({ ...BASE, S3_ENDPOINT: 'http://127.0.0.1:9' });
  const grant = (await createS3Driver(cfg).grantClientUpload({
    request: new Request('http://p3.invalid/api/blob/upload-token', { method: 'POST' }),
    body: {
      type: 'blob.generate-client-token',
      payload: { pathname: `evidence-refs/${'a'.repeat(64)}`, contentType: 'text/plain', contentLength: 3 },
    },
    onBeforeGrant: async () => ({
      allowedContentTypes: ['text/plain'],
      maximumSizeInBytes: 10,
      tokenPayload: '{}',
    }),
  })) as { url: string };
  const url = new URL(grant.url);
  assert.equal(url.searchParams.get('X-Amz-Security-Token'), ENV_CHAIN.token,
    'the URL is bound to the temporary credential and expires with it');
  assert.match(url.searchParams.get('X-Amz-Credential') ?? '', new RegExp(`^${ENV_CHAIN.id}/`));
  assert.equal(url.searchParams.get('X-Amz-Expires'), '3600');
});

// --- Criterion 2: one line names the source; no value reaches any output -------

/** Capture every console method and every stdout/stderr write while `fn` runs. */
async function captureOutput(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
  const originals = methods.map((m) => console[m]);
  const outWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  for (const m of methods) {
    console[m] = (...args: unknown[]) => { lines.push(util.format(...args)); };
  }
  // Pass-through: the test runner's own output must still reach its reader.
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    lines.push(String(chunk));
    return (outWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    lines.push(String(chunk));
    return (errWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    methods.forEach((m, i) => { console[m] = originals[i]; });
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
  return lines;
}

const SOURCE_LINE = /\[storage:s3\] credential source: /;

function assertNoValue(lines: string[]): void {
  const all = lines.join('\n');
  for (const canary of CANARIES) {
    assert.ok(!all.includes(canary), `no captured output carries a value (found one of the ${CANARIES.length} canaries)`);
  }
}

test('#554 log, key pair: one line names the pair as the source, and no value appears', async () => {
  isolateChain({
    AWS_ACCESS_KEY_ID: ENV_CHAIN.id,
    AWS_SECRET_ACCESS_KEY: ENV_CHAIN.secret,
    AWS_SESSION_TOKEN: ENV_CHAIN.token,
  });
  await withLoopbackS3(async (endpoint) => {
    const lines = await captureOutput(async () => {
      const cfg = resolveS3ConfigFromEnv({
        ...BASE,
        S3_ENDPOINT: endpoint,
        S3_ACCESS_KEY_ID: S3_PAIR.id,
        S3_SECRET_ACCESS_KEY: S3_PAIR.secret,
      });
      await createS3Driver(cfg).put('p3/object.json', '{}', { contentType: 'application/json' });
    });
    const sourceLines = lines.filter((l) => SOURCE_LINE.test(l));
    assert.equal(sourceLines.length, 1, 'exactly one line names the source');
    assert.match(sourceLines[0], /S3_ACCESS_KEY_ID \/ S3_SECRET_ACCESS_KEY key pair/);
    assert.doesNotMatch(sourceLines[0], /default chain/);
    assertNoValue(lines);
  });
});

test('#554 log, default chain: one line names the chain as the source, and no value appears', async () => {
  isolateChain({
    AWS_ACCESS_KEY_ID: ENV_CHAIN.id,
    AWS_SECRET_ACCESS_KEY: ENV_CHAIN.secret,
    AWS_SESSION_TOKEN: ENV_CHAIN.token,
  });
  await withLoopbackS3(async (endpoint) => {
    const lines = await captureOutput(async () => {
      let cfg: S3DriverConfig | undefined;
      assert.doesNotThrow(() => {
        cfg = resolveS3ConfigFromEnv({ ...BASE, S3_ENDPOINT: endpoint });
      });
      await createS3Driver(cfg as S3DriverConfig).put('p3/object.json', '{}', { contentType: 'application/json' });
    });
    const sourceLines = lines.filter((l) => SOURCE_LINE.test(l));
    assert.equal(sourceLines.length, 1, 'exactly one line names the source');
    assert.match(sourceLines[0], /AWS SDK default chain/);
    assert.doesNotMatch(sourceLines[0], /key pair/);
    assertNoValue(lines);
  });
});
