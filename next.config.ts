import type { NextConfig } from "next";

/**
 * Standalone output is opt-in via `BUILD_STANDALONE=1` (see `npm run
 * build:standalone`). Unset — every existing build path, including the
 * hosted one — is byte-for-byte the build this repo has always produced;
 * set, `next build` additionally emits `.next/standalone/server.js` with a
 * traced `node_modules`, which is what the container image runs.
 *
 * Standalone tracing is also where runtime-read non-JS assets can silently
 * go missing (see `outputFileTracingIncludes` below), so a standalone build
 * is only trustworthy together with `npm run check:standalone`.
 */
const standalone = process.env.BUILD_STANDALONE === '1';

const nextConfig: NextConfig = {
  ...(standalone ? { output: 'standalone' as const } : {}),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        pathname: '/**',
      },
    ],
  },
  // ADR-0005 §3: Python helper sources live at
  // src/lib/notebook-author/helpers/*.py and are read at runtime by the
  // notebook-author module to embed inline in cell-3 of executed notebooks.
  // Next.js automatic file tracing does not always pick up non-JS files, so
  // we tell it explicitly to bundle them with the executed-notebook route.
  //
  // KEY FORMAT — this is easy to get wrong and fails silently. Next matches
  // each key with `picomatch(key, { contains: true })` against the NORMALIZED
  // ROUTE (`normalizeAppPath('app/api/query-notebook/route')` →
  // '/app/api/query-notebook'), not against a source path. A key written as a
  // file path ('src/app/api/query-notebook/route') therefore matches nothing,
  // the include is dropped, and the build still succeeds — which is exactly
  // the trapdoor `scripts/check-standalone-assets.mjs` exists to catch.
  outputFileTracingIncludes: {
    // DEMO breakage 1 of 2 (never merge): the pre-#281 source-path key form.
    // Next matches keys against generated route strings, never source paths,
    // so this key matches nothing and the include is silently dropped.
    // The static net (standalone-tracing-keys.test.ts) must go red on this.
    'src/app/api/query-notebook/route': [
      './src/lib/notebook-author/helpers/*.py',
    ],
  },

  // Standalone tracing errs toward copying the project directory, so the
  // runtime image ends up carrying the REPOSITORY rather than the
  // application (#179). These excludes trim it back to what serves traffic.
  //
  // Scoped to standalone on purpose: excludes rewrite the per-route
  // .nft.json traces, which the hosted (Vercel) builder also consumes to
  // assemble its functions. Leaving them off unless BUILD_STANDALONE=1 keeps
  // the promise made at the top of this file — with the flag unset, the
  // hosted build is the build this repo has always produced.
  //
  // Excludes are applied AFTER includes are merged, so nothing here may
  // match the helper .py files above. Every pattern below is extension- or
  // directory-scoped away from them.
  ...(standalone
    ? {
        outputFileTracingExcludes: {
          // '**' matches every route: these are not per-route concerns.
          '**': [
            // DEMO breakage 2 of 2 (never merge): strips the runtime-read
            // helpers from the traced modules. Measured 2026-08-19 under
            // Turbopack 16.3.0: breakage 1 alone does NOT fail the build —
            // the helpers still ship as traced modules (the loader's node:fs
            // read is statically traced), so the empirical net only fires
            // when this exclude removes them AND the inert key above fails
            // to re-add them. Together they make `npm run check:standalone`
            // exit 1.
            'src/lib/notebook-author/helpers/**',
            // Documentation and process material.
            'docs/**',
            'sprints/**',
            '*.md',
            // Build/dev tooling. The server runs none of it; keeping it out
            // is also what stops a built image from being a place to run
            // repository scripts.
            'scripts/**',
            'drizzle/**',
            'drizzle.config.ts',
            'eslint.config.mjs',
            'postcss.config.mjs',
            'tsconfig.json',
            'package-lock.json',
            '*.tsbuildinfo',
            // Container / CI definitions describe how to build and deploy
            // the image; the image itself has no use for them.
            'Dockerfile',
            'docker-compose.yml',
            'docker/**',
            '.github/**',
            // Untracked local scratch (gitignored). Nothing guarantees a
            // build host is clean, and an operator's scratch directory must
            // never become part of a published image.
            'temp/**',
            // TypeScript/React/CSS sources are compiled into
            // .next/server chunks; nothing loads them from disk at runtime.
            // (Tracing lists them because driver seams use dynamic imports
            // written with explicit .ts specifiers — e.g.
            // `await import('./s3.ts')` in src/lib/storage/index.ts — but
            // the compiled chunk is what actually runs.)
            'src/**/*.ts',
            'src/**/*.tsx',
            'src/**/*.css',
            // Font sources are emitted into .next/static at build time and
            // served from there.
            'src/fonts/**',
            // Talk decks are read only by generateStaticParams at build
            // time; the route is force-static with dynamicParams = false, so
            // the standalone server never touches _decks/.
            'src/app/**/_decks/**',
          ],
        },
      }
    : {}),
};

export default nextConfig;
