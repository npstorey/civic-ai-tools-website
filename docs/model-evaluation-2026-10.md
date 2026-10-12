# Model evaluation, October 2026

This run re-evaluates the app's model roster on the app's own task. It compares nine models: the four
the catalog runs today and five current candidates. The task is answering civic-data questions
through the Socrata MCP server with the shared tool-calling loop, on the 15 test queries used in
March. It ran on 2026-10-11, and every answer was scored against the project's six-dimension rubric
(hub [`docs/research/eval-queries.md`](https://github.com/npstorey/civic-ai-tools/blob/main/docs/research/eval-queries.md)).
The roster change it informs is decided separately (civic-ai-tools-website#573).

## The short version

- **Two of the three models the site offers today fail on its data path.**
  - GPT-5.4, the "premium" choice, sends `query: ""` with every call, and the server refuses that
    (socrata-mcp-server #76). Of its 41 calls, all 38 that carried the empty string were refused; only
    its three catalog searches answered.
  - Gemini 3.5 Flash Lite, the "fastest" choice, made no tool call on 8 of the 11 queries that need
    data. It wrote the guidance's narration line ("Retrieving data...") and stopped, and on one query
    a follow-up turn produced a count no call had returned.
- **Four candidates lead, close together:** Claude Opus 5.5, Claude Sonnet 5.5, Gemini 3.8 Flash and
  Claude Haiku 5.5, with quality scores from 4.54 to 4.73. Opus 5.5 and Gemini 3.8 Flash got the
  main claim right on all 11 graded queries. The gaps among the four are within what one run per
  cell can resolve.
- **Cost per query differs by a factor of about 35 among those four:** Haiku 5.5 about $0.006,
  Gemini 3.8 Flash about $0.045, Sonnet 5.5 about $0.11, Opus 5.5 about $0.21 (OpenRouter prices on
  the run date).
- **GPT-4o, the current "recommended" model,** is the fastest of the working models (median 7.3 s) but
  scores 3.50 on quality. It got 4 of 11 main claims right, and on Q8 it presented a table of salaries
  and job titles that no query returned.
- **The newer models run into the 50,000-token per-query bound:** Gemini 3.8 Flash on 6 of 14 queries,
  Sonnet 5.5 and Haiku 5.5 on 3 each. Their reasoning tokens count toward it.
- **Three answers were cut off at the 2,000-token response limit** this evaluation uses. The site's
  query route sends 4,000.
- **After the server fix, GPT-5.4 and GPT-6.1 Sol were re-run as a separate set** on 2026-10-12. Their
  calls now answer; they score 4.16 and 4.07 on quality, below the four leading candidates.
- **Q3 (San Francisco) is excluded.** Its portal moved, and the server's request to the old address
  downloaded the whole dataset and restarted the hosted server (socrata-mcp-server #75, #77). All nine
  models are compared on the other 14 queries.

## What was run

**The models.** Each control is sent exactly what production sends it: its request settings are read
from the built-in catalog. Each candidate runs at the reasoning setting ruled for the evaluation.
Prices are OpenRouter's, read on the run date, in USD per million input / output tokens.

| Model | Role | Request parameters | Price in / out |
|---|---|---|---|
| `openai/gpt-4o` | control (catalog: recommended) | `max_tokens` 2000 | 2.50 / 10.00 |
| `openai/gpt-5.4` | control (catalog: premium) | `max_tokens` 2000 | 2.50 / 15.00 |
| `google/gemini-3.5-flash-lite` | control (catalog: fastest, summarizer) | `max_tokens` 2000 | 0.30 / 2.50 |
| `anthropic/claude-sonnet-4.6` | control (catalog: notebook default, rank-1 evaluator) | `max_tokens` 2000 | 3.00 / 15.00 |
| `anthropic/claude-sonnet-5.5` | candidate | `max_completion_tokens` 2000, `reasoning_effort` medium | 2.00 / 10.00 |
| `google/gemini-3.8-flash` | candidate | `max_tokens` 2000, `reasoning_effort` medium | 0.75 / 3.75 |
| `anthropic/claude-opus-5.5` | candidate | `max_completion_tokens` 2000, `reasoning_effort` medium | 4.00 / 20.00 |
| `anthropic/claude-haiku-5.5` | candidate | `max_completion_tokens` 2000, `reasoning_effort` low | 0.10 / 0.50 |
| `openai/gpt-6.1-sol` | candidate | `max_completion_tokens` 2000, `reasoning_effort` medium | 2.00 / 10.00 |

- **Price changes ahead.** Gemini 3.8 Flash's price doubles on 2027-01-01, to 1.50 / 7.50. Haiku 5.5
  charges five times as much above 100,000-token prompts, which this evaluation's bound never reaches.
- **Gemini 3.8 Flash sends its limit as `max_tokens`.** OpenRouter's list does not give
  `max_completion_tokens` for it, so the harness says so explicitly.

**The queries.**
- The harness's 15 `TEST_QUERIES` are unchanged from March and pinned by hash in its test.
- Relative dates ("last month", "this year") are read against 2026-10-11.
- Q3 is excluded from scoring for every model ("Q3, excluded" below), which leaves 14 queries and
  126 rows.

**The setting.**
- The harness is [`scripts/eval-models.mjs`](../scripts/eval-models.mjs) at `a12f8b9` (#580). It drives
  the app's own tool-calling loop and MCP client.
- Each model gets one tool, `get_data`, with the app's schema, and the server's skill guidance (26,725
  characters) in the system prompt.
- Limits:
  - 2,000 tokens per response;
  - a 50,000-token bound per query, checked after each tool round, which then forces one answering turn;
  - 10 rounds;
  - 120 seconds per query.
- The source is the hosted Socrata MCP server, version 0.9.1 for every results file. Models are
  reached through OpenRouter.

## Results

| Rank | Model | Role | Quality | Efficiency | Overall | Main claim correct | Avg tokens / query | Median latency | Cost, 14 queries | Budget hits | Cut at 2,000 | Timeouts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Claude Sonnet 5.5 | candidate | 4.63 | 2.40 | **3.96** | 9/11 (+1 partial) | 48,563 | 20.9 s | $1.52 | 3 | 1 | 0 |
| 2 | Claude Haiku 5.5 | candidate | 4.54 | 2.46 | **3.91** | 8/11 (+3 partial) | 49,572 | 14.6 s | $0.08 | 3 | 1 | 0 |
| 3 | Claude Opus 5.5 | candidate | 4.73 | 1.97 | **3.90** | 11/11 (+0 partial) | 43,579 | 27.3 s | $2.88 | 0 | 0 | 0 |
| 4 | Gemini 3.8 Flash | candidate | 4.57 | 1.89 | **3.77** | 11/11 (+0 partial) | 52,307 | 30.6 s | $0.63 | 6 | 1 | 0 |
| 5 | GPT-4o | control | 3.50 | 4.11 | **3.68** | 4/11 (+3 partial) | 22,661 | 7.3 s | $0.83 | 0 | 0 | 0 |
| 6 | Claude Sonnet 4.6 | control | 3.80 | 2.33 | **3.36** | 8/11 (+2 partial) | 35,890 | 27.0 s | $1.59 | 0 | 0 | 1 |
| 7 | Gemini 3.5 Flash Lite | control | 1.91 | 3.96 | **2.53** | 1/11 (+1 partial) | 30,177 | 2.3 s | $0.14 | 4 | 0 | 0 |
| — | GPT-5.4 | control | (3.70) | (3.79) | not ranked (#76) | 0/11 (+1 partial) | 30,425 | 9.7 s | $1.15 | 1 | 0 | 0 |
| — | GPT-6.1 Sol | candidate | (3.34) | (3.89) | not ranked (#76) | 0/11 (+1 partial) | 24,776 | 10.0 s | $0.73 | 0 | 0 | 0 |

How to read it:
- **Quality** is the mean of the four quality dimensions, scored answer by answer, over 14 queries.
- **Efficiency** is the mean of the rubric's relative cost score (on tokens, as in March) and its
  relative latency score.
- **Overall** is 0.7 × quality + 0.3 × efficiency.
- **Main claim correct** counts queries where the answer's main claim matches the reference answer
  (Appendix A). Q10, Q11 and Q15 expect a clarification or a decline and are not graded on it.
- **GPT-5.4 and GPT-6.1 Sol are not ranked:** their rows record #76, not their ability. Both are re-run
  after the server fix; that separate set is reported below, after the run record.
- **The top four are within 0.2 of each other** on quality and overall, and each cell is one run. The
  ranking among them should not be read finer than that.

### By dimension, and with cost in dollars

| Model | Dataset | SoQL | Guidance | Interpretation | Quality | Cost score (tokens) | Cost score (USD) | Latency score | Overall (USD efficiency) |
|---|---|---|---|---|---|---|---|---|---|
| Claude Sonnet 5.5 | 4.71 | 4.64 | 4.64 | 4.50 | 4.63 | 2.43 | 1.79 | 2.36 | 3.86 |
| Claude Haiku 5.5 | 4.79 | 4.50 | 4.57 | 4.29 | 4.54 | 2.29 | 4.64 | 2.64 | 4.27 |
| Claude Opus 5.5 | 4.64 | 4.93 | 4.64 | 4.71 | 4.73 | 2.43 | 1.00 | 1.50 | 3.69 |
| Gemini 3.8 Flash | 4.79 | 4.71 | 4.43 | 4.36 | 4.57 | 2.14 | 3.50 | 1.64 | 3.97 |
| GPT-4o | 4.57 | 3.64 | 3.00 | 2.79 | 3.50 | 4.21 | 3.07 | 4.00 | 3.51 |
| Claude Sonnet 4.6 | 4.14 | 4.14 | 3.71 | 3.21 | 3.80 | 2.86 | 1.50 | 1.79 | 3.16 |
| Gemini 3.5 Flash Lite | 2.29 | 1.64 | 1.93 | 1.79 | 1.91 | 3.71 | 4.43 | 4.21 | 2.63 |
| GPT-5.4 | 4.79 | 1.86 | 4.50 | 3.64 | 3.70 | 3.64 | 2.29 | 3.93 | — |
| GPT-6.1 Sol | 4.36 | 1.86 | 4.00 | 3.14 | 3.34 | 4.07 | 3.29 | 3.71 | — |

Token counts are a poor stand-in for cost when prices differ 40-fold, so the last column repeats
the overall score with the cost dimension scored on dollars. On that basis Haiku 5.5 leads (4.27),
then Gemini 3.8 Flash (3.97) and Sonnet 5.5 (3.86).

### Automatic checks

| Model | Request parameters | Expected dataset answered | Cited | Rows with no tool call | Refused calls | Budget hits | Cut at 2,000 | Largest response (tokens) | Reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|
| GPT-4o | `{"max_tokens":2000}` | 9/11 | 4/11 | 2 | 2 | 0 | 0 | 399 | 0 |
| GPT-5.4 | `{"max_tokens":2000}` | 0/11 | 10/11 | 3 | 38 | 1 | 0 | 312 | 0 |
| Gemini 3.5 Flash Lite | `{"max_tokens":2000}` | 3/11 | 10/11 | 9 | 12 | 4 | 0 | 501 | 0 |
| Claude Sonnet 4.6 | `{"max_tokens":2000}` | 10/10 | 10/10 | 0 | 0 | 0 | 0 | 1393 | 0 |
| Claude Sonnet 5.5 | `{"max_completion_tokens":2000,"reasoning_effort":"medium"}` | 10/11 | 10/11 | 2 | 3 | 3 | 1 | 2000 | 2,884 |
| Gemini 3.8 Flash | `{"max_tokens":2000,"reasoning_effort":"medium"}` | 9/11 | 10/11 | 2 | 3 | 6 | 1 | 1996 | 13,392 |
| Claude Opus 5.5 | `{"max_completion_tokens":2000,"reasoning_effort":"medium"}` | 10/11 | 9/11 | 0 | 0 | 0 | 0 | 1672 | 4,658 |
| Claude Haiku 5.5 | `{"max_completion_tokens":2000,"reasoning_effort":"low"}` | 10/11 | 11/11 | 1 | 3 | 3 | 1 | 2000 | 8,872 |
| GPT-6.1 Sol | `{"max_completion_tokens":2000,"reasoning_effort":"medium"}` | 0/11 | 8/11 | 5 | 22 | 0 | 0 | 324 | 844 |

- **"Expected dataset answered"** means a call to the query's expected dataset was answered rather
  than refused. It is not a correctness grade.
- **Two expected datasets mislead the check, so read the rubric scores for those queries:**
  - Q9's is stale: `h73f-gn57` ends in November 2025, and the 2026 data is in `2cy6-i7zn`.
  - Q12 accepts a second dataset, `ipu4-2q9a`, which the check does not know.

## Findings

1. **GPT-5.4 and GPT-6.1 Sol cannot use the site's data tool today.**
   - Both fill every optional argument of `get_data`. The server refuses a call whose `query` is an
     empty string, though the schema the model is shown allows it (socrata-mcp-server #76).
   - **GPT-5.4:** of 41 calls, all 38 that carried `query: ""` were refused, including every data,
     metadata and metrics call. The three catalog searches, which carry a real query, answered.
   - **Sol:** 22 of 27 calls were refused on the same ground.
   - Both reported the failure honestly rather than inventing data.
   - The site sends the same schema, so production's premium model is affected today.

2. **Gemini 3.5 Flash Lite mostly does not call the tool.**
   - It made no call on 8 of the 11 queries that need data (Q1, Q2, Q4, Q6, Q7, Q8, Q12, Q13).
   - Each response ended normally (`finish_reason: stop`) after the plan the guidance asks for, often
     with the narration line "Retrieving data...".
   - On Q1, the loop's follow-up answering turn produced 284,527 complaints; the reference is 323,627.
   - The site sends the same guidance, and this is the model the site offers as "fastest" and uses to
     draft summaries.

3. **The four leading candidates are accurate, and differ mainly in cost and speed.**
   - Opus 5.5 got every graded main claim right and had the most careful caveats.
   - Gemini 3.8 Flash also got all 11 right. It was the only model whose first run of Q9 queried LA's
     2026 dataset.
   - Sonnet 5.5 and Haiku 5.5 were close behind on quality. Haiku 5.5 costs about a twentieth of
     Sonnet 5.5 per query and was the fastest of the four (median 14.6 s).

4. **GPT-4o is fast and cheap per query, and makes more mistakes.**
   - Q8: it sorted salaries without excluding hourly staff, whose salary field is empty. It then
     presented five job titles and salaries that appear in none of its results and are not in the
     dataset, plus a median taken from a truncated 32,016-row pull.
   - Q7: it divided by inspections with no grade.
   - Q2: it reported all facility types as restaurants.

5. **The 50,000-token bound binds on the newer models** (table below).
   - Reasoning tokens are reported inside `completion_tokens`, and `total_tokens` equals prompt plus
     completion. The bound sums `total_tokens`, so reasoning counts toward it.
   - When the bound trips, the loop forces one answering turn. Most such rows still answered well.
   - A row can also end above 50,000 without the bound tripping, when the request that crosses it is
     the last.
   - The bound is March's. The site's query route allows 200,000 tokens per request, so the bound
     constrains this evaluation more than it constrains visitors.

   | Model | Query | Total tokens | Cap triggered (forced answer) |
|---|---|---|---|
| Claude Haiku 5.5 | Q8 | 123,121 | yes |
| Claude Haiku 5.5 | Q9 | 86,196 | yes |
| Claude Haiku 5.5 | Q12 | 57,020 | no (crossed on the last request) |
| Claude Haiku 5.5 | Q14 | 74,849 | yes |
| Claude Opus 5.5 | Q12 | 74,053 | no (crossed on the last request) |
| Claude Sonnet 4.6 | Q10 | 53,673 | no (crossed on the last request) |
| Claude Sonnet 4.6 | Q13 | 55,838 | no (crossed on the last request) |
| Claude Sonnet 4.6 | Q14 | 50,727 | no (crossed on the last request) |
| Claude Sonnet 5.5 | Q9 | 107,964 | yes |
| Claude Sonnet 5.5 | Q12 | 107,683 | yes |
| Claude Sonnet 5.5 | Q14 | 82,034 | yes |
| Gemini 3.5 Flash Lite | Q5 | 67,435 | yes |
| Gemini 3.5 Flash Lite | Q9 | 79,967 | yes |
| Gemini 3.5 Flash Lite | Q10 | 67,593 | yes |
| Gemini 3.5 Flash Lite | Q14 | 66,957 | yes |
| Gemini 3.8 Flash | Q2 | 65,720 | yes |
| Gemini 3.8 Flash | Q6 | 62,288 | no (crossed on the last request) |
| Gemini 3.8 Flash | Q7 | 67,829 | yes |
| Gemini 3.8 Flash | Q8 | 69,074 | yes |
| Gemini 3.8 Flash | Q9 | 85,343 | yes |
| Gemini 3.8 Flash | Q12 | 74,121 | yes |
| Gemini 3.8 Flash | Q13 | 55,689 | no (crossed on the last request) |
| Gemini 3.8 Flash | Q14 | 76,654 | yes |
| GPT-5.4 | Q7 | 77,146 | yes |
| GPT-5.4 | Q8 | 50,214 | no (crossed on the last request) |
| GPT-5.4 | Q9 | 58,513 | no (crossed on the last request) |
| GPT-6.1 Sol | Q6 | 54,238 | no (crossed on the last request) |

6. **Three answers were cut off at the 2,000-token response limit:** Sonnet 5.5 on Q14, Gemini 3.8
   Flash on Q7, and Haiku 5.5 on Q7.
   - Each was the final answer. Two came after the bound forced an answering turn, and Haiku spent
     1,149 of its 2,000 tokens on reasoning.
   - They are scored as the reader received them.
   - The site's query route sends 4,000 per response, so production would not cut these answers.

7. **Q9 (Los Angeles) timed out on five rows across four models, counting the separate set, and Sonnet 4.6 never completed it.**
   - The rows: gpt-4o in the first run, Opus 5.5 and Sonnet 4.6 in the resumed run, Sonnet 4.6 again
     on its re-run, and GPT-5.4 in the separate set on the fixed server.
   - Each time, the model's first request answered in about a second and asked for one or two tool
     calls, and a call stayed open past the 120-second limit.
   - On Sonnet 4.6's re-run, the call took 129 seconds and returned 347 bytes.
   - The likely mechanism: the server tries a portal request up to four times at 30 seconds each, so a
     slow portal query holds a call for about two minutes. A keyless call to the same dataset at 18:27Z
     waited 136 seconds for the server's own message, "API request timed out after 30s (retried 3
     times)". Filed as socrata-mcp-server #79.
   - The timed-out rows do not record their tool calls' arguments, so the mechanism is likely but
     unproven for them.
   - gpt-4o and Opus 5.5 answered on re-run. Sonnet 4.6 timed out again, and that counts as its result.

## What the probe settled

Before the run, a probe ran two candidates on two queries, then sent recorded tool results to both
Google models with GPT-4o as the control (`scripts/eval-results-probe-20261011T192824Z.json`).

- **A portal named per call is honoured.**
  - Keyless calls answered on Chicago, Seattle and Los Angeles, and Gemini 3.8 Flash answered Q2
    through the Chicago portal end to end.
  - San Francisco fails (#75).
- **The empty-query refusal** (#76) first showed here, on Sol.
- **Reasoning counts toward the bound** (finding 5), and no probe response was cut at 2,000.
- **The site's Socrata results reach Google models whole.**
  - An earlier measurement found that a tool result whose text holds a JSON object reaches a Google
    model through OpenRouter as that object alone.
  - The site's Socrata results are pure JSON: a `{"data": [...]}` envelope for queries and a bare
    array for catalog searches. Both arrived whole on both Google models.
  - The test can fail: the server's guidance sent as a tool result (one embedded JSON object) was lost
    on both, and arrived whole on the control.
  - Data Commons and Boston results were not measured. The probe's environment had no Data Commons
    key (the source answered 401) and no Boston address.

## Faults in the environment

- **San Francisco's portal moved, and the server's request to the old address is unbounded.**
  - `data.sfgov.org` answers 301, redirecting to `data.sf.gov`. On the redirect the server's POST to the
    query endpoint becomes a GET without its body, which streams the whole fire-incidents dataset
    (733,061 rows; 142.8 MB in the first 8 seconds, unbounded).
  - The hosted server restarted on memory three times during the run, at about 19:38, 19:45 and
    19:48 UTC, each after a Q3 call.
  - Rows that ran during a restart failed fast, and were re-run (below).
  - Filed as socrata-mcp-server #75 and #77 (unbounded responses, row limits, whole results logged).
- **Q3, excluded.**
  - No model could reach Q3's data through its portal. The SF query endpoint also took the shared
    server down.
  - Q3 is re-run for all nine after the server fix. A source refusal reaches the model as fixed text
    that names no host, so the guidance must change as well before the re-run means anything.
- **The empty-query refusal** (#76): finding 1. Fixed on 2026-10-11 (socrata-mcp-server #78); see the separate set.
- **Server response metadata.**
  - The server's query envelope carries `is_sample: true` (seen on a 12-row query in the recorded
    fixtures). Models reported the flag on aggregate results too, and one reported `has_more: true`
    on a result with fewer rows than its limit.
  - Haiku 5.5 hedged exact counts because of the flag. Neither changed a score.
- **The rubric's own data.**
  - Q9's expected dataset (`h73f-gn57`) ends in November 2025.
  - Q12's dates are text fields in MM/DD/YYYY, so a date comparison on them compares strings. One
    model (Sonnet 4.6) fell into that, and reached the right answer by accident.
  - Both are scored against the reference answers in Appendix A.

## Run record

All files are in `scripts/` on the evaluation machine; they are gitignored. Each ran with the harness
at `a12f8b9`, Node 22.23.1, against the hosted server's 0.9.1 release build (`014c9a4`, merged at
18:28 UTC). Every October row finished (21:19:50 UTC) before the server's next merge (`cdea8c5`, 22:01
UTC). That later build still reports version 0.9.1, so the two builds are told apart by how `get_data`
describes `limit`. The October build says "…or "all" to fetch all available data"; the fixed build says
it returns "at most 10,000 rows per call". The separate set below ran on the fixed build.

| Results file | Started (UTC) | Rows | Charged |
|---|---|---|---|
| `eval-results-run-20261011T193446Z.json` | 19:34:46 | 51 | $2.96 |
| `eval-results-run-20261011T195739Z.json` | 19:57:39 | 70 | $5.94 |
| `eval-results-run-20261011T202418Z.json` | 20:24:18 | 11 | $1.53 |
| `eval-results-run-20261011T203124Z.json` | 20:31:24 | 6 | $0.08 |
| `eval-results-run-20261011T203245Z.json` | 20:32:45 | 1 | $0.08 |
| `eval-results-run-20261011T211642Z.json` | 21:16:42 | 1 | $0.04 |
| `eval-results-run-20261011T211649Z.json` | 21:16:49 | 1 | $0.21 |
| `eval-results-run-20261011T211748Z.json` | 21:17:48 | 1 | $0.21 |

- **Stopped at 51 rows:** the first file, when the Q3 restarts became clear.
- **The rest:** a resumed run with Q3 excluded, then single re-runs of every row that a restart spoiled
  or that timed out.
- **Superseded rows:** where a row was re-run, the later row is the one scored. These were replaced:

| Model | Query | Replaced row | Re-run in |
|---|---|---|---|
| claude-sonnet-4.6 | Q4 | 3 call(s) failed "unavailable" during a server restart | `eval-results-run-20261011T202418Z.json` |
| claude-sonnet-4.6 | Q5 | 1 call(s) failed "unavailable" during a server restart | `eval-results-run-20261011T202418Z.json` |
| gemini-3.5-flash-lite | Q4 | 3 call(s) failed "unavailable" during a server restart | `eval-results-run-20261011T203124Z.json` |
| gemini-3.5-flash-lite | Q5 | 2 call(s) failed "unavailable" during a server restart | `eval-results-run-20261011T203124Z.json` |
| gemini-3.5-flash-lite | Q7 | 2 call(s) failed "unavailable" during a server restart | `eval-results-run-20261011T203124Z.json` |
| gemini-3.5-flash-lite | Q9 | 4 call(s) failed "unavailable" during a server restart | `eval-results-run-20261011T203124Z.json` |
| gemini-3.5-flash-lite | Q10 | 3 call(s) failed "unavailable" during a server restart | `eval-results-run-20261011T203124Z.json` |
| gemini-3.5-flash-lite | Q11 | 1 call(s) failed "unavailable" during a server restart | `eval-results-run-20261011T203124Z.json` |
| gpt-4o | Q9 | Timed out after 120s | `eval-results-run-20261011T203245Z.json` |
| gpt-4o | Q5 | 1 call(s) failed "unavailable" during a server restart | `eval-results-run-20261011T211642Z.json` |
| claude-opus-5.5 | Q9 | Timed out after 120s | `eval-results-run-20261011T211649Z.json` |
| claude-sonnet-4.6 | Q9 | Timed out after 120s | `eval-results-run-20261011T211748Z.json` |

**Spend:** $11.05 across the eight run files, plus $0.25 for the probe: **$11.30** in all.

## Method

- **Reference answers.** Each query's correct answer on the run date was read directly from the
  portal's SODA API, with no model and no MCP server (Appendix A). Where a query is ambiguous, every
  reasonable reading is given.
- **Scoring.** Each answer was scored individually; the scorers were models, not people.
  - Five scorers (Claude Opus 5.5) each scored a set of queries across all nine models, from the same
    brief. The brief covers the rubric, the reference answers, and rules for refused calls,
    fabrication and the two stale expectations.
  - Scoring a query across all nine models at once keeps the same behaviour at the same score.
  - Three rows from the run's last re-runs were scored against the Q5 and Q9 scorer's calibration
    notes.
- **Reconciliation.** Three scores were changed so that one rule applies throughout:
  - Gemini 3.5 Flash Lite on Q12 and Q13: dataset 3 → 1, since no call was made.
  - Sonnet 4.6 on Q15: guidance and interpretation 1 → 2. It made a cross-portal query against the
    guidance, and its headline rested on labelled outside population figures, treated as Opus 5.5's
    disclosed figures on Q10 were.
- **Spot checks.** The most severe scores were checked against the run files and the portals. For
  example, GPT-4o's Q8 table was confirmed as not in the dataset, and the answers with no tool call
  were confirmed to have no call in the request records.
- **Cost.** Cost is scored on tokens, as the rubric defines it and as March did, and shown again in
  dollars at the run date's prices.
- **Limits.**
  - One run per model and query.
  - Fourteen queries, all through one tool on Socrata portals.
  - Scores from model scorers, checked but not independently double-scored.
  - A 2,000-token response limit where the site sends 4,000.

## Compared with March

March ([`docs/research/model-evaluation-results.md`](https://github.com/npstorey/civic-ai-tools/blob/main/docs/research/model-evaluation-results.md)
in the hub) ranked GPT-4o first and recommended it as the default. It scored only GPT-5.4 query by
query and estimated the rest. The queries are the same, but the server, its guidance, the loop and
most of the models have changed since, so the two runs are not a trend line.

What carries over is GPT-4o's place: still among the fastest, and now well behind the current
candidates on quality. GPT-5.4 scored 4.37 on quality in March and cannot use the data tool today.

## The separate set on the fixed server (2026-10-12)

**Why it ran.** On the October server, GPT-5.4 and GPT-6.1 Sol could not use the data tool: the server refused the empty `query` both send with every call (socrata-mcp-server #76). The fix merged as `cdea8c5` on 2026-10-11 at 22:01 UTC (socrata-mcp-server #78) and was live on the hosted server from 22:04 UTC. Both models were then re-run on the same 14 queries.

**What differs from the October rows.** The harness, its requests and the queries are the same (`a12f8b9`). The server is the newer build:
- one `get_data` call returns at most 10,000 rows;
- responses are bounded;
- an empty `query` is treated as absent.

The run was also a day later (2026-10-12, 12:17-12:28 UTC). NYC 311's newest row at the time was from 2026-10-10, so day-relative counts moved slightly. These rows are therefore a separate set, placed beside the October nine only as an indication.

**Results** (`eval-results-run-20261012T121705Z.json`, 28 rows, $1.92, scored against the same reference answers and calibrated against the October scores for the same queries):

| Model | Quality | Overall (indicative) | Main claim correct | Avg tokens / query | Median latency | Cost per query | Budget hits | Cut at 2,000 | Timeouts |
|---|---|---|---|---|---|---|---|---|---|
| GPT-5.4 | 4.16 | 3.93 | 7/11 (+3 partial) | 23,406 | 16.9 s | ~$0.062 | 0 | 0 | 1 (Q9) |
| GPT-6.1 Sol | 4.07 | 3.79 | 7/11 (+1 partial) | 28,342 | 19.0 s | ~$0.063 | 1 | 1 | 0 |

- **The fix works.** All 30 of GPT-5.4's calls still sent `query: ""`, and 28 answered; the other 2 were refused for their own syntax. All 27 of Sol's calls answered.
- **Placement.** On quality, both sit below the four leading candidates (4.54 to 4.73) and above Claude Sonnet 4.6 (3.80) and GPT-4o (3.50). The "overall" column scores cost and latency against the October nine on the same queries, so it is indicative only: the server differs.
- **GPT-5.4** answered every query it ran with the right dataset (10 of 10). It lost points on denominators and caveats (Q2, Q7, Q8) and timed out on Q9.
- **GPT-6.1 Sol** answered six queries at the top models' level (5/5/5/5). On three data queries (Q4, Q7, Q9) it made no call and said, without testing, that the query would exceed the demo's limits.
- **Neither result changes the ruled roster.** The per-row scores are in Appendix D.

## Still owed

- Q3 for all nine models, once the server's guidance names San Francisco's new portal host. Until then, a source refusal reaches the model as fixed text that names no host, so the model cannot recover from it.

## Appendix A: reference answers

Read 2026-10-11, about 19:30-19:45Z, straight from each portal's SODA API: public reads, no key, no model, no MCP server. Each value is what a correct analysis returns on the run date. Where the query is ambiguous, every reasonable reading is given. "The server" is the hosted Socrata MCP server the run used (0.9.1).

### Q1. "How many 311 complaints were filed in NYC last month?" (expected `erm2-nwe9`)
- "Last month" means September 2026.
- `count(*) WHERE created_date >= '2026-09-01T00:00:00' AND created_date < '2026-10-01T00:00:00'` returns **323,627**.

### Q2. "What percentage of Chicago restaurant inspections failed last year?" (expected `4ijn-s7e5`)
- **Calendar 2025, facility_type = Restaurant (case-insensitive):**
  - Pass 7,198; Fail 2,423; Pass w/ Conditions 1,805; No Entry 1,239; Out of Business 889; Not Ready 309; Business Not Located 1. Total 13,864.
  - Fail over all rows: **17.5%**.
  - Fail over completed inspections (Pass + Fail + Pass w/ Conditions = 11,426): **21.2%**.
- **Trailing 12 months (since 2025-10-11), restaurants:**
  - Pass 6,139; Fail 2,043; Pass w/ Conditions 1,554; No Entry 959; Out of Business 729; Not Ready 319.
  - Fail over all rows 17.4%; over completed inspections **21.0%**.
- **All facility types, 2025:** Fail 3,391 of 19,205 = 17.7%.
- Acceptable answers state which year and which denominator they used. "Restaurant" must filter `facility_type`, which is mixed case.

### Q3. "Show me the 5 most recent fire incidents in San Francisco" (expected `wr8u-xric`)
- **The query's portal no longer works.** `data.sfgov.org` answers 301, redirecting to `data.sf.gov`, and the server's data query does not follow the redirect. It answers "API request failed: 200 - OK / Data: undefined" (socrata-mcp-server #75).
- So no model can reach the data through the server at `data.sfgov.org`. A model that names `data.sf.gov` itself would reach it.
- **On data.sf.gov,** the most recent rows with an alarm time (ordered by `alarm_dttm DESC`; one junk row without `alarm_dttm` sorts first) are:
  - 26135803 (2026-09-24, 255 Woodside Ave, assist invalid);
  - 26134940 (2026-09-22, Fulton St, false alarm);
  - 26134283 (2026-09-21, 2245 Jones St, alarm malfunction);
  - 26122251 (2026-08-29, 240 Turk St, service call);
  - then older rows.
- A correct answer here is an honest report that the data could not be retrieved. A table of incidents with no successful call behind it is fabrication.

### Q4. "What are the top 10 complaint types in NYC 311 data this year?" (expected `erm2-nwe9`)
- 2026-01-01 to the run date: Illegal Parking 486,367; Noise - Residential 292,189; HEAT/HOT WATER 219,371; Blocked Driveway 151,865; Noise - Street/Sidewalk 149,584; UNSANITARY CONDITION 110,271; Street Condition 109,272; PLUMBING 67,635; Abandoned Vehicle 58,549; Dirty Condition 57,636.
- The direct query took 68 s, so a model's query can time out.

### Q5. "Which Chicago ward had the most crimes in February 2026?" (expected `ijzp-q8t2`)
- `date` in [2026-02-01, 2026-03-01): **ward 27, 732 crimes**. Then ward 28 (707), 4 (603), 6 (588), 24 (564).

### Q6. "What's the average building permit cost in Seattle by permit class?" (expected `76t5-zqzr`)
- The cost field is `estprojectcost` (estimated project cost). There is no `value` field.
- **All rows,** average by `permitclass`: Multifamily $5.74M (n 21,857); Industrial $4.73M (2,623); Institutional $4.35M (5,748); Commercial $1.64M (43,267); Vacant Land $763K (474); N/A $482K (6,941); Single Family/Duplex $176K (112,695).
- **Applied since 2025-10-11:** Industrial $4.87M (96); Multifamily $3.53M (530); Institutional $3.25M (195); Commercial $763K (1,097); Single Family/Duplex $253K (4,446); Vacant Land $231K (16).
- Guidance asks for a date filter on a large dataset. Either window is acceptable if stated. Averages are skewed by large projects, which is a caveat worth giving.

### Q7. "Compare restaurant inspection grades across NYC boroughs — which borough has the highest percentage of A grades?" (expected `43nn-pn8j`)
- **All inspection rows graded A, B or C,** A share by `boro`:
  - Staten Island **78.9%** (n 4,226)
  - Manhattan **78.8%** (48,256)
  - Brooklyn 76.6% (32,355)
  - Bronx 74.4% (12,677)
  - Queens 71.3% (31,377)
  - a junk `boro` value "0" (149 rows)
- Staten Island and Manhattan are within 0.1 point, so the winner depends on method. Other methods move the result: grades N, Z or P included, or the latest inspection per restaurant. A correct answer states its method. Naming either Staten Island or Manhattan with the margin shown is right; naming Manhattan or Staten Island as a clear winner without the margin is incomplete.

### Q8. "What are the highest-paying city jobs in Chicago and how do they compare to the median salary?" (expected `xzkq-xp2w`)
- `salary_or_hourly` is 'SALARY' (24,918 rows) or 'HOURLY' (7,098), upper case.
- **Top salaried:** Commissioner of Aviation $360,504; Fire Commissioner $257,268; Corporation Counsel $243,972; Commissioner of Streets and Sanitation $234,828; Commissioner of Water Management $234,828.
- **Median annual salary of salaried employees: $115,158.** The average is $116,079.
- A correct answer separates or discloses hourly employees, whose `annual_salary` is empty.

### Q9. "Show me the trend in LA 311 requests by month for the past 6 months" (expected `h73f-gn57`)
- **The expected dataset is stale for this query.** `h73f-gn57` ("MyLA311 Service Request Data 2025") covers 2025-01-01 to 2025-11-03 (423,053 rows), so it has no data for the past 6 months.
- The 2026 data is in `2cy6-i7zn` ("MyLA311 Cases 2026", `createddate`), covering 2026-01-01 to the run date. Its monthly counts are: Apr 199,584; May 189,333; Jun 202,377; Jul 195,202; Aug 213,023; Sep 213,320; Oct (to the 11th) 64,363.
- **Scoring:**
  - Best: a model that finds `2cy6-i7zn`.
  - Acceptable: a model that uses `h73f-gn57` and says plainly that it ends in November 2025.
  - Wrong: a model that presents 2025 months as "the past 6 months".

### Q10. "What's the crime rate?" (portal NYC)
- Should ask one clarifying question: which city or area, what period, rate or counts.
- "Rate" per capita needs population data that is not in Socrata.
- Making no tool call, or a minimal one, is right.

### Q11. "Show me permit data" (portal Chicago)
- Should ask which kind of permit (building, business licence, other) and what period. The portal (Chicago) is already given.
- Asking which city misses the ambiguity.

### Q12. "How many building permits were issued in the Bronx in 1950?" (expected `ic3t-wcy2`, or `ipu4-2q9a`)
- `ic3t-wcy2` (DOB Job Application Filings) begins in 2000.
- Its date fields (`pre__filing_date`, `latest_action_date`, `signoff_date`) are TEXT in MM/DD/YYYY. A SoQL comparison such as `pre__filing_date < '1951-01-01'` compares strings and returns nonsense (232,293 rows for the Bronx).
- **Correct answer: no records for 1950;** the data does not go back that far. Any non-zero count for 1950 is wrong.

### Q13. "Show me noise complaints in manhattan from NYC 311" (expected `erm2-nwe9`)
- **Last 30 days** (`created_date >= 2026-09-11`), `upper(complaint_type) LIKE '%NOISE%' AND upper(borough) = 'MANHATTAN'`: **17,063**.
- The lowercase literal `complaint_type LIKE '%noise%' AND borough = 'manhattan'` returns **0**: the case-sensitivity trap.

### Q14. "List all active business licenses in Seattle" (expected `wnbq-64tb`)
- 84,978 rows.
- Should not try to return them all. It should show a bounded page, state the total, and offer the next page or filters.

### Q15. "Compare 311 complaint volumes between NYC and Chicago for the past week" (portal NYC)
- On the web, guidance says to decline cross-portal comparisons. It should suggest one city at a time, or the CLI.
- Running both portals anyway is a guidance violation, even if the numbers are right.

## Appendix B: scores per row

Each cell gives dataset, SoQL, guidance and interpretation (1-5 each), then ✓ (main claim correct),
~ (partly correct) or ✗ (wrong). No mark means the query is not graded for correctness.

| Query | gpt-4o | gpt-5.4 | gemini-3.5-flash-lite | claude-sonnet-4.6 | claude-sonnet-5.5 | gemini-3.8-flash | claude-opus-5.5 | claude-haiku-5.5 | gpt-6.1-sol |
|---|---|---|---|---|---|---|---|---|---|
| Q1 | 5533✓ | 5154✗ | 1111✗ | 5544✓ | 5555✓ | 5555✓ | 5555✓ | 5555✓ | 5143✗ |
| Q2 | 5332~ | 5154✗ | 1121✗ | 5443~ | 5344~ | 5455✓ | 5555✓ | 5555✓ | 5143✗ |
| Q4 | 5544✓ | 5154✗ | 1121✗ | 5543✓ | 5555✓ | 5555✓ | 5555✓ | 5555✓ | 1132✗ |
| Q5 | 5534✓ | 5154✗ | 5122✗ | 5544✓ | 5555✓ | 5544✓ | 5555✓ | 5555✓ | 5143✗ |
| Q6 | 5543✓ | 5143✗ | 1111✗ | 5544✓ | 5554✓ | 5555✓ | 5555✓ | 5545✓ | 5154✗ |
| Q7 | 5242✗ | 5143✗ | 1111✗ | 5553✓ | 5555✓ | 5433✓ | 5555✓ | 5553✓ | 1132✗ |
| Q8 | 5211✗ | 5154✗ | 1111✗ | 5342~ | 5555✓ | 5454✓ | 5555✓ | 5243~ | 5143✗ |
| Q9 | 3533✗ | 2142✗ | 4222✗ | 1111✗ | 4443✗ | 5544✓ | 5555✓ | 5554~ | 5144~ |
| Q10 | 5544 | 5555 | 2122 | 2434 | 5555 | 5544 | 3533 | 5555 | 5543 |
| Q11 | 5532 | 5543 | 3433 | 3534 | 3534 | 3534 | 3534 | 3534 | 5543 |
| Q12 | 4123~ | 5144~ | 1112~ | 5243✓ | 4455✓ | 4455✓ | 5555✓ | 5454✓ | 4143✗ |
| Q13 | 5543~ | 5143✗ | 1122✗ | 5554✓ | 5554✓ | 5544✓ | 5554✓ | 5555✓ | 5143✗ |
| Q14 | 5122✗ | 5143✗ | 5233✓ | 5554✓ | 5444✓ | 5554✓ | 5555✓ | 5243~ | 5143✗ |
| Q15 | 2223 | 5555 | 5543 | 2422 | 5555 | 5555 | 4445 | 4544 | 5555 |

## Appendix C: what decided each score

**Q1**

- gpt-4o (5/5/3/3): One count call on erm2-nwe9 (created_date 2026-09-01 to before 2026-10-01) returned 323,627, matching the reference, but the answer is one bare sentence with no source citation and no completeness caveat.
- gpt-5.4 (5/1/5/4): #76: all four calls on erm2-nwe9 carried query:"" and were refused; it gave no number, stated the 2026-09-01 to 2026-10-01 reading and what it tried, and offered a retry.
- gemini-3.5-flash-lite (1/1/1/1): Fabrication: no tool call, yet it reports 284,527 (reference 323,627) and presents the dataset ID and filter as if it had queried them.
- claude-sonnet-4.6 (5/5/4/4): A single count call returned 323,627 (matches) and the daily average of 10,788 is right; it cites the source but gives no completeness or limitation caveat.
- claude-sonnet-5.5 (5/5/5/5): A sample call, then a count of 323,627 (matches), with the calendar-month reading, the query, and scope and update limitations stated.
- gemini-3.8-flash (5/5/5/5): A sample call, a count of 323,627 (matches), and a top-5 breakdown whose shares check out (53,276 = 16.5%); it states the September window and a duplicate-report caveat.
- claude-opus-5.5 (5/5/5/5): A sample call, then a count of 323,627 (matches); the daily average is right, with caveats on what counts as a complaint, late-loaded records and the created_date basis.
- claude-haiku-5.5 (5/5/5/5): A sample call, then a count of 323,627 (matches), with the window, query and limitations stated; its 'About' hedge reports the server's is_sample:true flag rather than a model error.
- gpt-6.1-sol (5/1/4/3): #76: both calls on erm2-nwe9 carried query:"" and were refused; an honest no-number answer with the September 1-30 reading and a dataset link, but no next step.

**Q2**

- gpt-4o (5/3/3/2): Metadata, then one fail-count query (2025-10-01 to 2026-10-01) with no facility_type filter; it reports 17.5% (2,966/16,957) as 'restaurant inspections' although the rows cover all facility types, and gives no denominator or outcome-category caveat.
- gpt-5.4 (5/1/5/4): #76: all three calls on 4ijn-s7e5 carried query:"" and were refused; it gave no number, stated the trailing-12-month reading and the intended fail/total method, and offered a retry.
- gemini-3.5-flash-lite (1/1/2/1): No tool call: the answer is a plan (4ijn-s7e5, calendar 2025) ending 'Retrieving data...', with no result; nothing fabricated, but no dataset was ever queried.
- claude-sonnet-4.6 (5/4/4/3): The trailing-12-month counts are right (exact-case facility_type = 'Restaurant' gave the same rows as upper()), but the percentages are miscomputed: Fail 20.7% where 2,043/9,736 = 21.0%, and the shares sum to 98.6%.
- claude-sonnet-5.5 (5/3/4/4): Grouped results over the trailing 12 months with no facility_type filter: the figures are correct for all food facilities (21.0% of 13,876; 17.6% of 16,571) and the missing restaurant filter is disclosed, but the question asked for restaurants.
- gemini-3.8-flash (5/4/5/5): upper(facility_type) queries for the trailing 12 months (17.40% / 20.98%) and calendar 2025 (17.48% / 21.21%) match the reference exactly; one exploratory call with an aggregate but no GROUP BY was refused.
- claude-opus-5.5 (5/5/5/5): An upper(facility_type) query over the trailing 12 months gave 17.4% (2,043/11,743) and 21.0% of 9,736 graded, matching the reference, with both denominators and the reading stated.
- claude-haiku-5.5 (5/5/5/5): Calendar 2025 with upper(facility_type): 21.2% of 11,426 completed and 17.5% of 13,864 overall, matching the reference, with the reading and both denominators stated.
- gpt-6.1-sol (5/1/4/3): #76: both calls on 4ijn-s7e5 carried query:"" and were refused; an honest no-number answer with the reading, the formula and an inspections-not-restaurants caveat, but no next step.

**Q4**

- gpt-4o (5/5/4/4): One grouped query (2026-01-01 to before 2026-10-11) returned the reference top 10 exactly; the window and source are stated, but there are no limitations.
- gpt-5.4 (5/1/5/4): #76: all four calls, including the correct grouped query, carried query:"" and were refused; an honest report showing the intended SoQL and Jan 1-Oct 11 window, with a retry offered.
- gemini-3.5-flash-lite (1/1/2/1): No tool call: the answer is a plan (erm2-nwe9, Jan 1-Oct 11) ending 'Retrieving 2026 NYC 311 complaint counts...', with no result; nothing fabricated.
- claude-sonnet-4.6 (5/5/4/3): One grouped query returned the reference top 10, but a takeaway says the top 10 total ~2.16M (~70%) when its own counts sum to 1,702,739 (~55% of 3.09M); there are no limitations.
- claude-sonnet-5.5 (5/5/5/5): A sample call, then a grouped query: the top 10 match the reference, the 66% lead over Noise - Residential is right, and the partial-year and live-update limitations are stated.
- gemini-3.8-flash (5/5/5/5): A sample call, then a grouped query from 2026-01-01: the top 10 match the reference and the combined sums are right (parking 696,781, noise 441,773); the YTD window and source are stated.
- claude-opus-5.5 (5/5/5/5): Sample, grouped and total queries: the top 10 match the reference, and the shares of 3,091,795 and group sums (55% for the top 10) are all correct, with YTD and label-grouping limitations stated.
- claude-haiku-5.5 (5/5/5/5): The grouped query stops before 10-11 and says so ('through October 10'); the counts and shares match the reference, and it discloses the server's is_sample:true flag.
- gpt-6.1-sol (1/1/3/2): No tool call (no #76 here): it asserted, untested, that the YTD range exceeds the demo's limits (every model that ran it succeeded) and offered the past 30 days or the CLI instead of answering the explicit 'this year'.

**Q5**

- gpt-4o (5/5/3/4): Re-run (the first row's call failed 'unavailable' in a server restart): one answered ward GROUP BY on ijzp-q8t2 over [2026-02-01, 2026-03-01) with LIMIT 1; answers Ward 27 / 732, matching the reference, but cites no dataset ID (the system prompt asks for it) and gives no caveat. Scored against the Q5/Q9 scorer's calibration note.
- gpt-5.4 (5/1/5/4): #76: all four calls on ijzp-q8t2 sent query:"" and were refused, so no row came back; the answer reports no figure and gives the intended ward GROUP BY over 2026-02-01..2026-03-01 plus three concrete next steps.
- gemini-3.5-flash-lite (5/1/2/2): Its three data queries on ijzp-q8t2 (the ones without `type`) were refused and only metadata/metrics answered, yet the answer says the February 2026 queries 'returned no results' and the ward 'cannot be determined from the available records', which reports a refusal as a data absence; no next step offered; budget exceeded.
- claude-sonnet-4.6 (5/5/4/4): One correct ward GROUP BY on ijzp-q8t2 for February 2026 returned Ward 27 (732) ahead of 28 (707), matching the reference; there was no column discovery and no limitations note, and the neighbourhood labels for the wards are outside knowledge the answer does not mark as such.
- claude-sonnet-5.5 (5/5/5/5): A sample row, then a ward GROUP BY with ward IS NOT NULL over [2026-02-01, 2026-03-01) gave Ward 27 (732) and the top 5, matching the reference; it states the method and notes the 25-incident margin, the excluded null wards and later revisions.
- gemini-3.8-flash (5/5/4/4): Column discovery, then the correct ward GROUP BY gave Ward 27 (732) and the top 5, matching the reference, plus a share of the city total (16,547) and a crime-type breakdown for Ward 27; it gives no limitations or caveats, and a stray 'Analyzing results...' opens the answer.
- claude-opus-5.5 (5/5/5/5): A freshness sample, then a full ward GROUP BY (51 groups) gave Ward 27 (732), 28 (707) and a top 10 matching the reference; the caveats cover raw counts without population, 24 ward-'0' rows excluded, and revisions.
- claude-haiku-5.5 (5/5/5/5): A sample row, then a full SoQL string in `query` (ward GROUP BY, ward IS NOT NULL, February 2026) gave Ward 27 (732) and the top 5, matching the reference; it states the method, the 25-incident margin and caveats on severity weighting, boundaries and late reports.
- gpt-6.1-sol (5/1/4/3): #76: both calls on ijzp-q8t2 sent query:"" and were refused; it honestly reports no counts and names the intended source and method (Feb 1-28, grouped by ward), but gives no reason for the failure and no next step.

**Q6**

- gpt-4o (5/5/4/3): Real 180-day issueddate aggregate (Vacant Land $5,568,963, identical to Opus's same-window query) after a column sample, but no counts, no dates, and no caveat that Vacant Land tops the table on 10 permits or that averages are skewed.
- gpt-5.4 (5/1/4/3): #76 shape (query: '' plus empty optional args, same as Sol): all three calls refused; honest stop with next steps, but its suggested query uses a nonexistent field `estimatedcost`.
- gemini-3.5-flash-lite (1/1/1/1): No tool call; the whole answer is 'I'll analyze the results...', scored as no answer.
- claude-sonnet-4.6 (5/5/4/4): All-years averages match the reference (Multifamily $5,739,772, Single Family/Duplex $175,702), window stated and outliers flagged; no date filter on a large dataset, and the N/A class the query returned (7 rows) is silently dropped from the 6-row table.
- claude-sonnet-5.5 (5/5/5/4): 12-month issueddate window with zero/missing costs excluded, all stated with good limitations; but it calls 6,248 the excluded permits when 6,248 is the sum of the included counts.
- gemini-3.8-flash (5/5/5/5): Applied-since-2025-10-11 averages with zeros excluded track the reference (Industrial $4,866,677 n 96 vs $4.87M n 96; Multifamily $3,548,577 vs $3.53M), with medians, a stated window and a skew caveat; a stray 'Analyzing results...' line and three extra calls cost only tokens.
- claude-opus-5.5 (5/5/5/5): 180-day issueddate aggregate with counts and totals, derived shares all check (Multifamily 45% of ~$2.6B, SF/Duplex 69% of 3,276 permits), and it warns Vacant Land's top average rests on 10 permits.
- claude-haiku-5.5 (5/5/4/5): All-dates averages with zero/missing costs excluded (Multifamily $5,919,514 vs reference $5.74M with zeros) plus medians, window and exclusions stated; no date filter on a large dataset.
- gpt-6.1-sol (5/1/5/4): #76: all four data queries refused (query: ''); honest 'couldn't retrieve', with the correct field `estprojectcost` and its meaning from the answered catalog call and an exact 180-day query to run.

**Q7**

- gpt-4o (5/2/4/2): Denominator is COUNT(*) over all rows including ungraded violation rows (Manhattan 12,104 A of 36,524), so it names the Bronx (33.80%) the winner, which no letter-grade method supports, and labels violation rows 'inspections' without a caveat.
- gpt-5.4 (5/1/4/3): #76 shape (query: ''): four data calls refused, only the catalog answered; honest no-answer that flags the repeated-rows caveat but offers no next step.
- gemini-3.5-flash-lite (1/1/1/1): No tool call; the answer is only a plan to check the schema of 43nn-pn8j, scored as no answer.
- claude-sonnet-4.6 (5/5/5/3): Real 12-month A/B/C row counts (Manhattan 85.6%, Brooklyn 83.9%, Staten Island 83.4%) with method and the rows-not-restaurants limitation stated, but the reader gets a first-draft table crowning Staten Island, then 'Wait — let me recalculate carefully'.
- claude-sonnet-5.5 (5/5/5/5): Distinct-restaurant counts over 12 months under two stated denominators (Manhattan 93.1% of A/B/C; Bronx 78.6% of all entries) with the ~1-point margin and counting method disclosed; only slip is swapping the P and Z definitions.
- gemini-3.8-flash (5/4/3/3): Cut off at the 2,000-token limit mid-table: the received headline matches the reference exactly (Staten Island 78.89% vs Manhattan 78.77%, A/B/C rows), but Bronx and Queens rows, the (all-time, unfiltered) window and any limitations never reached the reader; two sample calls refused for missing `type`.
- claude-opus-5.5 (5/5/5/5): Manhattan 93.1% vs Staten Island 92.2% by distinct restaurants, cross-checked by row counts (86.0% vs 84.8%), with margin, window, exclusions (N/P/Z, boro '0') and the one-row-per-violation structure stated.
- claude-haiku-5.5 (5/5/5/3): Cut off at the 2,000-token limit inside the limitations; table is right (Manhattan 86.0% of A/B/C, Staten Island 84.8%), but the text says Manhattan also leads on all-grade records while its own table and next paragraph give the Bronx (65.2%), and it attributes a 'past 12 months' framing to the user.
- gpt-6.1-sol (1/1/3/2): No tool call (not #76): asked whether to use latest or all graded inspections on an answerable query instead of stating a method and answering.

**Q8**

- gpt-4o (5/2/1/1): Call 2 (ORDER BY annual_salary DESC with no SALARY filter) returned 6 cols for 3 selected fields where every other model's equivalent select returned selected+4, so annual_salary was absent from all 10 rows; the table (Park District titles, top $223,644 vs the real $360,504) and the '~$97,500' median (ref $115,158, from a 32,016-row pull the 48K-token run could not have read) have no data behind them.
- gpt-5.4 (5/1/5/4): #76 shape (query: ''): all four data calls refused; honest stop naming the dataset, `salary_or_hourly` and the salary-only view exe4-wf95 from the answered catalog call, with concrete next steps.
- gemini-3.5-flash-lite (1/1/1/1): No tool call; the answer is a plan ending 'Retrieving data...', scored as no answer.
- claude-sonnet-4.6 (5/3/4/2): Top titles and the $116,081 full-time salaried average are right, but it wrongly says SoQL has no median and puts the median at $107K-$112K although its own count (12,664 of 24,917 below $116,081) places it just under $116K (ref $115,158); adds unsupported union explanations.
- claude-sonnet-5.5 (5/5/5/5): Exact median $115,158 and average $116,079 via median(), top list matches the reference with correct multiples (3.13x), hourly workers excluded and disclosed.
- gemini-3.8-flash (5/4/5/4): Top list and $116,079 average right, 7,098 hourly employees disclosed; median approximated as '~$116,000' from a count (ref $115,158) after its offset query returned 0 rows, and an hourly-rate range generalised from a 5-row sample.
- claude-opus-5.5 (5/5/5/5): Median $115,158 and average $116,079 from one aggregate, top list and multiples correct, ~7,100 hourly employees excluded and disclosed, overtime caveat given.
- claude-haiku-5.5 (5/2/4/3): Top six and the $116,079 average are right after two refused cast() calls needed a retry, but it never computed the median, wrongly saying the dataset cannot, and says so plainly instead of inventing one.
- gpt-6.1-sol (5/1/4/3): #76: both data queries refused (query: ''); honest no-answer naming the dataset and a sound method (median over salaried only), but no query or retry offered.

**Q9**

- gpt-4o (3/5/3/3): Used the stale h73f-gn57 with a correct date_trunc_ym(createddate) query for Apr-Sep 2026 that returned 0 rows; it only guessed the cause ('might be due to the dataset being updated only up to a certain point in 2025') without checking MAX(createddate), cited no dataset ID and did not look for a 2026 dataset.
- gpt-5.4 (2/1/4/2): #76: its h73f-gn57 and b7dx-7gc3 queries sent query:"" and were refused (only the catalog search answered); the answer reports no figures but calls b7dx-7gc3 ('MyLA311 Service Request Data 2024') 'a current MyLA311 dataset', so the source it names and its retry suggestions point to 2024 data.
- gemini-3.5-flash-lite (4/2/2/2): Verified that h73f-gn57 spans 2025-01-01 to 2025-11-03 (423,053 rows, matching the reference) and said it cannot give the trend, but its monthly query used the nonexistent date_trunc_m, was refused and never fixed; the answer then reports that refusal as 'mid-2025 dates returned no results due to data availability' (false), adds irrelevant January 2025 request types, and gives no next step; budget exceeded.
- claude-sonnet-4.6 (1/1/1/1): Timed out at 120 s in the resume (20:28:17Z) and again on its re-run (21:19:49Z): the first request asked for one tool call in about 1 s, and that call took 129,104 ms and returned 347 bytes, consistent with the server's retry chain on a slow LA query. No answer, scored 1/1/1/1 under the brief's no-answer rule; counts as the model's result (the ruling for a second timeout).
- claude-sonnet-5.5 (4/4/4/3): A catalog search, a refused call on the parent 69nn-wkid, then a correct monthly query on h73f-gn57 (0 rows), which it explains plainly as the 2025 dataset holding no 2026 rows, with good next steps and the CLI note; but its headline claim 'No 2026 dataset in the catalog' is contradicted by 2cy6-i7zn, which near-identical searches by other models found; budget exceeded.
- gemini-3.8-flash (5/5/4/4): Found 2cy6-i7zn by catalog search, sampled it, and ran date_trunc_ym(createddate) from 2026-04-01; the Apr-Sep counts match the reference exactly (199,584 ... 213,320), the MoM changes, average and totals are correct, and October is flagged as partial (64,574 against the reference's 64,363, later data); there is no limitations note, and the October run-rate projection divides by 11 days although the 11th was a partial day.
- claude-opus-5.5 (5/5/5/5): Re-run (the first row timed out): found 2cy6-i7zn by catalog search, checked h73f-gn57's coverage with min/max/count, then grouped 2cy6-i7zn by date_trunc_ym(createddate); May-Sep counts match the reference exactly; April and October flagged as partial with per-day rates; source, query and limitations stated. Scored against the Q5/Q9 scorer's calibration note.
- claude-haiku-5.5 (5/5/5/4): Ran a correct monthly query on h73f-gn57 (0 rows), checked it with MIN/MAX/COUNT (2025-01-01 to 2025-11-03, 423,053, matching the reference), then a catalog search found 2cy6-i7zn, which it names as the 2026 source but did not query (budget exceeded), so no counts; it reports this honestly with an accurate schema caveat.
- gpt-6.1-sol (5/1/4/4): #76: a catalog search found 2cy6-i7zn ('MyLA311 Cases 2026'), but all three queries sent query:"" and were refused; the answer names the right dataset, states the Apr 11-Oct 11 window with a partial-month caveat, invents nothing, and offers a CSV route.

**Q10**

- gpt-4o (5/5/4/4): No tool call; asked for city and time period in one question with example cities, but gave no rate-versus-counts or population caveat and no default.
- gpt-5.4 (5/5/5/5): No tool call; one question covering city, timeframe and rate basis (per-100k needs a population source, otherwise counts), plus an offered default of NYC, last 30 days, counts.
- gemini-3.5-flash-lite (2/1/2/2): No clarification; picked arrests (uip8-fykc), and all four aggregations were REFUSED (each omitted `type`), so it described 10 sample rows and blamed the 'data source' for the refusals; it invented no figures but gave no usable answer.
- claude-sonnet-4.6 (2/4/3/4): No clarification; used arrests (uip8-fykc) as the crime proxy, and its Sept-Oct window returned 0 rows, so it checked MAX(arrest_date) and re-ran June 2026 (22,306 arrests, sums check); it caveated arrest counts versus per-capita rates and the June data end.
- claude-sonnet-5.5 (5/5/5/5): No tool call; asked for city and period with dataset options per city, offered NYC/12 months as a default, and said the datasets give counts, not a rate per 100k.
- gemini-3.8-flash (5/5/4/4): No tool call; one question for city and timeframe with an NYC/past-year example, but no rate-versus-counts or population caveat.
- claude-opus-5.5 (3/5/3/3): No clarification; queried NYPD complaints 5uac-w243 correctly (279,513 complaints Jan-Jun 2026; MIN/MAX(rpt_dt) shows the June 30 data end), but its bolded headline '~3,300 per 100,000' divides by Census populations no tool returned (it says so) and then annualizes.
- claude-haiku-5.5 (5/5/5/5): No tool call; asked for city and period, offered NYC arrests over 12 months as a default, and said a per-capita rate needs population figures that the datasets lack.
- gpt-6.1-sol (5/5/4/3): No tool call; a single minimal question ('Which city or area?') with no time period, no rate-versus-counts caveat and no offered default.

**Q11**

- gpt-4o (5/5/3/2): No tool call, but asked only which city, ignoring the given Chicago portal, and never asked which kind of permit or what period, so it missed the actual ambiguity.
- gpt-5.4 (5/5/4/3): No tool call; asked which city (the portal is already Chicago), but mentioned building/construction permits and offered Chicago by default, which partly settles the permit type.
- gemini-3.5-flash-lite (3/4/3/3): No clarification; one valid call (ydr8-5enu ORDER BY issue_date DESC LIMIT 5, all 100 columns) and a thin table of 5 permits under an 'Executive Summary' that generalizes from 5 rows.
- claude-sonnet-4.6 (3/5/3/4): No clarification; assumed building permits (ydr8-5enu) over the last 30 days and gave a clean aggregation (3,037 permits by type, with cost and processing time) and stated its scope; never surfaced other permit kinds.
- claude-sonnet-5.5 (3/5/3/4): No clarification; assumed building permits over 90 days (9,086 permits, by type) plus the latest 10 permits, with good limitations; did not ask which kind of permit.
- gemini-3.8-flash (3/5/3/4): No clarification; checked MIN/MAX/COUNT first, then gave building permits since 2026-07-11 (9,102, totals sum correctly); a stray 'Analyzing results...' leads the answer.
- claude-opus-5.5 (3/5/3/4): No clarification; a strong 90-day building-permit summary (9,086 by type, top 5 by cost, 1,092 null-cost rows disclosed), but it offered only 'another city', not other permit kinds.
- claude-haiku-5.5 (3/5/3/4): No clarification; two valid calls via the `query` argument for 90-day building permits by type (9,086), showing the SoQL used and noting self-reported costs.
- gpt-6.1-sol (5/5/4/3): No tool call; asked which city (the portal is already Chicago) but offered 'Chicago building permits' as a default; no question about permit type or period.

**Q12**

- gpt-4o (4/1/2/3): Found ipu4-2q9a by catalog search but ran no data query, so it never attempted the count or checked the date range; it said 1950 records are 'unlikely' from general knowledge of digitization.
- gpt-5.4 (5/1/4/4): Targeted ic3t-wcy2 directly, but both calls were REFUSED with empty-string arguments (query/select/where = "", the #76 shape, as with Sol); it honestly gave no number, rightly suspected modern-only coverage, and wrongly blamed the 'live source'.
- gemini-3.5-flash-lite (1/1/1/2): Made no tool call, yet presented 'Finding: the dataset does not contain ... 1950' under a 'Data Source: ic3t-wcy2' heading; the conclusion happens to match the reference, but it has no tool evidence. [Reconciled: no tool call, so no dataset was used (the rule the Q1-Q4 and Q6-Q8 scorers applied to every no-call row).]
- claude-sonnet-4.6 (5/2/4/3): TEXT-DATE TRAP: compared the MM/DD/YYYY text field pre__filing_date >= '1950-01-01' AND < '1951-01-01' (every such string sorts below '1950', so it returns 0 whatever the data) and reported text-sorted MIN/MAX (Jan 1 2000 / Dec 31 2025) as the true range; the 'no 1950 data' conclusion is right by accident.
- claude-sonnet-5.5 (4/4/5/5): Found ipu4-2q9a by catalog search; issuance_date LIKE '%/1950' by borough gave 0 rows; it explicitly rejected the text-sorted MIN (01/01/2007) as unreliable and cited bty7-2jhb's 1989-2013 range; one right() call was REFUSED.
- gemini-3.8-flash (4/4/5/5): Found ipu4-2q9a by catalog search; LIKE '%1950%' gave 0 rows, and a second catalog search established coverage (1989+, ic3t-wcy2 from 2000, DOB NOW from 2016); one text-sorted ASC query was wasted but not misreported.
- claude-opus-5.5 (5/5/5/5): Queried ipu4-2q9a directly: Bronx LIKE '%/1950' = 0, with a positive control (LIKE '%/1989' = 178) showing the filter works; it read the 0 as a coverage gap, flagged that 1989 itself looks incomplete, and pointed to archives.
- claude-haiku-5.5 (5/4/5/4): Queried ipu4-2q9a directly: Bronx LIKE '%/1950' = 0; it recognized that its text-sorted ASC check and LIKE '%/19%' (728,731) were inconclusive and said the date range was not established; headline '0' caveated as a likely coverage gap.
- gpt-6.1-sol (4/1/4/3): #76: the catalog call found ipu4-2q9a, then both data calls were REFUSED for query: ""; it honestly gave no count ('does not mean zero') but drew no conclusion about 1950 coverage, with only a brief pointer to archives.

**Q13**

- gpt-4o (5/5/4/3): One call on erm2-nwe9 with upper(borough) and upper(complaint_type) over a stated 30-day window listed 10 real recent complaints, but gave no total (reference 17,063) and no limitation note.
- gpt-5.4 (5/1/4/3): #76: all four calls (query:'' with empty select/where/order/group) were refused; it named erm2-nwe9 and the right upper() filter, said plainly it could not retrieve the data, and offered narrower retries, which would not fix the cause.
- gemini-3.5-flash-lite (1/1/2/2): Made no tool call yet told the reader no data came back 'in the previous turn'; named erm2-nwe9 but described a filter on the nonexistent field `boro`; invented no figures. [Reconciled: no tool call, so no dataset was used (same rule).]
- claude-sonnet-4.6 (5/5/5/4): Three answered upper() queries on erm2-nwe9 give 17,063 with correct type and ZIP breakdowns; 'followed by Loud Talking' comes from a 50-row sample, and the aggregates put Banging/Pounding second, but it is presented as the overall ranking.
- claude-sonnet-5.5 (5/5/5/4): Column discovery, then upper() queries give 17,063 and correct type/descriptor counts with good limitations, but 'Street/Sidewalk noise is the largest single category' is wrong (Residential 5,830 > Street/Sidewalk 5,418).
- gemini-3.8-flash (5/5/4/4): Sampled 5 rows, then filtered `borough = 'MANHATTAN'` as an exact upper-case literal (upper() only on complaint_type); 17,063 and the type/descriptor tables are correct, but no query backs the 'Primary Sources' column and the only limitation stated is the date scope.
- claude-opus-5.5 (5/5/5/4): Four answered upper() queries give 17,063 with type, descriptor, ZIP and status breakdowns and strong caveats; two minor slips: '5 of the top 10 ZIPs' lists six, and the source line states `borough = 'MANHATTAN'` where it ran upper(borough).
- claude-haiku-5.5 (5/5/5/5): A sample row, then one upper() grouped query (34 rows) summed to 17,063; shares, descriptors, the query used and the limitations are all correct and stated.
- gpt-6.1-sol (5/1/4/3): #76: both calls (query:'' with empty where/order/group) refused; it named erm2-nwe9, said plainly it could not retrieve the data, stated the intended scope and linked the dataset.

**Q14**

- gpt-4o (5/1/2/2): Its only call filtered on the nonexistent column `status = 'Active'` with no column discovery and was refused; it told the reader 'the query returned no data' and gave no useful next step (no figures invented).
- gpt-5.4 (5/1/4/3): #76: query, metadata and metrics calls on wnbq-64tb were all refused (empty-string arguments); an honest decline that lists the attempts and offers a narrower request or direct portal access.
- gemini-3.5-flash-lite (5/2/3/3): Two bare limit-5 queries answered and four calls omitting `type` were refused; it states the correct total, 84,978, with 4 real rows, but blames 'system request limitations on filtered queries' for its own malformed calls, calls the 4 rows 'representative', and offers no next page or filter.
- claude-sonnet-4.6 (5/5/5/4): Column discovery, then LIMIT 500 ordered by start date; it states 84,978, shows a 10-row excerpt and offers filters, but the excerpt is not in the stated newest-first order, and it says nothing about the 2027 start dates or the out-of-Seattle addresses (e.g. New York) in its own table.
- claude-sonnet-5.5 (5/4/4/4): Cut off at the 2,000-token limit, scored on the text the reader received: 84,978 total and 59,102 Seattle-addressed, with the distinction explained, and a 25-row page from a working query after its upper(city) group-by was refused; no next-page or filter offer reached the reader, and 'I could only retrieve 25' misstates its own LIMIT 25.
- gemini-3.8-flash (5/5/5/4): Five answered calls give 84,978 with ownership and NAICS breakdowns, a 10-row sample and the 59,102 Seattle-based caveat; the ownership table's 'Total Tracked 84,978 / 100%' row sits under rows that sum to 84,297.
- claude-opus-5.5 (5/5/5/5): Five answered calls give 84,978 with ownership and NAICS breakdowns and a 15-row sample, flag the future 2027 start dates and the out-of-city addresses, and offer paging, filters, download and the CLI.
- claude-haiku-5.5 (5/2/4/3): A sample row and metadata answered; its only data query (an upper(city) group-by) was refused and it never ran a bounded listing; it reports 84,978 and 59,102 honestly as cached-metadata figures and offers filters or the CLI, but lists no licenses.
- gpt-6.1-sol (5/1/4/3): #76: the metadata call and both queries on wnbq-64tb were refused (only the catalog search answered); it said plainly it could not list or count, and gave the dataset link, the Export-to-CSV route and an out-of-Seattle-address caveat.

**Q15**

- gpt-4o (2/2/2/3): Queried both portals against the web guidance: the NYC count (67,022) answered, and the Chicago call used the nonexistent field `creation_date` and was refused; it reported NYC honestly and pointed to the CLI but never explained the cross-portal limit.
- gpt-5.4 (5/5/5/5): No tool call; declined the cross-portal comparison, citing the demo limit, and offered NYC or Chicago one at a time plus the CLI.
- gemini-3.5-flash-lite (5/5/4/3): No tool call; declined citing the web limits and the CLI, but framed the problem as not being able to query Chicago 'concurrently' and handed the user a top-complaint-types SQL to run instead of offering to run one city.
- claude-sonnet-4.6 (2/4/2/2): Ran four queries across both portals (NYC 67,022, Chicago 38,498) against the decline guidance, and rested its headline per-capita claim on population figures (~8.3M, ~2.7M) that no tool call returned; the window runs to Oct 11 23:59:59 (8 calendar days) while the daily average divides by 7. [Reconciled: queried both portals against the decline rule (as gpt-4o Q15, guidance 2); its per-capita headline rests on labelled outside population figures, treated like Opus Q10 disclosed Census figures, not as fabrication.]
- claude-sonnet-5.5 (5/5/5/5): No tool call; declined citing the demo limit, offered one city at a time and asked which first, and pointed to the CLI.
- gemini-3.8-flash (5/5/5/5): No tool call; declined citing shared-resource limits, asked whether to do NYC or Chicago, and pointed to the CLI.
- claude-opus-5.5 (4/4/4/5): Queried NYC only (67,022, with daily and top-10 breakdowns) instead of declining and asking, then offered Chicago as the next step and the CLI; it caught that Oct 10 is partial (854) and Oct 11 not yet loaded; its window runs to < Oct 12 (8 calendar days).
- claude-haiku-5.5 (4/5/4/4): Queried NYC only (67,022, top 10 types) instead of declining and asking, and offered Chicago next plus the CLI; it missed that Oct 10 is only partly loaded, so the weekly total is understated.
- gpt-6.1-sol (5/5/5/5): No tool call; stated its reading of 'past week' (Oct 4-10), declined the cross-city comparison, asked which city first, and pointed to the CLI.

## Appendix D: the separate set, scores per row

The same notation as Appendix B. Each line below the table says what decided that score.

| Query | gpt-5.4 | gpt-6.1-sol |
|---|---|---|
| Q1 | 5554✓ | 5555✓ |
| Q2 | 5343~ | 5555✓ |
| Q4 | 5555✓ | 1132✗ |
| Q5 | 5555✓ | 5555✓ |
| Q6 | 5544✓ | 5555✓ |
| Q7 | 5353~ | 1132✗ |
| Q8 | 5243~ | 5443~ |
| Q9 | 1111✗ | 1132✗ |
| Q10 | 5554 | 5544 |
| Q11 | 5532 | 5543 |
| Q12 | 5243✓ | 4444✓ |
| Q13 | 5555✓ | 5555✓ |
| Q14 | 5554✓ | 5555✓ |
| Q15 | 5555 | 5555 |


**Q1**

- gpt-5.4 (5/5/5/4): A sample call, then a count of 323,627 on erm2-nwe9 for 2026-09-01 to before 2026-10-01 (matches), with the reading, filter and a limitations section; but its caveats cover scope only, with no completeness or late-record caveat (Sonnet 5.5's October 5 had one), and a stray 'Analyzing results...' opens the answer.
- gpt-6.1-sol (5/5/5/5): A sample call, then a count of 323,627 (matches) for September 1-30 plus an extra metrics call; it cites the dataset and caveats that requests are not unique incidents and that records change as the dataset updates.

**Q2**

- gpt-5.4 (5/3/4/3): Trailing-12-month GROUP BY results on 4ijn-s7e5 with no facility_type filter: 2,915/16,573 = 17.6% is right for all food facilities (as Sonnet 5.5's October 17.6% of 16,571) and the limitations disclose the missing restaurant filter, but the headline calls it 'restaurant inspections' and gives only the all-rows denominator.
- gpt-6.1-sol (5/5/5/5): One upper(facility_type) = 'RESTAURANT' query over 2025-10-12 to 2026-10-11 gave 17.4% (2,040/11,720) and 21.0% of 9,717 completed, matching the reference (2,043; 21.0%), with both denominators, the reading, the query and a repeat-inspection caveat; its extra upper(city) = 'CHICAGO' filter, shown in the query, trims 3 fails.

**Q4**

- gpt-5.4 (5/5/5/5): A sample call, then a grouped query from 2026-01-01 to before 2026-10-13: the top 10 match the reference exactly (Illegal Parking 486,367 ... Dirty Condition 57,636), with the YTD window, query and limitations stated.
- gpt-6.1-sol (1/1/3/2): No tool call, the same behaviour as its October Q4 row: it asserted, untested, that a YTD query exceeds the demo's safeguards (GPT-5.4's ran in 15 s) and offered the past 30 days or the CLI instead of answering the explicit 'this year'.

**Q5**

- gpt-5.4 (5/5/5/5): A sample, then a ward GROUP BY with ward IS NOT NULL over [2026-02-01, 2026-03-01) gave Ward 27 (732) and the top 5, matching the reference, with the query and caveats on records versus incidents, excluded null wards and counts versus per-capita rates.
- gpt-6.1-sol (5/5/5/5): A sample, then a full ward GROUP BY (51 groups) for February 2026 gave Ward 27 (732) ahead of Ward 28 (707) by 25, matching the reference, with the query and not-a-rate and revision caveats.

**Q6**

- gpt-5.4 (5/5/4/4): A sample, then AVG(estprojectcost) by permitclass over all dates: every average matches the reference (Multifamily $5,739,772, Single Family/Duplex $175,702) and the all-time window, estimated-cost basis and small N/A class are stated, but there is no date filter on a large dataset and no skew caveat (as Sonnet 4.6's October row).
- gpt-6.1-sol (5/5/5/5): Sample and metadata, then a 180-day issueddate aggregate on estprojectcost restricted to upper(permittypemapped) = 'BUILDING' (2,662 permits; class counts sum), stating the window, the zero-cost count, skew, and that Vacant Land's top mean rests on 6 permits and one $52.6M estimate.

**Q7**

- gpt-5.4 (5/3/5/3): Column discovery (distinct boro, distinct grade), then A / COUNT(*) of non-null-grade rows over 2026-09-12 to 2026-10-12 names Staten Island (60.3% of 126 rows) over the Bronx (58.6%); the denominator silently includes the N/Z/P grades its own distinct-grade call returned and counts per-violation rows it calls 'inspections', with no small-sample caveat.
- gpt-6.1-sol (1/1/3/2): No tool call, the same behaviour as its October Q7 row: it asked whether to use each restaurant's latest grade or all graded inspections on an answerable query instead of stating a method and answering.

**Q8**

- gpt-5.4 (5/2/4/3): The top 10 salaried titles match the reference (Commissioner of Aviation $360,504) after two ORDER BY CAST() calls were refused and retried, but its offset-12458 median call returned 0 rows and it gave no median or average, so the comparison half is missing; it says so honestly but wrongly attributes the 0-row result to a portal refusal (as Haiku 5.5's October row).
- gpt-6.1-sol (5/4/4/3): All calls answered: the top 10 by title and department match the reference, and it pulled the full salaried distribution (890 distinct salaries with counts, enough for the exact median) yet reported no median after its offset-12458 call returned 0 rows, so the comparison is missing; hourly exclusion disclosed, no next step offered.

**Q9**

- gpt-5.4 (1/1/1/1): ERROR: timed out at 120 s with no answer; scored 1/1/1/1 under the no-answer rule.
- gpt-6.1-sol (1/1/3/2): No tool call (as its October Q4 row): it asserted, untested, that a six-month LA query exceeds the demo threshold (October's Gemini 3.8 and Opus ran it on 2cy6-i7zn) and asked for a shorter range or the CLI; in October it had found 2cy6-i7zn by catalog search before #76 refused its queries.

**Q10**

- gpt-5.4 (5/5/5/4): No tool call; one question for city and period with examples, the readings of 'crime rate' including per-capita, and a default of NYC, last 30 days, total reported incidents; unlike its October answer it does not say a per-capita rate needs population data the portal lacks.
- gpt-6.1-sol (5/5/4/4): No tool call; one question for city and time period (October's asked only city), but no examples, no rate-versus-counts or population caveat and no default, as GPT-4o's October row.

**Q11**

- gpt-5.4 (5/5/3/2): No tool call; asked only which city (the portal is already Chicago) and assumed building permits, with no question on permit type or period and, unlike its October answer, no Chicago default, as GPT-4o's October row.
- gpt-6.1-sol (5/5/4/3): No tool call; asked which city (the portal is already Chicago) but offered Chicago building permits as a default; no question on permit type or period, identical to its October row.

**Q12**

- gpt-5.4 (5/2/4/3): Targeted ic3t-wcy2 directly and grounded 'no 1950 data' in its metadata (Latest Action Date since 2000), but never ran a 1950 count and, under 'What I verified', reported a pre__filing_date ASC sample on the MM/DD/YYYY text field as the earliest Bronx records 'starting in 2013', the text-date trap (as Sonnet 4.6's October row).
- gpt-6.1-sol (4/4/4/4): Found ipu4-2q9a by catalog search; Bronx and citywide issuance_date LIKE '%/1950' counts both returned 0, reported as 'not evidence that no permits were issued' with the text-date caveat, but it never checked the dataset's coverage, so it does not say the data starts decades later; budget exceeded.

**Q13**

- gpt-5.4 (5/5/5/5): upper(borough) = 'MANHATTAN' and upper(complaint_type) LIKE '%NOISE%' over 2026-09-12 to 2026-10-12 gave 16,508 by type (the reference's 17,063 counted from 09-11, one day earlier), with distinct-type discovery, recent rows, the exact queries and limitations stated.
- gpt-6.1-sol (5/5/5/5): An upper() grouped query for Sept 12-Oct 11 gave 16,508 (the reference window less one day) with a correct 66% residential plus street/sidewalk share, the five latest rows, and a caveat that the latest report is Oct 10 so recent days may be incomplete.

**Q14**

- gpt-5.4 (5/5/5/4): A sample, then a bounded 10-row page; it states 84,978 (matches) and offers the next 500 rows, a Seattle-address filter, CSV chunks or NAICS counts, but does not say that 4 of its 10 rows (Tukwila, Federal Way, Auburn, SeaTac) are outside Seattle.
- gpt-6.1-sol (5/5/5/5): Metadata, a sample and a count check (84,978, matches), then 10 rows alphabetically, with browse and CSV links, a next-page offer, the update date and an out-of-Seattle-address caveat.

**Q15**

- gpt-5.4 (5/5/5/5): No tool call; declined the cross-portal comparison citing the demo limit, offered NYC or Chicago one at a time and the CLI, identical to its October row.
- gpt-6.1-sol (5/5/5/5): No tool call; stated the Oct 5-11 reading of 'past week', declined the cross-city comparison, asked which city first and pointed to the CLI, identical to its October row.
