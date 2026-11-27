/**
 * The map part's model (OF3b, Sprint OF-1, website #810; criteria 8 to 11): what the answer view shows beside a
 * map-format answer, built from a run's trace or from a record's bytes, and nothing else.
 *
 * TWO SOURCES, ONE SHAPE.
 *   - A run (`mapPartFromTrace`): the root span's `analysis.output_format` names a map format and its
 *     `analysis.output_format_result` states what was presented, checked by `record.ts`'s reader, the one the packager
 *     uses. The part carries the plot, the count line, the table and "Download map data" (the map data as the record
 *     will keep it), or W8's sentence.
 *   - A record (`mapPartFromRecord`): `extensions["org.civicaitools.output-format"]`. The part carries "Output format:
 *     {name}", the line saying the page draws no map, the count line and the table, or W8's sentence; no plot and no
 *     download (K4 = A; the seat's fold 3). A record with no such key has no part: absence is "not recorded", never
 *     "Auto".
 *
 * ONLY WHAT IS DRAWN. The part receives each point's id, coordinates and name, the counts' sentences and the dataset's
 * name; the record page passes no other byte of the extension to the client (the map's free-text fields are not read).
 * Every value is rendered as text by React, so markup in a row's name shows as text.
 *
 * THE DATASET. The call the presented rows came from is the last accepted `present_result` call's `result` (the record
 * states the last accepted call's outcome, `present-step.ts`), named as the map's own name was built; a call that named
 * none is "the data the AI chose" (OF3a's stand-in, kept here by the seat's 7175461805).
 *
 * Pure and client-safe: no React, no DOM, no `node:` module, nothing from the trace builder.
 */
import { OUTPUT_FORMAT_EXTENSION_KEY, isMapFormat, outputFormatLabel } from './registry.ts';
import { outputFormatOfTrace, outputFormatResultOfTrace } from './record.ts';
import { UNNAMED_DATA, type MapPresentation, type PlainMapSpec } from './plain-map.ts';
import { PRESENT_STEP_NAME } from './attribute-names.ts';
import { presentedDatasetName } from '../streaming.ts';
import {
  RECORD_MAP_NOT_SHOWN,
  mapAltText,
  mapCaption,
  mapCountLine,
  mapLabelLine,
  mapRowLine,
  mapStepLine,
  noMapSentence,
  recordFormatLine,
} from './map-words.ts';

/** One point the plot and the table draw. */
export interface MapPoint {
  id: string;
  longitude: number;
  latitude: number;
  /** The row's label column's value, as text; absent when the row carried none. */
  name?: string;
}

/** What was presented, in the reader's words. */
export type MapOutcomePart =
  | {
      kind: 'drawn'; countLine: string; caption: string; alt: string; points: MapPoint[];
      /** Under the table (fold 6): what "Row" counts, and, when the call's label column is known, what "Label" holds. */
      rowLine: string;
      labelLine?: string;
    }
  | { kind: 'none'; sentence: string };

/** The map part. */
export interface MapPartModel {
  /** `run`: plot, table and download; `record`: the format line, the not-shown line and the table, no plot. */
  surface: 'run' | 'record';
  /** The record: "Output format: {name}". */
  formatLine?: string;
  /** The record: "This page lists the mapped rows. It does not show the map." (C2a = A). */
  notShownLine?: string;
  /** Absent on a record whose run recorded no outcome (the key holds `preset` alone). */
  outcome?: MapOutcomePart;
  /** The run: the map data as the record keeps it, for "Download map data". */
  download?: { fileName: string; json: string };
  /** W10's steps line for the map step. */
  stepLine?: string;
}

/** A call as both a run and a record state it, for the dataset reading. */
interface CallLike {
  name?: string;
  operationType?: string;
  args?: Record<string, unknown>;
  presentOutcome?: string;
}

const isPresent = (call: CallLike): boolean => call.operationType === PRESENT_STEP_NAME || call.name === PRESENT_STEP_NAME;

const lastAccepted = (calls: readonly CallLike[]): CallLike | undefined =>
  [...calls].reverse().find((c) => isPresent(c) && c.presentOutcome === 'accepted');

/** The label column the presented rows were labelled by: the last accepted present call's `label` argument (fold 6). */
export function presentedLabelColumn(calls: readonly CallLike[]): string | undefined {
  const label = lastAccepted(calls)?.args?.label;
  return typeof label === 'string' && label.length > 0 ? label : undefined;
}

/** The dataset the presented rows came from: see the header. */
export function presentedDataset(calls: readonly CallLike[]): string {
  const accepted = lastAccepted(calls);
  const named = accepted ? presentedDatasetName(accepted.args ?? {}, calls.map((c) => ({ args: c.args ?? {} }))) : undefined;
  return named ?? UNNAMED_DATA;
}

/** A point's name as text: the schema allows text, a number or a boolean. */
function nameText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** The points of a map, read field by field: id, coordinates and name only. */
export function pointsOfMap(map: Pick<PlainMapSpec, 'features'>): MapPoint[] {
  return map.features.map((f) => {
    const [longitude, latitude] = f.geometry.coordinates;
    const name = nameText((f.properties as Record<string, unknown> | undefined)?.name);
    return { id: String(f.id), longitude, latitude, ...(name !== undefined ? { name } : {}) };
  });
}

