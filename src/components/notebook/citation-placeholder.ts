// Pre-publish citation placeholder URL (#227).
//
// Pure module (no 'use client', no JSX) so the URL shape is testable under
// `node --test` — the `buildChatEvidenceView.ts` precedent for keeping
// client-component logic in a checkable form.

/**
 * The placeholder citation URL `ChatCitationPreview` shows before publish:
 * the instance's own `/records/` namespace with `(URL assigned at publish)`
 * where the slug would go. The origin arrives from
 * `getEvidenceSiteOrigin()` (server) via `EvidenceOriginProvider`. With no
 * origin declared (#258: no identity defaults) the placeholder is
 * SITE-RELATIVE — the record will live under this instance's own host,
 * whatever that turns out to be — rather than claiming another deployment's
 * origin.
 */
export function buildCitationPlaceholderUrl(siteOrigin: string | null): string {
  return `${siteOrigin ?? ''}/records/(URL assigned at publish)`;
}
