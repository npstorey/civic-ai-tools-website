/**
 * UX-2 P3b-2 (#729; Q7 = A): the composer offers no portal menu.
 *
 * Until P3b-2 the home form's Advanced-options region carried a portal picker,
 * a `PORTALS` list in `QueryForm.tsx`, and this file held its San Francisco
 * entry at the address that portal answers on (`data.sf.gov`; the old
 * `data.sfgov.org` answers with a 301 and the Socrata server refuses a data
 * query there, npstorey/socrata-mcp-server#78). P3b-2 removes the picker with
 * the region (Q7 = A): a run's portal is the instance's default, or the one an
 * example question sets (`QueryForm.tsx` `handleExampleClick`), which
 * `QuerySurface` resolves. The lost choice is stated in the gate record. With
 * no list left, there is no entry to read; `portal-default-is-configured.test.ts`
 * still counts every portal hostname in the tree, both San Francisco addresses
 * alike, so a list that came back would be counted there.
 *
 * WHAT IS READ. The composer's source as text, as `portal-lock-ordering.test.ts`
 * reads it (the components do not load under `node --test` as source reads):
 * `QueryForm.tsx` and every tracked file under `src/components/composer/`.
 *
 * WHAT MAKES IT ABLE TO FAIL. At P3b-2's base `QueryForm.tsx` declares
 * `const PORTALS = [` and renders "Data portal".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = ['src/components/QueryForm.tsx', ...execFileSync('git', ['ls-files', '--', 'src/components/composer'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))];

test('UX-2 P3b-2 (Q7 = A): the composer declares no PORTALS menu, keeps no portal dropdown, and says "Data portal" nowhere', () => {
  assert.ok(files.length >= 3, `premise: the scan reads QueryForm.tsx and the composer's files: ${files.join(', ')}`);
  const found = files.flatMap((f) => {
    const text = readFileSync(path.join(ROOT, f), 'utf8');
    return [
      /\bconst PORTALS\b/.test(text) ? `${f}: declares PORTALS` : null,
      /portalDropdownRef|portalOpen/.test(text) ? `${f}: keeps a portal dropdown` : null,
      /Data portal/.test(text) ? `${f}: says "Data portal"` : null,
    ].filter((x): x is string => x !== null);
  });
  assert.deepEqual(found, []);
});
