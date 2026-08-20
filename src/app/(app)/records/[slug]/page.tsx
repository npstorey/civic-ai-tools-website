// `/records/[slug]` — the settlement-era address of a published record's
// detail page (Appendix J of the Typed Standards specification;
// civic-ai-tools#160). `/evidence/[slug]` is a PERMANENT alias, not a
// deprecation window: every share link, citation and OG card already published
// carries the prior-era form and must keep resolving forever.
//
// The page is defined ONCE, at the prior-era path, and re-exported here — the
// direction is measured in `src/app/api/records/segment-alias.test.ts`.
//
// `generateMetadata` comes across with it, which means this address emits the
// PRIOR-ERA canonical/OG/citation URL (`…/evidence/<slug>`) for now. That is
// deliberate for this phase: the new segments SERVE, and nothing advertises
// them until the cutover phase flips what the site emits. No route-segment
// config to mirror here — neither address declares any, so both render on
// demand for the same reason (a dynamic segment with no `generateStaticParams`).
export { default, generateMetadata } from '@/app/(app)/evidence/[slug]/page';
