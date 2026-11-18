// CKAN-2-WEB P2 criterion 5 (npstorey/civic-ai-tools#329; N8, F1 = (a), 6967153721, Seat ruling 6992847297 fixes 1 and
// 3): the operator text about `CKAN_MCP_URL` says what router 0.12.0 offers, and no text says the server reaches only
// the portals its operator lists.
//
// WHAT IS READ. The three places that still named the retired Analyze Boston pack or the old boundary at `c451a735`:
//   - `scripts/preflight-env.mjs`: the comment above `CKAN_MCP_URL`'s row and its `purpose`, read from `ENV_SPEC`;
//   - `src/lib/mcp/fixtures/statement-check-postgres16.json`: its `_about`, which called the tool "a CKAN pack's";
//   - `docs/deploy.md`: `CKAN_MCP_URL`'s row, three sentences replaced and one removed.
// And a scan of the tracked files under `src/` and `docs/` for the two phrases 6967153721 rules out, each hit listed
// with why it stays. Test files are out of the scan: none is text the site shows.
//
// WHAT MAKES IT ABLE TO FAIL. At the base each place reads its old words, so each test fails at an assertion there. The
// scan is a guard: at the base it lists four hits, the deploy.md sentence P2 replaces among them, so it is red there;
// after P2 it is shown able to fail by a mutation run (one phrase written back into a tracked file, run red, reverted;
// P2's report). The phrases are built from parts below, so this file is not one of its own hits.
//
// BLIND SPOTS, stated. The scan reads two phrases, not every way of saying the same thing; the router's own texts (in
// the installed package, not tracked here) are the hub's to change (the seat's follow-up).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('N8: preflight\'s CKAN_MCP_URL comment and purpose say what router 0.12.0 offers, and name no pack', async () => {
  const { ENV_SPEC } = (await import(pathToFileURL(path.join(ROOT, 'scripts', 'preflight-env.mjs')).href)) as { ENV_SPEC: { name: string; purpose: string }[] };
  const row = ENV_SPEC.find((r) => r.name === 'CKAN_MCP_URL');
  assert.ok(row, 'premise: preflight declares CKAN_MCP_URL');
  assert.equal(row!.purpose, 'Hosted CKAN MCP server endpoint — opt-in: set, the CKAN source is offered, its seven tools each naming a CKAN portal in server_url; unset, it is not offered to a run (no tools, no guidance, no record entry). No default');
  const text = read('scripts/preflight-env.mjs');
  const at = text.indexOf("{ name: 'CKAN_MCP_URL'");
  const comment = text.slice(text.lastIndexOf('// The hosted CKAN server', at), at);
  assert.equal(comment, [
    '// The hosted CKAN server (router 0.12.0, CKAN-2-WEB P1): opt-in, like Boston',
    '  // OpenContext. Set, it offers the CKAN source, whose calls each name the CKAN',
    '  // portal they read; unset, it is not offered. No default.',
    '  ',
  ].join('\n'));
  assert.ok(!/pack|Analyze Boston/.test(comment + row!.purpose), 'the comment or the purpose names a pack');
});

test('N8: the statement-check fixture\'s _about calls the tool the CKAN server\'s own', () => {
  const about = (JSON.parse(read('src/lib/mcp/fixtures/statement-check-postgres16.json')) as { _about: string })._about;
  assert.ok(about.startsWith("The statement check of the CKAN server's own ckan_datastore_search_sql, offered as ckan__ckan_datastore_search_sql (src/lib/mcp/pack-filter.ts, isOneSelectOrWithStatement), held to a real server."), `_about: ${about.slice(0, 200)}`);
  assert.ok(!/CKAN pack|pack's/.test(about), '_about still names a pack');
});

const row = () => {
  const line = read('docs/deploy.md').split('\n').find((l) => l.startsWith('| `CKAN_MCP_URL` |'));
  assert.ok(line, 'premise: deploy.md has a CKAN_MCP_URL row');
  return line!;
};

test('N8: deploy.md\'s CKAN_MCP_URL row: each call names a portal (F1 = (a))', () => {
  assert.ok(row().includes('It offers seven tools of its own, and each call names a portal in `server_url`: `ckan__ckan_package_search`'), 'the first replacement is not in the row');
  assert.ok(!row().includes('each call naming the portal it reads'), 'the replaced words are still in the row');
});

test('N8: deploy.md\'s CKAN_MCP_URL row states nothing about the reference deployment\'s setting (6992847297 fix 1)', () => {
  assert.ok(!row().includes('reference deployment'), 'the row states the reference deployment\'s setting');
  assert.ok(row().includes('The Analyze Boston pack that router 0.11.0 offered over it is retired. There is no coded default:'), 'the sentence after the removed one does not follow the one before it');
});

test('N8: deploy.md\'s CKAN_MCP_URL row: the boundary as the server\'s PIN.md states it (6967153721; 6992847297 fix 3)', () => {
  assert.ok(row().includes(' The server refuses a call that names a host its operator has not listed; this site keeps no copy of that list, and a refusal is recorded as a rejected call. For the seven tools this site offers, a call that names a listed host can still reach another host: the API host the server uses for three listed portals, or another listed host a redirect passes the request to (the server\'s `PIN.md`, "Outbound hosts"). `ckan_datastore_search_sql` is held'), 'the replacement is not in the row, in its place');
  assert.ok(!row().includes('reads only the portals its operator lists'), 'the replaced sentence is still in the row');
});

test('6967153721: no tracked text under src/ or docs/ says the server reaches only the portals its operator lists', () => {
  const phrases = [['only', 'the', 'portals'].join(' '), ['only', 'listed'].join(' ')];
  const out = execFileSync('git', ['grep', '-n', '-i', ...phrases.flatMap((p) => ['-e', p]), '--', 'src', 'docs', ':(exclude)*.test.ts', ':(exclude)*.test.tsx'], { cwd: ROOT, encoding: 'utf8' });
  const hits = out.split('\n').filter(Boolean).map((line) => {
    const [file, , ...rest] = line.split(':');
    return `${file}: ${rest.join(':').trim().slice(0, 80)}`;
  });
  // Each hit that stays, and why: each is about the portals a run's calls named, not about which portals the server
  // can reach.
  assert.deepEqual(hits, [
    'docs/deploy.md: | `SITE_DEFAULT_PORTAL` | The default portal a query runs against when the reade',
    'src/app/api/query-notebook/route.ts: // only the portals its tool calls actually named.',
    'src/lib/streaming.ts: // stays: it names only the portals the calls named.',
  ]);
  const siteDefault = out.split('\n').find((l) => l.startsWith('docs/deploy.md:'))!;
  assert.ok(siteDefault.includes('states ' + ['only', 'the', 'portals'].join(' ') + ' its own calls named'), 'premise: the SITE_DEFAULT_PORTAL hit is about the portals a run\'s calls named');
});
