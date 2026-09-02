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

Conventionally `platform:record-YYYY-MM` (the year-month you activate it) —
the settlement vocabulary (civic-ai-tools#160) for kids minted from now on.
Keep the `platform:` prefix — it scopes the key to your instance's platform
identity and leaves room for per-user scopes later without a registry schema
migration. The kid is not secret; it is the registry lookup handle for the
matching public key. (The reference deployment's own live kid,
`platform:evidence-2026-04`, predates this convention and is exempt-frozen —
see [`docs/key-rotation.md`](key-rotation.md) — but a first-time kid on a
new instance has no such history to preserve, so mint it under the current
convention.)

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
      "kid": "platform:record-YYYY-MM",
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

One more publisher variable exists outside this table:
`PUBLISHER_PUBLIC_KEY` (written by the keygen script for registry edits, never
read at run time). Documented in
[`docs/key-rotation.md`](key-rotation.md#environment-variables).

A second variable used to live here too — `PUBLISHER_TRUST_REGISTRY_URL`, the
**verify-side consume** override, which fed an HTTP-fetch fallback your
verify route would use if it ever reached that step. civic-ai-tools#155 P1
measured that it never did on any real call path, and civic-ai-tools#155 P1b
retired the variable outright; see
[`docs/key-rotation.md`](key-rotation.md#environment-variables) for the
history.

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

## 5. Point the instance at a model endpoint

Steps 1–4 make this instance a publisher. This step decides **which AI model
endpoint it calls and what a signed record says the model was** — two different
questions, which is why there are two groups of variables below.

An instance that leaves all of these unset runs against the built-in endpoint
with the built-in model list, exactly as before, and can skip to step 6. Read
this step if you are pointing the instance at your own endpoint.

**Read this section as a checklist, not as a report.** The wire behavior of the
deployment-routed dialect is proven in this repository against a local fake
HTTP server (`src/lib/model-client.test.ts`, whose test names carry that scope)
and **has never been run against a real deployment-routed resource**.
Everything the fake necessarily stubs is listed at the end of this section. You
are the first person to run this leg; the checks below are written so that you
find out, rather than assume.

### 5.1 The endpoint variables

`MODEL_API_KIND` selects a **wire dialect**, not merely a base URL — the
dialects differ in how a model is addressed, how the request authenticates, and
whether an api-version is part of the URL. An unrecognized value is refused,
never treated as the default.

| Variable | Meaning | Required when | On the evidence path? (ADR-0024 §C) |
| --- | --- | --- | --- |
| `MODEL_API_KEY` | The key the configured endpoint reads. Prior-era name `OPENROUTER_API_KEY`, still accepted — the canonical name wins whenever it is **defined**, empty string included. **Sensitive.** | always | **No.** A wrong value fails the request; it never reaches a byte a verifier reads. |
| `MODEL_API_KIND` | `openai-compatible` (default) or `azure-openai`. | never — but see the rest of this table | **Yes (§C.1).** It derives `gen_ai.system` on the signed trace and the wording of the PROV model agent's description. |
| `MODEL_API_BASE_URL` | The chat-completions endpoint. Under `azure-openai` this is the **resource endpoint** — the `https://` origin, no path. | `MODEL_API_KIND=azure-openai` | **Yes, indirectly (§C.3).** It never appears in a package — a public record must not carry your infrastructure hostnames — and it decides whether the built-in model list is trusted at all. It reaches `gen_ai.system` in two narrow cases only: the built-in default endpoint records `openrouter`, and OpenAI's own host records `openai`. Any other endpoint records the **dialect** you declared in `MODEL_API_KIND`, because naming a vendor your configuration never mentioned would be a guess printed under a signature. |
| `MODEL_API_VERSION` | The api-version query parameter. There is no safe default: an api-version gates which request and response fields exist. | `MODEL_API_KIND=azure-openai` | **Yes, indirectly (§C.3).** It decides which response fields exist, and `gen_ai.response.model` — the endpoint's own report of what it ran, recorded under the signature — is read from the response body. |
| `MODEL_API_AUTH` | `bearer` or `api-key`. Derived from the dialect when unset; a value contradicting the dialect is refused rather than ignored. `entra` is reserved in the enum and refused — there is no code behind it. | never | **No.** Authentication mechanics only. |
| `MODEL_CATALOG` | This instance's model list, as a JSON document. | any endpoint other than the built-in one | **Yes (§C.1).** Each entry's `model` is the identity a signed record asserts. |
| `MODEL_CATALOG_PATH` | The same document, delivered as a file the server reads. Same schema. **Setting both is refused**, not resolved by precedence: whichever one lost would be a list of models you believe this instance offers and it does not. | as above | **Yes (§C.1).** |

Two refusals to expect while you are wiring this, both deliberate and both
raised before any upstream call is made:

- **No catalog against a non-built-in endpoint.** The built-in list names public
  slugs of the default endpoint. Against yours those ids may name nothing, or
  name something else, and the identity they would write into a signed record
  would be a guess. Declare your models or the instance refuses.
- **An `azure-openai` entry with no `model` field.** Under that dialect
  `endpointModel` is a deployment name you chose, which is not a model identity.
  The catalog must say what the model actually is.

### 5.2 The catalog

The catalog is a JSON **array** of entries. `endpointModel` is what goes on the
wire as the `model` parameter — under `azure-openai`, your deployment name.
`model` is the identity signed output asserts. Keeping them apart is the whole
reason this step exists: a deployment name is an operator-chosen alias, and a
record that published it would be telling a reader that "prod-analysis-1" is a
model.

Three roles are claimed by flags rather than by hardcoded ids, so that every
model this instance calls is one you declared:

- `default: true` — **exactly one** entry. The model the executed-notebook route
  uses when a caller names none.
- `evaluator: <rank>` — the publication gate's preference order, lower first. It
  walks that order and takes the first entry that is not the analysis model, so
  **declare at least two** or an analysis by your only evaluator cannot be
  independently evaluated.
- `summarizer: true` — **at most one**. Drafts the one-paragraph plain-language
  summary the publish dialog offers. Optional: the default entry stands in.

An example, with placeholder deployment names — substitute your own:

```json
[
  {
    "id": "analysis",
    "name": "Analysis Model",
    "tag": "recommended",
    "provider": "Example Provider",
    "description": "General-purpose analysis over civic data",
    "supports_tools": true,
    "endpointModel": "example-analysis-deployment",
    "model": "vendor/example-model-4",
    "default": true,
    "evaluator": 2,
    "pricing": { "input": 2.5, "output": 10.0 }
  },
  {
    "id": "reviewer",
    "name": "Reviewer Model",
    "provider": "Example Provider",
    "description": "Scores an analysis against the adversarial rubric",
    "supports_tools": true,
    "endpointModel": "example-reviewer-deployment",
    "model": "vendor/example-model-5",
    "evaluator": 1,
    "pricing": { "input": 3.0, "output": 15.0 }
  },
  {
    "id": "summariser",
    "name": "Summary Model",
    "provider": "Example Provider",
    "supports_tools": true,
    "endpointModel": "example-summary-deployment",
    "model": "vendor/example-model-mini",
    "selectable": false,
    "summarizer": true,
    "pricing": { "input": 0.3, "output": 2.5 }
  }
]
```

Field notes, all of them things the validator will tell you about anyway:

- `id`, `name`, `provider` and `endpointModel` are required on every entry;
  `model` is required under `azure-openai`. `supports_tools` must be a boolean —
  this app's whole point is tool calls, so an entry that cannot make them is a
  configuration worth making explicit.
- `tag` and `description` are shown in the picker. `maxTokenBudget` is
  validated and served on `/api/models`, but **nothing reads it**: no code path
  applies it as a ceiling. The per-request token budget is one module-level
  constant for the whole instance — `TOKEN_LIMIT_PER_REQUEST` (default 200,000,
  read in `src/lib/openrouter-streaming.ts`) — and there is no per-model route
  to it. Setting the field is not an error; it just has no effect today.
- `selectable: false` keeps an entry out of the picker while leaving it
  resolvable — the shape used above for a model that only fills a role.
- `pricing` is per **1M** tokens, in USD. **A configured catalog's `pricing` is
  never read.** The cost estimate a record page renders consults the built-in
  catalog and the historical price table only (`builtInPricing`,
  `src/lib/model-catalog.ts`), and it looks a model up by the *declared*
  identity recorded in `cost.model` while a catalog is keyed by `id` — so the
  two do not even share a namespace. On an instance running its own catalog the
  estimate is therefore **omitted rather than wrong**, which is the failure
  direction to want; `src/lib/models.ts` states the same limitation at the
  source. Whether the field should exist at all is
  [#315](https://github.com/npstorey/civic-ai-tools-website/issues/315).
- **An unknown field is refused, not ignored**, so a misspelling cannot silently
  do nothing.

### 5.3 The first-query check

Bring the instance up and work outward from the cheapest check. This
walks the API path directly (`curl`, not a browser); if you are checking
from a browser instead, `/ask` and `/explore` are gated by different
mechanisms — see ["Usable, not just
built"](deploy.md#usable-not-just-built) in the deploy guide before
concluding either one is broken.

```bash
# 1. Presence — and one comparison. No value is ever printed; MODEL_API_BASE_URL
#    is the sole value read, and only to ask whether it is the built-in default,
#    because any other endpoint needs a MODEL_CATALOG.
node scripts/preflight-env.mjs

# 2. The catalog parsed, and the models this instance now offers.
#    A 503 here means the catalog could not be read; the body names the variable.
curl -s http://127.0.0.1:3000/api/models

# 3. One real query, against a model id from step 2.
curl -s -X POST http://127.0.0.1:3000/api/compare \
  -H 'Content-Type: application/json' \
  -d '{"query":"test","model":"<an id from step 2>"}'
```

What the failures mean:

| What you see | What it is |
| --- | --- |
| `400` naming the model you asked for | That id is not in this instance's catalog. Both comparison routes and `/api/query-notebook` refuse an id the catalog does not describe, before any upstream call — so a typo costs no tokens and reaches no record. (The refusal lists the ids it does accept, which includes any `selectable: false` entries `/api/models` does not show.) |
| `503` with `code: "model_not_configured"` | The environment cannot describe a usable endpoint — no key, or a dialect missing a setting it requires. The message names the variable at fault, no upstream call was made, and nothing was charged against the day's request budget. |
| `502` with `code: "model_auth_rejected"` | The endpoint refused the key — it exists and is wrong for this endpoint. |
| `502` with `code: "model_rate_limited"` | The **endpoint** is rate-limiting this server. Not the app's own per-day limiter, which answers `429` with `Rate limit exceeded`. Under deployment routing, quota is per-model and per-region, so this points at one deployment's pool rather than at the whole resource. |
| A `404`-ish or "deployment not found" error from the endpoint | `endpointModel` does not name a deployment on that resource. This is the failure mode nobody here has seen — see §5.5. |

**A tool call that hangs now fails at 45 seconds.** `/api/compare` had no
per-tool-call bound until 2026-08: a source that accepted the connection and
then stopped responding held your request open until the platform killed the
invocation, and you got a platform error page naming no tool. The bound is
`COMPARE_MCP_TOOL_TIMEOUT_MS` in `src/lib/model-loop/compare-loop.ts`, the same
45 seconds the streaming routes and replay use. Past it the call fails on its
own account — `MCP tool "get_data" timed out after 45s` in the log, recorded as
a failed tool call — and the comparison still answers from whatever did come
back. The counterweight is worth knowing before you tune it: this is the
*blocking* route, so the bound is a hard ceiling with nothing already streamed,
and a legitimately slow query that would once have eventually succeeded now
fails instead.

**Where to watch for a model-identity mismatch: not here.** A line reading
`endpoint reported a different model than this instance declares` means your
`model` field and what the endpoint answered with disagree. That is **often
benign** — an endpoint answering a dated build for an undated request — and it
never blocks a publish. It is worth seeing once, because it is also exactly what
a mislabelled deployment looks like.

But it cannot appear on the check above. The warning is emitted while the loop
records a span (`responseModelAttributes` in
`src/lib/model-loop/run-tool-loop.ts`, called only from inside the
span-recording branches), and `/api/compare` builds no trace at all —
`grep -c trace src/app/api/compare/route.ts` returns `0`. Use the streaming
route instead, which takes the same body and builds a trace:

```bash
# Same fields as step 3; SSE rather than one JSON body. Watch the server log.
curl -N -X POST http://127.0.0.1:3000/api/compare-stream \
  -H 'Content-Type: application/json' \
  -d '{"query":"test","model":"<an id from step 2>"}'
```

`/api/query-notebook` traces too, and shows the same line for the same reason.

### 5.4 What to check in a published record's bytes

The point of the catalog is that a signed record names a model rather than your
deployment alias. Verify that on real bytes rather than trusting this document.
Publish one record, then fetch the package. A sealed record's content is
creator-only, so this call needs the creator's session cookie or bearer token —
or publish the record publicly first, or take the bytes from the detail page's
download:

```bash
curl -s http://127.0.0.1:3000/api/records/<slug>/package > package.json
```

Four checks, in order of how badly a failure would matter:

1. **`cost.model` is the identity you declared** — the `model` field of the
   catalog entry, never its `endpointModel`.

   ```bash
   jq '.cost.model' package.json
   ```

2. **`gen_ai.response.model` is what the endpoint itself reported.** It is
   recorded next to the declared identity, under the same signature, precisely
   so a reader can compare the two without trusting either of us. It is absent
   when the endpoint reported nothing — absent, not zero and not a copy of the
   declaration.

   ```bash
   jq '[.. | objects | select(has("gen_ai.response.model"))
        | {declared: .["gen_ai.request.model"], reported: .["gen_ai.response.model"]}]' package.json
   ```

3. **No deployment name and no hostname anywhere in the package.** Your resource
   is your infrastructure; it does not belong in someone else's reading of a
   civic-data analysis.

   ```bash
   grep -c 'example-analysis-deployment' package.json   # expect 0
   grep -c 'example-resource' package.json              # expect 0
   ```

   Substitute your real deployment names and resource host. This is a check
   worth running once per catalog change, not once ever.

4. **`extensions["org.civicaitools.environment"].modelVersion` agrees with
   `cost.model`**, and the provenance graph's model agent carries the same
   identity in `dcterms:title`. They are filled from one value; a disagreement
   means something reached one site and not another.

### 5.5 What nobody has verified — read this before you trust the above

This project's proof of the deployment-routed dialect is a **local fake HTTP
server**, exercised under Node in this repository's test suite. That fixture was
built from the request the SDK actually emits, observed rather than described,
and it pins the path shape, the api-version query parameter, the `api-key`
header, and the absence of an `Authorization` header. It cannot pin anything
that requires a real resource to answer.

The live wiring is deliberately outside this project's acceptance: a
proof-of-concept endpoint belonging to another party's infrastructure is not
something this project can hold as a gate. That decision is recorded rather than
hidden, and this list is what it leaves you.

Unverified against any real deployment-routed endpoint:

- **Auth acceptance and key rotation.** That the `api-key` header is sent is
  pinned; that your resource accepts it, and what rotation does to a running
  instance, is not.
- **Which api-version strings a deployment admits.** The app refuses a missing
  `MODEL_API_VERSION` and names the variable; it has never had a real endpoint
  reject a value it was given.
- **Deployment-name resolution, and its failure mode.** What a resource answers
  for an `endpointModel` naming no deployment — and therefore how legible that
  failure is to you — is unmeasured.
- **The real response body.** Content-filter annotations, `prompt_filter_results`,
  and where token usage actually appears on a streamed response are all shapes
  this app has only seen from a fixture.
- **Streaming.** The fixture exercises only non-streaming `create`. **The app's
  real query path streams.** This is the largest single gap in the list.
- **Token usage on the deployment-routed dialect.** `stream_options` — how this
  app asks for usage on a streamed request — is sent **only** under the
  OpenAI-compatible dialect. Under `azure-openai` this build does not send it at
  all, deliberately: whether the parameter is admitted is an api-version
  question, and an api-version that does not know it answers 400 for the whole
  request rather than ignoring the field, which would cost the answer instead of
  the token count. The consequence is real and worth expecting: a streamed
  record from such an endpoint legitimately carries **no token counts and no
  cost estimate** — omitted rather than recorded as zero. If you measure which
  api-versions do admit it, that is the finding most likely to change this
  build's behavior.

  **The other half of that parameter is no longer an unknown, and it is
  recorded here because it was one.** Under `openai-compatible` the app *does*
  send `stream_options`, including on the built-in default endpoint, and the
  worry was that an endpoint rejecting the parameter answers 400 — which costs
  the answer, not just the token count. On the built-in default it does
  neither: OpenRouter's own usage-accounting documentation, read 2026-08-24,
  says that `usage: { include: true }` and `stream_options: { include_usage:
  true }` "are deprecated and have no effect" and that usage is "included in
  the last SSE message for streaming responses … No additional parameters are
  required." Accepted and ignored, in other words — and a live query run
  against the reference deployment's production instance on 2026-08-24 (by the
  project owner, not from a fixture) returned an answer. The parameter is still
  sent, because `openai-compatible` is a dialect rather than one endpoint and
  an endpoint that has not made the same change still has to be asked. What
  remains genuinely unmeasured is the third case: an OpenAI-compatible endpoint
  that *rejects* the parameter outright. If you run one, that is worth an issue.
- **Error mapping under load.** Real 429s, content-filter refusals and quota
  exhaustion are mapped from synthetic statuses in tests. The mapping is
  structural — it reads the status, not the wording — which is the property most
  likely to survive contact, but it has not made contact.
- **Tool and function calling.** Every analysis this app performs is a tool-call
  loop. The fixture does not exercise one against this dialect.

If you run this leg, the useful thing to send back is what disagreed with this
list — an issue on
[civic-ai-tools-website](https://github.com/npstorey/civic-ai-tools-website/issues)
naming the api-version and the dialect is enough. This section is the honest
state of the project's knowledge, and it should stop being a list of unknowns
the first time someone runs it.

## 6. Smoke test

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
