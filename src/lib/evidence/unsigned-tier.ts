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

type EnvLike = Record<string, string | undefined>;

/**
 * Whether this instance holds a signing key — the producer-tier discriminator
 * (ADR-0020 §B: unsigned dev → per-instance signed). Presence-only; the value
 * is never inspected beyond non-emptiness.
 */
export function isSigningConfigured(env: EnvLike = process.env): boolean {
  const key = env.EVIDENCE_SIGNING_KEY;
  return typeof key === 'string' && key.trim().length > 0;
}

/** The refusal a seal/commit attempt receives in the unsigned tier. */
export interface SealCommitGateRefusal {
  status: number;
  body: { error: string; code: string };
}

/**
 * Guard 1 (instance form): the seal/commit action is unreachable in the
 * unsigned tier. Returns `null` when signing is configured (the action may
 * proceed) and a refusal otherwise. Wired server-side into the publish/commit
 * routes so an unsigned run cannot persist a `committed`- or
 * `published`-labeled record — per Decision C an unsigned package may reach
 * neither state, so the whole persist action is gated, not just one
 * visibility value.
 */
export function evaluateSealCommitGate(
  env: EnvLike = process.env,
): SealCommitGateRefusal | null {
  if (isSigningConfigured(env)) return null;
  return {
    status: 403,
    body: {
      error:
        'This instance is running unsigned — no signing key is configured. ' +
        'Committing or publishing evidence requires a signature: an unsigned ' +
        'package can reach neither the sealed nor the public state (ADR-0020). ' +
        'Analyses still run and can be inspected locally; an operator enables ' +
        'signing via docs/instance-setup.md.',
      code: 'unsigned_tier',
    },
  };
}

/**
 * Guard 1 (per-record form): a record persisted WITHOUT a signature (a
 * historical unsigned-committed row, predating this gate) cannot be promoted
 * to `published` — even on an instance that has since configured signing. The
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
 * Whether the running-unsigned indicator/banner should render (ADR-0020
 * §Consequences: "a running-unsigned indicator/banner shows outside a dev
 * environment"). Dev (and test) stay calm — the unsigned tier is the intended
 * first-run state there; anywhere else, running unsigned must never be
 * silent, so an unknown NODE_ENV shows the indicator too.
 */
export function shouldShowRunningUnsignedIndicator(
  env: EnvLike = process.env,
): boolean {
  if (isSigningConfigured(env)) return false;
  return env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test';
}
