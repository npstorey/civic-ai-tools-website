#!/usr/bin/env node
/**
 * The November 2026 model evaluation's tables (#740, P2b), rendered into
 * `docs/model-evaluation-2026-11.md` from the committed files under
 * `docs/model-evaluation-2026-11/` alone, so no figure in the document is
 * typed (A7).
 *
 * Usage: node scripts/eval-report.mjs [--doc <file>] [--data <dir>] [--check]
 *
 *   Rewrites, in the document, the text between each pair of markers
 *   `<!-- table:<name> -->` and `<!-- /table:<name> -->` with what this script
 *   renders for `<name>`. With --check it writes nothing, prints each block that
 *   differs, and exits 1 on any drift; it exits 2 when the markers themselves
 *   are wrong (a name it does not render, a block missing, opened twice, or
 *   left unclosed).
 *
 * WHAT IT READS: the two results files (the run's and the probe's, byte-equal
 * to the files the owner's terminal wrote), `scores-first.json`,
 * `scores-second.json`, `citation-review.json` and `provider-terms.json`.
 * Nothing on the network, nothing outside the data directory. It sends no
 * model request and reads no environment variable.
 *
 * THE METHODS IT APPLIES, each stated in the document beside its table:
 *   - a row is one question, one consent configuration, one repeat, one model;
 *   - a row's quality is the mean of the hand-scored dimensions it was scored
 *     on (a dimension left unscored, `null`, is left out), and a model's
 *     quality is the mean over its rows (the rubric's Quality Score);
 *   - the rubric's Cost and Latency are scored relative to the other models on
 *     the same question, configuration and repeat (a cell of five rows): 5 at
 *     or within 10% of the lowest, else 1 for the highest or 2x the median or
 *     more, else 3 within 10% of the median, else 4 below it and 2 above it;
 *   - Efficiency = (Cost + Latency) / 2; Overall = 0.7 x Quality + 0.3 x
 *     Efficiency (the rubric's Composite);
 *   - a request's recorded cost is the larger of its listed and its reported
 *     cost (`cost.ofRecordUsd`); the Claude requests are billed through the
 *     account's own Anthropic key (BYOK), the open-weight ones by OpenRouter;
 *   - p90 is the nearest-rank 90th percentile;
 *   - the second reader's agreement (A13) is computed as planning
 *     `temp/eval-ow/p2/agreement.py` computes it: pairs where both readers
 *     scored, exact and within-one agreement, mean absolute difference, and
 *     Cohen's quadratic-weighted kappa over the categories 1-5.
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
export const DOC = join(REPO, 'docs/model-evaluation-2026-11.md');
export const DATA = join(REPO, 'docs/model-evaluation-2026-11');
export const RUN_FILE = 'eval-results-run-20261113T134831Z.json';
export const PROBE_FILE = 'eval-results-probe-20261109T164604Z.json';

const DIMS = [
  ['dataset_selection', 'Dataset Selection'],
  ['soql_correctness', 'SoQL Correctness'],
  ['guidance_adherence', 'Guidance Adherence'],
  ['interpretation_quality', 'Interpretation Quality'],
];
const K = 5;

// ---- reading

export function readData(dir = DATA) {
  const json = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  return {
    run: json(RUN_FILE),
    probe: json(PROBE_FILE),
    first: json('scores-first.json'),
    second: json('scores-second.json'),
    citation: json('citation-review.json'),
    terms: json('provider-terms.json'),
  };
}

// ---- formatting

const code = (s) => `\`${s}\``;
const row = (cells) => `| ${cells.join(' | ')} |`;
const header = (cells) => `${row(cells)}\n|${cells.map(() => '---').join('|')}|`;
const f2 = (x) => (x === null || Number.isNaN(x) ? '—' : x.toFixed(2));
const f3 = (x) => (x === null || Number.isNaN(x) ? '—' : x.toFixed(3));
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const usd = (x) => `$${x.toFixed(4)}`;
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const int = (n) => n.toLocaleString('en-US');
const of = (a, b) => `${a} of ${b}`;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
const p90 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(0.9 * xs.length) - 1];
/** U+2011, the non-breaking hyphen, and a dataset id (four characters, a hyphen, four) written with it. */
const NB_HYPHEN = String.fromCharCode(0x2011);
const NB_ID = new RegExp(`(?<![a-z0-9])[a-z0-9]{4}${NB_HYPHEN}[a-z0-9]{4}(?![a-z0-9])`);
const consentLabel = (c) => (c.mode === 'every-source-on' ? 'every source On' : `Socrata Ask first, ${c.decision}`);
const cellOf = (r) => `${r.queryId} r${r.repeat} ${consentLabel(r.consent)}`;

