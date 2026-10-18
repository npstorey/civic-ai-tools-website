// The steps of a run: one per-call field type, the grouping of a run's
// progress events into steps (one group per loop iteration), and the label
// each step carries. Pure: no React, no DOM, no `'use client'` — a function of
// what it is handed, tested under `node --test` like the rest of `src/lib`.
//
// The comparison (`useStreamingComparison`) feeds it the stream's events and
// keeps only its React state plumbing; `ProgressLog` and `ToolCallCard` render
// what it builds. The functions take plain values, not a hook's state, so a
// second reader of the same events (the executed run) and a reader of signed
// calls (the record page) can build steps the same way.
//
// Every tool-name read goes through `../mcp/operation-types.ts`'s readers
// (`isTool`, `upstreamToolName`, `deriveOperationType`), so a name is read the
// same in either spelling (`get_data`, `socrata__get_data`). The labels compare
// operation types (search, query, …), never names.
//
// Relative, extension-carrying imports (the convention of src/lib since #345):
// the test runner has no path mapping.

import { deriveOperationType, isTool, upstreamToolName } from '../mcp/operation-types.ts';
import {
  generateQueryIntentLabel,
  generateToolReason,
  getDatasetName,
  reasonWithoutIdentifier,
  searchSubject,
} from '../streaming.ts';
import { describeQueryOutcome } from '../evidence/query-step.ts';
// Type-only: erased at compile time. The kind vocabulary is declared once,
// beside the table that turns it into reader-facing copy.
import type { ToolFailureKind } from '../notebook-author/tool-to-cell.ts';

// --- The per-call fields -----------------------------------------------------

/**
 * One call, as every step reader reads it: the fields the comparison's record
 * (`ToolCall`), the executed run's captured call, the card's props and the
 * signed query entry have in common. No field is renamed from the wire.
 */
export interface StepCall {
  /**
   * Absent — never a stand-in — when the record the call was built from did
   * not carry a tool name (#384: a trace event from before the wire carried
   * one). The loop always records a name, so a live call has one; the readers
   * that can meet a replayed call say "unnamed" in words.
   */
  name?: string;
  operationType?: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  duration_ms?: number;
  reason?: string;
  /**
   * True when the loop recorded the call as rejected. Two readers, one field.
   *
   * F5 (#384 P3): read off the `complete` event unchanged and posted to the
   * publish route unchanged, so the signed package can say the call failed.
   *
   * F3 (#384 P4): the skeleton notebook generator STATES a rejection instead of
   * writing a live fetch cell for a request that returned nothing —
   * `notebook.ts`'s `planQueryStep` reads it, and the executed-notebook path has
   * read the same signal since #321.
   *
   * The card (`ToolCallCard`) states the outcome through `describeQueryOutcome`
   * — the record page's formatter, one sentence for one fact — and mints no
   * data links for a request that returned nothing (#384 P8, F2).
   *
   * Absent is absent: it means the call was not recorded as failed, never that
   * it succeeded. Since P3 the chat-flow path does carry it (`streaming.ts`'s
   * `CompleteEvent.tools_called[]`), so a rejection now reaches both readers;
   * a record built from a source that never carried the field still tells them
   * nothing, and neither invents an answer for it.
   */
  failed?: boolean;
  /** Why it failed, when `failed` is true. Absent is read as `unknown`. */
  failureKind?: ToolFailureKind;
}

/**
 * The comparison's record of one call: what the `complete` event's
 * `tools_called[]` carries, stored unchanged and posted unchanged to
 * `/api/records`. It is a `StepCall`, field for field.
 */
export type ToolCall = StepCall;

// --- The progress log and its groups ------------------------------------------

export interface ProgressLogEntry {
  message: string;
  timestamp: number;
  isComplete?: boolean;
  duration_ms?: number;
  phase?: string;
  iteration?: number;
  args?: Record<string, unknown>;
  /** As on the progress event (see `ProgressEvent`, #384). */
  toolName?: string;
  operationType?: string;
  /**
   * The loop recorded the call as rejected (#384 P8, F2): on the end and
   * outcome events as the wire carries them, and copied onto the paired
   * `tool_start` entry so the step itself reads as rejected. Absent is absent.
   */
  failed?: boolean;
  failureKind?: ToolFailureKind;
}

/** One step: the entries of one loop iteration, and the label they earn. */
export interface ProgressGroup {
  iteration: number;
  label: string;
  entries: ProgressLogEntry[];
  isComplete: boolean;
  totalDuration_ms?: number;
}

