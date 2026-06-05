import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Browser-safety guard for verify-core (civic-ai-tools-website#116 WS2): the
  // verification core must stay dependency-free so it runs unchanged in the
  // browser and extracts cleanly to an npm package. A future Node-only import
  // here fails CI rather than the browser at runtime.
  {
    files: ["src/lib/evidence/verify-core/**/*.ts"],
    // Tests for verify-core run in Node and legitimately use node:test / crypto
    // (e.g. to generate fixtures and assert parity with the old node path).
    ignores: ["src/lib/evidence/verify-core/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "crypto", message: "verify-core must be browser-safe — use @noble/hashes / @noble/curves, not node:crypto." },
            { name: "node:crypto", message: "verify-core must be browser-safe — use @noble/hashes / @noble/curves, not node:crypto." },
            { name: "fs", message: "verify-core must be browser-safe — no filesystem; pass data in." },
            { name: "node:fs", message: "verify-core must be browser-safe — no filesystem; pass data in." },
            { name: "fs/promises", message: "verify-core must be browser-safe — no filesystem; pass data in." },
            { name: "node:fs/promises", message: "verify-core must be browser-safe — no filesystem; pass data in." },
            { name: "path", message: "verify-core must be browser-safe — no path; pass data in." },
            { name: "node:path", message: "verify-core must be browser-safe — no path; pass data in." },
            { name: "process", message: "verify-core must be browser-safe — no process.env; inject config." },
            { name: "node:process", message: "verify-core must be browser-safe — no process.env; inject config." },
          ],
          patterns: [
            { group: ["node:*"], message: "verify-core must be browser-safe — no Node built-ins." },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
