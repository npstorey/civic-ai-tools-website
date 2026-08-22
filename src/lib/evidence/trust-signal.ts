// Trust-signal vocabulary — the severity taxonomy that turns each verify-library
// status into a calm, plain-language signal (civic-ai-tools-website#110, Wave 0).
//
// One idea threads the evidence trust-communication surfaces: every verification
// status renders as `{ tier, icon, plain-language one-liner }`, defined once here
// and reused. The load-bearing requirement is that a pre-v0.1 (legacy) package —
// which produces many "not ok but expected" statuses — reads CALM, never as a
// string of failures. See docs/trust-signal-vocabulary.md for the full taxonomy
// and the resolved judgment calls.
//
// Scope discipline (#110): this is presentational vocabulary only. It changes NO
// verification behavior and is wired into NO live panel — that is #111.
//
// Total coverage holds *by construction*: each status space is keyed with
// `Record<Status, ...>`, so a status added upstream grows the union type and the
// compiler then demands a tier here. The status TYPES are the verify-library's
// source-of-truth const-arrays' element types (e.g. `KEY_TRUST_STATUSES`), and
// the coverage test iterates those same arrays at runtime — the array and this
// map cannot drift. The imports below are TYPE-ONLY, so this module carries no
// runtime dependency on the verify library (and thus no node:crypto): it is pure
// data and safe to import from a client component (see `<TrustSignal>`).
//
// Design-principles cited by number (docs/design-principles.md): P1 disclosure ≠
// validation, P3 no false precision, P5 narrative bridge, P9 user language.

import type {
  ContentCanonicalizationStatus,
  ContentHashStatus,
  KeyTrustStatus,
  TypeResolutionStatus,
  SignerIdentityCheckStatus,
  CaptureMethodVocabStatus,
  LifecycleStatus,
  LifecycleSource,
} from './verify.ts';
import type { BlobRefVerifyReason } from './blob-ref.ts';
import type { CaptureMethod } from './packager.ts';

// --- Tiers ---------------------------------------------------------------

/**
 * The four severity tiers. "Not `ok`" does not mean "broken":
 *   - `verified`  — green; an affirmative check passed.
 *   - `normal`    — neutral/calm/informational. "Not ok" but EXPECTED (every
 *                   pre-v0.1 legacy status lands here). NOT a warning.
 *   - `attention` — amber; something UNCONFIRMED / unrecognized, not proven-bad.
 *   - `alarm`     — red; a genuine integrity failure.
 */
export type TrustTier = 'verified' | 'normal' | 'attention' | 'alarm';

/** The four in-house glyphs, one per tier. Names only — the SVGs live in the
 *  presentational `<TrustSignal>` component (client-side). */
export type TrustIconName = 'check' | 'info' | 'warning' | 'error';

export interface TrustSignalDescriptor {
  tier: TrustTier;
  /** The glanceable plain-language one-liner (P5 glance layer, P9 user
   *  language). Disclosure, never validation (P1). */
  label: string;
  /** Optional expand-on-demand sentence (P5 narrative bridge / P8). */
  detail?: string;
}

export interface TierMeta {
  /** The tier's default glyph (overridable per-instance in the component). */
  icon: TrustIconName;
  /** CSS custom-property reference for the tier color (globals.css). */
  colorVar: string;
  /** aria-label applied to the tier glyph. */
  ariaLabel: string;
}

/**
 * Canonical tier → { icon, color, aria } mapping. The single source of truth for
 * tier visuals: the `<TrustSignal>` component consumes this directly (it is a
 * client-safe value because this module is pure data). `--warning` is aliased
 * to the existing `--caution` amber (added in globals.css for #110); the
 * other three tokens predate this change.
 */
export const TIER_META: Record<TrustTier, TierMeta> = {
  verified: { icon: 'check', colorVar: 'var(--success)', ariaLabel: 'Verified' },
  normal: { icon: 'info', colorVar: 'var(--text-muted)', ariaLabel: 'Informational' },
  attention: { icon: 'warning', colorVar: 'var(--warning)', ariaLabel: 'Attention' },
  alarm: { icon: 'error', colorVar: 'var(--error)', ariaLabel: 'Alarm' },
};

/** A descriptor plus the icon its tier resolves to — the full `status →
 *  { tier, icon, copy }` shape. */
export interface ResolvedTrustSignal extends TrustSignalDescriptor {
  icon: TrustIconName;
}

/** Attach the tier's default icon to a descriptor. */
export function toResolvedSignal(d: TrustSignalDescriptor): ResolvedTrustSignal {
  return { ...d, icon: TIER_META[d.tier].icon };
}

// --- Boolean-state normalizers -------------------------------------------
//
// Several verify checks are tri-state booleans (true / false / null) or
// bi-state (true / false). We key their signal maps on string forms so the
// maps stay plain data and the coverage test can enumerate them.

