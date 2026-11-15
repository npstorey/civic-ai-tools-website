# Model evaluation, November 2026

This evaluation asks whether an open-weight model belongs in the site's model catalog beside the Claude
models, as the middle option between a closed roster and self-hosting (civic-ai-tools-website#740). It
puts the test questions of the October and March evaluations to the two Claude models the site
offers for answering questions, Claude Haiku 5.5 and Claude Sonnet 5.5, and to three open-weight models
served through OpenRouter: GLM-5.3-Flash, gpt-oss-120b and MiMo-V2.6-Flash. It runs them on the app's own
request shape, scores every answer against the project's six-dimension rubric (hub
[`docs/research/eval-queries.md`](https://github.com/npstorey/civic-ai-tools/blob/1d97e0e/docs/research/eval-queries.md)
at `1d97e0e`), and adds two checks the October run did not make: whether a model respects the consent pause,
and whether its answer cites only what its own tool calls can back.

It supersedes [`model-evaluation-2026-10.md`](model-evaluation-2026-10.md) for the roster question (#740,
D7). The roster decision itself is made separately, in a memo the owner rules on; this document reports the
measurement.

**How to read the figures.** Every number about the run in this document is rendered by
[`scripts/eval-report.mjs`](../scripts/eval-report.mjs) from the files in
[`model-evaluation-2026-11/`](model-evaluation-2026-11/), between `<!-- table:… -->` markers; `node
scripts/eval-report.mjs --check` fails if any of them drifts from what the files say. The prose names the table
that holds a figure rather than repeating it. Facts that are not in those files (a ruling, a production read, a
time bound's configuration) are cited to their source.

## The short version

- **Every row ran to completion,** with no error rows and no timeouts (*Rows*).
- **Every model respected the consent pause on every row:** none called a declined source again, each used an
  allowed one, and none called a data tool before a load (*Automatic checks*).
- **On answer quality, the two Claude models lead, close to level with each other.** MiMo-V2.6-Flash is the
  closest open-weight model. GLM-5.3-Flash picks the right dataset as reliably as the Claude models but
  trails on query correctness, guidance and interpretation; gpt-oss-120b trails on all four dimensions
  (*Hand scores*, *Composite*).
- **On the rubric's Overall, Haiku 5.5 and Sonnet 5.5 are level.** With cost scored in dollars rather than
  tokens, Haiku 5.5 leads, MiMo-V2.6-Flash is second and Sonnet 5.5 falls to third (*Composite*).
- **Cost a question:** Sonnet 5.5's is many times any other model's. Haiku 5.5's sits inside the range of the
  three open-weight models (*Cost*).
- **No provider was pinned for the open-weight models,** so OpenRouter spread their requests over many
  providers. Several providers' own terms conflict with OpenRouter's stated policy for them, and several
  could not be fully read (*Providers*).
- **The scoring is a first pass** (D5, the owner's note): the scorers read the answer and its tool calls,
  not the data the calls returned. A second reader agreed closely with the first (*Agreement*).

## What was run

**The models.** The Claude models are sent what production sends them: the catalog's request settings. The
open-weight models carry the ruled routing (D3): a price ceiling, `require_parameters: true` and
`data_collection: "deny"`, with no provider pinned. Prices are OpenRouter's listed prices on the run date,
in USD per million tokens; a model whose endpoints differ in price is listed at its cheapest.

<!-- table:models -->
| Model | Role | Request parameters | Provider object sent | Listed price, input / output (USD per million tokens) |
|---|---|---|---|---|
| Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`) | control | `{"max_completion_tokens":4000,"reasoning_effort":"low"}` | none (the default route) | 0.1 / 0.5 |
| Claude Sonnet 5.5 (`anthropic/claude-sonnet-5.5`) | control | `{"max_completion_tokens":4000,"reasoning_effort":"medium"}` | none (the default route) | 2 / 10 |
| GLM-5.3-Flash (`z-ai/glm-5.3-flash`) | open-weight | `{"max_tokens":4000,"reasoning_effort":"low"}` | `{"max_price":{"prompt":0.15,"completion":0.6},"require_parameters":true,"data_collection":"deny"}` | 0.0399 / 0.0784 |
| gpt-oss-120b (`openai/gpt-oss-120b`) | open-weight | `{"max_tokens":4000,"reasoning_effort":"low"}` | `{"max_price":{"prompt":0.15,"completion":0.6},"require_parameters":true,"data_collection":"deny"}` | 0.15 / 0.6 |
| MiMo-V2.6-Flash (`xiaomi/mimo-v2.6-flash`) | open-weight | `{"max_tokens":4000}` | `{"max_price":{"prompt":0.15,"completion":0.6},"require_parameters":true,"data_collection":"deny"}` | 0.14 / 0.28 |
<!-- /table:models -->

**The questions.** The harness's `TEST_QUERIES`, unchanged from March, with Q3 now on San Francisco's current
portal (D7).

<!-- table:design -->
The run: 15 questions, each put to every model 3 times with every source On, and 30 pause rows: 255 rows over 5 models (`metadata.rowsExpected`), of which 255 were written.
<!-- /table:design -->

<!-- table:pause-set -->
The pause rows are Q1, Q2, Q6, each with its gold source set to Ask first, once with each decision (`off` and `allow`), 1 repeat (`metadata.pauseSet`).
<!-- /table:pause-set -->

Why those three: the harness's own comment says Q1, Q2 and Q6 are three portals, each with an
`expectedDataset`, that Q3 is left out because its portal was unmeasured end to end, and that "The rows are
configured Ask first, not chosen by source" ([`scripts/eval-models.mjs:407-414`](https://github.com/npstorey/civic-ai-tools-website/blob/1c2c52915d50208b60c7c43fe4d133d932d31486/scripts/eval-models.mjs#L407-L414)
at `1c2c529`, the run's recorded `harness.gitHead`, whose file hash matches its `harness.sha256`; the seat's
ruling, #740 comment 6728891704, point 2).

**The setting.** The harness ([`scripts/eval-models.mjs`](../scripts/eval-models.mjs) at `1c2c529`) runs each
row through the app's own in-loop routing: the first request offers only `load_source` and the source
directory, and each load composes the tools and the prompt the app would. A row is a row the app could have
produced. Its limits are the app's (D9):

<!-- table:limits -->
- Routing: `in-loop`.
- At most 20 rounds a question and 4,000 tokens a response; a cumulative bound of 200,000 tokens a question, summed over its requests, at which the loop forces one answering turn.
- A tool result is cut at 50,000 characters; a tool call times out after 45 s.
- A question times out after 300 s (`metadata.limits.queryTimeoutMs = 300000`).
- The answering turn is sent as `stream`.
<!-- /table:limits -->

<!-- table:sources -->
The run's directory listed 2 of the 7 sources the harness knows: `socrata` (remote) and `data_commons` (remote). The other 5 were not configured: `boston`, `nyc_charter`, `nyc_checkbook`, `nyc_record`, `nys_legislation` (`metadata.sources`).
<!-- /table:sources -->

Production serves six sources: these two, and four hosted sources that run in a per-instance sandbox. Those
four were left out of the run under the seat's sandbox stop (#740 comment 6728051193, point 3), so the run's
directory lists two of production's six. Production's `/api/flows` was read at 2026-11-09T14:01:20Z for that
count.

## Results

### Rows

<!-- table:rows -->
| Model | Rows | Error rows | Timeouts | Rows at the cumulative bound | Rows that took the answering turn | Empty answers | Answers cut at the response limit | Tool calls a row, mean | Failed tool calls |
|---|---|---|---|---|---|---|---|---|---|
| Claude Haiku 5.5 | 51 | 0 | 0 | 0 | 1 | 0 | 0 | 3.22 | 16 |
| Claude Sonnet 5.5 | 51 | 0 | 0 | 0 | 0 | 0 | 0 | 2.94 | 12 |
| GLM-5.3-Flash | 51 | 0 | 0 | 3 | 6 | 0 | 0 | 4.90 | 114 |
| gpt-oss-120b | 51 | 0 | 0 | 4 | 4 | 0 | 0 | 4.14 | 37 |
| MiMo-V2.6-Flash | 51 | 0 | 0 | 1 | 1 | 0 | 0 | 4.02 | 19 |
<!-- /table:rows -->

<!-- table:streamed-turns -->
12 rows took the streamed answering turn; 12 streamed requests were sent, 12 accepted and 0 refused.
<!-- /table:streamed-turns -->

So no streamed answering turn was refused, and the ruling that a refused one is scored as the row's error
(#740 comment 6747777845, accepted by the seat) applied to no row.

### Hand scores

The four dimensions the rubric scores by hand, over each model's rows. A row with no data call (a declined
pause row, a clarification, a correct decline) is left unscored on Dataset Selection and SoQL Correctness.

<!-- table:scores -->
| Model | Dataset Selection, mean (rows scored) | Dataset Selection, rows scored 1/2/3/4/5, unscored | SoQL Correctness, mean (rows scored) | SoQL Correctness, rows scored 1/2/3/4/5, unscored | Guidance Adherence, mean (rows scored) | Guidance Adherence, rows scored 1/2/3/4/5, unscored | Interpretation Quality, mean (rows scored) | Interpretation Quality, rows scored 1/2/3/4/5, unscored |
|---|---|---|---|---|---|---|---|---|
| Claude Haiku 5.5 | 4.98 (45) | 0/0/0/1/44, 6 | 4.47 (45) | 1/3/2/7/32, 6 | 4.63 (51) | 0/1/4/8/38, 0 | 4.47 (51) | 1/1/5/10/34, 0 |
| Claude Sonnet 5.5 | 4.86 (42) | 0/0/0/6/36, 9 | 4.38 (42) | 1/1/6/7/27, 9 | 4.63 (51) | 0/0/4/11/36, 0 | 4.53 (51) | 0/1/5/11/34, 0 |
| GLM-5.3-Flash | 4.97 (40) | 0/0/0/1/39, 11 | 3.15 (40) | 5/13/6/3/13, 11 | 3.75 (51) | 0/4/14/24/9, 0 | 3.22 (51) | 0/16/15/13/7, 0 |
| gpt-oss-120b | 4.41 (39) | 0/4/0/11/24, 12 | 2.97 (39) | 5/13/7/6/8, 12 | 3.24 (51) | 1/11/15/23/1, 0 | 2.65 (51) | 9/11/20/11/0, 0 |
| MiMo-V2.6-Flash | 4.73 (45) | 0/0/1/10/34, 6 | 4.40 (45) | 0/4/3/9/29, 6 | 4.45 (51) | 0/1/5/15/30, 0 | 4.00 (51) | 0/2/11/23/15, 0 |
<!-- /table:scores -->

Dataset Selection is read on the row's first tool call that is not `load_source`: in-loop, every row's first
call is a load, so the rubric's "first tool call" needed that rule.

### Composite

The rubric's Composite. Quality is the mean of a row's hand-scored dimensions (an unscored one left out),
averaged over the model's rows. Cost and Latency are scored relative to the other four models on the same
question, configuration and repeat, by the rubric's table read as: 5 at or within 10% of the lowest; else 1
for the highest, or at least twice the median; else 3 within 10% of the median; else 4 below the median and
2 above it. Efficiency is the mean of the two, and Overall is 0.7 × Quality + 0.3 × Efficiency. The last two
columns score cost on each row's recorded dollars instead of its tokens, since prices differ by far more
than token counts do.

<!-- table:composite -->
| Model | Quality | Cost score (tokens) | Latency score | Efficiency | Overall | Cost score (recorded USD) | Overall, cost scored on USD |
|---|---|---|---|---|---|---|---|
| Claude Haiku 5.5 | 4.63 | 2.45 | 3.41 | 2.93 | **4.12** | 2.71 | 4.16 |
| Claude Sonnet 5.5 | 4.61 | 2.80 | 3.14 | 2.97 | **4.12** | 1.00 | 3.85 |
| GLM-5.3-Flash | 3.72 | 3.61 | 3.25 | 3.43 | **3.63** | 4.00 | 3.69 |
| gpt-oss-120b | 3.26 | 2.92 | 2.92 | 2.92 | **3.16** | 2.76 | 3.13 |
| MiMo-V2.6-Flash | 4.40 | 3.39 | 2.45 | 2.92 | **3.96** | 4.27 | 4.09 |
<!-- /table:composite -->

The efficiency scores rank these five models against each other within this run only; they do not compare
with October's.

### Cost

A request's recorded cost is the larger of its cost at OpenRouter's listed price and the cost OpenRouter
reported for it. The Claude requests are billed through the account's own Anthropic key (BYOK), so
OpenRouter reports no cost for them and the listed price is the record. The open-weight requests are billed
by OpenRouter; where a request was served by an endpoint dearer than the listed one, its reported cost is the
larger, which is why GLM-5.3-Flash's reported total exceeds its listed one.

<!-- table:cost -->
| Model | Billed through | Requests | Recorded cost, all rows | Recorded cost a question, mean | Listed cost, all rows | Reported cost, all rows |
|---|---|---|---|---|---|---|
| Claude Haiku 5.5 | BYOK (the Anthropic account) | 197 | $0.3035 | $0.0060 | $0.3035 | $0.0000 |
| Claude Sonnet 5.5 | BYOK (the Anthropic account) | 186 | $5.4253 | $0.1064 | $5.4253 | $0.0000 |
| GLM-5.3-Flash | OpenRouter | 260 | $0.1895 | $0.0037 | $0.1010 | $0.1889 |
| gpt-oss-120b | OpenRouter | 262 | $0.3649 | $0.0072 | $0.3649 | $0.1785 |
| MiMo-V2.6-Flash | OpenRouter | 220 | $0.1745 | $0.0034 | $0.1743 | $0.1721 |

Recorded in all: $6.4577, of which $0.7289 billed by OpenRouter (the open-weight rows) and $5.7288 through BYOK (the Claude rows).
<!-- /table:cost -->

### Latency and tokens

Duration is a row's time from its first request to its answer. The p90 is the nearest-rank 90th percentile.

<!-- table:latency -->
| Model | Duration a question, median | Duration, p90 | Tokens a question, mean | Tokens a question, median | Input tokens, all rows | Output tokens, all rows | Reasoning tokens, all rows |
|---|---|---|---|---|---|---|---|
| Claude Haiku 5.5 | 15.4 s | 41.3 s | 52,950 | 46,869 | 2,616,790 | 83,663 | 22,810 |
| Claude Sonnet 5.5 | 16.1 s | 43.3 s | 48,529 | 47,644 | 2,415,561 | 59,417 | 5,870 |
| GLM-5.3-Flash | 14.9 s | 87.2 s | 57,486 | 20,479 | 2,848,092 | 83,673 | 52,695 |
| gpt-oss-120b | 15.6 s | 66.1 s | 66,709 | 45,445 | 3,364,709 | 37,432 | 17,330 |
| MiMo-V2.6-Flash | 24.5 s | 71.2 s | 50,105 | 37,082 | 2,480,194 | 75,139 | 33,965 |
<!-- /table:latency -->

## The automatic checks

<!-- table:checks -->
| Model | Pause check passed | Declined source not called again (off rows) | Allowed source used (allow rows) | No call before a load | Citation check passed | Citation check failed | Reviewed true positives | False positives (A4) | Answers naming an id written with U+2011 | Expected dataset called | Expected dataset answered | Expected dataset cited | Expected dataset not cited, but written with U+2011 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Haiku 5.5 | 51 of 51 | 3 of 3 | 3 of 3 | 51 of 51 | 46 of 51 | 5 | 5 | 0 | 0 of 51 | 36 of 42 | 35 of 42 | 36 of 42 | 0 |
| Claude Sonnet 5.5 | 51 of 51 | 3 of 3 | 3 of 3 | 51 of 51 | 43 of 51 | 8 | 8 | 0 | 0 of 51 | 35 of 42 | 35 of 42 | 35 of 42 | 0 |
| GLM-5.3-Flash | 51 of 51 | 3 of 3 | 3 of 3 | 51 of 51 | 46 of 51 | 5 | 5 | 0 | 0 of 51 | 38 of 42 | 35 of 42 | 36 of 42 | 0 |
| gpt-oss-120b | 51 of 51 | 3 of 3 | 3 of 3 | 51 of 51 | 46 of 51 | 5 | 5 | 0 | 24 of 51 | 32 of 42 | 32 of 42 | 21 of 42 | 9 |
| MiMo-V2.6-Flash | 51 of 51 | 3 of 3 | 3 of 3 | 51 of 51 | 48 of 51 | 3 | 3 | 0 | 0 of 51 | 34 of 42 | 34 of 42 | 33 of 42 | 0 |
<!-- /table:checks -->

How to read it:
- **The pause check** reads the row's tool calls. On an `off` row, the model must not call `load_source` for
  the declined source again or call that source's tools; on an `allow` row, its data calls must address the
  source; on every row, no tool but `load_source` may be called before a load.
- **The citation check** fails an answer that names a dataset id no tool call in the row addressed, or that
  carries a citation artifact (a `【…】` mark, a bare `[n]` with no source line, or a URL whose dataset id no
  call addressed). "Addressed" means answered: a refused call does not count, and each row reports the ids it
  named only through refused calls (`onlyRefused`).
- **"Expected dataset"** compares the row's calls and answer with the question's `expectedDataset`; *cited*
  means the answer's text holds the id. It is not a correctness grade. The harness's `rowChecks`, which
  computes these columns, counts only `get_data`-shaped calls (a `dataset_id`, a metadata `query`, or
  `type: 'query'`); `fetch`, `search` and Data Commons calls are not counted. The citation check, by
  contrast, reads every four-by-four id in any call's arguments.

**What the checks cannot see.**
- **An id with no digit** (`abcd-efgh`) is not read as a dataset id, so an unaddressed one passes.
- **An id written with non-breaking hyphens (U+2011)** is not read as one either. gpt-oss-120b writes its
  hyphens that way in many answers, so the citation check does not see the ids those answers name, and the
  *Expected dataset cited* column undercounts it by the rows in the last column.
- **An invented dataset name outside the id form,** such as the "311-service-requests" one answer to Q15 gives
  for Chicago (`z-ai/glm-5.3-flash Q15 r2 every-source-on`), is outside what the check reads. The check was
  never meant to catch it; the hand scores do.
- **Q9's expected dataset is stale.** `h73f-gn57` is the 2025 dataset and holds no rows for May to November
  2026, so the *Expected dataset* columns count Q9 against it. Answers that found the 2026 dataset by a
  catalog search were scored 4 on Dataset Selection, as the rubric scores a search, and the other three
  dimensions carry the difference.

### The citation failures, reviewed (A4)

Each failure was reviewed by its question group's first scorer, after that scorer's scores were written, as
a true or a false positive under the rule as ruled (D10). The rows are in Appendix B.

<!-- table:citation-statement -->
- **A4, under the rule as ruled: 0 false positives of 26** citation-check failures.
- **10 of the 26** (group G4's cards) name ids the answer attributes to a catalog search: `anthropic/claude-haiku-5.5 Q12 r1 every-source-on`, `anthropic/claude-sonnet-5.5 Q12 r1 every-source-on`, `z-ai/glm-5.3-flash Q12 r1 every-source-on`, `xiaomi/mimo-v2.6-flash Q12 r1 every-source-on`, `anthropic/claude-haiku-5.5 Q12 r2 every-source-on`, `anthropic/claude-sonnet-5.5 Q12 r2 every-source-on`, `xiaomi/mimo-v2.6-flash Q12 r2 every-source-on`, `anthropic/claude-haiku-5.5 Q12 r3 every-source-on`, `anthropic/claude-sonnet-5.5 Q12 r3 every-source-on`, `xiaomi/mimo-v2.6-flash Q12 r3 every-source-on`. The run file records each search's row and column counts (`resultSummary`) and not the results themselves, so whether a search listed an id cannot be settled either way for these 10: under the rule each is a true positive, and under the check's purpose any of them could be a false one. This document chooses no second reading.
- **2 answers to Q15 decline correctly and name the id they would query next** (`anthropic/claude-sonnet-5.5 Q15 r2 every-source-on`, `z-ai/glm-5.3-flash Q15 r2 every-source-on`): true positives under the rule.
<!-- /table:citation-statement -->

## The providers (A8)

Each provider that served an open-weight request in the probe or the run, with OpenRouter's stated policy
for it (its all-providers JSON, read at the time shown) and the date its own published terms were read. The
terms were read from public pages with no key, the day after the run for the providers first seen in it. A
conflict between OpenRouter's statement and the provider's own words is recorded as a conflict, not
resolved; a page that could not be read is recorded as a gap. The verbatim passages are in Appendix C, and
all of it is in [`provider-terms.json`](model-evaluation-2026-11/provider-terms.json).

<!-- table:providers -->
| Provider (OpenRouter's name) | Run requests, by model | Probe requests, by model | OpenRouter's stated policy (all-providers JSON) | Terms read | Conflicts recorded | Gaps recorded |
|---|---|---|---|---|---|---|
| AkashML | gpt-oss-120b 22 | gpt-oss-120b 1 | training false; retains prompts false (read 2026-11-09T18:11:00Z) | 2026-11-09 | none | 1 (below) |
| Cohere | MiMo-V2.6-Flash 167, GLM-5.3-Flash 5 | MiMo-V2.6-Flash 8 | training false; retains prompts true, 30 days (read 2026-11-09T18:11:00Z) | 2026-11-09 | 1 (below) | 1 (below) |
| CoreWeave | GLM-5.3-Flash 5 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | none | 1 (below) |
| Crusoe | gpt-oss-120b 30, GLM-5.3-Flash 6 | gpt-oss-120b 2 | training false; retains prompts false (read 2026-11-09T18:11:00Z) | 2026-11-09 | none | 2 (below) |
| DeepInfra | gpt-oss-120b 1, GLM-5.3-Flash 1 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | none | none |
| DekaLLM | gpt-oss-120b 5 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | 1 (below) | 1 (below) |
| Friendli | GLM-5.3-Flash 1 | GLM-5.3-Flash 2 | training false; retains prompts true (read 2026-11-09T18:11:00Z) | 2026-11-09 | 1 (below) | 1 (below) |
| GMICloud | MiMo-V2.6-Flash 16 | — | training false; retains prompts true (read 2026-11-14T20:10:16Z) | 2026-11-14 | 1 (below) | 1 (below) |
| InferenceNet | GLM-5.3-Flash 47 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | none | 1 (below) |
| KT | GLM-5.3-Flash 1 | — | training false; retains prompts true (read 2026-11-14T20:10:16Z) | 2026-11-14 | none | none |
| Makora | GLM-5.3-Flash 6 | MiMo-V2.6-Flash 5 | training false; retains prompts false (read 2026-11-09T18:11:00Z) | 2026-11-09 | none | 2 (below) |
| Mistral | GLM-5.3-Flash 40 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | 1 (below) | 1 (below) |
| Modal | GLM-5.3-Flash 3 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | none | 1 (below) |
| Morph | — | GLM-5.3-Flash 1 | training false; retains prompts false (read 2026-11-09T18:11:00Z) | 2026-11-09 | none | 1 (below) |
| Near AI | gpt-oss-120b 15 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | none | 1 (below) |
| OpenInference | GLM-5.3-Flash 69 | GLM-5.3-Flash 10 | training false; retains prompts false (read 2026-11-09T18:11:00Z) | 2026-11-09 | 1 (below) | 1 (below) |
| Particle AI | GLM-5.3-Flash 25 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | none | none |
| PrimeIntellect | gpt-oss-120b 155 | gpt-oss-120b 6 | training false; retains prompts false (read 2026-11-09T18:11:00Z) | 2026-11-09 | none | 3 (below) |
| Reka | GLM-5.3-Flash 12 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | 1 (below) | 1 (below) |
| Relace | GLM-5.3-Flash 14 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | none | 1 (below) |
| River | GLM-5.3-Flash 11 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | 1 (below) | 1 (below) |
| Sail Research | gpt-oss-120b 31 | gpt-oss-120b 9 | training false; retains prompts false (read 2026-11-09T18:11:00Z) | 2026-11-09 | 1 (below) | 3 (below) |
| Together | GLM-5.3-Flash 4 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | none | none |
| Venice | gpt-oss-120b 3, GLM-5.3-Flash 1 | — | training false; retains prompts false (read 2026-11-14T20:10:16Z) | 2026-11-14 | none | none |
| Wafer | GLM-5.3-Flash 9 | GLM-5.3-Flash 1 | training false; retains prompts false (read 2026-11-09T18:11:00Z) | 2026-11-09 | none | 4 (below) |
| Xiaomi | MiMo-V2.6-Flash 37 | — | training false; retains prompts true, 30 days (read 2026-11-14T20:10:16Z) | 2026-11-14 | none | 1 (below) |

26 providers served open-weight requests. Of the 787 open-weight requests in the two files, 787 carried the provider object `{"max_price":{"prompt":0.15,"completion":0.6},"require_parameters":true,"data_collection":"deny"}`. The 410 Claude requests carried none and were served by Anthropic through the account's own key; that provider's terms are not part of either reading.
<!-- /table:providers -->

**Conflicts recorded.**

<!-- table:provider-conflicts -->
- **Cohere** (terms-2026-11-09.md): OpenRouter's provider level says 30-day retention; its endpoint level for the MiMo endpoint says no retention. Cohere's commitments page says SaaS prompts and generations are logged and deleted after 30 days unless ZDR is approved. None of Cohere's pages read names OpenRouter.
- **DekaLLM** (terms-2026-11-14.md): OpenRouter: `retainsPrompts` false. DekaLLM's EULA summary page: customer data “is temporarily stored for operational purposes only, and is permanently deleted according to a defined schedule.” No period is stated.
- **Friendli** (terms-2026-11-09.md): OpenRouter says it retains prompts (period unknown); Friendli's terms state it will not store or log inputs or outputs beyond the request unless the customer opts in.
- **GMICloud** (terms-2026-11-14.md): OpenRouter: `retainsPrompts` true, period not stated. GMICloud's MaaS Console Terms of Service: “Unless explicitly opted in to prompt logging, Company does not store Client’s Inputs after categorizing them”. Which GMICloud agreement covers OpenRouter's traffic (the Console terms for its aggregator site, or the Prime Inference Services Agreement) is not stated; the Prime agreement states no retention period.
- **Mistral** (terms-2026-11-14.md): OpenRouter: `retainsPrompts` false at provider level and for the endpoint `mistral` serving GLM-5.3-Flash. Mistral's privacy policy: “Except for specific APIs, we keep your Input and Output for the period necessary to generate the Output and then for thirty (30) rolling days to monitor abuse (unless zero data retention is activated).” Whether zero data retention is active for OpenRouter's traffic is not stated in what was read.
- **OpenInference** (terms-2026-11-09.md): OpenRouter says no training; OpenInference's privacy policy says no training, but its terms reserve use “to provide, maintain, develop, and improve the Services” with a training opt-out.
- **Reka** (terms-2026-11-14.md): OpenRouter: `training` false. Reka's Business Terms (effective January 2024): “Reka may compile Aggregated Data based on Customer Content and may use all Aggregated Data to improve Reka’s machine learning model and artificial intelligence algorithms”. Reka's individual terms permit training on free-basis use and exclude it for paid requests unless the customer opts in. Which Reka terms apply to OpenRouter's use, and whether that use is paid, are not stated.
- **River** (terms-2026-11-14.md): OpenRouter: `retainsPrompts` false. River's API Services Agreement, Commercial tier (the default): “We retain User Content for up to 2 days after the end of the interaction session.”
- **Sail Research** (terms-2026-11-09.md): OpenRouter says no prompt retention; Sail's terms say it “may store responses” and that disabling storage is not available. The "Documentation" those terms cite was not read.
<!-- /table:provider-conflicts -->

**Differences that are not conflicts, and notes.**

<!-- table:provider-differences -->
- **Crusoe** (terms-2026-11-09.md): Only Crusoe publishes terms written for OpenRouter customers.
- **Crusoe, Morph** (terms-2026-11-09.md): Two pages changed on the reading day: Morph's privacy policy (“Last Updated: November 9, 2026”) and Crusoe's Data Processing and Security Terms (“Effective November 9th 2026”).
- **GMICloud, InferenceNet, KT, Mistral, Modal, Near AI, Particle AI, Reka, River, Together** (terms-2026-11-14.md): **Where OpenRouter's single value depends on a setting, tier, product or route** that the provider's pages do not tie to OpenRouter: InferenceNet (ZDR is a team setting), Together (ZDR is a customer setting), Mistral (zero data retention "activated"; some products train unless opted out), Reka (free or paid; individual or business terms), Modal (product), Near AI (route), River (Commercial default or Testing), Particle AI ("standard synchronous inference"), GMICloud (Console terms or Prime agreement), KT (opt-in logging).
- **KT** (terms-2026-11-14.md): **KT.** OpenRouter states retention with no period. KT's privacy policy gives 30 days for entered prompts and generated results; its terms say data the company retains is deleted one year after creation. The two KT documents give different periods; the terms clause is not limited to prompts.
- **KT** (terms-2026-11-14.md): **KT routes onward.** KT's privacy policy names OpenRouter among the processors KT entrusts with inference traffic: “OpenRouter , Inc. ( OpenRouter ) AI 모델 연계 · 라우팅 및 AI 추론을 위한 프롬프트 · 응답 처리 · 전송” [OpenRouter, Inc.: AI model linkage, routing, and processing and transfer of prompts and responses for AI inference]. Its list of sub-entrusted model providers includes “Z.ai (GLM) 라우팅 데이터 처리 • 생성형 AI 응답 생성(LLM API 호출)” [Z.ai (GLM): routing data processing, generative AI response generation (LLM API calls)]. For overseas transfers to these processors it says data “사업자의 정책에 따라 일정 기간 국외 서버에 저장될 수 있음” [may be stored on overseas servers for a period, according to that operator's policy]. Which path KT used for the one GLM-5.3-Flash request is not stated anywhere read.
- **KT, Near AI, Relace** (terms-2026-11-14.md): **Only KT's privacy policy, Near AI's model catalog and Relace's home page name OpenRouter** among the providers' own pages read. None of the 16 publishes terms written for OpenRouter-routed traffic.
- **Makora, Morph** (terms-2026-11-09.md): **Morph, Makora**: retention is set by account tier, and neither names OpenRouter, so the tier for OpenRouter-routed traffic is not stated where read.
- **Makora** (terms-2026-11-09.md): Makora's published privacy policy carries a drafting note: “If you want the specific Azure service names itemized publicly (e.g., Azure Front Door, Azure Monitor, Azure Communication Services), confirm and I will expand those rows.”
- **Near AI** (terms-2026-11-14.md): **Near AI's published catalog.** The model list embedded in `near.ai/models` (64 model ids) contains `z-ai/glm-5.3-flash` but not gpt-oss-120b, the model OpenRouter routed to Near AI. The same payload describes at least one model as “Served through OpenRouter using ZDR inference endpoints.”
- **Relace, Venice** (terms-2026-11-14.md): **Venice and Relace use upstream providers.** Venice's privacy policy describes sending prompts to model providers (quoted above); Relace's ZDR policy describes routing to subprocessors (quoted above).
- **Xiaomi** (terms-2026-11-14.md): **Xiaomi.** OpenRouter states 30-day retention. Xiaomi's pages read state no retention period for API content.
<!-- /table:provider-differences -->

**Gaps: what could not be read.**

<!-- table:provider-gaps -->
- **AkashML, Cohere, Crusoe, Friendli, Makora, Morph, OpenInference, PrimeIntellect, Sail Research, Wafer** (terms-2026-11-09.md): **Which tier or agreement governs OpenRouter traffic** is not stated by Morph, Makora, Cohere, Friendli, OpenInference, Wafer, AkashML, Sail Research or PrimeIntellect in the pages read. Only Crusoe's page names OpenRouter. Friendli's zero-retention clause sits in Exhibit 1, which states it applies to "Customers that receive access to Friendli Endpoints Services"; whether OpenRouter traffic falls under it is not stated.
- **CoreWeave** (terms-2026-11-14.md): **CoreWeave.** No data statement for inference inputs or outputs was found in the linked pages, the docs index or the Serverless Inference page. Its Data Processing Agreement was not read.
- **Crusoe, Wafer** (terms-2026-11-09.md): **Fetch notes.** The first Crusoe save (18:11:53Z) was gzip bytes; refetched decompressed at 18:14:35Z (the file in `raw/`). The first fetch of one Tinfoil chunk used a wrong file name and returned 404 (18:18:08Z); refetched at 18:20:50Z under the name the pricing page references. JavaScript bundles fetched only to locate data sources (Wafer's compliance-portal bundle; the other Tinfoil chunks) were kept in the session scratchpad, not here, and nothing is quoted from them.
- **DekaLLM** (terms-2026-11-14.md): **DekaLLM.** OpenRouter's privacy URL returned 404 (saved). The EULA page OpenRouter links summarizes the agreements and says they are opened from the account menu of the Cloudeka Service Portal, behind sign-in; the agreements themselves were not read. The English privacy notice has no date.
- **GMICloud** (terms-2026-11-14.md): **GMICloud.** OpenRouter's privacy URL returned 404 (saved). OpenRouter's terms URL is the website's terms, with no date and no inference clause. The Legal pages render client-side; their text was read from the server payload saved in the raw bytes.
- **InferenceNet** (terms-2026-11-14.md): **Fetch notes.** All fetches used `--compressed`; the byte count in `fetchlog-2026-11-14.txt` is bytes transferred, not file size. InferenceNet's partner terms were read and found to be a referral program; they carry no data terms and nothing is quoted from them.
- **Makora, PrimeIntellect** (terms-2026-11-09.md): **Makora and PrimeIntellect have no terms or privacy URL on OpenRouter** (null in `/api/v1/providers` and in their `dataPolicy`). Their own pages were read from links on their home pages; nothing read ties those pages to OpenRouter-routed traffic.
- **Mistral** (terms-2026-11-14.md): **Mistral.** OpenRouter's two URLs carry anchors that the redirected index page does not have; the documents were read from the index's links. Mistral's Data Processing Addendum was not read.
- **Modal** (terms-2026-11-14.md): **Modal.** Which product (Functions, Servers, Dedicated or Shared Endpoints) serves OpenRouter's traffic is not stated.
- **Near AI** (terms-2026-11-14.md): **Near AI.** The route that served gpt-oss-120b (Private TEE, Attested Third-Party or Incognito) is not stated. The Data Processing Agreement was not read.
- **PrimeIntellect** (terms-2026-11-09.md): **PrimeIntellect**: no statement on retention, logging or human review of inference inputs and outputs was found in its terms; its privacy policy (2024) excludes processing it does as a data processor.
- **Reka** (terms-2026-11-14.md): **Reka.** The Business Terms that the individual terms point to are not linked from the pages read; the page was fetched by URL. That it is the document the individual terms mean is assumed from its title only.
- **Relace** (terms-2026-11-14.md): **Relace.** Both OpenRouter URLs returned 404 (saved; identical bytes). The policies were read from `relace.ai/legal/` links on the home page.
- **River** (terms-2026-11-14.md): **River.** The terms page renders client-side. Its text was read from the JavaScript file the page loads (saved). The app's main bundle, fetched at 2026-11-14T20:19:40Z only to find that file's name, was kept in the session scratchpad, not here; nothing is quoted from it. The agreement carries no date.
- **Sail Research** (terms-2026-11-09.md): **Sail Research's "Documentation"**, which its terms cite for response storage, was not identified or read.
- **Sail Research, Wafer** (terms-2026-11-09.md): **The endpoint variant that served each request** is not in the results file (provider name only). Each provider page shows one `data_policy` per probe model; OpenRouter's endpoint list has two GLM endpoints each for Wafer (`wafer/us`, `wafer/nvfp4`) and Sail Research (`sail-research/us`, `sail-research/fp4`), and the page showed only the `/us` one for GLM.
- **Wafer** (terms-2026-11-09.md): **Wafer's privacy policy.** OpenRouter's URL `https://www.wafer.ai/privacy-policy` returned 404 (saved, 18:11:51Z). The policy linked from Wafer's own terms page, `https://compliance.wafer.ai/en/documents/privacy-policy`, is client-rendered: the raw bytes (18:12:26Z, `9dabfa72608b710a935b71cb44b55ec00ea337a51b148154154ee473e12a974a`) hold only an app shell. Its content loads through a GraphQL POST to `compliance.wafer.ai/graphql`; one attempt at that POST was denied by this session's permission check and was not retried. WebFetch at 2026-11-09T18:21:31Z (via WebFetch, not raw bytes) saw only the heading "Compliance at Wafer AI." So Wafer's training position is unread: its terms and security page carry no training sentence.
- **Xiaomi** (terms-2026-11-14.md): **Xiaomi.** OpenRouter's two URLs are routes inside a client-rendered app. The two app bundles fetched to follow its routing (`platform.xiaomimimo.com` main chunk at 20:21:01Z, `mimo.mi.com` main chunk at 20:21:56Z) were kept in the session scratchpad, not here; nothing is quoted from them. The app maps the privacy policy to an international and a mainland-China variant; only the international English one was read. Two path URLs tried (`platform.xiaomimimo.com/docs/en-US/terms/privacy-policy`, `mimo.mi.com/docs/terms/privacy-policy`) returned the same app shell (saved). Which variant governs OpenRouter's traffic is not stated.
- **Every provider of the terms-2026-11-14.md reading:** **Which tier, setting or agreement governs OpenRouter-routed traffic** is not stated by any of the 16.
- **Every provider of the terms-2026-11-14.md reading:** **Timing.** The run was 2026-11-13; these reads are 2026-11-14, one day later. Pages and OpenRouter's values may have changed in between. The docs-table wording is the probe's 2026-11-09 reading, not re-read.
<!-- /table:provider-gaps -->

**For the roster memo: the enclave inference provider** (D3's note). npstorey/openmaxxing's README names it
as Tinfoil. Which of the three candidates it publishes, and at what price, read from its published pages on
2026-11-09; no request was sent to it.

<!-- table:enclave -->
| Candidate | Served? | Published name and ID |
|---|---|---|
| gpt-oss-120b | Yes | “> GPT-OSS 120B”, ID `gpt-oss-120b`, weights `openai/gpt-oss-120b` |
| GLM-5.3-Flash | Not under that name | Tinfoil publishes “> GLM-5.3”, ID `glm-5-3`, “**Parameters:** 743B (39B active)”, weights `Inferact/GLM-5.3-NVFP4`. OpenRouter's candidate is named "Z.ai: GLM 5.3 Flash" (`z-ai/glm-5.3-flash`). No Tinfoil page or config entry read names a GLM-5.3-Flash. Whether the two are the same model is not stated in what was read |
| MiMo-V2.6-Flash | No | Not on any of the six docs model pages and not among the 20 entries of the config JSON |

| Model (its ID) | Input, per million tokens | Output, per million tokens | As the page renders |
|---|---|---|---|
| gpt-oss-120b | 0.15 | 0.6 | $0.15 input, $0.60 output, per 1M tokens |
| glm-5-3 (GLM-5.3, not the Flash candidate) | 1.8 | 5.75 | $1.80 input, $0.45 cached input, $5.75 output, per 1M tokens |
<!-- /table:enclave -->

## How the answers were scored

**The scoring is a first pass** (D5, the owner's note); a more rigorous method is a later piece of work.
- **The scorers read cards, not the run.** Each card holds the question, the consent configuration, the tool
  calls in order (name, arguments, outcome, and each data call's `resultSummary`: its row and column counts)
  and the answer, verbatim. A card holds no tool-result text, so Interpretation Quality is scored on the
  answer against the calls it made, not against the data those calls returned.
- **Both readings are blind to the model.** A card carries no model id, model name, provider, cost, token
  count or duration; an opaque card id maps it to its row, and the map was kept from every scorer.
- **The first scoring:** five Claude Opus 5.5 agents, one per question group, each scoring every model's
  answers to its own questions, so scores within a question are comparable. Every score carries a one-line
  reason that quotes its card:

<!-- table:scoring-groups -->
G1 (Q1-3, 65 cards); G2 (Q4-6, 55 cards); G3 (Q7-9, 45 cards); G4 (Q10-12, 45 cards); G5 (Q13-15, 45 cards).
<!-- /table:scoring-groups -->

- **The second reading** (D5): a Fable 5.1 reader (`claude-fable-5-1`, read from its transcript's `model`
  lines, #740 comment 6887849905) re-scored a stratified sample blind to the model and to the first scores.

<!-- table:second-sample -->
The sample: 51 rows (Claude Haiku 5.5 10, Claude Sonnet 5.5 11, GLM-5.3-Flash 10, gpt-oss-120b 10, MiMo-V2.6-Flash 10), covering 15 of the 15 questions, drawn with seed `202611142`.
<!-- /table:second-sample -->

**Agreement between the two readings** (A13), per dimension, over the rows both readers scored:

<!-- table:agreement -->
| Dimension | Pairs (both readers scored) | Exact | Within one | Mean absolute difference | Quadratic-weighted kappa | Unscored by both / by one |
|---|---|---|---|---|---|---|
| Dataset Selection | 47 | 45 (93.6%) | 45 (95.7%) | 0.11 | 0.754 | 4 / 0 |
| SoQL Correctness | 47 | 33 (70.2%) | 46 (97.9%) | 0.32 | 0.893 | 4 / 0 |
| Guidance Adherence | 51 | 41 (80.4%) | 51 (100.0%) | 0.20 | 0.884 | 0 / 0 |
| Interpretation Quality | 51 | 38 (74.5%) | 48 (94.1%) | 0.31 | 0.825 | 0 / 0 |
<!-- /table:agreement -->

Kappa is lowest where one score holds most of the rows: nearly every Dataset Selection score is a 5, so a
few disagreements weigh heavily.

## Limits, and what was not measured

- **One run date, and the providers OpenRouter chose.** The open-weight rows were served by whichever
  providers OpenRouter chose for each request, so a repeat of the run may meet different ones.
- **The question time bound's project-level override.** The harness bounds a question at the time shown under
  *What was run*, the platform's default for the app's route, which sets no `maxDuration` of its own. Whether
  the Vercel project overrides that default at the project level is unmeasured.
- **The streamed-turn check of the probe sitting** (its step 8, three requests) is recorded in no file, and
  cost under $0.001.
- **The run's directory lists two of production's six sources** (above), so no row measured the four hosted
  sources.
- **No signed record of this run** (D8): the results files are committed under
  [`model-evaluation-2026-11/`](model-evaluation-2026-11/) so that one stays possible.

## Run record

<!-- table:run-files -->
| Results file | Mode | Started (UTC) | Finished (UTC) | Rows written | Complete | Error rows | Timeouts | Charged (the harness) | Cap | Harness commit | Node |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `eval-results-probe-20261109T164604Z.json` | `probe` | 2026-11-09T16:46:04.767Z | 2026-11-09T16:58:43.140Z | 15 of 15 | yes | 0 | 0 | $0.4280 | $10.0000 | `1c2c529` | v24.22.1 |
| `eval-results-run-20261113T134831Z.json` | `run` | 2026-11-13T13:48:31.177Z | 2026-11-13T16:00:02.577Z | 255 of 255 | yes | 0 | 0 | $6.4577 | $49.0000 | `1c2c529` | v24.22.1 |
<!-- /table:run-files -->

<!-- table:spend -->
- The probe: $0.4280 charged ($0.4280 recorded over its requests).
- The run: $6.4577 charged ($6.4577 recorded over its requests).
- In all, in the two files: $6.8857.
<!-- /table:spend -->

The harness's charged figure is the sum of the recorded costs; the probe sitting's streamed-turn check adds
under $0.001 (above).

**The data files** in [`model-evaluation-2026-11/`](model-evaluation-2026-11/):
- `eval-results-run-20261113T134831Z.json` and `eval-results-probe-20261109T164604Z.json`: the results files
  as the harness wrote them (sha256 `37eb898c…ca5a` and `312559dc…233b`).
- `scores-first.json` and `scores-second.json`: every score with its reason, keyed by row key.
- `citation-review.json`: each citation failure's verdict and reason, keyed by row key.
- `provider-terms.json`: each served provider's OpenRouter statement and its own terms, as read, with the
  conflicts and the gaps.

## Appendix A: scores per row

Each cell gives Dataset Selection, SoQL Correctness, Guidance Adherence and Interpretation Quality, 1 to 5;
– is unscored. The reasons are in [`scores-first.json`](model-evaluation-2026-11/scores-first.json).

<!-- table:appendix-scores -->
**Q1.** How many 311 complaints were filed in NYC last month?

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5555 | 5555 | 5555 | 5544 | 5544 |
| Socrata Ask first, off, r1 | ––54 | ––55 | ––32 | ––43 | ––55 |
| Socrata Ask first, allow, r1 | 5555 | 5454 | 5544 | 5544 | 5555 |
| every source On, r2 | 5555 | 5555 | 5544 | 5244 | 5555 |
| every source On, r3 | 5554 | 5555 | 5444 | 5543 | 5544 |

**Q2.** What percentage of Chicago restaurant inspections failed last year?

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5554 | 5344 | 5543 | 2444 | 5544 |
| Socrata Ask first, off, r1 | ––55 | ––55 | ––32 | ––43 | ––55 |
| Socrata Ask first, allow, r1 | 5555 | 5344 | 5543 | 5433 | 5554 |
| every source On, r2 | 5555 | 5344 | 5254 | 4131 | 5555 |
| every source On, r3 | 5555 | 5344 | 5552 | 5232 | 5554 |

**Q3.** Show me the 5 most recent fire incidents in San Francisco

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5555 | 5555 | 5243 | 5343 | 5555 |
| every source On, r2 | 5555 | 5555 | 5443 | 5221 | 5555 |
| every source On, r3 | 5555 | 5555 | 5333 | 5221 | 5555 |

**Q4.** What are the top 10 complaint types in NYC 311 data this year?

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5555 | 5353 | 5542 | 5454 | 5444 |
| every source On, r2 | 5555 | 5554 | 5555 | 5544 | 5554 |
| every source On, r3 | 5455 | 5353 | 5544 | 5543 | 5243 |

**Q5.** Which Chicago ward had the most crimes in February 2026?

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5555 | 5555 | 5544 | 4243 | 5554 |
| every source On, r2 | 5555 | 5555 | 5543 | 5231 | 5554 |
| every source On, r3 | 5555 | 5555 | 5543 | 5231 | 4555 |

**Q6.** What's the average building permit cost in Seattle by permit class?

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5545 | 5545 | 5122 | 5233 | 5544 |
| Socrata Ask first, off, r1 | ––54 | ––54 | ––32 | ––43 | ––54 |
| Socrata Ask first, allow, r1 | 5545 | 5545 | 5122 | 4443 | 5555 |
| every source On, r2 | 5545 | 5545 | 5233 | 4443 | 5543 |
| every source On, r3 | 5555 | 5545 | 5544 | 5233 | 5545 |

**Q7.** Compare restaurant inspection grades across NYC boroughs — which borough has the highest percentage of A grades?

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5555 | 5555 | 5234 | 5543 | 5553 |
| every source On, r2 | 5553 | 5555 | 5443 | 5542 | 5552 |
| every source On, r3 | 5554 | 5555 | 5333 | 5221 | 5554 |

**Q8.** What are the highest-paying city jobs in Chicago and how do they compare to the median salary?

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5555 | 5555 | 5343 | 5232 | 4343 |
| every source On, r2 | 5255 | 5555 | 5254 | 2121 | 5554 |
| every source On, r3 | 5454 | 5455 | 5245 | 2111 | 5554 |

**Q9.** Show me the trend in LA 311 requests by month for the past 6 months

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5121 | 4555 | 5232 | 4322 | 4554 |
| every source On, r2 | 5443 | 4553 | 5254 | 5322 | 4254 |
| every source On, r3 | 5443 | 4543 | 5132 | 2322 | 4554 |

**Q10.** What's the crime rate?

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | ––44 | ––55 | ––42 | ––43 | ––55 |
| every source On, r2 | ––55 | ––55 | ––45 | ––44 | ––43 |
| every source On, r3 | ––55 | ––55 | ––45 | ––44 | ––55 |

**Q11.** Show me permit data

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5535 | 5535 | 5232 | ––44 | 5533 |
| every source On, r2 | 5535 | 5535 | ––55 | ––44 | 4534 |
| every source On, r3 | 5535 | 5532 | ––42 | ––32 | 5533 |

**Q12.** How many building permits were issued in the Bronx in 1950?

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5343 | 4245 | 5133 | ––22 | 4343 |
| every source On, r2 | 4255 | 4455 | ––22 | ––22 | 3222 |
| every source On, r3 | 5254 | 4145 | 5244 | ––22 | 4243 |

**Q13.** Show me noise complaints in manhattan from NYC 311

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5555 | 5555 | 5342 | 5131 | 5444 |
| every source On, r2 | 5553 | 5554 | 5132 | 5242 | 5444 |
| every source On, r3 | 5555 | 5433 | 5232 | 5244 | 5455 |

**Q14.** List all active business licenses in Seattle

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5344 | 5455 | 5233 | 4333 | 5453 |
| every source On, r2 | 5454 | 5455 | 5343 | 4333 | 5343 |
| every source On, r3 | 5432 | 5455 | 4344 | 4333 | 5454 |

**Q15.** Compare 311 complaint volumes between NYC and Chicago for the past week

| Configuration | Claude Haiku 5.5 | Claude Sonnet 5.5 | GLM-5.3-Flash | gpt-oss-120b | MiMo-V2.6-Flash |
|---|---|---|---|---|---|
| every source On, r1 | 5555 | ––54 | ––55 | 4533 | 5454 |
| every source On, r2 | 5555 | ––54 | ––54 | 4133 | 4434 |
| every source On, r3 | 5455 | ––54 | 5223 | 4423 | 4435 |
<!-- /table:appendix-scores -->

## Appendix B: the citation failures

<!-- table:appendix-citation -->
| Row | What the check found | Verdict | Note | The reviewer's reason |
|---|---|---|---|---|
| `anthropic/claude-haiku-5.5 Q9 r1 every-source-on` | unaddressed `h73f-gn57`, `i5ke-k6by` | true-positive | — | Names "MyLA311 2025 (`h73f-gn57`)" and "MyLA311 2022 (`i5ke-k6by`)"; every call on both ids failed, so neither was answered. |
| `z-ai/glm-5.3-flash Q9 r1 every-source-on` | unaddressed `h73f-gn57` | true-positive | — | Lists `h73f-gn57` among its sources ("dataset IDs `73a2-6ar5`, `h73f-gn57`, and `ndkd-k878`"), but its only call on that id failed. |
| `anthropic/claude-haiku-5.5 Q12 r1 every-source-on` | unaddressed `bty7-2jhb` | true-positive | catalog-search | names "Historical DOB dataset (`bty7-2jhb`)" but no call queried bty7-2jhb; its only other source is the catalog search "building permits historical", which does not answer an id under the rule as written |
| `anthropic/claude-sonnet-5.5 Q12 r1 every-source-on` | unaddressed `bty7-2jhb` | true-positive | catalog-search | "The city's catalog describes the older companion dataset (`bty7-2jhb`)": no call targets bty7-2jhb, and every answered query is on ipu4-2q9a |
| `z-ai/glm-5.3-flash Q12 r1 every-source-on` | unaddressed `ipu4-2q9a` | true-positive | catalog-search | names "DOB Permit Issuance** (`ipu4-2q9a`" but all three ipu4-2q9a calls failed, and the answer says so ("My queries against the dataset were refused"); refused calls do not count |
| `xiaomi/mimo-v2.6-flash Q12 r1 every-source-on` | unaddressed `rbx6-tga4` | true-positive | catalog-search | lists "DOB NOW: Build – Approved Permits (`rbx6-tga4`)" with "Modern era only (2018+)", but no call queried rbx6-tga4; only ipu4-2q9a and two catalog searches ran |
| `openai/gpt-oss-120b Q13 r1 every-source-on` | 3 artifact(s) (mark) | true-positive | — | The answer carries citation marks "【8†L1-L13】", "【8†L31-L38】" and "【8†L49-L57】", which point to no source on the card; its successful calls were a metadata read and 5-row samples. |
| `anthropic/claude-sonnet-5.5 Q15 r1 every-source-on` | unaddressed `erm2-nwe9`, `ijzp-q8t2` | true-positive | — | Its only call is load_source, yet the answer names "(`erm2-nwe9`) now" as the NYC source and says "`ijzp-q8t2` is crime", a claim about a dataset no call addressed. |
| `z-ai/glm-5.3-flash Q6 r1 socrata-ask-first-off` | unaddressed `76hs-dx3u` | true-positive | — | The answer names "dataset ID 76hs-dx3u", but the card's only call is load_source with loadOutcome "declined", so no call addressed that id. |
| `openai/gpt-oss-120b Q8 r2 every-source-on` | 6 artifact(s) (mark) | true-positive | — | Carries six 【…】 marks, e.g. "【dawh-m56b – employee_dataset_id, SUM(amount)】"; calls did answer dawh-m56b, but the rule counts any 【…】 mark as an artifact. |
| `anthropic/claude-haiku-5.5 Q9 r2 every-source-on` | unaddressed `69nn-wkid` | true-positive | — | Names "The parent dataset (`69nn-wkid`)", whose only call failed; the answer says so ("The system refused that request"), but a refused call is not an answer. |
| `anthropic/claude-sonnet-5.5 Q9 r2 every-source-on` | unaddressed `b7dx-7gc3` | true-positive | — | Offers "a full-year trend ... such as 2024 (`b7dx-7gc3`)"; no call in the row took that id (the catalog call may have listed it, but the card holds no result text). |
| `anthropic/claude-haiku-5.5 Q12 r2 every-source-on` | unaddressed `bty7-2jhb` | true-positive | catalog-search | names "`bty7-2jhb` (Historical DOB Permit Issuance)" as a source, but its only bty7-2jhb call failed ("My attempt to query it failed"); refused calls do not count |
| `anthropic/claude-sonnet-5.5 Q12 r2 every-source-on` | unaddressed `bty7-2jhb` | true-positive | catalog-search | names "the older permit dataset (`bty7-2jhb`)" and says "I didn't query it"; no call addressed that id |
| `xiaomi/mimo-v2.6-flash Q12 r2 every-source-on` | unaddressed `rbx6-tga4`, `e98g-f8hy` | true-positive | catalog-search | its table lists "`rbx6-tga4`" and "`e98g-f8hy`" with coverage claims, but no call targets either id; the only answered query is on ipu4-2q9a |
| `anthropic/claude-sonnet-5.5 Q15 r2 every-source-on` | unaddressed `erm2-nwe9` | true-positive | decline-names-next-id | Its only call is load_source, yet the answer names "from dataset `erm2-nwe9` now"; no call addressed that id (it is offered as the next query, not as a source of figures). |
| `z-ai/glm-5.3-flash Q15 r2 every-source-on` | unaddressed `erm2-nwe9` | true-positive | decline-names-next-id | Its only call is load_source, yet the answer lists "**NYC**: `erm2-nwe9` (311 Service Requests)" as the dataset it would use; no call addressed that id (offered as the next query, not as a source of figures). |
| `openai/gpt-oss-120b Q2 r3 every-source-on` | 2 artifact(s) (mark) | true-positive | — | The answer carries two 【…】 marks, "**19,201**【{"source":"socrata","id":"4ijn-s7e5","detail":"total"}】" and a matching "fail_count" mark; the id itself was answered by two queries, but the rule bars the mark. |
| `openai/gpt-oss-120b Q8 r3 every-source-on` | 10 artifact(s) (mark) | true-positive | — | Carries ten "【exe4‑wf95】" marks in the salary table; calls did answer exe4-wf95, but the marks are artifacts under the rule. |
| `anthropic/claude-sonnet-5.5 Q9 r3 every-source-on` | unaddressed `69nn-wkid` | true-positive | — | Names "a parent dataset, `69nn-wkid`" and says "it declined the request"; its only call on that id failed. |
| `z-ai/glm-5.3-flash Q9 r3 every-source-on` | unaddressed `69nn-wkid` | true-positive | — | States "The current MyLA311 dataset on data.lacity.org is `69nn-wkid`", but all three calls on that id failed. |
| `openai/gpt-oss-120b Q11 r3 every-source-on` | unaddressed `ydr8-5enu`, `i98e-djp9`, `76t5-zqzr`, `h73f-gn57` | true-positive | — | a clarification answer whose only call is load_source, yet it names four ids as fact, two of them wrong (Chicago's "ydr8-5enu" also given to New York City; "for 2025 MyLA311 permits"); the rule has no clarification exemption |
| `anthropic/claude-haiku-5.5 Q12 r3 every-source-on` | unaddressed `rbx6-tga4`, `bty7-2jhb` | true-positive | catalog-search | names "the DOB NOW dataset (`rbx6-tga4`)" and bty7-2jhb, and says "I didn't query the 1989–2013 dataset"; no call addressed either id |
| `anthropic/claude-sonnet-5.5 Q12 r3 every-source-on` | unaddressed `ipu4-2q9a`, `bty7-2jhb`, `rbx6-tga4` | true-positive | catalog-search | all three calls failed ("The data source refused all three of my queries"), so ipu4-2q9a and bty7-2jhb are only refused, and "`rbx6-tga4`" had no call at all |
| `xiaomi/mimo-v2.6-flash Q12 r3 every-source-on` | unaddressed `bty7-2jhb`, `rbx6-tga4` | true-positive | catalog-search | its table lists "`bty7-2jhb`" with "1989–2013 (per dataset description)" and "`rbx6-tga4`", but no call targets either; only ipu4-2q9a was queried |
| `anthropic/claude-sonnet-5.5 Q15 r3 every-source-on` | unaddressed `erm2-nwe9`, `v6vf-nwpd` | true-positive | — | Its only call is load_source, yet the answer names "(`erm2-nwe9`) now" and "`v6vf-nwpd` or whichever current 311 dataset the portal lists", neither addressed by any call. |
<!-- /table:appendix-citation -->

## Appendix C: the providers' terms, verbatim

Text in typographic double quotes is the provider's; text outside them is the reading's description.

<!-- table:provider-quotes -->
**AkashML** (read 2026-11-09; privacy 18:11:53Z; terms 18:11:54Z; OR page 18:11:08Z)

- Pages: Privacy `https://akashml.com/privacy`, “Last updated: June 3, 2026”. Terms `https://akashml.com/terms`, “Last Updated: June 3, 2026”
- Retention: “Prompts and transient API inputs (text, image, audio): not retained beyond the request lifecycle, except for transient error logs deleted within thirty (30) days.” Terms: “The Service utilizes Akash Network's decentralized compute infrastructure, meaning your requests may be processed across multiple independent providers in the network.”
- Training: “We do not use Voice Samples, Voiceprints, user-uploaded images, prompts, generated Outputs, or other User Content to train, fine-tune, or improve any AI model, whether our own or any third party's.”
- Logging and human review: “If a request fails, inputs may be logged briefly by a third-party logging system we use to troubleshoot errors and are deleted in accordance with our retention schedule.” “we may use automated systems and limited human review (under confidentiality and access controls) to detect Outputs and inputs that may violate our Terms of Service or applicable law”
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `akashml/fp4`: same. Source: all-providers JSON; `openrouter.ai/provider/akashml`

**Cohere** (read 2026-11-09; privacy 18:11:54Z; terms 18:11:55Z; commitments 18:15:41Z; OR page 18:11:09Z)

- Pages: Privacy `https://cohere.com/privacy`, “Last Updated: May 1, 2026”. Terms `https://cohere.com/terms-of-use`, “Last updated: September 7, 2022”. Enterprise Data Commitments `https://cohere.com/enterprise-data-commitments` (linked from the privacy policy), “Last Update: December 5, 2025”
- Retention: “We automatically delete logged prompts and generations after 30 days, unless we need it to comply with a legal requirement or customer contract, or unless your usage is flagged as potentially violating our terms, including our Usage Policy (e.g. abuse or misuse of our services).” “If you have been approved for zero data retention, Cohere does not log any customer prompts or generations.” Privacy: “Retention of inputs and outputs on the Platform is generally 30 days for Enterprise Users.”
- Training: “You can opt out from your prompts and generations being used to train Cohere models in your dashboard settings at any time.” Terms of use (2022) grant includes: “IMPROVE AND ENHANCE THE COHERE SOLUTION AND OUR OTHER OFFERINfGS AND BENCHMARK THE FOREGOING” (spelling as published)
- Logging and human review: “If we detect possible misuse of our SaaS Platform, our safety and security teams may review user prompts, generations, and logs to enforce our customer agreements, including our Usage Policy, and secure our services from misuse.”
- OpenRouter's statement: Provider: training false, **retainsPrompts true, retentionDays 30** (docs table: Retained for 30 days). Endpoint `cohere/fp8` for MiMo: **retainsPrompts false**, training false. The two levels differ. Source: all-providers JSON; `openrouter.ai/provider/cohere`

**CoreWeave** (read 2026-11-14; terms, privacy 20:11:21Z; docs index 20:12:20Z; Forge index 20:12:26Z; inference page 20:12:32Z; OR page 20:10:21Z)

- Pages: Terms `https://docs.coreweave.com/policies/terms-of-service`, “Last modified : June 30, 2022”. Privacy `https://docs.coreweave.com/policies/terms-of-service/privacy-policy`, “Last updated on February 24, 2026”. Also searched: the docs index (`llms.txt`), the Forge index, and the Serverless Inference page; none carries a data statement for inference
- Retention: No statement on inference inputs or outputs found. Terms, on Customer Data the customer deletes: “CoreWeave will comply with this instruction as soon as reasonably practicable and within a maximum period of one hundred eighty (180) days.” Privacy scope: “It does not apply to the extent CoreWeave processes personal data solely as a processor or service provider on behalf of its customers.”
- Training: No training sentence on Customer Data. Terms license: “distribute Customer Data solely and exclusively for the purpose of providing the CoreWeave services to Customer.” Privacy (its own controller data): “CoreWeave may use technologies such as artificial intelligence (AI) and machine learning (ML) when processing your data to operate, maintain, improve, and develop our Services.”
- Logging and human review: None found
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `coreweave/nvfp4`: same. Source: all-providers JSON; `openrouter.ai/provider/coreweave`

**Crusoe** (read 2026-11-09; 18:14:35Z (refetch; the 18:11:53Z save was gzip bytes and was replaced); OR page 18:11:08Z)

- Pages: `https://legal.crusoe.ai/open-router` (one page; OpenRouter links its anchors `#managed-inference-tos-open-router` and `#cloud-privacy-policy`). "TOS for OpenRouter Customers" “Version 4.6 (Current)”, “Effective July 23rd 2026”. Data Processing and Security Terms v1.4, “Effective November 9th 2026”. Privacy Notice v1.3, “Effective March 12th 2026”
- Retention: TOS for OpenRouter Customers: “Crusoe does not store Inputs and Outputs to disk, and only processes them as long as necessary to provide Customer with the Services or as otherwise provided in the Data Processing and Security Terms.” Privacy Notice: “This Privacy Notice applies solely to Service Data and does not apply to Customer Data.”
- Training: “We do not use Inputs or Outputs to train Models or improve our Services without Customer’s explicit opt-in consent.”
- Logging and human review: “Crusoe reserves the right to investigate any potential violation of the AUP by Customer, which may include reviewing Customer Applications or Customer Data.”
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `crusoe/bf16` (gpt-oss-120b): same. Source: all-providers JSON; `openrouter.ai/provider/crusoe`

**DeepInfra** (read 2026-11-14; privacy, terms 20:11:21Z; docs 20:12:53Z; OR page 20:10:21Z)

- Pages: Privacy `https://deepinfra.com/privacy`, “Last modified: August 15th 2026”. Terms `https://deepinfra.com/terms`, “Last modified: October 15th, 2026”. Docs `https://docs.deepinfra.com/account/data-privacy` (linked from the privacy policy), no date found
- Retention: Terms: “Provider will not retain, store, or log any Customer Data submitted to or generated by the Services beyond the period strictly necessary to process and return the applicable request, after which such Customer Data is deleted from Provider's systems in the ordinary course of operations” Exceptions include “records Provider is required to retain to comply with applicable laws or to detect, investigate, or respond to fraud, security incidents, or abuse of the Services”. Docs: “When using DeepInfra inference APIs, we do not store the data you submit to our APIs on disk. We only hold it in memory during the inference process. Once inference is complete, the data is deleted from memory.”
- Training: Terms: “Provider will not sell Customer Data, and will not use Customer Data to train, fine-tune, or otherwise improve any model, except as necessary to provide the Services (e.g., fine-tuning a model for Customer's use).” Privacy: “We will not store, sell, or train using this data unless we have your explicit consent.”
- Logging and human review: “We do not log the content of your requests. We log only metadata useful for debugging: request ID, cost, sampling parameters.”
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoints `deepinfra/fp4` (GLM) and `deepinfra/bf16` (gpt-oss): same. Source: all-providers JSON; `openrouter.ai/provider/deepinfra`

**DekaLLM** (read 2026-11-14; EULA 20:11:24Z; privacy (404) 20:11:21Z; privacy (en) 20:13:30Z; OR page 20:10:21Z)

- Pages: OpenRouter's privacy URL `https://www.cloudeka.id/id/privacy-policy/` returned 404. OpenRouter's EULA URL redirected to `https://docs.cloudeka.ai/guideline-for-enterprise/cloudeka-service-portal/end-user-license-agreement`, a page that summarizes the agreements; its "Last updated" element carries “2026-11-04T10:59:12.180Z”. Privacy notice `https://www.cloudeka.id/en/privacy-policy-2/` (linked from that page), no date found; it covers personal data and does not mention model inputs
- Retention: EULA page, summary of the Deka LLM scope of work: “is temporarily stored for operational purposes only, and is permanently deleted according to a defined schedule.” “Our data retention policy is governed by our ISO/IEC 42001:2023 - certified Artificial Intelligence Management System (AIMS) and complies with its applicable requirements and controls.” No period stated
- Training: “Customer data is never used to train models”
- Logging and human review: None found
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `dekallm/bf16`: same. Source: all-providers JSON; `openrouter.ai/provider/dekallm`

**Friendli** (read 2026-11-09; terms, privacy 18:11:52Z; OR page 18:11:07Z)

- Pages: Terms `https://friendli.ai/terms-of-service`, “Last Updated: September 21, 2026”. Privacy `https://friendli.ai/privacypolicy`, “Effective Date: Sep 11, 2025”
- Retention: Terms (Exhibit 1, Friendli Endpoints Services): “FriendliAI will not store, log, or otherwise persist any Customer Inputs or Customer Outputs beyond the duration strictly necessary to process the applicable API request and return a response, unless Customer opts-in to broader retention and use of its Customer Inputs and Customer Outputs through the Product Management Console.” Privacy: “AI inference information: retained for up to one (1) day after the organizations and projects had been deleted.”
- Training: No explicit training sentence. Terms: “FriendliAI will not use the Customer Data, Customer Model Checkpoints, Customer Outputs, Model Improvements, or any other Customer Materials for any purpose other than to provide the Friendli Services on behalf of the Team Owner and Team for which such materials are made available.” Exception in the license grant: “any Customer Materials submitted to or for Friendli Services that are provided free of charge for the purpose of improving, developing, enhancing, and providing FriendliAI’s and its Affiliates’ products and services”
- Logging and human review: The retention sentence covers logging (“store, log, or otherwise persist”). No human-review sentence found
- OpenRouter's statement: Provider: training false, **retainsPrompts true**, no retentionDays (docs table: Prompts are retained for unknown period). Endpoint `friendli` for GLM: same. Source: all-providers JSON; `openrouter.ai/provider/friendli`

**GMICloud** (read 2026-11-14; privacy (404) 20:11:25Z; terms 20:11:26Z; site privacy, legal index 20:13:56Z; legal pages 20:14:02Z to 20:14:03Z; OR page 20:10:21Z)

- Pages: OpenRouter's privacy URL `https://docs.gmicloud.ai/privacy` returned 404. OpenRouter's terms URL (served at `https://www.gmicloud.ai/en/terms-and-conditions`) is website terms (“By accessing and using this website”), no date found; the site privacy notice `/en/privacy-policy` covers site visits (“When you visit the Site, we may collect personal information”), no date found. From the site's Legal page: Privacy `https://www.gmicloud.ai/en/legal/privacy`, “Effective Date: February 26, 2025 (Last Updated)”; MaaS Console Terms of Service `/en/legal/console-terms-of-service`, effective “7th July, 2026”; Prime Inference Services Agreement `/en/legal/prime-inference-services-agreement`, “effective as of the Order Date” (no published date). These pages render client-side; quotes are from the text in their server payload
- Retention: Console ToS: “Unless explicitly opted in to prompt logging, Company does not store Client’s Inputs after categorizing them and does not associate the categorized Inputs with any specific user or organizational accounts.” Privacy: “We retain personal data for as long as necessary to fulfill the purposes outlined in this Privacy Policy, or as required by law.” Prime agreement: no retention period found
- Training: Prime agreement: “Unless otherwise agreed in writing, Company will not use Client Materials, Inputs or Outputs to train Company’s general-purpose models.” Console ToS: “Some AI Models may store or train on Client’s Inputs for improving their own large language models and may allow Client to opt-out of model training, as described in their AI Model Terms.” and a license “to use and host Client’s Inputs in anonymized form, solely for tracking and sharing user metrics on the Site, providing and or improving the Service on an ongoing basis.”
- Logging and human review: Console ToS: “Company uses a hosted model for categorizing Inputs, which does not store or log any Inputs provided to it.” Prime agreement: “Company may process Client Materials, Inputs, Outputs, usage logs and related metadata to provide, secure, monitor, troubleshoot, improve and bill the Services, to detect abuse or security incidents, and to comply with applicable law, this Agreement and the applicable Order.” Privacy: “We automatically log certain usage information when you interact with our LLM endpoints or website.”
- OpenRouter's statement: Provider: training false, **retainsPrompts true**, no retentionDays (docs table: retained for unknown period). Endpoint `gmicloud/bf16`: same. Source: all-providers JSON; `openrouter.ai/provider/gmicloud`

**InferenceNet** (read 2026-11-14; privacy, terms 20:11:26Z; ZDR 20:15:08Z; partner terms 20:15:14Z (a referral program; no data terms); OR page 20:10:22Z)

- Pages: Privacy `https://inference.net/privacy-policy`, “Last updated 01/21/2026”. Terms `https://inference.net/terms-of-service`, “Last updated 01/21/2026”. Zero Data Retention Policy `https://inference.net/zero-data-retention/` (footer link), “Last updated 10/16/2026”
- Retention: ZDR is a team setting: “Any team account on the Inference.net platform can enable ZDR by turning on the Zero Data Retention (ZDR) setting in its team settings.” “For requests from a team with ZDR enabled:” “Customer Content is processed transiently and is not retained after processing of the request is complete.” Exclusion: “ZDR does not apply to: requests not authenticated with an API key belonging to a team that has ZDR enabled”. No retention period found for requests without ZDR
- Training: Privacy: “We do not use your data to train AI models.” ZDR policy (ZDR teams): “Customer Content is not used to train, fine-tune, evaluate or benchmark any model.” Terms license to User Content and Output: “a fully paid, royalty-free, transferable, perpetual, irrevocable, non-exclusive, and worldwide license” including to “make derivative works of all such User Content and Output”
- Logging and human review: ZDR teams: “Customer Content is not logged.” “we retain operational metadata about each request that is not intended to include Customer Content.” No human-review sentence found
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `inference-net/us`: same. Source: all-providers JSON; `openrouter.ai/provider/inference-net` (display name "inference.net")

**KT** (read 2026-11-14; privacy 20:11:27Z; terms 20:11:30Z; OR page 20:10:22Z)

- Pages: Terms `https://tokenfactory.kt.com/terms/service`, “서비스 이용약관 v1.0 · 시행일 2026-10-29” [version 1.0, effective 2026-10-29]. Privacy `https://tokenfactory.kt.com/terms/privacy`, “KT 토큰팩토리 개인정보처리방침 v1.0 · 시행일 2026-10-29” [same date]. Both in Korean
- Retention: Privacy, retention table: “4) 입력한 프롬프트 및 생성결과물 등 목적 항목 보유기간 생성형 AI 응답 생성 및 서비스 제공 입력한 프롬프트·대화 내용, 인공지능 응답 본문·도구 호출 기록 및 출처, 대화 메모리, 첨부 이미지·문서, 이미지·영상 생성 프롬프트 및 생성 결과물 30 일” [prompts and generated results: entered prompts and conversation content, AI response text, tool-call records, conversation memory, attachments; purpose: generating AI responses and providing the service; retention: 30 days]. “외부 AI 모델 연계 프롬프트, 첨부 데이터, 모델 추론에 필요한 기술 정보 추론 처리 완료시까지” [external AI model linkage: prompts, attached data, technical information for inference; until inference processing completes]. Terms Art. 15: “회사가 보관 하는 데이터는 관계 법령상 보관 의무가 있거나 본 약관에서 달리 정한 경우를 제외하고 생성일로부터 1년이 경과하 면 완전히 삭제됩니다.” [data the company retains is completely deleted one year after creation, unless law or these terms provide otherwise]
- Training: No sentence on KT training its own models found in either page. Privacy, on external AI providers: “케이티는 서비스 제공을 위하여 외부 인공지능 사업자에게 전송되는 프롬프트·대화 등 입력 데이터 및 그 결과물이 해당 사업자의 인공지능 모델 학습에 이용되지 않는 조건(기업용 유료 API 이용약관 및 기업용 개인정보 보호정책) 으로 처리되도록 하고 있습니다.” [KT has prompts and other inputs sent to external AI providers, and their results, processed on terms under which they are not used to train those providers' models (enterprise paid API terms and enterprise privacy policies)]
- Logging and human review: Terms Art. 15: “고객 또는 이용자 가 데이터 로깅 기능을 명시적으로 활성화(opt-in) 한 경우에 한하여, 회사는 해당 프롬프트 · 응답 데이터를 서비스 품질 개선 및 오류 분석 목적으로 활용할 수 있습니다.” [only where the customer or user explicitly opts in to data logging may the company use that prompt and response data for service-quality improvement and error analysis]. Art. 14: “회사는 고객 또는 이용자가 제13조 제8항 각 호 또는 외부 정책을 위반한 것으로 합리적으로 의심되는 경우, 관련 법령이 허용하는 범위 내에서 문제가 된 애플리케이션의 구성, 프롬프트 · 응답 로그 등 관련 자료를 조사할 수 있습니다.” [where a violation is reasonably suspected, the company may examine related material, including prompt and response logs, within what law permits]
- OpenRouter's statement: Provider: training false, **retainsPrompts true**, no retentionDays (docs table: retained for unknown period). Endpoint `kt`: same. Source: all-providers JSON; `openrouter.ai/provider/kt`

**Makora** (read 2026-11-09; privacy, terms 18:15:40Z; home 18:11:55Z; OR page 18:11:07Z)

- Pages: Not linked from OpenRouter; read from Makora's home page links. Privacy `https://www.makora.com/privacy-policy`, “Effective date: June 11, 2026 Last updated: June 11, 2026”. Terms `https://www.makora.com/terms-of-service`, “Last updated: 25 June 2026”
- Retention: Tiered: Starter and Developer retained 30 days; “For Developer Pro and Pay-as-you-go, the Service operates in Zero Data Retention mode.” “We do not currently guarantee deletion of cached content within a fixed time window; cached content may remain on the inference host until it is evicted to make room for new data.” “Operational metadata is retained for 12 months and then deleted or aggregated.” Which tier covers OpenRouter traffic is not stated
- Training: Privacy: “Inputs and Outputs are never used to train, fine-tune, evaluate, or otherwise improve any model, ours or a third party’s.” Terms: “We do not use your Inputs, or the Outputs generated for you, to train, fine-tune, evaluate, or otherwise improve any model, whether ours or a third party’s.”
- Logging and human review: “Even on ZDR tiers, automated safety and abuse classifiers may inspect Inputs and Outputs in memory at request time.”
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoints `makora/fp4` (GLM) and `makora/fp8` (MiMo): same. OpenRouter lists **no** privacy or terms URL. Source: all-providers JSON; `openrouter.ai/provider/makora`

**Mistral** (read 2026-11-14; index 20:11:32Z; commercial 20:16:23Z; privacy, additional, partner-served 20:16:24Z; OR page 20:10:22Z)

- Pages: OpenRouter's URLs (`https://mistral.ai/terms/#privacy-policy`, `#terms-of-use`) redirect to the index `https://legal.mistral.ai/terms/get-started/`. Read from it: Commercial Terms of Service `https://legal.mistral.ai/terms/commercial-terms-of-service`, “Effective: September 25, 2026”; Additional Product Terms `.../terms/additional-terms`, “Effective: September 25, 2026”; Privacy Policy `.../terms/privacy-policy`, “Effective: September 3, 2026”. Partner-served deployment terms also read; they cover Mistral products served through “Our cloud provider partners” and resellers
- Retention: Privacy: “Except for specific APIs, we keep your Input and Output for the period necessary to generate the Output and then for thirty (30) rolling days to monitor abuse (unless zero data retention is activated).”
- Training: Commercial terms 4.2: “Mistral AI will not use Customer Data or Outputs to train its artificial intelligence models except (a) when you (i) opted-in to training on a Mistral AI Product set to opt-out by default or (ii) have not opted-out of training on a Mistral AI Product set to opt-in by default” 4.1 license purposes: “providing, maintaining, and optimizing the Mistral AI Products, which includes debugging, assessing, reviewing, and correcting the performance of the Mistral AI Products but excludes model training”. Additional terms: “Mistral AI Products may grant Customer access to technologies developed by third-parties, such as third-party models”
- Logging and human review: “Mistral AI may monitor use of the Mistral AI Products through automated means in accordance with the Usage Policy” Privacy purpose: “To manage and enforce our Terms of Service and licenses, including moderation and abuse monitoring”
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint for GLM-5.3-Flash: slug `mistral` (on the same page most Mistral endpoints, and the GLM 5.3 endpoint, are `mistral/zdr`); values same. Source: all-providers JSON; `openrouter.ai/provider/mistral`

**Modal** (read 2026-11-14; privacy, terms 20:11:32Z; docs 20:17:10Z; OR page 20:10:22Z)

- Pages: Privacy `https://modal.com/legal/privacy-policy`, “Last updated May 17th, 2023”; it states “This page is used to inform website visitors regarding our policies”. Terms (Software as a Service Agreement) `https://modal.com/legal/terms`, “Effective May 2026.” Docs `https://modal.com/docs/guide/security` (linked from the terms), no date found
- Retention: By product (docs table). Servers, Dedicated Endpoints and Shared Endpoints: “Not stored — proxied directly to the serving container” and “Request and response payloads are never written to disk and pass through Modal only as in-flight network traffic.” Functions inputs and outputs: “Up to 7 days, then deleted”. Terms: “Modal retains data as long as the Modal has a need for its use, or to meet regulatory or contractual requirements.” Which Modal product serves OpenRouter traffic is not stated
- Training: No training statement found. Terms: “Customer hereby grants to Modal a limited license to use Customer Data as necessary to provide the Service to Customer.”
- Logging and human review: “While we store app logs and metadata as part of operating the platform, we access them only with your permission, to help troubleshoot an issue.”
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `modal/fp4`: same. Source: all-providers JSON; `openrouter.ai/provider/modal`

**Morph** (read 2026-11-09; privacy, terms 18:11:52Z; OR page 18:11:07Z)

- Pages: Privacy `https://morphllm.com/privacy` (served at `www.morphllm.com/privacy`), “Last Updated: November 9, 2026”, “Version 4.1 (Data Retention Amendment, effective October 23, 2026)”. Terms `https://www.morphllm.com/privacy/tos`, “Last Updated: October 23, 2026”
- Retention: By tier: “We keep Inputs and Outputs only to operate the Services and your own request history, delete them within 30 days, and do not review them in the ordinary course.” (free and paid) and “Full Zero Data Retention is available on enterprise tiers only.” Neither page names OpenRouter, so which tier covers OpenRouter traffic is not stated
- Training: “We do not use your Inputs or Outputs to train, fine-tune, or evaluate our models for any reason, including customer support and debugging.”
- Logging and human review: “Our team does not read your Inputs or Outputs in the ordinary course.” “Prompts our safety classifiers flag as an attempt to compromise systems you do not own are retained past the window above for safety review, abuse investigation, and legal process.”
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `morph/fp8`: same. Source: all-providers JSON; `openrouter.ai/provider/morph`

**Near AI** (read 2026-11-14; privacy 20:11:32Z; terms 20:11:38Z; models 20:17:48Z; OR page 20:10:23Z)

- Pages: Privacy `https://near.ai/privacy-policy`, “Last updated October 12, 2026”. Terms (NEAR AI Cloud Terms of Service) `https://near.ai/terms-of-service`, “Last updated October 29, 2026”. Models page `https://near.ai/models`, no date
- Retention: No retention period for inference content found; terms make it route-dependent: “Hosting, processing location, privacy, security, data-use, retention, availability, attestation, signature, and verification properties may differ among Private TEE Routes, Attested Third-Party Routes, and Incognito Routes.” and “the model or provider name alone does not establish the route used to process a request or the properties applicable to that request.” Incognito Routes: “The Input is transmitted to the third-party provider for processing, and identifiers contained in the Input and technical or safety metadata may also be transmitted.” Models page: “Every open model on NEAR AI Cloud runs inside a hardware-secured TEE.” Privacy (personal data): “We retain Personal Data only for as long as needed to provide and secure the Services, or as required to comply with law.”
- Training: “NEAR AI will not use Customer Data to train any generative AI models.”
- Logging and human review: None found
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `near-ai/fp4`: same. Source: all-providers JSON; `openrouter.ai/provider/near-ai` (display name "NEAR AI")

**OpenInference** (read 2026-11-09; privacy, terms 18:11:51Z; OR page 18:11:07Z)

- Pages: Privacy `https://www.openinference.ai/privacy`, “Updated: June 8, 2026”. Terms `https://www.openinference.ai/terms`, “Last updated: June 8, 2026”
- Retention: Privacy: “We operate the Services on a zero-data-retention basis with respect to the contents of your prompts and the responses generated from them” … “we do not store Customer Content after the response is delivered, do not use it to train or improve any model, and do not sell it or share it with third parties for their own purposes.” Terms: “We process and store Customer Content in accordance with our Privacy Policy.”
- Training: Privacy: as in the retention cell. Terms: “We may also use Customer Content to provide, maintain, develop, and improve the Services, comply with law, enforce our terms, and keep the Services safe.” and “If you do not want us to use your Customer Content to train our models, or to share it with third parties for their business purposes, you may opt out by following the instructions on the Platform.”
- Logging and human review: “We do not collect, log, or retain the contents of your Inputs or Outputs.”
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `open-inference/fp4`: same. Source: all-providers JSON; `openrouter.ai/provider/open-inference`

**Particle AI** (read 2026-11-14; privacy, terms 20:11:38Z; ZDR 20:18:12Z; OR page 20:10:23Z)

- Pages: Privacy `https://particle.ai/privacy/` (served at `/privacy`), “Effective August 25, 2026”. Terms `https://particle.ai/terms/`, “Effective August 25, 2026”. Zero Data Retention policy `https://particle.ai/legal/zero-data-retention` (linked from both), “Effective August 24, 2026”
- Retention: Terms: “For standard synchronous inference, Particle operates under Zero Data Retention” … “by default and does not log or write raw Input or Output to persistent storage.” ZDR policy: “For standard inference, Particle does not intentionally store raw prompts, inputs, responses, or outputs in persistent application storage after a request completes.”
- Training: “Particle does not use Customer Content to train, fine-tune, or improve AI models unless you separately and affirmatively opt in. Accepting these Terms or using the Services is not an opt-in.”
- Logging and human review: Logging: as in the retention cell. “Particle may preserve or disclose information when required by law or reasonably necessary to investigate fraud or unauthorized access, enforce these Terms, or protect Particle, customers, or others. This does not require Particle to retain Customer Content it otherwise does not retain.” No human-review sentence found
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `particle-ai/nvfp4`: same. Source: all-providers JSON; `openrouter.ai/provider/particle-ai`

**PrimeIntellect** (read 2026-11-09; terms, privacy 18:15:40Z; OR page 18:11:08Z)

- Pages: Not linked from OpenRouter; read from the home page links. Terms `https://www.primeintellect.ai/terms-of-service`, last updated “November 4, 2026”. Privacy `https://www.primeintellect.ai/privacy-policy`, updated “February 23, 2024”; it states “This Policy does not apply to Prime's processing when we are a data processor.”
- Retention: No statement on retention of inference inputs or outputs found. License: “solely as necessary to provide, secure and support the Services, to prevent abuse, and to comply with law.” “Serverless inference runs on shared infrastructure, and requests may be processed in any data center we use.”
- Training: “We will not use Customer Content or Output to train, fine-tune or evaluate any machine learning model other than for you, and we will not access Customer Content or Output except as necessary under Section 7.2 or as you instruct.”
- Logging and human review: None found
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `primeintellect/fp4` (gpt-oss-120b): same. OpenRouter lists **no** privacy or terms URL. Source: all-providers JSON; `openrouter.ai/provider/primeintellect`

**Reka** (read 2026-11-14; privacy 20:11:38Z; terms 20:11:39Z; business terms 20:18:46Z; OR page 20:10:23Z)

- Pages: Terms of Use (individual) `https://reka.ai/legal/terms-of-use`, “Last Updated: September 2026”. Privacy `https://reka.ai/legal/privacy-policy`, “Effective as of June 2026.” Business Terms `https://reka.ai/legal/business-terms`, “Effective as of January 2024.”: not linked from the pages read; fetched by URL (saved as `reka-business-terms-guess.html`)
- Retention: No retention period for API content found. Privacy (personal information): “We retain personal information for as long as necessary to fulfil the purposes for which we collected it”
- Training: Terms: “If you use the Services on a free basis, you acknowledge and agree that Reka may use Your Content to train, develop, and improve its machine learning models and related technologies.” “If you make a paid request (i.e., any request made through the API, or through any paid plan of any Service Line, after you have added billing details and made a payment to purchase Usage Credits or a subscription), Reka will not use Your Content for model training unless you have explicitly opted in.” The individual terms also say “If you use the APIs on behalf of a company or for any business or commercial purpose the Reka Business Terms apply instead.” Business Terms: “Customer grants Reka a non-exclusive, worldwide, royalty-free and fully paid license during the Order Term to use the Customer Content as necessary for purposes of providing and/or improving the Services.” and “Customer acknowledges that Reka may compile Aggregated Data based on Customer Content and may use all Aggregated Data to improve Reka’s machine learning model and artificial intelligence algorithms” On third-party models: “Third-Party Models are not Reka Models, and Reka does not develop, train, or control them.”
- Logging and human review: Free basis: “This may include human review and other forms of analysis.” Business Terms: “Reka may monitor Customer’s use of the Services and may prohibit any use of the Services or Software it believes may be in violation of the foregoing warranties or applicable law.”
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `reka`: same. Source: all-providers JSON; `openrouter.ai/provider/reka` (display name "Reka AI")

**Relace** (read 2026-11-14; 404s 20:11:39Z; home 20:19:06Z; privacy, terms 20:19:10Z; ZDR 20:19:11Z; OR page 20:10:23Z)

- Pages: OpenRouter's URLs `https://www.relace.ai/privacy-policy` and `https://www.relace.ai/terms-of-use` returned 404. Read from the home page's footer links: ZDR Policy `https://relace.ai/legal/zero-data-retention-policy`, “This Zero Data Retention Policy is effective as of September 21st, 2026.”; Privacy `https://relace.ai/legal/privacy-policy`, “This Privacy Policy is effective as of September 21st, 2026.”; Terms `https://relace.ai/legal/terms-of-use`, “This Terms of Use Policy is effective as of April 7th, 2025.”
- Retention: Scope: “This Policy applies only to the Platform, meaning Relace’s API-accessible models.” “Relace does not log, persist or otherwise store Covered Data. Covered Data is held only transiently, in memory, for the period of time necessary to process the applicable request and return Output, and is discarded immediately thereafter, subject only to the short-lived prompt caching described below.” Subprocessors: “Relace routes Covered Data only to Subprocessors that are contractually and technically configured to provide zero data retention equivalent to the Zero Retention Commitment above.”
- Training: “Relace does not use Covered Data to train, fine-tune, evaluate or otherwise improve any model, and does not make Covered Data available to any Relace personnel.” Privacy: “excluding content submitted to or generated by our API platform, which is never used for these purposes as described in our Zero Data Retention Policy”
- Logging and human review: As in the retention and training cells (“does not log”; not made available to personnel)
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `relace/fp4`: same. Source: all-providers JSON; `openrouter.ai/provider/relace`

**River** (read 2026-11-14; privacy, terms shell 20:11:39Z; terms chunk 20:19:51Z; OR page 20:10:24Z)

- Pages: Privacy `https://river.ai/privacy-policy`, “Effective October 12, 2026”; it states “This policy does not apply when we process data on behalf of a business customer — for example on our API or enterprise plan — in which case a Data Processing Addendum would apply.” Terms `https://console.river.ai/terms`: the page renders client-side (raw bytes hold an app shell); its text, the "River API Services Agreement" with a Data Processing Addendum as Schedule B, was read from the JavaScript file the page loads, `https://console.river.ai/assets/terms-page-DWi6aIwD-mwfri0yu.js`. No date found in it
- Retention: “The Commercial rules of Section 4.1 are the default and apply to you unless you have contracted with us separately for Testing, which is subject to the rules of Section 4.2.” Commercial: “We retain User Content for up to 2 days after the end of the interaction session.” “For User Content, after 2 days, we permanently delete all copies unless: (i) required by law; (ii) flagged for safety, security, or compliance review (only the minimum necessary data kept); or (iii) explicitly agreed in writing.”
- Training: Commercial: “We will not use your Inputs, Outputs, or User Content to train, fine-tune, or improve our AI models.” DPA: “River will not use Customer-Personal Data to train, fine-tune, retrain, or otherwise develop or improve any artificial intelligence or machine-learning model, whether of River or any third party.”
- Logging and human review: DPA: “including human and automated review of Inputs and Outputs flagged by River's safety systems” Privacy: “Maintain safety, security, and abuse prevention, including automated and human review where appropriate”
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `river`: same. Source: all-providers JSON; `openrouter.ai/provider/river`

**Sail Research** (read 2026-11-09; terms, privacy 18:11:53Z; OR page 18:11:08Z)

- Pages: Terms `https://www.sailresearch.com/terms`, “Last Updated: October 29, 2026”. Privacy `https://www.sailresearch.com/privacy`, “Last Updated: September 15, 2026” (covers the Website)
- Retention: “Customer acknowledges that, as described in the Documentation, Sail may store responses and that the ability to disable such storage is not currently available.” No retention period stated in the pages read
- Training: “Sail will not use Customer Data (including Inputs and Outputs) to train, fine-tune, or improve any artificial intelligence or machine-learning model, except (a) with Customer’s express opt-in consent, or (b) as necessary to provide the Services to Customer at Customer’s direction (such as fine-tuning a model for Customer’s own use).”
- Logging and human review: None found
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `sail-research/fp4` (gpt-oss-120b): same. Source: all-providers JSON; `openrouter.ai/provider/sail-research`

**Together** (read 2026-11-14; privacy, terms 20:11:40Z; OR page 20:10:24Z)

- Pages: Privacy `https://www.together.ai/privacy`, “Updated December 17, 2025”. Terms `https://www.together.ai/terms-of-service`, “Updated May 19, 2026”
- Retention: ZDR is a setting the customer chooses: per the terms, answering No in the Privacy & Security settings when asked whether to store prompts or allow training enables it. Terms: “Under ZDR, your data and outputs are not stored, retained, or used for model training, product improvements, or any other purpose beyond the time required to process the specific request or transaction.” “ZDR applies only from the moment you enable it and does not affect any data processed prior.” No retention period found for use without ZDR
- Training: Privacy: “We do not use any data collected from you to train our models without your explicit opt-in and consent.”
- Logging and human review: None found
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoint `together`: same. Source: all-providers JSON; `openrouter.ai/provider/together`

**Venice** (read 2026-11-14; privacy, terms 20:11:40Z; OR page 20:10:24Z)

- Pages: Privacy `https://venice.ai/legal/privacy-policy`, “Effective: 2 June 2026”. Terms `https://venice.ai/legal/tos`, “Last updated: June 8, 2026”
- Retention: “We may record your actions (e.g., that you created a chat), but we will not have access to or store the content of your Prompts or Outputs.” On the model providers Venice sends prompts to: “We operate a zero data retention policy with our model providers in which our model providers are prohibited from storing, retaining, or using any of your Prompts or Outputs beyond the time strictly necessary to process and return a response.” Terms license: “you grant Venice.ai a worldwide, non-exclusive, irrevocable, perpetual, royalty-free, fully paid right and license (with the right to sublicense through multiple tiers) to host, store, transfer, publicly display”
- Training: “Venice.ai agrees that it shall not use, and shall require that third-party large language model providers” … “do not use, any User Content to train any machine learning, deep learning, or statistical learning algorithms, LLMs, neural networks, or models.”
- Logging and human review: None found
- OpenRouter's statement: Provider: training false, retainsPrompts false. Endpoints `venice` (GLM) and `venice/int4` (gpt-oss): same. Source: all-providers JSON; `openrouter.ai/provider/venice`

**Wafer** (read 2026-11-09; terms 18:11:51Z; security 18:12:26Z; privacy (404) 18:11:51Z; OR page 18:10:39Z)

- Pages: Terms `https://www.wafer.ai/terms`, “Last updated: May 5, 2026”. Security page `https://www.wafer.ai/security`, “Last updated: November 3, 2026”. Privacy: OpenRouter's URL `https://www.wafer.ai/privacy-policy` returned 404; see "What could not be read"
- Retention: “We don't store the prompts or model responses of your inference requests.” “Our central request logs keep this metadata for 365 days.” “Zero Data Retention (ZDR) on every serverless request.”
- Training: No training statement in the terms or security page. Terms: “You grant Wafer a limited license to process your prompts and completions solely as needed to operate, secure, and bill the Service, as described in our Privacy Policy.”
- Logging and human review: “Our inference edge never writes inference request or response bodies to logs, databases or any other storage, for any customer.”
- OpenRouter's statement: Provider: training false, retainsPrompts false (docs table: Zero retention, Does not train). Endpoint `wafer/us` for GLM: same. Source: all-providers JSON; `openrouter.ai/provider/wafer`

**Xiaomi** (read 2026-11-14; shell 20:11:41Z; privacy 20:22:07Z; agreement chunk 20:22:39Z; OR page 20:10:24Z)

- Pages: OpenRouter's URLs are routes inside a client-rendered app (`https://platform.xiaomimimo.com/#/docs/terms/privacy-policy`, `#/docs/terms/user-agreement`); the raw bytes are an app shell. Followed the app's own code: it sends the privacy policy to `https://privacy.mi.com/XiaomiMiMoPlatformos/en_GB/` (international English), “Our Privacy Policy was updated on June 25 , 2026.”; the service agreement is rendered from `https://mimo.mi.com/static/1995.8b548d0e0b571f7c.chunk.js`, “Our Service Agreement was updated on July 7, 2026.” The agreement states that it applies to use of the services outside the People's Republic of China
- Retention: No retention period for API content found. Agreement 4.4: “Upon service expiration, completion of the agreed purpose, or at your request, unless prohibited by laws that Xiaomi must comply with, Xiaomi will cease processing or permanently delete the personal information within a reasonable period.” Privacy: “As a general rule, we retain personal information for the period necessary for the purposes described in this Privacy Policy, or as required by applicable law.” Agreement: “Xiaomi acts as a Processor in data processing activities, and you are the Data Controller.”
- Training: “Xiaomi will not use the content you provide for model training or any other purposes.”
- Logging and human review: None found
- OpenRouter's statement: Provider: training false, **retainsPrompts true, retentionDays 30**, requiresUserIDs true. Endpoint `xiaomi/fp8`: same. Source: all-providers JSON; `openrouter.ai/provider/xiaomi`
<!-- /table:provider-quotes -->

## Appendix D: the open-weight rows and their providers

One line per open-weight row: the providers that served its requests, with the number each served.

<!-- table:appendix-open-weight -->
- `z-ai/glm-5.3-flash Q1 r1 every-source-on`: Wafer 1, River 2
- `openai/gpt-oss-120b Q1 r1 every-source-on`: AkashML 4
- `xiaomi/mimo-v2.6-flash Q1 r1 every-source-on`: Cohere 1, GMICloud 2
- `z-ai/glm-5.3-flash Q2 r1 every-source-on`: River 1, Together 2
- `openai/gpt-oss-120b Q2 r1 every-source-on`: PrimeIntellect 5
- `xiaomi/mimo-v2.6-flash Q2 r1 every-source-on`: GMICloud 4
- `z-ai/glm-5.3-flash Q3 r1 every-source-on`: OpenInference 5
- `openai/gpt-oss-120b Q3 r1 every-source-on`: Crusoe 1, PrimeIntellect 4
- `xiaomi/mimo-v2.6-flash Q3 r1 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q4 r1 every-source-on`: Makora 1, Crusoe 2
- `openai/gpt-oss-120b Q4 r1 every-source-on`: Near AI 5
- `xiaomi/mimo-v2.6-flash Q4 r1 every-source-on`: Cohere 1, Xiaomi 2
- `z-ai/glm-5.3-flash Q5 r1 every-source-on`: Particle AI 1, CoreWeave 2
- `openai/gpt-oss-120b Q5 r1 every-source-on`: AkashML 1, Crusoe 1, Sail Research 5, Near AI 2
- `xiaomi/mimo-v2.6-flash Q5 r1 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q6 r1 every-source-on`: OpenInference 15, Reka 1
- `openai/gpt-oss-120b Q6 r1 every-source-on`: Crusoe 5
- `xiaomi/mimo-v2.6-flash Q6 r1 every-source-on`: Cohere 1, Xiaomi 3
- `z-ai/glm-5.3-flash Q7 r1 every-source-on`: Friendli 1, Particle AI 5
- `openai/gpt-oss-120b Q7 r1 every-source-on`: AkashML 4
- `xiaomi/mimo-v2.6-flash Q7 r1 every-source-on`: Cohere 5
- `z-ai/glm-5.3-flash Q8 r1 every-source-on`: Reka 1, Mistral 8
- `openai/gpt-oss-120b Q8 r1 every-source-on`: Crusoe 1, PrimeIntellect 13
- `xiaomi/mimo-v2.6-flash Q8 r1 every-source-on`: GMICloud 4, Xiaomi 1
- `z-ai/glm-5.3-flash Q9 r1 every-source-on`: Particle AI 9
- `openai/gpt-oss-120b Q9 r1 every-source-on`: PrimeIntellect 10
- `xiaomi/mimo-v2.6-flash Q9 r1 every-source-on`: Cohere 5
- `z-ai/glm-5.3-flash Q10 r1 every-source-on`: InferenceNet 1, Makora 1
- `openai/gpt-oss-120b Q10 r1 every-source-on`: Near AI 2
- `xiaomi/mimo-v2.6-flash Q10 r1 every-source-on`: Cohere 1
- `z-ai/glm-5.3-flash Q11 r1 every-source-on`: CoreWeave 1, InferenceNet 3
- `openai/gpt-oss-120b Q11 r1 every-source-on`: AkashML 1, PrimeIntellect 1
- `xiaomi/mimo-v2.6-flash Q11 r1 every-source-on`: Cohere 2, Xiaomi 2
- `z-ai/glm-5.3-flash Q12 r1 every-source-on`: Makora 1, Mistral 8
- `openai/gpt-oss-120b Q12 r1 every-source-on`: AkashML 1
- `xiaomi/mimo-v2.6-flash Q12 r1 every-source-on`: Cohere 1, Xiaomi 4
- `z-ai/glm-5.3-flash Q13 r1 every-source-on`: Relace 1, InferenceNet 2
- `openai/gpt-oss-120b Q13 r1 every-source-on`: AkashML 1, PrimeIntellect 13
- `xiaomi/mimo-v2.6-flash Q13 r1 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q14 r1 every-source-on`: Modal 1, Reka 3
- `openai/gpt-oss-120b Q14 r1 every-source-on`: PrimeIntellect 4
- `xiaomi/mimo-v2.6-flash Q14 r1 every-source-on`: Cohere 5
- `z-ai/glm-5.3-flash Q15 r1 every-source-on`: Particle AI 2
- `openai/gpt-oss-120b Q15 r1 every-source-on`: Crusoe 6
- `xiaomi/mimo-v2.6-flash Q15 r1 every-source-on`: Cohere 5
- `z-ai/glm-5.3-flash Q1 r1 socrata-ask-first-off`: Wafer 1, River 1
- `openai/gpt-oss-120b Q1 r1 socrata-ask-first-off`: AkashML 2
- `xiaomi/mimo-v2.6-flash Q1 r1 socrata-ask-first-off`: Cohere 2
- `z-ai/glm-5.3-flash Q1 r1 socrata-ask-first-allow`: Wafer 3
- `openai/gpt-oss-120b Q1 r1 socrata-ask-first-allow`: Crusoe 1, Sail Research 2
- `xiaomi/mimo-v2.6-flash Q1 r1 socrata-ask-first-allow`: Cohere 3
- `z-ai/glm-5.3-flash Q2 r1 socrata-ask-first-off`: Cohere 1, Together 1
- `openai/gpt-oss-120b Q2 r1 socrata-ask-first-off`: DekaLLM 1, PrimeIntellect 1
- `xiaomi/mimo-v2.6-flash Q2 r1 socrata-ask-first-off`: Cohere 2
- `z-ai/glm-5.3-flash Q2 r1 socrata-ask-first-allow`: Relace 3
- `openai/gpt-oss-120b Q2 r1 socrata-ask-first-allow`: AkashML 1, PrimeIntellect 3
- `xiaomi/mimo-v2.6-flash Q2 r1 socrata-ask-first-allow`: Cohere 4
- `z-ai/glm-5.3-flash Q6 r1 socrata-ask-first-off`: OpenInference 2
- `openai/gpt-oss-120b Q6 r1 socrata-ask-first-off`: Crusoe 2
- `xiaomi/mimo-v2.6-flash Q6 r1 socrata-ask-first-off`: Cohere 2
- `z-ai/glm-5.3-flash Q6 r1 socrata-ask-first-allow`: OpenInference 17, InferenceNet 1
- `openai/gpt-oss-120b Q6 r1 socrata-ask-first-allow`: DeepInfra 1, Crusoe 3
- `xiaomi/mimo-v2.6-flash Q6 r1 socrata-ask-first-allow`: Cohere 4
- `z-ai/glm-5.3-flash Q1 r2 every-source-on`: CoreWeave 1, Wafer 2
- `openai/gpt-oss-120b Q1 r2 every-source-on`: DekaLLM 1, Sail Research 4
- `xiaomi/mimo-v2.6-flash Q1 r2 every-source-on`: Cohere 3
- `z-ai/glm-5.3-flash Q2 r2 every-source-on`: InferenceNet 5
- `openai/gpt-oss-120b Q2 r2 every-source-on`: DekaLLM 1, PrimeIntellect 7, Crusoe 1
- `xiaomi/mimo-v2.6-flash Q2 r2 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q3 r2 every-source-on`: DeepInfra 1, OpenInference 2
- `openai/gpt-oss-120b Q3 r2 every-source-on`: PrimeIntellect 3
- `xiaomi/mimo-v2.6-flash Q3 r2 every-source-on`: Cohere 5
- `z-ai/glm-5.3-flash Q4 r2 every-source-on`: Makora 1, Crusoe 2
- `openai/gpt-oss-120b Q4 r2 every-source-on`: Venice 1, Near AI 3
- `xiaomi/mimo-v2.6-flash Q4 r2 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q5 r2 every-source-on`: Particle AI 3
- `openai/gpt-oss-120b Q5 r2 every-source-on`: PrimeIntellect 9
- `xiaomi/mimo-v2.6-flash Q5 r2 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q6 r2 every-source-on`: OpenInference 19
- `openai/gpt-oss-120b Q6 r2 every-source-on`: Crusoe 4
- `xiaomi/mimo-v2.6-flash Q6 r2 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q7 r2 every-source-on`: Venice 1, Particle AI 3
- `openai/gpt-oss-120b Q7 r2 every-source-on`: PrimeIntellect 4
- `xiaomi/mimo-v2.6-flash Q7 r2 every-source-on`: Cohere 5
- `z-ai/glm-5.3-flash Q8 r2 every-source-on`: Cohere 1, Mistral 6
- `openai/gpt-oss-120b Q8 r2 every-source-on`: PrimeIntellect 11
- `xiaomi/mimo-v2.6-flash Q8 r2 every-source-on`: Cohere 5
- `z-ai/glm-5.3-flash Q9 r2 every-source-on`: River 7
- `openai/gpt-oss-120b Q9 r2 every-source-on`: AkashML 1, PrimeIntellect 4
- `xiaomi/mimo-v2.6-flash Q9 r2 every-source-on`: Cohere 8
- `z-ai/glm-5.3-flash Q10 r2 every-source-on`: Makora 1
- `openai/gpt-oss-120b Q10 r2 every-source-on`: AkashML 1
- `xiaomi/mimo-v2.6-flash Q10 r2 every-source-on`: Cohere 1
- `z-ai/glm-5.3-flash Q11 r2 every-source-on`: Relace 1, InferenceNet 1
- `openai/gpt-oss-120b Q11 r2 every-source-on`: AkashML 1, PrimeIntellect 1
- `xiaomi/mimo-v2.6-flash Q11 r2 every-source-on`: Cohere 1, Xiaomi 3
- `z-ai/glm-5.3-flash Q12 r2 every-source-on`: Makora 1
- `openai/gpt-oss-120b Q12 r2 every-source-on`: AkashML 1
- `xiaomi/mimo-v2.6-flash Q12 r2 every-source-on`: Cohere 1, Xiaomi 6
- `z-ai/glm-5.3-flash Q13 r2 every-source-on`: InferenceNet 9
- `openai/gpt-oss-120b Q13 r2 every-source-on`: AkashML 1, PrimeIntellect 7
- `xiaomi/mimo-v2.6-flash Q13 r2 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q14 r2 every-source-on`: CoreWeave 1, Reka 3
- `openai/gpt-oss-120b Q14 r2 every-source-on`: PrimeIntellect 4
- `xiaomi/mimo-v2.6-flash Q14 r2 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q15 r2 every-source-on`: OpenInference 2
- `openai/gpt-oss-120b Q15 r2 every-source-on`: Sail Research 5
- `xiaomi/mimo-v2.6-flash Q15 r2 every-source-on`: Cohere 5
- `z-ai/glm-5.3-flash Q1 r3 every-source-on`: Modal 1, Wafer 2
- `openai/gpt-oss-120b Q1 r3 every-source-on`: Venice 1, Sail Research 3
- `xiaomi/mimo-v2.6-flash Q1 r3 every-source-on`: Cohere 3
- `z-ai/glm-5.3-flash Q2 r3 every-source-on`: Relace 1, InferenceNet 2
- `openai/gpt-oss-120b Q2 r3 every-source-on`: Venice 1, PrimeIntellect 4
- `xiaomi/mimo-v2.6-flash Q2 r3 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q3 r3 every-source-on`: InferenceNet 5
- `openai/gpt-oss-120b Q3 r3 every-source-on`: DekaLLM 1, PrimeIntellect 2
- `xiaomi/mimo-v2.6-flash Q3 r3 every-source-on`: Cohere 5
- `z-ai/glm-5.3-flash Q4 r3 every-source-on`: Modal 1, Crusoe 2
- `openai/gpt-oss-120b Q4 r3 every-source-on`: Crusoe 1, Near AI 3
- `xiaomi/mimo-v2.6-flash Q4 r3 every-source-on`: Cohere 12
- `z-ai/glm-5.3-flash Q5 r3 every-source-on`: Cohere 1, Particle AI 2
- `openai/gpt-oss-120b Q5 r3 every-source-on`: Sail Research 6
- `xiaomi/mimo-v2.6-flash Q5 r3 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q6 r3 every-source-on`: Relace 4
- `openai/gpt-oss-120b Q6 r3 every-source-on`: PrimeIntellect 5
- `xiaomi/mimo-v2.6-flash Q6 r3 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q7 r3 every-source-on`: Relace 3
- `openai/gpt-oss-120b Q7 r3 every-source-on`: AkashML 1, PrimeIntellect 11
- `xiaomi/mimo-v2.6-flash Q7 r3 every-source-on`: Cohere 6
- `z-ai/glm-5.3-flash Q8 r3 every-source-on`: Reka 1, Mistral 11
- `openai/gpt-oss-120b Q8 r3 every-source-on`: PrimeIntellect 12
- `xiaomi/mimo-v2.6-flash Q8 r3 every-source-on`: Cohere 6
- `z-ai/glm-5.3-flash Q9 r3 every-source-on`: InferenceNet 10
- `openai/gpt-oss-120b Q9 r3 every-source-on`: Crusoe 1, PrimeIntellect 10
- `xiaomi/mimo-v2.6-flash Q9 r3 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q10 r3 every-source-on`: KT 1
- `openai/gpt-oss-120b Q10 r3 every-source-on`: Crusoe 1
- `xiaomi/mimo-v2.6-flash Q10 r3 every-source-on`: Cohere 1
- `z-ai/glm-5.3-flash Q11 r3 every-source-on`: Relace 1, InferenceNet 1
- `openai/gpt-oss-120b Q11 r3 every-source-on`: Sail Research 2
- `xiaomi/mimo-v2.6-flash Q11 r3 every-source-on`: Cohere 4
- `z-ai/glm-5.3-flash Q12 r3 every-source-on`: Together 1, Mistral 7
- `openai/gpt-oss-120b Q12 r3 every-source-on`: Crusoe 1
- `xiaomi/mimo-v2.6-flash Q12 r3 every-source-on`: Xiaomi 4
- `z-ai/glm-5.3-flash Q13 r3 every-source-on`: OpenInference 7
- `openai/gpt-oss-120b Q13 r3 every-source-on`: DekaLLM 1, PrimeIntellect 4
- `xiaomi/mimo-v2.6-flash Q13 r3 every-source-on`: Xiaomi 7
- `z-ai/glm-5.3-flash Q14 r3 every-source-on`: Cohere 1, Reka 3
- `openai/gpt-oss-120b Q14 r3 every-source-on`: Crusoe 1, PrimeIntellect 3
- `xiaomi/mimo-v2.6-flash Q14 r3 every-source-on`: GMICloud 1, Xiaomi 4
- `z-ai/glm-5.3-flash Q15 r3 every-source-on`: Cohere 1, InferenceNet 7
- `openai/gpt-oss-120b Q15 r3 every-source-on`: AkashML 1, Sail Research 4
- `xiaomi/mimo-v2.6-flash Q15 r3 every-source-on`: Xiaomi 1, GMICloud 5
<!-- /table:appendix-open-weight -->
