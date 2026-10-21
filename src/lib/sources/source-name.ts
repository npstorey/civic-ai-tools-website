/**
 * How a source and its recipients read to a reader (R6 W3, #632): the names,
 * places and kept-by lines the Sources panel, the consent card, the
 * dashboard's Sources tab, the notices and the privacy page all show, from
 * one place, so they cannot say different things.
 *
 * Pure: no store, no request, no network. It reads the flows statement's
 * shape (`../flows/statement.ts`, types only), and from the consent texts
 * (`./copy.ts`) one phrase, the map of what each source is and whose
 * connector reaches it, and the reach sentence's words. It does not read the evidence registry
 * (`../evidence/data-sources.ts`): that would bring the registry and the
 * harness into the client bundle through the panel and the card. The two
 * agree instead by test (`./source-name.test.ts`).
 */
import type { FlowsKeptBy, FlowsRecipient, FlowsSource } from '../flows/statement.ts';
import { KEPT_FOR_OPERATOR, REACH_SENTENCE, SOURCE_DESCRIPTIONS } from './copy.ts';

const SUFFIX = ' MCP Server';

/** A source's name, by id, where the manifest's name is not the one a reader reads (T13). */
const READER_NAME: Readonly<Record<string, string>> = {
  'data-commons': 'Data Commons',
};

/** What a caller holds of a source: its id, and the manifest's `displayName` or the registry's `label`. */
export interface NamedSource {
  sourceId: string;
  displayName?: string;
  label?: string;
}

/**
 * A source's name as a reader reads it, the same name the record page gives
 * it (`displayNameForSource`, pinned by `./source-name.test.ts`): the
 * override for its id when it has one; otherwise its `displayName` (or
 * `label`) with a trailing " MCP Server" removed (implementation language,
 * design P9). A name without the suffix is shown whole, and the suffix is
 * removed only at the end.
 */
export function readerSourceName(source: NamedSource): string {
  const override = READER_NAME[source.sourceId];
  if (override !== undefined) return override;
  const name = source.displayName ?? source.label ?? source.sourceId;
  return name.endsWith(SUFFIX) ? name.slice(0, -SUFFIX.length) : name;
}

/** Where a source or a recipient runs, in reader words. */
const RUNS_AT: Readonly<Record<string, string>> = {
  'instance-sandbox': "this site's sandbox",
  publisher: "its publisher's endpoint",
  government: 'a government server',
  other: "its operator's server",
};

/** The place a recipient is reached at: its host, or where it runs. */
export function recipientWhere(recipient: Pick<FlowsRecipient, 'host' | 'runsAt'>): string {
  if (recipient.host) return recipient.host;
  return recipient.runsAt ? RUNS_AT[recipient.runsAt] ?? recipient.runsAt : 'not stated';
}

/** Where a source runs: its configured host, or the place its variant runs at. */
export function sourceWhere(source: Pick<FlowsSource, 'host' | 'variant'>): string {
  return source.host ?? RUNS_AT[source.variant.runsAt] ?? source.variant.runsAt;
}

const ROLE: Readonly<Record<FlowsRecipient['role'], string>> = {
  'model-endpoint': 'Model endpoint',
  'function-logs': "This site's hosting logs",
  'sign-in': 'Sign-in',
  analytics: 'Analytics',
  'notebook-executor': 'Notebook runner',
  source: 'Data source',
  'sandbox-platform': 'Sandbox platform',
};

/** A base recipient's label: its role. A source's recipient is labelled by the source's name instead. */
export function roleLabel(role: FlowsRecipient['role']): string {
  return ROLE[role] ?? role;
}

/** What a holder says it keeps, in reader words; "not stated" and "not read" as they are. */
export function keepsText(k: Pick<FlowsKeptBy, 'holder' | 'keeps'>): string {
  switch (k.keeps) {
    case 'none':
      return `${k.holder} says it keeps nothing`;
    case 'metadata':
      return `${k.holder} says it keeps facts about each request`;
    case 'content':
      return `${k.holder} says it keeps what it receives`;
    case 'not-stated':
      return `${k.holder}: not stated`;
    case 'not-read':
      return `${k.holder}: not read`;
    default:
      return `${k.holder}: ${KEPT_FOR_OPERATOR}`;
  }
}

/** The page and date a kept-by line rests on, when it rests on one: "(statement, read 2026-10-19)". */
export function readOnText(k: Pick<FlowsKeptBy, 'readOn'>): string {
  return k.readOn ? `read ${k.readOn}` : '';
}

/** A piece of a row line: text, or a link with its text. */
export type RowSegment = string | { link: string; text: string };

/** What a source's row says of it (R6 PL): the what-line as stored, or null, and the reach sentence. */
export interface SourceRowLines {
  what: string | null;
  reach: RowSegment[];
}

/**
 * What a source is and whose connector reaches it, from a statement source
 * (D1 = A, D2 = A). With an entry in `SOURCE_DESCRIPTIONS`: its what-line as
 * stored (each surface decides the case) and the reach sentence, the
 * publisher's name a link to the connector's repository. Without one: no
 * what-line, and the reach sentence with the statement's `publisher`,
 * unlinked, or saying the publisher is not stated. The map is read on every
 * call. Every surface that prints a source's publisher calls this.
 */
export function sourceRowLines(source: Pick<FlowsSource, 'sourceId' | 'publisher' | 'host' | 'variant'>): SourceRowLines {
  const where = sourceWhere(source);
  const entry = Object.prototype.hasOwnProperty.call(SOURCE_DESCRIPTIONS, source.sourceId) ? SOURCE_DESCRIPTIONS[source.sourceId] : undefined;
  if (entry !== undefined) {
    return { what: entry.what, reach: [REACH_SENTENCE.before, { link: entry.link, text: entry.publisher }, `${REACH_SENTENCE.after}${where}${REACH_SENTENCE.end}`] };
  }
  if (source.publisher === 'not stated') return { what: null, reach: [`${REACH_SENTENCE.unstated}${where}${REACH_SENTENCE.end}`] };
  return { what: null, reach: [`${REACH_SENTENCE.before}${source.publisher}${REACH_SENTENCE.after}${where}${REACH_SENTENCE.end}`] };
}
