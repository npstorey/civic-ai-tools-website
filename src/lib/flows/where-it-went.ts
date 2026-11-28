/**
 * "Where this question went" (R6 W4, #632; rulings W4-D1 = A, W4-D2 = A,
 * W4-D3 = A): who a run, or a published record, sent something to, and why
 * every other source got nothing.
 *
 * Pure: no store, no request, no environment read. Read-only over what a run
 * and a record already hold; it adds no record field.
 *
 * THREE ENTRY POINTS, ONE CORE.
 *   - `whereItWentFromSpans`: a run, from its spans. A call names its source
 *     in `mcp.source`; a load (`tool.operation_type` `load_source`) names its
 *     source only by the alias in its `tool.arguments`, matched against the
 *     offered set's aliases; the first `llm_inference` span names the model
 *     (`gen_ai.request.model`) and the service (`gen_ai.system`).
 *   - `whereItWentFromCalls`: the same run as its tool-call records hold it,
 *     each call's source given by the resolver the loop was given. The JSON
 *     compare route writes no trace, and the streaming routes complete before
 *     their trace is finalized, so the routes use this one; for the same run
 *     it gives the same rows as the spans (`where-it-went.test.ts`).
 *   - `whereItWentFromPackage`: a record, from its trace, its servers
 *     (`extensions["org.civicaitools.environment"].mcpServers`, else the
 *     root span's `analysis.mcp_servers`), its composition's
 *     `sourcesOffered` and `flowsStatement`, and its notebook, against the
 *     statement this site serves (passed in; the page builds it).
 *
 * REACHED means a call named the source (not `unknown`) and did not fail, or
 * failed with any kind but the three `NOT_RECEIVED` holds (`not_configured`,
 * `not_offered`, `base_changed`): a `timeout`, an `unavailable` or an
 * `unknown` call may have arrived. A load reaches nothing:
 * this site answers it. Rows are in order of first contact: the model
 * endpoint, each reached source, then the notebook runner of an executed run.
 *
 * WHAT CHOSE THE SOURCES (R10 P1, #682). `chooser`, read by
 * `./source-chooser.ts` from the record's `routing` alone: on a record, here
 * (`whereItWentFromPackage`); on a run, by the run's adapter from its trace,
 * which reaches the client after the completion that carries this model, so a
 * run's model carries none until then (P-f). The routes are unchanged.
 *
 * THE STATEMENT. On a run, the statement the consent gate built for it. On a
 * record whose reference has the served statement's hash, that statement.
 * Either way every recipient the statement's row carries is shown, with its
 * place, what it receives and its holders. Otherwise (D1, the seat's
 * correction, and Stage C) the recipients and places come from the record: one
 * per row, and nothing it received or keeps; the view says that once.
 */
import { statementHash, type FlowsKeptBy, type FlowsRecipient, type FlowsStatement } from './statement.ts';
import { recipientWhere, roleLabel } from '../sources/source-name.ts';
import { WHERE_IT_WENT_REASONS } from '../sources/copy.ts';
import { SEARCH_OPERATION } from './search-words.ts';
import { PRESENT_STEP_NAME } from '../output-format/attribute-names.ts';
import { NOTEBOOK_EXTENSION_KEY, readNotebookProvenanceOfNotebook } from '../notebook-author/notebook-provenance-reading.ts';
import { CIVIC_MANIFEST, civicRouter, retiredPack } from '@typedstandards/civic-typed-router';
import { aliasOf, attributesOf, chooserFromPackage, NOT_RECEIVED, sourceReaderName, spansOfTrace, type SourceChooser } from './source-chooser.ts';

// --- The model ------------------------------------------------------------------------

/**
 * One recipient of a reached row. `got` (what it receives) and `keptBy` (the
 * statement's own holders, which the view renders as the panel does) are
 * present on a run and on a matched record only. `upstream` marks a hosted
 * row's upstream host (`source:<id>:<host>`, R8 W3).
 */
export interface WhereRecipientRow {
  role: string;
  place: string;
  got?: string;
  keptBy?: FlowsKeptBy[];
  upstream?: true;
}

