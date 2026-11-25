/**
 * The format a run was asked for, from its trace into its record (OF2, Sprint OF-1, website #810; the seat's S4, S8 and
 * criterion 7).
 *
 * A run in a format other than "Auto" states it on its root span as `analysis.output_format` (`OUTPUT_FORMAT_ATTRIBUTE`,
 * `{ id, version }` as JSON text), written by the route that ran it. At publish the packager reads it back here and
 * writes `extensions["org.civicaitools.output-format"] = { preset: { id, version } }`.
 *
 * WRITTEN FROM THE ROOT SPAN AND NOTHING ELSE. The publish body comes from the browser, and the publish route passes its
 * extensions through as received; so a key of this name in the request is replaced by the root span's, and when the
 * root span states no format (this site's "Auto" runs) it is dropped. A request that carries no such key is handed back
 * untouched, the same object, so an "Auto" record's bytes are what they were before formats existed (the legacy hash
 * chain hashes insertion order).
 *
 * ABSENCE MEANS "NOT RECORDED", NEVER "AUTO" (the seat's ruling 7146180428, item 6). A root span with no attribute is
 * this site's "Auto" run, but also any trace that recorded none: a BlobRef trace, a trace made before formats existed,
 * another producer's. So a record with no `org.civicaitools.output-format` key states nothing about the format, as an
 * absent run attribute states nothing (`packager.ts`, `extractRunAttributes`); a surface that reads the key renders a
 * missing key as not stated.
 *
 * An attribute that is present but is not exactly `{ id, version }`, both strings, THROWS rather than reading as absent,
 * as the harness's own run attributes do (`extractRunAttributes`): a record that silently lost the format it was asked
 * for would state something false.
 *
 * WHAT A MAP-FORMAT RUN PRESENTED (OF3a): the root span's `analysis.output_format_result`, `{ outcome, counts?, map? }`
 * as the present step left it (`present-step.ts`), is written beside `preset`, in that order. It is checked before it
 * is written, and a value that does not hold THROWS, as a malformed `preset` does: `outcome` is `{ drawn: true }` or
 * `{ drawn: false, reason }` with one of the four reasons; a drawn outcome carries `counts` and `map`, and the map draws
 * `counts.drawn` features; a map is carried only when drawn; `counts` are carried exactly when rows were read
 * (`no-location-columns`, `no-located-rows`, or drawn) and add up, `drawn + withoutLocation + beyondCap = returned`;
 * and the map's feature ids are unique (`assertUniqueFeatureIds`, the producer's own check: the schema does not
 * enforce it). An outcome with no `preset` throws too. With no such attribute, a format run's record carries `preset`
 * alone: the run recorded no outcome.
 */
import { OUTPUT_FORMAT_ATTRIBUTE, OUTPUT_FORMAT_RESULT_ATTRIBUTE } from '../evidence/trace.ts';
import { OUTPUT_FORMAT_EXTENSION_KEY, type OutputFormatRef } from './registry.ts';
import { assertUniqueFeatureIds, NO_MAP_REASONS, type MapPresentation } from './plain-map.ts';

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

/** The format the run's root span states, or undefined when it states none (an "Auto" run, or a trace that recorded none). */
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

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** What the run's root span states it presented, checked; undefined when it states nothing. */
export function outputFormatResultOfTrace(trace: unknown): MapPresentation | undefined {
  const attribute = rootSpan(trace)?.attributes?.find((a) => a?.key === OUTPUT_FORMAT_RESULT_ATTRIBUTE);
  if (!attribute) return undefined;
  const fail = (problem: string): never => {
    throw new OutputFormatAttributeError(`${OUTPUT_FORMAT_RESULT_ATTRIBUTE} ${problem}`);
  };
  const text = attribute.value?.stringValue;
  if (typeof text !== 'string') return fail('is not text');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('is not JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('is not an object');
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).some((k) => !['outcome', 'counts', 'map'].includes(k))) return fail('carries a member other than outcome, counts and map');
  const outcome = value.outcome as Record<string, unknown> | undefined;
  if (outcome === null || typeof outcome !== 'object') return fail('has no outcome');
  const drawn = outcome.drawn;
  const outcomeKeys = Object.keys(outcome);
  if (drawn === true) {
    if (outcomeKeys.length !== 1) return fail('states a reason for a drawn map');
  } else if (drawn === false) {
    if (outcomeKeys.length !== 2 || !NO_MAP_REASONS.includes(outcome.reason as never)) return fail('states no known reason for no map');
  } else {
    return fail('outcome.drawn is not a boolean');
  }
  const readRows = drawn === true || outcome.reason === 'no-location-columns' || outcome.reason === 'no-located-rows';
  const counts = value.counts as Record<string, unknown> | undefined;
  if (readRows !== (counts !== undefined)) return fail(readRows ? 'carries no counts' : `carries counts on ${String(outcome.reason)}`);
  if (counts !== undefined) {
    const keys = Object.keys(counts);
    if (keys.length !== 4 || !['returned', 'drawn', 'withoutLocation', 'beyondCap'].every((k) => isCount(counts[k]))) {
      return fail('counts are not four non-negative whole numbers');
    }
    const { returned, drawn: drawnCount, withoutLocation, beyondCap } = counts as Record<string, number>;
    if (drawnCount + withoutLocation + beyondCap !== returned) return fail('counts do not add up to returned');
  }
  const map = value.map as { features?: unknown } | undefined;
  if ((drawn === true) !== (map !== undefined)) return fail(drawn === true ? 'carries no map for a drawn outcome' : 'carries a map for no map');
  if (map !== undefined) {
    if (map === null || typeof map !== 'object' || !Array.isArray(map.features)) return fail('map has no features');
    if (map.features.length !== (counts as Record<string, number>).drawn) return fail('map does not draw counts.drawn features');
    assertUniqueFeatureIds(map as { features: Array<{ id?: unknown }> });
  }
  return value as unknown as MapPresentation;
}

/**
 * The extensions a record carries, given the request's and the run's trace: the request's, with
 * `org.civicaitools.output-format` written from the root span (replacing one the request carried) or, when the root span
 * states no format, removed. Untouched, the same object, when neither the request nor the run names a format.
 */
export function withOutputFormatExtension(
  extensions: Record<string, unknown> | undefined,
  trace: unknown,
): Record<string, unknown> | undefined {
  const format = outputFormatOfTrace(trace);
  const presented = outputFormatResultOfTrace(trace);
  if (presented && !format) throw new OutputFormatAttributeError(`${OUTPUT_FORMAT_RESULT_ATTRIBUTE} is stated on a run that states no format`);
  const requested = extensions !== undefined && Object.hasOwn(extensions, OUTPUT_FORMAT_EXTENSION_KEY);
  if (!format && !requested) return extensions;
  const rest = Object.fromEntries(Object.entries(extensions ?? {}).filter(([key]) => key !== OUTPUT_FORMAT_EXTENSION_KEY));
  if (!format) return Object.keys(rest).length > 0 ? rest : undefined;
  return {
    ...rest,
    [OUTPUT_FORMAT_EXTENSION_KEY]: {
      preset: { id: format.id, version: format.version },
      ...(presented
        ? {
            outcome: presented.outcome,
            ...(presented.counts !== undefined ? { counts: presented.counts } : {}),
            ...(presented.map !== undefined ? { map: presented.map } : {}),
          }
        : {}),
    },
  };
}
