// The comparison's adapter: the with-data panel's state in, the answer view's
// model out (LAYOUT-WEB W3 P1). Pure — no React, no DOM; `McpResponseDisplay`
// calls it and renders `AnswerView` from what it returns, around its own
// chrome (the question, the live progress, the timing bar, the publish dialog).
//
// What each part reads (design §4.1, §4.3; the anchor's W3 P1 item 2):
//   1. the status row: the capture method and that the run is not yet
//      published — on a surface that keeps the run's trace to publish (see
//      `tracesRun`); under it, `describeRefusedRequests`' line;
//   2. the answer: the streamed content, as markdown;
//   3. the citation preview, once the run is complete, on the same surfaces;
//      it states no execution and no date — the run never executes in a
//      sandbox, and records no time a citation could carry;
//   4. the steps: the progress log the panel already renders, moved beneath
//      the answer;
//   5. the sources line: `buildProvenanceLine` (the panel's former
//      provenance line) under the hosts the answered calls named;
//   6. the disclosure: B (the system prompt's hash, from the trace's
//      `skill_fetch` span), C (model, the run's portal when it holds one, the
//      source hosts the run's configuration recorded on the trace, and what
//      chose its sources, R10 P1), and F, the answer again.
//
// WHAT CHOSE THE SOURCES (R10 P1, #682). Read from the trace alone
// (`chooserFromTrace`): the chooser line joins "Where this question went" and
// the card joins C once the `trace` event has arrived; before it, and on a
// surface that keeps no trace (`/explore`), neither shows (P-f).
//
// Relative, extension-carrying imports, so the module runs under `node --test`
// with no loader.

import { AUTHOR, CAPTURED_VIA_WEB_CHAT, NOT_YET_PUBLISHED, type AnswerViewModel, type EnvironmentItem } from './view-model.ts';
import { stepsAuthorLine, type ProgressGroup, type ProgressLogEntry, type StepCall } from '../../lib/answer-view/steps.ts';
import { buildProvenanceLine } from '../../lib/streaming.ts';
import { describeRefusedRequests } from '../../lib/evidence/query-step.ts';
import { coverPortals } from '../../lib/notebook-author/cover-portals.ts';
import { formatModelName } from '../../lib/models.ts';
import { readerSourceName } from '../../lib/sources/source-name.ts';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import type { WhereItWentModel } from '../../lib/flows/where-it-went.ts';
import { chooserCardItems, chooserFromTrace, runHoldsPortal } from '../../lib/flows/source-chooser.ts';
import { RUN_PORTAL_LABEL } from '../../lib/sources/copy.ts';

/** What the with-data panel hands its adapter. */
export interface ComparisonAdapterInput {
  /** The answer as the panel shows it (dataset ids already linked). */
  content: string;
  isComplete: boolean;
  isActive: boolean;
  queryText?: string;
  toolsCalled: StepCall[];
  progressGroups: ProgressGroup[];
  progressLog: ProgressLogEntry[];
  duration_ms?: number;
  model?: string;
  portal?: string;
  /**
   * The run's trace: `null` until the stream's `trace` event arrives, on a
   * surface that keeps it to publish (the home page and `/ask`, through
   * `ResponsePanel`); `undefined` on a surface that keeps none (`/explore`).
   */
  evidenceTrace?: Record<string, unknown> | null;
  /** The instance's declared host (`useInstanceAttribution().host`), or null. */
  instance: string | null;
  /** R6 W4: where the question went, from the completion's `flows`; absent, no section. */
  flows?: WhereItWentModel | null;
}

// --- Reading the trace ------------------------------------------------------------
//
// The trace is the OTLP shape `TraceBuilder.finalize()` writes:
// `resourceSpans[].scopeSpans[].spans[]`, each span's `attributes` a list of
// `{ key, value: { stringValue | intValue | … } }`. Anything else reads as
// nothing, never as a value.

interface SpanShape { name?: unknown; attributes?: unknown }

