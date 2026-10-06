// SITE_SEAL_ONLY (#552): an instance that seals records and never makes one
// public.
//
// The setting is read by `isSealOnly()` in `site-config.ts`, with
// `parseBooleanFlag` as `isPortalLocked()` reads `SITE_PORTAL_LOCKED`: `1` or
// `true` (any case, trimmed) turns it on; unset, or anything else, changes
// nothing. Everything here takes that boolean as an argument and reads no
// environment, so this module is safe in a client bundle: the publish dialog
// and the dashboard import the availability decision and its reason text from
// the same place the two publish routes import their refusals.
//
// WHAT IT REFUSES. A request for the public state, at both routes that create
// one, before any storage write, signing call, database write or evaluation:
//
//   - `POST /api/records` with `visibility: "public"`, its legacy alias
//     `"published"`, or NO `visibility` at all. An absent value is a request
//     for the public state (the API's back-compatible default), so it is
//     refused with the same reason, which names `"sealed"` as the value this
//     instance accepts (ruling G0-3 of #555). `"sealed"` and `"committed"` are
//     untouched.
//   - `POST /api/records/:slug/publish`, which promotes a sealed record to
//     public. Refused beside the signing gate, before the record lookup, so the
//     refusal says nothing about whether a record exists.
//
// WHAT IT DOES NOT TOUCH. A record that is already public stays public and
// readable: publication is not reversible (spec §8.10.3), and this setting
// governs the action going forward, not a state already reached.
//
// Status `403` with `code: "seal_only"`: the request is well-formed and
// authorized, and this instance's configuration forbids the state it asks
// for, the same posture as the unsigned tier's `403 unsigned_tier`
// (`unsigned-tier.ts`). The body has the shape `evaluateSealCommitGate`
// returns, so the routes answer both the same way.

// Relative, extension-bearing import: this module is in the `node --test`
// graph, which resolves neither the `@/` alias nor extensionless specifiers.
import { normalizeVisibility, type Visibility } from './visibility.ts';

/** The `code` both publish routes answer with when the setting refuses. */
export const SEAL_ONLY_CODE = 'seal_only';

/** The HTTP status of that refusal. */
export const SEAL_ONLY_STATUS = 403;

/** A refusal, in the shape `evaluateSealCommitGate` returns. */
export interface SealOnlyRefusal {
  status: number;
  body: { error: string; code: string };
}

const SEAL_ONLY_REASON =
  'This instance seals records only: its operator has turned off the public ' +
  'state (SITE_SEAL_ONLY), so a record cannot be made public here.';

const ALREADY_PUBLIC = 'Records that are already public stay public.';

/** The stated reason `POST /api/records` refuses a request for the public state with. */
export const SEAL_ONLY_RECORDS_MESSAGE =
  `${SEAL_ONLY_REASON} This request asks for the public state, and so does a ` +
  'request that omits visibility, because "public" is the default. Send ' +
  'visibility "sealed" instead: the record is signed, timestamped and ' +
  'registered on the transparency log, and its content stays private to you. ' +
  ALREADY_PUBLIC;

/** The stated reason `POST /api/records/:slug/publish` is refused with. */
export const SEAL_ONLY_PUBLISH_MESSAGE =
  `${SEAL_ONLY_REASON} A sealed record stays sealed. ${ALREADY_PUBLIC}`;

/** What the publish dialog and the dashboard say beside the unavailable option. */
export const SEAL_ONLY_UI_REASON =
  'This instance seals records only: its operator has turned off making ' +
  'records public. Records that are already public stay public.';

/** The dashboard's label for the Publish action it shows disabled. */
export const SEAL_ONLY_DASHBOARD_LABEL = 'Publish unavailable (sealed only)';

/**
 * The visibility a `POST /api/records` body asks for: an absent `visibility`
 * is the public state (back-compatible default), anything else goes through
 * the boundary normalizer, and `null` is a value neither vocabulary accepts
 * (the route's own `400`). The route resolves its visibility through this
 * function, so the seal-only gate and the route cannot disagree about what an
 * absent value means.
 */
export function resolveRequestedVisibility(raw: unknown): Visibility | null {
  return raw === undefined ? 'public' : normalizeVisibility(raw);
}

