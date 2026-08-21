# Record signing key rotation

This runbook describes how to rotate the Ed25519 platform signing key that
anchors the cryptographic chain over published records. (First-time key + registry setup
for a new instance is covered in [`docs/instance-setup.md`](instance-setup.md);
this runbook picks up once an active key exists.) Follow it for both preventive
rotations (scheduled) and compromise rotations (incident response). The two
paths differ only in the final registry status you flip the previous key to
— `deprecated` for preventive, `revoked` for compromise.

## Background

Record packages are signed with an Ed25519 key referenced by a stable
identifier (`kid`) embedded in both the package's canonical hash and its
signature blob. The platform publishes the set of authorized keys and their
lifecycle status as a trust registry, served at **two paths with
byte-identical content** (ADR-0012 §3):

| Path | Role |
| --- | --- |
| `/.well-known/typed-publisher.json` | **Canonical.** What the proof sidecar's `trustRegistryUrl` points at, and what new external clients should fetch. Served by `src/app/.well-known/typed-publisher.json/route.ts`, which returns the legacy file's exact bytes. |
| `/.well-known/evidence-public-keys.json` | Legacy, served indefinitely for clients that only know the older path. This is the **one file on disk** and the one you edit: [`public/.well-known/evidence-public-keys.json`](../public/.well-known/evidence-public-keys.json). Its name is **exempt-frozen** under the 2026-08-19 vocabulary settlement (ruling D2, Appendix J of the Typed Standards specification) — the trust-registry rename already happened at ADR-0012, and the legacy leg is recorded rather than renamed again. |

Editing the one file therefore updates both paths at once.
Verifiers fetch the registry, match on `(kid, publicKey)`, and apply the
status semantics encoded in that file.

Rotation is the act of introducing a new active key while transitioning the
previous key to `deprecated` (still valid for pre-rotation signatures) or
`revoked` (invalid unconditionally).

Per-key fields in the registry:

| Field           | Meaning                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| `kid`           | Stable identifier, e.g. `platform:evidence-2026-04`. The reference deployment's live kid is **exempt-frozen** (Appendix J): it is embedded in every envelope that key has signed, so it is never rewritten. The next rotation names its successor under the settlement vocabulary — no rotation is forced by the rename. |
| `publicKey`     | Base64 DER-encoded Ed25519 public key.                                           |
| `status`        | `active` \| `deprecated` \| `revoked`.                                           |
| `activatedAt`   | ISO timestamp when the key started signing packages.                             |
| `deprecatedAt`  | ISO timestamp when the key was retired from signing (deprecation only).          |
| `revokedAt`     | ISO timestamp when the key was marked compromised (revocation only).             |

The `platform:` prefix in the kid is reserved for keys owned by the civicaitools.org platform. Future per-user keys (see the Phase 7 plan) will
use a `user:<user-id>:<key-name>` prefix, so the registry schema does not
need a separate scope field.

## Environment variables

