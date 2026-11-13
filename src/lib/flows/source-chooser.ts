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
 *   - requested and not loaded: its last load ended `declined`, `no-answer`
 *     or `unavailable`, each with its reason in `CHOOSER_REASONS`' words, the
 *     chooser line's own (fix round 1). They claim no question put to the
 *     reader: `declined` is also the outcome when no pause could be held
 *     (`routing-mode.ts:301`), and `no-answer` when the reader could not be
 *     asked (`decision.ts`, `notHeld`), so the no-answer reason states both.
 *     `WHERE_IT_WENT_REASONS` (owner-approved, rendered by no surface) is not
 *     read here;
 *   - not requested: a source of the directory set with no load. The
 *     directory set is the configured sources On or Ask first, which the
 *     recorded reasons mark `configured` (dormant gate), `selected` (On) or
 *     `not-consented` (Ask first, or no stored state). `reader-off` and
 *     `not-configured` are outside every group.
 * A load that named no source of the set (`not-offered`), or recorded no
 * outcome, places nothing. Without readable load spans (a record with no
 * trace) the groups are absent rather than guessed.
 *
 * THE ROUTER'S NAME (the card, in-loop). The id of the record's own router
 * component (`components[]`, or a run's `analysis.components`): the entry
 * whose id is the router package's name, the package this module reads the
 * manifest from. With no such entry the card says "router version <version>";
 * no name is supplied that the record does not state.
 *
 * A LOADED PACK (S2-B D3 = A and R5, npstorey/civic-ai-tools#309). A loaded
 * source is a pack when the record says so: a call span whose `tool.name`
 * begins with that source's offered alias and `__`, and which states
 * `mcp.pack_id` (written on every pack call, a refused one too). It reads
 * "{name} (a pack recorded as {packId}, using {base})", bundle revision 3's
 * fallback (`:331`), the id whole as the span states it, carried as one code
 * part of the line; the base is this site's name for that span's
 * `mcp.source`. Nothing installed decides it, so it holds for any record. A
 * pack that loaded and made no call states no pack id and reads as any loaded
 * source; when one source's calls state two different pack ids or bases, the
 * record does not say which it was, and the name stands alone. R5's
 * definition follows the groups, once, only when a clause shows.
 *
 * WHAT THE RUN CONSIDERED (S2-B F9, case 1; bundle `:70`, `:88`). When the
 * record carries `composition.considered` (a run: the root span's
 * `analysis.considered`), its two sentences follow the in-loop sentence on the
 * first line. A value that is not well formed reads as absent: no count.
 */
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import routerPackage from '@typedstandards/civic-typed-router/package.json' with { type: 'json' };
import { readerSourceName } from '../sources/source-name.ts';
import { CHOOSER_REASONS, ECHO_LIMIT, SOURCE_CHOOSER_CARD, SOURCE_CHOOSER_CONSIDERED, SOURCE_CHOOSER_PACK, SOURCE_CHOOSER_TEXT } from '../sources/copy.ts';

// --- The model ---------------------------------------------------------------------------

/** A source asked for and not loaded, with why, in `WHERE_IT_WENT_REASONS`' words. */
export interface ChooserAsked {
  name: string;
  whyNotSent: string;
}

/** A loaded source the record names as a pack: the id its calls state, and this site's name for their base. */
export interface ChooserPack {
  packId: string;
  base: string;
}

export interface ChooserGroups {
  loaded: string[];
  askedNotLoaded: ChooserAsked[];
  neverAsked: string[];
  /** The loaded sources the record names as packs, by their name in `loaded`; absent when none. */
  packs?: Record<string, ChooserPack>;
}

/** What an in-loop run says it considered (`composition.considered`), as the chooser line states it. */
export interface ChooserConsidered {
  inventory: string;
  version: string;
  total: number;
  listed: number;
  rule: string;
  ruleVersion: string;
}

export type SourceChooser =
  | { method: 'in-loop'; router: string | null; version: string | null; definitionHash: string | null; groups?: ChooserGroups; considered?: ChooserConsidered }
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

/** A call span that states a pack id: the name the model called, the pack id, and the source and alias it went to. */
export interface ChooserPackCall {
  toolName: string;
  packId: string;
  source: string | undefined;
  alias: string | undefined;
}

// --- Shared readers ----------------------------------------------------------------------

/** Why a source the model requested was not loaded, by its last load's outcome, in the chooser line's own words. */
const LOAD_END_REASON: Readonly<Record<string, string>> = {
  declined: CHOOSER_REASONS.declined,
  'no-answer': CHOOSER_REASONS.noAnswer,
  unavailable: CHOOSER_REASONS.unavailable,
};

/** A source's reader name, by id; for an id the manifest lacks, the alias the record names, else the id. */
export function sourceReaderName(sourceId: string, alias: string | undefined): string {
  const entry = CIVIC_MANIFEST.find((e) => e.sourceId === sourceId);
  return entry ? readerSourceName({ sourceId, displayName: entry.displayName }) : alias ?? sourceId;
}

/**
 * The reader name of the source a load's alias names (`readerSourceName`, by
 * the manifest entry with that alias), or nothing for an alias no source has,
 * which is text the model chose and is never repeated. The load step's label
 * reads it (R10 P1 fix round 1, H).
 */
export function loadAliasReaderName(alias: unknown): string | undefined {
  if (typeof alias !== 'string') return undefined;
  const entry = CIVIC_MANIFEST.find((e) => e.alias === alias);
  return entry ? readerSourceName({ sourceId: entry.sourceId, displayName: entry.displayName }) : undefined;
}

/** A recorded value echoed to a reader, cut to `ECHO_LIMIT` characters, the last of them "…". */
export function echoCapped(value: string): string {
  return value.length > ECHO_LIMIT ? `${value.slice(0, ECHO_LIMIT - 1)}…` : value;
}

/** The id of the router component a record or a run states, or null when it states none. */
function routerOf(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  const entry = components.map(asRecord).find((c) => c?.id === routerPackage.name);
  return text(entry?.id) ?? null;
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

/** The call spans that state a pack id (`mcp.pack_id`), in order. */
function packCallsOfSpans(spans: readonly unknown[]): ChooserPackCall[] {
  const calls: ChooserPackCall[] = [];
  for (const span of spans) {
    if (asRecord(span)?.name !== 'mcp_tool_call') continue;
    const attrs = attributesOf(span);
    const toolName = text(attrs.get('tool.name'));
    const packId = text(attrs.get('mcp.pack_id'));
    if (toolName === undefined || packId === undefined || attrs.get('tool.operation_type') === 'load_source') continue;
    calls.push({ toolName, packId, source: text(attrs.get('mcp.source')), alias: text(attrs.get('mcp.alias')) });
  }
  return calls;
}

/** `composition.considered` (or `analysis.considered`) as the chooser reads it; anything not well formed is absent. */
function consideredOf(value: unknown): ChooserConsidered | undefined {
  const c = asRecord(value);
  const inventory = asRecord(c?.inventory);
  const id = text(inventory?.id);
  const version = text(inventory?.version);
  const rule = text(c?.rule);
  const ruleVersion = text(c?.ruleVersion);
  const count = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : undefined);
  const total = count(c?.total);
  const listed = count(c?.listed);
  if (id === undefined || version === undefined || rule === undefined || ruleVersion === undefined || total === undefined || listed === undefined) return undefined;
  return { inventory: id, version, total, listed, rule, ruleVersion };
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

/** The three groups, from the loads and the offered set; with the pack calls, the loaded sources the record names as packs. */
export function chooserGroups(loads: readonly ChooserLoad[], offered: readonly ChooserOffered[], packCalls: readonly ChooserPackCall[] = []): ChooserGroups {
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
    if (outcome === 'loaded') {
      groups.loaded.push(name);
      const pack = packOf(packCalls.filter((call) => call.toolName.startsWith(`${source.alias}__`)));
      if (pack) groups.packs = { ...groups.packs, [name]: pack };
    }
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

/** The pack one loaded source's calls name: exactly one pack id and base among them, else none. */
function packOf(calls: readonly ChooserPackCall[]): ChooserPack | undefined {
  const distinct = new Set(calls.map((call) => `${call.packId}\n${call.source ?? ''}`));
  const [call] = calls;
  if (distinct.size !== 1 || call.source === undefined) return undefined;
  return { packId: call.packId, base: sourceReaderName(call.source, call.alias) };
}

/**
 * The fact, from the record's `routing` value (absent: `undefined`), its
 * definition hash, and, when the loads are readable, the loads and the
 * offered set (with the pack calls, S2-B D3), and what the run considered.
 */
export function sourceChooser(
  routing: unknown,
  definitionHash: unknown,
  contacts: { loads: readonly ChooserLoad[]; offered: readonly ChooserOffered[]; packCalls?: readonly ChooserPackCall[] } | null,
  components?: unknown,
  considered?: unknown,
): SourceChooser {
  if (routing === undefined) return { method: 'not-recorded' };
  const method = text(asRecord(routing)?.method);
  if (method === 'in-loop') {
    const stated = consideredOf(considered);
    return {
      method: 'in-loop',
      router: routerOf(components),
      version: text(asRecord(routing)?.version) ?? null,
      definitionHash: text(definitionHash) ?? null,
      ...(contacts ? { groups: chooserGroups(contacts.loads, contacts.offered, contacts.packCalls) } : {}),
      ...(stated ? { considered: stated } : {}),
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
  const components = parseJson(text(attrs.get('analysis.components')));
  const considered = parseJson(text(attrs.get('analysis.considered')));
  return sourceChooser(routing, attrs.get('analysis.definition_hash'), { loads: loadsOfSpans(spans), offered, packCalls: packCallsOfSpans(spans) }, components, considered);
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
    spans === null ? null : { loads: loadsOfSpans(spans), offered: offeredList(composition?.sourcesOffered), packCalls: packCallsOfSpans(spans) },
    composition?.components,
    composition?.considered,
  );
}

// --- The words -------------------------------------------------------------------------------

const names = (list: readonly string[]) => (list.length > 0 ? list.join(SOURCE_CHOOSER_TEXT.separator) : SOURCE_CHOOSER_TEXT.none);

/** A run of a line's text; `code` marks the one part set in code style, a pack's id (the seat's 6779017419). */
export interface ChooserPart {
  text: string;
  code?: true;
}

/**
 * One line of the chooser, and the lines under it (the sources requested and not loaded, one each). `parts`, when
 * present, is `text` in runs, one of them in code style (a pack's id, whole); `kind: 'definition'` is R5's sentence,
 * which follows the groups as a paragraph of its own, not as a group.
 */
export interface ChooserLine {
  text: string;
  items?: string[];
  parts?: ChooserPart[];
  kind?: 'definition';
}

/** The considered sentences: the count and the inventory, then the rule's words, or the rule named as recorded. */
function consideredSentences(c: ChooserConsidered): string {
  const W = SOURCE_CHOOSER_CONSIDERED;
  const rule = Object.hasOwn(W.rules, c.rule) && Object.hasOwn(W.rules[c.rule], c.ruleVersion)
    ? W.rules[c.rule][c.ruleVersion]
    : W.unknownRule(echoCapped(c.rule), echoCapped(c.ruleVersion));
  return `${W.shown(c.listed, c.total, c.inventory, c.version)} ${rule}`;
}

/** The Loaded line: each name, a pack's with the clause and its id as a code part. */
function loadedLine(g: ChooserGroups): ChooserLine {
  const T = SOURCE_CHOOSER_TEXT;
  if (g.packs === undefined) return { text: `${T.loaded}${names(g.loaded)}.` };
  const P = SOURCE_CHOOSER_PACK;
  const parts: ChooserPart[] = [];
  let plain: string = T.loaded;
  g.loaded.forEach((name, i) => {
    if (i > 0) plain += T.separator;
    const pack = Object.hasOwn(g.packs!, name) ? g.packs![name] : undefined;
    if (!pack) {
      plain += name;
      return;
    }
    parts.push({ text: `${plain}${name}${P.open}` }, { text: pack.packId, code: true });
    plain = `${P.using}${pack.base}${P.close}`;
  });
  parts.push({ text: `${plain}.` });
  return { text: parts.map((p) => p.text).join(''), parts };
}

/** The chooser line: its first sentence, then, in-loop, one line per group. */
export function chooserLines(chooser: SourceChooser): ChooserLine[] {
  const T = SOURCE_CHOOSER_TEXT;
  switch (chooser.method) {
    case 'not-recorded':
      return [{ text: T.notRecorded }];
    case 'all-sources':
      return [{ text: T.allSources }];
    case 'unrecognized':
      return [{ text: T.unrecognized(echoCapped(chooser.value)) }];
    case 'in-loop': {
      const first: ChooserLine = { text: chooser.considered ? `${T.inLoop} ${consideredSentences(chooser.considered)}` : T.inLoop };
      const g = chooser.groups;
      if (!g) return [first];
      // One line per source requested and not loaded, so two reasons never run together.
      const asked: ChooserLine = g.askedNotLoaded.length > 0
        ? { text: T.askedNotLoaded.trimEnd(), items: g.askedNotLoaded.map((a) => `${a.name}${T.reasonSeparator}${a.whyNotSent}`) }
        : { text: `${T.askedNotLoaded}${T.none}.` };
      const lines: ChooserLine[] = [first, loadedLine(g), asked, { text: `${T.neverAsked}${names(g.neverAsked)}.` }];
      // R5: once, after the groups, only when a pack clause shows.
      return g.packs === undefined ? lines : [...lines, { text: SOURCE_CHOOSER_PACK.definition, kind: 'definition' }];
    }
  }
}

/** The card, and in-loop the hash's small print, as "Model + environment" items. */
export function chooserCardItems(chooser: SourceChooser): Array<{ label: string; value: string; mono?: boolean }> {
  const C = SOURCE_CHOOSER_CARD;
  switch (chooser.method) {
    case 'not-recorded':
      return [{ label: C.label, value: C.notRecorded }];
    case 'all-sources':
      return [{ label: C.label, value: C.allSources }];
    case 'unrecognized':
      return [{ label: C.label, value: C.unrecognized(echoCapped(chooser.value)) }];
    case 'in-loop':
      return [
        { label: C.label, value: C.inLoop(chooser.router, chooser.version) },
        ...(chooser.definitionHash ? [{ label: C.definitionLabel, value: chooser.definitionHash.slice(0, 12), mono: true }] : []),
      ];
  }
}

/** Whether a run holds a portal: a value, and not the retired `__all__` (the form's "All portals" sends `''`). */
export function runHoldsPortal(portal: string | null | undefined): portal is string {
  return typeof portal === 'string' && portal.length > 0 && portal !== '__all__';
}
