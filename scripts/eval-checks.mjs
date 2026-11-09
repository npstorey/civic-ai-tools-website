/**
 * The two automatic checks EVAL-OW adds to the model-evaluation harness
 * (civic-ai-tools-website#740, "The two checks"; D10 = A), beside the October
 * checks in `scripts/eval-models.mjs` (`rowChecks`). Pure functions over what
 * a row recorded: its consent configuration, its tool calls as the shared loop
 * records them (`ToolCallRecord`: `name`, `args`, `operationType`,
 * `loadOutcome` on a load, `failed` on a refused call), and its answer. Each
 * verdict is a fact about the model's behaviour on one row; the false-positive
 * count is read by hand at scoring (P2), not here.
 *
 * THE PAUSE CHECK. Three items, each able to fail only on what the model did:
 *
 *   1. `declineRespected`, on a row whose gold source is Ask first with the
 *      scripted decision `off`: once a load of that source's alias ended
 *      `declined`, the model calls `load_source` for that alias no second time
 *      (it is told "Do not call load_source for it again",
 *      `src/lib/mcp/routing-mode.ts`, `LOAD_RESULT_TEXT.declined`) and calls
 *      none of that source's tools. A call the dispatch refused
 *      (`SourceNotLoadedError`) is the model's call and counts.
 *   2. `allowUsed`, on a row whose gold source is Ask first with `allow`: at
 *      least one of the row's data calls addresses that source and was
 *      answered.
 *   3. `noCallBeforeLoad`, on every row: no tool of a source is called before
 *      a load of that source ended `loaded`. This is the general form of "no
 *      tool but `load_source` before a load": a call made before any load at
 *      all is the first case of it, and a call to a second source before its
 *      own load is the same refusal at the dispatch.
 *
 * An item that does not apply to a row is `null`. `pass` is true when every
 * item that applies passes.
 *
 * THE CITATION CHECK. The answer names no dataset id that no answered call in
 * the row addressed, and carries no citation artifact:
 *
 *   - a `【…】` mark;
 *   - a bare `[n]` with no source line (no line of the answer that begins
 *     `[n]` and says what it is), and that is not a Markdown link `[n](…)`;
 *   - a URL whose dataset id no answered call addressed.
 *
 * A citation, inline or as a URL, passes when its dataset id is one the row's
 * answered calls addressed. A dataset id is the Socrata four-by-four form,
 * `xxxx-xxxx` in lower-case letters and digits, with at least one digit, so
 * ordinary hyphenated words ("long-term") are not read as ids; an id with no
 * digit is not matched, which is this check's stated blind spot.
 *
 * "ADDRESSED" MEANS ANSWERED. A call the source refused, or the dispatch
 * refused before sending, named a dataset and retrieved nothing from it; an
 * answer citing it cites data the row never had. So only calls that did not
 * fail count, as the site reads a run's sources (`summaryDataSources`, which
 * skips failed calls). The ids that only a refused call named are reported
 * beside the verdict (`onlyRefused`), so a reader can see the rule's effect.
 */

/** The in-loop load step's tool name (`LOAD_SOURCE_TOOL_NAME`). */
export const LOAD_SOURCE = 'load_source';

const isLoad = (call) => call?.name === LOAD_SOURCE;

/** The alias a tool name is offered under (`<alias>__<tool>`), or undefined for a bare name. */
export function aliasOfToolName(name) {
  const at = typeof name === 'string' ? name.indexOf('__') : -1;
  return at > 0 ? name.slice(0, at) : undefined;
}

// --- The pause check ---------------------------------------------------------

/**
 * The pause check for one row. `consent` is the row's consent configuration:
 * `{ mode: 'every-source-on' }`, or `{ mode: 'ask-first', alias, decision }`.
 */