/** A step beside the calls it made, in call order. */
export interface EnrichedGroup<C extends StepCall = StepCall> {
  group: ProgressGroup;
  toolCalls: C[];
}

/** The label a step carries while its calls are still running. */
export const OPEN_STEP_LABEL = 'Gathering data';

/**
 * Pair each step with its calls: a group's `tool_start` entries are its calls,
 * taken from `toolsCalled` in order.
 */
export function mapGroupsToToolCalls<C extends StepCall>(groups: ProgressGroup[], toolsCalled: C[]): EnrichedGroup<C>[] {
  const result: EnrichedGroup<C>[] = [];
  let toolIndex = 0;

  for (const group of groups) {
    // Count tool_start entries in this group to know how many tool calls it contains
    const toolStartCount = group.entries.filter(e => e.phase === 'tool_start').length;
    const groupToolCalls = toolsCalled.slice(toolIndex, toolIndex + toolStartCount);
    toolIndex += toolStartCount;
    result.push({ group, toolCalls: groupToolCalls });
  }

  return result;
}

// --- Labels ------------------------------------------------------------------

// Known dataset names for rich labels
const DATASET_NAMES: Record<string, string> = {
  'erm2-nwe9': '311 Service Requests',
  '43nn-pn8j': 'Restaurant Inspections',
  'wvxf-dwi5': 'Housing Violations',
  'v6vf-nfxy': '311 Service Requests',
  'vw6y-z8j6': '311 Cases',
};

/**
 * The operation type an entry carries: the one the loop recorded, else the
 * loop's own derivation from the recorded name (`deriveOperationType` — the
 * single derivation, never a second one, and never from the message text);
 * nothing for an entry that carries neither (#384).
 */
function entryOperationType(entry: ProgressLogEntry): string | undefined {
  if (entry.operationType) return entry.operationType;
  if (entry.toolName) return deriveOperationType(entry.toolName, entry.args ?? {});
  return undefined;
}

// Generate a rich label from what the entries recorded — the tool name and
// operation type first, then the arguments — when available
function generateRichLabel(entries: ProgressLogEntry[], previousEntries?: ProgressLogEntry[]): string | null {
  const toolStarts = entries.filter(e => e.phase === 'tool_start' && e.args);
  if (toolStarts.length === 0) return null;

  const first = toolStarts[0];
  const firstArgs = first.args!;
  const opType = entryOperationType(first);
  const datasetId = firstArgs.dataset_id as string | undefined;
  const datasetName = datasetId ? (DATASET_NAMES[datasetId] || getDatasetName(datasetId)) : null;

  if (opType === 'catalog') {
    const query = firstArgs.query as string | undefined;
    return query ? `Searching for datasets about "${query}"` : 'Searching the data catalog';
  }

  if (opType === 'search') {
    const query = firstArgs.query as string | undefined;
    const subject = searchSubject(first.toolName).plural;
    return query ? `Searching for ${subject} about "${query}"` : `Searching for ${subject}`;
  }

  if (opType === 'metadata' && datasetName) {
    return `Understanding ${datasetName} structure`;
  }

  if (opType === 'query') {
    if (toolStarts.length > 1) {
      return 'Querying multiple datasets';
    }
    // Use intent label system with previous context
    const previousCalls = (previousEntries || [])
      .filter(e => e.phase === 'tool_start' && e.args)
      .map(e => ({ args: e.args! }));
    return generateQueryIntentLabel(firstArgs, previousCalls).label;
  }

  if (opType === 'metrics' && datasetName) {
    return `Checking ${datasetName} statistics`;
  }

  // `fetch` derives to no operation type by design (mcp/operation-types.ts);
  // the label names what was asked for and asserts nothing about the answer.
  if (isTool(first.toolName, 'fetch')) {
    const id = firstArgs.id as string | undefined;
    return id ? `Looking up ${id}` : 'Looking up one item';
  }

  return null;
}

