// Settlement-era segment for `/api/evidence/[slug]/replay` — the 2026-08-19
// vocabulary settlement (Appendix J of the Typed Standards specification;
// civic-ai-tools#160). `/api/records/*` is the canonical segment name;
// `/api/evidence/*` is a PERMANENT alias, not a deprecation window — published
// links carry the prior-era form and must keep resolving forever.
//
// The handler is defined ONCE, at the prior-era path, and re-exported here, so
// both segments dispatch to the same function object. The direction was
// measured rather than assumed — see `src/app/api/records/segment-alias.test.ts`
// for why the live paths keep their implementations in this phase.
//
// Nothing here advertises the new segment: publish responses, JSON-LD, page
// metadata, share links and the bundle's `detailUrl` all keep emitting the
// prior-era form until the cutover phase flips them.
export { POST } from '@/app/api/evidence/[slug]/replay/route';
