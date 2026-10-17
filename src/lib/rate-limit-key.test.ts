// #516 P1 — the stored rate-limit key carries no reader identifier.
//
// WHAT THIS IS FOR. The per-day counter is stored under a key, in the
// key-value store when one is configured and in an in-process map otherwise.
// That key used to be `rate:<identifier>:<date>`, where the identifier is the
// reader's address (anonymous) or account id (signed in), so anyone who could
// list the store could read who had asked questions on which day. The key's
// identifier segment is now a keyed hash: a day key derived from the
// instance secret `RATE_LIMIT_SECRET` and the date, and the identifier hashed
// under that day key. The frame `rate:…:<date>` is unchanged.
//
// WHAT IS OBSERVED. The key the module actually STORES, in both stores, read
// at the store rather than recomputed here:
//   - the key-value store: `@vercel/kv` is replaced, through
//     `module.registerHooks()`, by a fake that records every key it is handed
//     (`get`, `incr`, `expire`); its own storage is a plain object, so it adds
//     nothing to the next instrument;
//   - the in-process map: `Map.prototype.get` and `.set` are wrapped for the
//     length of one call and record every string key they see.
// The module is imported only after the hook is installed.
//
// THE CANARIES. An IPv4 address from the documentation range (RFC 5737), and
// an account id made only of letters that are not hex digits: the hashed
// segment is hex and the date is digits, so a numeric or hex canary could
// match one of its 4-character substrings by chance. Every 4-character
// substring of the address carries a `.`, which the key never does.
//
// THE CLOCK. `getToday()` reads `new Date()`; `mock.timers` fixes it, so "the
// same date" and "the next date" are dates this file chose.
//
// THE INSTRUMENT HAS BEEN SEEN WORKING. Run against the base of #516 P1
// (`931fa48`), where the key is the identifier verbatim, the canary, the
// daily-change, rotation, shape and refusal tests below fail; the
// determinism test passes there (the base key is deterministic too) and its
// red is shown with the guard switched off, in the phase's gate record.
// Each test also asserts that a key WAS stored, so a module that stored
// nothing would fail rather than pass.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/rate-limit-key.test.ts)

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { classifyStreamError } from './streaming.ts';

// Typed here because the installed `@types/node` predates `registerHooks`.
interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

// --- The key-value store, faked ---------------------------------------------

interface KvCall { op: string; key: string }
const globals = globalThis as unknown as { __rlkCalls: KvCall[]; __rlkStore: Record<string, number> };
globals.__rlkCalls = [];
globals.__rlkStore = Object.create(null) as Record<string, number>;

const KV_STUB_URL = 'file:///civic-516-p1-stub/vercel-kv.mjs';
const KV_STUB = `
  export const kv = {
    async get(key) { globalThis.__rlkCalls.push({ op: 'get', key }); return globalThis.__rlkStore[key] ?? null; },
    async incr(key) {
      globalThis.__rlkCalls.push({ op: 'incr', key });
      globalThis.__rlkStore[key] = (globalThis.__rlkStore[key] ?? 0) + 1;
      return globalThis.__rlkStore[key];
    },
    async expire(key) { globalThis.__rlkCalls.push({ op: 'expire', key }); return 1; },
  };`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@vercel/kv') return { url: KV_STUB_URL, format: 'module', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === KV_STUB_URL) return { format: 'module', source: KV_STUB, shortCircuit: true };
    return nextLoad(url, context);
  },
});

for (const name of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'RATE_LIMIT_SECRET']) delete process.env[name];

const { checkRateLimit, incrementRateLimit } = await import('./rate-limit.ts');

// --- Instruments ----------------------------------------------------------------

/** Every string key `Map#get` and `Map#set` see while `run` is in flight. */
async function mapKeysDuring(run: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const realGet = Map.prototype.get;
  const realSet = Map.prototype.set;
  Map.prototype.get = function (this: Map<unknown, unknown>, key: unknown) {
    if (typeof key === 'string') seen.push(key);
    return realGet.call(this, key);
  } as typeof Map.prototype.get;
  Map.prototype.set = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (typeof key === 'string') seen.push(key);
    return realSet.call(this, key, value);
  } as typeof Map.prototype.set;
  try {
    await run();
  } finally {
    Map.prototype.get = realGet;
    Map.prototype.set = realSet;
  }
  return seen;
}