export type BiStateKey = 'true' | 'false';
export type TriStateKey = 'true' | 'false' | 'null';

export const BI_STATE_KEYS: readonly BiStateKey[] = ['true', 'false'];
export const TRI_STATE_KEYS: readonly TriStateKey[] = ['true', 'false', 'null'];

export function biKey(v: boolean): BiStateKey {
  return v ? 'true' : 'false';
}
export function triKey(v: boolean | null | undefined): TriStateKey {
  return v === null || v === undefined ? 'null' : v ? 'true' : 'false';
}

// =========================================================================
// Per-check status → descriptor maps, ordered by spec §9.2 check number.
// =========================================================================

// --- #1 Envelope integrity (hashMatch: boolean) --------------------------

export const ENVELOPE_INTEGRITY_SIGNALS: Record<BiStateKey, TrustSignalDescriptor> = {
  true: {
    tier: 'verified',
    label: 'Contents unchanged since signing',
    detail: 'The bytes of this package match the hash that was signed.',
  },
  false: {
    tier: 'alarm',
    label: 'Contents changed since signing',
    detail:
      'The recomputed hash does not match the signed package — it may have been altered.',
  },
};
export const resolveEnvelopeIntegrity = (hashMatch: boolean): TrustSignalDescriptor =>
  ENVELOPE_INTEGRITY_SIGNALS[biKey(hashMatch)];

// --- #2 Signature mathematics (signatureValid: boolean | null) -----------

export const SIGNATURE_SIGNALS: Record<TriStateKey, TrustSignalDescriptor> = {
  true: {
    tier: 'verified',
    label: 'Valid cryptographic signature',
    detail: 'The signature verifies against the signing key.',
  },
  false: {
    tier: 'alarm',
    label: 'Signature does not verify',
    detail: 'The signature could not be validated against the signing key.',
  },
  null: {
    tier: 'normal',
    label: 'Not signed',
    detail: 'This package carries no cryptographic signature.',
  },
};
export const resolveSignature = (v: boolean | null): TrustSignalDescriptor =>
  SIGNATURE_SIGNALS[triKey(v)];

// --- #3 Content canonicalization rule resolution -------------------------

export const CONTENT_CANONICALIZATION_SIGNALS: Record<
  ContentCanonicalizationStatus,
  TrustSignalDescriptor
> = {
  ok: { tier: 'verified', label: 'Canonicalization rule recognized' },
  implicit: {
    tier: 'normal',
    label: 'Canonicalization inferred (earlier-format package)',
    detail:
      'This package predates explicit canonicalization labeling; the rule was inferred from its content profile.',
  },
  unknown_canonicalization_rule: {
    tier: 'attention',
    label: 'Unrecognized canonicalization rule',
    detail:
      'This package names a canonicalization rule this verifier does not recognize, so its content hash cannot be recomputed.',
  },
};

// --- #4 Content hash verification (THE load-bearing split) ---------------

export const CONTENT_HASH_SIGNALS: Record<ContentHashStatus, TrustSignalDescriptor> = {
  ok: {
    tier: 'verified',
    label: 'Content matches its fingerprint',
    detail: 'The off-log content hashes to the value the signature covers.',
  },
  // Load-bearing: applies to EVERY pre-v0.1 package. Must read calm.
  legacy_relabeled: {
    tier: 'normal',
    label: 'Earlier-format content fingerprint',
    detail:
      'This package predates multi-hash content fingerprints; its original single hash is shown as-is, and its integrity is established by the envelope check.',
  },
  // Load-bearing: the same check as legacy_relabeled, opposite tier — off-log
  // content was altered after signing.
  content_hash_mismatch: {
    tier: 'alarm',
    label: 'Content does not match its fingerprint',
    detail:
      'The off-log content does not hash to the signed value — it may have been altered.',
  },
  unresolved_rule: {
    tier: 'attention',
    label: 'Content hash not recomputed (unknown rule)',
    detail:
      'The canonicalization rule could not be resolved, so the content hash was not recomputed.',
  },
  contentHash_no_supported_algorithm: {
    tier: 'attention',
    label: 'Content hash uses an unsupported algorithm',
    detail:
      'The content fingerprint lists only hash algorithms this verifier cannot compute, so it could not be confirmed.',
  },
};

// --- #5 Trust-registry verdict (keyTrust) --------------------------------

