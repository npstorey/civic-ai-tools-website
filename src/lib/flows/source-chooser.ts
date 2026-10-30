/**
 * What chose a run's sources (R10 P1, #682; the anchor's D7 = A, read
 * literally): one fact, read from what a run or a record states, for the
 * chooser line that opens "Where this question went" and the card "Sources
 * chosen by" in "Model + environment".
 *
 * Pure: no store, no request, no environment read. It reads nothing a client
 * cannot hold, so the run adapters (client components' inputs) and the record
 * page read the same functions; `where-it-went.ts` reads the flows statement,
 * which is server-only, and imports this module, never the reverse.
 *
 * WHAT DECIDES THE METHOD. The record's `routing` and nothing else: on a
 * record, `extensions["org.civicaitools.composition"].routing`; on a run, the
 * trace's root-span `analysis.routing` (written after the loop, so it reaches
 * the client with the trace, after the answer). `in-loop` reads as the model
 * choosing; `all-sources` as every configured source offered from the first
 * request; no key as "not recorded" (every all-sources run writes none); any
 * other value is shown as recorded and read as neither (a gate question).
 * Nothing here supplies a default for an absent key.
 *
 * THE THREE GROUPS (in-loop only), from the load contacts and the offered set
 * the run recorded (`sourcesOffered`, after the routes' `recordReasons`):
 *   - loaded: the source's last load ended `loaded`;
 *   - asked for and not loaded: its last load ended `declined`, `no-answer` or
 *     `unavailable`, each with its reason in `WHERE_IT_WENT_REASONS`' words.
 *     Those words claim no question put to the reader: `declined` is also the
 *     outcome when no pause could be held, and `no-answer` when the reader
 *     could not be asked;
 *   - never asked for: a source of the directory set with no load. The
 *     directory set is the configured sources On or Ask first, which the
 *     recorded reasons mark `configured` (dormant gate), `selected` (On) or
 *     `not-consented` (Ask first, or no stored state). `reader-off` and
 *     `not-configured` are outside every group.
 * A load that named no source of the set (`not-offered`), or recorded no
 * outcome, places nothing. Without readable load spans (a record with no
 * trace) the groups are absent rather than guessed.
 */
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { readerSourceName } from '../sources/source-name.ts';
import { SOURCE_CHOOSER_CARD, SOURCE_CHOOSER_TEXT, WHERE_IT_WENT_REASONS } from '../sources/copy.ts';

// --- The model ---------------------------------------------------------------------------

/** A source asked for and not loaded, with why, in `WHERE_IT_WENT_REASONS`' words. */
export interface ChooserAsked {
  name: string;
  whyNotSent: string;
}

export interface ChooserGroups {
  loaded: string[];
  askedNotLoaded: ChooserAsked[];
  neverAsked: string[];
}

export type SourceChooser =
  | { method: 'in-loop'; version: string | null; definitionHash: string | null; groups?: ChooserGroups }
  | { method: 'all-sources' }
  | { method: 'not-recorded' }
  | { method: 'unrecognized'; value: string };

/** A source as a run or a record states it was offered (`sourcesOffered`). */
export interface ChooserOffered {
  sourceId: string;
  alias: string;
  reason: string;
}

/** One `load_source` contact: the alias it named and how it ended (`''` when none was recorded). */
export interface ChooserLoad {
  alias: string | undefined;
  outcome: string;
}

// --- Shared readers ----------------------------------------------------------------------

/**
 * Why a source asked for was not loaded, by its last load's outcome, in §2's
 * words. Read by this module and by `where-it-went.ts`'s `whyNotSentFor`, so
 * the two cannot word one outcome two ways.
 */
export const LOAD_END_REASON: Readonly<Record<string, string>> = {
  declined: WHERE_IT_WENT_REASONS.declined,
  'no-answer': WHERE_IT_WENT_REASONS.noAnswer,
  unavailable: WHERE_IT_WENT_REASONS.unavailable,
};

