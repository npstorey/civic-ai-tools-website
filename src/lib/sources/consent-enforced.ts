/**
 * Whether the first-consent gate is enforced (#632 W2, the owner's ruling).
 *
 * OFF until W3 ships the consent card. The gate (`./consent-gate.ts`) refuses
 * a question with no consent in force, and in W2 no surface can give one: the
 * card that asks, and the panel that sets each source, are W3's, and W3 waits
 * on the owner's texts. Enforced now, every question on every surface — the
 * home comparison, `/explore`, `/ask` and replay — would be refused. So W2
 * ships the gate dormant: every gated route behaves exactly as before W2 (no
 * refusal, no selection, the router's reasons recorded as it gives them, no
 * flows statement on the record, replay with no replayer selection), while the
 * consent endpoint, its store, `/api/flows`, the re-ask classifier and the
 * privacy page's statements are live. W3 turns this on in the same change as
 * the card.
 *
 * A code constant, never an environment variable: whether readers are asked
 * is a property of the release, not of one instance's configuration.
 * `./consent-enforced.test.ts` pins it, so it cannot flip by accident.
 */
export const CONSENT_GATE_ENFORCED: boolean = false;
