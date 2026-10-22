// #644 W2 criterion 6: the guide and the preflight state the consent pause.
//
//   - `docs/deploy.md` states the pause, that it happens only under
//     `SOURCE_ROUTING=in-loop`, the store it keeps its entry in, the entry's
//     expiry, the no-store branch and [D] the reader code, beside "In-loop
//     routing"; and that section no longer says an Ask-first load is simply
//     declined.
//   - The KV pair's purpose names the pause, in the preflight's rows and the
//     guide's.
//   - [D] The guide's outbound row for the store keeps its first cell (the
//     key the privacy page's statement is held under,
//     `privacy-recipients.test.ts`) and its third ("yes": the client honours
//     the proxy variables), and its second cell names `decision.ts` beside
//     the limiter, since both reach the store through the same client.
//
// Read by grep over the files, as the guide's other criteria are.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/sources/decision-guide.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENV_SPEC } from '../../../scripts/preflight-env.mjs';

const GUIDE = readFileSync(new URL('../../../docs/deploy.md', import.meta.url), 'utf8');

/** The section from `heading` to the next heading of the same level or above. */
function section(heading: string): string {
  const start = GUIDE.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `docs/deploy.md has no "${heading}" heading`);
  const level = heading.match(/^#+/)![0].length;
  const rest = GUIDE.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
}

test('criterion 6: the guide states the pause, in-loop only, its store, its expiry, the no-store branch and the reader code', () => {
  const pause = section('### The consent pause');
  for (const [what, pattern] of [
    ['the pause', /stops? to ask the reader/i],
    ['in-loop only', /only (under|when) `SOURCE_ROUTING=in-loop`/],
    ['the store', /`KV_REST_API_URL`[^.]*`KV_REST_API_TOKEN`/],
    ['the entry and its key', /`consent-decision:<key>`/],
    ['the expiry', /10 minutes|600 seconds/],
    ['the bound', /60 seconds/],
    ['the run\'s bound', /120 seconds/],
    ['the no-store branch', /no store[^.]*`no-answer`|`no-answer`[^.]*no store/i],
    ['the reader code [D]', /HMAC-SHA256[^.]*`RATE_LIMIT_SECRET`/],
    ['the decision route', /`POST \/api\/sources\/consent\/decision`/],
  ] as const) {
    assert.match(pause, pattern, `the guide's pause section does not state ${what}`);
  }
});

test('criterion 6: "In-loop routing" no longer says an Ask-first load is simply declined', () => {
  const inLoop = section('## In-loop routing');
  assert.ok(!inLoop.includes('Loading a source set to Ask first sends nothing to it and records `declined`.'), 'the base\'s sentence is still there');
  assert.match(inLoop, /Ask first/);
});

test('criterion 6: the KV pair\'s purpose names the consent pause, in the preflight and the guide', () => {
  for (const name of ['KV_REST_API_URL', 'KV_REST_API_TOKEN']) {
    const row = (ENV_SPEC as Array<{ name: string; purpose: string }>).find((r) => r.name === name);
    assert.ok(row?.purpose.includes('needed by the consent pause'), `${name}'s purpose: ${row?.purpose}`);
  }
  const guideRow = GUIDE.split('\n').find((line) => line.startsWith('| `KV_REST_API_URL` + `KV_REST_API_TOKEN` |'));
  assert.ok(guideRow?.includes('needed by the consent pause'), `the guide's row: ${guideRow}`);
});

test('criterion 6 [D]: the store\'s outbound row keeps its first and third cells, and names decision.ts', () => {
  const row = GUIDE.split('\n').find((line) => line.startsWith('| Rate-limit counter, `KV_REST_API_URL` set |'));
  assert.ok(row, 'the outbound row for the store lost its first cell');
  const cells = row!.split(' | ');
  assert.match(cells[1], /`src\/lib\/rate-limit\.ts`/);
  assert.match(cells[1], /`src\/lib\/sources\/decision\.ts`/, 'the row does not name decision.ts');
  assert.equal(cells[2].replace(/\s*\|\s*$/, ''), 'yes');
});
