// @typedstandards/verify-core consumer shim — see ./index.ts.
//
// Kept as a path-stable re-export because a server module deep-imports this exact
// path (`./verify-core/profiles.ts`). It now resolves to the published package rather
// than a local implementation, so there is one source of truth and no drift.
export * from '@typedstandards/verify-core';
