/**
 * A key-value store for the consent-pause suites (#644 W2): the commands the
 * pause and the decision route send (`decision.ts`), and the two the rate
 * limiter sends, held in memory on a clock the test drives. Not a test
 * itself, and nothing in the app imports it (the precedent is
 * `./consent-cookie-for-tests.ts`). No suite makes a real store call.
 *
 * IT FOLLOWS REDIS'S RULES for the options the code uses, because the expiry
 * leg of criterion 2 is about them (the seat's item 3):
 *   - `SET key value` with no expiry option CLEARS the key's expiry;
 *   - `EX n` sets it to n seconds from now;
 *   - `KEEPTTL` keeps the expiry the key has; on a key that does not exist it
 *     creates one with no expiry, unless `XX` refuses the write;
 *   - `NX` writes only a key that does not exist, `XX` only one that does;
 *     a refused write answers `null`, any other `"OK"`;
 *   - a key whose expiry has passed does not exist.
 * Values are stored as JSON and read back parsed, as `@upstash/redis` does.
 *
 * `failGet` and `failSet` make the next reads or writes throw, for the
 * failed-store legs.
 */

export interface FakeKvSetOptions {
  ex?: number;
  nx?: boolean;
  xx?: boolean;
  keepTtl?: boolean;
}

export interface FakeKvCall {
  op: 'get' | 'set' | 'incr' | 'expire';
  key: string;
  value?: unknown;
  options?: FakeKvSetOptions;
}

export class FakeDecisionKv {
  readonly entries = new Map<string, { value: string; expiresAt?: number }>();
  readonly calls: FakeKvCall[] = [];
  failGet = false;
  failSet = false;
  now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  private live(key: string): { value: string; expiresAt?: number } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<unknown> {
    this.calls.push({ op: 'get', key });
    if (this.failGet) throw new Error('fake store: the read was refused');
    const entry = this.live(key);
    return entry ? JSON.parse(entry.value) : null;
  }

  async set(key: string, value: unknown, options: FakeKvSetOptions = {}): Promise<'OK' | null> {
    this.calls.push({ op: 'set', key, value, options });
    if (this.failSet) throw new Error('fake store: the write was refused');
    const existing = this.live(key);
    if (options.nx && existing) return null;
    if (options.xx && !existing) return null;
    let expiresAt: number | undefined;
    if (typeof options.ex === 'number') expiresAt = this.now() + options.ex * 1000;
    else if (options.keepTtl) expiresAt = existing?.expiresAt;
    // With neither option, a SET clears the expiry.
    this.entries.set(key, { value: JSON.stringify(value), expiresAt });
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    this.calls.push({ op: 'incr', key });
    const existing = this.live(key);
    const next = (existing ? Number(JSON.parse(existing.value)) : 0) + 1;
    this.entries.set(key, { value: JSON.stringify(next), expiresAt: existing?.expiresAt });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.calls.push({ op: 'expire', key });
    const existing = this.live(key);
    if (!existing) return 0;
    existing.expiresAt = this.now() + seconds * 1000;
    return 1;
  }

  /** Milliseconds until `key` expires: -2 when it does not exist, -1 when it has no expiry. */
  pttl(key: string): number {
    const entry = this.live(key);
    if (!entry) return -2;
    return entry.expiresAt === undefined ? -1 : entry.expiresAt - this.now();
  }

  /** The keys the pause wrote, without their prefix. */
  decisionKeys(): string[] {
    return [...this.entries.keys()].filter((k) => k.startsWith('consent-decision:'));
  }
}

/**
 * Module source for `@vercel/kv` in a suite that loads the app through
 * `module.registerHooks()`: `kv` answers from the fake the suite puts on
 * `globalThis.__w2DecisionKv`, so the app's own client import reaches it.
 */
export const FAKE_VERCEL_KV_MODULE = `
  const fake = () => {
    const kv = globalThis.__w2DecisionKv;
    if (!kv) throw new Error('no fake store installed for @vercel/kv');
    return kv;
  };
  export const kv = new Proxy({}, { get: (_target, prop) => { const f = fake(); const v = f[prop]; return typeof v === 'function' ? v.bind(f) : v; } });
  export default kv;
`;