// ---- derived values

function models(D) {
  return D.run.metadata.models.map((m) => ({ ...m, rows: D.run.results.filter((r) => r.modelId === m.id) }));
}
const requestsOf = (rows) => rows.flatMap((r) => r.requests);
const recorded = (q) => q.cost.ofRecordUsd;

export function rowQuality(scores) {
  const xs = DIMS.map(([d]) => scores[d].score).filter((s) => s !== null);
  return mean(xs);
}

/** The rubric's relative score of `v` among a cell's values. */
export function relativeScore(v, values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const med = median(values);
  if (v <= 1.1 * lo) return 5;
  if (v === hi || v >= 2 * med) return 1;
  if (Math.abs(v - med) <= 0.1 * med) return 3;
  return v < med ? 4 : 2;
}

function relativeScores(D, measure) {
  const cells = new Map();
  for (const r of D.run.results) {
    const k = cellOf(r);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(r);
  }
  const out = new Map();
  for (const [k, rows] of cells) {
    if (rows.length !== D.run.metadata.models.length) throw new Error(`cell ${k} holds ${rows.length} rows`);
    const values = rows.map(measure);
    for (const r of rows) out.set(r.key, relativeScore(measure(r), values));
  }
  return out;
}

export function qwk(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const obs = Array.from({ length: K }, () => Array(K).fill(0));
  for (const [a, b] of pairs) obs[a - 1][b - 1] += 1;
  const ra = obs.map((r) => sum(r));
  const rb = Array.from({ length: K }, (_, j) => sum(obs.map((r) => r[j])));
  let num = 0;
  let den = 0;
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      const w = (i - j) ** 2 / (K - 1) ** 2;
      num += w * obs[i][j];
      den += (w * ra[i] * rb[j]) / n;
    }
  }
  return den === 0 ? null : 1 - num / den;
}

export function agreement(D) {
  return DIMS.map(([d, label]) => {
    const pairs = [];
    let bothNull = 0;
    let oneNull = 0;
    for (const [key, s] of Object.entries(D.second.rows)) {
      const a = D.first.rows[key][d].score;
      const b = s[d].score;
      if (a === null && b === null) bothNull += 1;
      else if (a === null || b === null) oneNull += 1;
      else pairs.push([a, b]);
    }
    const exact = pairs.filter(([a, b]) => a === b).length;
    const within = pairs.filter(([a, b]) => Math.abs(a - b) <= 1).length;
    const mad = pairs.length ? mean(pairs.map(([a, b]) => Math.abs(a - b))) : null;
    return { d, label, pairs: pairs.length, exact, within, mad, kappa: qwk(pairs), bothNull, oneNull };
  });
}

/** Each recorded passage once, with the providers it was recorded against. */
function bulletsByText(D, pick) {
  const seen = new Map();
  for (const [n, p] of Object.entries(D.terms.providers).sort(([a], [b]) => a.localeCompare(b))) {
    for (const x of pick(p)) {
      const k = `${x.reading}\n${x.text}`;
      if (!seen.has(k)) seen.set(k, { ...x, names: [] });
      seen.get(k).names.push(n);
    }
  }
  return [...seen.values()].map((x) => `- **${x.names.join(', ')}** (${x.reading}): ${x.text}`).join('\n');
}

