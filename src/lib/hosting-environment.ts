/**
 * The deployment environment this process runs in: `VERCEL_ENV` (set by the
 * platform: `production`, `preview` or `development`), or `local` off it.
 * Any value of one to sixteen lowercase letters passes through, so a hosted
 * source's sandbox name (`src/lib/mcp/hosting/lifecycle.ts`) carries whatever
 * the platform set.
 *
 * A LEAF, ON PURPOSE (R6 W5, #632 ruling a). It imports nothing, so a module
 * that needs the environment — the usage counter, on every query route —
 * does not load the hosting module, which loads the sandbox SDK. Before this
 * module the function lived in `lifecycle.ts`, which every route loads only
 * for a hosted call (`client.ts`), and `lifecycle.ts` re-exports it from here
 * unchanged.
 */
export function hostingEnvironment(): string {
  const raw = process.env.VERCEL_ENV?.trim().toLowerCase() ?? '';
  return /^[a-z]{1,16}$/.test(raw) ? raw : 'local';
}
