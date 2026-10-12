/**
 * The home form's portal picker offers San Francisco at the address its portal
 * answers on, `data.sf.gov`.
 *
 * San Francisco's portal moved from `data.sfgov.org` and answers the old
 * address with a 301. The Socrata server refuses a data query on the old
 * address (npstorey/socrata-mcp-server#78), so an entry still naming it would
 * offer a city whose every query is refused. The hostname guard in
 * `portal-default-is-configured.test.ts` counts both addresses alike, so this
 * is the assertion that tells them apart.
 *
 * This reads `QueryForm.tsx` as text, as `portal-lock-ordering.test.ts` does,
 * because the component does not load under `node --test`. Comment lines in the
 * menu are skipped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync(new URL('../components/QueryForm.tsx', import.meta.url), 'utf8');
const menu = form.match(/const PORTALS = \[([\s\S]*?)\n\];/);

test('the portal picker offers San Francisco as data.sf.gov, and never at its old address', () => {
  assert.ok(menu, 'QueryForm.tsx still declares the PORTALS menu');
  const entries = menu[1].split('\n').filter((line) => !line.trim().startsWith('//'));
  assert.ok(entries.some((line) => /name: 'New York City'/.test(line)), 'the menu was read');
  const sf = entries.filter((line) => /name: 'San Francisco'/.test(line));
  assert.equal(sf.length, 1, `the menu offers San Francisco once: ${JSON.stringify(sf)}`);
  assert.match(sf[0], /id: 'data\.sf\.gov'/, `the San Francisco entry is not data.sf.gov: ${sf[0].trim()}`);
  assert.ok(!entries.some((line) => /data\.sfgov\.org/.test(line)), 'the menu names data.sfgov.org');
});