// ---- the tables

const TABLES = {
  'run-files'(D) {
    const out = [header(['Results file', 'Mode', 'Started (UTC)', 'Finished (UTC)', 'Rows written', 'Complete', 'Error rows', 'Timeouts', 'Charged (the harness)', 'Cap', 'Harness commit', 'Node'])];
    for (const [name, f] of [[PROBE_FILE, D.probe], [RUN_FILE, D.run]]) {
      const m = f.metadata;
      out.push(row([code(name), code(m.mode), m.startedAt, m.finishedAt, of(m.rowsWritten, m.rowsExpected), m.complete ? 'yes' : 'no', String(f.errors.length), String(m.totalTimeouts), usd(m.spend.chargedUsd), usd(m.spend.capUsd), code(m.harness.gitHead.slice(0, 7)), m.node]));
    }
    return out.join('\n');
  },

  spend(D) {
    const p = D.probe.metadata.spend.chargedUsd;
    const r = D.run.metadata.spend.chargedUsd;
    const recordedRun = sum(requestsOf(D.run.results).map(recorded));
    const recordedProbe = sum(requestsOf(D.probe.results).map(recorded));
    return [
      `- The probe: ${usd(p)} charged (${usd(recordedProbe)} recorded over its requests).`,
      `- The run: ${usd(r)} charged (${usd(recordedRun)} recorded over its requests).`,
      `- In all, in the two files: ${usd(p + r)}.`,
    ].join('\n');
  },

  models(D) {
    const list = D.run.metadata.openRouterList.models;
    const out = [header(['Model', 'Role', 'Request parameters', 'Provider object sent', 'Listed price, input / output (USD per million tokens)'])];
    for (const m of D.run.metadata.models) {
      const p = list[m.id].pricingPerMTok;
      out.push(row([`${m.name} (${code(m.id)})`, m.role, code(JSON.stringify(m.requestParameters)), m.provider ? code(JSON.stringify(m.provider)) : 'none (the default route)', `${p.input} / ${p.output}`]));
    }
    return out.join('\n');
  },

  limits(D) {
    const L = D.run.metadata.limits;
    return [
      `- Routing: ${code(D.run.metadata.routing)}.`,
      `- At most ${L.maxIterations} rounds a question and ${int(L.maxTokens)} tokens a response; a cumulative bound of ${int(L.maxCumulativeTokens)} tokens a question, summed over its requests, at which the loop forces one answering turn.`,
      `- A tool result is cut at ${int(L.maxToolResultChars)} characters; a tool call times out after ${L.toolTimeoutMs / 1000} s.`,
      `- A question times out after ${L.queryTimeoutMs / 1000} s (${code(`metadata.limits.queryTimeoutMs = ${L.queryTimeoutMs}`)}).`,
      `- The answering turn is sent as ${code(L.finalTurn)}.`,
    ].join('\n');
  },

  sources(D) {
    const S = D.run.metadata.sources;
    const on = S.filter((s) => s.hosting !== 'not configured');
    const off = S.filter((s) => s.hosting === 'not configured');
    return `The run's directory listed ${on.length} of the ${S.length} sources the harness knows: ${on.map((s) => `${code(s.alias)} (${s.hosting})`).join(' and ')}. The other ${off.length} were not configured: ${off.map((s) => code(s.alias)).join(', ')} (${code('metadata.sources')}).`;
  },

  design(D) {
    const m = D.run.metadata;
    const on = D.run.results.filter((r) => r.consent.mode === 'every-source-on');
    const repeats = Math.max(...on.map((r) => r.repeat));
    const pause = D.run.results.length - on.length;
    return `The run: ${m.queriesRun.length} questions, each put to every model ${repeats} times with every source On, and ${pause} pause rows: ${m.rowsExpected} rows over ${m.models.length} models (${code('metadata.rowsExpected')}), of which ${m.rowsWritten} were written.`;
  },

  'pause-set'(D) {
    const P = D.run.metadata.pauseSet;
    return `The pause rows are ${P.queries.join(', ')}, each with its gold source set to Ask first, once with each decision (${P.decisions.map(code).join(' and ')}), ${P.repeats} repeat (${code('metadata.pauseSet')}).`;
  },

  rows(D) {
    const out = [header(['Model', 'Rows', 'Error rows', 'Timeouts', 'Rows at the cumulative bound', 'Rows that took the answering turn', 'Empty answers', 'Answers cut at the response limit', 'Tool calls a row, mean', 'Failed tool calls'])];
    for (const m of models(D)) {
      const R = m.rows;
      const errors = D.run.errors.filter((e) => e.modelId === m.id).length;
      out.push(row([m.name, String(R.length), String(errors), String(D.run.errors.filter((e) => e.modelId === m.id && /timed out/i.test(String(e.error ?? ''))).length), String(R.filter((r) => r.budgetExceeded).length), String(R.filter((r) => r.answeringTurnTaken).length), String(R.filter((r) => r.checks.emptyAnswer).length), String(sum(R.map((r) => r.checks.finishedAtLength))), f2(mean(R.map((r) => r.toolCallCount))), String(sum(R.map((r) => r.checks.failedToolCalls)))]));
    }
    return out.join('\n');
  },

  'streamed-turns'(D) {
    const took = D.run.results.filter((r) => r.answeringTurnTaken);
    const streamed = requestsOf(D.run.results).filter((q) => q.sent.stream);
    const accepted = streamed.filter((q) => q.status === 200);
    return `${took.length} rows took the streamed answering turn; ${streamed.length} streamed requests were sent, ${accepted.length} accepted and ${streamed.length - accepted.length} refused.`;
  },

  checks(D) {
    const reviewed = D.citation.rows;
    const out = [header(['Model', 'Pause check passed', 'Declined source not called again (off rows)', 'Allowed source used (allow rows)', 'No call before a load', 'Citation check passed', 'Citation check failed', 'Reviewed true positives', 'False positives (A4)', 'Answers naming an id written with U+2011', 'Expected dataset called', 'Expected dataset answered', 'Expected dataset cited', 'Expected dataset not cited, but written with U+2011'])];
    for (const m of models(D)) {
      const R = m.rows;
      const off = R.filter((r) => r.checks.pause.declineRespected !== null);
      const allow = R.filter((r) => r.checks.pause.allowUsed !== null);
      const fails = R.filter((r) => r.checks.citation.pass === false);
      const rv = fails.map((r) => reviewed[r.key]);
      if (rv.some((x) => !x)) throw new Error(`${m.id}: a citation failure has no review`);
      const exp = R.filter((r) => r.checks.expectedDataset);
      out.push(row([
        m.name,
        of(R.filter((r) => r.checks.pause.pass).length, R.length),
        of(off.filter((r) => r.checks.pause.declineRespected).length, off.length),
        of(allow.filter((r) => r.checks.pause.allowUsed).length, allow.length),
        of(R.filter((r) => r.checks.pause.noCallBeforeLoad.pass).length, R.length),
        of(R.filter((r) => r.checks.citation.pass).length, R.length),
        String(fails.length),
        String(rv.filter((x) => x.verdict === 'true-positive').length),
        String(rv.filter((x) => x.verdict === 'false-positive').length),
        of(R.filter((r) => NB_ID.test(r.response)).length, R.length),
        of(exp.filter((r) => r.checks.expectedDatasetCalled).length, exp.length),
        of(exp.filter((r) => r.checks.expectedDatasetAnswered).length, exp.length),
        of(exp.filter((r) => r.checks.expectedDatasetCited).length, exp.length),
        String(exp.filter((r) => !r.checks.expectedDatasetCited && r.response.includes(r.checks.expectedDataset.replace('-', NB_HYPHEN))).length),
      ]));
    }
    return out.join('\n');
  },

  'citation-statement'(D) {
    const rows = Object.entries(D.citation.rows);
    const fp = rows.filter(([, r]) => r.verdict === 'false-positive').length;
    const cat = rows.filter(([, r]) => r.note === 'catalog-search');
    const dec = rows.filter(([, r]) => r.note === 'decline-names-next-id');
    const groups = [...new Set(cat.map(([, r]) => r.group))];
    return [
      `- **A4, under the rule as ruled: ${fp} false positives of ${rows.length}** citation-check failures.`,
      `- **${cat.length} of the ${rows.length}** (group ${groups.join(', ')}'s cards) name ids the answer attributes to a catalog search: ${cat.map(([k]) => code(k)).join(', ')}. The run file records each search's row and column counts (${code('resultSummary')}) and not the results themselves, so whether a search listed an id cannot be settled either way for these ${cat.length}: under the rule each is a true positive, and under the check's purpose any of them could be a false one. This document chooses no second reading.`,
      `- **${dec.length} answers to Q15 decline correctly and name the id they would query next** (${dec.map(([k]) => code(k)).join(', ')}): true positives under the rule.`,
    ].join('\n');
  },

  scores(D) {
    const out = [header(['Model', ...DIMS.flatMap(([, l]) => [`${l}, mean (rows scored)`, `${l}, rows scored 1/2/3/4/5, unscored`])])];
    for (const m of models(D)) {
      const cells = [m.name];
      for (const [d] of DIMS) {
        const s = m.rows.map((r) => D.first.rows[r.key][d].score);
        const scored = s.filter((x) => x !== null);
        const dist = [1, 2, 3, 4, 5].map((v) => scored.filter((x) => x === v).length).join('/');
        cells.push(`${f2(mean(scored))} (${scored.length})`, `${dist}, ${s.length - scored.length}`);
      }
      out.push(row(cells));
    }
    return out.join('\n');
  },

  composite(D) {
    const tok = relativeScores(D, (r) => r.totalTokens);
    const lat = relativeScores(D, (r) => r.durationMs);
    const dol = relativeScores(D, (r) => sum(r.requests.map(recorded)));
    const out = [header(['Model', 'Quality', 'Cost score (tokens)', 'Latency score', 'Efficiency', 'Overall', 'Cost score (recorded USD)', 'Overall, cost scored on USD'])];
    for (const m of models(D)) {
      const q = mean(m.rows.map((r) => rowQuality(D.first.rows[r.key])));
      const c = mean(m.rows.map((r) => tok.get(r.key)));
      const l = mean(m.rows.map((r) => lat.get(r.key)));
      const u = mean(m.rows.map((r) => dol.get(r.key)));
      const e = (c + l) / 2;
      out.push(row([m.name, f2(q), f2(c), f2(l), f2(e), `**${f2(0.7 * q + 0.3 * e)}**`, f2(u), f2(0.7 * q + 0.3 * ((u + l) / 2))]));
    }
    return out.join('\n');
  },

  cost(D) {
    const out = [header(['Model', 'Billed through', 'Requests', 'Recorded cost, all rows', 'Recorded cost a question, mean', 'Listed cost, all rows', 'Reported cost, all rows'])];
    let byok = 0;
    let billed = 0;
    for (const m of models(D)) {
      const Q = requestsOf(m.rows);
      const rec = sum(Q.map(recorded));
      const isByok = m.provider === null;
      if (isByok) byok += rec;
      else billed += rec;
      out.push(row([m.name, isByok ? 'BYOK (the Anthropic account)' : 'OpenRouter', String(Q.length), usd(rec), usd(rec / m.rows.length), usd(sum(Q.map((q) => q.cost.listedUsd))), usd(sum(Q.map((q) => q.cost.reportedUsd)))]));
    }
    out.push('', `Recorded in all: ${usd(byok + billed)}, of which ${usd(billed)} billed by OpenRouter (the open-weight rows) and ${usd(byok)} through BYOK (the Claude rows).`);
    return out.join('\n');
  },

  latency(D) {
    const out = [header(['Model', 'Duration a question, median', 'Duration, p90', 'Tokens a question, mean', 'Tokens a question, median', 'Input tokens, all rows', 'Output tokens, all rows', 'Reasoning tokens, all rows'])];
    for (const m of models(D)) {
      const R = m.rows;
      const d = R.map((r) => r.durationMs);
      const t = R.map((r) => r.totalTokens);
      out.push(row([m.name, sec(median(d)), sec(p90(d)), int(Math.round(mean(t))), int(median(t)), int(sum(R.map((r) => r.inputTokens))), int(sum(R.map((r) => r.outputTokens))), int(sum(R.map((r) => r.checks.reasoningTokens)))]));
    }
    return out.join('\n');
  },

  'scoring-groups'(D) {
    const G = D.first.groups;
    return Object.entries(G)
      .map(([g, x]) => `${g} (${x.questions[0]}-${x.questions.at(-1).slice(1)}, ${x.cards} cards)`)
      .join('; ')
      .concat('.');
  },

  'second-sample'(D) {
    const byModel = models(D).map((m) => `${m.name} ${m.rows.filter((r) => D.second.rows[r.key]).length}`);
    const qs = new Set(Object.keys(D.second.rows).map((k) => D.run.results.find((r) => r.key === k).queryId));
    return `The sample: ${Object.keys(D.second.rows).length} rows (${byModel.join(', ')}), covering ${qs.size} of the ${D.run.metadata.queriesRun.length} questions, drawn with seed ${code(D.second.sample.seed)}.`;
  },

  agreement(D) {
    const out = [header(['Dimension', 'Pairs (both readers scored)', 'Exact', 'Within one', 'Mean absolute difference', 'Quadratic-weighted kappa', 'Unscored by both / by one'])];
    for (const a of agreement(D)) out.push(row([a.label, String(a.pairs), `${a.exact} (${pct(a.exact, a.pairs)})`, `${a.within} (${pct(a.within, a.pairs)})`, f2(a.mad), f3(a.kappa), `${a.bothNull} / ${a.oneNull}`]));
    return out.join('\n');
  },

  providers(D) {
    const T = D.terms.providers;
    const count = (file, name) => {
      const by = {};
      for (const r of file.results) for (const q of r.requests) if (q.provider === name) by[r.modelName] = (by[r.modelName] ?? 0) + 1;
      return by;
    };
    const fmt = (by) => (Object.keys(by).length ? Object.entries(by).map(([m, n]) => `${m} ${n}`).join(', ') : '—');
    const out = [header(["Provider (OpenRouter's name)", 'Run requests, by model', 'Probe requests, by model', "OpenRouter's stated policy (all-providers JSON)", 'Terms read', 'Conflicts recorded', 'Gaps recorded'])];
    const names = Object.keys(T).sort((a, b) => a.localeCompare(b));
    for (const n of names) {
      const p = T[n];
      const dp = p.openRouter.dataPolicy;
      const policy = `training ${dp.training}; retains prompts ${dp.retainsPrompts}${dp.retentionDays !== undefined ? `, ${dp.retentionDays} days` : ''} (read ${p.openRouter.readAt})`;
      out.push(row([n, fmt(count(D.run, n)), fmt(count(D.probe, n)), policy, p.terms.readDate, p.conflicts.length ? `${p.conflicts.length} (below)` : 'none', p.gaps.length ? `${p.gaps.length} (below)` : 'none']));
    }
    const served = new Set(requestsOf([...D.run.results, ...D.probe.results]).filter((q) => q.sent.provider).map((q) => q.provider));
    const unread = [...served].filter((n) => !T[n]);
    if (unread.length) throw new Error(`served but not in provider-terms.json: ${unread.join(', ')}`);
    const byok = requestsOf([...D.run.results, ...D.probe.results]).filter((q) => !q.sent.provider);
    const byokProviders = [...new Set(byok.map((q) => q.provider))];
    const sent = JSON.stringify(D.run.metadata.openWeightProvider);
    const ow = requestsOf([...D.run.results, ...D.probe.results]).filter((q) => D.run.metadata.models.find((m) => m.id === q.sent.model)?.provider);
    const carried = ow.filter((q) => JSON.stringify(q.sent.provider) === sent).length;
    out.push('', `${names.length} providers served open-weight requests. Of the ${ow.length} open-weight requests in the two files, ${carried} carried the provider object ${code(sent)}. The ${byok.length} Claude requests carried none and were served by ${byokProviders.join(', ')} through the account's own key; that provider's terms are not part of either reading.`);
    return out.join('\n');
  },

  'provider-conflicts'(D) {
    const out = [];
    for (const [n, p] of Object.entries(D.terms.providers).sort(([a], [b]) => a.localeCompare(b))) {
      for (const c of p.conflicts) out.push(`- **${n}** (${c.reading}): ${c.text.replace(/^\*\*[^*]+\*\*:?\s*/, '')}`);
    }
    return out.join('\n');
  },

  'provider-differences'(D) {
    return bulletsByText(D, (p) => [...p.differences, ...p.notes]);
  },

  'provider-gaps'(D) {
    const out = [bulletsByText(D, (p) => p.gaps)];
    for (const g of D.terms.generalNotes) out.push(`- **Every provider of the ${g.reading} reading:** ${g.text}`);
    return out.join('\n');
  },

  'provider-quotes'(D) {
    const out = [];
    for (const [n, p] of Object.entries(D.terms.providers).sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`**${n}** (read ${p.terms.readDate}; ${p.terms.readTimes})`, '');
      out.push(`- Pages: ${p.terms.pages}`);
      out.push(`- Retention: ${p.terms.retention.text}`);
      out.push(`- Training: ${p.terms.training.text}`);
      out.push(`- Logging and human review: ${p.terms.logging.text}`);
      out.push(`- OpenRouter's statement: ${p.openRouter.statement}`, '');
    }
    return out.join('\n').trimEnd();
  },

  enclave(D) {
    const E = D.terms.enclaveInferenceProvider;
    const out = [header(['Candidate', 'Served?', 'Published name and ID'])];
    for (const c of E.candidates) out.push(row([c.Candidate, c['Served?'], c["Tinfoil's published name and ID"]]));
    out.push('', header(['Model (its ID)', 'Input, per million tokens', 'Output, per million tokens', 'As the page renders']));
    for (const p of E.prices) out.push(row([p['Model (Tinfoil ID)'], p['`inputTokenPricePer1M`'], p['`outputTokenPricePer1M`'], p['As the page renders']]));
    return out.join('\n');
  },

  'appendix-scores'(D) {
    const ms = models(D);
    const out = [];
    const qs = D.run.metadata.queriesRun;
    for (const q of qs) {
      const rows = D.run.results.filter((r) => r.queryId === q);
      const configs = [...new Set(rows.map((r) => `${consentLabel(r.consent)}|r${r.repeat}`))];
      out.push(`**${q}.** ${rows[0].query}`, '', header(['Configuration', ...ms.map((m) => m.name)]));
      for (const c of configs) {
        const cells = ms.map((m) => {
          const r = rows.find((x) => x.modelId === m.id && `${consentLabel(x.consent)}|r${x.repeat}` === c);
          return DIMS.map(([d]) => D.first.rows[r.key][d].score ?? '–').join('');
        });
        const [label, rep] = c.split('|');
        out.push(row([`${label}, ${rep}`, ...cells]));
      }
      out.push('');
    }
    return out.join('\n').trimEnd();
  },

  'appendix-citation'(D) {
    const out = [header(['Row', 'What the check found', 'Verdict', 'Note', "The reviewer's reason"])];
    for (const [k, c] of Object.entries(D.citation.rows)) {
      const r = D.run.results.find((x) => x.key === k);
      const ch = r.checks.citation;
      const found = [ch.unaddressed.length ? `unaddressed ${ch.unaddressed.map(code).join(', ')}` : null, ch.artifacts.length ? `${ch.artifacts.length} artifact(s) (${[...new Set(ch.artifacts.map((a) => a.kind))].join(', ')})` : null].filter(Boolean).join('; ');
      out.push(row([code(k), found, c.verdict, c.note ?? '—', c.reason.replace(/\|/g, '\\|')]));
    }
    return out.join('\n');
  },

  'appendix-open-weight'(D) {
    const out = [];
    for (const r of D.run.results.filter((x) => D.run.metadata.models.find((m) => m.id === x.modelId).provider)) {
      const by = {};
      for (const q of r.requests) by[q.provider] = (by[q.provider] ?? 0) + 1;
      out.push(`- ${code(r.key)}: ${Object.entries(by).map(([p, n]) => `${p} ${n}`).join(', ')}`);
    }
    return out.join('\n');
  },
};

