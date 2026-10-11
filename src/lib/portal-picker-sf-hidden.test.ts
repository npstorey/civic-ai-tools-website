/**
 * The home form's portal picker does not offer San Francisco while
 * npstorey/socrata-mcp-server#75 is open.
 *
 * San Francisco's portal now answers its old address with a 301 to a new one,
 * and the server's data path does not follow it, so every San Francisco query
 * a reader picks fails (measured in #75, 2026-10-11). The entry is hidden, not
 * re-pointed: the server's own guidance still names the old address, so
 * changing only this menu would be half a fix. When #75 is fixed and the entry
 * is restored, delete this file.
 *
 * This reads `QueryForm.tsx` as text, as `portal-lock-ordering.test.ts` does,
 * because the component does not load under `node --test`. Comment lines in the
 * menu are skipped, so the restore note beside it does not count as an entry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync(new URL('../components/QueryForm.tsx', import.meta.url), 'utf8');
const menu = form.match(/const PORTALS = \[([\s\S]*?)\n\];/);

test('socrata-mcp-server#75: the portal picker offers no San Francisco entry, and says why', () => {
  assert.ok(menu, 'QueryForm.tsx still declares the PORTALS menu');
  const entries = menu[1].split('\n').filter((line) => !line.trim().startsWith('//'));
  assert.ok(entries.some((line) => /name: 'New York City'/.test(line)), 'the menu was read');
  assert.ok(!entries.some((line) => /San Francisco/.test(line)), 'the menu offers San Francisco');
  assert.match(menu[1], /socrata-mcp-server#75/, 'the menu does not say why San Francisco is hidden');
});
