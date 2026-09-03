# Retrospectives

> **Log resumed 2026-08-19.** Entries ran to 2026-03-05 (the Sprint 004 retro; the 2026-03-07 commit only moved this file into `docs/`, without changing content), then the practice lapsed for five months rather than moving elsewhere — the one per-sprint retro under [`../sprints/completed/`](../sprints/completed/) predates that last entry. The #220 retro below resumes it. Whether the practice continues is not asserted here.

Reverse-chronological session retros for the civic-ai-tools-website project.

---

## 2026-09-03 — Wave N9 (#384): the record's consumers — and the fixture that could not fail (twelve gated phases, three lanes)

**Scope:** N8's cold read found that making two tools callable handed four consumers of the signed record arguments they were never written to read, and its lesson was that a zone drawn from the call graph cannot see the consumers of what the change produces. So this wave's census started from the record — the in-memory tool-call record, the wire, the progress stream, the package, the graph, the trace replay, both notebooks, the record page — and enumerated every reader, then re-measured ten filings against that map and found six defects no filing covered. Eight families, one property: **no consumer of the record invents what the loop did not write** — a tool name, an operation type, a portal, a token count, a reproduced-step count, a failure travel from the loop to every reader or are absent there, stated as absent. Every phase contract stated the property rather than the patch and asked the phase to report what the property found that the patch would have left; every phase found something.