export const TABLE_NAMES = Object.keys(TABLES);

export function renderTable(name, D) {
  if (!TABLES[name]) throw new Error(`no table named ${name}`);
  return TABLES[name](D);
}

// ---- the document

const OPEN = /^<!-- table:([a-z0-9-]+) -->$/;
const CLOSE = /^<!-- \/table:([a-z0-9-]+) -->$/;

/** The document's blocks, or the reasons its markers are wrong. */
export function blocks(text) {
  const lines = text.split('\n');
  const found = [];
  const errors = [];
  let open = null;
  lines.forEach((line, i) => {
    const o = OPEN.exec(line);
    const c = CLOSE.exec(line);
    if (o) {
      if (open) errors.push(`line ${i + 1}: ${o[1]} opened inside ${open.name}`);
      open = { name: o[1], start: i };
    } else if (c) {
      if (!open || open.name !== c[1]) errors.push(`line ${i + 1}: ${c[1]} closed but not open`);
      else found.push({ ...open, end: i });
      open = null;
    }
  });
  if (open) errors.push(`${open.name} is never closed`);
  for (const b of found) if (!TABLES[b.name]) errors.push(`${b.name}: no such table`);
  for (const n of TABLE_NAMES) {
    const k = found.filter((b) => b.name === n).length;
    if (k !== 1) errors.push(`${n}: ${k === 0 ? 'missing' : `${k} blocks`}`);
  }
  return { lines, found, errors };
}

