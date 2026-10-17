// #516 P4 — a non-OK transparency-log response is logged by its status and its
// byte count, never by its body.
//
// A refusal body is text a remote service wrote, and a log service can echo
// what it was sent. The base logged the body's first 200 characters
// (`src/lib/evidence/signing.ts`, `publishToRekor`), so a canary in the body
// reached the console there: this file is red at `41f4e40`.
//
// The canary sits inside the first 200 characters, so the base's truncation
// cannot hide it (the fixture can fail), and the body carries a multi-byte
// character, so a character count and a byte count differ and the line has to
// carry the byte count to pass.
//
// The line is captured from `console.warn` and formatted once per call with
// `util.format`, which is what `console` itself does.
//
// Run with: node --test --experimental-strip-types src/lib/evidence/transparency-log-failure-line.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import util from 'node:util';

import { publishToRekor } from './signing.ts';

const CANARY = 'Hm4sXc9p-log-body-canary';

const SAMPLE_HASH = 'acdb56712cc0e735589e39d485dcd2c3d34a611b6752ab2f8b703e13008a3004';

/** An ephemeral Ed25519 pair made for this test, so the proposal codec gets shapes it accepts. */
function sampleSignerMaterial(): { signature: string; publicKeyDerB64: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    signature: crypto.sign(null, Buffer.from(SAMPLE_HASH, 'utf8'), privateKey).toString('base64'),
    publicKeyDerB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

for (const status of [400, 409, 500]) {
  test(`a ${status} from the transparency log logs its status and byte count, not its body`, async () => {
    const body = JSON.stringify({ code: status, message: `entry rejected — the log echoed ${CANARY} back` });
    assert.ok(body.indexOf(CANARY) + CANARY.length <= 200, 'the canary is inside the first 200 characters (the fixture can fail)');
    const bytes = Buffer.byteLength(body, 'utf8');
    assert.notEqual(bytes, body.length, 'a byte count and a character count differ for this body');

    const lines: string[] = [];
    const realWarn = console.warn;
    const realError = console.error;
    const realLog = console.log;
    const realFetch = globalThis.fetch;
    const capture = (...args: unknown[]) => { lines.push(util.format(...args)); };
    console.warn = capture;
    console.error = capture;
    console.log = capture;
    globalThis.fetch = (async () => new Response(body, { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    let result: unknown;
    try {
      const { signature, publicKeyDerB64 } = sampleSignerMaterial();
      result = await publishToRekor(SAMPLE_HASH, signature, publicKeyDerB64);
    } finally {
      console.warn = realWarn;
      console.error = realError;
      console.log = realLog;
      globalThis.fetch = realFetch;
    }

    assert.equal(result, null, 'a non-OK response degrades to null');
    assert.equal(lines.length, 1, `one line: ${JSON.stringify(lines)}`);
    const [line] = lines;
    assert.ok(!line.includes(CANARY), `the body is not on the line: ${line}`);
    assert.ok(line.includes(String(status)), `the status is on the line: ${line}`);
    assert.ok(line.includes(`${bytes} bytes`), `the byte count is on the line: ${line}`);
  });
}