/** A source's reader name, by id; for an id the manifest lacks, the alias the record names, else the id. */
export function sourceReaderName(sourceId: string, alias: string | undefined): string {
  const entry = CIVIC_MANIFEST.find((e) => e.sourceId === sourceId);
  return entry ? readerSourceName({ sourceId, displayName: entry.displayName }) : alias ?? sourceId;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** The spans of an OTLP trace (`resourceSpans[].scopeSpans[].spans[]`), or null when it is not one. */
export function spansOfTrace(trace: unknown): unknown[] | null {
  const resourceSpans = asRecord(trace)?.resourceSpans;
  if (!Array.isArray(resourceSpans)) return null;
  const spans: unknown[] = [];
  for (const rs of resourceSpans) {
    const scopeSpans = asRecord(rs)?.scopeSpans;
    if (!Array.isArray(scopeSpans)) continue;
    for (const ss of scopeSpans) {
      const list = asRecord(ss)?.spans;
      if (Array.isArray(list)) spans.push(...list);
    }
  }
  return spans;
}

/** A span's attributes as plain values; anything not in the OTLP shape reads as nothing. */
export function attributesOf(span: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const attributes = asRecord(span)?.attributes;
  if (!Array.isArray(attributes)) return out;
  for (const attr of attributes as unknown[]) {
    const a = asRecord(attr);
    const value = asRecord(a?.value);
    if (typeof a?.key !== 'string' || value === undefined) continue;
    out.set(a.key, value.stringValue ?? value.boolValue ?? value.intValue ?? value.doubleValue);
  }
  return out;
}

/** The alias a load's `tool.arguments` JSON names, or nothing. */
export function aliasOf(argumentsJson: string | undefined): string | undefined {
  if (argumentsJson === undefined) return undefined;
  try {
    return text(asRecord(JSON.parse(argumentsJson))?.alias);
  } catch {
    return undefined;
  }
}

/** The load contacts among a trace's spans, in order. */
function loadsOfSpans(spans: readonly unknown[]): ChooserLoad[] {
  const loads: ChooserLoad[] = [];
  for (const span of spans) {
    if (asRecord(span)?.name !== 'mcp_tool_call') continue;
    const attrs = attributesOf(span);
    if (attrs.get('tool.operation_type') !== 'load_source') continue;
    loads.push({ alias: aliasOf(text(attrs.get('tool.arguments'))), outcome: text(attrs.get('tool.load_outcome')) ?? '' });
  }
  return loads;
}

function offeredList(value: unknown): ChooserOffered[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ChooserOffered[] => {
    const e = asRecord(entry);
    return typeof e?.sourceId === 'string' && typeof e.alias === 'string' && typeof e.reason === 'string'
      ? [{ sourceId: e.sourceId, alias: e.alias, reason: e.reason }]
      : [];
  });
}