/** A human-readable label for one step: the calls of one iteration. */
export function generateGroupLabel(entries: ProgressLogEntry[], previousEntries?: ProgressLogEntry[]): string {
  const richLabel = generateRichLabel(entries, previousEntries);
  if (richLabel) return richLabel;

  const toolStarts = entries.filter(e => e.phase === 'tool_start');
  if (toolStarts.length === 0) return 'Processing';

  // An entry that names its tool but has no rich label above is a call whose
  // operation these labels do not describe. Its label repeats what the record
  // says; the keyword matching below is for entries that recorded nothing —
  // it must never overrule a name (#384).
  // (`get_data`'s name in user language is "gather data", as in `generateToolReason`.)
  const named = toolStarts.find(e => e.toolName || e.operationType);
  // Read, and shown, by the upstream name in either spelling (#599 W3).
  if (named) return named.toolName && !isTool(named.toolName, 'get_data') ? `Calling ${upstreamToolName(named.toolName)}` : OPEN_STEP_LABEL;

  // Fallback for entries that carry neither a tool name nor an operation type:
  // extract operation types from messages
  const messages = toolStarts.map(e => e.message.toLowerCase());
  const hasCatalog = messages.some(m => m.includes('searching') && m.includes('catalog'));
  const hasMetadata = messages.some(m => m.includes('metadata'));
  const hasQuery = messages.some(m => m.includes('querying') || m.includes('counting') || m.includes('previewing') || m.includes('refining') || m.includes('top'));
  const hasMetrics = messages.some(m => m.includes('metrics'));

  if (hasCatalog && !hasQuery && !hasMetadata) return 'Finding relevant datasets';
  if (hasMetadata && !hasQuery && !hasCatalog) return 'Understanding dataset structure';
  if (hasQuery && toolStarts.length > 1) return 'Querying multiple datasets';
  if (hasQuery) return 'Querying data';
  if (hasMetrics) return 'Checking dataset statistics';

  // Nothing recorded says what these calls were, so the label claims nothing:
  // the same provisional label the group carried while it was open. This
  // branch used to announce a query — a positively wrong label for any group
  // that was not one (#377).
  return OPEN_STEP_LABEL;
}

// --- Accumulation: events in, steps out -----------------------------------------

/** A run's steps so far: the flat log and the groups built from it. */
export interface StepLog {
  progressLog: ProgressLogEntry[];
  progressGroups: ProgressGroup[];
}

/** The fields of one progress event the steps are built from (`ProgressEvent`). */
export interface StepProgressEvent {
  message: string;
  phase?: string;
  iteration?: number;
  args?: Record<string, unknown>;
  duration_ms?: number;
  toolName?: string;
  operationType?: string;
  failed?: boolean;
  failureKind?: ToolFailureKind;
}

/** The sum of a step's recorded call durations, or nothing when none is recorded. */
function totalToolDuration(entries: ProgressLogEntry[]): number | undefined {
  const durations = entries
    .filter(e => e.phase === 'tool_start' && e.duration_ms !== undefined)
    .map(e => e.duration_ms!);
  return durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : undefined;
}

/**
 * Fold one progress event into the steps. `now` stamps the entry the event
 * becomes (the caller's clock; nothing here reads one).
 *
 *   - `tool_start` opens the iteration's step (labelled `OPEN_STEP_LABEL`) or
 *     joins it;
 *   - `tool_complete` carries its duration and outcome onto the `tool_start`
 *     entry it pairs to, by iteration and message;
 *   - `tool_result` appends the outcome's narration to the step;
 *   - `thinking` closes the iteration's step: its label from
 *     `generateGroupLabel`, read against the earlier iterations' entries, and
 *     its total duration;
 *   - anything else is a standalone entry, and marks the entry before it done.
 */
