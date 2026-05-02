# Contribute response-capture extension to Agent Receipts (upstream)

**Repo:** `agent-receipts/ar` (primary, upstream contribution); civic-ai-tools (planning + coordination only — no civic-ai-tools code change)
**Labels:** future-work, upstream-contribution, trace-layer, infrastructure, low-priority
**Estimated effort:** M (bounded technical work; gated on upstream-coordination handshake)
**Blocks:** post-M8 evaluation of `org.agentreceipts.chain` evidence-package extension (`civic-ai-tools-website#59`); future resolution of `civic-ai-tools/docs/architecture/end-state-vision.md` §Open questions item #4 — trace capture

## Problem

Agent Receipts (`agent-receipts/ar`) is a draft-v0.1 open protocol for capturing per-call receipts of MCP tool invocations as W3C Verifiable Credentials, with Ed25519 per-receipt signatures and an inter-call hash chain. Per `civic-ai-tools/docs/research/agent-receipts-evaluation.md` (April 2026), the current v0.1 capture path stores `action.parameters_hash` (SHA-256 of RFC 8785 canonical parameters) but explicitly **does not store the response body or any response hash**. An open upstream proposal — [agent-receipts/ar#153](https://github.com/agent-receipts/ar/issues/153) — proposes adding a response hash as an optional field; the issue has zero comments and is unshipped as of the eval.

That gap is what currently keeps Agent Receipts from being a viable replacement for the project's OTel-shaped trace layer (`civic-ai-tools-website/src/lib/evidence/trace.ts`). The OTel layer captures both parameters and response bodies and feeds the PROV-O graph and the per-tool-call rendering on the evidence detail page. Without response-content capture, an Agent Receipts receipt records *that a tool call happened* but not *what the tool call returned* — which means a downstream verifier can confirm the chain's structure but cannot recompute or audit the analysis from receipts alone.

The Open Evidence Standard's trace-capture layer (per `civic-ai-tools/docs/architecture/end-state-vision.md` §1 L2 and §2) currently uses hand-rolled OTel-shaped JSON. It is good enough for the prototype and near-term adopters, but it is not a real OTel SDK and does not survive adopters who bring their own OTel infrastructure. Agent Receipts with response capture would be a strong candidate to replace or augment it. Contributing the response-capture extension upstream changes the project's relationship with Agent Receipts from consumer to contributor and gives the standard a clean answer to "what's your trace layer?"

## Proposed approach

A draft PR or formal design proposal posted to `agent-receipts/ar` that addresses:

1. **Response-stream interception in `mcp-proxy`.** The reference proxy at `agent-receipts/ar/mcp-proxy/` wraps an MCP server child process's stdin/stdout. Add response-capture at the same wire layer where parameters are intercepted today, before the response is forwarded back to the calling client.
2. **Canonical response hashing.** Apply RFC 8785 canonicalization (already used for `parameters_hash`) to the response payload, then SHA-256. The canonical form must handle MCP `tools/call` response shapes (text content blocks, structured content, error envelopes) in a deterministic way.
3. **VC schema extension.** Add an optional `action.response_hash` field to the Verifiable Credential, mirroring the existing `action.parameters_hash` shape. Optionality preserves backward compatibility with v0.1 receipts.
4. **Optional content-addressable storage of the response body.** A separate optional field — for example `action.response_storage` — pointing to a CAS-resolvable URI (or BlobRef-style structure) so verifiers can fetch the raw bytes when selective disclosure is acceptable. Hash-only-vs-hash-plus-body should be a publisher choice, not a protocol requirement.
5. **Coordination with upstream maintainers.** A 30-minute conversation with `ojongerius` (effective sole substantive maintainer per the eval) about roadmap, review capacity, and whether this scope fits the v0.1 → v0.2 increment they have in mind. This conversation is a prerequisite to opening the PR; without it, the work risks duplicating something already in flight or landing against an unwilling upstream.

The work is technically bounded — the protocol primitives already exist for parameters; this extends them to responses. The unbounded part is the human coordination, which is why the prerequisite step matters.

## Scope

**In:**
- Conversation with Agent Receipts maintainers about roadmap and scope alignment.
- Design proposal or draft PR in `agent-receipts/ar` covering response-stream interception, canonical response hashing, VC schema extension, and optional CAS-storage reference.
- Reference implementation in `mcp-proxy` if maintainers prefer a code-first proposal.
- Coordination of how `agent-receipts/ar#153` resolves relative to this contribution.

**Out:**
- Switching the civic-ai-tools trace layer from OTel-shaped JSON to Agent Receipts. That is a separate downstream decision (see `civic-ai-tools/docs/architecture/end-state-vision.md` §Open questions item #4 — trace capture) which depends on this work being shipped first.
- Implementing the `org.civicaitools.agentreceipts-chain` (or equivalent) evidence-package extension. Tracked separately in `civic-ai-tools-website#59`.
- Resolving [agent-receipts/ar#124](https://github.com/agent-receipts/ar/issues/124) (remote-hosted `mcp-proxy` for HTTPS MCP servers). That is independently blocking civic-ai-tools' use of Agent Receipts, but is not the gap this issue addresses. Worth explicitly mentioning in the upstream conversation as adjacent context.
- Replacing the OTel-shaped JSON in the same PR. Civic-side adoption is downstream and is gated separately on the Xanadu test.

## Acceptance criteria

- A 30-minute conversation has happened with the Agent Receipts maintainers, with notes captured in `civic-ai-tools/docs/research/agent-receipts-evaluation.md` (or a follow-up doc).
- A draft PR or design proposal is posted to `agent-receipts/ar` covering response-stream interception, canonical response hashing, and the VC schema extension. The optional CAS-storage reference is included as either a sketch or a follow-up.
- Maintainers have publicly acknowledged the approach is acceptable in principle, even if review and merge happen on their timeline.
- `agent-receipts/ar#153` is resolved (closed by this work, superseded, or explicitly merged into the new design).

## Dependencies

- Conversation with Agent Receipts maintainers about their roadmap and review capacity.
- This work is **not** gated on resolution of `civic-ai-tools/docs/architecture/end-state-vision.md` §Open questions item #4 — trace capture. It is valuable independently — a contribution to a standard the project already depends on conceptually.
- The Xanadu test still applies to *adopting* the contributed extension downstream: do not switch the civic-ai-tools trace infrastructure until at least one external adopter (Boston OpenContext, datHere, an academic partner, etc.) explicitly asks for Agent Receipts integration. The eval doc's revisit conditions (`agent-receipts/ar#124` closed, `agent-receipts/ar#153` shipped, governance maturation, or explicit adopter ask) remain authoritative for the *adoption* decision; this issue only commits to the *contribution* path.

## Risk

- The upstream maintainer conversation reveals incompatible scope or roadmap, and the work cannot land cleanly. Mitigation: keep the design proposal as a public artifact regardless of merge outcome — it is a reference for the eventual `org.civicaitools.agentreceipts-chain` extension either way.
- Cross-SDK correctness bugs documented in the eval (`agent-receipts/ar#82`, `#83`, `#84`, `#86`, `#118`) may complicate the canonical-hashing work — adding response hashing on top of an unstable parameters-hash baseline could re-litigate canonicalization decisions. Mitigation: scope the response-hash design to use the same canonicalization rules as parameters and explicitly defer cross-SDK conformance to upstream.

## Reproducible at

- Eval doc: `civic-ai-tools/docs/research/agent-receipts-evaluation.md` (last updated April 2026).
- Trace-layer baseline: `civic-ai-tools-website/src/lib/evidence/trace.ts`.
- Existing extension architecture: `civic-ai-tools-website` packager (`src/lib/evidence/packager.ts`) and the reverse-DNS extensions pattern shipped via `civic-ai-tools-website#54`.
- Downstream consumer issue: `civic-ai-tools-website#59` (Agent Receipts interop evidence-package extension).
- Upstream issues referenced: [agent-receipts/ar#124](https://github.com/agent-receipts/ar/issues/124) (remote-proxy support), [agent-receipts/ar#153](https://github.com/agent-receipts/ar/issues/153) (response-hash proposal).
