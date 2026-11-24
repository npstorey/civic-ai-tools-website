// The rule: when one call to the shared count store fails and another answers, a request over the daily allowance is
// still refused. When the store answers nothing, the count falls back to this instance's memory, as before.
//
// WHAT IS DRIVEN. `consumeRateLimit` (`src/lib/rate-limit.ts`), the one call a route that runs a question makes,
// against a double of the shared key-value store whose calls can be made to fail: the increment, then the expiry
// after a successful increment. Each of those two cases first spends the whole allowance with every call answering,
// so the store holds the count and the in-process memory store holds none of it, and only then fails the call, at the
// limit and past it. That order is what lets each case fail: a call that failed from the first request would leave
// the memory store counting in step with the store, and the refusal would come from either count.
//
// TWO PINS, green before the change and after it: within the allowance, a failed expiry refuses nothing; and when the
// store answers nothing (every call fails from the first request), the memory count alone allows and refuses, as it
// did before.
//
// THE PREMISES, asserted in each case so a double that never failed cannot read green: the failing call was reached
// on every request after the switch, it threw each time, and the store's count is what the case says it is.
//
// STUBS: `@vercel/kv` is replaced through `module.registerHooks()` before the limiter loads. The limiter only checks
// that the store's two variables are set; nothing is sent.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';

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

type StoreCall = 'get' | 'incr' | 'expire';
interface CallRecord { op: StoreCall; threw: boolean }
const globals = globalThis as unknown as {
  __rsfStore: Record<string, number>;
  __rsfFailing: Set<StoreCall>;
  __rsfCalls: CallRecord[];
};
globals.__rsfStore = Object.create(null) as Record<string, number>;
globals.__rsfFailing = new Set();
globals.__rsfCalls = [];