export function applyProgressEvent(log: StepLog, event: StepProgressEvent, now: number): StepLog {
  const { message, duration_ms, phase, iteration, args, toolName, operationType } = event;
  // The rejection the wire carried, if any (#384 P8, F2); absent stays absent.
  const failure = {
    ...(event.failed !== undefined ? { failed: event.failed } : {}),
    ...(event.failureKind !== undefined ? { failureKind: event.failureKind } : {}),
  };
  const newLog = [...log.progressLog];
  const newGroups = log.progressGroups.map(g => ({ ...g, entries: [...g.entries] }));
  const entry: ProgressLogEntry = { message, timestamp: now, duration_ms, phase, iteration, args, toolName, operationType, ...failure };

  if (phase === 'tool_complete' && iteration !== undefined) {
    // The end event's outcome travels onto the start entry it pairs to.
    const outcome = { isComplete: true, duration_ms, ...failure };
    // Update the matching tool_start entry in-place within its group
    const group = newGroups.find(g => g.iteration === iteration);
    if (group) {
      const startIdx = group.entries.findIndex(
        e => e.phase === 'tool_start' && e.message === message && !e.isComplete
      );
      if (startIdx !== -1) {
        group.entries[startIdx] = { ...group.entries[startIdx], ...outcome };
      }
    }
    // Also update in flat log
    const flatIdx = newLog.findIndex(
      e => e.phase === 'tool_start' && e.message === message && !e.isComplete
    );
    if (flatIdx !== -1) {
      newLog[flatIdx] = { ...newLog[flatIdx], ...outcome };
    }
    return { progressLog: newLog, progressGroups: newGroups };
  }

  if (phase === 'tool_result' && iteration !== undefined) {
    // Append result narration to the group
    entry.isComplete = true;
    const group = newGroups.find(g => g.iteration === iteration);
    if (group) {
      group.entries.push(entry);
    }
    newLog.push(entry);
    return { progressLog: newLog, progressGroups: newGroups };
  }

  if (phase === 'thinking' && iteration !== undefined) {
    // Mark the current group as complete
    const group = newGroups.find(g => g.iteration === iteration);
    if (group) {
      group.isComplete = true;
      // Compute total duration from completed tool entries
      const total = totalToolDuration(group.entries);
      if (total !== undefined) {
        group.totalDuration_ms = total;
      }
      const prevEntries = newGroups
        .filter(g => g.iteration < iteration)
        .flatMap(g => g.entries);
      group.label = generateGroupLabel(group.entries, prevEntries);
    }
    // Don't add thinking to flat log or as standalone — it just closes the group
    return { progressLog: log.progressLog, progressGroups: newGroups };
  }

  if (phase === 'tool_start' && iteration !== undefined) {
    // Find or create group for this iteration
    let group = newGroups.find(g => g.iteration === iteration);
    if (!group) {
      group = { iteration, label: OPEN_STEP_LABEL, entries: [], isComplete: false };
      newGroups.push(group);
    }
    group.entries.push(entry);
    newLog.push(entry);
    return { progressLog: newLog, progressGroups: newGroups };
  }

  // Standalone entries (analyze, synthesize, or no phase)
  // Mark previous entry as complete
  if (newLog.length > 0) {
    newLog[newLog.length - 1] = { ...newLog[newLog.length - 1], isComplete: true };
  }
  newLog.push(entry);

  return { progressLog: newLog, progressGroups: newGroups };
}

/**
 * The answer has started: the last log entry is done, and every step still
 * open is closed — its entries done, its label from `generateGroupLabel` read
 * against the steps before it, its total duration. A step already closed is
 * left as it is.
 */
export function closeStepsOnAnswer(log: StepLog): StepLog {
  // Mark any in-progress log entry as complete when tokens start
  const newLog = [...log.progressLog];
  if (newLog.length > 0 && !newLog[newLog.length - 1].isComplete) {
    newLog[newLog.length - 1] = { ...newLog[newLog.length - 1], isComplete: true };
  }

  // Mark all groups as complete
  const allGroups = log.progressGroups;
  const newGroups = allGroups.map((g, gIdx) => {
    if (!g.isComplete) {
      const entries = g.entries.map(e => ({ ...e, isComplete: true }));
      const prevEntries = allGroups.slice(0, gIdx).flatMap(pg => pg.entries);
      return {
        ...g,
        entries,
        isComplete: true,
        label: generateGroupLabel(entries, prevEntries),
        totalDuration_ms: totalToolDuration(entries),
      };
    }
    return g;
  });

  return { progressLog: newLog, progressGroups: newGroups };
}

/**
 * The run is complete: every log entry is done, and every step is closed and
 * labelled again from all its entries; a step's total duration is kept when
 * it already has one.
 */
export function closeStepsOnComplete(log: StepLog): StepLog {
  // Mark all log entries as complete
  const newLog = log.progressLog.map(entry => ({ ...entry, isComplete: true }));

  // Mark all groups as complete
  const completeAllGroups = log.progressGroups;
  const newGroups = completeAllGroups.map((g, gIdx) => {
    const entries = g.entries.map(e => ({ ...e, isComplete: true }));
    const prevEntries = completeAllGroups.slice(0, gIdx).flatMap(pg => pg.entries);
    return {
      ...g,
      entries,
      isComplete: true,
      label: generateGroupLabel(entries, prevEntries),
      totalDuration_ms: g.totalDuration_ms ?? totalToolDuration(entries),
    };
  });

  return { progressLog: newLog, progressGroups: newGroups };
}

/**
 * The run failed: every entry and every step is marked done, so nothing keeps
 * spinning (#178). The labels are left as they were.
 */