export const KEY_TRUST_SIGNALS: Record<KeyTrustStatus, TrustSignalDescriptor> = {
  active: {
    tier: 'verified',
    label: 'Signed with an active registered key',
    detail: 'The signing key is listed and active in our published trust registry.',
  },
  deprecated_valid: {
    tier: 'normal',
    label: 'Signed before the key was rotated out',
    detail:
      'The signing key has since been rotated out, but this package was signed while it was still valid.',
  },
  deprecated_invalid: {
    tier: 'alarm',
    label: 'Signed after the key was rotated out',
    detail: 'This package was signed after its key was deprecated — it is not trusted.',
  },
  revoked: {
    tier: 'alarm',
    label: 'Signed with a revoked key',
    detail: 'The signing key has been revoked — this package is not trusted.',
  },
  unknown_key: {
    tier: 'attention',
    label: 'Signing key not in the trust registry',
    detail:
      'The signing key is not listed in our published trust registry, so we cannot vouch for it.',
  },
  registry_unavailable: {
    tier: 'attention',
    label: 'Trust registry could not be reached',
    detail: 'The trust registry could not be loaded, so the key status was not checked.',
  },
  // Load-bearing: any package signed with an embedded key that carries no
  // registry kid — genuinely-old packages AND recent ones signed before kid
  // storage. Must read calm. Speaks ONLY to key trust (P7): the signature
  // itself is check #2 and is never asserted here (older copy claimed "its
  // signature verified against its embedded key", which contradicted a #2
  // failure on any no-kid package whose signature did not verify).
  legacy_embedded: {
    tier: 'normal',
    label: 'Signed with an embedded key (not in the trust registry)',
    detail:
      'The signature uses an embedded public key that is not listed in our published trust registry, so the registry cannot vouch for it.',
  },
};

/**
 * Prominent reading for a package with NO signing key at all. The verify route
 * emits `keyTrust: null` only for an unsigned package (it co-occurs with
 * `signatureValid: null`). Deliberately elevated from calm Normal to Attention
 * in S3a P3 (ADR-0020 §Consequences guard 2, "mandatory labeling"): an
 * unsigned package is the intentional dev tier — legitimate, not proven-bad —
 * but its rendering must be surfaced prominently wherever the package
 * appears, never fold into a calm all-clear. Attention is the honest tier:
 * "unconfirmed, look closer", not Alarm's "provably wrong". Defined here, not
 * hand-rolled in the component, so the tier decision keeps a single source of
 * truth.
 */
export const NO_SIGNING_KEY_SIGNAL: TrustSignalDescriptor = {
  tier: 'attention',
  label: 'No signing key',
  detail:
    'This package carries no signing key — it was produced by an instance running in the unsigned dev tier, so its origin is not cryptographically attributable and there is nothing to check against the trust registry.',
};

/** Resolve the trust-registry verdict, folding the unsigned (`null`) case into
 *  the calm `NO_SIGNING_KEY_SIGNAL` so consumers never branch on a missing key. */
export function resolveKeyTrust(
  keyTrust: { status: KeyTrustStatus } | null | undefined,
): TrustSignalDescriptor {
  return keyTrust ? KEY_TRUST_SIGNALS[keyTrust.status] : NO_SIGNING_KEY_SIGNAL;
}

// --- #7 Timestamp validity (hasTimestamp: boolean) -----------------------

export const TIMESTAMP_SIGNALS: Record<BiStateKey, TrustSignalDescriptor> = {
  true: {
    tier: 'verified',
    label: 'Timestamped',
    detail: 'Carries an RFC 3161 timestamp token.',
  },
  false: {
    tier: 'normal',
    label: 'No timestamp',
    detail: 'This package carries no timestamp token (common for earlier-format packages).',
  },
};
export const resolveTimestamp = (hasTimestamp: boolean): TrustSignalDescriptor =>
  TIMESTAMP_SIGNALS[biKey(hasTimestamp)];

// --- #8 Transparency-log inclusion (rekorVerified: boolean | null) -------

export const REKOR_SIGNALS: Record<TriStateKey, TrustSignalDescriptor> = {
  true: {
    tier: 'verified',
    label: 'Recorded in a public transparency log',
    detail: 'A matching entry was confirmed in the Sigstore Rekor transparency log.',
  },
  // Attention, not Alarm: the most common cause is a transient Rekor outage, and
  // the supplementary log is not the package's content. See the design note.
  false: {
    tier: 'attention',
    label: 'Transparency-log entry not confirmed',
    detail:
      'This package references a transparency-log entry that could not be confirmed — the log may be unreachable.',
  },
  null: {
    tier: 'normal',
    label: 'Not in a transparency log',
    detail: 'This package was not recorded in a public transparency log.',
  },
};
export const resolveRekor = (v: boolean | null): TrustSignalDescriptor =>
  REKOR_SIGNALS[triKey(v)];

// --- #9 BlobRef integrity (blobRefsVerified: boolean | null) -------------

export const BLOB_REFS_SIGNALS: Record<TriStateKey, TrustSignalDescriptor> = {
  true: {
    tier: 'verified',
    label: 'Referenced content verified',
    detail: 'Every externally-stored field matched its embedded fingerprint.',
  },
  false: {
    tier: 'alarm',
    label: 'Referenced content failed verification',
    detail: 'At least one externally-stored field did not match its fingerprint.',
  },
  null: {
    tier: 'normal',
    label: 'No referenced content',
    detail: 'This package stores all fields inline; there is nothing to fetch.',
  },
};
export const resolveBlobRefs = (v: boolean | null): TrustSignalDescriptor =>
  BLOB_REFS_SIGNALS[triKey(v)];