const KV_STUB_URL = 'file:///civic-rate-limit-store-failure-stub/vercel-kv.mjs';
const KV_STUB = `
  function call(op, run) {
    const threw = globalThis.__rsfFailing.has(op);
    globalThis.__rsfCalls.push({ op, threw });
    if (threw) throw new Error('fixture store: ' + op + ' did not answer');
    return run();
  }
  export const kv = {
    async get(key) { return call('get', () => globalThis.__rsfStore[key] ?? null); },
    async incr(key) { return call('incr', () => (globalThis.__rsfStore[key] = (globalThis.__rsfStore[key] ?? 0) + 1)); },
    async expire() { return call('expire', () => 1); },
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

// The limiter reads its limits once, at load: set them before it loads.
const LIMIT = 3;
for (const name of ['APP_TIER_RATE_LIMIT', 'SIGN_IN_ALLOWLIST']) delete process.env[name];
process.env.ANONYMOUS_RATE_LIMIT = String(LIMIT);
process.env.AUTHENTICATED_RATE_LIMIT = String(LIMIT);
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.KV_REST_API_URL = 'http://127.0.0.1:9';
process.env.KV_REST_API_TOKEN = 'fixture';

const { consumeRateLimit, checkRateLimit, isRateLimited } = await import('./rate-limit.ts');

/** The one key the store holds a count under, for the reader the case drives. */
function storeCount(): number {
  const keys = Object.keys(globals.__rsfStore);
  assert.equal(keys.length, 1, `premise: the store holds one key, saw ${keys.length}`);
  return globals.__rsfStore[keys[0]];
}

function reset(): void {
  for (const key of Object.keys(globals.__rsfStore)) delete globals.__rsfStore[key];
  globals.__rsfFailing.clear();
  globals.__rsfCalls.length = 0;
}

let reader = 0;
/** A reader no case has counted, so the memory store holds nothing for it. */
function freshReader(): string {
  reader += 1;
  return `203.0.113.${reader}`;
}

/** Spend the whole allowance with every store call answering. */
async function spendAllowance(identifier: string): Promise<void> {
  for (let i = 1; i <= LIMIT; i++) {
    const info = await consumeRateLimit(identifier, false);
    assert.equal(isRateLimited(info), false, `premise: question ${i} of ${LIMIT} was refused`);
  }
  assert.equal(storeCount(), LIMIT, 'premise: the store counted the whole allowance');
  assert.equal(globals.__rsfCalls.some((c) => c.threw), false, 'premise: no store call failed while the allowance was spent');
}

const PAST = 3;

test('a request over the daily allowance is refused when the store\'s increment fails, at the limit and past it', async () => {
  reset();
  const identifier = freshReader();
  await spendAllowance(identifier);
  globals.__rsfFailing.add('incr');
  for (let i = 0; i < PAST; i++) {
    const from = globals.__rsfCalls.length;
    const info = await consumeRateLimit(identifier, false);
    const calls = globals.__rsfCalls.slice(from);
    assert.deepEqual(calls.filter((c) => c.op === 'incr'), [{ op: 'incr', threw: true }], 'premise: the increment was reached and failed');
    assert.equal(isRateLimited(info), true, `request ${LIMIT + 1 + i}, ${i + 1} past the allowance, passed`);
    assert.equal(info.remaining, 0);
    assert.equal(info.limit, LIMIT);
  }
  assert.equal(storeCount(), LIMIT, 'premise: a failed increment left the store\'s count as it was');
});

test('a request over the daily allowance is refused when the store\'s expiry fails after its increment succeeded, at the limit and past it', async () => {
  reset();
  const identifier = freshReader();
  await spendAllowance(identifier);
  globals.__rsfFailing.add('expire');
  for (let i = 0; i < PAST; i++) {
    const from = globals.__rsfCalls.length;
    const info = await consumeRateLimit(identifier, false);
    const calls = globals.__rsfCalls.slice(from);
    assert.deepEqual(calls.filter((c) => c.op === 'incr'), [{ op: 'incr', threw: false }], 'premise: the increment succeeded');
    assert.deepEqual(calls.filter((c) => c.op === 'expire'), [{ op: 'expire', threw: true }], 'premise: the expiry was reached and failed');
    assert.equal(isRateLimited(info), true, `request ${LIMIT + 1 + i}, ${i + 1} past the allowance, passed`);
    assert.equal(info.remaining, 0);
    assert.equal(info.limit, LIMIT);
  }
  assert.equal(storeCount(), LIMIT + PAST, 'premise: each increment counted in the store');
  assert.equal((await checkRateLimit(identifier, false)).remaining, 0, 'the allowance read agrees: none left');
});

test('within the allowance, a failed expiry after a successful increment does not refuse the request', async () => {
  reset();
  const identifier = freshReader();
  globals.__rsfFailing.add('expire');
  for (let i = 1; i <= LIMIT; i++) {
    const info = await consumeRateLimit(identifier, false);
    assert.equal(isRateLimited(info), false, `question ${i} of ${LIMIT} was refused`);
    assert.equal(info.remaining, LIMIT - (i - 1), `question ${i}: the allowance as this request found it`);
  }
  assert.equal(storeCount(), LIMIT, 'premise: each increment counted in the store');
  assert.equal(globals.__rsfCalls.filter((c) => c.op === 'expire' && c.threw).length, LIMIT, 'premise: every expiry failed');
});

test('when the store answers nothing, the count falls back to this instance\'s memory: the allowance passes, and past it is refused', async () => {
  reset();
  const identifier = freshReader();
  for (const op of ['get', 'incr', 'expire'] as const) globals.__rsfFailing.add(op);
  for (let i = 1; i <= LIMIT + PAST; i++) {
    const from = globals.__rsfCalls.length;
    const info = await consumeRateLimit(identifier, false);
    const calls = globals.__rsfCalls.slice(from);
    assert.deepEqual(calls.filter((c) => c.op === 'incr'), [{ op: 'incr', threw: true }], 'premise: the increment was reached and failed');
    assert.equal(calls.every((c) => c.threw), true, 'premise: no store call answered');
    if (i <= LIMIT) {
      assert.equal(isRateLimited(info), false, `question ${i} of ${LIMIT} was refused`);
      assert.equal(info.remaining, LIMIT - (i - 1), `question ${i}: the allowance as this request found it`);
    } else {
      assert.equal(isRateLimited(info), true, `request ${i}, ${i - LIMIT} past the allowance, passed`);
      assert.equal(info.remaining, 0);
    }
  }
  assert.deepEqual(Object.keys(globals.__rsfStore), [], 'premise: the store counted nothing');
});
