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
 * failed with any kind but `not_configured` or `not_offered`: a `timeout`, an
 * `unavailable` or an `unknown` call may have arrived. A load reaches nothing:
 * this site answers it. Rows are in order of first contact: the model
 * endpoint, each reached source, then the notebook runner of an executed run.
 *
 * THE STATEMENT. On a run, the statement the consent gate built for it. On a
 * record whose reference has the served statement's hash, that statement.
 * Either way every recipient the statement's row carries is shown, with its
 * place, what it receives and its holders. Otherwise (D1, the seat's
 * correction, and Stage C) the recipients and places come from the record: one
 * per row, and nothing it received or keeps; the view says that once.
 */
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { statementHash, type FlowsKeptBy, type FlowsRecipient, type FlowsStatement } from './statement.ts';
import { readerSourceName, recipientWhere, roleLabel } from '../sources/source-name.ts';
import { WHERE_IT_WENT_REASONS } from '../sources/copy.ts';
import { NOTEBOOK_EXTENSION_KEY, readNotebookProvenanceOfNotebook } from '../notebook-author/notebook-provenance-reading.ts';

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
  | { kind: 'source'; sourceId: string; name: string; calls: number; recipients: WhereRecipientRow[] }
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
/** A call that failed with one of these was never received. */
const NOT_RECEIVED = new Set(['not_configured', 'not_offered']);

type Contact =
  | { kind: 'call'; source: string | undefined; failureKind: string | undefined }
  | { kind: 'load'; alias: string | undefined; outcome: string };

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
}

function nameOf(sourceId: string, alias: string | undefined): string {
  const entry = CIVIC_MANIFEST.find((e) => e.sourceId === sourceId);
  return entry ? readerSourceName({ sourceId, displayName: entry.displayName }) : alias ?? sourceId;
}

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

function sourceRecipients(side: Side, sourceId: string): WhereRecipientRow[] {
  if (side.kind === 'statement') {
    const row = side.statement.sources.find((s) => s.sourceId === sourceId);
    if (row && row.recipients.length > 0) return row.recipients.map((r) => shown(r, sourceId));
    return [recorded(roleLabel('source'), NOT_RECORDED)];
  }
  // The record's facts: one recipient, at the address the run's servers name.
  const server = side.servers?.find((s) => s.name === sourceId);
  if (!server) return [recorded(roleLabel('source'), NOT_RECORDED)];
  if (server.url.startsWith('pkg:')) return [recorded(roleLabel('sandbox-platform'), recipientWhere({ runsAt: 'instance-sandbox' }))];
  return [recorded(roleLabel('source'), hostOfAddress(server.url))];
}

/** A source's reason for not being reached (§2): its last load first, then its stated reason. */
function whyNotSentFor(offered: OfferedSource, lastLoad: string | undefined): string | null {
  const R = WHERE_IT_WENT_REASONS;
  switch (lastLoad) {
    case 'loaded':
      return offered.reason === 'not-consented' ? R.allowedNotUsed : R.onNotUsed;
    case 'declined':
      return R.declined;
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
    default:
      // A reason with no words (the router's raw `not-selected`, which every
      // route maps through `recordReasons` before it reaches here).
      return null;
  }
}

