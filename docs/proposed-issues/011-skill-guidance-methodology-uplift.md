# Skill-guidance methodology uplift

**Status:** Promoted to [civic-ai-tools#78](https://github.com/npstorey/civic-ai-tools/issues/78) on 2026-05-21. This file is the durable planning artifact; execution work lives on the GitHub issue.

**Repo:** civic-ai-tools (skill guidance source of truth); coordination with socrata-mcp-server (embedded copies in `src/skills/`)
**Labels:** future-work, skill-guidance, documentation
**Estimated effort:** M (Tier 1 = small editorial passes; Tier 2 = new short docs; Tier 3 deferred)
**Blocks:** nothing hard
**Tracks:** skill-guidance output quality; feeds back into CCV (Q5) by surfacing real claim-discipline failure modes

## Problem

The project's skill guidance (`civic-ai-tools/docs/skills/{base,web,local,boston,data-commons}.md`) is strong at the **tool-mechanics middle** — anti-hallucination protocol, SoQL gotchas, retry discipline, query-complexity tiers, multi-portal coverage, cross-source decision logic. It is **silent at the bookends**: there is no pre-query problem-framing guidance, no claim-strength discipline, no audience-routing for outputs, no equity discipline, no checklists, and no worked end-to-end example.

The 2026-05 comparison study (`civic-ai-tools/docs/research/civic-analytics-skill-comparison.md`) examined an external Claude Skill set (`sgarcese/Civic-Analytics-Agent-Workflow-Claude-Skill`, MIT-licensed) that solves the inverse problem — a methodology orchestrator with weaker tool-mechanics — and identified ten concrete patterns the project's guidance could absorb without sacrificing its existing strengths.

The cost of not acting: casual users at civicaitools.org get jumped straight into a SoQL query when the question itself is underdefined; outputs come out in a single tone/format regardless of whether the user is a journalist or a community organizer; findings lack the claim-strength discipline that would make a signed evidence package meaningfully more interpretable; and the model has no pre-deliver checklist to self-audit against.

## Proposed approach

Scope the work into three tiers. Tier 1 lands first; Tier 2 follows once Tier 1 ships; Tier 3 defers per the Xanadu doctrine until an adopter materializes.

### Tier 1 — In-place edits to existing skill files (low risk, immediate value)

Editorial passes on `civic-ai-tools/docs/skills/base.md` and `civic-ai-tools/docs/skills/data-commons.md`. Must propagate to embedded copies in `socrata-mcp-server/src/skills/{base,data-commons}.ts`.

1. **Claim-strength labels.** Add a 5-level taxonomy table (Strong causal / Suggestive causal / Correlational / Descriptive / Hypothetical) with language conventions, into both `base.md` and `data-commons.md`. Wire it into the existing "Uncertainty & Limitations Disclosure" sections. ~30 lines each.
2. **Anti-pattern tables.** Convert existing prose warnings ("never invent data points," "use per-capita rates," etc.) in `base.md` into anti-pattern + fix tables. Half-day editorial pass; net line count roughly flat.
3. **Pre-flight + pre-deliver checklists.** Add two short discrete checklists to `base.md` (or new `checklists.md` if it grows large): pre-query (do I have the dataset, schema, time period, denominator?) and pre-deliver (am I citing? labeling claims? noting limitations? equity discussed?). ~50 lines.
4. **Equity discipline section.** Asset/deficit framing table + reporting-bias prompt + ecological-fallacy caveat when using neighborhood as a demographic proxy. New section in `base.md`. ~50-75 lines.
5. **Decision router.** 10-line decision tree at top of `base.md` or `README.md` mapping user-request patterns to which file/overlay to load.

### Tier 2 — Small new docs (after Tier 1 ships)

6. **Audience → format → tone block** in `base.md` (or new `templates.md`) plus 2-3 output templates (executive summary, journalist-facing summary, community fact sheet). Multi-day work. The community fact sheet template in particular translates directly to the civicaitools.org demo audience.
7. **One end-to-end worked example** in `civic-ai-tools/docs/skills/examples/` (or `civic-ai-tools/docs/research/`). Domain other than 311 (housing, transit, public health — not 311, to avoid being derivative). Show the full chain: problem framing → query → cross-source synthesis → audience-tailored output → **evidence-package publication via the publish-evidence skill**. The evidence-publication terminator is the differentiator no other civic-AI skill set has.

### Tier 3 — Deferred per Xanadu (only on adopter trigger)

8. **Methodology layer** (`methodology.md`) as a separately-loadable skill, layered on top of the existing tool-mechanics docs. Could become its own file or a new overlay shape. Defer until a session demonstrates a real need.
9. **Performance management module** (`performance.md`) — cross-source pattern connecting budget + payroll + operational outcomes to compute cost-per-outcome, workload-per-FTE, overtime stress signals. Stack already supports this (NYC, Chicago, SF have payroll datasets); just needs the guidance. Defer until a session asks for it.

## Spec changes the work produces

- `civic-ai-tools/docs/skills/base.md` — claim-strength taxonomy, anti-pattern tables, checklists, equity discipline section, decision router; possibly audience → format → tone block.
- `civic-ai-tools/docs/skills/data-commons.md` — claim-strength taxonomy section.
- `socrata-mcp-server/src/skills/base.ts` and `data-commons.ts` (embedded copies) — must stay in sync; rebuild and redeploy.
- Possible new file: `civic-ai-tools/docs/skills/checklists.md` (if checklists section grows past inline-in-base size).
- Possible new file: `civic-ai-tools/docs/skills/templates.md` (Tier 2).
- Possible new dir: `civic-ai-tools/docs/skills/examples/` (Tier 2).
- `civic-ai-tools-website/src/lib/mcp/socrata-skill.ts` (hardcoded fallback) — review whether it needs updating; the website fetches from the MCP prompt endpoint primarily, the fallback is only used when the endpoint is unreachable.

## Relationship to other work

- **Civic Claim Vocabulary spec (Q5, Q10, Q11).** Adopting J-PAL-style claim-strength labels in skill guidance is the **runtime-discipline complement** to CCV's typed-claim approach in the spec. Running the runtime discipline first gives the spec real evidence of which claim shapes actually surface in published packages — and may surface real failure modes that justify CCV promotion under the Xanadu doctrine.
- **Open Evidence Standard.** Signed packages that include claim-strength-labeled findings are more useful artifacts than ones without. Doesn't change the OES spec; does increase the value of every published package.
- **Skill routing architectural shapes** (`civic-ai-tools/docs/research/skill-routing-architectural-shapes.md`). If a methodology layer becomes its own loadable skill (Tier 3), that's an additional source in the routing problem.
- **Roadmap item: eval suite.** sgarcese has a 29-prompt eval suite with weighted scoring; the project has `guidance-quality` issues. Closing that gap is separate work but is informed by which claim-discipline failures actually show up after Tier 1 ships.
- **Trust and evidence model** (`civic-ai-tools/docs/trust-and-evidence.md`). Claim-strength labels are part of the "what does a signed package actually claim" picture; the runtime discipline strengthens the trust-signaling story without changing the cryptographic substrate.

## Scope

**In:**
- Tier 1 edits to base.md and data-commons.md (5 editorial passes) plus sync to embedded copies.
- Tier 2 deliverables: audience-routing block + 2-3 templates; one end-to-end worked example.
- Decision on whether to extract checklists/templates into separate files vs. inline-in-base.

**Out:**
- Methodology layer as separate loadable skill (Tier 3 — deferred).
- Performance management module (Tier 3 — deferred).
- Methodology-lineage authenticity work (whether to cite Bloomberg/J-PAL/GovLab/Results-for-America by name, or adopt patterns generically). Separate decision; see Risk section.
- Automated eval suite (separate workstream, informed by but not part of this).
- Boston-centric structure adopted wholesale (per Risk: do not transplant Boston-as-primary scaffolding into multi-portal docs).

## Acceptance criteria

- **Tier 1**: Each of the five editorial passes lands in `civic-ai-tools/docs/skills/base.md` (and `data-commons.md` for claim-strength). Embedded copies in `socrata-mcp-server/src/skills/` updated and rebuilt. Skill guidance still passes through the MCP server's `prompts/get` endpoint without regression. `base.md` does not exceed ~25KB; if it does, content split into a peer skill.
- **Tier 2**: At least one output template lands and at least one end-to-end worked example lands (in `examples/` or `research/`). The worked example terminates in an evidence-package publication call (not just a markdown output).
- **Roadmap**: Workspace `ROADMAP.md` and the public `civic-ai-tools/ROADMAP.md` updated to reflect the work as complete (or in-flight if partial).
- **CLAUDE.md sync**: If any new skill files land, the workspace `CLAUDE.md` "Key files across repos" table is updated to point at them.

## Dependencies

- **No hard dependencies.** Each tier is independently shippable; tiers are ordered for confidence, not blocked on each other.
- **Soft coordination with CCV spec work.** Claim-strength labels in skill guidance and typed claims in CCV are best refined in conversation, not in lock-step.
- **Soft coordination with eval-suite roadmap item.** Tier 1's claim-discipline edits should surface failure modes worth measuring; the measurement infrastructure is separate work.

## Risk

- **Doc bloat.** sgarcese's repo is ~145KB across 12 files; this project's is ~32KB across 6 files. **Mitigation:** every Tier 1 edit has a line-count target (~30 lines for claim strength; ~50-75 for equity discipline; etc.). If `base.md` crosses ~25KB, split into a peer skill. Do not bulk-copy sgarcese's structure.
- **Methodology-lineage authenticity.** sgarcese cites Bloomberg, J-PAL, GovLab, Results for America by name with strong fidelity claims. Adopting the *patterns* (claim-strength labels, phase separation, equity discipline) without studying the sources, while claiming the named lineage, would be appropriative. **Mitigation:** default to adopting the patterns generically and citing specific source materials actually drawn from. If naming a tradition is worth the brand benefit, do the source-engagement work first. Either choice is fine; the wrong move is to copy citations without either.
- **Boston-centric transplant.** sgarcese's framework assumes Boston as primary city. **Mitigation:** when adopting the Frame phase, write portal-agnostically. When adopting Benchmark patterns (if Tier 2 includes a cross-portal template), generalize to "any-N-portal comparison."
- **Embedded-copy drift.** Skill guidance lives in two places: `civic-ai-tools/docs/skills/*.md` (source of truth) and `socrata-mcp-server/src/skills/*.ts` (embedded). **Mitigation:** the workspace CLAUDE.md already documents this sync requirement; the Tier 1 commits explicitly include the embedded-copy updates as paired changes.
- **Speculative spec growth.** Per Xanadu doctrine, don't promote new surfaces without an adopter. **Mitigation:** Tier 3 items are explicitly out of scope here; they re-enter via the open-questions registry only when triggered.

## Reproducible at

- **Research artifact:** `civic-ai-tools/docs/research/civic-analytics-skill-comparison.md` (in-depth comparison study, full opportunity list with ordered priorities).
- **External skill set:** `https://github.com/sgarcese/Civic-Analytics-Agent-Workflow-Claude-Skill` (MIT, created 2026-03-24, last pushed 2026-04-02, ~145KB across 12 files).
- **External skill methodology page:** `https://sgarcese.github.io/Civic-Analytics-Agent-Workflow-Claude-Skill/#methodology`.
- **Current skill guidance state:** `civic-ai-tools/docs/skills/{base,web,local,boston,data-commons,README}.md`.
- **Embedded copies:** `socrata-mcp-server/src/skills/{base,web,local}.ts`.
- **Companion architecture docs:** `civic-ai-tools/docs/architecture/working-method.md` (surface-placement discipline), `civic-ai-tools/docs/architecture/xanadu-doctrine.md` (spec-growth gate), `civic-ai-tools/docs/architecture/civic-claim-vocabulary-draft-spec.md` (CCV pre-v0.1, the typed-claims layer this work feeds into).
