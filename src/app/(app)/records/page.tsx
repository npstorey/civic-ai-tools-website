// `/records` — the settlement-era address of the published-record index
// (Appendix J of the Typed Standards specification; civic-ai-tools#160).
// `/evidence` is a PERMANENT alias, not a deprecation window: published links
// carry the prior-era form and must keep resolving forever.
//
// The page is defined ONCE, at the prior-era path, and re-exported here — the
// direction is measured in `src/app/api/records/segment-alias.test.ts`. Both
// addresses therefore render the same tree, with the same metadata, under the
// same `(app)` layout. As of the cutover (civic-ai-tools#160 P5) the site now
// ADVERTISES this address: the header nav, the index and dashboard cards, the
// marketing links, and every publish response point here.
export { default, metadata } from '@/app/(app)/evidence/page';

// DECLARED, NOT RE-EXPORTED, and the distinction is load-bearing. Next reads
// route-segment config by parsing THIS file's source (`getPageStaticInfo`),
// which sees initialized `export const` declarations and not re-export
// bindings. `export { dynamic } from …` would be invisible to it, and this
// address would prerender at build while `/evidence` kept rendering per
// request — two addresses for one page, silently disagreeing. The literal
// below is the mirror of the one in the page this file re-exports, and the
// alias test pins the pair so they cannot drift apart.
export const dynamic = 'force-dynamic';