/**
 * #9 BlobRef per-reference failure reasons. Each is a sub-explanation of a
 * failed (Alarm-tier) BlobRef check — surfaced beneath the summary signal when a
 * reference fails. `fetch_failed` is the softest (a transient retrieval failure
 * is possible, paralleling rekor=false); it is tiered Alarm here because a
 * BlobRef is a PRIMARY content carrier whose unavailability breaks the package's
 * content-integrity guarantee, unlike the supplementary Rekor log. See the note.
 */
export const BLOB_REF_REASON_SIGNALS: Record<BlobRefVerifyReason, TrustSignalDescriptor> = {
  invalid_ref: {
    tier: 'alarm',
    label: 'Malformed content reference',
    detail: 'A referenced field does not carry a valid blob reference.',
  },
  fetch_failed: {
    tier: 'alarm',
    label: 'Referenced content could not be retrieved',
    detail: 'A referenced blob could not be fetched to confirm its integrity.',
  },
  size_mismatch: {
    tier: 'alarm',
    label: 'Referenced content is the wrong size',
    detail: 'A referenced blob does not match the size the package commits to.',
  },
  hash_mismatch: {
    tier: 'alarm',
    label: 'Referenced content does not match its fingerprint',
    detail: 'A referenced blob does not hash to the value the package commits to.',
  },
};

// --- #10 Lifecycle state -------------------------------------------------
//
// Lifecycle is a separate axis from cryptographic integrity (P7). Neither state
// is an integrity verdict, so both are calm. Whether lifecycle renders in the
// verify panel at all is left to #111 (the note explains the reasoning).

export const LIFECYCLE_STATE_SIGNALS: Record<LifecycleStatus, TrustSignalDescriptor> = {
  active: {
    tier: 'normal',
    label: 'Active',
    detail: 'This package has not been withdrawn.',
  },
  // NOT alarm — a withdrawal is a legitimate signed action. Prominence (a banner)
  // is the detail page's job, not the tier's.
  withdrawn: {
    tier: 'normal',
    label: 'Withdrawn by the publisher',
    detail:
      'The publisher has withdrawn this package — a legitimate signed action. The reason is shown with the package.',
  },
};

export const LIFECYCLE_SOURCE_SIGNALS: Record<LifecycleSource, TrustSignalDescriptor> = {
  'attestation-chain': {
    tier: 'verified',
    label: 'Lifecycle confirmed from signed transitions',
    detail: 'Status was derived from independently-verified, signed lifecycle events.',
  },
  'legacy-columns': {
    tier: 'normal',
    label: 'Lifecycle from earlier-format records',
    detail: 'Status was derived from pre-attestation lifecycle records.',
  },
  none: {
    tier: 'normal',
    label: 'No lifecycle changes',
    detail: 'No withdrawal or reinstatement has been recorded.',
  },
};

// #10 per-attestation signals. Integrity of a lifecycle event (signature,
// node-id) alarms when false — a forged or altered transition. The signer-match,
// timestamp, and Rekor checks are NOT failures when false: a non-signer-matched
// attestation is a legitimately-surfaced third-party event (§8.10.3 retention
// asymmetry — it is shown but does not move the publisher's status), and the
// timestamp / Rekor checks are supplementary. (See the note's deviation log: the
// brief grouped signer-match with the integrity checks; the retention-asymmetry
// semantics and the existing verify.ts test place it at Normal.)
export const LIFECYCLE_ATTESTATION_SIGNATURE_SIGNALS: Record<
  TriStateKey,
  TrustSignalDescriptor
> = {
  true: { tier: 'verified', label: 'Lifecycle event signature verifies' },
  false: {
    tier: 'alarm',
    label: 'Lifecycle event signature does not verify',
    detail:
      'A withdrawal or reinstatement claims a signature that does not validate — a forged transition.',
  },
  null: { tier: 'normal', label: 'Lifecycle event unsigned' },
};
export const LIFECYCLE_ATTESTATION_NODE_ID_SIGNALS: Record<BiStateKey, TrustSignalDescriptor> = {
  true: { tier: 'verified', label: 'Lifecycle event intact' },
  false: {
    tier: 'alarm',
    label: 'Lifecycle event has been altered',
    detail: 'A lifecycle event does not hash to its recorded id — it may have been tampered with.',
  },
};
export const LIFECYCLE_ATTESTATION_SIGNER_MATCH_SIGNALS: Record<
  BiStateKey,
  TrustSignalDescriptor
