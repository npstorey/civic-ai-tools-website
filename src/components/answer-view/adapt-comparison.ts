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
//      `skill_fetch` span), C (model, portal, and the source hosts the run's
//      configuration recorded on the trace), and F, the answer again.
//
// Relative, extension-carrying imports, so the module runs under `node --test`
// with no loader.

import { AUTHOR, CAPTURED_VIA_WEB_CHAT, NOT_YET_PUBLISHED, type AnswerViewModel, type EnvironmentItem } from './view-model.ts';
import { stepsAuthorLine, type ProgressGroup, type ProgressLogEntry, type StepCall } from '../../lib/answer-view/steps.ts';
import { buildProvenanceLine } from '../../lib/streaming.ts';
import { describeRefusedRequests } from '../../lib/evidence/query-step.ts';
import { coverPortals } from '../../lib/notebook-author/cover-portals.ts';
import { formatModelName } from '../../lib/models.ts';

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
 * The hosts of the MCP servers the run's configuration had, as the run
 * recorded them on its root span (`analysis.mcp_servers`, ADR-0033), in order,
 * or none. An entry whose URL has no host is left out, not guessed at.
 */
export function mcpServerHostsOfTrace(trace: unknown): string[] {
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
    for (const server of servers) {
      const url = (server as { url?: unknown } | null)?.url;
      if (typeof url !== 'string') continue;
      try {
        const host = new URL(url).host;
        if (host && !hosts.includes(host)) hosts.push(host);
      } catch { /* not a URL: left out */ }
    }
    return hosts;
  }
  return [];
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
  const servers = input.evidenceTrace ? mcpServerHostsOfTrace(input.evidenceTrace) : [];
  const environment: EnvironmentItem[] = [
    ...(input.model ? [{ label: 'Model', value: formatModelName(input.model) }] : []),
    ...(input.portal ? [{ label: 'Data portal', value: input.portal !== '__all__' ? input.portal : 'all portals' }] : []),
    ...(servers.length > 0 ? [{ label: 'MCP servers', value: servers.join(', ') }] : []),
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
  };
}
