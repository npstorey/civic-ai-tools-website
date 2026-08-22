---
paths:
  - "src/lib/evidence/**"
  - "src/app/api/evidence/**"
  - "src/components/evidence/**"
---

# Record surfaces

You are in the record-system core — packaging, signing, verification, provenance, attestation,
lifecycle — or in one of the surfaces that renders it. Four pointers before you change anything here.

- **[`docs/design-principles.md`](../../docs/design-principles.md)** — read it before changing the
  record detail page, chat output rendering, the provenance graph, or any other AI-output /
  attestation surface. Disclosure not validation, hierarchy not equality, narrative not metadata,
  axes not chips, user language not implementation language.
- **[`docs/api/records-publish.md`](../../docs/api/records-publish.md)** — the record-publish
  contract, including the repositories-and-layers orientation.
- **[`civic-ai-tools/docs/trust-and-evidence.md`](https://github.com/npstorey/civic-ai-tools/blob/main/docs/trust-and-evidence.md)**
  — what a published record does and does not establish for a reader. A signature attests that the
  package was signed and is unaltered; it does not attest that the labelled capture mechanism ran.
  Read it before writing any copy that tells a reader what verification proves.
- **Canonical spec drafts** live in
  [`civic-ai-tools/docs/architecture/`](https://github.com/npstorey/civic-ai-tools/tree/main/docs/architecture)
  — package shape, signing, `captureMethod`, withdrawal, the typed-claims layer. Sections with open
  questions carry `⚠ Subject to Open Question #N` callouts pointing at `open-questions.md`. Where
  this codebase diverges from a draft, the codebase wins and the spec gets updated to match.

## The directory name is not a rename candidate

`src/lib/evidence/`, `src/app/api/evidence/`, `src/components/evidence/` and the type names inside
them stay on the prior-era spelling. The 2026-08-19 vocabulary settlement (Appendix J) renamed the
wire and reader-facing vocabulary to "record"; these are internal identifiers that never cross the
wire, and it deliberately left them alone. Do not "finish the rename" here.

What *is* reader-facing and did move: the routes (`/records`, `/api/records/*`, with `/evidence` and
`/api/evidence/*` kept as permanent aliases — the route files under `src/app/api/records/` are thin
re-exports of the implementations here) and the 13 `PUBLISHER_`-prefixed environment variables, each
of which still reads its prior-era `EVIDENCE_` spelling as a fallback through the single resolver at
`src/lib/publisher-env.ts`.
