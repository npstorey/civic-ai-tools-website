// Next.js instrumentation hook — the one place the server runtime is set up
// before it serves anything.
//
// `register()` runs once per runtime when the server starts, ahead of any
// request, which is what "one dispatcher, installed once" needs (#468).
//
// THE RUNTIME GUARD IS LOAD-BEARING, NOT DEFENSIVE. `src/proxy.ts` gives this
// application a proxy (middleware) bundle, and Next compiles this file for that
// runtime too. `undici` reaches for `node:net`, which the edge runtime does not
// have. `NEXT_RUNTIME` is substituted at build time per compiler, so the guard
// also keeps the import out of the edge bundle entirely rather than merely
// skipping it at run time. The variable is set by the framework and never by an
// operator, which is why `scripts/env-reads-declared.test.mjs` carries it on
// ALLOW beside `NODE_ENV` rather than `ENV_SPEC` demanding a deployment deliver
// it.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Installing is a side effect of the import; with none of the proxy
  // variables set it does nothing at all.
  await import('./lib/outbound-proxy.ts');
}
