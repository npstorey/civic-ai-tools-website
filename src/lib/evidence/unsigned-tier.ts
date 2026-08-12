// Unsigned-tier gate + indicator logic (S3a P3, #166; ADR-0020 Decisions B/C).
//
// ADR-0020 models "unsigned" as a SIGNING STATUS orthogonal to visibility:
// an unsigned package carries no signature, and because Rekor logging is
// signature-gated it has no transparency-log entry and no attributable
// commitment. It is therefore not `sealed` (ADR-0016 §A: sealed = signed +
// RFC-3161-timestamped + Rekor-logged) and may reach NEITHER `sealed` NOR
// `public` (Decision C) — the unsigned dev tier is confined to local
// produce-and-inspect. Three guards bound the tier (ADR-0020 §Consequences):
//
//   1. the seal/commit action is unreachable unsigned  → `evaluateSealCommitGate`
//      (server-side, wired into POST /api/evidence and POST
//      /api/evidence/[slug]/publish) + `evaluateUnsignedRecordPublishGate`
//      (the per-record form: a historical row persisted without a signature
//      cannot be promoted to public even on a signed instance);
//   2. mandatory labeling                              → trust-signal.ts
//      (`NO_SIGNING_KEY_SIGNAL` / `UNSIGNED_PACKAGE_SIGNAL`);
//   3. the verifier won't bless it                     → structural (an
//      unsigned artifact cannot produce "commitment verified").
//
// Plus: a running-unsigned indicator shows outside a dev environment
// (`shouldShowRunningUnsignedIndicator`, rendered by
// components/RunningUnsignedBanner.tsx). Dev stays calm.
//
// Everything here is PURE over an env-shaped record (default `process.env`,
// read at call time) so the decisions are unit-testable without touching the
// process environment. No values are ever read beyond presence.
//
// SIGNING IS A PAIR. Custody is `EVIDENCE_SIGNING_KEY`; identity is
// `EVIDENCE_KEY_ID` — the kid a verifier uses to look this instance's public
// key up in its trust registry. Both halves are required, with no coded
// default for either. A hardcoded default kid used to stand in for the second
// half, which meant an operator who set a key but no kid left this tier
// silently and signed every package under the REFERENCE deployment's kid: the
// signature is theirs, the label points at someone else's registry entry, so
// the evidence fails verification while appearing to claim another party's
// identity. That is a misattribution and verifiability defect (the private
// key is never involved — a clone always supplies its own). There is now no
// case in which an instance emits a kid it did not configure.

type EnvLike = Record<string, string | undefined>;

/** THE presence test — non-empty after trim. Presence only; no value is ever
 *  inspected further. Whitespace-only is absent, matching the preflight. */
function isPresent(raw: string | undefined): boolean {
  return typeof raw === 'string' && raw.trim().length > 0;
}

/** Whether this instance holds signing-key custody (`EVIDENCE_SIGNING_KEY`). */
export function isSigningKeyConfigured(env: EnvLike = process.env): boolean {
  return isPresent(env.EVIDENCE_SIGNING_KEY);
}

/**
 * Whether this instance has declared its signing identity
 * (`EVIDENCE_KEY_ID`). No default: the kid names a specific entry in a
 * specific trust registry, so guessing one is asserting an identity.
 */
export function isSigningKeyIdConfigured(env: EnvLike = process.env): boolean {
  return isPresent(env.EVIDENCE_KEY_ID);
}

/**
 * Whether this instance can sign — the producer-tier discriminator (ADR-0020
 * §B: unsigned dev → per-instance signed). Requires BOTH halves: key custody
 * AND a configured kid. A half-configured instance is `false` here, i.e. it
 * is treated as not configured rather than as a partial success — it must not
 * pass any gate that a fully-signed instance passes.
 */
export function isSigningConfigured(env: EnvLike = process.env): boolean {
  return isSigningKeyConfigured(env) && isSigningKeyIdConfigured(env);
}

/** The refusal a seal/commit attempt receives in the unsigned tier. */
export interface SealCommitGateRefusal {
  status: number;
  body: { error: string; code: string };
}