> = {
  true: { tier: 'verified', label: 'Lifecycle event from the publisher' },
  false: {
    tier: 'normal',
    label: 'Lifecycle event from a different signer',
    detail:
      'A third party attested this transition; per the standard it is shown but does not change the status the publisher sets.',
  },
};
export const LIFECYCLE_ATTESTATION_TIMESTAMP_SIGNALS: Record<BiStateKey, TrustSignalDescriptor> = {
  true: { tier: 'verified', label: 'Lifecycle event timestamped' },
  false: {
    tier: 'normal',
    label: 'Lifecycle event not timestamped',
    detail: 'A supplementary check; its absence does not affect the transition.',
  },
};
export const LIFECYCLE_ATTESTATION_REKOR_SIGNALS: Record<BiStateKey, TrustSignalDescriptor> = {
  true: { tier: 'verified', label: 'Lifecycle event in a transparency log' },
  false: {
    tier: 'normal',
    label: 'Lifecycle event not in a transparency log',
    detail: 'A supplementary check; its absence does not affect the transition.',
  },
};

// --- #11 captureMethod LABEL (informational — NO tier) -------------------
//
// Check #11 is not a pass/fail signal: `metadata.captureMethod` is a
// signature-covered LABEL describing HOW the bytes were captured (spec §8.6 /
// §9.2 #11 — "signed ≠ verbatim"). It is rendered as a neutral informational
// label adjacent to the signature verdict (#111's job), never assigned a tier.
// These strings give each captureMethod value a plain-language reading (P9).
export const CAPTURE_METHOD_LABELS: Record<CaptureMethod, string> = {
  'chat-flow-stream': 'Captured from the live chat as the analysis was generated.',
  'claude-code-jsonl-readback': 'Reconstructed from the Claude Code session transcript.',
  'claude-code-self-report':
    'Summarized by the AI from its own session memory (deprecated capture method).',
};

/**
 * Resolve the plain-language capture-method reading rendered as a neutral label
 * beside the signature verdict (#111). Returns `null` when there is nothing to
 * show — a pre-ADR-0003 package with no captureMethod, or an unrecognized value
 * — so the consumer simply omits the line (no noise on legacy packages).
 *
 * `datHere` is a preserved special case (ADR-0004): the 2026-05-19 reframe moved
 * datHere out of captureMethod into a separate contentProfile column, but legacy
 * pre-reframe records may still carry it here. It is surfaced as a legacy value
 * with an ADR-0004 annotation, never treated as a real capture method.
 */
export function resolveCaptureMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  const known = (CAPTURE_METHOD_LABELS as Record<string, string | undefined>)[method];
  if (known) return known;
  if (method === 'datHere') {
    return 'Recorded with a legacy datHere capture method (pre-ADR-0004 reframe); the content profile now carries this distinction.';
  }
  return null;
}

// --- #12 type resolution -------------------------------------------------

export const TYPE_RESOLUTION_SIGNALS: Record<TypeResolutionStatus, TrustSignalDescriptor> = {
  ok: { tier: 'verified', label: 'Node type recognized' },
  implicit: {
    tier: 'normal',
    label: 'Node type inferred (earlier-format package)',
    detail: 'This package predates explicit type labeling; it is read as a standard analysis.',
  },
  unknown_type: {
    tier: 'attention',
    label: 'Unrecognized node type',
    detail: 'This package declares a type this verifier does not recognize. It is shown, not rejected.',
  },
};

// --- #14 signer identity ↔ registry cross-check --------------------------

export const SIGNER_IDENTITY_SIGNALS: Record<SignerIdentityCheckStatus, TrustSignalDescriptor> = {
  ok: {
    tier: 'verified',
    label: 'Signer identity matches the registry',
    detail:
      'The stated signer matches the identity our registry records for the signing key.',
  },
  signer_identity_mismatch: {
    tier: 'alarm',
    label: 'Signer identity does not match the registry',
    detail:
      'The stated signer does not match the identity bound to the signing key — do not trust.',
  },
  no_signer: {
    tier: 'normal',
    label: 'No stated signer (earlier-format package)',
    detail:
      'This package predates identity binding; the signer is derived from the registry and the cross-check is skipped.',
  },
  no_registry_identity: {
    tier: 'normal',
    label: 'Registry has no identity for this key',
    detail: 'The registry entry for this key predates identity binding, so the cross-check is skipped.',
  },
};

// --- #15 captureMethod per-profile vocabulary conformance ----------------

export const CAPTURE_METHOD_VOCAB_SIGNALS: Record<
  CaptureMethodVocabStatus,
  TrustSignalDescriptor
> = {
  ok: { tier: 'verified', label: 'Capture method recognized for this profile' },
  // The sharpest call. The spec says #15 "rejects the node," but the tier governs
  // how the SIGNAL reads, not conformance (#110 changes no behavior). The
  // captureMethod label is signature-covered, so an unrecognized value is not an
  // alteration — it is an unrecognized identifier, like #3 / #12. → Attention.
  captureMethod_unknown: {
    tier: 'attention',
    label: 'Capture method not recognized for this profile',
    detail:
      'The capture-method label is not in the vocabulary that this profile declares. The label is signature-covered, so this is an unrecognized value, not an alteration.',
  },
  producerProfile_bundle_unresolved: {
    tier: 'normal',
    label: 'Producer profile not resolved',
    detail:
      'The producer profile could not be resolved, so its capture-method vocabulary was not checked. The label is preserved.',
  },
  no_capture_method: {
    tier: 'normal',
    label: 'No capture method (earlier-format package)',
    detail: 'This package predates capture-method labeling.',
  },
};

