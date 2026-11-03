/**
 * The deployment environment this process runs in, as the platform names it:
 * `VERCEL_TARGET_ENV` when it is set (`production`, `preview`, `development`,
 * or a custom environment's own name, such as `staging`), else `VERCEL_ENV`
 * (`production`, `preview` or `development`), or `local` off the platform.
 * Any value of one to sixteen lowercase letters passes through, so a hosted
 * source's sandbox name (`src/lib/mcp/hosting/lifecycle.ts`) carries whatever
 * the platform set.
 *
 * WHY TWO VARIABLES (#717). On a custom environment the platform sets
 * `VERCEL_ENV` to `preview` and puts the environment's own name in
 * `VERCEL_TARGET_ENV` (Vercel's system environment variables page). Read
 * alone, `VERCEL_ENV` counted staging's questions as a preview's and would
 * have given staging's hosted sources the previews' sandbox names. On
 * production and previews the platform sets both to the same value, so they
 * read as before.
 *
 * A NAME THE GUARD REFUSES. A custom environment whose name is not one to
 * sixteen lowercase letters (a digit, a hyphen, or a longer name) falls back
 * to `VERCEL_ENV`, which reads `preview` there, as it did before #717: such
 * an environment still counts as a preview and still shares the previews'
 * sandbox names, so it needs the previews' `SOURCE_BRIDGE_SECRET`.
 *
 * A LEAF, ON PURPOSE (R6 W5, #632 ruling a). It imports nothing, so a module
 * that needs the environment — the usage counter, on every query route —
 * does not load the hosting module, which loads the sandbox SDK. Before this
 * module the function lived in `lifecycle.ts`, which every route loads only
 * for a hosted call (`client.ts`), and `lifecycle.ts` re-exports it from here
 * unchanged.
 */
export function hostingEnvironment(): string {
  return environmentName(process.env.VERCEL_TARGET_ENV) ?? environmentName(process.env.VERCEL_ENV) ?? 'local';
}

/** One to sixteen lowercase letters, after trimming and lowercasing; anything else is no name. */
function environmentName(value: string | undefined): string | null {
  const raw = value?.trim().toLowerCase() ?? '';
  return /^[a-z]{1,16}$/.test(raw) ? raw : null;
}
