# Instance identity setup — keys, registry, and configuration

This guide takes a fresh instance of the application from the unsigned dev
tier to a signing publisher (ADR-0020: per-instance keys with an intentional
unsigned dev tier). Follow it once at go-to-production time; afterwards, key
changes follow the rotation runbook in
[`docs/key-rotation.md`](key-rotation.md).

An instance works unsigned out of the box — packages are produced and can be
inspected, and verification calmly reports that no signing key is configured.
Signing is the **go-to-production** step: keygen → registry → environment.
Nothing unsigned can reach the `sealed` or `public` states, so an instance
that skips this guide has opted out of the evidence layer, never silently
mislabeled its output.

## 1. Generate a keypair

**Generate keys outside any AI-agent session.** In a separate terminal:

```bash
openssl genpkey -algorithm Ed25519 -out evidence-signing.pem
```

Derive the base64 DER PKCS8 encoding of the private key and the base64 DER
SPKI encoding of the public key:

```bash
openssl pkey -in evidence-signing.pem -outform DER | base64        # private (SENSITIVE)
openssl pkey -in evidence-signing.pem -pubout -outform DER | base64  # public
```

Record both in your secret manager under an item named after the kid you
pick in step 2. Never paste the private key into an agent session, a commit,
or a log.

## 2. Pick a key identifier (kid)

Conventionally `platform:evidence-YYYY-MM` (the year-month you activate it).
Keep the `platform:` prefix — it scopes the key to your instance's platform
identity and leaves room for per-user scopes later without a registry schema
migration. The kid is not secret; it is the registry lookup handle for the
matching public key.

## 3. Publish your trust registry

Your registry is what lets anyone verify your packages. The application
serves it from `public/.well-known/` at both the canonical path
(`/.well-known/typed-publisher.json`, spec §8.3.3) and the legacy path
(`/.well-known/evidence-public-keys.json`), byte-identical.

Replace the demo deployment's registry file with your own. Template:

```json
{
  "$comment": "Trust registry for <your-host> evidence packages. Verifiers fetch this file, match the (kid, publicKey) pair embedded in a package's signature, and apply the status semantics below. See docs/key-rotation.md for the rotation runbook.",
  "generatedAt": "<ISO timestamp of this edit>",
  "statusSemantics": {
    "active": "Valid for signing new packages and for verification.",
    "deprecated": "Cannot sign new packages. Signatures are valid for verification only when the package's Rekor integratedTime precedes deprecatedAt.",
    "revoked": "Never valid — any signature is treated as suspect regardless of when the package was integrated."
  },
  "keys": [
    {
      "kid": "platform:evidence-YYYY-MM",
      "publicKey": "<base64 DER SPKI public key from step 1>",
      "signerIdentity": {
        "bindingTier": "platform",
        "identifier": "platform:<your-instance-identifier>",
        "displayName": "<Your Instance Display Name>"
      },
      "status": "active",
      "activatedAt": "<ISO timestamp>",
      "deprecatedAt": null,
      "revokedAt": null
    }
  ]
}
```

Two invariants the verifier enforces:

- **`signerIdentity` here must match your `EVIDENCE_SIGNER_*` configuration**
  (step 4). Verify check #14 cross-checks the envelope's `signer` claim
  against the registry entry for the signing kid; a mismatch fails
  verification.
- **Bump `generatedAt` on every registry edit** — it is the registry's
  "thisUpdate" (CRL precedent), letting offline verifiers state the as-of
  date of the snapshot they checked.

Deploy the registry **before** signing anything with the new key: verifiers
must be able to see the key before they see a package signed by it.

## 4. Configure the environment

Signing custody (both required to sign; the app runs unsigned without them):

| Variable | Meaning |
| --- | --- |
| `EVIDENCE_SIGNING_KEY` | Base64 DER PKCS8 private key from step 1. **Sensitive.** |
| `EVIDENCE_KEY_ID` | The kid from step 2. Must match the registry's active entry. |