**Names.** All four variables below took the `EVIDENCE_` prefix before the
2026-08-19 vocabulary settlement (Appendix J; [civic-ai-tools#160](https://github.com/npstorey/civic-ai-tools/issues/160)).
The prior-era spelling of each is **still read** as a fallback, so an existing
deployment keeps working with no edit; it logs a one-time deprecation warning
per variable and is removed only at a future major version. Set the
`PUBLISHER_*` names on a new instance, and rename an existing one when
convenient. Do not set both spellings of the same variable — the canonical one
wins whenever it is **defined**, including when it is defined empty.

The running website reads two variables to sign packages:

- `PUBLISHER_SIGNING_KEY` (prior era: `EVIDENCE_SIGNING_KEY`) — base64 DER
  PKCS8 private key. **Sensitive.**
- `PUBLISHER_KEY_ID` (prior era: `EVIDENCE_KEY_ID`) — stable kid string.
  Non-sensitive. Both are required to sign: a key with no declared kid is a
  refusal, not a default.

A third variable, `PUBLISHER_PUBLIC_KEY` (prior era: `EVIDENCE_PUBLIC_KEY`),
holds the public key counterpart and is not directly read by the signing code
— it exists so the registry file can be updated from a shell without
re-deriving the public key from the private one. It is written by
`scripts/generate-signing-key.ts`.

A fourth variable, **`PUBLISHER_TRUST_REGISTRY_URL`** (prior era:
`EVIDENCE_TRUST_REGISTRY_URL`), is optional. It is the **verify-side consume
override**: it feeds the URL an HTTP fetch would use if the verify path ever
reached that step when it checks a package's key trust.

Its default resolution, in order, is `NEXTAUTH_URL`, then
`PUBLISHER_SITE_ORIGIN`, then the reference origin — with
`/.well-known/evidence-public-keys.json` appended (the legacy path; both paths
serve the same bytes). **In practice this HTTP fetch is dead code on this
instance's own verify route, not merely a last resort:** `loadTrustRegistry()`
resolves the registry from a build-time-embedded import of the checked-in
`public/.well-known/evidence-public-keys.json` first, and that import is
compiled into the bundle unconditionally — it cannot fail at runtime short of
corrupting the checked-in file, which would break verification for every
package (the same malformed file also backs the on-disk step and the
default HTTP URL, which points at this instance's own copy of it). The on-disk
read and the HTTP fetch (fed by this variable) never run, in dev, test,
preview, or production alike (validation accepts any well-formed `keys`
array, including an empty one, so even a degenerate registry file
short-circuits the chain — nothing short of removing or malforming the
file makes step 1 fail). This is not a "rarely reaches it" case of
last-resort behavior; the two callers (`/api/evidence/[slug]/verify` and
`/commitment`) both call `loadTrustRegistry()` with no URL argument, so the
override changes a value that is never consumed. Measured directly in
`src/lib/evidence/verify.test.ts` ("B1" test): with the override set, the
process `chdir`'d away from the project root so the on-disk read is
genuinely non-viable (not merely untested — it hits ENOENT), and `fetch`
spied to fail the test if invoked, `loadTrustRegistry()` still returns the
real embedded registry. Both intermediate steps are ruled out this way,
not just the final one — the override is provably never reached through
the real call path. Treat this variable as inert on a normal
deployment; it is not a lever for making a preview or local-dev instance
verify against a different registry. (Why the HTTP-fetch fallback exists
at all despite being unreachable here is not independently verified by
this measurement — see `verify.ts`'s `getTrustRegistryUrl` docstring.)

It is deliberately **distinct from the two emit-side variables**, which control
what the signed proof sidecar tells a *third-party* verifier to fetch:

| Variable | Direction | Effect |
| --- | --- | --- |
| `PUBLISHER_TRUST_REGISTRY_URL` | consume | Feeds the HTTP-fetch fallback in `loadTrustRegistry()`, which the embedded-registry step preempts on every real call path (see above) — inert in practice. Never appears in signed output. |
| `PUBLISHER_TRUST_REGISTRY_CANONICAL_URL` | emit | The sidecar's `trustRegistryUrl`. Defaults to `<origin>/.well-known/typed-publisher.json`. |
| `PUBLISHER_TRUST_REGISTRY_LEGACY_URL` | emit | The sidecar's `trustRegistryUrlLegacy`. Defaults to `<origin>/.well-known/evidence-public-keys.json`; set it to the **empty string** to omit the field entirely. Empty is not absent here — an instance with no pre-ADR-0012 client base has no legacy path to honor. |

Setting the consume override when you meant an emit variable is the mistake
this table exists to prevent: it changes nothing a third party sees.
The full tier-by-tier reference is [`docs/deploy.md`](deploy.md).

## Preventive rotation

Run when the previous key has been in service long enough to warrant a
scheduled swap. No incident. Pre-rotation record packages remain
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
   - **Bump the document-level `generatedAt`** to the current ISO timestamp.
     This is the registry's "thisUpdate" (CRL precedent): it declares when
     this version of the list was issued, so offline verifiers can state the
     as-of date of the snapshot they checked against (#119 P4). Bump it on
     **every** registry edit, not only rotations — a verifier that only has a
     stale snapshot cannot see a revocation made after this date.

4. **Merge and deploy the registry** before rotating env vars. Verifiers
   must be able to see the new key before they see any package signed by
   it.

5. **Update Vercel env vars.** In the Vercel dashboard (not the CLI from a
   Claude Code session), set `PUBLISHER_SIGNING_KEY` and
   `PUBLISHER_KEY_ID` to the new values on both production and preview.
   (If this instance still carries the prior-era `EVIDENCE_*` names, rotating
   is the natural moment to rename them — set the `PUBLISHER_*` pair and
   delete the old one rather than leaving both.)
   Trigger a redeploy.

6. **Smoke test.** Publish a fresh record package, verify it via the
   `/records/[slug]` verify action (key trust should read "Signed with
   active key"), then verify a known pre-rotation package (key trust
   should read "Signed with deprecated key before rotation").

## Compromise rotation

Run when the previous `PUBLISHER_SIGNING_KEY` has been exposed and must be
treated as untrusted. The steps are the same as preventive rotation with
two differences: the previous key becomes `revoked` rather than
`deprecated`, and pre-exposure packages are **not** preserved as verifiable
(because we cannot distinguish legitimate pre-exposure signatures from
forged ones).

1. **Rotate `PUBLISHER_SIGNING_KEY` in Vercel first.** Do not wait for the
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

5. **Smoke test.** Publish a fresh record package under the new key,
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