/**
 * Guard 1 (instance form): the seal/commit action is unreachable unless BOTH
 * halves of the signing pair are configured. Returns `null` when they are
 * (the action may proceed) and a refusal otherwise. Wired server-side in
 * front of every route that reaches the signing path, so a run that cannot
 * sign honestly cannot persist a `sealed`- or `public`-labeled record — per
 * Decision C an unsigned package may reach neither state, so the whole
 * persist action is gated, not just one visibility value.
 *
 * Two distinct refusals, because they are two distinct operator situations:
 *
 *   - `unsigned_tier` (403) — no signing key at all. A legitimate tier;
 *     signing is the go-to-production step the operator has not taken yet.
 *   - `signing_key_id_missing` (500) — a key but no `EVIDENCE_KEY_ID`. NOT a
 *     legitimate state: the operator intends to sign and the instance is
 *     misconfigured, so this is a server fault, named specifically rather
 *     than folded into the tier message an operator has already moved past.
 */
export function evaluateSealCommitGate(
  env: EnvLike = process.env,
): SealCommitGateRefusal | null {
  if (isSigningConfigured(env)) return null;

  if (isSigningKeyConfigured(env)) {
    return {
      status: 500,
      body: {
        error:
          'This instance has a signing key but has not declared its signing ' +
          'key id: EVIDENCE_KEY_ID is not set in this environment. Sealing ' +
          'and publishing are refused rather than signed under a key id this ' +
          'instance never configured — a package labeled with a kid that ' +
          "resolves to some other deployment's public key cannot verify, and " +
          'claims an identity that is not this instance\'s. (The signing key ' +
          'itself is unaffected: this is a misattribution and verifiability ' +
          'failure, not a key disclosure.) Set EVIDENCE_KEY_ID to the kid of ' +
          "the active entry in this instance's trust registry — see " +
          'docs/instance-setup.md.',
        code: 'signing_key_id_missing',
      },
    };
  }

  return {
    status: 403,
    body: {
      error:
        'This instance is running unsigned — no signing key is configured. ' +
        'Sealing or publishing evidence requires a signature: an unsigned ' +
        'package can reach neither the sealed nor the public state (ADR-0020). ' +
        'Analyses still run and can be inspected locally; an operator enables ' +
        'signing (EVIDENCE_SIGNING_KEY and EVIDENCE_KEY_ID, both required) ' +
        'via docs/instance-setup.md.',
      code: 'unsigned_tier',
    },
  };
}

/**
 * Guard 1 (per-record form): a record persisted WITHOUT a signature (a
 * historical unsigned-sealed row, predating this gate) cannot be promoted
 * to `public` — even on an instance that has since configured signing. The
 * base package has no signature to back a public state; per Decision C it can
 * reach neither `sealed` nor `public`. The row itself is NOT migrated or
 * relabeled — the gate is on the action going forward, and the record keeps
 * rendering (with prominent unsigned labeling per guard 2).
 */
export function evaluateUnsignedRecordPublishGate(
  basePackageSignature: string | null,
): SealCommitGateRefusal | null {
  if (basePackageSignature) return null;
  return {
    status: 409,
    body: {
      error:
        'This record was persisted without a signature; an unsigned package ' +
        'cannot be published — it can reach neither the sealed nor the public ' +
        'state (ADR-0020).',
      code: 'unsigned_package',
    },
  };
}

/**
 * Why this instance cannot sign, for the site-wide indicator — or `null` when
 * nothing should be shown.
 *
 *   - `no_signing_key` — the unsigned tier (ADR-0020 §Consequences: "a
 *     running-unsigned indicator/banner shows outside a dev environment").
 *     Dev (and test) stay calm: the unsigned tier is the intended first-run
 *     state there. Anywhere else, running unsigned must never be silent, so
 *     an unknown NODE_ENV shows the indicator too.
 *   - `no_key_id` — a signing key with no `EVIDENCE_KEY_ID`. Shown in EVERY
 *     environment, dev included: it is not an intended state anywhere, and
 *     dev is precisely where an operator wiring signing up should see it
 *     before the same half-configuration reaches a deploy.
 */
export type UnsignedIndicatorReason = 'no_signing_key' | 'no_key_id';

export function resolveUnsignedIndicator(
  env: EnvLike = process.env,
): UnsignedIndicatorReason | null {
  if (isSigningConfigured(env)) return null;
  if (isSigningKeyConfigured(env)) return 'no_key_id';
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return null;
  return 'no_signing_key';
}

/** Whether the indicator/banner renders at all. */
export function shouldShowRunningUnsignedIndicator(
  env: EnvLike = process.env,
): boolean {
  return resolveUnsignedIndicator(env) !== null;
}
