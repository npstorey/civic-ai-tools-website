// The two signing-service addresses are configuration, and unset means today
// (Wave N12 phase W4, #445, anchor #470).
//
// This file began as the phase's RED INSTRUMENT: at `3436cc7` the first two
// subtests failed because both addresses were literals, and the third passed
// and is the regression guard that keeps them byte-identical when nothing is
// configured. The variable names were a proposal in the `PUBLISHER_*` family;
// they are NOT in that family in the end, and the reason is measured rather
// than argued — see `THE NAMES`, below. The assertions did not change.
//
// TWO KINDS OF MEASUREMENT, on purpose:
//
//   - the `fetch` spy answers 503 so both functions take their documented
//     degrade-to-null path. It measures WHERE a request is addressed, never
//     what comes back;
//   - the loopback stubs are real `node:http` servers on 127.0.0.1, driven
//     through the real global `fetch`, and the count that matters is the one
//     the SERVER kept. A spy can only report what the code under test handed
//     it; a stub that is never contacted reports zero and fails, which is the
//     shape criterion 1 asks for.
//
// THE NAMES. `PUBLISHER_*` is the Appendix J census of thirteen publishing-
// identity variables, each with an `EVIDENCE_*` prior-era twin, pinned against
// `ENV_SPEC` in both directions by `src/lib/publisher-env.test.ts`. Adding a
// fourteenth `PUBLISHER_*` row to `ENV_SPEC` fails that pin ("the scripts-side
// census matches this one, name for name"), and satisfying it would mean
// inventing a prior-era spelling for a name that has no prior era. These two
// name an external SERVICE ENDPOINT, not this publisher, so they follow
// `SOCRATA_MCP_URL` and `MODEL_API_BASE_URL` instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  getRfc3161Timestamp,
  publishToRekor,
  timestampAuthorityUrl,
  transparencyLogUrl,
  transparencyLogEntryUrl,
  TIMESTAMP_AUTHORITY_ENV_NAME,
  TRANSPARENCY_LOG_ENV_NAME,
  DEFAULT_TIMESTAMP_AUTHORITY_URL,
  DEFAULT_TRANSPARENCY_LOG_URL,
} from './signing.ts';

const TSA_LITERAL = 'https://freetsa.org/tsr';
const LOG_LITERAL = 'https://rekor.sigstore.dev/api/v1/log/entries';

const TSA_VAR = TIMESTAMP_AUTHORITY_ENV_NAME;
const LOG_VAR = TRANSPARENCY_LOG_ENV_NAME;

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

/** One request a stub actually received, as the STUB recorded it. */
interface StubHit {
  method: string;
  url: string;
}

/** A loopback HTTP stub that counts what reaches it and answers 503 to all of it. */
interface Stub {
  /** The address to configure — `http://127.0.0.1:<port><path>`. */
  url: string;
  /** Every request this server handled, in arrival order. */
  hits: StubHit[];
  close(): Promise<void>;
}

/**
 * Start a loopback stub on an ephemeral port. 503 to everything, for the same
 * reason the spy does: this measures arrival, not the protocol exchange.
 */