// --- Overall integrity glance (worst-tier-wins) — #113 -------------------
//
// ADR-0013 / Q46 splits verification rendering by disclosure depth: the
// publishing host renders only a calm GLANCE (this summary); the full §9.2
// per-check "show the math" is delegated to the neutral verifier at
// typedstandards.org/verify. This rolls the per-check tiers into ONE of the
// three summary states the issue names — Verified / Attention / Alarm — by
// worst-tier-wins, with Normal collapsing into the calm Verified summary.
//
// Why Normal → Verified (not its own glance state): a pre-v0.1 legacy package
// produces only Verified + Normal checks (legacy_relabeled, legacy_embedded,
// no timestamp, …). The load-bearing calm requirement (§3 of the design note)
// is that such a package reads calm and affirmative, never amber/red — so with
// no Attention and no Alarm present, the glance is "Integrity verified". The
// Normal-tier back-compat nuance lives in the delegated per-check verifier, not
// in the one-line in-page glance (P5: glance here, detail there).

const TIER_RANK: Record<TrustTier, number> = {
  verified: 0,
  normal: 1,
  attention: 2,
  alarm: 3,
};

/**
 * Dedicated overall glance for an UNSIGNED package (S3a P3; ADR-0020 guard 2
 * "mandatory labeling"). An unsigned package has no signature, no registered
 * key, and — because Rekor logging is signature-gated — no transparency-log
 * entry: there is no cryptographic commitment for the glance to speak to, so
 * the generic "some checks need a closer look" would under-describe the
 * condition. Attention tier (unconfirmed, not proven-bad — the unsigned dev
 * tier is a legitimate producer state per ADR-0020 §B); named explicitly so
 * the label travels with every surface that renders the glance.
 */
export const UNSIGNED_PACKAGE_SIGNAL: TrustSignalDescriptor = {
  tier: 'attention',
  label: 'Unsigned package — no cryptographic commitment',
  detail:
    'This package was produced without a signing key (the unsigned dev tier). It carries no signature, no registered key, and no transparency-log entry, so its origin cannot be cryptographically confirmed.',
};

/**
 * The unsigned-package discriminator: the verify path emits `signatureValid:
 * null` AND `keyTrust: null` together only when the package carries no
 * signature envelope at all. Every signed package — including legacy
 * embedded-key packages — has a non-null keyTrust, so the legacy calm
 * requirement is untouched by this branch.
 */
export function isUnsignedGlance(
  r: Pick<IntegrityGlanceInput, 'signatureValid' | 'keyTrust'>,
): boolean {
  return r.signatureValid === null && r.keyTrust === null;
}

/** The three overall-integrity summary states (#113). Disclosure, never
 *  validation (P1): "Integrity verified" speaks to the cryptographic/structural
 *  checks, never to whether the analysis is correct. */
export const OVERALL_INTEGRITY_SIGNALS: Record<
  'verified' | 'attention' | 'alarm',
  TrustSignalDescriptor
> = {
  verified: {
    tier: 'verified',
    label: 'Integrity verified',
    detail: 'The integrity checks ran cleanly. You can re-run them yourself in the independent verifier.',
  },
  attention: {
    tier: 'attention',
    label: 'Some checks need a closer look',
    detail: 'One or more checks could not be confirmed. See the full breakdown in the independent verifier.',
  },
  alarm: {
    tier: 'alarm',
    label: 'Integrity problem detected',
    detail: 'One or more checks did not pass. See the full breakdown in the independent verifier.',
  },
};

/** The verify-result fields the integrity glance rolls up. Structurally a
 *  subset of the verify route's response (and the component's `VerifyResult`),
 *  so the resolved object passes straight in. Status-bearing checks are
 *  optional (absent → skipped) to stay tolerant of partial / legacy results. */
export interface IntegrityGlanceInput {
  hashMatch: boolean;
  signatureValid: boolean | null;
  keyTrust: { status: KeyTrustStatus } | null;
  hasTimestamp: boolean;
  rekorVerified: boolean | null;
  blobRefsVerified: boolean | null;
  contentCanonicalization: { status: ContentCanonicalizationStatus } | null;
  contentHash: { status: ContentHashStatus } | null;
  typeResolution: { status: TypeResolutionStatus } | null;
  signerIdentity: { status: SignerIdentityCheckStatus } | null;
  captureMethodVocab: { status: CaptureMethodVocabStatus } | null;
}

