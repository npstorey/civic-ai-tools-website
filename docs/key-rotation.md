# Evidence signing key rotation

This runbook describes how to rotate the Ed25519 platform signing key that
anchors the cryptographic evidence chain. Follow it for both preventive
rotations (scheduled) and compromise rotations (incident response). The two
paths differ only in the final registry status you flip the previous key to
— `deprecated` for preventive, `revoked` for compromise.

## Background

Evidence packages are signed with an Ed25519 key referenced by a stable
identifier (`kid`) embedded in both the package's canonical hash and its
signature blob. The platform publishes the set of authorized keys and their
lifecycle status at
[`/.well-known/evidence-public-keys.json`](../public/.well-known/evidence-public-keys.json).
Verifiers fetch the registry, match on `(kid, publicKey)`, and apply the
status semantics encoded in that file.

Rotation is the act of introducing a new active key while transitioning the
previous key to `deprecated` (still valid for pre-rotation signatures) or
`revoked` (invalid unconditionally).

Per-key fields in the registry:

| Field           | Meaning                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| `kid`           | Stable identifier, e.g. `platform:evidence-2026-04`.                             |
| `publicKey`     | Base64 DER-encoded Ed25519 public key.                                           |
| `status`        | `active` \| `deprecated` \| `revoked`.                                           |
| `activatedAt`   | ISO timestamp when the key started signing packages.                             |
| `deprecatedAt`  | ISO timestamp when the key was retired from signing (deprecation only).          |
| `revokedAt`     | ISO timestamp when the key was marked compromised (revocation only).             |

The `platform:` prefix in the kid is reserved for keys owned by the civicaitools.org platform. Future per-user keys (see the Phase 7 plan) will
use a `user:<user-id>:<key-name>` prefix, so the registry schema does not
need a separate scope field.

## Environment variables

The running website reads two variables to sign packages:

- `EVIDENCE_SIGNING_KEY` — base64 DER PKCS8 private key. **Sensitive.**
- `EVIDENCE_KEY_ID` — stable kid string. Non-sensitive.

A third variable, `EVIDENCE_PUBLIC_KEY`, holds the public key counterpart and
is not directly read by the signing code — it exists so the registry file
can be updated from a shell without re-deriving the public key from the
private one.

A fourth variable, `EVIDENCE_TRUST_REGISTRY_URL`, is optional and overrides
the default registry URL (`${NEXTAUTH_URL}/.well-known/evidence-public-keys.json`).
Useful for previews or local dev when you want the verifier to hit a
different registry.

## Preventive rotation

Run when the previous key has been in service long enough to warrant a
scheduled swap. No incident. Pre-rotation evidence packages remain
verifiable after the rotation.

1. **Generate a new keypair outside Claude Code.** In a separate terminal:

   ```bash
   openssl genpkey -algorithm Ed25519 -out new-evidence.pem
   ```

   Derive the base64 DER PKCS8 encoding of the private key and the DER SPKI
   encoding of the public key. Record both in 1Password as a new item named
   after the new kid.

2. **Pick a new kid.** Conventionally `platform:evidence-YYYY-MM`, bumped
   by the rotation month. Keep the `platform:` prefix.

3. **Update the trust registry.** In a PR on the `civic-ai-tools-website`
   repo, edit
   [`public/.well-known/evidence-public-keys.json`](../public/.well-known/evidence-public-keys.json):

   - Insert the new key as `active` with the new `activatedAt` ISO
     timestamp.
   - Flip the previous key's `status` to `deprecated`, set `deprecatedAt`
     to the same ISO timestamp, and leave `revokedAt` as `null`.

4. **Merge and deploy the registry** before rotating env vars. Verifiers
   must be able to see the new key before they see any package signed by
   it.

5. **Update Vercel env vars.** In the Vercel dashboard (not the CLI from a
   Claude Code session), set `EVIDENCE_SIGNING_KEY` and
   `EVIDENCE_KEY_ID` to the new values on both production and preview.
   Trigger a redeploy.

6. **Smoke test.** Publish a fresh evidence package, verify it via the
   `/evidence/[slug]` verify action (key trust should read "Signed with
   active key"), then verify a known pre-rotation package (key trust
   should read "Signed with deprecated key before rotation").

## Compromise rotation

Run when the previous `EVIDENCE_SIGNING_KEY` has been exposed and must be
treated as untrusted. The steps are the same as preventive rotation with
two differences: the previous key becomes `revoked` rather than
`deprecated`, and pre-exposure packages are **not** preserved as verifiable
(because we cannot distinguish legitimate pre-exposure signatures from
forged ones).

1. **Rotate `EVIDENCE_SIGNING_KEY` in Vercel first.** Do not wait for the
   registry PR. Exposure time is the variable that matters most; every
   minute the compromised key stays active is a minute an attacker could
   mint a forged signature.

2. **Generate the new keypair, pick a new kid, update 1Password** as in
   preventive rotation.

3. **Update the trust registry.** Insert the new key as `active`, flip the
   compromised key's `status` to `revoked`, set `revokedAt` to the exposure
   detection timestamp (or earlier if known), and leave `deprecatedAt` as
   `null`. Merge and deploy.

4. **Audit exposed packages.** Enumerate every package previously signed
   with the revoked key. Withdraw any that cannot be re-published (public
   artifacts, citations) — withdrawal preserves the cryptographic chain
   while surfacing the revoked state to readers. Re-publish any that can
   be, now signed under the new key.

5. **Smoke test.** Publish a fresh evidence package under the new key,
   verify it, then re-verify a package signed under the revoked key — its
   key trust row should read "Key revoked — do not trust" and its
   `verified` flag should be `false`.

6. **Post-mortem.** Write up the exposure vector and add any new harness
   controls (PreToolUse hook patterns, deny rules, 1Password migrations)
   to the security hardening plan.

## Notes

- Never paste private key material into a Claude Code session. Always use a
  separate terminal for key generation and 1Password for storage.
- Rekor entries from the previous key remain in the transparency log
  forever — that's by design. After rotation, those entries are still
  fetchable but verifying them against the trust registry applies the new
  `deprecated` or `revoked` semantics.
- The in-memory registry cache on the verify route is scoped to the
  serverless function instance. After the registry file changes, callers
  may see the old file for up to an hour per warm instance; force
  invalidation by redeploying.
- When rotating the kid, every subsequent published package hashes the new
  kid into its canonical JSON. Pre-rotation packages keep their old kid
  baked in, so the verify route must look up both old and new keys in the
  same registry — which is why old entries stay in the registry with
  `deprecated` or `revoked` status rather than being removed.