export type WhereReachedRow =
  | { kind: 'model'; name: string; model: string | null; service: string | null; recipients: WhereRecipientRow[] }
  | {
      kind: 'source';
      sourceId: string;
      name: string;
      calls: number;
      recipients: WhereRecipientRow[];
      /**
       * For a pack's row (CKAN-1 P3 fix round 1, F6): the base whose server answered the pack's calls. A pack's call
       * states both facts (`mcp.pack_id` and the base's `mcp.source`); how the page counts it is
       * `PACK_CALL_COUNTED_UNDER`'s.
       */
      answeredBy?: { sourceId: string; name: string };
    }
  | { kind: 'notebook'; name: string; recipients: WhereRecipientRow[] };

/**
 * A source the question did not reach, and why, in §2's words. Not `reason`:
 * this repository reserves that name for a recorded call's phrase
 * (`src/components/reason-phrase-readers.test.ts`), and this is not one.
 */
export interface WhereNotReachedRow {
  sourceId: string;
  name: string;
  whyNotSent: string;
}

/** Which statement the rows rest on. */
export type WhereStatement = { kind: 'in-force' } | { kind: 'reference'; date: string; url: string } | { kind: 'none' };

export interface WhereItWentModel {
  reached: WhereReachedRow[];
  notReached: WhereNotReachedRow[];
  statement: WhereStatement;
  /** What chose the sources (R10 P1): on a record always; on a run once its trace has arrived. Absent: not yet known. */
  chooser?: SourceChooser;
}

/** A source as a run or a record states it was offered. */
export interface OfferedSource {
  sourceId: string;
  alias: string;
  reason: string;
}

// --- The core -------------------------------------------------------------------------

export const NOT_RECORDED = 'not recorded';

const LOAD_OPERATION = 'load_source';

/** The rule a picked run lists by, as its record's `considered.rule` states it (`READER_PICKED_RULE.id`,
 *  `src/lib/mcp/routing-mode.ts`, which this pure module does not import; `where-it-went.test.ts` holds the two equal). */
const READER_PICKED = 'reader-picked';

type Contact =
  | { kind: 'call'; source: string | undefined; failureKind: string | undefined; pack?: string }
  | { kind: 'load'; alias: string | undefined; outcome: string; asked?: boolean };

interface ServerEntry { url: string; name?: string }

/** Where the recipients come from: a statement in force, or the record alone. */
type Side =
  | { kind: 'statement'; statement: FlowsStatement }
  | { kind: 'record'; servers: readonly ServerEntry[] | null };

interface CoreInput {
  contacts: readonly Contact[];
  model: string | null;
  service: string | null;
  sourcesOffered: readonly OfferedSource[];
  executed: boolean;
  side: Side;
  statement: WhereStatement;
  /**
   * Whether a stated `not-selected` is a source the reader did not pick (S3-B W1, B8; S3-B F, the cold read's S1). On
   * a run of this site's routes, always: their reasons keep the router's `not-selected` only on a picked run
   * (`recordReasons`). On a record, only when its composition block's `considered.rule` is `reader-picked`: the
   * publish contract admits `not-selected` from any producer's trace, where it need not mean a pick.
   */
  notSelectedIsUnpicked: boolean;
  /**
   * The run held no pause (S4 W2b fix round 1): the JSON compare route, which asks no one, so a `declined` load there
   * was not asked about and reads `notAsked`. Absent on every route that writes a record.
   */
  noPause?: boolean;
}

const nameOf = sourceReaderName;

const shown = (r: FlowsRecipient, sourceId?: string): WhereRecipientRow => ({
  role: roleLabel(r.role),
  place: recipientWhere(r),
  got: r.receives,
  keptBy: r.keptBy,
  ...(sourceId !== undefined && r.id.startsWith(`source:${sourceId}:`) ? { upstream: true as const } : {}),
});

/** The record's facts only: a role and a place, nothing it received or keeps (the view says so once). */
const recorded = (role: string, place: string): WhereRecipientRow => ({ role, place });

/** A base recipient (the model endpoint, the notebook runner) from the statement, or "not recorded". */
function baseRecipients(side: Side, role: FlowsRecipient['role']): WhereRecipientRow[] {
  if (side.kind === 'statement') {
    const rows = side.statement.recipients.filter((r) => r.role === role).map((r) => shown(r));
    if (rows.length > 0) return rows;
  }
  return [recorded(roleLabel(role), NOT_RECORDED)];
}

