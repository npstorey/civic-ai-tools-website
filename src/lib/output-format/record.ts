/**
 * The format a run was asked for, from its trace into its record (OF2, Sprint OF-1, website #810; the seat's S4, S8 and
 * criterion 7).
 *
 * A run in a format other than "Auto" states it on its root span as `analysis.output_format` (`OUTPUT_FORMAT_ATTRIBUTE`,
 * `{ id, version }` as JSON text), written by the route that ran it. At publish the packager reads it back here and
 * writes `extensions["org.civicaitools.output-format"] = { preset: { id, version } }`.
 *
 * WRITTEN FROM THE ROOT SPAN AND NOTHING ELSE. The publish body comes from the browser, and the publish route passes its
 * extensions through as received; so a key of this name in the request is replaced by the root span's, and under
 * "Auto" (no attribute) it is dropped. A request that carries no such key is handed back untouched, the same object, so
 * an "Auto" record's bytes are what they were before formats existed (the legacy hash chain hashes insertion order).
 *
 * An attribute that is present but is not exactly `{ id, version }`, both strings, THROWS rather than reading as absent,
 * as the harness's own run attributes do (`extractRunAttributes`): a record that silently lost the format it was asked
 * for would state something false.
 */
import { OUTPUT_FORMAT_ATTRIBUTE } from '../evidence/trace.ts';
import { OUTPUT_FORMAT_EXTENSION_KEY, type OutputFormatRef } from './registry.ts';

/** A root-span `analysis.output_format` that is not `{ id, version }`. */
export class OutputFormatAttributeError extends Error {
  constructor(message: string) {
    super(`${OUTPUT_FORMAT_ATTRIBUTE}: ${message}`);
    this.name = 'OutputFormatAttributeError';
  }
}

type SpanLike = { parentSpanId?: unknown; attributes?: Array<{ key?: unknown; value?: { stringValue?: unknown } }> };

/** The trace's root span (the first span with no parent), walked as the harness walks it. */
function rootSpan(trace: unknown): SpanLike | undefined {
  const spans = (trace as { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: unknown }> }> } | null | undefined)
    ?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans;
  if (!Array.isArray(spans)) return undefined;
  return (spans as SpanLike[]).find((s) => s && !s.parentSpanId);
}

/** The format the run's root span states, or undefined for an "Auto" run (or a trace with no root span). */
export function outputFormatOfTrace(trace: unknown): OutputFormatRef | undefined {
  const attribute = rootSpan(trace)?.attributes?.find((a) => a?.key === OUTPUT_FORMAT_ATTRIBUTE);
  if (!attribute) return undefined;
  const text = attribute.value?.stringValue;
  if (typeof text !== 'string') throw new OutputFormatAttributeError('is not text');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OutputFormatAttributeError('is not JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new OutputFormatAttributeError('is not an object');
  const keys = Object.keys(parsed);
  const { id, version } = parsed as Record<string, unknown>;
  if (keys.length !== 2 || typeof id !== 'string' || typeof version !== 'string') {
    throw new OutputFormatAttributeError('is not exactly { id, version }, both strings');
  }
  return { id, version };
}

/**
 * The extensions a record carries, given the request's and the run's trace: the request's, with
 * `org.civicaitools.output-format` written from the root span (replacing one the request carried) or, under "Auto",
 * removed. Untouched, the same object, when neither the request nor the run names a format.
 */
export function withOutputFormatExtension(
  extensions: Record<string, unknown> | undefined,
  trace: unknown,
): Record<string, unknown> | undefined {
  const format = outputFormatOfTrace(trace);
  const requested = extensions !== undefined && Object.hasOwn(extensions, OUTPUT_FORMAT_EXTENSION_KEY);
  if (!format && !requested) return extensions;
  const rest = Object.fromEntries(Object.entries(extensions ?? {}).filter(([key]) => key !== OUTPUT_FORMAT_EXTENSION_KEY));
  if (!format) return Object.keys(rest).length > 0 ? rest : undefined;
  return { ...rest, [OUTPUT_FORMAT_EXTENSION_KEY]: { preset: { id: format.id, version: format.version } } };
}
