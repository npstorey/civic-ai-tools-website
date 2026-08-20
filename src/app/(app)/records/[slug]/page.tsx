// `/records/[slug]` — the settlement-era address of a published record's
// detail page (Appendix J of the Typed Standards specification;
// civic-ai-tools#160). `/evidence/[slug]` is a PERMANENT alias, not a
// deprecation window: every share link, citation and OG card already published
// carries the prior-era form and must keep resolving forever.
//
// The page is defined ONCE, at the prior-era path, and re-exported here — the
// direction is measured in `src/app/api/records/segment-alias.test.ts`.
//
// `generateMetadata` comes across with it. As of the cutover (civic-ai-tools#160
// P5) that shared implementation emits the SETTLEMENT-ERA canonical/OG/citation
// URL (`…/records/<slug>`), so both addresses declare the same canonical one --
// which is the point: a reader arriving at either address is pointed at the
// address the site now advertises, while the prior-era address keeps serving.
// No route-segment config to mirror here — neither address declares any, so both render on
// demand for the same reason (a dynamic segment with no `generateStaticParams`).
export { default, generateMetadata } from '@/app/(app)/evidence/[slug]/page';