function spansOf(trace: unknown): SpanShape[] {
  const out: SpanShape[] = [];
  const resourceSpans = (trace as { resourceSpans?: unknown } | null)?.resourceSpans;
  if (!Array.isArray(resourceSpans)) return out;
  for (const rs of resourceSpans) {
    const scopeSpans = (rs as { scopeSpans?: unknown } | null)?.scopeSpans;
    if (!Array.isArray(scopeSpans)) continue;
    for (const ss of scopeSpans) {
      const spans = (ss as { spans?: unknown } | null)?.spans;
      if (Array.isArray(spans)) out.push(...(spans as SpanShape[]));
    }
  }
  return out;
}

function stringAttribute(span: SpanShape, key: string): string | undefined {
  if (!Array.isArray(span.attributes)) return undefined;
  for (const a of span.attributes as Array<{ key?: unknown; value?: { stringValue?: unknown } } | null>) {
    if (a?.key === key && typeof a.value?.stringValue === 'string') return a.value.stringValue;
  }
  return undefined;
}

/** The composed system prompt's hash, as the `skill_fetch` span recorded it (`skill.text_hash`), or null. */
export function systemPromptHashOfTrace(trace: unknown): string | null {
  for (const span of spansOf(trace)) {
    if (span.name !== 'skill_fetch') continue;
    const hash = stringAttribute(span, 'skill.text_hash');
    if (hash) return hash;
  }
  return null;
}

/**
 * The MCP servers the run's configuration had, as the run recorded them on
 * its root span (`analysis.mcp_servers`, ADR-0033), in order, one per host,
 * or none. An entry whose URL has no host (a hosted source's purl) or does not
 * parse is kept, once per address, as the record page keeps it: the row's
 * label says these are the sources this site could use, so none is dropped
 * (the owner's fix to UX pass row 12). `readerServerName` states it.
 */
export function mcpServersOfTrace(trace: unknown): Array<{ url: string; name?: string }> {
  for (const span of spansOf(trace)) {
    const recorded = stringAttribute(span, 'analysis.mcp_servers');
    if (recorded === undefined) continue;
    let servers: unknown;
    try {
      servers = JSON.parse(recorded);
    } catch {
      return [];
    }
    if (!Array.isArray(servers)) return [];
    const hosts: string[] = [];
    const out: Array<{ url: string; name?: string }> = [];
    for (const server of servers) {
      const url = (server as { url?: unknown } | null)?.url;
      const name = (server as { name?: unknown } | null)?.name;
      if (typeof url !== 'string') continue;
      let host = '';
      try { host = new URL(url).host; } catch { /* not a URL: kept by its address */ }
      const key = host || url;
      if (!hosts.includes(key)) {
        hosts.push(key);
        out.push(typeof name === 'string' ? { url, name } : { url });
      }
    }
    return out;
  }
  return [];
}

/** The hosts of `mcpServersOfTrace`, in order; an entry with no host is left out. */
export function mcpServerHostsOfTrace(trace: unknown): string[] {
  return mcpServersOfTrace(trace).flatMap((s) => {
    try { const host = new URL(s.url).host; return host ? [host] : []; } catch { return []; }
  });
}

// --- The servers row, in the reader's words (UX pass row 12) ----------------------

/** Section C's label for the servers a run's configuration had, and for the sources it used. */
export const SERVERS_LABEL = 'Data sources this site could use';
export const USED_SOURCES_LABEL = 'Data sources used';

/**
 * One configured server as a reader reads it: when its recorded `name` is a
 * manifest source's id, that source's reader name (`readerSourceName`, the
 * name the Sources panel and the record page give it) with its host, or, for a
 * package it ran (a purl, whose URL has no host), the version it pinned:
 * "Socrata (socrata-mcp.civicaitools.org)", "NYC Checkbook (1.6.3)". A server
 * no source names reads as stored: its host, or its raw value when the URL
 * has no host or does not parse. Rendering only; the record is unchanged.
 */
