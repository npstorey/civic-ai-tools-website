# Instance identity setup — keys, registry, and configuration

This guide takes a fresh instance of the application from the unsigned dev
tier to a signing publisher (ADR-0020: per-instance keys with an intentional
unsigned dev tier). Follow it once at go-to-production time; afterwards, key
changes follow the rotation runbook in
[`docs/key-rotation.md`](key-rotation.md).

An instance works unsigned out of the box — analyses run and packages can be
produced and inspected. Signing is the **go-to-production** step: keygen →
registry → environment. Nothing unsigned can reach the `sealed` or `public`
states, and the application enforces this (ADR-0020 Decisions B/C): with no
signing key configured, the **seal and publish actions are gated
off** server-side and in the UI, verification labels unsigned output
prominently ("Unsigned package — no cryptographic commitment"), and a
**running-unsigned banner** shows site-wide outside a dev environment
(`next dev` stays calm). An instance that skips this guide has opted out of
publishing signed records — a legitimate choice, never a silent one.

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
  "$comment": "Trust registry for <your-host> record packages. Verifiers fetch this file, match the (kid, publicKey) pair embedded in a package's signature, and apply the status semantics below. See docs/key-rotation.md for the rotation runbook.",
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

- **`signerIdentity` here must match your `PUBLISHER_SIGNER_*` configuration**
  (step 4). Verify check #14 cross-checks the envelope's `signer` claim
  against the registry entry for the signing kid; a mismatch fails
  verification.
- **Bump `generatedAt` on every registry edit** — it is the registry's
  "thisUpdate" (CRL precedent), letting offline verifiers state the as-of
  date of the snapshot they checked.

Deploy the registry **before** signing anything with the new key: verifiers
must be able to see the key before they see a package signed by it.

## 4. Configure the environment

