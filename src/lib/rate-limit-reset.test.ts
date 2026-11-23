// UX-2-FIX P2, U1 (#790; the seat's pointer 6966480540 item 3): `resets_at` is the next UTC midnight on any host.
//
// THE RULE. The daily count is keyed on the UTC date (`getToday()`, the ISO date), so it resets at the next UTC
// midnight, and readers are told so ("at midnight UTC"). `resets_at` (the `/api/rate-limit` body, and the 429 bodies of
// the query routes) says when: the UTC midnight after the key's date, whatever time zone the host process runs in. It
// used to be the host's local midnight (`setDate` and `setHours`), which is UTC midnight only on a UTC host.
//
// WHAT IS DRIVEN. `checkRateLimit` and `consumeRateLimit`, in this process, under `TZ=America/New_York` (behind UTC)
// and `TZ=Asia/Tokyo` (ahead of it), and under `UTC` as the guard, at two instants on each side of a local date change:
// 02:00Z, when New York is still on the previous date, and 20:00Z, when Tokyo is already on the next one. Node reads
// `process.env.TZ` again when it is set, which each case checks before it reads (a premise, so a process that ignored
// the change could not read green). The clock is `mock.timers`; the key-value store is unset, so the in-process map
// counts.
//
// Run with: npm test

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

for (const name of ['KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[name];
process.env.RATE_LIMIT_SECRET = 'fixture';
const { checkRateLimit, consumeRateLimit } = await import('./rate-limit.ts');

const ZONE_BEFORE = process.env.TZ;

/** The UTC midnight after the UTC date of `at`. */
function nextUtcMidnight(at: number): string {
  const d = new Date(at);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

async function resetsAtIn(zone: string, at: number): Promise<{ offset: number; check: string; increment: string }> {
  process.env.TZ = zone;
  mock.timers.enable({ apis: ['Date'], now: at });
  try {
    const offset = new Date(at).getTimezoneOffset();
    const check = (await checkRateLimit('fixture-reader', false)).resets_at;
    const increment = (await consumeRateLimit('fixture-reader', false)).resets_at;
    return { offset, check, increment };
  } finally {
    mock.timers.reset();
  }
}

const INSTANTS = ['2026-11-18T02:00:00.000Z', '2026-11-18T20:00:00.000Z'].map((iso) => Date.parse(iso));
const OFFSETS: Record<string, number> = { 'America/New_York': 300, 'Asia/Tokyo': -540, UTC: 0 };

for (const zone of ['America/New_York', 'Asia/Tokyo', 'UTC']) {
  test(`U1 (#790): under TZ=${zone}, resets_at is the UTC midnight after the key's date`, async () => {
    try {
      const read: Record<string, unknown> = {};
      const expected: Record<string, unknown> = {};
      for (const at of INSTANTS) {
        const iso = new Date(at).toISOString();
        read[iso] = await resetsAtIn(zone, at);
        expected[iso] = { offset: OFFSETS[zone], check: nextUtcMidnight(at), increment: nextUtcMidnight(at) };
      }
      assert.deepEqual(read, expected, `resets_at under TZ=${zone}: ${JSON.stringify(read, null, 1)}`);
    } finally {
      if (ZONE_BEFORE === undefined) delete process.env.TZ;
      else process.env.TZ = ZONE_BEFORE;
    }
  });
}