/**
 * Collect the per-check descriptors the integrity glance rolls up. Each is
 * resolved through the SAME source-of-truth maps the (delegated) per-check
 * verifier uses, so the in-page glance and the full breakdown can never assign a
 * status a different tier. Lifecycle (#10) is deliberately excluded — it is a
 * separate axis from cryptographic integrity (P7) and has its own page surface
 * (the withdrawal banner + Status History).
 */
export function collectIntegrityDescriptors(r: IntegrityGlanceInput): TrustSignalDescriptor[] {
  const d: TrustSignalDescriptor[] = [
    resolveEnvelopeIntegrity(r.hashMatch),
    resolveSignature(r.signatureValid),
    resolveKeyTrust(r.keyTrust),
    resolveTimestamp(r.hasTimestamp),
    resolveRekor(r.rekorVerified),
    resolveBlobRefs(r.blobRefsVerified),
  ];
  if (r.contentCanonicalization)
    d.push(CONTENT_CANONICALIZATION_SIGNALS[r.contentCanonicalization.status]);
  if (r.contentHash) d.push(CONTENT_HASH_SIGNALS[r.contentHash.status]);
  if (r.typeResolution) d.push(TYPE_RESOLUTION_SIGNALS[r.typeResolution.status]);
  if (r.signerIdentity) d.push(SIGNER_IDENTITY_SIGNALS[r.signerIdentity.status]);
  if (r.captureMethodVocab) d.push(CAPTURE_METHOD_VOCAB_SIGNALS[r.captureMethodVocab.status]);
  return d;
}

/**
 * Roll the integrity checks into ONE calm overall glance (#113), worst-tier-wins.
 * Alarm if any check alarms; else — for an unsigned package — the dedicated
 * prominent unsigned label (S3a P3, ADR-0020 guard 2: mandatory labeling
 * wherever an unsigned package appears; Attention tier, so it outranks
 * nothing genuinely broken); else Attention if any check needs a closer look;
 * else the calm "Integrity verified" (Verified + Normal back-compat checks
 * both land here, so SIGNED legacy packages read calm — never amber/red).
 */
export function summarizeIntegrity(r: IntegrityGlanceInput): TrustSignalDescriptor {
  let worst = 0;
  for (const d of collectIntegrityDescriptors(r)) {
    worst = Math.max(worst, TIER_RANK[d.tier]);
  }
  if (worst >= TIER_RANK.alarm) return OVERALL_INTEGRITY_SIGNALS.alarm;
  if (isUnsignedGlance(r)) return UNSIGNED_PACKAGE_SIGNAL;
  if (worst >= TIER_RANK.attention) return OVERALL_INTEGRITY_SIGNALS.attention;
  return OVERALL_INTEGRITY_SIGNALS.verified;
}

// --- notebookProvenance (honest execution label) -------------------------
//
// Not a verify-library status: `metadata.extensions["org.civicaitools.notebook"]
// .provenance` distinguishes a notebook executed in a signed sandbox from a
// skeleton that reproduces the steps without running them (per open-questions
// Q31). Both readings are honest and calm — neither is a failure. `'executed'`
// is the only value emitted today; `'skeleton'` is reserved (no code path writes
// it yet). Canonical list kept here because the value is a notebook-author
// concept, not a verify.ts type.
export const NOTEBOOK_PROVENANCE_VALUES = ['executed', 'skeleton'] as const;
export type NotebookProvenance = (typeof NOTEBOOK_PROVENANCE_VALUES)[number];

export const NOTEBOOK_PROVENANCE_SIGNALS: Record<NotebookProvenance, TrustSignalDescriptor> = {
  executed: {
    tier: 'normal',
    label: 'Executed in a signed sandbox',
    detail:
      'The notebook was run end-to-end in a signed sandbox; its outputs are the executed results.',
  },
  skeleton: {
    tier: 'normal',
    label: 'Skeleton notebook (not executed)',
    detail:
      'The notebook reproduces the steps but was not executed; its outputs were not regenerated.',
  },
};

// --- Checks not emitted as discrete status fields today ------------------
//
// Spec checks #6 (metadata.signingKeyId consistency) and #13 (nodeId
// cross-check) are NOT surfaced by today's verify route as discrete status
// codes — it returns `nodeId` only as a recomputed hash string. Their tiers are
// RESERVED in the design note (a mismatch on either → Alarm) but intentionally
// have no runtime map here, and the coverage test asserts only the codes the
// route actually emits. When #6/#13 gain discrete statuses, add their maps here.