**Phases:** website P1 `500e954` (#374) · P2 `d81eb76` (#376 #377) · P3 `c342fe0` (#378's app side, the failure into the package) · P4 `1a428c5` (#371) · P6 `33032fe` (the harness pin) · P5 `4ec45c0` (#366 #380 #381 #385, #186's mirror) · P7 cold read · P8 `775852f` (the cold read's six findings). Hub P-H1 `ef93331` (the harness; #378 upstream) · P-H2 `8efcfeb` (#186's source; the server embed `c207f55` first) · the 0.3.1 release `fd9afae`. Typedstandards P-T1 `887f125` (produce-core's `queries[]` entry carries a failure) · the 0.4.0 release `fbaa8f1`. Thirteen merges, every second parent the SHA its GO named; twenty-four rollback tags; two publishes verified against the registry. Tests **1212 → 1352**, `# fail 0` at every merged head. Close record: #384, comment 5531428680.

### Every red on a runner before its phase was issued

Ten draft pull requests, each carrying a phase's instrument alone, each red on the required check by run id, each closed unmerged before the phase branch was cut — plus one structural red: the hub's skill-drift check on the source PR, expected red until the server carried the embed, exactly as the hub's own rule says. The instrument came first every time, and twice the phase found its own guard green for the wrong reason before accepting it — one graded an unrelated, already-correct query in a neighbouring file; one's regex could never fire across a wrapped comment. That is the rule from the July audit, *a criterion that cannot fail is not a criterion*, applied by a phase to itself.

### The census was corrected before, during and after

At G1, before any phase: #186 was a **three-surface** change — the hub's required check byte-compares its skill text against the server's embed, so the server PR lands first and the hub PR is red until it does — in a repository the session could not write; ruling D4's premise was wrong in both its branches — `queries[]` is produce-core's shape and its envelope builder drops any key the app adds, so the failure needed a third lane and a publish; C3 was narrower than filed — the signed trace already carried the failure, only the envelope's list did not; F2 had a third asserting default in the harness's `buildDataSources`, and the anchor's app-side item was a pass-through. In flight: the skeleton notebook generator does not handle a `fetch` honestly, it **drops it** at a step filter; the notebook path drops the failure at three field-picking sites the wire never touched; the record page asserted every notebook "reproduces the analysis". And at the end, the reader was told at least one criterion was mis-stated and named two: criterion 6's RED cited a default that was latent for this producer, and criterion 5's RED named six declarations when the bytes reached the packager and died at its hand-copied type.

### The cold read, sixth in a row — and what it drove

P7 read the 7,309-line diff, then **drove a run** through the real loop — `get_data`, `search`, `fetch` on a record id naming another portal, and a second `get_data` rejected on a timeout — and pushed it through every consumer on the map, reading the records last. Two findings in the wave's own class. **In signed bytes:** the same package said `queries[3].failed: true` and `dataSources[1]` accessed that dataset at a timestamp — the harness's data-sources builder never sees the failure. **On the reader surfaces:** the narrative, the stats and the provenance line, which read `tools_called` and had carried `failed` since P3, narrated the rejected call as "then counted records", "2 queries", a dataset link with rows returned. P8 closed both, and four smaller ones, and found seven presence guards where the reader had listed three.

### The lesson, and the second half

**A criterion demonstrated on a fixture shaped so it cannot fail is not demonstrated.** P6's read-back was the anchor's own instrument for criterion 6: a package built from a run with a rejected call, read back, every assertion green — because the fixture's rejected call hit the same dataset as its successful one and the entries de-duplicated. The contract said "one rejected call" and stopped. The property was right and the instrument was right in kind; the fixture was shaped by the hand that wanted it green. It joins the audit's rule as its converse: a red must be demonstrated, and a green must be demonstrated on the shape that could have been red.

The second half sits one level up from N8's: **a consumer map is a list of files; the property is only checked where a run is driven.** N8 learned that a zone drawn from the call graph cannot see the record's consumers. This wave drew every zone from the consumers, and the three run-level formatters were on the map, and they still narrated a rejected call as done — until a fresh reader drove a failure through everything. The map tells you where to look. Only the drive tells you what is there.

### Three instrument findings that outlive the wave

**A re-run is not a fresh merge-ref run.** `gh run rerun` replays the run's original merge commit; after a base move the checkout is stale even though the check reads live state, and the hub's release PR stayed red on re-run after the source it needed had merged. A close-and-reopen dispatches a fresh `pull_request` run at the current merge ref without moving the head. **A source guard cannot see the shape it did not anticipate:** the regex for `{tokens_used && …}` missed `!!(duration_ms || tokens_used)` beside it. **A green typecheck is not evidence about a test file the tsconfig excludes:** nothing type-checks or lints a produce-core test file, so "compiles at base" was unenforceable there.

### Six ORCH-layer failures, recorded

Two rollback tags cut after their phase had been spawned (both repositories of P-H2); a claim that a re-run would clear a stale merge ref; a claim that a sibling phase had declared a field `string` when it had not; a grep criterion over-broad for an accumulator a prior wave had ruled; the P6 contract that let its fixture take the shape that hid the defect; and two tooling outages — a safety-classifier outage that refused every write for ten minutes, and an agent terminated mid-phase by a network error — neither retried blind: the queue was written down, the first write was duplicate-checked, the agent was resumed from its own `git status`.

### What this wave did not do

It re-emitted, migrated or backfilled no published record. It edited no specification text. It did not teach the harness `failed` — the website carries a positional stand-in until civic-ai-tools#192 — and it did not change what the consistency attestation attests (#402). It ran no P9. Thirteen filings are open at the close, three of them questions rather than defects; civic-ai-tools#185 stays open by ruling. The published read-back of criteria 5 and 6 on a local instance is the owner's leg and is recorded on the anchor when it arrives.

---

## 2026-08-28 — Wave N8 (#363): what the loop leaves around it — and the defect the wave itself made (nine gated phases)

**Scope:** N7 collapsed three model-calling loops into one core and its close record said where consolidation stopped: *"the things around the loop stayed duplicated."* This wave was chartered against those things as **families**, not issues — portal injection (five copies), the MCP timeout (three behaviours), what a signed record asserts, the notebook renderer, and the parallel-implementation leftovers. Two lanes, fourteen acceptance criteria each stating what makes it RED, and every census grep run with **no pathspec** so the scope is the repository rather than a directory.

**Phases:** P1 design (no source) · P2 `7abb357` (#359 #352) · P4a `cecc959` (#339 #307) · P3 `ffaffb7` (#356) · P5 `f117665` (#340 #341 #342 #324) · P4b `103de52` (#312) · P6 `de4bd60` (#323 #348 #354) · P7 cold read · P8 `64ecdf8` (the cold read's two findings). Fourteen `rollback/pre-n8-*` tags. Tests **1092 → 1205**, `# fail 0` at every merged head, **every merge's second parent equal to the SHA its GO named**.

### What the wave was for, measured

At `96c4f76`, `git grep -n -P '(args|toolArgs)\.portal\s*=[^=]'` over all tracked files returned five non-test sites; at `64ecdf8` it returns one, in the core. The MCP timeout had three behaviours across four callers — cleared, uncleared, and absent — and now has one, raced and cleared in a `finally` inside `runToolLoop`. The fourth tool loop is gone, and the registry guard that watches for a fifth derives its universe from `git ls-files` rather than a hardcoded directory list.

### The measurement that reversed two rulings

Two decisions were written as **conditional** rulings — take branch A or B depending on what the data-source server actually does — and both selected the branch the issue did not assume. `get_data` *does* honour a `query` argument, so "stop advertising it" would have deleted a working capability and #340's fix belonged in the notebook helper. The server *does* implement `search` and `fetch`, and this repo's router already routed them, so #323 closed by **adding two schemas** rather than stripping ten lines of prose. Measure the other side before deleting a capability.

### The cold read, fifth in a row to find what the implementing context missed

And for the second consecutive wave, **the wave had introduced the defect**. Making `search` and `fetch` callable handed four consumers arguments they were never written to read. The sharpest: `canonicalizeToolCall` keys a tool call on `name:type:dataset_id:portal`, and neither new tool carries any of those four fields — so every search collapsed to `search:::`, two replay runs that searched for entirely different things scored a Jaccard overlap of **1**, and a **signed** consistency attestation reported them `highly_reproducible` at "Tool overlap: 100%".

The second half is the part worth keeping: two `get_data` calls on the **same dataset with different `WHERE` clauses** collapsed to one key as well. The hand-picked field list had been wrong since before `search` existed. A fix that added the two new tools' fields would have closed the visible half and left the rest — which is why P8's ruling was property-shaped (*any* argument difference produces a different key) and why its second RED mattered more than its first.

### The lesson, one level up from N7's

N6: *a zone scoped by file cannot see a defect scoped to a class.* N7: *the instrument built to fix that was scoped to a directory.* N8: **a blast zone derived from the call graph of the change cannot see a defect in a consumer of the record the change produces.**

Every zone this wave drew was correct by the prescribed method — from the call graph, at the phase base, itemised file by file when it grew (P2 gained `openrouter-streaming.ts`, P5 gained `synthesize.ts`, P3 lost a `package.json` item it never needed). And the attestation dialog was in none of them, because it does not call the changed code — it reads what the changed code *produces*.

### Two instrument findings that outlive the wave

**A `pull_request` run builds the merge commit.** The runner log says `HEAD is now at <sha> Merge <branch> into <main>`, so the merged-head test count is observable **before** merging. The wave's predict-then-verify ritual — state a falsifiable count, merge, then read the runner — was weaker than the instrument sitting in front of it. All six predictions held, but a failing one would have failed *after* the merge rather than before it.

**`git grep -E` silently matches nothing for `\b`.** `git grep -cE '\bsearch\b'` over all tracked files returns 0 files; `-P` returns hundreds. A grep returning zero because its engine does not speak the pattern is indistinguishable from a clean tree — the same species as a check that cannot fail.

### Phases that corrected the contract they were given

**P1 refuted an in-tree claim by execution.** `scripts/eval-models.mjs` said in a comment that a `.mjs` file "cannot import that TypeScript module"; three probes — flagged, bare `node`, and `spawnSync` with no flags — all executed the core, so no `package.json` change was needed and the comment was corrected instead. **P2 found that moving injection above the record needed `!argumentsMalformed`**, or a call whose arguments never parsed would be recorded, spanned and **signed** carrying a portal it never had — an exposure the move itself created. **P4b found #312's own stated fix-shape wrong**: the issue says an `undefined` property is dropped by the canonicalizer, which holds for a plain object and is the opposite for a span, whose attributes are an array of `{key, value}` — an `undefined` there survives as a valueless key, worse than the zero it replaced. **P6 corrected both a number and its epistemics**, finding the merge-ref instrument above rather than writing the arithmetic it was told to write. **P8 declined to type `fetch`'s operation** and recorded the refusal in the file, because the server decides it from the shape of an identifier at call time and a guess would have been written into a signed package.

### Five ORCH-layer premise failures, recorded

The contracts carried five errors, all caught downstream: a sibling-repo path that pointed at the wrong checkout; a relayed citation naming the *catalog* branch of a handler when the *query* branch was meant (a contract written off it would have specified a helper implementing half the ruling); a criterion written in a form the same contract's own ruling had already made unsatisfiable; an instruction to write an unmeasured number into `CLAUDE.md` when the merged head was in fact observable; and two rollback tags cut after their phases had been spawned. N7 recorded three; the premise-check rider points at whoever writes the contract, and both waves it pointed at the orchestrator.

### What this wave did not do

#333, #336, #337. It re-emitted, migrated and backfilled nothing — P8 traced every read-back path to show stored bytes are rendered, never recomputed. Ten filings are left open deliberately, including two the wave created and chose not to fix inside a closing phase: three surviving references to the superseded key format (#380), and this file's own test-count row, which went stale again within one phase and is structurally fragile rather than merely wrong (#381).

---

## 2026-08-28 — Wave N7 (#345): the model-calling loop as a class — one core, three callers (six gated phases)

**Scope:** Not six defects; one defect *shape*. N6's cold read found that three of its phases had each fixed one instance of a defect living in several places, honouring their blast zones exactly while doing so. The largest family was the model-calling loop: three independent implementations, one fixed. This wave was chartered against the family rather than its members — the fix-shape under test was **one loop core, three callers**, not three patches.

**Phases:** P1 design (no source files) · P2 `a9681ab` (the core, #331 #343 #349) · P3 `08858a9` (replay, #338 #347 #331) · P4 `45aa6c0` (`/api/compare`, #344 #349) · P5 cold read · P6 `859abae` (#355 #357, #356's instrument half). Eight `rollback/pre-345-*` tags — P1 and P5 changed no source and needed none. Tests 1044 → 1092, **no test name removed at any step**, compared by name rather than by count at every gate. `main` auto-deploys, so all four merges were production deploys; all four green.

### What the wave was for, measured

At `1ddd61a`, three modules passed `tools` to `chat.completions.create`. At `859abae`, one does. The measurement is now a bidirectional test rather than a grep: `model-call-registry.test.ts` fails both when a call site is unlisted and when a listed entry stops being real, so P3's and P4's deletions were self-enforcing — migrate and leave the entry, red; remove the entry without migrating, red.

### Four things the phases got right that were not asked for

**P1 corrected the design it was given.** The contract assumed replay's 45-second MCP race and portal injection had to live inside the loop. Measured: both were *already* caller-side in the two streaming callers, through the `executeToolCall` closure. The seam existed; the contract had not noticed.

**P2 overrode the design and was right.** The design ruled the pass-through chunker caller-side. At base, the `synthesis` span opened before it and closed after it, so moving the chunker out would have shifted a span's recorded `endTimeUnixNano` **inside a signed trace**, where no test that does not compare traces would ever see it.

**P3 refused a self-contradicting instruction.** The contract said to construct the model client inside the route's `try` "so a throw is classified exactly as today". It is outside the `try` today, so such a throw is *not* classified; following the sentence would have changed behaviour under a rationale of preserving it.

**P6 recorded absence as absence.** Asked to demonstrate a CI red on a pushed branch, it found no run had been dispatched and said so — six polls, `total_count: 0` — rather than inferring a pass from a missing failure.

### The cold read, again worth the phase

Fourth consecutive cold read to find what the implementing context missed, and this time **the wave itself had introduced the defect**. Closing #331 replaced a bounded-but-malformed truncation with a parseable-but-unbounded one: the kept-row count was sized from `rows[0]` alone, so an ordinary Socrata response with a sparse first row fed the model **871,116 characters against a 50,000 bound**. Both shipped assertions checked the bound honestly — against homogeneous fixtures, the one shape where the arithmetic happens to be right. It also found a test that passes with the thing it names deleted, and a **fourth** loop in `scripts/eval-models.mjs` carrying the entire class.

### The lesson, one level up from N6's

N6: *a zone scoped by file cannot see a defect scoped to a class.* N7: **the instrument we built to fix that was scoped to a directory, and could not see the fourth loop.** The census used `git grep -- 'src/**'`; the registry test rooted at `src/` and accepted only `.ts`/`.tsx`. Both inherited the same blind spot, and the guard's own header claimed a reach it did not have. P6 widened the scan and registered the fourth loop rather than migrating it — the debt is now visible in the suite instead of invisible to it.

### What this wave did not do

The fourth loop's migration (#356), the four surviving copies of portal injection, the span/args divergence inside the signed trace (#359), the trace-gated warning that cannot appear on two callers (#354), and the uncleared MCP timers in the two streaming callers (#352). Those are the next wave's census, not this one's tail — named here so the next census does not rediscover them as findings.

### Three ORCH-layer premise failures, recorded

The contracts carried three errors the phases caught: a fix-shape assumption (P1), a self-contradicting instruction (P3), and a CI procedure that could not dispatch a run because `ci.yml` triggers only on `pull_request` and pushes to `main` (P6). The premise-check rider is written to point at the anchor; all three times it pointed at the orchestrator instead, which is the direction that matters when the orchestrator is the one writing the contracts.

---

## 2026-08-27 — Wave N6 (#325): the answer path, and the diagnostics that should have caught it (six gated phases)

**Scope:** Six defects in the code an operator deploys, gathered into one wave so merges into `main` serialized through a single lane. Five found by running the app against a live Socrata portal; one a container-build break that had been on `main` since 2026-08-20. Run as a gated ORCH sprint against anchor #325, with a coordinating planning seat and the owner holding a second key at every merge.

**Phases:** P1 `e053b5c` (#295) · P6 `02ca11a` (#323) · P5 `87297eb` (#320) · P2 `7522d4b` (#322) · P3 `22170da` (#321) · P4 `1ddd61a` (#319). Twelve `rollback/pre-325-*` tags. Tests 1010 → 1044, none moved or removed at any step. `main` auto-deploys, so all six merges were production deploys; all six green.

### What we did

**P1 — the container build, and the gap that hid it (#295).** The image build ran a whole-repo type-check over a context that is deliberately not the whole repo, so a test importing a filtered path failed the image build while every host check stayed green. The anchor offered three fix shapes; the phase measured all three and took a fourth — keep test files out of the build context, so scope and context agree by construction. Its case against the allowlist patch was a measurement nobody had: **two** test files already import into `scripts/`, and the second passes only because the script it reaches for happens to be allow-listed for an unrelated reason. Added an always-run `container image build` CI job, then **showed it failing on a runner** against a reverted tree — a check observed only green is indistinguishable from one that cannot fail.

**P6 — advertised tools (#323).** Removed two uncallable tool names from the cross-source preamble and added a subset guard. See the correction below: **this issue is reopened.**

**P5 — Data Commons cells (#320).** Every notebook containing a Data Commons fetch had been invalid Python since the renderer was written. The fix removed the hard-coded skip list rather than widening it — callers now declare their handled keys. The phase also **caught a specification error**: the contract said to detect duplicate keyword arguments with `ast.parse`, which cannot detect them; only `compile()` does. A test built as specified would have passed green against the broken renderer.

**P2 — `resultSummary` (#322).** The field was never populated for Socrata, so the "returned N rows × M columns" line had never appeared in any notebook. Chose `rows = data.length`, never `total_rows`, on provenance grounds: two functions reduce that field into reader-facing totals, and `total_rows` would claim the model analyzed rows it never received. Measured and disclosed a third site sharing the same premise (#331) rather than silently fixing or silently leaving it.

**P3 — replayed rejected calls (#321).** Rejected calls now render as an honest markdown note instead of an executable cell, and surviving fetch cells are guarded. The phase **tested its own instrument**: the try/except check walks the Python AST rather than matching `"try:"`, and a meta-test feeds it a decoy carrying that string in a comment and a SQL literal. It also declined a belt-and-braces guard on the discovery filter because it would have made the regression test unable to fail.

**P4 — the mid-plan answer (#319).** A turn announcing its next query was published as the answer, under the same signature as a real finding. The answering machinery already existed and was gated on the wrong condition; the phase re-gated it rather than adding a parallel path. Found and fixed a latent malformed-request defect on the token-limit path that its own change would have widened.

### The finding worth more than the six fixes

**Three phases fixed one instance of a defect that lived in a class, and each honoured its blast zone exactly while doing so.** P6 fixed the preamble and left `SOCRATA_SKILL_FALLBACK`; P3 fixed the executed-notebook path and left `notebook.ts:123`; P4 fixed `openrouter-streaming.ts` and left `openrouter.ts:120`, which still carries the literal pre-fix condition, plus `replay`. Five files call the model outside the one that was fixed — six in total.

No phase did anything wrong. The blast zone is the instrument that produced this, three times, from three authors. A zone scoped by file cannot see a defect scoped to a class. Now a rule in `CLAUDE.md`.

### Gate 6 earned its ruling

The cold read was ruled **required** over a recommendation that it be optional. It found the class problem above, a second unfixed notebook path, the survival of #323's harm, and two defects created by correct changes meeting — including a helper-signature `TypeError` reported to the reader as a live-data outage beneath a line asserting a row count.

Every phase passed its own gate. Every gate record reconciled. The wave would have closed clean with seven ticks and been wrong about three of them.

### What the ledger says about where errors came from

Twenty falsified premises. Four the anchor's, five the seat's, **ten the ORCH's**, one a phase's. All three fix-on-top rounds were caused by contract errors, not phase errors; no phase failed a criterion on first pass. Two entries were promoted out of the wave: *a criterion that cannot fail is the same defect as a check that cannot see*, demonstrated three times by three authors; and *a blast zone derived from issue bodies rather than the call graph will be wrong in both directions*.

### Honest close

Criterion 6 is met **literally** while its harm survives — **#323 is reopened** rather than re-filed, because closing it would assert a fix that does not exist. Criterion 3 is met on the executed notebook path **only**. Criterion 3's live half was never exercised: no preview can authenticate (#336) and no local instance could run a query at all (#337).

Filed: #331, #333, #336, #337, #338 (replay route carries #319 twice and feeds a signed attestation), #339, #340, #341, #342, #343. Recommended and not chartered: a sprint scoped to the class, whose first phase is a census of all six model-calling sites.

These six defects are fixed. Nothing here addressed anything beyond them, and this close is not a statement that the instance is ready to deploy.

---

## 2026-08-19 — Sprint #220: Pre-Deployment Hygiene (five gated phases)

**Scope:** Excise the NYC design-system association from the brand layer — token names, CSS class names, styling attribution — plus three riders folded in: a wrong `datePublished` assertion (#256), the raw error string on the SSE wire (#154), and a stale preflight topology assertion. Run as a gated ORCH sprint against anchor #220, with a coordinating planning seat and the owner holding a second key at every merge.

**Phases:** P1 `aa4afc1` (#269) · P2 `c0ccbb1` (#270) · P3 `a9784fb` (#272) · P4 `8f981ab` (#274) · P5 `ad5a52c` (#276). Tagged `sprint-220-complete`. `main` auto-deploys, so all five merges were production deploys; all five green.

### What we did

**P1 — honest absence (#256).** The evidence page asserted a publication date it could not know: `created_at` is row-insert time, which for a sealed-then-published record is the *seal* time. Removed `datePublished` from the JSON-LD, `citation_date` from the Highwire tags (a second machine-readable site the issue never named), and the labelled "Published on" row. New pure-builder seam plus tests, with the negative assertions mutation-checked.

**P2 — the wire carries a kind, not a string (#154).** The raw infra string still travelled in the SSE `error` payload. The charter's fix — send friendly copy instead — was measured and rejected: it would have re-classified that copy at render and silently downgraded four of eight error kinds. Instead the server classifies once at the single chokepoint and puts the *kind* on the wire; prose matching demoted to fallback. Plus the preflight topology assertion, and the environment-example line (owner-run).

**P3 — the token sweep.** 308 `var(--nyc-*)` call sites migrated, via expand→flip: neutral names became the definitions with `--nyc-*` aliased beneath, so a missed reference still resolved.

**P4 — the class layer.** `.nyc-button`/`.nyc-field` → `.ui-*`, via a dual-selector expand→flip→retire so a missed usage still styled during migration.

**P5 — closeout.** Aliases retired (owner ruling), brand prose swept, acceptance recorded.

### What went well

- **Expand→flip made both renames safe rather than lucky.** In P3 a missed token still resolved through the alias; in P4 a missed class still styled through the dual selector. Neither phase depended on the sweep being exhaustive on the first pass.
- **Acceptance was built where the charter's was unassertable.** "Rendered CSS byte-identical" cannot be checked in CI. P3 replaced it with three layers — a permanent dangling-token test, a diff-level mapping check, and an emitted-output comparison against a baseline build (compiled CSS across 279 selectors and 643 declarations identical; 936 bundle-resolved `var()` occurrences in identical buckets).
- **Two permanent guards outlived the sprint** — `design-tokens.test.ts` and `ui-class-names.test.ts`. P5 didn't just assert the first was a safety net for alias retirement; it dropped a real `var(--nyc-blue, #103FEF)` probe in and watched it fail, proving the net catches the fallback form specifically.
- **Two live defects surfaced by measuring rather than sweeping.** `--nyc-gray-50` was referenced and never defined — invisible because the call site carried a fallback. `--nyc-gray-30`/`-40` were dead and were dropped rather than renamed.

### What didn't go well

**Seven premise or measurement errors, five of them in the sprint's own instructions.**

1. The charter's `~1,186` sizing counted inline style objects, not token references.
2. The charter's #154 fix-shape would have silently downgraded four of eight error kinds.
3. An owner-run commit fused two lines in a file agents may not read, because the append command wasn't newline-defensive.
4. The corrected `294` census missed a whole syntactic form — `var(--token, #fallback)`.
5. That correction was itself wrong: it hand-patched the one instance of the form it *had* seen back into a total blind to the other fourteen, which made the number look considered while being wrong twice.
6. The `listen EPERM` failure class, recorded as ubiquitous, turned out to be environment-dependent (#249).
7. The "complete" brand-prose surface was two sites short — including `docs/deploy.md`'s operator table, which would have shipped documenting an alias layer that no longer existed.

None were caught by general suspicion. Each was caught by one specific measurement someone chose to run instead of reasoning.

### Lessons

- **A rename phase's true surface is every statement that would become false, not every occurrence of the string.** The two P5 misses contained no brand string at all — they were sentences asserting the alias layer existed. A grep-shaped survey is structurally incapable of finding those. Rename work needs a *statements pass* distinct from the occurrence sweep. (This entry's own dormancy banner was corrected under that rule.)
- **The grep that finds your example may still not count its class.** The dangling `--nyc-gray-50` was found *in* the fallback form, and the counting grep written afterwards still couldn't see that form.
- **If you can't test a command against the real target, build a replica and test it there.** The fused-line defect came from an untestable append; the repair was verified against a synthetic replica of the exact failure before being handed over.
- **An owner-run commit on an agent branch is the one commit nothing reviews.** No IMPL saw it, CI didn't validate it, and the agent was forbidden to read it. Content-free structural verification of the patch — numstat, newline-marker side, prefix and identity tests — is the compensating control.
- **A test that can't fail is theater.** Negative assertions and guards were mutation-checked throughout, not observed passing.
- **Historical records don't get rewritten.** Completed sprints, this file's older entries, and a dated "deviations" section kept their `--nyc-*` references. Rewriting them to describe work that didn't happen that way would falsify them.
- **Dead and unconsumed are different.** Dead tokens (something replaced them) were dropped, because renaming them launders debt under a cleaner name. An unconsumed selector (nothing replaced it) was kept, because dropping it would have removed the codebase's only invalid-field styling.

### Filed rather than left to evaporate

| Issue | What |
|---|---|
| #271 | Notebook execution stderr is put on the wire and then discarded at render — a disclosure decision, not a bug |
| #273 | ~12 stale `var(--token, #hex)` fallback literals, including the `#777` that sprint-003 removed for a WCAG AA failure |
| #275 | Invalid-field styling exists with no consumer, and `aria-invalid` appears nowhere — a trap for whoever first adds a required field |
| #249 | Premise corrected: its stated symptom didn't reproduce across three clean runs; rider declined on that measurement, fix shape pre-scoped |

### Files changed

Across five phases: `src/app/globals.css` (token layer rebuilt, aliases retired, prose swept), 43 component and page files (token references), 12 files (class names), `src/lib/openrouter-streaming.ts` + `src/lib/streaming.ts` (the error chokepoint), `src/app/(app)/evidence/[slug]/page.tsx` + new `src/lib/evidence/page-metadata.ts` (honest absence), `scripts/preflight-env.test.mjs`, `docs/deploy.md`, `CLAUDE.md`, and two new guard tests under `src/app/`.

**Re-theming an instance, which is what this and #217 were for:** one variable, `SITE_BRAND_ACCENT`. Companions are derived from it and written as a single inline style on `<html>`. No file is edited and there's no second place to keep in sync.

---

## 2026-03-05 — Sprint 004: Migrate BPMN to /explore, Restructure About

**Scope:** Page reorganization — moved BPMN visualization from `/about` to a new `/explore` route, restructured About as educational prose, added Explore to header nav. Plus one ad hoc UX fix (Enter to submit).

### What we did

**1. Created `/explore` route** — New `src/app/explore/page.tsx` with the BPMN diagram as primary content. Brief intro text + the existing `McpFlowDiagramWrapper`.

**2. Renamed `components/about/` → `components/explore/`** — `git mv` preserved history. All internal relative imports (e.g., `./BpmnViewer`, `./TraceControls`) continued working with no changes.

**3. Restructured About page** — Removed `McpFlowDiagramWrapper` import. Replaced BPMN section with prose explaining MCP + a "Watch it in action" CTA button linking to `/explore`. All other educational sections preserved.

**4. Added Explore to header** — Desktop nav and mobile hamburger menu both show About | Explore | GitHub.

**5. Updated CLAUDE.md** — Architecture diagram, directory structure, prop threading paths, component references, sprint index all updated. Removed the "About page post-migration plan" section (migration complete).

**6. Enter to submit (ad hoc)** — Added `onKeyDown` handler to home page `<textarea>` so Enter submits, Shift+Enter inserts newline.

### What went well

- **Zero iteration** — Rename via `git mv`, create new page, edit About, update Header — all straightforward. Build passed on first attempt after `npm install`.
- **Relative imports survived the rename** — Since all BPMN components moved together, none of the internal imports needed updating. Only the one external import in `about/page.tsx` needed removal.
- **Cross-reference audit was quick** — `SkillPromptDisclosure` links to `/about#system-prompt` and `NarrationExplainer` links to `/about#narration` — both sections stayed on About, so no changes needed.

### What to watch

- **No runtime testing by Claude** — User tested manually and confirmed it looks good.
- **bpmn-js wasn't installed locally** — `npm install` was needed despite `bpmn-js` being in `package.json`. Build failed without it.

### Files changed

| File | Action |
|------|--------|
| `src/app/explore/page.tsx` | **New** — Explore page with BPMN diagram |
| `src/components/about/*` → `src/components/explore/*` | **Renamed** — 7 files moved |
| `src/app/about/page.tsx` | Removed BPMN import, replaced with prose + CTA |
| `src/components/Header.tsx` | Added Explore link (desktop + mobile) |
| `src/components/QueryForm.tsx` | Enter to submit, Shift+Enter for newline |
| `CLAUDE.md` | Updated architecture, directory structure, references |
| `sprints/completed/sprint-004-explore-page-migration.md` | Marked done, moved to completed/ |

---

## 2026-02-27 — Sprint 003 Bulk Polish: 18 Fixes Across Layout, A11y, Hover States, Copy

**Scope:** 18 additional fixes from the polish audit across 13 files. Focused on accessibility, interactive feedback, mobile navigation, and design system consistency.

### What we did

Implemented the remaining "Fix Soon" items and several "Minor" items from `sprint-003-polish-audit.md`, bringing the sprint from 10/44 to 28/44 fixed.

**Accessibility (4 fixes):** `:focus` → `:focus-visible` on all selectors, global `button:focus-visible` rule, `--text-muted` darkened from #777 to #757575 for WCAG AA, BPMN container `role="img"` + `aria-label`.

**Interactive feedback (4 fixes):** Hover states for TraceControls buttons (mode tabs, trace pills, speed, reset/cancel/new query via styled-jsx classes), breadcrumb chip hover, query suggestion card hover, design system focus style on live query input.

**Layout (3 fixes):** `overflow-x: clip` on body, responsive BPMN height `min(650px, 70dvh)`, mobile hamburger menu for screens < 640px.

**Visual consistency (2 fixes):** Fullscreen exit button border-radius 8px → 4px, About page h3 sizes standardized to 18px.

**Copy & content (5 fixes):** Generic training cutoff (removed stale date), commit-SHA GitHub links, "Running query" ellipsis removed, CTA shorthand clarified, footer period, excerpt claim softened, BPMN Tailwind colors → design system tokens, GitHub header link → website repo.

**Example replay header:** Removed unreliable step/iteration counters from the side panel header. Now shows the current event message during playback, and timing + tool call count when complete.

### What went well

- **Batch efficiency** — 18 fixes in one pass with zero build failures. Grouping by file minimized context switches.
- **CSS-class approach for hover states** — Adding classes like `mode-tab`, `trace-pill`, `secondary-btn` and defining hover rules in styled-jsx was cleaner than inline `onMouseEnter`/`onMouseLeave` handlers.
- **Global `button:focus-visible`** — One rule fixed focus styling across every custom button in the app.

### What didn't go well

- **Exit fullscreen button layout** — Moved from absolute positioning to a flex row to fix theoretical overlap, but this wasted ~52px of vertical space in fullscreen mode. Reverted to absolute after seeing the spacing issue in practice. Lesson: test layout changes visually before committing to a different approach.
- **Step counter was unreliable** — "Step 9 of 9" counted raw trace events, not user-visible steps. Attempted to fix by filtering to visible phases, but the mapping was still fragile. Removed entirely — simpler is better when the data model doesn't cleanly support the UX.

### Lessons

- **Absolute positioning is fine when overlap is theoretical.** Don't "fix" something that works by introducing a worse problem.
- **Remove unreliable UI rather than patching it.** A step counter that doesn't match what users see is worse than no counter.
- **Design system tokens prevent color drift.** Replacing Tailwind hex values (`#22c55e`, `#f59e0b`) with CSS variables (`--nyc-success`, `--nyc-caution`) means future palette changes propagate automatically.

### Files changed

| File | Changes |
|------|---------|
| `src/app/globals.css` | `overflow-x: clip`, `--text-muted` WCAG fix, `:focus-visible`, `button:focus-visible`, breadcrumb hover, query card hover, BPMN pulse colors |
| `src/components/Header.tsx` | Mobile hamburger menu, GitHub link → website repo |
| `src/components/about/McpFlowDiagram.tsx` | Responsive height, exit button border-radius, step counter removal |
| `src/components/about/TraceControls.tsx` | Focus style on live input, hover classes on tabs/pills/buttons |
| `src/components/about/LiveResponsePanel.tsx` | Simplified header: removed step/iteration, shows message or timing |
| `src/components/about/BpmnViewer.tsx` | `role="img"` + `aria-label`, lane colors → design system |
| `src/components/about/bpmn-diagram.css` | Active/loop/success colors → CSS variables |
| `src/components/ResponsePanel.tsx` | Generic training cutoff text |
| `src/components/ProgressLog.tsx` | (breadcrumb hover via globals.css) |
| `src/app/about/page.tsx` | h3 consistency, query card class, commit-SHA links, copy fix |
| `src/app/layout.tsx` | Footer trailing period |
| `src/app/page.tsx` | CTA shorthand → "civic-ai-tools" |
| `src/hooks/useStreamingComparison.ts` | Remove trailing ellipsis from group label |

---

## 2026-02-27 — Quick Polish: Broken Colors, Accessibility, Copy, Input Overflow

**Scope:** 10 fixes across 7 files, zero new files. All single-line or few-line changes addressing broken CSS variables, WCAG contrast failures, copy inconsistencies, and a UX bug.

### What we did

Implemented the top 10 issues from the polish audit (`sprints/completed/sprint-003-polish-audit.md`):

1. **`--nyc-blue` CSS variable** — Added alias for `#103FEF`, fixing 14 broken `var(--nyc-blue)` references across 6 files
2. **Markdown table overflow** — Added `display: block` + `overflow-x: auto` to `.response-markdown table`
3. **Green success contrast** — Darkened `--nyc-success` from `#00B703` to `#008A02` (~4.6:1 on white, WCAG AA pass)
4. **TimingBar capitalization** — `'Data Retrieval'` → `'Data retrieval'` to match sentence case
5. **Connection error message** — Appended "Please try again." to match home page pattern
6. **Expand "LLM" and "MCP"** — Hero text: "Compare AI responses" + "Model Context Protocol (MCP)"; meta descriptions updated
7. **Panel titles** — `"Without MCP"` / `"With MCP"` → `"Without Data Tools"` / `"With Data Tools"`
8. **Button font-family** — Global `button { font-family: inherit; }` reset for unstyled buttons
9. **Error red mismatch** — Replaced Bootstrap `#dc3545` with `var(--nyc-error)` in TraceControls
10. **Query input auto-expand** — Textarea auto-resizes via `useRef` + `autoResize` callback, capped at 120px

### What went well

- **All 10 fixes were independent** — No ordering constraints, no cascading side effects. Applied in one pass with no iteration.
- **Build passed first try** — No type errors, no lint regressions. The changes were minimal enough that risk was near zero.
- **CSS variable alias was the right call** — Adding `--nyc-blue` as an alias fixed 14 references without touching any component files, versus a find-and-replace that would have touched 6 files.
- **Design system consistency** — Fixes 3 and 9 bring error/success colors fully in line with the NYC Design System variables instead of ad-hoc hex values.

### What to watch

- **No runtime testing** — All verification was build-only. The textarea auto-resize, table overflow scroll, and button font rendering should be manually tested.
- **`--nyc-success` darkening is global** — 26 usages affected. Most are decorative (borders, backgrounds) where the slightly darker green is imperceptible, but worth a visual pass.

### Lessons

- **Polish audits produce high-ROI work** — 10 fixes, 7 files, minimal risk, measurable UX improvement. Good pattern for future sprints.
- **CSS variable aliases prevent drift** — When component code naturally reaches for `--nyc-blue`, having both `--nyc-blue` and `--nyc-blue-40` point to the same value avoids broken references without enforcing a naming convention.

### Files changed

| File | Changes |
|------|---------|
| `src/app/globals.css` | Add `--nyc-blue` alias, darken `--nyc-success`, table overflow, button font reset |
| `src/components/shared/McpResponseDisplay.tsx` | TimingBar label sentence case |
| `src/hooks/useLiveTrace.ts` | Error message copy |
| `src/app/page.tsx` | Hero copy: "AI responses" + "Model Context Protocol (MCP)" |
| `src/app/layout.tsx` | Meta descriptions: "AI" not "LLM" |
| `src/components/ComparisonDisplay.tsx` | Panel titles: "Without/With Data Tools" |
| `src/components/about/TraceControls.tsx` | Error state uses design system red |
| `src/components/QueryForm.tsx` | Textarea auto-expand with ref + autoResize |

---

## 2026-02-27 — Unify Example Trace Replays with Side-by-Side Layout

**Scope:** 5 files changed (1 new, 3 modified, 1 deleted), replacing NarrativePanel with the same side-panel step cards used by live queries.

### What we did

Example trace replays now use the same 55fr/45fr side-by-side layout as live queries. Clicking Play opens the split view with the BPMN diagram on the left and an incrementally-building step card panel on the right — identical to what live queries show. The old `NarrativePanel` (full-width educational text per phase) is deleted.

**Key pieces:**
- **`trace-progress.ts`** — Pure utility that derives `ProgressGroup[]`, `ProgressLogEntry[]`, and `ToolCall[]` from a slice of `TraceEvent[]`. Mirrors the grouping logic from `useLiveTrace.handleProgressEvent` but runs as a stateless function via `useMemo`, avoiding any changes to `useTraceReplay`.
- **`LiveResponsePanel`** gained two optional props: `exampleStatus` (step counter instead of elapsed time) and `completionCta` (footer action slot). Both modes now use the same component.
- **`McpFlowDiagram`** — `showSplit` expanded to activate during example playback. `exampleProgressData` derived via `useMemo`. "Try this query yourself" CTA switches to live mode with the example query pre-filled.
- **`TraceControls`** — Removed playing/complete status line (now in the side panel). Pre-play info (title + tool count + duration) remains.

### What went well

- **Plan-first paid off** — The plan was detailed enough that implementation was mechanical. No backtracking, no surprises. Build passed on first attempt.
- **Derived state via useMemo was the right call** — The largest trace has ~30 events, so recomputing on each index change is instant. This avoided modifying `useTraceReplay` or adding new state management.
- **Reusing `LiveResponsePanel`** — Adding two optional props was far cleaner than creating a new component. The shared `McpResponseDisplay` underneath means both modes get identical rendering (breadcrumbs, markdown, provenance, footer) for free.
- **Clean deletion** — `NarrativePanel` was fully replaced with zero fallback needed. No other code imported it.

### What to watch

- **No runtime testing** — Verified via build + lint only. The split transition animation, step card progressive reveal, pause/resume fidelity, and "Try this query yourself" flow all need manual testing.
- **`onModeChangeTo` duplicates `handleModeChange`** — The new helper is nearly identical to `handleModeChange` but adds `setSuggestedQuery`. Could be consolidated, but kept separate for clarity since the CTA path has different intent.

### Lessons

- **Derived state > duplicated state** — Rather than making `useTraceReplay` track progress groups (adding complexity to an already-tested hook), deriving them from the event index via a pure function was simpler and risk-free.
- **Optional props for mode variants** — Adding `exampleStatus?` and `completionCta?` to an existing component is cleaner than branching into separate components. The panel stays unified while each mode customizes its header and footer.

### Files changed

| File | Action |
|------|--------|
| `src/lib/bpmn/trace-progress.ts` | **New** — Pure function to convert TraceEvent[] → progress data |
| `src/components/about/LiveResponsePanel.tsx` | Add `exampleStatus` and `completionCta` optional props |
| `src/components/about/McpFlowDiagram.tsx` | Expand `showSplit`, add `useMemo` for derived data, render side panel for both modes, remove NarrativePanel |
| `src/components/about/TraceControls.tsx` | Remove playing/complete status line, clean up unused vars |
| `src/components/about/NarrativePanel.tsx` | **Deleted** — replaced by side panel |

---

## 2026-02-27 — Unify MCP Display, Controls Polish, Trace Labels

**Scope:** 3 tasks across 10 files (1 new), net -187 lines.

### What we did

**1. Unified MCP response display** — Created `McpResponseDisplay.tsx` as a shared component, then refactored both `ResponsePanel` (home page) and `LiveResponsePanel` (About page) to use it. This eliminated the duplicated `buildProvenanceLine` function and ~200 lines of copy-pasted rendering logic. Threaded `queryText` through the component tree so both pages show the user's query as a styled quote above the response.

**2. Clickable dataset IDs** — Added `datasetUrl()` and `buildProvenanceLine()` to `streaming.ts` with markdown links. Updated `buildNarrativeSummary()` the same way. Added `linkDatasetIds()` in the shared component to auto-link bare dataset IDs in markdown content. Updated `ProgressLog` to render narrative via ReactMarkdown. All dataset links open Socrata pages in new tabs.

**3. Controls polish** — Moved close-fullscreen from the zoom control cluster to a prominent dark pill button at the overlay top-right. Grouped speed controls (1x/2x/4x) next to the Replay button instead of pushed to the far right, hidden during live queries. Replaced technical trace pill labels ("Simple query", "Multi-step") with query descriptions ("311 complaints in NYC", "Restaurant grades by borough") and added a complexity indicator ("2 tool calls · ~8s").

### What went well

- **Plan was solid** — the MCP unification plan was detailed enough to implement without backtracking. One build error (duplicate `firstPortal` variable) caught and fixed immediately.
- **Net negative lines** — consolidated from 2 implementations down to 1 shared component, removing more code than we added.
- **About page got free upgrades** — TimingBar, Time/Tokens footer, SkillPromptDisclosure, and query text quote all came for free by adopting the shared component.

### What to watch

- **Padding delta on About page** — content padding changed from 16px to 24px inside the live response panel. Should look fine but worth a visual check.
- **Pre-existing lint errors** — 3 lint issues exist on main (TraceControls setState-in-effect, two unused vars). None introduced by us, but the TraceControls one is in a file we touched — could be cleaned up in a follow-up.
- **No runtime testing** — all verification was build+lint. The streaming behavior, auto-scroll, cursor blinking, and dataset link clicking should be manually tested on both pages.

### Files changed

| File | Action |
|------|--------|
| `src/lib/streaming.ts` | Add `datasetUrl()`, `buildProvenanceLine()`; update `buildNarrativeSummary()` with markdown links |
| `src/components/shared/McpResponseDisplay.tsx` | **New** — shared MCP response component (TimingBar, linkDatasetIds, provenance, footer) |
| `src/components/ResponsePanel.tsx` | Remove duplicated code; MCP variant delegates to shared component; add `queryText` prop |
| `src/components/about/LiveResponsePanel.tsx` | Remove duplicated code; delegate to shared component; add `queryText` prop |
| `src/components/ProgressLog.tsx` | Render narrative via ReactMarkdown for clickable links |
| `src/components/ComparisonDisplay.tsx` | Add `queryText` prop passthrough |
| `src/app/page.tsx` | Store `lastQuery` in state, pass to ComparisonDisplay |
| `src/components/about/McpFlowDiagram.tsx` | Store `liveQueryText`; split fullscreen toggle into enter/close buttons |
| `src/components/about/TraceControls.tsx` | Extract `SpeedSelector`; group speed with Replay; add complexity indicator |
| `src/lib/bpmn/traces.ts` | Replace technical chip labels with query descriptions |

---

## 2026-02-27 — Side-by-Side Live Query Layout

**Scope:** Adding live query mode to the About page BPMN diagram with a side-by-side response panel, 5-tier slow query messaging, and cancelled state preservation.

### What went well

- **Split layout was clean** — CSS grid (`55fr 45fr` with transition) worked well. The `showSplit` derived boolean kept layout logic centralized, and `fitToView()` after transitions ensured the diagram always fit.
- **5-tier slow messaging is user-friendly** — Progressive escalation (30s neutral → 180s clickable suggestion) provides genuine teaching moments.
- **Cancelled state preserves context** — Adding `'cancelled'` as a distinct status means diagram state, partial response, and elapsed time are all preserved.
- **Course correction landed well** — After the initial wrong approach (see below), reusing the actual `ProgressLog` component produced identical behavior between home and About pages.

### What didn't go well

- **Built a parallel system instead of reusing existing components** — First implementation built custom progress rendering from scratch, duplicating `ProgressLog`. Root cause: started implementing from plan description without reading existing code first. Wasted a full implementation pass.
- **useLiveTrace accumulating too much responsibility** — The hook now manages SSE connection, diagram animation, progress logs, tool tracking, trace capture, slow timers, elapsed time, and abort control. Acceptable for now but a code smell.

### Lessons

- **Read the component you're matching before writing code.** When told "make X behave like Y," always read Y first.
- **Prefer importing over reimplementing.** `ProgressLog` was already flexible enough to work in the About page context without modification.
- **Export utilities proactively.** `generateGroupLabel` had to be exported from `useStreamingComparison.ts` for reuse — anticipate cross-module needs.

### Tech debt identified

1. Duplicated event handling logic between `useLiveTrace` and `useStreamingComparison` — a shared utility could extract group-building logic.
2. `@keyframes blink` defined in multiple component-level styled-jsx blocks — could move to `globals.css`.
3. `@keyframes spin` added to globals.css but also exists in component styles — audit for duplicates.

---

## 2026-02-27 — Live BPMN Diagram for MCP Query Visualization

**Scope:** Interactive BPMN 2.0 diagram on the About page that animates pre-recorded MCP query traces through the system architecture. 11 files created, 3 modified.

### Architecture decisions

| Decision | Rationale |
|----------|-----------|
| **NavigatedViewer over basic Viewer** | Bundles ZoomScroll, MoveCanvas, KeyboardMove — scroll-to-zoom and drag-to-pan without custom code |
| **Manual viewport fitting** | Built-in `fit-viewport` produced unreliable results; manual `fitToContainer()` with explicit viewbox is reliable |
| **Client wrapper for SSR boundary** | Next.js 16 App Router can't use `ssr: false` in Server Components; thin wrapper preserves server metadata exports |
| **setTimeout-chain replay** | Matches discrete event-based trace data; speed changes are trivial (divide gap by factor) |
| **Hand-authored traces** | Guarantees consistent demo quality without live API dependency; capture utility exists for replacing with real traces later |
| **CSS markers over SVG manipulation** | `canvas.addMarker()` is the officially supported animation API; all visual states are pure CSS with transitions |
| **Overlay API for annotations** | `overlays.add()` positions HTML relative to diagram nodes; annotations track pan/zoom automatically |

### Files created

| File | Purpose |
|------|---------|
| `public/bpmn/mcp-query-flow.bpmn` | BPMN 2.0 XML: 5-lane MCP query flow process |
| `src/lib/bpmn/traces.ts` | 4 hand-authored traces with realistic SoQL and timing |
| `src/lib/bpmn/node-mapping.ts` | Maps ProgressPhase → BPMN element IDs with cascade delays |
| `src/lib/bpmn/capture-trace.ts` | Dev utility to capture live traces (enable via `NEXT_PUBLIC_CAPTURE_TRACES=true`) |
| `src/hooks/useTraceReplay.ts` | Replay state machine with speed control and dramatic pauses |
| `src/components/about/BpmnViewer.tsx` | bpmn-js NavigatedViewer wrapper with zoom, lane coloring, animation API |
| `src/components/about/bpmn-diagram.css` | CSS markers, overlay cards, zoom controls, responsive rules |
| `src/components/about/TraceControls.tsx` | Trace selector pills, playback controls, speed toggle |
| `src/components/about/DiagramAnnotations.tsx` | Educational text panel |
| `src/components/about/NarrativePanel.tsx` | "What's happening now" panel with lane context |
| `src/components/about/McpFlowDiagram.tsx` | Orchestrator: fullscreen, state sync between replay and viewer |
| `src/components/about/McpFlowDiagramWrapper.tsx` | Client-side dynamic import wrapper |

### Post-commit polish (applied same day)

- **BPMN layout**: Widened lanes to 1200px, right-angle MCP→Socrata routing, better vertical alignment
- **Fullscreen stability**: `100dvh` for mobile chrome, `overflow: hidden`, flex fixes
- **Trace capture integration**: Wired into `useStreamingComparison` — records MCP-panel events, exports JSON on completion
- **Mobile responsive**: Scroll fade hints, 2x2 pill grid at ≤640px, stacked playback controls, fullscreen height fix

### Known issues

- BPMN XML hand-authored — should round-trip through bpmn.io visual modeler
- Overlay cards may clip at extreme zoom levels
- bpmn-js adds ~400KB gzipped (dynamically loaded, About page only)
- 4 `@typescript-eslint/no-explicit-any` suppressions for untyped bpmn-js APIs

### Dependencies added

| Package | Version | Purpose | Bundle Impact |
|---------|---------|---------|---------------|
| `bpmn-js` | ^18.12.0 | BPMN 2.0 diagram rendering | ~400KB gzipped (dynamic, About page only) |

### File dependency graph

```
about/page.tsx
  └── McpFlowDiagramWrapper.tsx (client, dynamic import)
        └── McpFlowDiagram.tsx (orchestrator)
              ├── TraceControls.tsx
              ├── BpmnViewer.tsx ← bpmn-diagram.css
              │     └── fetches /bpmn/mcp-query-flow.bpmn
              ├── NarrativePanel.tsx
              │     └── lib/streaming.ts (getEducationalAnnotation)
              ├── DiagramAnnotations.tsx
              │     └── lib/streaming.ts (getEducationalAnnotation)
              └── hooks/useTraceReplay.ts
                    ├── lib/bpmn/traces.ts
                    └── lib/bpmn/node-mapping.ts
```
