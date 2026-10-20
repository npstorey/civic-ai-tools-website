/**
 * How a source and its recipients read to a reader (R6 W3, #632): the names,
 * places and kept-by lines the Sources panel, the consent card, the
 * dashboard's Sources tab and the privacy page's source rows all show, from
 * one place, so the four cannot say different things.
 *
 * Pure: no store, no request, no network. It reads the flows statement's
 * shape (`../flows/statement.ts`) and nothing else.
 */
import type { FlowsKeptBy, FlowsRecipient, FlowsSource } from '../flows/statement.ts';

const SUFFIX = ' MCP Server';

/**
 * A source's name as a reader reads it: the manifest's `displayName` with a
 * trailing " MCP Server" removed (implementation language, design P9). A
 * name without the suffix is shown whole, and the suffix is removed only at
 * the end.
 */
export function readerSourceName(displayName: string): string {
  return displayName.endsWith(SUFFIX) ? displayName.slice(0, -SUFFIX.length) : displayName;
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
      return `${k.holder}: for this site's operator to state`;
  }
}

/** The page and date a kept-by line rests on, when it rests on one: "(statement, read 2026-10-19)". */
export function readOnText(k: Pick<FlowsKeptBy, 'readOn'>): string {
  return k.readOn ? `read ${k.readOn}` : '';
}
