/**
 * The site's `present_result` step, and what a run in a map format is composed with (OF3a, Sprint OF-1, website #810;
 * G0-3 = A, S3, S6 = A, S7; harness 0.16.0, hub ADR-0033 amendment 6).
 *
 * THE COMPOSITION. A run asked in a map format (`isMapFormat`) is composed with two things more, and a run in "Auto",
 * or in a format that is not a map, with nothing: `withOutputFormatGuidance` and `withPresentTool` hand back the same
 * prompt and the same tools array, so every byte such a run sends is what it sent before formats existed.
 *   - The prompt gains `MAP_FORMAT_GUIDANCE` at its end, on every request (the routes and the in-loop routing apply it
 *     wherever the lock section is applied): a count or a trend cannot be mapped, so the AI is asked to fetch the
 *     located rows behind it and to name them through the step (OF0 item 2: 1 of 71 records used points).
 *   - The tools gain `present_result`, after every source's tool. A source's tool of that name, in either spelling,
 *     is refused here (`PresentToolNameError`): the router reserves the name only from OF4's release (7171090588).
 *
 * THE STEP (`createPresentStep`). The AI names a call of the run (`result`, its number counting every tool call from
 * 1) and one of that call's columns (`label`). Each is an identifier, checked against the run's own results (S3):
 *   - `result` that is not a whole number naming an earlier call, or that names one of the site's own steps, is
 *     refused, `no-result-named`;
 *   - `label` that is not text is refused, `no-result-named`;
 *   - a named call that failed, or whose result is not rows, is refused, `result-failed`;
 *   - `label` that is not one of the result's columns is refused, `no-result-named` (with no rows there are no
 *     columns to check it against, and the step is accepted with nothing drawn);
 *   - otherwise the step is accepted and the map is built from the rows (`plain-map.ts`).
 * A refusal draws nothing, tells the AI why in one line, and lets it call again.
 *
 * THE NUMBERS (OF3-FX1, website #810). The AI is not asked to count: under a present step the loop begins every answer
 * it receives with that call's number (`callNumberLine`), and the guidance and the tool ask for the number shown. Every
 * reply names calls the same way, by number, tool, dataset and row count (`callIdentity`): a refusal lists each call
 * that returned rows, and an acceptance names the call it mapped and asks the AI to call again if that is not the
 * query its answer reports. A later accepted choice replaces an earlier one (below).
 *
 * WHAT THE RECORD STATES (`presentation`): the last accepted call's outcome; with none, the last refused call's; with
 * no call at all, `no-result-named` ("No map: the AI did not make a choice this site could use."). A refusal after an
 * accepted call does not undo it. `counts` are carried when rows were read (accepted), and not on `no-result-named` or
 * `result-failed`, where no rows were read.
 */
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { callNumberLine, type PresentStep, type PresentStepContext, type PresentStepResult, type ToolCallRecord } from '../model-loop/run-tool-loop.ts';
import { buildPlainMap, columnsOfRows, datasetOfCall, MAP_POINT_CAP, rowsOfResult, UNNAMED_DATA, type MapPresentation, type NoMapReason } from './plain-map.ts';
import { isMapFormat, type OutputFormatRef } from './registry.ts';

/** The step's tool name and operation type (S7). */
export const PRESENT_RESULT_TOOL_NAME = 'present_result';

/** The site's own steps, which return no rows. */
const SITE_STEPS = new Set(['load_source', 'find_source', PRESENT_RESULT_TOOL_NAME]);

/**
 * What a map format adds to the end of the system prompt, its separator included, on every request. Model-facing
 * text, not a reader's sentence.
 */
