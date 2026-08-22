# Disclosure: correctness reviews were recorded unsigned while four surfaces said they were signed

**Status:** draft, for the hub repo (civic-ai-tools#172). Written here because the
fix lives here; the published entry belongs in the hub's disclosure log, not on
this repo's doc index.

**Fix SHA:** `1171c2e` (civic-ai-tools-website, merged 2026-08-22)
**Affected window:** `8f86c9f` (2026-04-12) through `1171c2e` (2026-08-22)
**Found by:** the civic-ai-tools#63 threat-model cold read, registered there as Q73
**Severity:** disclosure defect — the platform described a property it did not have.
No signature was forged, and no verification verdict was affected.

---

## What was claimed

Four product surfaces and two internal drafts told readers that a human
correctness review carried a cryptographic signature.

**Public build-state claims** — `src/components/home/PositioningBand.tsx`:

- `:230` — "human review attaches as its own signed attestation", carried
  alongside a `<LegendLabel status="built" />`. This is the strongest form of
  the claim: not a plan, not a roadmap item, but an assertion that the
  capability was built and shipped.
- `:273` — "human review is recorded as its own signed attestation."

**Submission-time copy** — `src/components/evidence/AttestationDialog.tsx`,
shown to a reviewer at the moment they submitted:

- "A signed, timestamped review from a domain expert."
- The submit button read "Signing and publishing…" while the request was in
  flight — describing an operation that was not happening.

**Module-level documentation**, which is where a contributor would go to check
the first two:

- `src/lib/evidence/expert-attestation.ts:2` — "A human domain expert submits a
  free-text signed review on an evidence package."
- `src/lib/db/schema.ts:32` — "`expert_attestation` is a free-text, signed
  review attached by a human domain expert."

**Internal working drafts** — `docs/proposed-issues/007-attestation-as-upstream-evidence.md`
described the attestation infrastructure as already "handling signing", and
reasoned about future work from that premise.

## What was actually true

From `8f86c9f` (2026-04-12) until `1171c2e` (2026-08-22), every correctness
review was **content-addressed and hash-bound to its base package, and
unsigned.**

The submission route called `signPackage(hash)` **without awaiting it** and
discarded the return value; it then awaited `getRfc3161Timestamp(hash)` and
discarded that too; then it inserted a row into a table that had no column to
hold either. A signature was computed on every single submission and thrown
away. `attestation_packages` gained `signature`, `signing_key_id`,
`rfc3161_timestamp`, `signed_at`, and `unsigned_reason` only at migration 0016,
as part of the fix.

The reviews themselves were never fabricated or altered. Review text, author
identity, and the content hash binding each review to the package it commented
on were all stored correctly and remain unchanged. What was missing was the
cryptographic commitment tying them to the recording instance.

## What was NOT affected

Scoping this precisely matters, because "signatures were broken" would overstate
it in three directions:

- **Base-record signatures were unaffected.** Published record packages were
  signed, timestamped, and logged exactly as documented. This defect was
  confined to the review rows in `attestation_packages`.
- **No verification verdict was affected.** Reviews have never been an input to
  verification (spec §9.2 check #10; ADR-0010). A signed review would not have
  changed any verdict, and an unsigned one did not either. No published
  verification result needs revisiting.
- **Lifecycle attestations were unaffected.** The `attestation_nodes` chain —
  `publishes`, `locatedAt`, `withdraws`, `reinstates`, `evaluates` — consists of
  full signed envelopes, each with its own envelope hash, signature, timestamp,
  and transparency-log proof. Those are a different table and a different
  mechanism, and every claim made about them was and is accurate.

## How it was found

Not by a user report and not by monitoring. It surfaced during the
civic-ai-tools#63 threat-model cold read — a deliberate line-by-line pass
comparing what the surfaces claim against what the code does — and was
registered there as open question Q73.

We consider the detection route itself worth disclosing: the defect was
invisible to tests (nothing asserted the signature was persisted), invisible to
type-checking (the discarded return value was legal), and invisible to the UI
(which rendered its claim from static copy rather than from row state). It
survived four months because nothing in the system was positioned to notice it.

## What was done

**P1 (`1171c2e`) — stop the bleeding, and make the state legible.**

Migration 0016 added the five signature columns. The write path now signs,
timestamps, and persists, and a three-way split replaced the previous silent
discard:

- **No signing key** → the review is stored, labeled unsigned, with
  `unsigned_reason = 'no_signing_key'`. This is ADR-0020 §B's intended unsigned
  tier: this repo's own CI is keyless, and so is every first-run self-hoster.
  Nothing is misrepresented, because the row records why it is unsigned and the
  record page says so.
- **Key present, signing fails** → the submission is refused (HTTP 500,
  `attestation_signing_failed`) and nothing is persisted. Storing it anyway
  would produce a row indistinguishable from the keyless tier, recording a
  misconfiguration as though it were a choice.
- **Timestamp authority unavailable** → stored, signed, not timestamped. Never a
  refusal; a third party's uptime does not decide whether a reviewer can submit.

`unsigned_reason` is a closed vocabulary rather than free text, mirrored into a
`Record<>` keyed by that vocabulary, so a value with no reader-facing copy is a
compile error rather than a row that renders as nothing.

The four overclaiming surfaces were corrected in the same change: the home-page
copy was scoped, the dialog copy now says each review "shows its own signing
status once submitted", and the module comments were corrected.

**P2 — sign the rows that were already there, honestly.**

A backfill (`scripts/backfill-attestation-signatures.ts`) signs the reviews
recorded during the affected window. Three properties are worth stating
publicly, because each one is a place where a backfill could have quietly made
things worse:

- **`signed_at` records when the signature was actually produced — never the
  review's own timestamp.** Backdating would assert a moment that did not
  happen. The record detail page shows the signing date alongside the review
  date wherever the two differ, so a reader can see that the signature came
  later. That visible gap is what makes this a correction rather than a silent
  rewrite.
- **A keyless backfill run refuses outright and touches no row.** Labeling every
  historical review `no_signing_key` would take the operator's current
  environment and assert it retroactively across rows written under a
  configuration the run cannot observe — replacing "unknown" with a specific and
  possibly false claim, irreversibly.
- **A row the pass reaches and cannot sign is labeled
  `backfill_signing_failed`, never left blank.** A blank would be
  indistinguishable from a row the pass never reached, destroying the only
  record that an attempt was made.

<!-- ============================================================ -->
<!-- PLACEHOLDER — BACKFILL COUNTS NOT YET AVAILABLE.             -->
<!-- The backfill is owner-run in a manual terminal (it needs the -->
<!-- signing key) and HAS NOT BEEN RUN as of this draft. Paste    -->
<!-- the report block from the apply run below, replacing this    -->
<!-- block entirely. DO NOT PUBLISH THIS ENTRY WITH INVENTED      -->
<!-- NUMBERS — publishing an unverified count in a disclosure     -->
<!-- about an unverified claim is the same failure twice.         -->
<!-- ============================================================ -->

**Backfill results:** _pending — to be filled in from the apply run's report
block (rows seen / signed / already-signed-skipped / failed-with-reason)._

## Commitment

This project's published security-triage commitment, quoted from
`docs/sustainability.md`:

> Security triage SLOs: five business days to acknowledge, thirty days to fix or
> publicly advise on a critical issue.

Clock started **2026-08-22**. Thirty-day mark: **2026-09-21**.

The code fix landed the day the clock started. This entry is the public advisory
half of that commitment; it is complete once the backfill counts above are
filled in from the apply run.
