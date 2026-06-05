# verify-core (consumer shim)

> **As of #116 WS3 this directory no longer contains the implementation.** The
> browser-safe §9.2 verification core was published as
> [`@typedstandards/verify-core`](https://www.npmjs.com/package/@typedstandards/verify-core)
> (its source moved to the `typedstandards` monorepo). The files here are thin
> re-export shims so every existing importer keeps working unchanged while the
> single source of truth is the **versioned npm package** — which therefore cannot
> drift from the typedstandards.org browser verifier that consumes the same
> package.

## Why the shims still exist

The server modules deep-import specific paths under this directory
(`./verify-core/canonicalization.ts`, `./verify-core/profiles.ts`,
`./verify-core/blob-ref.ts`, `./verify-core/attestation.ts`,
`./verify-core/signature.ts`) and `@/lib/evidence/verify-core` (the barrel). Each
of those paths is preserved here as a one-line `export * from
'@typedstandards/verify-core'`, so the consumption change is confined to this
directory — the server modules and the production verify route are untouched and
byte-identical.

## History (WS2)

The implementation was originally factored out into this directory in #116 **WS2**
to make the §9.2 check suite browser-safe and dependency-free of Node built-ins,
in preparation for exactly this extraction. See the package README for the
browser-safety contract, check depth, and the `FetchLike` injection model.

## Drift guard

`verify-core.test.ts` runs the WS2 SPKI / algorithm-dispatch / orchestrator-parity
suite **against the consumed package** (via `./index.ts`), plus a version-pin test
asserting the installed package is the expected scope + major. If the published
package ever diverges from what this app expects, these tests fail.

## Browser-safety enforcement moved with the source

The ESLint `no-restricted-imports` rule that used to guard this directory now only
needs to watch the remaining shims (which import the package, nothing from
`node:*`). The real browser-safety guarantee travels with the source: the package
ships a dependency-free guard test that fails its CI if a Node built-in or `Buffer`
ever enters the shipped source.