export const MAP_FORMAT_GUIDANCE = [
  '',
  '',
  '## Output format: Map',
  '',
  'The reader asked for a map beside your written answer. This site draws the map itself, from the rows one of your ' +
    'tool calls returns; nothing you write is drawn.',
  '- A count, a total or a trend cannot be mapped. Once you have what your answer needs, make one more query that ' +
    'returns the located rows behind it: the individual rows, each with its location columns (latitude and longitude, ' +
    `or a point column) and a column that names it, at most ${MAP_POINT_CAP.toLocaleString('en-US')} rows.`,
  `- Every tool result you receive begins with its call number in this run, for example ${callNumberLine(3).trim()}. ` +
    `Then call ${PRESENT_RESULT_TOOL_NAME} once, with \`result\` set to the number shown at the start of that query's ` +
    'result and `label` set to the column that names each row. Use the number shown; do not count your tool calls, ' +
    'since this site\'s own steps are numbered too.',
  `- This site's reply names the call it mapped: its number, tool, dataset and row count. If that is not the query ` +
    `your answer reports, call ${PRESENT_RESULT_TOOL_NAME} again with the number shown on that query's result.`,
  '- Write your answer as you would without a map. Do not list coordinates in it: the map shows them.',
].join('\n');

/** The step's tool: `{ result, label }`, both required, both identifiers. A new object on every call. */
export function presentResultTool(): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: PRESENT_RESULT_TOOL_NAME,
      description:
        'Name the rows this site should map beside your answer. This site checks both values against your earlier ' +
        'tool calls and draws the map from that call\'s rows; it never draws anything you write.',
      parameters: {
        type: 'object',
        properties: {
          result: {
            type: 'integer',
            minimum: 1,
            description: `The call number shown at the start of the tool result whose rows to map, as in ${callNumberLine(3).trim()}. Use the number shown; do not count your tool calls.`,
          },
          label: {
            type: 'string',
            description: 'The column of that call\'s rows that names each row, shown beside its point.',
          },
        },
        required: ['result', 'label'],
        additionalProperties: false,
      },
    },
  };
}

/** A source's tool named `present_result`, in either spelling, offered beside the site's own (criterion 5). */
export class PresentToolNameError extends Error {
  readonly toolName: string;
  constructor(toolName: string) {
    super(`a source's tool is named ${JSON.stringify(toolName)}; present_result is this site's own step in a map format`);
    this.name = 'PresentToolNameError';
    this.toolName = toolName;
  }
}

const namesPresentResult = (tool: ChatCompletionTool): boolean =>
  tool.type === 'function' && (tool.function.name === PRESENT_RESULT_TOOL_NAME || tool.function.name.endsWith(`__${PRESENT_RESULT_TOOL_NAME}`));

/** The run's tools: `tools` itself unless the run is in a map format; then `tools`, then `present_result`. Refuses a
 *  source's tool of that name (`PresentToolNameError`). */
export function withPresentTool(tools: ChatCompletionTool[], format: OutputFormatRef | undefined): ChatCompletionTool[] {
  if (!format || !isMapFormat(format)) return tools;
  const taken = tools.find(namesPresentResult);
  if (taken && taken.type === 'function') throw new PresentToolNameError(taken.function.name);
  return [...tools, presentResultTool()];
}

/** The run's system prompt: `prompt` itself unless the run is in a map format; then `prompt`, then the guidance. */
export function withOutputFormatGuidance(prompt: string, format: OutputFormatRef | undefined): string {
  return format && isMapFormat(format) ? `${prompt}${MAP_FORMAT_GUIDANCE}` : prompt;
}

/** The present step of one run, and what it presented. */
export interface RunPresentStep extends PresentStep {
  /** What the run's record states: see this file's header. */
  presentation(): MapPresentation;
}

const isWholeNumber = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

const rowCount = (n: number): string => `${n} ${n === 1 ? 'row' : 'rows'}`;

/**
 * How the step's replies identify a call (OF3-FX1, website #810): "call {n} ({tool}, {dataset}, {rows})", the dataset
 * by `getDatasetName` with its id beside a known name, so the AI can check that a number is the query its answer
 * reports. Model-facing text, never a reader's sentence.
 */
function callIdentity(n: number, call: ToolCallRecord, rows: number | undefined): string {
  const id = call.args.dataset_id ?? call.args.resource_id;
  const named = datasetOfCall(call);
  const dataset = typeof id === 'string' && id.length > 0 && named !== `dataset ${id}` && named !== UNNAMED_DATA ? `${named} (${id})` : named;
  return `call ${n} (${call.name}, ${dataset}${rows === undefined ? '' : `, ${rowCount(rows)}`})`;
}