/**
 * `POST /api/records`: the refusal for a request for the public state while
 * the setting is on, or `null` to proceed. `requested` is the route's resolved
 * visibility (`resolveRequestedVisibility`); `null` there is the route's own
 * `400`, not this gate's.
 */
export function evaluateSealOnlyRecordsGate(
  sealOnly: boolean,
  requested: Visibility | null,
): SealOnlyRefusal | null {
  if (!sealOnly || requested !== 'public') return null;
  return {
    status: SEAL_ONLY_STATUS,
    body: { error: SEAL_ONLY_RECORDS_MESSAGE, code: SEAL_ONLY_CODE },
  };
}

/**
 * `POST /api/records/:slug/publish`: the refusal while the setting is on, or
 * `null` to proceed. The route's only action is the public state, so the
 * setting alone decides.
 */
export function evaluateSealOnlyPublishGate(sealOnly: boolean): SealOnlyRefusal | null {
  if (!sealOnly) return null;
  return {
    status: SEAL_ONLY_STATUS,
    body: { error: SEAL_ONLY_PUBLISH_MESSAGE, code: SEAL_ONLY_CODE },
  };
}

/** Whether the publish dialog offers its public choice, and if not, why. */
export interface PublicStateAvailability {
  available: boolean;
  /** Shown beside the disabled choice; `null` when the choice is available.
   *  Not named `reason`: in a component, a read of `x.reason` is a recorded
   *  tool call's phrase to `src/components/reason-phrase-readers.test.ts`,
   *  which requires it to pass through `reasonWithoutIdentifier`. This text is
   *  this module's own constant, not a call's phrase. */
  explanation: string | null;
}

/** The publish dialog's public choice under this instance's setting. */
export function publicStateAvailability(sealOnly: boolean): PublicStateAvailability {
  return sealOnly
    ? { available: false, explanation: SEAL_ONLY_UI_REASON }
    : { available: true, explanation: null };
}

/**
 * What the dashboard shows as the Publish action on a sealed record.
 *
 *   - `available` — the Publish button.
 *   - `unsigned` — the unsigned tier's disabled action, as before this setting
 *     existed. It wins over `seal_only` because it is the server's first
 *     refusal too: the signing gate runs before this setting's gate on both
 *     routes.
 *   - `seal_only` — disabled, with `label` and `explanation`.
 */
export type SealedRecordPublishAffordance =
  | { kind: 'available' }
  | { kind: 'unsigned' }
  | { kind: 'seal_only'; label: string; explanation: string };

export function sealedRecordPublishAffordance(options: {
  signingConfigured: boolean;
  sealOnly: boolean;
}): SealedRecordPublishAffordance {
  if (!options.signingConfigured) return { kind: 'unsigned' };
  if (options.sealOnly) {
    return { kind: 'seal_only', label: SEAL_ONLY_DASHBOARD_LABEL, explanation: SEAL_ONLY_UI_REASON };
  }
  return { kind: 'available' };
}

/** What the publish dialog says about the sealed state. */
export interface SealedStateCopy {
  /** The Seal choice's description. */
  sealChoice: string;
  /** The line above the sealed record's address, after a seal. */
  sealedResult: string;
}

const SEALED_SUMMARY =
  'Signed, timestamped, and registered on the public transparency log — but the ' +
  'content stays private to you.';
const SEALED_RESULT_SUMMARY =
  'Your record is sealed — signed and registered, content private to you.';

/**
 * The dialog's sealed-state wording under this instance's setting. Off, the
 * two sentences the dialog has always rendered, byte for byte: both point at
 * the dashboard's Publish. On, that Publish is disabled, so neither promises
 * later publication; each says the record stays sealed, and why.
 */
export function sealedStateCopy(sealOnly: boolean): SealedStateCopy {
  if (sealOnly) {
    return {
      sealChoice: `${SEALED_SUMMARY} This instance seals records only, so the record stays sealed.`,
      sealedResult:
        `${SEALED_RESULT_SUMMARY} This instance seals records only, so it stays sealed. ` +
        'Only you can open this page:',
    };
  }
  return {
    sealChoice: `${SEALED_SUMMARY} Publish later from your dashboard.`,
    sealedResult: `${SEALED_RESULT_SUMMARY} Only you can open this page; publish it anytime from your dashboard:`,
  };
}