/** The host of a server address, as the privacy page reads one. */
function hostOfAddress(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function sourceRecipients(side: Side, sourceId: string, base?: string): WhereRecipientRow[] {
  if (side.kind === 'statement') {
    const row = side.statement.sources.find((s) => s.sourceId === sourceId);
    if (row && row.recipients.length > 0) return row.recipients.map((r) => shown(r, sourceId));
    return [recorded(roleLabel('source'), NOT_RECORDED)];
  }
  // The record's facts: one recipient, at the address the run's servers name; a pack's, at its base's (F6).
  const server = side.servers?.find((s) => s.name === sourceId) ?? (base !== undefined ? side.servers?.find((s) => s.name === base) : undefined);
  if (!server) return [recorded(roleLabel('source'), NOT_RECORDED)];
  if (server.url.startsWith('pkg:')) return [recorded(roleLabel('sandbox-platform'), recipientWhere({ runsAt: 'instance-sandbox' }))];
  return [recorded(roleLabel('source'), hostOfAddress(server.url))];
}

/** A source's reason for not being reached (§2): its last load first, then its stated reason. */
function whyNotSentFor(
  offered: OfferedSource,
  load: { outcome: string; asked?: boolean } | undefined,
  notSelectedIsUnpicked: boolean,
  noPause = false,
): string | null {
  const R = WHERE_IT_WENT_REASONS;
  switch (load?.outcome) {
    case 'loaded':
      // S4 W2b fix round 1: a source not enabled at the start that loaded with no question put about it (the record's
      // `tool.load_asked: false`) loaded on an answer about another source (a class answer, or "Enable all data
      // sources"). A record with no such attribute reads as before.
      if (offered.reason !== 'not-consented') return R.onNotUsed;
      return load.asked === false ? R.allowedByAnother : R.allowedNotUsed;
    case 'declined':
      // The JSON compare route asks no one (S4 W2b fix round 1).
      return noPause ? R.notAsked : R.declined;
    case 'no-answer':
      return R.noAnswer;
    case 'unavailable':
      return R.unavailable;
    default:
      break;
  }
  switch (offered.reason) {
    case 'selected':
    case 'configured':
      return R.onNotUsed;
    case 'reader-off':
      return R.off;
    case 'not-consented':
      return R.notAsked;
    case 'not-configured':
      return R.notSetUp;
    case 'not-selected':
      // S3-B W1 (B8, S11): on a run whose sources the reader picked, an allowed source the reader did not pick. Every
      // other run of this site's routes maps the router's `not-selected` to `reader-off` or `not-consented` before it
      // reaches here. On a record, only where it says its sources were picked (`notSelectedIsUnpicked`); elsewhere a
      // reason with no words, as below.
      return notSelectedIsUnpicked ? R.notPicked : null;
    default:
      // A reason with no words.
      return null;
  }
}

/**
 * How a pack's call is counted (CKAN-1 P3 fix round 1, F6; the seat's ruling 6934343514): the one place the owner's
 * ruling on the display is written. A source whose pack id a call's span carries was reached by that call, and a
 * start-of-run exclusion (`not-consented`, `not-selected`) never outranks it. The model carries both facts either way
 * (the pack's row and its `answeredBy`, the base whose server answered).
 *   - `pack` (the default the ORCH recommends): the pack is listed as reached with its calls and its recipients (its
 *     statement row's, which are the base's server's); the base's own count holds only the calls that carry no pack
 *     id, and a base with none reads as a source with no calls reads.
 *   - `base`: the call is counted under the base, as before F6; the pack is listed as neither reached nor not used.
 *   - `both`: the pack is listed as reached with its calls, and the base with every call its server answered.
 */
export const PACK_CALL_COUNTED_UNDER: 'pack' | 'base' | 'both' = 'pack';

/**
 * The pack a manifest id names (`mcp.pack_id`), by `sourceId`, or `undefined` for an id no pack has. A pack a router
 * release retired is read from the router's `retiredPack` (CKAN-2-WEB P1, W7): a record made while Analyze Boston was
 * offered names it by that pack's inventory id (`boston-ckan@` and its portal), which no manifest holds since router 0.12.0.
 */
function packSourceOfId(packId: string | undefined): string | undefined {
  if (packId === undefined) return undefined;
  return CIVIC_MANIFEST.find((entry) => entry.base !== undefined && entry.id === packId)?.sourceId ?? retiredPack(packId)?.sourceId;
}

/**
 * The pack a call's dispatch target belongs to, by `sourceId`, or `undefined` when the target is no pack's (or there
 * is none). The target is the exposed name the dispatch sends the call to under the run's configuration and selection
 * (`dispatchTargetOf`, `../mcp/registry.ts`; in loop, the routing's own `dispatchTarget`): the same decision the loop
 * core reads for `mcp.pack_id`. A tool name is never split to find it (fix round 2, F8): a bare upstream name the
 * selection resolves to a pack is that pack's call.
 */
export function packOfDispatchTarget(target: string | undefined): string | undefined {
  if (target === undefined) return undefined;
  const resolved = civicRouter.dispatchMap.get(target);
  return resolved?.base !== undefined ? resolved.sourceId : undefined;
}

function build(input: CoreInput, countedUnder: typeof PACK_CALL_COUNTED_UNDER = PACK_CALL_COUNTED_UNDER): WhereItWentModel {
  // Each answered (or possibly answered) call, in first-contact order: under the source it counts for, and, for a
  // pack's call, the base whose server answered it.
  const calls = new Map<string, number>();
  const answeredBy = new Map<string, string>();
  /** Sources a pack's answered call reached, which no stated reason outranks. */
  const reachedByPack = new Set<string>();
  const count = (sourceId: string) => calls.set(sourceId, (calls.get(sourceId) ?? 0) + 1);
  for (const contact of input.contacts) {
    if (contact.kind !== 'call') continue;
    const { source, failureKind, pack } = contact;
    if (!source || source === 'unknown') continue;
    if (failureKind !== undefined && NOT_RECEIVED.has(failureKind)) continue;
    if (pack === undefined) {
      count(source);
      continue;
    }
    reachedByPack.add(pack);
    if (countedUnder !== 'base') {
      count(pack);
      answeredBy.set(pack, source);
    }
    if (countedUnder !== 'pack') count(source);
  }

  const lastLoad = new Map<string, { outcome: string; asked?: boolean }>();
  for (const contact of input.contacts) {
    if (contact.kind !== 'load' || contact.outcome === 'not-offered') continue;
    const offered = input.sourcesOffered.find((o) => o.alias === contact.alias);
    if (offered) lastLoad.set(offered.sourceId, { outcome: contact.outcome, ...(contact.asked === undefined ? {} : { asked: contact.asked }) });
  }

  const reached: WhereReachedRow[] = [
    { kind: 'model', name: roleLabel('model-endpoint'), model: input.model, service: input.service, recipients: baseRecipients(input.side, 'model-endpoint') },
  ];
  for (const [sourceId, n] of calls) {
    const alias = input.sourcesOffered.find((o) => o.sourceId === sourceId)?.alias;
    const base = answeredBy.get(sourceId);
    if (base === undefined) {
      reached.push({ kind: 'source', sourceId, name: nameOf(sourceId, alias), calls: n, recipients: sourceRecipients(input.side, sourceId) });
      continue;
    }
    const baseAlias = input.sourcesOffered.find((o) => o.sourceId === base)?.alias;
    reached.push({
      kind: 'source', sourceId, name: nameOf(sourceId, alias), calls: n, recipients: sourceRecipients(input.side, sourceId, base),
      answeredBy: { sourceId: base, name: nameOf(base, baseAlias) },
    });
  }
  if (input.executed) {
    reached.push({ kind: 'notebook', name: roleLabel('notebook-executor'), recipients: baseRecipients(input.side, 'notebook-executor') });
  }

  const notReached: WhereNotReachedRow[] = [];
  for (const offered of input.sourcesOffered) {
    if (calls.has(offered.sourceId) || reachedByPack.has(offered.sourceId)) continue;
    const whyNotSent = whyNotSentFor(offered, lastLoad.get(offered.sourceId), input.notSelectedIsUnpicked, input.noPause === true);
    if (whyNotSent !== null) notReached.push({ sourceId: offered.sourceId, name: nameOf(offered.sourceId, offered.alias), whyNotSent });
  }

  return { reached, notReached, statement: input.statement };
}

const runSide = (statement: FlowsStatement | null | undefined): { side: Side; statement: WhereStatement } =>
  statement ? { side: { kind: 'statement', statement }, statement: { kind: 'in-force' } } : { side: { kind: 'record', servers: null }, statement: { kind: 'none' } };

// --- Reading spans ----------------------------------------------------------------------

interface SpanLike { name?: unknown; parentSpanId?: unknown; attributes?: unknown }

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function readSpans(spans: readonly unknown[]): { contacts: Contact[]; model: string | null; service: string | null } {
  const contacts: Contact[] = [];
  let model: string | null = null;
  let service: string | null = null;
  let modelRead = false;
  for (const raw of spans) {
    if (raw === null || typeof raw !== 'object') continue;
    const span = raw as SpanLike;
    const attrs = attributesOf(span);
    if (span.name === 'llm_inference' && !modelRead) {
      modelRead = true;
      model = text(attrs.get('gen_ai.request.model')) ?? null;
      service = text(attrs.get('gen_ai.system')) ?? null;
    } else if (span.name === 'mcp_tool_call') {
      // A search (S3-B W2) is the instance's own step: no source saw it, so it is no contact.
      if (attrs.get('tool.operation_type') === SEARCH_OPERATION) continue;
      // OF3b (website #810): the map format's step is the site's own; no source saw it, so it is no contact.
      if (attrs.get('tool.operation_type') === PRESENT_STEP_NAME) continue;
      if (attrs.get('tool.operation_type') === LOAD_OPERATION) {
        // `tool.load_asked` (G0-B2 A): whether a question was put about the source; absent on an older record.
        const asked = attrs.get('tool.load_asked');
        contacts.push({
          kind: 'load', alias: aliasOf(text(attrs.get('tool.arguments'))), outcome: text(attrs.get('tool.load_outcome')) ?? '',
          ...(typeof asked === 'boolean' ? { asked } : {}),
        });
      } else {
        const failed = attrs.get('error') === true || attrs.has('error.kind');
        const pack = packSourceOfId(text(attrs.get('mcp.pack_id')));
        contacts.push({ kind: 'call', source: text(attrs.get('mcp.source')), failureKind: failed ? text(attrs.get('error.kind')) ?? 'unknown' : undefined, ...(pack !== undefined ? { pack } : {}) });
      }
    }
  }
  return { contacts, model, service };
}

/** A run, from its spans, its stated offered set and the statement in force. */
export function whereItWentFromSpans(input: {
  spans: readonly unknown[];
  sourcesOffered: readonly OfferedSource[];
  statement?: FlowsStatement | null;
  executed?: boolean;
}): WhereItWentModel {
  const read = readSpans(input.spans);
  return build({ ...read, sourcesOffered: input.sourcesOffered, executed: input.executed === true, ...runSide(input.statement), notSelectedIsUnpicked: true });
}

// --- Reading tool-call records ------------------------------------------------------------

/** What a run's tool-call record holds that the section reads (`ToolCallRecord`). */
export interface WhereToolCall {
  name: string;
  args: Record<string, unknown>;
  operationType?: string;
  failed?: boolean;
  failureKind?: string;
  loadOutcome?: string;
}

/** A run, from its tool-call records and the resolver the loop was given. */
export function whereItWentFromCalls(input: {
  toolCalls: readonly WhereToolCall[];
  resolveSource: (name: string) => string | undefined;
  /**
   * The pack a call belongs to, by `sourceId`, from the decision the loop core made for it (fix round 2, F8): the
   * routes pass `packOfDispatchTarget` over the run's dispatch target. Absent, no call is read as a pack's.
   */
  resolvePack?: (name: string) => string | undefined;
  sourcesOffered: readonly OfferedSource[];
  statement?: FlowsStatement | null;
  model: string;
  service: string;
  executed?: boolean;
  /** The run held no pause (the JSON compare route, S4 W2b fix round 1): a `declined` load was not asked about. */
  noPause?: boolean;
}): WhereItWentModel {
  // A search (S3-B W2) is no contact with any source, whatever the resolver would make of its name.
  // OF3b: nor is the map format's step, the site's own (`present_result`).
  const contacts: Contact[] = input.toolCalls.filter((call) => call.operationType !== SEARCH_OPERATION && call.operationType !== PRESENT_STEP_NAME).map((call): Contact =>
    call.operationType === LOAD_OPERATION
      ? { kind: 'load', alias: text(call.args?.alias), outcome: call.loadOutcome ?? '' }
      : (() => {
        const pack = input.resolvePack?.(call.name);
        return { kind: 'call' as const, source: input.resolveSource(call.name), failureKind: call.failed ? call.failureKind ?? 'unknown' : undefined, ...(pack !== undefined ? { pack } : {}) };
      })(),
  );
  return build({
    contacts, model: input.model, service: input.service, sourcesOffered: input.sourcesOffered,
    executed: input.executed === true, ...runSide(input.statement), notSelectedIsUnpicked: true, noPause: input.noPause === true,
  });
}

// --- Reading a package ------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

function serverList(value: unknown): ServerEntry[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry): ServerEntry[] => {
    const e = asRecord(entry);
    return typeof e?.url === 'string' ? [{ url: e.url, ...(typeof e.name === 'string' ? { name: e.name } : {}) }] : [];
  });
}