Instance identity (ADR-0020: everything that names your instance inside
emitted evidence is configuration, resolved in
[`src/lib/site-config.ts`](../src/lib/site-config.ts); with none of these
set, the demo deployment's values are emitted):

| Variable | Meaning | Default |
| --- | --- | --- |
| `EVIDENCE_SITE_ORIGIN` | Public origin of your instance. Registry URLs, the verify-side fallback, the publication host, the PROV platform-agent URL, and the attribution links inside authored notebooks and downloaded bundles all derive from it — for most instances this one variable plus the signer set is the whole identity story. | demo origin |
| `EVIDENCE_SIGNER_BINDING_TIER` | Envelope `signer.bindingTier` (§8.5). | `platform` |
| `EVIDENCE_SIGNER_IDENTIFIER` | Envelope `signer.identifier` — must match the registry entry (check #14). | demo identifier |
| `EVIDENCE_SIGNER_DISPLAY_NAME` | Envelope `signer.displayName` — must match the registry entry. | demo name |
| `EVIDENCE_PUBLICATION_HOST` | Host label on `attestation/publishes/v1` nodes, the datHere environment extension, notebook "Generated via" lines, and the skill-text host mentions (the latter resolve at process start, not per request). | host of origin |
| `EVIDENCE_TRUST_REGISTRY_CANONICAL_URL` | Sidecar `trustRegistryUrl` override, for a registry hosted off-origin. | origin + canonical well-known path |
| `EVIDENCE_TRUST_REGISTRY_LEGACY_URL` | Sidecar `trustRegistryUrlLegacy` override. Set to an **empty string** to omit the field — an instance with no pre-ADR-0012 client base has no legacy path to honor. | origin + legacy well-known path |
| `EVIDENCE_PLATFORM_AGENT_ID` | PROV platform-agent id inside the signed provenance graph. | demo id |
| `EVIDENCE_PLATFORM_AGENT_TITLE` | PROV platform-agent title and the "Generated by …" attribution name in notebooks. | demo title |
| `EVIDENCE_PLATFORM_AGENT_URL` | PROV platform-agent URL. | `EVIDENCE_SITE_ORIGIN` when set, else demo URL |

Check the wiring with the presence-only preflight (no values are read or
printed): `node scripts/preflight-env.mjs`.

## 5. Smoke test

Publish a fresh package and verify it on your instance's detail page: the
signature check should pass, key trust should read "Signed with active key",
and the commitment sidecar (`/api/evidence/<slug>/commitment`) should carry
**your** `trustRegistryUrl`. A third party should be able to verify the
package against your registry with no knowledge of your internals.

## Do not parameterize: vocabulary identifiers

The variables above cover everything that names *your instance*. A separate
class of strings looks similarly instance-flavored but is **format
vocabulary** — identifiers of the term set itself, shared by every producer
and verifier of these packages:

- the `civic:` JSON-LD namespace (`https://civicaitools.org/ns/evidence/`)
  and the `urn:civic-evidence:` id scheme in provenance graphs;
- the `org.civicaitools.*` extension keys
  (`org.civicaitools.environment`, `org.civicaitools.notebook`,
  `org.civicaitools.evidence`);
- the `captureMethod` / `contentProfile` / `producerProfile` vocabulary
  values (e.g. `chat-flow-stream`, `datHere`,
  `ai-assisted-analysis/datHere`) and the `content/*` / `attestation/*`
  type taxonomy.

These are like XML namespace URIs: they *identify* the vocabulary, they do
not *locate* your deployment. **Do not sed-replace them with your own
domain.** An instance that rewrites them emits packages that no longer parse
as this format — verifiers stop recognizing the extensions, provenance terms
lose their definitions, and the result is a silent semantic fork rather than
a rebranded instance. They live in the published packages
(`@typedstandards/civic-typed-harness`), not in this repository's
configuration, precisely so that a well-meaning identity sweep cannot reach
them.
