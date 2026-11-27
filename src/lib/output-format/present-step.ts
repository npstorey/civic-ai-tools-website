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
 * WHAT THE RECORD STATES (`presentation`): the last accepted call's outcome; with none, the last refused call's; with
 * no call at all, `no-result-named` ("No map: the AI did not make a choice this site could use."). A refusal after an
 * accepted call does not undo it. `counts` are carried when rows were read (accepted), and not on `no-result-named` or
 * `result-failed`, where no rows were read.
 */
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { PresentStep, PresentStepContext, PresentStepResult, ToolCallRecord } from '../model-loop/run-tool-loop.ts';
import { buildPlainMap, columnsOfRows, datasetOfCall, MAP_POINT_CAP, rowsOfResult, type MapPresentation, type NoMapReason } from './plain-map.ts';
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
  `- Then call ${PRESENT_RESULT_TOOL_NAME} once, with \`result\` set to the number of that tool call in this run ` +
    '(1 for your first tool call, 2 for the second, counting every tool call you made) and `label` set to the column ' +
    'that names each row.',
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
            description: 'The number of the tool call whose rows to map: 1 for your first tool call in this run, 2 for the second, counting every tool call.',
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

/** The calls a refusal can point the AI to: those a source answered with rows. */
function callsWithRows(context: PresentStepContext): number[] {
  const numbers: number[] = [];
  context.calls.forEach((call, i) => {
    const text = context.results[i];
    if (!call.failed && text !== undefined && rowsOfResult(text) !== undefined) numbers.push(i + 1);
  });
  return numbers;
}

function refusedResult(context: PresentStepContext): string {
  const usable = callsWithRows(context);
  const which = usable.length === 0
    ? ' None of your tool calls so far returned rows.'
    : ` ${usable.length === 1 ? 'Call' : 'Calls'} ${usable.join(', ')} returned rows.`;
  return `result must be the number of one of your earlier tool calls that returned rows, counting every tool call from 1.${which} Nothing was mapped.`;
}

function acceptedText(n: number, presented: MapPresentation): string {
  const counts = presented.counts!;
  if (presented.outcome.drawn) {
    const beyond = counts.beyondCap > 0
      ? ` The map shows at most ${MAP_POINT_CAP.toLocaleString('en-US')} points, so ${counts.beyondCap} located rows are not shown.`
      : '';
    return `Mapped ${counts.drawn} of ${counts.returned} rows from call ${n}.${beyond} This site draws the map beside your answer, so do not list the coordinates in it.`;
  }
  if (presented.outcome.reason === 'no-location-columns') {
    return `Call ${n} returned no location column, so nothing was mapped. To map rows, query them with their location columns, then call present_result again.`;
  }
  return counts.returned === 0
    ? `Call ${n} returned no rows, so nothing was mapped.`
    : `None of the ${counts.returned} rows from call ${n} had a location, so nothing was mapped.`;
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
      if (typeof label !== 'string') return refuse('no-result-named', 'label must be the name of one of the columns that call returned. Nothing was mapped.');
      const text = context.results[result - 1];
      const rows = call.failed || text === undefined ? undefined : rowsOfResult(text);
      if (!rows) return refuse('result-failed', `Call ${result} did not return rows this site could read, so nothing was mapped.`);
      const columns = columnsOfRows(rows);
      if (rows.length > 0 && !columns.includes(label)) {
        return refuse('no-result-named', `label must be one of the columns call ${result} returned: ${columns.join(', ')}. Nothing was mapped.`);
      }
      const presented = buildPlainMap({ rows, label, dataset: datasetOfCall(call) });
      lastAccepted = presented;
      return { outcome: 'accepted', text: acceptedText(result, presented) };
    },
    presentation() {
      return lastAccepted ?? lastRefused ?? { outcome: { drawn: false, reason: 'no-result-named' } };
    },
  };
}