/** The run's servers: the environment's list, else the root span's `analysis.mcp_servers` (ruling F3), else none. */
function serversOf(pkg: Record<string, unknown>, spans: readonly unknown[]): ServerEntry[] | null {
  const environment = asRecord(asRecord(pkg.extensions)?.['org.civicaitools.environment']);
  const fromEnvironment = serverList(environment?.mcpServers);
  if (fromEnvironment) return fromEnvironment;
  const root = spans.find((s) => asRecord(s) !== undefined && asRecord(s)?.parentSpanId === undefined);
  const attr = root ? text(attributesOf(root as SpanLike).get('analysis.mcp_servers')) : undefined;
  if (attr === undefined) return null;
  try {
    return serverList(JSON.parse(attr));
  } catch {
    return null;
  }
}

function offeredList(value: unknown): OfferedSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): OfferedSource[] => {
    const e = asRecord(entry);
    return typeof e?.sourceId === 'string' && typeof e.alias === 'string' && typeof e.reason === 'string'
      ? [{ sourceId: e.sourceId, alias: e.alias, reason: e.reason }]
      : [];
  });
}

/**
 * A record, against the statement this site serves. Null for a package with
 * no trace: the section is built from the trace alone, never from `queries[]`.
 */
export function whereItWentFromPackage(pkg: unknown, served: FlowsStatement | null): WhereItWentModel | null {
  const record = asRecord(pkg);
  if (!record) return null;
  const spans = spansOfTrace(record.trace);
  if (spans === null) return null;

  const extensions = asRecord(record.extensions);
  const composition = asRecord(extensions?.['org.civicaitools.composition']);
  const reference = asRecord(composition?.flowsStatement);
  const referenceHash = text(reference?.hash);
  const matched = served !== null && referenceHash !== undefined && statementHash(served) === referenceHash;

  const notebook = extensions?.[NOTEBOOK_EXTENSION_KEY];
  const executed = notebook !== undefined && readNotebookProvenanceOfNotebook(notebook).state === 'executed';

  const read = readSpans(spans);
  const statement: WhereStatement = matched
    ? { kind: 'in-force' }
    : reference && typeof reference.url === 'string' && typeof reference.date === 'string'
      ? { kind: 'reference', date: reference.date, url: reference.url }
      : { kind: 'none' };
  return {
    ...build({
      ...read,
      sourcesOffered: offeredList(composition?.sourcesOffered),
      executed,
      side: matched && served ? { kind: 'statement', statement: served } : { kind: 'record', servers: serversOf(record, spans) },
      statement,
      notSelectedIsUnpicked: asRecord(composition?.considered)?.rule === READER_PICKED,
    }),
    chooser: chooserFromPackage(record),
  };
}