/** The keys the fake key-value store is handed while `run` is in flight. */
async function kvKeysDuring(run: () => Promise<unknown>): Promise<KvCall[]> {
  const from = globals.__rlkCalls.length;
  await run();
  return globals.__rlkCalls.slice(from);
}

function setKvConfigured(on: boolean): void {
  if (on) {
    // Presence is all the module checks; the fake answers, and nothing is sent.
    process.env.KV_REST_API_URL = 'http://127.0.0.1:9';
    process.env.KV_REST_API_TOKEN = 'fixture';
  } else {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
}

function withSecret(value: string | undefined): void {
  if (value === undefined) delete process.env.RATE_LIMIT_SECRET;
  else process.env.RATE_LIMIT_SECRET = value;
}

const DAY = Date.parse('2026-10-16T12:00:00.000Z');
const NEXT_DAY = Date.parse('2026-10-17T12:00:00.000Z');

function onDay<T>(at: number, run: () => Promise<T>): Promise<T> {
  mock.timers.enable({ apis: ['Date'], now: at });
  return run().finally(() => mock.timers.reset());
}

/** The one `rate:` key a single check-then-increment stores in the in-process map. */
async function storedMapKey(identifier: string, at = DAY): Promise<string> {
  const keys = await onDay(at, () => mapKeysDuring(async () => {
    await checkRateLimit(identifier, false);
    await incrementRateLimit(identifier, false);
  }));
  const rateKeys = [...new Set(keys.filter((k) => k.startsWith('rate:')))];
  assert.equal(rateKeys.length, 1, `one rate key for one identifier on one day, saw: ${JSON.stringify(rateKeys)}`);
  return rateKeys[0];
}

/** The identifier segment of a `rate:<segment>:<date>` key. */
function segmentOf(key: string): string {
  const match = /^rate:(.*):(\d{4}-\d{2}-\d{2})$/.exec(key);
  assert.ok(match, `the key keeps the rate:…:<date> frame: ${key}`);
  return match[1];
}

// --- The canaries -----------------------------------------------------------------

const ADDRESS_CANARY = '203.0.113.77';
const ACCOUNT_CANARY = 'zqwxvkjhmnrstpylg';
for (const ch of ACCOUNT_CANARY) assert.ok(!/[0-9a-f]/.test(ch), 'the account canary carries no hex digit');

function fourCharSubstrings(canary: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 4 <= canary.length; i++) out.push(canary.slice(i, i + 4));
  return out;
}

function assertNoCanary(keys: string[], canary: string, where: string): void {
  for (const key of keys) {
    assert.ok(!key.includes(canary), `${where}: the stored key carries the identifier verbatim: ${key}`);
    for (const part of fourCharSubstrings(canary)) {
      assert.ok(!key.includes(part), `${where}: the stored key carries "${part}" of the identifier: ${key}`);
    }
  }
}

// --- Acceptance 1: neither store holds the identifier -------------------------------

