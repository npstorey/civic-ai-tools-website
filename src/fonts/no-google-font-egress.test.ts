/**
 * Guard: no source file may load a typeface over the network (#225).
 *
 * `next/font/google` fetches from `fonts.googleapis.com` at BUILD time, and
 * since Next.js 16.2.11 an unreachable host hard-fails the build instead of
 * warning and falling back — which breaks the restricted-egress build
 * environments the operator container path in docs/deploy.md exists for.
 * The fonts are self-hosted in this directory for that reason.
 *
 * A machine with open egress cannot notice a regression here: re-adding a
 * `next/font/google` import builds perfectly well on Vercel and in CI, and
 * only fails for the operator who cannot reach Google. This test is the
 * cheap always-on half of that check; `scripts/build-without-font-egress.mjs`
 * is the expensive half that proves the whole build offline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [full] : [];
  });
}

test('no source file imports next/font/google', () => {
  const offenders = sourceFiles(SRC_ROOT).filter(
    (file) =>
      file !== fileURLToPath(import.meta.url) &&
      /from\s+['"]next\/font\/google['"]|require\(['"]next\/font\/google['"]\)/.test(
        fs.readFileSync(file, 'utf8'),
      ),
  );

  assert.deepEqual(
    offenders.map((file) => path.relative(SRC_ROOT, file)),
    [],
    'Typefaces are self-hosted (src/fonts/, loaded by next/font/local) so that ' +
      'builds need no egress to fonts.googleapis.com — see #225. Add the .woff2 ' +
      'to src/fonts/ and a src entry to the localFont() call in src/app/layout.tsx ' +
      'instead of importing next/font/google.',
  );
});