/** The outcome in the reader's words (W7, W8, W9), from what was presented and the dataset's name. */
export function mapOutcomePart(presented: MapPresentation, dataset: string, labelColumn?: string): MapOutcomePart {
  if (presented.outcome.drawn && presented.counts && presented.map && presented.map.features.length > 0) {
    const c = presented.counts;
    return {
      kind: 'drawn',
      countLine: mapCountLine(c),
      caption: mapCaption(c.drawn, dataset),
      alt: mapAltText(c.drawn, c.withoutLocation, dataset),
      points: pointsOfMap(presented.map),
      rowLine: mapRowLine(c.returned),
      ...(labelColumn !== undefined ? { labelLine: mapLabelLine(labelColumn) } : {}),
    };
  }
  const why = presented.outcome.drawn ? 'no-located-rows' : presented.outcome.reason;
  return { kind: 'none', sentence: noMapSentence(why, presented.counts?.returned) };
}

/** W10's steps line: "This site mapped {drawn} of {returned} rows from {dataset}", or W8's sentence. */
export function mapStepWords(presented: MapPresentation, dataset: string): string {
  if (presented.outcome.drawn && presented.counts) return mapStepLine(presented.counts.drawn, presented.counts.returned, dataset);
  const part = mapOutcomePart(presented, dataset);
  return part.kind === 'none' ? part.sentence : part.countLine;
}

/** The file "Download map data" saves. */
export const MAP_DATA_FILE_NAME = 'map-data.json';

/** A run's map part, from its trace and its calls; null under "Auto", in a format that is not a map, or before the
 *  trace states an outcome (a run that did not complete states none). A trace that cannot be read has no part. */
export function mapPartFromTrace(trace: unknown, calls: readonly CallLike[]): MapPartModel | null {
  let presented: MapPresentation | undefined;
  try {
    const format = outputFormatOfTrace(trace);
    if (!format || !isMapFormat(format)) return null;
    presented = outputFormatResultOfTrace(trace);
  } catch {
    return null;
  }
  if (!presented) return null;
  const dataset = presentedDataset(calls);
  return {
    surface: 'run',
    outcome: mapOutcomePart(presented, dataset, presentedLabelColumn(calls)),
    stepLine: mapStepWords(presented, dataset),
    ...(presented.map ? { download: { fileName: MAP_DATA_FILE_NAME, json: JSON.stringify(presented.map, null, 2) } } : {}),
  };
}

/** A record's queries, as the dataset reading needs them. */
interface RecordQueryLike {
  tool?: string;
  operationType?: string;
  arguments?: Record<string, unknown>;
  presentOutcome?: string;
}

/** Each present span's `tool.present_outcome`, in span order; empty for a trace that cannot be read (a BlobRef). */
export function presentOutcomesOfTrace(trace: unknown): Array<string | undefined> {
  const spans = (trace as { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: unknown }> }> } | null | undefined)
    ?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans;
  if (!Array.isArray(spans)) return [];
  const attr = (span: { attributes?: Array<{ key?: unknown; value?: { stringValue?: unknown } }> }, key: string): unknown =>
    span.attributes?.find((a) => a?.key === key)?.value?.stringValue;
  return (spans as Array<{ name?: unknown; attributes?: Array<{ key?: unknown; value?: { stringValue?: unknown } }> }>)
    .filter((span) => span?.name === 'mcp_tool_call' && attr(span, 'tool.operation_type') === PRESENT_STEP_NAME)
    .map((span) => {
      const v = attr(span, 'tool.present_outcome');
      return typeof v === 'string' ? v : undefined;
    });
}

/** The format's name on the record page: the registry's, or the record's own id for a format this site does not know. */
function formatName(preset: { id?: unknown; version?: unknown }): string | null {
  if (typeof preset.id !== 'string' || typeof preset.version !== 'string') return null;
  return outputFormatLabel({ id: preset.id, version: preset.version }) ?? preset.id;
}

/**
 * A record's map part, from its bytes: null when the record carries no `org.civicaitools.output-format` key, or one
 * that is not well formed (nothing about the format is shown then, as for a record with no key).
 */
export function mapPartFromRecord(pkg: { extensions?: Record<string, unknown>; queries?: readonly RecordQueryLike[]; trace?: unknown }): MapPartModel | null {
  const ext = pkg.extensions?.[OUTPUT_FORMAT_EXTENSION_KEY] as Record<string, unknown> | undefined;
  if (ext === null || typeof ext !== 'object') return null;
  const preset = ext.preset as { id?: unknown; version?: unknown } | undefined;
  if (preset === null || typeof preset !== 'object') return null;
  const label = formatName(preset);
  if (label === null) return null;
  const isMap = isMapFormat({ id: String(preset.id), version: String(preset.version) });
  const base: MapPartModel = { surface: 'record', formatLine: recordFormatLine(label) };
  if (!isMap || ext.outcome === undefined) return base;
  const presented = { outcome: ext.outcome, counts: ext.counts, map: ext.map } as MapPresentation;
  // A record's queries do not state a present call's outcome; its trace does, on each present span in call order.
  const outcomes = presentOutcomesOfTrace(pkg.trace);
  let nth = 0;
  const calls = (pkg.queries ?? []).map((q) => {
    const present = q.operationType === PRESENT_STEP_NAME;
    return {
      name: q.tool,
      operationType: q.operationType,
      args: q.arguments ?? {},
      presentOutcome: present ? outcomes[nth++] : undefined,
    };
  });
  const dataset = presentedDataset(calls);
  try {
    const outcome = mapOutcomePart(presented, dataset, presentedLabelColumn(calls));
    // C2a = A: the page lists the mapped rows and draws no map; said only where there are rows to list.
    return { ...base, ...(outcome.kind === 'drawn' ? { notShownLine: RECORD_MAP_NOT_SHOWN } : {}), outcome, stepLine: mapStepWords(presented, dataset) };
  } catch {
    return base;
  }
}