**A note on names.** Every variable in this section took the `EVIDENCE_`
prefix before the 2026-08-19 vocabulary settlement (Appendix J of the Typed
Standards specification; [civic-ai-tools#160](https://github.com/npstorey/civic-ai-tools/issues/160)),
and each one's prior-era spelling is **still read** as a fallback. An instance
configured before the settlement needs no edit; it logs a one-time deprecation
warning per variable resolved that way, and the prior-era names are removed
only at a future major version. Set the `PUBLISHER_*` names on a new instance.
Do not set both spellings of one variable: the canonical name wins whenever it
is **defined**, and "defined empty" counts — an empty
`PUBLISHER_TRUST_REGISTRY_LEGACY_URL` beside a populated prior-era twin means
omit, not fall back.

Signing custody (both required to sign; the app runs unsigned without them):

| Variable | Prior-era name | Meaning |
| --- | --- | --- |
| `PUBLISHER_SIGNING_KEY` | `EVIDENCE_SIGNING_KEY` | Base64 DER PKCS8 private key from step 1. **Sensitive.** |
| `PUBLISHER_KEY_ID` | `EVIDENCE_KEY_ID` | The kid from step 2. Must match the registry's active entry. No default — see below. |

**Neither half has a coded default, and half of the pair is not half of the
feature.** With a signing key set but no `PUBLISHER_KEY_ID`, the instance
refuses to seal or publish: it will not substitute a key id it was not given.
That refusal is deliberate. A kid is an identity claim — the handle a verifier
uses to look a public key up in a trust registry — so emitting one you did not
configure would label your signature with someone else's registry entry. The
package then fails verification (that entry holds a different public key)
while appearing to claim another party's identity. Your private key is never
involved either way; the damage is misattribution and an unverifiable record,
which is why the instance stops instead of guessing.

You will see the half-configured state three ways: a site-wide banner naming
`PUBLISHER_KEY_ID`, a `signing_key_id_missing` refusal from any seal/publish
attempt, and a preflight warning that the signing group is partially set.

**Identity is the third leg.** Custody (the key) and the declared kid are
not enough on their own: signed output also names your instance — its
origin, its envelope signer claim, its platform agent, its trust-registry
URLs — and none of those has a coded default either. With the signing pair
set but the identity set below incomplete, every seal/publish attempt is
refused with `instance_identity_missing`, naming exactly the missing
variables, and the same site-wide banner shows. The refusal exists for the
same reason as the kid refusal: an instance that emitted an origin, signer,
or registry it never configured would misattribute the publisher and fail
verification. An instance that has configured *nothing* (no key, no
identity) is simply the unsigned tier — and its unsigned surfaces
(downloaded notebooks, copied output, page metadata) honestly **omit**
instance attribution rather than carry anyone else's.

Instance identity (ADR-0020: everything that names your instance inside
an emitted record package is configuration, resolved in
[`src/lib/site-config.ts`](../src/lib/site-config.ts)). The first five are
**required to sign** — they have no defaults, and the seal/commit gate
refuses (`instance_identity_missing`) while any is missing. The rest are
per-item overrides whose defaults **derive from your own values** (host and
URLs from the origin, the agent id from the host) — derivation from
operator-supplied configuration, never from another deployment's identity:

| Variable | Prior-era name | Meaning | Default |
| --- | --- | --- | --- |
| `PUBLISHER_SITE_ORIGIN` | `EVIDENCE_SITE_ORIGIN` | **Required to sign.** Public origin of your instance. Registry URLs, the publication host, the PROV platform-agent URL, and the attribution links inside authored notebooks and downloaded bundles all derive from it — for most instances this one variable plus the signer set and agent title is the whole identity story. | none — refuse to sign |
| `PUBLISHER_SIGNER_BINDING_TIER` | `EVIDENCE_SIGNER_BINDING_TIER` | **Required to sign.** Envelope `signer.bindingTier` (§8.5) — `platform` for a standard instance. | none — refuse to sign |
| `PUBLISHER_SIGNER_IDENTIFIER` | `EVIDENCE_SIGNER_IDENTIFIER` | **Required to sign.** Envelope `signer.identifier` — must match the registry entry (check #14). | none — refuse to sign |
| `PUBLISHER_SIGNER_DISPLAY_NAME` | `EVIDENCE_SIGNER_DISPLAY_NAME` | **Required to sign.** Envelope `signer.displayName` — must match the registry entry. | none — refuse to sign |
| `PUBLISHER_PLATFORM_AGENT_TITLE` | `EVIDENCE_PLATFORM_AGENT_TITLE` | **Required to sign.** PROV platform-agent title and the "Generated by …" attribution name in notebooks. | none — refuse to sign |
| `PUBLISHER_PUBLICATION_HOST` | `EVIDENCE_PUBLICATION_HOST` | Host label on `attestation/publishes/v1` nodes, the datHere environment extension, notebook "Generated via" lines, and the skill-text host mentions (the latter resolve at process start, not per request). | host of origin |
| `PUBLISHER_TRUST_REGISTRY_CANONICAL_URL` | `EVIDENCE_TRUST_REGISTRY_CANONICAL_URL` | Sidecar `trustRegistryUrl` override, for a registry hosted off-origin. | origin + canonical well-known path |
| `PUBLISHER_TRUST_REGISTRY_LEGACY_URL` | `EVIDENCE_TRUST_REGISTRY_LEGACY_URL` | Sidecar `trustRegistryUrlLegacy` override. Set to an **empty string** to omit the field — an instance with no pre-ADR-0012 client base has no legacy path to honor. | origin + legacy well-known path |
| `PUBLISHER_PLATFORM_AGENT_ID` | `EVIDENCE_PLATFORM_AGENT_ID` | PROV platform-agent id inside the signed provenance graph. | the publication host |
| `PUBLISHER_PLATFORM_AGENT_URL` | `EVIDENCE_PLATFORM_AGENT_URL` | PROV platform-agent URL. | `PUBLISHER_SITE_ORIGIN` |

Two more publisher variables exist outside this table:
`PUBLISHER_PUBLIC_KEY` (written by the keygen script for registry edits, never
read at run time) and `PUBLISHER_TRUST_REGISTRY_URL` (the **verify-side
consume** override — feeds the HTTP-fetch fallback your verify route would
use if it ever reached that step, which in practice it doesn't; never part
of signed output). Both are documented in
[`docs/key-rotation.md`](key-rotation.md#environment-variables).

Check the wiring with the presence-only preflight (no values are read or
printed): `node scripts/preflight-env.mjs`.

**Chrome branding is a separate, lighter set.** The table above covers
everything that names your instance *inside an emitted record package* —
values that are signed and cross-checked against your registry. What names it
in the *site chrome* — the header wordmark, page titles, the footer
identity lines, and the accent color — is presentation, configured by
the `SITE_BRAND_*` set in
[deploy.md's Branding and theming section](deploy.md#branding-and-theming-chrome-only).
Nothing in that set is ever signed or verified. A fully renamed instance
typically sets both `SITE_BRAND_NAME` (chrome) and
`PUBLISHER_PLATFORM_AGENT_TITLE` (publisher attribution); the two are read
independently on purpose, so neither can surprise the other.

## 5. Smoke test

Publish a fresh package and verify it on your instance's detail page: the
signature check should pass, key trust should read "Signed with active key",
and the commitment sidecar (`/api/records/<slug>/commitment`) should carry
**your** `trustRegistryUrl`. A third party should be able to verify the
package against your registry with no knowledge of your internals.

## Do not parameterize: vocabulary identifiers

The variables above cover everything that names *your instance*. A separate
class of strings looks similarly instance-flavored but is **format
vocabulary** — identifiers of the term set itself, shared by every producer
and verifier of these packages:

- the `civic:` JSON-LD namespace (`https://civicaitools.org/ns/civic/`)
  and the `urn:civic-record:` id scheme in provenance graphs. These two took
  the 2026-08-19 settlement's new spellings at harness 0.3.0; packages
  published before that carry `https://civicaitools.org/ns/evidence/` and
  `urn:civic-evidence:`, which stay valid **forever** — they are frozen inside
  already-signed content, and a conformant verifier accepts both eras
  (Appendix J §J.4). The rule below applies identically to both;
- the `org.civicaitools.*` extension keys
  (`org.civicaitools.environment`, `org.civicaitools.notebook`,
  `org.civicaitools.record` — accepted forever alongside its prior-era
  spelling `org.civicaitools.evidence`, settlement ruling D3);
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
