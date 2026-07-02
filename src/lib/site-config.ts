// Site-wide external URLs. Import from here rather than hard-coding hrefs so
// each destination can be changed in one place.

/** The Typed Standards protocol site — spec home and neutral verifier. */
export const TYPED_STANDARDS_URL = 'https://typedstandards.org';

/**
 * Where "express interest" / contact links point.
 *
 * WS3 swap point: when a dedicated express-interest destination exists,
 * changing this one line re-points every contact entry on the site
 * (home positioning band + /about + /project). Links out only — no embedded form.
 */
export const EXPRESS_INTEREST_URL = 'https://nathanstorey.com/contact/';

/**
 * Optional sponsor acknowledgment line, rendered in the global footer and the
 * /about "Who built this" section when non-null. While null, both mounts
 * render nothing — zero visual change.
 *
 * The approved sentence arrives from the comms side; do not draft or guess it
 * here. When it lands, it is additive to — never a replacement for — the
 * existing "Personal project · Not affiliated with any employer." line.
 */
export const SPONSOR_LINE: string | null = null;