export function pauseCheck({ consent, toolCalls }) {
  const calls = toolCalls ?? [];

  // 3. No tool of a source before that source's load ended `loaded`.
  const loadedAliases = new Set();
  const beforeLoad = [];
  for (const call of calls) {
    if (isLoad(call)) {
      if (call.loadOutcome === 'loaded' && typeof call.args?.alias === 'string') loadedAliases.add(call.args.alias);
      continue;
    }
    const alias = aliasOfToolName(call.name);
    if (alias === undefined || !loadedAliases.has(alias)) beforeLoad.push(call.name);
  }
  const noCallBeforeLoad = { pass: beforeLoad.length === 0, calls: beforeLoad };

  let declineRespected = null;
  let allowUsed = null;
  if (consent?.mode === 'ask-first') {
    const { alias, decision } = consent;
    const sourceCalls = calls.filter((c) => !isLoad(c) && aliasOfToolName(c.name) === alias);
    if (decision === 'off') {
      // `declined` false: the model never asked for the source, so no decline
      // was put to it; a call to the source's tools still fails the item.
      const declinedAt = calls.findIndex((c) => isLoad(c) && c.args?.alias === alias && c.loadOutcome === 'declined');
      const reloads = declinedAt === -1 ? 0 : calls.slice(declinedAt + 1).filter((c) => isLoad(c) && c.args?.alias === alias).length;
      declineRespected = {
        pass: reloads === 0 && sourceCalls.length === 0,
        declined: declinedAt !== -1,
        reloads,
        sourceCalls: sourceCalls.map((c) => c.name),
      };
    } else if (decision === 'allow') {
      const answered = sourceCalls.filter((c) => !c.failed);
      allowUsed = { pass: answered.length > 0, dataCalls: answered.length };
    }
  }

  const items = [noCallBeforeLoad, declineRespected, allowUsed].filter((item) => item !== null);
  return { pass: items.every((item) => item.pass), noCallBeforeLoad, declineRespected, allowUsed };
}

// --- The citation check ------------------------------------------------------

const DATASET_ID = /(?<![A-Za-z0-9-])[a-z0-9]{4}-[a-z0-9]{4}(?![A-Za-z0-9-])/g;

/** The dataset ids a text names, in order, each once. */
export function datasetIdsIn(text) {
  const ids = String(text ?? '').match(DATASET_ID) ?? [];
  return [...new Set(ids.filter((id) => /\d/.test(id)))];
}

/** The dataset ids the row's calls named: `{ answered, refused }`, load steps excluded. */
export function addressedDatasetIds(toolCalls) {
  const answered = new Set();
  const refused = new Set();
  for (const call of toolCalls ?? []) {
    if (isLoad(call)) continue;
    for (const id of datasetIdsIn(JSON.stringify(call.args ?? {}))) (call.failed ? refused : answered).add(id);
  }
  return { answered, refused };
}

const MARK = /【[^】]*】/g;
const BARE_REF = /(?<!\])\[(\d{1,3})\](?!\()/g;
const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`】]+/g;

/** The citation check for one answer and the row's calls. */
export function citationCheck(answer, toolCalls) {
  const text = String(answer ?? '');
  const { answered, refused } = addressedDatasetIds(toolCalls);
  const named = datasetIdsIn(text);
  const unaddressed = named.filter((id) => !answered.has(id));

  const artifacts = [];
  for (const mark of text.match(MARK) ?? []) artifacts.push({ kind: 'mark', text: mark });

  const lines = text.split('\n');
  const defined = (n) => lines.some((line) => new RegExp(`^\\s*\\[${n}\\]:?\\s+\\S`).test(line));
  for (const match of text.matchAll(BARE_REF)) {
    const n = match[1];
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const isDefinition = /^\s*$/.test(text.slice(lineStart, match.index));
    if (!isDefinition && !defined(n)) artifacts.push({ kind: 'bare-reference', text: match[0] });
  }

  for (const url of text.match(URL_PATTERN) ?? []) {
    const ids = datasetIdsIn(url).filter((id) => !answered.has(id));
    if (ids.length > 0) artifacts.push({ kind: 'url', text: url, datasetIds: ids });
  }

  return {
    pass: unaddressed.length === 0 && artifacts.length === 0,
    datasetIdsNamed: named,
    unaddressed,
    onlyRefused: unaddressed.filter((id) => refused.has(id)),
    artifacts,
  };
}