// --- Review signature status (attestation_packages) ----------------------
//
// Per-review signing disclosure for the rows in `attestation_packages` — the
// reviews and machine attestations attached to a record. Migration 0016 added
// the `signature` / `signing_key_id` / `rfc3161_timestamp` / `signed_at` /
// `unsigned_reason` columns; before it, the route computed a signature and
// discarded it, so every row written until then is genuinely unsigned.
//
// FOUR states, because a missing signature means two DIFFERENT things and
// collapsing them would be exactly the false precision Principle 3 forbids:
// a row that predates signing is a historical artifact awaiting backfill,
// while a row from a keyless instance is the intended unsigned tier
// (ADR-0020 §B) working as designed. A reader deciding how much weight to
// put on a review needs to be able to tell those apart.
//
// The discriminator is `unsigned_reason`, NOT the absence of a signature:
// see `resolveReviewSignature` below for why a NULL signature alone cannot
// separate the two.
//
// Tiers follow the established posture: unsigned is `attention` (prominent,
// never alarm — the unsigned tier is legitimate), signed is `normal` or
// `verified`. Copy is user language (P9): "review", "signed", "independent
// timestamp" — never "envelope", "kid", or "RFC 3161".
export const REVIEW_SIGNATURE_STATUSES = [
  'signed_timestamped',
  'signed_untimestamped',
  'unsigned_no_signing_key',
  'unsigned_pre_backfill',
] as const;
export type ReviewSignatureStatus = (typeof REVIEW_SIGNATURE_STATUSES)[number];

export const REVIEW_SIGNATURE_SIGNALS: Record<
  ReviewSignatureStatus,
  TrustSignalDescriptor
> = {
  signed_timestamped: {
    tier: 'verified',
    label: 'Signed and timestamped',
    detail:
      "Signed with this instance's key, and stamped by an independent time authority — so both who recorded this review and when it was recorded can be checked against the published key.",
  },
  signed_untimestamped: {
    tier: 'normal',
    label: 'Signed, not timestamped',
    detail:
      "Signed with this instance's key. The independent timestamp was not available when the review was submitted, so the signature stands on its own — what it commits to is unaffected.",
  },
  unsigned_no_signing_key: {
    // The seat-specified wording. Kept verbatim, and deliberately distinct
    // from any signing-FAILURE copy: a keyless instance is a configuration
    // choice, not a fault, and must not read as one.
    tier: 'attention',
    label: 'Unsigned — this instance has no signing key',
    detail:
      'This instance is running without a signing key, so reviews are recorded but not signed. The review text and its author are stored exactly as submitted; what is missing is the cryptographic commitment tying them to this instance.',
  },
  unsigned_pre_backfill: {
    tier: 'attention',
    label: 'Unsigned — recorded before reviews were signed',
    detail:
      'This review was submitted before this instance began signing reviews, so no signature was kept for it. The review text, its author, and its content hash are unchanged; only the signature is absent.',
  },
};

/** The row shape `resolveReviewSignature` reads. Mirrors the five columns
 *  migration 0016 added, so a caller can pass a DB row straight in. */
export interface ReviewSignatureRow {
  signature: string | null;
  rfc3161Timestamp: string | null;
  unsignedReason: string | null;
}

/**
 * Which of the four states a stored review is in.
 *
 * WHY `unsigned_reason` EXISTS. A NULL signature cannot, on its own,
 * distinguish "recorded before signing was implemented" from "recorded on an
 * instance that has no key": both are NULL in every other column, and no
 * date comparison can separate them honestly (an instance may adopt a key at
 * any time, and rows carry no record of the instance's state when they were
 * written). So the writing path records WHY it did not sign, at the moment it
 * made that decision — the only point at which the answer is actually known.
 * Rows written before 0016 have `unsigned_reason` NULL because nothing wrote
 * it, which is precisely what marks them as pre-backfill.
 */
export function resolveReviewSignature(
  row: ReviewSignatureRow,
): TrustSignalDescriptor & { status: ReviewSignatureStatus } {
  const status = resolveReviewSignatureStatus(row);
  return { status, ...REVIEW_SIGNATURE_SIGNALS[status] };
}

/**
 * The only `unsigned_reason` any code path writes today: the instance held no
 * signing key when the review was recorded (ADR-0020 §B, the intended unsigned
 * tier). Declared here, beside the status that renders it, so the writer and
 * the reader cannot drift onto different spellings.
 *
 * Matched EXACTLY rather than by truthiness. A reason this vocabulary does not
 * know about must not be silently relabeled "no signing key" — that would
 * assert a specific cause the row does not actually claim. An unrecognized
 * reason therefore falls through to the neutral pre-backfill reading, which
 * says only "unsigned", and a new reason is expected to arrive with its own
 * status and copy.
 */
export const REVIEW_UNSIGNED_REASON_NO_KEY = 'no_signing_key';

export function resolveReviewSignatureStatus(
  row: ReviewSignatureRow,
): ReviewSignatureStatus {
  if (row.signature) {
    return row.rfc3161Timestamp ? 'signed_timestamped' : 'signed_untimestamped';
  }
  return row.unsignedReason === REVIEW_UNSIGNED_REASON_NO_KEY
    ? 'unsigned_no_signing_key'
    : 'unsigned_pre_backfill';
}
