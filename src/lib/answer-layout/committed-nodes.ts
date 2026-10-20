// The layout nodes this instance has committed under `public/.well-known/layouts/`
// (LAYOUT-WEB W4 P2, ruling D4 = A), as build-time imports.
//
// WRITTEN BY `scripts/publish-layout.ts --apply`, which adds one import per node
// document it writes; a node file is never removed, so its id stays resolvable.
// Nothing reads `public/.well-known/layouts/` from disk at run time: Next.js
// bundles each JSON document into the server's module graph at build, as it
// bundles the trust registry (`src/lib/evidence/verify.ts`).
//
// The list holds node documents (the §9.4 view with the package inline). The
// sibling `<nodeId>.proofs.json` files are not imported: nothing on the site
// reads them; they are for verifiers outside it.

export const COMMITTED_LAYOUT_DOCUMENTS: readonly unknown[] = [
];