export function closeStepsOnError(log: StepLog): StepLog {
  const newLog = log.progressLog.map(entry => ({ ...entry, isComplete: true }));
  const newGroups = log.progressGroups.map(g => ({
    ...g,
    isComplete: true,
    entries: g.entries.map(e => ({ ...e, isComplete: true })),
  }));
  return { progressLog: newLog, progressGroups: newGroups };
}

// --- The step view: what a reader sees of a run's steps --------------------------
//
// The executed run and the record page show a run's steps outside the
// disclosure (LAYOUT-WEB W2 P2, design §4.3 and §5): one step per loop
// iteration on the executed run, one per signed `queries[]` entry on the record
// page. Each call in a step carries two lines, both written here at view time
// from the recorded fields, never stored:
//   - the sentence `generateToolReason` writes from the call's name and
//     arguments, through `reasonWithoutIdentifier` (absent when that drops it);
//   - the outcome `describeQueryOutcome` states.
// The view says once, above the steps, who wrote them (`stepsAuthorLine`).

/** The line above the steps: they are the site's sentences, written from the model's calls. */
export function stepsAuthorLine(instance: string | null | undefined): string | null {
  // RED STUB (W2 P2).
  void instance;
  return null;
}

/**
 * A call as the step view reads it, from a record whose arguments may be
 * absent: the executed run's captured call carries `name` always and `args`
 * only when the route sent them (`CapturedToolCall`), the reverse of
 * `StepCall`. Absent arguments read as none; nothing else is touched, so the
 * call keeps every field it came with.
 */
export function asStepCall<C extends Omit<StepCall, 'args'> & { args?: Record<string, unknown> }>(
  call: C,
): Omit<C, 'args'> & { args: Record<string, unknown> } {
  return { ...call, args: call.args ?? {} };
}

/** The sentence the site writes for one call, or nothing when it would name an identifier. */
export function stepSentence(call: { name?: string; args: Record<string, unknown> }): string | undefined {
  return reasonWithoutIdentifier(generateToolReason(call.args, call.name));
}

/** One call in the step view. */
export interface StepViewCall {
  /** `stepSentence`'s output; absent when the phrase names an identifier. */
  sentence?: string;
  /** `describeQueryOutcome`'s text for the call. */
  outcome: string;
  /** The outcome is a failure (the call was rejected, or its trace marks it refused). */
  failed: boolean;
}

/** One step: its label and its calls, in call order. */
export interface StepViewStep {
  label: string;
  calls: StepViewCall[];
}

/**
 * The steps a reader sees. `unplaced` holds calls whose step cannot be told
 * from what the run recorded (see `pairCallsToSteps`): they are shown, after
 * the steps, never in a step they may not belong to.
 */
export interface StepView {
  steps: StepViewStep[];
  unplaced: StepViewCall[];
}

/** The line under which the step view lists calls it could not place in a step. */
export const UNPLACED_CALLS_LINE = 'Requests whose step the run did not record:';

/** The progress entries' and the calls' agreement on which tool was called. */
function sameTool(entry: ProgressLogEntry, call: StepCall): boolean {
  return entry.toolName !== undefined && entry.toolName === call.name
    && entry.operationType === call.operationType;
}

/** ...and on how it ended: rejected or not, and why. */
function sameCall(entry: ProgressLogEntry, call: StepCall): boolean {
  if (!sameTool(entry, call)) return false;
  if ((entry.failed === true) !== (call.failed === true)) return false;
  return entry.failed !== true || entry.failureKind === call.failureKind;
}

/** Where each call sits among a run's steps, and the entries that learn its arguments. */
export interface StepPairing<C extends StepCall> {
  /** Per step (in `groups` order), the calls known to belong to it, in call order. */
  placed: C[][];
  /** Calls whose step cannot be told from what the run recorded. */
  unplaced: C[];
  /**
   * Per step, its entries; a `tool_start` entry carries the arguments of the
   * call it is known to be, or of the earlier call it is known to repeat.
   */
  entries: ProgressLogEntry[][];
}

