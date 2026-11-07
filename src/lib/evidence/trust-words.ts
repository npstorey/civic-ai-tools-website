// The words UX-2 P5 puts on the registry and the analysis page, each in one
// place (#729 words table; G0-10's research ruling, #729 comment 6690939748;
// relay 11 and relay 13). Pure, and safe in a client bundle.
//
// RULED unless marked PENDING. The reviews line's own forms live in
// `review-summary.ts`, the data date's in `data-read-date.ts`.

/** X5: the registry row's first signal. */
export const MADE_BY = (modelName: string): string => `Made by AI-assisted analysis · ${modelName}`;

/** X8: a list request that failed. */
export const LIST_LOAD_FAILED = 'The analyses could not be loaded. Reloading the page tries again.';

/** X10 (G0-5 A; R1's words, relay 11): beside the integrity glance on every signed analysis. */
export const SIGNATURE_MEANING =
  'The signature shows this analysis has not changed since it was recorded. It does not show the answer is correct.';

/** S28: "record" defined once, at the first "record" a reader meets (section B). */
export const RECORD_DEFINED = 'The record is the signed package that holds this analysis.';

/** X6: the signer row. The author is the database's, unsigned; no tier until #69. */
export const SIGNED_BY = (author: string): string => `Signed by this site's key · author ${author} (GitHub)`;

/** X6: the row for a record that carries both anchors (an RFC 3161 token and a transparency-log entry). */
export const TIMESTAMPED = 'Timestamped · registered on the public transparency log';

/**
 * X6: the checks row. PENDING (relay 13, question 1): `<result>` is the label
 * the integrity glance already computes (`summarizeIntegrity`), for the seat
 * to rule at the gate.
 */
export const CHECKS = (result: string): string => `Checks: ${result}`;

/** X9: the disclosure in the actions block. */
export const ABOUT_THIS_PACKAGE = 'About this package';