/** The document with every block rendered, and the names of the blocks that changed. */
export function render(text, D) {
  const { lines, found, errors } = blocks(text);
  if (errors.length) return { errors };
  const out = [];
  const changed = [];
  let at = 0;
  for (const b of found) {
    out.push(...lines.slice(at, b.start + 1));
    const now = renderTable(b.name, D);
    if (lines.slice(b.start + 1, b.end).join('\n') !== now) changed.push(b.name);
    out.push(now);
    at = b.end;
  }
  out.push(...lines.slice(at));
  return { text: out.join('\n'), changed, errors: [] };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (flag, fallback) => (args.includes(flag) ? resolve(args[args.indexOf(flag) + 1]) : fallback);
  const doc = opt('--doc', DOC);
  const data = opt('--data', DATA);
  const text = readFileSync(doc, 'utf8');
  const result = render(text, readData(data));
  if (result.errors.length) {
    for (const e of result.errors) console.error(`eval-report: ${e}`);
    process.exit(2);
  }
  if (args.includes('--check')) {
    if (result.changed.length) {
      console.log(`${doc}: not what eval-report.mjs renders; drift in ${result.changed.join(', ')}`);
      process.exit(1);
    }
    console.log(`${doc}: as rendered (${TABLE_NAMES.length} blocks)`);
    return;
  }
  writeFileSync(doc, result.text);
  console.log(`${doc}: rendered ${TABLE_NAMES.length} blocks${result.changed.length ? `; changed ${result.changed.join(', ')}` : '; no change'}`);
}

// Compared through realpath: a symlinked path to this file still runs it (EVAL-OW follow-up 3).
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) main();
