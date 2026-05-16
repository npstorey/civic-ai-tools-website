# Platform-independence documentation for closed dependencies

**Repo:** civic-ai-tools (architecture docs); coordination with civic-ai-tools-website + socrata-mcp-server for the per-dependency specifics
**Labels:** future-work, documentation, dpg-readiness, governance
**Estimated effort:** S-M (mostly synthesis of existing knowledge; substantive thinking on the model-agnosticism story)
**Blocks:** DPG submission (Indicator 4); academic / standards-engagement adoption stories
**Tracks:** DPG-readiness Indicator 4 (platform independence). Companion to the DPG-readiness proposal at `docs/proposals/dpg-readiness.md`.

## Problem

The project leans on several closed platforms as convenience defaults — Vercel for hosting, Vercel Blob for object storage, Neon for Postgres, Anthropic for the model API, GitHub for social login and the frontmatter-publishing pattern. None of these are architecturally required; the system is substitutable at each layer. But that substitutability is not documented, which means:

- DPG submission Indicator 4 ("solutions must prove independence from the closed component(s) and/or indicate the existence of functional, open alternatives") has no concrete evidence today.
- Academic / standards-track adopters who would want to deploy without depending on Vercel or Anthropic can't easily see how.
- The model-agnosticism claim — central to the architecture conversation's UN OSW digital-sovereignty framing — is asserted but not operationalized.

This issue produces a single comprehensive doc that addresses these gaps.

## Proposed approach

Single deliverable: `civic-ai-tools/docs/platform-independence.md` (or `docs/architecture/platform-independence.md` — directory TBD by where it interacts most with other architecture docs). Structure:

1. **Per-dependency table**: each closed dependency, its role, its open alternative(s), and the substitution mechanics. Initial set:

   | Closed dependency | Role | Open alternative(s) | Substitution mechanics |
   |---|---|---|---|
   | Vercel (hosting) | Next.js app deployment | Any Next-compatible host; self-hosted Node.js + reverse proxy | Standard Next.js deployment; document env-variable handoff. |
   | Vercel Blob | Object storage | S3-compatible (MinIO, Backblaze B2, Wasabi); IPFS for content-addressable | Document the BlobRef abstraction and how to point it at alternatives. |
   | Neon | Serverless Postgres | Self-hosted Postgres; Supabase; any Postgres-protocol host | Standard DATABASE_URL swap. |
   | Anthropic Claude API | LLM | Any model with equivalent tool-calling support (Llama, Mistral, OpenAI, etc.) | The `captureMethod` field records which model was used; document the model-agnostic abstraction. |
   | GitHub (social login) | Identity binding | Any OIDC provider; self-hosted identity (Authentik, Keycloak) | Document the auth abstraction and swap mechanics. |
   | GitHub (frontmatter publishing) | The Data-Concierge-style publishing target | Any git remote (GitLab, Gitea, self-hosted) | The pattern is git-based; GitHub is just the convenience default. |
   | Sigstore / Rekor (transparency log) | Append-only public log | Any append-only log with countersigned timestamps + identity proofs; self-hosted Rekor instance | Document the transparency-log abstraction layer. |

2. **The model-agnosticism story.** The architecture's most distinctive substitutability property. The `captureMethod` field declares what model was used; the protocol doesn't require a particular one. Local LLMs (Llama family, Mistral, etc.) are explicitly supported deployment patterns. This subsection lands the UN OSW digital-sovereignty argument operationally.

3. **The transparency-log substitutability story.** Sigstore / Rekor is the default but not the only option. Any append-only log with countersigned timestamps and identity proofs can serve. Document the abstraction; reference the OES spec's evidence-public-keys.json + trust-registry-bind pattern.

4. **Self-hosting walkthrough.** A high-level path for an adopter who wants to deploy without depending on any of the convenience defaults: which env vars to swap, which abstractions to implement, what limitations they should expect.

5. **Limitations and trade-offs.** Each substitution has costs. Local LLMs have capability gaps relative to frontier models. Self-hosted Rekor lacks the cross-org public-log property of the Sigstore instance. Document honestly.

## Spec changes the work produces

- `docs/platform-independence.md` (or `docs/architecture/platform-independence.md`) — the new doc.
- Possible small updates to `docs/architecture/end-state-vision.md` referencing the new doc.
- Possible small updates to per-repo CLAUDE.md files referencing the new doc.

## Relationship to other work

- **Bundles with**: the DPG submission issue (Indicator 4 evidence).
- **Coordinates with**: licensing audit issue (each open alternative has its own license; licensing audit ensures the alternatives are themselves open per OSI definitions).
- **Coordinates with**: privacy-and-applicable-laws documentation (privacy-friendly deployment patterns may favor specific alternatives — e.g., self-hosted Rekor for jurisdictions with data-locality requirements).
- **Supports**: academic / standards engagement (adopters need to see how to deploy without inheriting all the project's convenience defaults).

## Scope

**In:**
- Per-dependency substitution table with mechanics.
- Model-agnosticism narrative + concrete substitution path.
- Transparency-log substitutability narrative.
- Self-hosting walkthrough.
- Honest limitations and trade-offs section.

**Out:**
- Building any of the alternative implementations (this is documentation; implementation is separate work).
- Detailed performance benchmarks of alternatives (out of scope for v1; could follow as a research effort).
- Recommended-deployment opinions (the doc describes options; recommendations live in the README of each repo).

## Acceptance criteria

- The platform-independence doc exists, covering the initial dependency set above.
- The model-agnosticism story is concrete (cites specific open models known to work; references the captureMethod field).
- The transparency-log substitutability story is concrete (describes the abstraction; references the spec's trust-registry pattern).
- The doc is linked from the DPG submission's Indicator 4 evidence.
- The doc is linked from each repo's README under a "deployment alternatives" or similar heading.

## Dependencies

- **No hard dependencies.** This is documentation synthesis from existing knowledge.
- **Soft coordination with**: DPG submission issue (which references this doc as evidence for Indicator 4).
- **Soft coordination with**: licensing audit (alternatives need to be themselves open).

## Risk

- **Substitution mechanics turn out to be harder than documented.** Mitigation: the doc is a guide, not a guarantee; explicit "tested" vs "documented but not yet tested" annotations on each substitution path. An adopter who actually performs a substitution can contribute back to the doc with their findings.
- **Model-agnosticism narrative oversells local-LLM capability.** Frontier models genuinely outperform local models on many civic-data analysis tasks today. Mitigation: the doc names this honestly; the substitutability claim is that the *protocol* is model-agnostic, not that all models produce equivalent results.
- **Doc going stale as the stack evolves.** Mitigation: ownership tied to the architecture doc set; review when any major dependency changes.

## Reproducible at

- Existing project repos and their dependencies (synthesized from package.json files, deployment configs, env-var documentation).
- Existing architecture conversation lines on model-agnosticism and federation (see the planning doc's source materials).
- DPG Standard: https://www.digitalpublicgoods.net/standard (Indicator 4).
- DPG-readiness proposal: `civic-ai-tools/docs/proposals/dpg-readiness.md` Category I.