/**
 * Place a run's calls in its steps.
 *
 * WHY NOT BY POSITION. The executed run's steps come from the progress lines,
 * one `tool_start` per call the loop made. Its calls come from the
 * `phase_a_tool_call` events, which the route sends once Phase A is over and
 * from which it DROPS a call whose name and arguments equal an earlier one's
 * (`query-notebook/route.ts`, `sentToolCalls`). So a run that repeats an
 * identical call has more `tool_start` lines than calls, and pairing them by
 * position (`mapGroupsToToolCalls`) hands a call to the step before its own.
 *
 * HOW. The calls are the `tool_start` lines with the repeats removed, in
 * order. The progress lines carry no arguments, so a repeat cannot be named
 * from a line alone; what is known is:
 *   - a call sits on a line that names the same tool and operation type and
 *     ended the same way (rejected or not, and the kind);
 *   - a line no call sits on is a repeat, so an EARLIER call names the same
 *     tool and operation type (the outcome may differ: a retry of a rejected
 *     call can succeed and still be dropped).
 * Every assignment of calls to lines that keeps both rules and the call order
 * is a possible history. A call is placed in a step only when it sits in that
 * step in every one of them; otherwise it is unplaced. A line's entry learns a
 * call's arguments only when that call sits on that line in every history, or
 * when the line is a repeat in every history and exactly one earlier call
 * could be the call it repeats. Nothing is guessed.
 */
export function pairCallsToSteps<C extends StepCall>(groups: ProgressGroup[], calls: C[]): StepPairing<C> {
  // RED STUB (W2 P2): pairs by position, the shape the tests show wrong.
  return {
    placed: mapGroupsToToolCalls(groups, calls).map((g) => g.toolCalls),
    unplaced: [],
    entries: groups.map((g) => g.entries.map((e) => ({ ...e }))),
  };
}

function viewCall(call: StepCall): StepViewCall {
  const outcome = describeQueryOutcome({
    failed: call.failed,
    failureKind: call.failureKind,
    resultRows: call.resultSummary?.rows,
    resultColumns: call.resultSummary?.columns,
    duration_ms: call.duration_ms,
  });
  return { sentence: stepSentence(call), outcome: outcome.text, failed: outcome.kind === 'failed' };
}

/** A lone call as a step's only entry, for a run whose steps were not recorded. */
function loneEntry(call: Pick<StepCall, 'name' | 'operationType' | 'args' | 'failed'>, index: number): ProgressLogEntry {
  return {
    message: '',
    timestamp: 0,
    phase: 'tool_start',
    iteration: index + 1,
    args: call.args,
    toolName: call.name,
    operationType: call.operationType,
    ...(call.failed !== undefined ? { failed: call.failed } : {}),
  };
}

/** One step per call, each labelled against the calls before it. */
function oneStepPerCall(calls: StepCall[], outcomeOf: (call: StepCall, index: number) => StepViewCall): StepView {
  const entries = calls.map(loneEntry);
  return {
    steps: calls.map((call, i) => ({
      label: generateGroupLabel([entries[i]], entries.slice(0, i)),
      calls: [outcomeOf(call, i)],
    })),
    unplaced: [],
  };
}

/**
 * The executed run's steps: one per loop iteration, from the progress lines
 * the hook grouped, each with the calls `pairCallsToSteps` places in it and the
 * label `generateGroupLabel` writes over entries that carry those calls'
 * arguments. A call whose step the lines do not settle is listed after the
 * steps, never put in one: with no recorded steps at all, that is every call.
 */
export function buildRunStepView(groups: ProgressGroup[], calls: StepCall[]): StepView {
  const pairing = pairCallsToSteps(groups, calls);
  return {
    steps: groups.map((_, gi) => ({
      label: generateGroupLabel(pairing.entries[gi], pairing.entries.slice(0, gi).flat()),
      calls: pairing.placed[gi].map(viewCall),
    })),
    unplaced: pairing.unplaced.map(viewCall),
  };
}

/** The fields of a signed `queries[]` entry the step view reads. Any richer entry fits. */
export interface RecordStepQuery {
  tool?: string;
  operationType?: string;
  arguments?: Record<string, unknown>;
  resultRows?: number;
  resultColumns?: number;
  duration_ms?: number;
  failed?: boolean;
  failureKind?: string;
}

/**
 * The record page's steps: one per signed `queries[]` entry (a record keeps no
 * iteration), each labelled by `generateGroupLabel` against the entries before
 * it, with the sentence written from the entry's name and arguments and the
 * outcome `describeQueryOutcome` states. `refused` is `readRefusalsFromTrace`'s
 * answer, read by the outcome as section D reads it.
 */
export function buildRecordStepView(queries: readonly RecordStepQuery[], refused: ReadonlySet<number> = new Set()): StepView {
  // RED STUB (W2 P2).
  void queries; void refused; void oneStepPerCall;
  return { steps: [], unplaced: [] };
}