/** Each call a source answered with rows, identified (`callIdentity`): what every refusal points the AI to. */
function callsWithRows(context: PresentStepContext): string {
  const usable: string[] = [];
  context.calls.forEach((call, i) => {
    const text = context.results[i];
    const rows = call.failed || text === undefined ? undefined : rowsOfResult(text);
    if (rows !== undefined) usable.push(callIdentity(i + 1, call, rows.length));
  });
  return usable.length === 0
    ? ' None of your tool calls so far returned rows.'
    : ` Calls that returned rows: ${usable.join('; ')}.`;
}

function refusedResult(context: PresentStepContext): string {
  return `result must be the call number shown at the start of one of your earlier tool results that returned rows.${callsWithRows(context)} Nothing was mapped.`;
}

const CALL_AGAIN = `If that is not the query your answer reports, call ${PRESENT_RESULT_TOOL_NAME} again with the number shown on that query's result.`;

function acceptedText(n: number, call: ToolCallRecord, presented: MapPresentation): string {
  const counts = presented.counts!;
  const which = callIdentity(n, call, counts.returned);
  if (presented.outcome.drawn) {
    const beyond = counts.beyondCap > 0
      ? ` The map shows at most ${MAP_POINT_CAP.toLocaleString('en-US')} points, so ${counts.beyondCap} located rows are not shown.`
      : '';
    return `Mapped ${counts.drawn} of ${rowCount(counts.returned)} from ${which}.${beyond} ${CALL_AGAIN} This site draws the map beside your answer, so do not list the coordinates in it.`;
  }
  if (presented.outcome.reason === 'no-location-columns') {
    return `Nothing was mapped from ${which}: it returned no location column. To map rows, query them with their location columns, then call ${PRESENT_RESULT_TOOL_NAME} again. ${CALL_AGAIN}`;
  }
  return counts.returned === 0
    ? `Nothing was mapped from ${which}: it returned no rows. ${CALL_AGAIN}`
    : `Nothing was mapped from ${which}: none of its rows had a location. ${CALL_AGAIN}`;
}

/** A new present step for one run. */
export function createPresentStep(): RunPresentStep {
  let lastAccepted: MapPresentation | undefined;
  let lastRefused: MapPresentation | undefined;
  const refuse = (reason: NoMapReason, text: string): PresentStepResult => {
    lastRefused = { outcome: { drawn: false, reason } };
    return { outcome: 'refused', text };
  };
  return {
    toolName: PRESENT_RESULT_TOOL_NAME,
    present(args, context) {
      const result = args?.result;
      const label = args?.label;
      if (!isWholeNumber(result) || result < 1 || result > context.calls.length) return refuse('no-result-named', refusedResult(context));
      const call: ToolCallRecord = context.calls[result - 1];
      if (SITE_STEPS.has(call.operationType ?? '') || SITE_STEPS.has(call.name)) return refuse('no-result-named', refusedResult(context));
      if (typeof label !== 'string') return refuse('no-result-named', `label must be the name of one of the columns that call returned. Nothing was mapped.${callsWithRows(context)}`);
      const text = context.results[result - 1];
      const rows = call.failed || text === undefined ? undefined : rowsOfResult(text);
      if (!rows) return refuse('result-failed', `C${callIdentity(result, call, undefined).slice(1)} did not return rows this site could read, so nothing was mapped.${callsWithRows(context)}`);
      const columns = columnsOfRows(rows);
      if (rows.length > 0 && !columns.includes(label)) {
        return refuse('no-result-named', `label must be one of the columns ${callIdentity(result, call, rows.length)} returned: ${columns.join(', ')}. Nothing was mapped.${callsWithRows(context)}`);
      }
      const presented = buildPlainMap({ rows, label, dataset: datasetOfCall(call) });
      lastAccepted = presented;
      return { outcome: 'accepted', text: acceptedText(result, call, presented) };
    },
    presentation() {
      return lastAccepted ?? lastRefused ?? { outcome: { drawn: false, reason: 'no-result-named' } };
    },
  };
}
