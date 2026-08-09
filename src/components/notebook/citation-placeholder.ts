// Pre-publish citation placeholder URL (#227).
//
// Pure module (no 'use client', no JSX) so the URL shape is testable under
// `node --test` — the `buildChatEvidenceView.ts` precedent for keeping
// client-component logic in a checkable form.

/**
 * The placeholder citation URL `ChatCitationPreview` shows before publish:
 * the instance's own `/evidence/` namespace with `(URL assigned at publish)`
 * where the slug would go. The origin arrives from
 * `getEvidenceSiteOrigin()` (server) via `EvidenceOriginProvider`; with no
 * environment set that is `DEMO_SITE_ORIGIN` and the result is
 * byte-identical to the historical hardcoded string.
 */
export function buildCitationPlaceholderUrl(siteOrigin: string): string {
  return `${siteOrigin}/evidence/(URL assigned at publish)`;
}
