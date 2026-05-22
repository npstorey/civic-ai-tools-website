import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
