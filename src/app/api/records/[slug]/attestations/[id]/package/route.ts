// Settlement-era segment for `/api/evidence/[slug]/attestations/[id]/package`
// — the 2026-08-19 vocabulary settlement (Appendix J of the Typed Standards
// specification; civic-ai-tools#160). `/api/records/*` is the canonical segment
// name; `/api/evidence/*` is a PERMANENT alias, not a deprecation window.
//
// The handler is defined ONCE, at the prior-era path, and re-exported here, so
// both segments dispatch to the same function object. See
// `src/app/api/records/segment-alias.test.ts`.
export { GET } from '@/app/api/evidence/[slug]/attestations/[id]/package/route';
