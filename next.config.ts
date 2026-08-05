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
  outputFileTracingIncludes: {
    'src/app/api/query-notebook/route': [
      './src/lib/notebook-author/helpers/*.py',
    ],
  },
};

export default nextConfig;