for (const [label, canary, authenticated] of [
  ['address', ADDRESS_CANARY, false],
  ['account id', ACCOUNT_CANARY, true],
] as const) {
  test(`#516 P1 (1): the in-process map stores no part of the reader's ${label}`, async () => {
    setKvConfigured(false);
    withSecret('fixture');
    const keys = await onDay(DAY, () => mapKeysDuring(async () => {
      await checkRateLimit(canary, authenticated);
      await incrementRateLimit(canary, authenticated);
    }));
    const rateKeys = keys.filter((k) => k.startsWith('rate:'));
    assert.ok(rateKeys.length >= 2, `the check and the increment each reached the map: ${JSON.stringify(keys)}`);
    assertNoCanary(keys, canary, 'in-process map');
  });

  test(`#516 P1 (1): the key-value store is handed no part of the reader's ${label}`, async () => {
    setKvConfigured(true);
    withSecret('fixture');
    let calls: KvCall[] = [];
    const mapKeys = await onDay(DAY, () => mapKeysDuring(async () => {
      calls = await kvKeysDuring(async () => {
        await checkRateLimit(canary, authenticated);
        await incrementRateLimit(canary, authenticated);
      });
    }));
    setKvConfigured(false);
    assert.deepEqual(calls.map((c) => c.op), ['get', 'incr', 'expire'], 'the counter went to the key-value store, not the fallback');
    assertNoCanary(calls.map((c) => c.key), canary, 'key-value store');
    assertNoCanary(mapKeys, canary, 'in-process map, key-value path');
  });
}

// --- Acceptance 2: deterministic, daily, and rotated by the secret --------------------

test('#516 P1 (2): the same identifier, secret and date give the same key', async () => {
  setKvConfigured(false);
  withSecret('fixture');
  const first = await storedMapKey('determinism-zqwx');
  const second = await storedMapKey('determinism-zqwx');
  assert.equal(first, second);
});

test('#516 P1 (2): the next date gives a different identifier segment, not only a different date', async () => {
  setKvConfigured(false);
  withSecret('fixture');
  const today = await storedMapKey('daily-zqwx', DAY);
  const tomorrow = await storedMapKey('daily-zqwx', NEXT_DAY);
  assert.notEqual(today, tomorrow);
  assert.notEqual(segmentOf(today), segmentOf(tomorrow), 'a key captured from the store must not name the same reader on the next day');
});

test('#516 P1 (2): a different secret gives a different key (rotation)', async () => {
  setKvConfigured(false);
  withSecret('fixture');
  const before = await storedMapKey('rotation-zqwx');
  withSecret('fixture-rotated');
  const after = await storedMapKey('rotation-zqwx');
  withSecret('fixture');
  assert.notEqual(before, after);
});

test('#516 P1 (2): the identifier segment is a 64-character hex digest', async () => {
  setKvConfigured(false);
  withSecret('fixture');
  const key = await storedMapKey('shape-zqwx');
  assert.match(segmentOf(key), /^[0-9a-f]{64}$/);
});

// --- Acceptance 3, the module's half: no secret, no key -------------------------------

for (const [label, value] of [['absent', undefined], ['empty', ''], ['whitespace-only', '   ']] as const) {
  test(`#516 P1 (3): with the secret ${label}, the counter refuses by name and computes no key`, async () => {
    for (const kvOn of [false, true]) {
      setKvConfigured(kvOn);
      withSecret(value);
      for (const call of [checkRateLimit, incrementRateLimit]) {
        let calls: KvCall[] = [];
        let caught: unknown;
        const mapKeys = await mapKeysDuring(async () => {
          calls = await kvKeysDuring(async () => {
            try {
              await call('refusal-zqwx', false);
            } catch (err) {
              caught = err;
            }
          });
        });
        const where = `${call.name}, ${kvOn ? 'key-value store' : 'in-process map'}`;
        assert.ok(caught instanceof Error, `${where}: a missing secret is a refusal, not a count`);
        assert.equal(caught.name, 'RateLimitConfigurationError', where);
        assert.match(caught.message, /RATE_LIMIT_SECRET/, `${where}: the refusal names the variable`);
        assert.equal((caught as { code?: unknown }).code, 'rate_limit_not_configured', where);
        // The reader-facing classifier must not read this as the reader's own
        // daily limit: the message is not "rate limit exceeded".
        assert.notEqual(classifyStreamError(caught), 'rate_limit', `${where}: the refusal would be shown as the reader's limit`);
        assert.deepEqual(mapKeys.filter((k) => k.startsWith('rate:')), [], `${where}: a key was computed`);
        assert.deepEqual(calls, [], `${where}: the key-value store was reached`);
      }
    }
    setKvConfigured(false);
    withSecret('fixture');
  });
}
