/**
 * Whether the first-consent gate is enforced (#632; W2 shipped it off, W3
 * turns it on).
 *
 * ON since W3, which ships the surfaces that ask: the consent card on every
 * surface that sends a question (the home page, `/explore`, `/ask` and
 * replay's dialog), the Sources panel beside the question box, and the
 * dashboard's Sources tab. The gate (`./consent-gate.ts`) refuses a question
 * with no consent in force, or with no source On, before anything leaves
 * this server, and the surface answers the refusal with the card or the
 * panel. W2 shipped it off, on the owner's ruling, because no surface could
 * yet give a consent.
 *
 * A code constant, never an environment variable: whether readers are asked
 * is a property of the release, not of one instance's configuration.
 * `./consent-enforced.test.ts` pins it, so it cannot be turned off by accident.
 */
export const CONSENT_GATE_ENFORCED: boolean = true;