function build(input: CoreInput): WhereItWentModel {
  const calls = new Map<string, number>();
  for (const contact of input.contacts) {
    if (contact.kind !== 'call') continue;
    const { source, failureKind } = contact;
    if (!source || source === 'unknown') continue;
    if (failureKind !== undefined && NOT_RECEIVED.has(failureKind)) continue;
    calls.set(source, (calls.get(source) ?? 0) + 1);
  }

  const lastLoad = new Map<string, string>();
  for (const contact of input.contacts) {
    if (contact.kind !== 'load' || contact.outcome === 'not-offered') continue;
    const offered = input.sourcesOffered.find((o) => o.alias === contact.alias);
    if (offered) lastLoad.set(offered.sourceId, contact.outcome);
  }

  const reached: WhereReachedRow[] = [
    { kind: 'model', name: roleLabel('model-endpoint'), model: input.model, service: input.service, recipients: baseRecipients(input.side, 'model-endpoint') },
  ];
  for (const [sourceId, count] of calls) {
    const alias = input.sourcesOffered.find((o) => o.sourceId === sourceId)?.alias;
    reached.push({ kind: 'source', sourceId, name: nameOf(sourceId, alias), calls: count, recipients: sourceRecipients(input.side, sourceId) });
  }
  if (input.executed) {
    reached.push({ kind: 'notebook', name: roleLabel('notebook-executor'), recipients: baseRecipients(input.side, 'notebook-executor') });
  }

  const notReached: WhereNotReachedRow[] = [];
  for (const offered of input.sourcesOffered) {
    if (calls.has(offered.sourceId)) continue;
    const whyNotSent = whyNotSentFor(offered, lastLoad.get(offered.sourceId));
    if (whyNotSent !== null) notReached.push({ sourceId: offered.sourceId, name: nameOf(offered.sourceId, offered.alias), whyNotSent });
  }

  return { reached, notReached, statement: input.statement };
}

const runSide = (statement: FlowsStatement | null | undefined): { side: Side; statement: WhereStatement } =>
  statement ? { side: { kind: 'statement', statement }, statement: { kind: 'in-force' } } : { side: { kind: 'record', servers: null }, statement: { kind: 'none' } };

// --- Reading spans ----------------------------------------------------------------------

interface SpanLike { name?: unknown; parentSpanId?: unknown; attributes?: unknown }

/** A span's attributes as plain values; anything not in the OTLP shape reads as nothing. */
function attributesOf(span: SpanLike): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!Array.isArray(span.attributes)) return out;
  for (const attr of span.attributes as unknown[]) {
    if (attr === null || typeof attr !== 'object') continue;
    const { key, value } = attr as { key?: unknown; value?: unknown };
    if (typeof key !== 'string' || value === null || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    out.set(key, v.stringValue ?? v.boolValue ?? v.intValue ?? v.doubleValue);
  }
  return out;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function aliasOf(argumentsJson: string | undefined): string | undefined {
  if (argumentsJson === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    return parsed !== null && typeof parsed === 'object' ? text((parsed as { alias?: unknown }).alias) : undefined;
  } catch {
    return undefined;
  }
}

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
      if (attrs.get('tool.operation_type') === LOAD_OPERATION) {
        contacts.push({ kind: 'load', alias: aliasOf(text(attrs.get('tool.arguments'))), outcome: text(attrs.get('tool.load_outcome')) ?? '' });
      } else {
        const failed = attrs.get('error') === true || attrs.has('error.kind');
        contacts.push({ kind: 'call', source: text(attrs.get('mcp.source')), failureKind: failed ? text(attrs.get('error.kind')) ?? 'unknown' : undefined });
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
  return build({ ...read, sourcesOffered: input.sourcesOffered, executed: input.executed === true, ...runSide(input.statement) });
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
  sourcesOffered: readonly OfferedSource[];
  statement?: FlowsStatement | null;
  model: string;
  service: string;
  executed?: boolean;
}): WhereItWentModel {
  const contacts: Contact[] = input.toolCalls.map((call): Contact =>
    call.operationType === LOAD_OPERATION
      ? { kind: 'load', alias: text(call.args?.alias), outcome: call.loadOutcome ?? '' }
      : { kind: 'call', source: input.resolveSource(call.name), failureKind: call.failed ? call.failureKind ?? 'unknown' : undefined },
  );
  return build({
    contacts, model: input.model, service: input.service, sourcesOffered: input.sourcesOffered,
    executed: input.executed === true, ...runSide(input.statement),
  });
}

// --- Reading a package ------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

function spansOfTrace(trace: unknown): unknown[] | null {
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
  return build({
    ...read,
    sourcesOffered: offeredList(composition?.sourcesOffered),
    executed,
    side: matched && served ? { kind: 'statement', statement: served } : { kind: 'record', servers: serversOf(record, spans) },
    statement,
  });
}