export function readerServerName(server: { url: string; name?: string }): string {
  let host = '';
  try { host = new URL(server.url).host; } catch { /* not a URL */ }
  const source = server.name ? CIVIC_MANIFEST.find((e) => e.sourceId === server.name) : undefined;
  if (!source) return host || server.url;
  const name = readerSourceName(source);
  if (host) return `${name} (${host})`;
  const pinned = /^pkg:[^@]+@([^@/?#]+)$/.exec(server.url)?.[1];
  return pinned ? `${name} (${decodeURIComponent(pinned)})` : name;
}

/** The servers row's value: each server as `readerServerName` reads it, in order. */
export function readerServerList(servers: ReadonlyArray<{ url: string; name?: string }>): string {
  return servers.map(readerServerName).join(', ');
}

// --- The model --------------------------------------------------------------------

/**
 * Whether the surface keeps the run's trace to publish it. The status row's
 * "not yet published" and the citation preview speak of a record the run can
 * become, so they are stated only where it can.
 */
function tracesRun(input: ComparisonAdapterInput): boolean {
  return input.evidenceTrace !== undefined;
}

export function adaptComparison(input: ComparisonAdapterInput): AnswerViewModel {
  const calls = input.toolsCalled;
  const refused = describeRefusedRequests(
    calls.map((t) => ({
      failed: t.failed,
      failureKind: t.failureKind,
      resultRows: t.resultSummary?.rows,
      resultColumns: t.resultSummary?.columns,
    })),
  );
  const facts = tracesRun(input) ? [CAPTURED_VIA_WEB_CHAT, NOT_YET_PUBLISHED] : [];
  const status = facts.length > 0 || refused !== null ? { facts, refused } : null;

  const modelName = input.model ? formatModelName(input.model) : null;
  const hasSteps = input.progressLog.length > 0 || input.progressGroups.length > 0;
  const line = calls.length > 0 ? buildProvenanceLine(calls) : null;

  const hash = input.evidenceTrace ? systemPromptHashOfTrace(input.evidenceTrace) : null;
  const servers = input.evidenceTrace ? mcpServersOfTrace(input.evidenceTrace) : [];
  const chooser = input.evidenceTrace ? chooserFromTrace(input.evidenceTrace) : null;
  const environment: EnvironmentItem[] = [
    ...(input.model ? [{ label: 'Model', value: formatModelName(input.model) }] : []),
    // Shown only when the run holds a portal (R10 P1): never a word for none.
    ...(runHoldsPortal(input.portal) ? [{ label: RUN_PORTAL_LABEL, value: input.portal }] : []),
    ...(servers.length > 0 ? [{ label: SERVERS_LABEL, value: readerServerList(servers) }] : []),
    ...(chooser ? chooserCardItems(chooser) : []),
  ];

  return {
    status,
    answer: {
      content: { kind: 'markdown', markdown: input.content },
      authors: [{ key: 'answer', text: AUTHOR.answer(modelName) }],
      streaming: input.isActive && !input.isComplete,
    },
    citation: tracesRun(input) && input.isComplete
      ? { prompt: input.queryText ?? '', executedAt: null, statesExecution: false, structuredSummary: null, author: AUTHOR.citation(input.instance) }
      : null,
    steps: hasSteps
      ? {
          kind: 'progress-log',
          author: stepsAuthorLine(input.instance),
          groups: input.progressGroups,
          standaloneEntries: input.progressLog.filter((e) => !e.iteration),
          isComplete: input.isComplete && calls.length > 0,
          ...(input.isComplete ? { toolsCalled: calls, totalDuration_ms: input.duration_ms } : {}),
        }
      : null,
    sources: line === null ? null : { author: AUTHOR.sources(coverPortals(calls, null).reached), line },
    disclosure: {
      ...(hash !== null ? { instructions: { author: AUTHOR.instructions(input.instance), hash } } : {}),
      ...(environment.length > 0 ? { environment } : {}),
      answerAgain: true,
    },
    ...(input.flows ? { whereItWent: chooser ? { ...input.flows, chooser } : input.flows } : {}),
  };
}