async function startStub(path: string): Promise<Stub> {
  const hits: StubHit[] = [];
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method ?? '', url: req.url ?? '' });
    // Drain the body so the client's write completes before the response.
    req.resume();
    req.on('end', () => {
      res.writeHead(503).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}${path}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// --- Criterion 1: both addresses are configurable -----------------------------

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

// --- Criterion 2: the defaults are byte-identical -----------------------------

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

// --- Criterion 1, counted at the stub rather than at the caller ---------------

test('each configured loopback stub receives exactly one request, and the other receives none', async () => {
  const tsa = await startStub('/tsr');
  const log = await startStub('/api/v1/log/entries');
  const { signature, publicKeyDerB64 } = sampleSignerMaterial();

  try {
    await withEnv(TSA_VAR, tsa.url, async () => {
      await withEnv(LOG_VAR, log.url, async () => {
        // The REAL global fetch: nothing is intercepted, so an address that
        // did not reach the wire leaves its stub at zero hits.
        assert.equal(await getRfc3161Timestamp(SAMPLE_HASH), null, 'a 503 degrades to null, as documented');
        assert.equal(
          await publishToRekor(SAMPLE_HASH, signature, publicKeyDerB64),
          null,
          'a 503 degrades to null, as documented',
        );
      });
    });

    assert.equal(
      tsa.hits.length,
      1,
      `the timestamp authority stub recorded ${tsa.hits.length} request(s); exactly one must arrive ` +
        `(zero means ${TSA_VAR} never reached the wire, more than one means the call was retried)`,
    );
    assert.equal(
      log.hits.length,
      1,
      `the transparency-log stub recorded ${log.hits.length} request(s); exactly one must arrive ` +
        `(zero means ${LOG_VAR} never reached the wire, more than one means the call was retried)`,
    );
    assert.deepEqual(
      tsa.hits[0],
      { method: 'POST', url: '/tsr' },
      'the timestamp request must arrive at the configured path, by POST',
    );
    assert.deepEqual(
      log.hits[0],
      { method: 'POST', url: '/api/v1/log/entries' },
      'the log submission must arrive at the configured path, by POST',
    );
  } finally {
    await tsa.close();
    await log.close();
  }
});

test('a stub that is never contacted fails rather than passing as "no mismatch"', async () => {
  // The converse of the test above, driven: with the variables UNSET, the two
  // calls go to the public defaults and a running loopback stub sees nothing.
  // This is what makes the counts above load-bearing — a stub with zero hits
  // is a red, not a silent pass.
  const tsa = await startStub('/tsr');
  try {
    await withFetchSpy(async () => {
      await getRfc3161Timestamp(SAMPLE_HASH);
    });
    assert.equal(tsa.hits.length, 0, 'unconfigured, nothing addresses the stub');
    assert.throws(
      () => assert.equal(tsa.hits.length, 1),
      /Expected values to be strictly equal/,
      'an uncontacted stub fails the exactly-one assertion — the instrument can report red',
    );
  } finally {
    await tsa.close();
  }
});

// --- The resolvers, over an environment fixture -------------------------------

test('an empty or whitespace-only value is absent, and the default answers', () => {
  // The opposite of PUBLISHER_TRUST_REGISTRY_LEGACY_URL, where empty is a
  // documented instruction to omit a signed field. No address can be empty.
  for (const blank of ['', '   ', '\t\n']) {
    assert.equal(timestampAuthorityUrl({ [TSA_VAR]: blank }), DEFAULT_TIMESTAMP_AUTHORITY_URL);
    assert.equal(transparencyLogUrl({ [LOG_VAR]: blank }), DEFAULT_TRANSPARENCY_LOG_URL);
  }
  assert.equal(timestampAuthorityUrl({}), DEFAULT_TIMESTAMP_AUTHORITY_URL);
  assert.equal(transparencyLogUrl({}), DEFAULT_TRANSPARENCY_LOG_URL);
});

test('the two defaults are the prior literals, character for character', () => {
  assert.equal(DEFAULT_TIMESTAMP_AUTHORITY_URL, TSA_LITERAL);
  assert.equal(DEFAULT_TRANSPARENCY_LOG_URL, LOG_LITERAL);
});

test('the single-entry read composes to the address the backfill script used before', () => {
  // `scripts/backfill-rekor-entry-body.ts` is in this seam (it reads back an
  // entry it published). Unconfigured, its address must be the literal it
  // carried before #445 — id interpolated raw, no percent-encoding.
  const entryId = '24296fb24b8ad77a6c9a1f1a9e7a3fbb1b8f3b7f9e3d0f6b0f1d2e3c4b5a6978';
  assert.equal(
    transparencyLogEntryUrl(entryId, {}),
    `${LOG_LITERAL}/${entryId}`,
    'the default single-entry address must equal the prior literal, character for character',
  );
  assert.equal(
    transparencyLogEntryUrl(entryId, { [LOG_VAR]: 'http://127.0.0.1:19002/entries' }),
    `http://127.0.0.1:19002/entries/${entryId}`,
    'a configured log is read back at the configured log, not at the default',
  );
});

test('a configured address is used verbatim, surrounding whitespace aside', () => {
  assert.equal(
    timestampAuthorityUrl({ [TSA_VAR]: '  https://tsa.example.org/tsr  ' }),
    'https://tsa.example.org/tsr',
  );
  assert.equal(
    transparencyLogUrl({ [LOG_VAR]: 'https://log.example.org/api/v1/log/entries' }),
    'https://log.example.org/api/v1/log/entries',
  );
});
