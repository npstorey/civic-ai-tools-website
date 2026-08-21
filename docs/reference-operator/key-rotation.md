# Key rotation — reference deployment specifics

The generic runbook at [`docs/key-rotation.md`](../key-rotation.md) describes
key rotation in host/tool-agnostic terms so it applies to any instance. This
page collects the parts that are specific to how the **reference
deployment** (civicaitools.org, this repo's own production) actually carries
out each step: the PR flow for editing the trust registry, the Vercel
dashboard for signing env vars, and 1Password for key storage. Where the
generic runbook says "see the reference-operator doc," the matching
procedure is here.

Follow the generic runbook for the rotation itself — what to do and in what
order. Come here for how the reference deployment does that concretely.

## Storing key material

The reference deployment records a newly generated keypair in 1Password, as
a new item named after the new kid (this is what generic preventive-rotation
step 1 / compromise-rotation step 2 mean by "store both securely in your
secret manager").

Never paste private key material into a Claude Code session — always use a
separate terminal for key generation, then hand the derived base64 values to
1Password for storage.

## Updating the trust registry (PR flow)

In a PR on the `civic-ai-tools-website` repo, edit
[`public/.well-known/evidence-public-keys.json`](../../public/.well-known/evidence-public-keys.json):

- Insert the new key as `active` with the new `activatedAt` ISO timestamp.
- Flip the previous key's `status` to `deprecated` (preventive rotation) or
  `revoked` (compromise rotation), set the matching `deprecatedAt` or
  `revokedAt` to the same ISO timestamp, and leave the other status-date
  field `null`.
- Bump the document-level `generatedAt` to the current ISO timestamp.

Merge and deploy the registry before rotating env vars — verifiers must be
able to see the new key before they see any package signed by it.

## Updating signing env vars (Vercel)

In the Vercel dashboard (**not** the CLI from a Claude Code session), set
`PUBLISHER_SIGNING_KEY` and `PUBLISHER_KEY_ID` to the new values on both
production and preview, then trigger a redeploy.

For a **compromise rotation**, do this step first, before the registry PR —
exposure time is the variable that matters most, and setting the env var in
the Vercel dashboard is faster than waiting on a PR merge. This is also why
the reference deployment does this from the dashboard rather than scripting
it from a Claude Code session: a compromised-key rotation is exactly the
moment you don't want a private key value passing through an agent session,
even transiently.

## Post-mortem checklist

The reference deployment's post-mortem checklist for a compromise rotation
includes reviewing the Claude Code PreToolUse hook patterns and deny rules
that touched the exposed key, and any 1Password migrations needed to close
the exposure vector — the concrete instances of the generic runbook's
"access-pattern guardrails" and "secret-manager migrations" post-mortem
items.

---

Back to the generic runbook: [`docs/key-rotation.md`](../key-rotation.md).
