#!/usr/bin/env node
/**
 * Standalone-output asset check (S3b P5).
 *
 * `next build` with `output: 'standalone'` ships only what file tracing
 * found. JavaScript imports are traced reliably; files read at RUNTIME
 * through `node:fs` are not — they survive only because
 * `outputFileTracingIncludes` in `next.config.ts` names them. When that
 * declaration drifts (a moved directory, a renamed route entry, a bundler
 * change), the build still SUCCEEDS and the missing file only surfaces as a
 * 500 the first time a user hits the feature. This check closes that
 * trapdoor: it fails loudly at build time instead.
 *
 * What is checked, for every asset in ASSETS below:
 *   1. the file exists in the standalone output at the path the compiled
 *      server resolves at runtime, and
 *   2. its bytes are identical to the in-repo source (a truncated or stale
 *      copy is as broken as a missing one).
 *
 * Runtime path derivation: the helper loader takes its directory from
 * `import.meta.url` (src/lib/notebook-author/helpers/index.ts). The bundler
 * rewrites that to a project-root-relative lookup, and `server.js` chdirs to
 * the standalone root — so the runtime read lands on
 * `<standalone>/src/lib/notebook-author/helpers/*.py`, which is exactly what
 * `outputFileTracingIncludes` populates. Keep the two in step: if the loader
 * stops deriving its path from the module URL, update ASSETS with it.
 *
 * Usage:
 *   node scripts/check-standalone-assets.mjs                  # .next/standalone
 *   node scripts/check-standalone-assets.mjs --dir <path>     # explicit root
 *   node scripts/check-standalone-assets.mjs --source <path>  # explicit repo root
 *
 * Exit 0 = every asset present and byte-identical; exit 1 = missing,
 * mismatched, or no standalone output at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_STANDALONE_DIR = '.next/standalone';

/**
 * Repo-root-relative paths that must appear at the same relative path inside
 * the standalone output. Each entry names why it is runtime-read, so a
 * future reader knows what breaks when it goes missing.
 */
export const ASSETS = [
  {
    file: 'src/lib/notebook-author/helpers/fetch_socrata.py',
    reason: 'inlined into executed notebooks (ADR-0005 §3); read via node:fs at runtime',
  },
  {
    file: 'src/lib/notebook-author/helpers/fetch_data_commons.py',
    reason: 'inlined into executed notebooks (ADR-0005 §3); read via node:fs at runtime',
  },
  {
    file: 'src/lib/notebook-author/helpers/fetch_opencontext.py',
    reason: 'inlined into executed notebooks (ADR-0005 §3); read via node:fs at runtime',
  },
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Compare every ASSETS entry between a source tree and a standalone output.
 * Pure and injectable so tests can point it at synthetic directories.
 *
 * @returns {{ ok: boolean, results: Array<{ file: string, status: 'ok'|'missing'|'mismatch', detail: string }> }}
 */
export function checkStandaloneAssets({ standaloneDir, sourceRoot = REPO_ROOT, assets = ASSETS }) {
  const results = assets.map(({ file, reason }) => {
    const target = path.join(standaloneDir, file);
    if (!fs.existsSync(target)) {
      return { file, status: 'missing', detail: `not found at ${target} — ${reason}` };
    }
    const sourcePath = path.join(sourceRoot, file);
    const expected = sha256(sourcePath);
    const actual = sha256(target);
    if (expected !== actual) {
      return {
        file,
        status: 'mismatch',
        detail: `sha256 ${actual.slice(0, 12)}… in output vs ${expected.slice(0, 12)}… in source`,
      };
    }
    return { file, status: 'ok', detail: `sha256 ${actual.slice(0, 12)}… (${fs.statSync(target).size} bytes)` };
  });
  return { ok: results.every((r) => r.status === 'ok'), results };
}

function parseArgs(argv) {
  const opts = { dir: DEFAULT_STANDALONE_DIR, source: REPO_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') opts.dir = argv[++i];
    else if (argv[i] === '--source') opts.source = argv[++i];
    else {
      console.error(`error: unknown argument "${argv[i]}"`);
      console.error('usage: check-standalone-assets.mjs [--dir <standalone dir>] [--source <repo root>]');
      process.exit(2);
    }
  }
  return opts;
}

function main() {
  const { dir, source } = parseArgs(process.argv.slice(2));
  const standaloneDir = path.resolve(dir);
  const sourceRoot = path.resolve(source);

  if (!fs.existsSync(standaloneDir)) {
    console.error(`[standalone-assets] FAIL: no standalone output at ${standaloneDir}`);
    console.error('  Build one first:  BUILD_STANDALONE=1 npm run build');
    process.exit(1);
  }

  const { ok, results } = checkStandaloneAssets({ standaloneDir, sourceRoot });
  for (const r of results) {
    const mark = r.status === 'ok' ? 'ok  ' : 'FAIL';
    console.log(`[standalone-assets] ${mark} ${r.file}\n                        ${r.detail}`);
  }

  if (!ok) {
    console.error('');
    console.error('[standalone-assets] FAIL: the standalone output is missing runtime-read files.');
    console.error('  These are read with node:fs at request time, so the server starts fine and');
    console.error('  fails only when a user hits the feature. Fix the `outputFileTracingIncludes`');
    console.error('  entry in next.config.ts (or the loader path it mirrors), rebuild, re-run.');
    process.exit(1);
  }
  console.log(`[standalone-assets] OK — ${results.length} runtime-read asset(s) present and byte-identical`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
