// RED INSTRUMENT for Wave N12 phase W4 (#445), anchor #470.
//
// Three assertions. Two fail at `3436cc7` because both signing-service
// addresses are literals; the third passes today and is the regression guard
// that keeps them byte-identical when nothing is configured.
//
// The two variable names below are a PROPOSAL, following the `PUBLISHER_*`
// family's convention for signing configuration (`PUBLISHER_SIGNING_KEY`,
// `PUBLISHER_TRUST_REGISTRY_CANONICAL_URL`). A phase that finds better names
// renames these constants with them; the assertions do not change.
//
// The spy answers 503 so both functions take their documented degrade-to-null
// path: this measures WHERE a request is addressed, never what comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { getRfc3161Timestamp, publishToRekor } from './signing.ts';

const TSA_LITERAL = 'https://freetsa.org/tsr';
const LOG_LITERAL = 'https://rekor.sigstore.dev/api/v1/log/entries';

const TSA_VAR = 'PUBLISHER_TIMESTAMP_AUTHORITY_URL';
const LOG_VAR = 'PUBLISHER_TRANSPARENCY_LOG_URL';

const SAMPLE_HASH = 'acdb56712cc0e735589e39d485dcd2c3d34a611b6752ab2f8b703e13008a3004';

/** A real Ed25519 pair, so the Rekor proposal codec gets shapes it accepts. */
function sampleSignerMaterial(): { signature: string; publicKeyDerB64: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const message = Buffer.from(SAMPLE_HASH, 'utf8');
  return {
    signature: crypto.sign(null, message, privateKey).toString('base64'),
    publicKeyDerB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

/** Run `fn` with `fetch` recorded and every call answered 503. Restores always. */
async function withFetchSpy(fn: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response(null, { status: 503 });
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return seen;
}

/** Set `name` for the duration of `fn`, restoring whatever was there. */
async function withEnv(name: string, value: string, fn: () => Promise<void>): Promise<void> {
  const had = Object.hasOwn(process.env, name);
  const previous = process.env[name];
  process.env[name] = value;
  try {
    await fn();
  } finally {
    if (had) process.env[name] = previous;
    else delete process.env[name];
  }
}

test('the timestamp authority is the configured one when a value is set', async () => {
  const configured = 'http://127.0.0.1:19001/tsr';
  let seen: string[] = [];
  await withEnv(TSA_VAR, configured, async () => {
    seen = await withFetchSpy(async () => {
      await getRfc3161Timestamp(SAMPLE_HASH);
    });
  });
  assert.equal(seen.length, 1, `expected exactly one outbound request, saw ${seen.length}: ${seen.join(', ')}`);
  assert.equal(
    seen[0],
    configured,
    `the timestamp request went to ${seen[0]}; with ${TSA_VAR} set it must go to the configured ` +
      'authority — an instance behind an egress allowlist, or running its own, cannot use a literal',
  );
});

test('the transparency log is the configured one when a value is set', async () => {
  const configured = 'http://127.0.0.1:19002/api/v1/log/entries';
  const { signature, publicKeyDerB64 } = sampleSignerMaterial();
  let seen: string[] = [];
  await withEnv(LOG_VAR, configured, async () => {
    seen = await withFetchSpy(async () => {
      await publishToRekor(SAMPLE_HASH, signature, publicKeyDerB64);
    });
  });
  assert.equal(seen.length, 1, `expected exactly one outbound request, saw ${seen.length}: ${seen.join(', ')}`);
  assert.equal(
    seen[0],
    configured,
    `the log submission went to ${seen[0]}; with ${LOG_VAR} set it must go to the configured log`,
  );
});

test('with neither variable set, both addresses equal the prior literals byte for byte', async () => {
  assert.ok(!process.env[TSA_VAR], `${TSA_VAR} must be unset for this test`);
  assert.ok(!process.env[LOG_VAR], `${LOG_VAR} must be unset for this test`);

  const { signature, publicKeyDerB64 } = sampleSignerMaterial();
  const seen = await withFetchSpy(async () => {
    await getRfc3161Timestamp(SAMPLE_HASH);
    await publishToRekor(SAMPLE_HASH, signature, publicKeyDerB64);
  });

  assert.deepEqual(
    seen,
    [TSA_LITERAL, LOG_LITERAL],
    'unconfigured, the two requests must go to exactly the addresses they went to before #445 — ' +
      'making an address configurable must move no byte at the defaults',
  );
});