function parseJson(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// --- The core ------------------------------------------------------------------------------

/** The three groups, from the loads and the offered set. */
export function chooserGroups(loads: readonly ChooserLoad[], offered: readonly ChooserOffered[]): ChooserGroups {
  const lastLoad = new Map<string, string>();
  for (const load of loads) {
    if (load.outcome === 'not-offered') continue;
    const source = offered.find((o) => o.alias === load.alias);
    if (source) lastLoad.set(source.sourceId, load.outcome);
  }
  const groups: ChooserGroups = { loaded: [], askedNotLoaded: [], neverAsked: [] };
  for (const source of offered) {
    const name = sourceReaderName(source.sourceId, source.alias);
    const outcome = lastLoad.get(source.sourceId);
    if (outcome === 'loaded') groups.loaded.push(name);
    else if (outcome !== undefined && Object.hasOwn(LOAD_END_REASON, outcome)) groups.askedNotLoaded.push({ name, whyNotSent: LOAD_END_REASON[outcome] });
    // The directory set (`directorySet`, `routing-mode.ts`): On or Ask first, configured. Compared, never
    // passed on: `reason` here is the offered-reason, not a call's phrase (`reason-phrase-readers.test.ts`).
    else if (outcome === undefined && (source.reason === 'configured' || source.reason === 'selected' || source.reason === 'not-consented')) {
      groups.neverAsked.push(name);
    }
    // A load that recorded no outcome places nothing: whether it loaded is not stated.
  }
  return groups;
}

/**
 * The fact, from the record's `routing` value (absent: `undefined`), its
 * definition hash, and, when the loads are readable, the loads and the
 * offered set.
 */
export function sourceChooser(
  routing: unknown,
  definitionHash: unknown,
  contacts: { loads: readonly ChooserLoad[]; offered: readonly ChooserOffered[] } | null,
): SourceChooser {
  if (routing === undefined) return { method: 'not-recorded' };
  const method = text(asRecord(routing)?.method);
  if (method === 'in-loop') {
    return {
      method: 'in-loop',
      version: text(asRecord(routing)?.version) ?? null,
      definitionHash: text(definitionHash) ?? null,
      ...(contacts ? { groups: chooserGroups(contacts.loads, contacts.offered) } : {}),
    };
  }
  if (method === 'all-sources') return { method: 'all-sources' };
  return { method: 'unrecognized', value: method ?? JSON.stringify(routing) ?? String(routing) };
}

// --- Entry points --------------------------------------------------------------------------

/**
 * A run, from its trace (the comparison's `trace` event, the executed run's
 * `publish_inputs`): the root span's `analysis.routing`,
 * `analysis.definition_hash` and `analysis.sources_offered`
 * (`RUN_RECORD_ATTRIBUTE` and `IN_LOOP_RUN_RECORD_ATTRIBUTE` in
 * `src/lib/evidence/trace.ts`, named here as text: that module reads the
 * harness, which a client does not load), and the load spans. Null for
 * anything that is not a trace: the run's surfaces then show no chooser line
 * and no card, which is the state before the trace arrives (P-f).
 */
export function chooserFromTrace(trace: unknown): SourceChooser | null {
  const spans = spansOfTrace(trace);
  if (spans === null) return null;
  const root = spans.find((s) => asRecord(s) !== undefined && !asRecord(s)?.parentSpanId);
  const attrs = root ? attributesOf(root) : new Map<string, unknown>();
  const routing = parseJson(text(attrs.get('analysis.routing')));
  const offered = offeredList(parseJson(text(attrs.get('analysis.sources_offered'))));
  return sourceChooser(routing, attrs.get('analysis.definition_hash'), { loads: loadsOfSpans(spans), offered });
}

/**
 * A record, from its composition (`routing`, `definitionHash`,
 * `sourcesOffered`) and its trace's load spans. The root span's
 * `analysis.routing` is not read: the record's own field decides.
 */
export function chooserFromPackage(pkg: unknown): SourceChooser {
  const record = asRecord(pkg);
  const composition = asRecord(asRecord(record?.extensions)?.['org.civicaitools.composition']);
  const spans = spansOfTrace(record?.trace);
  const routing = composition && Object.hasOwn(composition, 'routing') ? composition.routing : undefined;
  return sourceChooser(
    routing,
    composition?.definitionHash,
    spans === null ? null : { loads: loadsOfSpans(spans), offered: offeredList(composition?.sourcesOffered) },
  );
}

// --- The words -------------------------------------------------------------------------------

const names = (list: readonly string[]) => (list.length > 0 ? list.join(SOURCE_CHOOSER_TEXT.separator) : SOURCE_CHOOSER_TEXT.none);

/** The chooser line: its first sentence, then, in-loop, one line per group. */
export function chooserLines(chooser: SourceChooser): string[] {
  const T = SOURCE_CHOOSER_TEXT;
  switch (chooser.method) {
    case 'not-recorded':
      return [T.notRecorded];
    case 'all-sources':
      return [T.allSources];
    case 'unrecognized':
      return [T.unrecognized(chooser.value)];
    case 'in-loop': {
      const g = chooser.groups;
      if (!g) return [T.inLoop];
      const asked = g.askedNotLoaded.length > 0
        ? g.askedNotLoaded.map((a) => `${a.name}${T.reasonSeparator}${a.whyNotSent}`).join(' ')
        : `${T.none}.`;
      return [T.inLoop, `${T.loaded}${names(g.loaded)}.`, `${T.askedNotLoaded}${asked}`, `${T.neverAsked}${names(g.neverAsked)}.`];
    }
  }
}

/** The card, and in-loop the definition hash's small print, as "Model + environment" items. */
export function chooserCardItems(chooser: SourceChooser): Array<{ label: string; value: string; mono?: boolean }> {
  const C = SOURCE_CHOOSER_CARD;
  switch (chooser.method) {
    case 'not-recorded':
      return [{ label: C.label, value: C.notRecorded }];
    case 'all-sources':
      return [{ label: C.label, value: C.allSources }];
    case 'unrecognized':
      return [{ label: C.label, value: C.unrecognized(chooser.value) }];
    case 'in-loop':
      return [
        { label: C.label, value: C.inLoop(chooser.version) },
        ...(chooser.definitionHash ? [{ label: C.definitionLabel, value: chooser.definitionHash.slice(0, 12), mono: true }] : []),
      ];
  }
}

/** Whether a run holds a portal: a value, and not the retired `__all__` (the form's "All portals" sends `''`). */
export function runHoldsPortal(portal: string | null | undefined): portal is string {
  return typeof portal === 'string' && portal.length > 0 && portal !== '__all__';
}
