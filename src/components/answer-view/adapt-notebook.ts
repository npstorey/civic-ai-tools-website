// The executed run's adapter: the notebook stream's state in, the answer view's
// model out (LAYOUT-WEB W3 P1). Pure — no React, no DOM; `ChatNotebookOutput`
// calls it with what the hook holds and what the instance declares, and
// renders `AnswerView` from what it returns.
//
// What each part reads (design §4.1, §4.3):
//   1. the status row: the capture method, the NOTEBOOK'S OWN READING of
//      whether it ran (`readNotebookProvenanceOfNotebook(...).label`, as the
//      record page reads it — C1), and that it is not yet published; under it,
//      `describeRefusedRequests`' line;
//   2. the answer: the rendering cell's outputs (one markdown output is a
//      markdown answer, rendered by the same component as the comparison's),
//      else the legacy synthesis section, else nothing;
//   3. the citation preview;
//   4. the steps: one per Phase A iteration (`buildRunStepView`), then the B,
//      C and D rows (`buildClosingRows`) — only when the run recorded steps;
//   5. the sources line: `buildProvenanceLine` under the hosts the answered
//      calls named (`coverPortals`, answered calls only);
//   6. the disclosure: A-G and the signers, as before.
//
// Relative, extension-carrying imports, so the module runs under `node --test`
// with no loader; `buildChatEvidenceView.ts` beside it is the precedent.

import {
  approximateMcpServers,
  buildChatEvidenceView,
  deliberativeTraceLine,
  type NotebookOutput,
} from './buildChatEvidenceView.ts';
import { AUTHOR, CAPTURED_VIA_WEB_CHAT, NOT_YET_PUBLISHED, type AnswerContent, type AnswerViewModel, type EnvironmentItem, type StepsPart, type SummarySection } from './view-model.ts';
import {
  asStepCall,
  buildClosingRows,
  buildRunStepView,
  stepsAuthorLine,
  type ProgressGroup,
  type ReportedPhase,
} from '../../lib/answer-view/steps.ts';
import { buildProvenanceLine } from '../../lib/streaming.ts';
import { describeRefusedRequests } from '../../lib/evidence/query-step.ts';
import { coverPortals } from '../../lib/notebook-author/cover-portals.ts';
import { readReproductionClaim, reproductionScopeSentence } from '../../lib/notebook-author/reproduction-claim.ts';
import { readNotebookProvenanceOfNotebook } from '../../lib/notebook-author/notebook-provenance-reading.ts';
import { formatModelName } from '../../lib/models.ts';
import type { Notebook } from '../../lib/notebook-author/cells.ts';
// Type-only: erased at compile time.
import type { CapturedToolCall } from '@/hooks/useNotebookStream';

/** What the executed run hands its adapter. */
export interface NotebookAdapterInput {
  notebook: Notebook;
  prompt: string;
  model: string;
  portal: string;
  toolCalls: CapturedToolCall[];
  /** Phase A's steps as the hook grouped them; absent: the run recorded none, and no steps are shown. */
  stepGroups?: ProgressGroup[];
  /** The phase events the run reported: B, C and D close the steps. */
  closingPhases?: ReportedPhase[];
  composedSystemPrompt?: string | null;
  composedSystemPromptHash?: string | null;
  signingKeyId?: string | null;
  title?: string;
  /** The instance's declared host (`useInstanceAttribution().host`), or null. */
  instance: string | null;
  /** The server-resolved Socrata MCP endpoint (`useSocrataMcpUrl()`), or null. */
  socrataMcpUrl: string | null;
}

/** A rendering cell's outputs that are ONE markdown block are a markdown answer. */
function answerContent(outputs: NotebookOutput[] | null, synthesisMarkdown: string): AnswerContent {
  if (outputs !== null) {
    const only = outputs.length === 1 ? outputs[0] : undefined;
    const markdown = only && (only.output_type === 'display_data' || only.output_type === 'execute_result')
      ? flatten(only.data?.['text/markdown'])
      : '';
    return markdown.trim().length > 0 ? { kind: 'markdown', markdown } : { kind: 'cell-outputs', outputs };
  }
  return synthesisMarkdown ? { kind: 'markdown', markdown: synthesisMarkdown } : { kind: 'none' };
}

function flatten(value: string | string[] | undefined): string {
  if (!value) return '';
  return Array.isArray(value) ? value.join('') : value;
}

/** Whether the outputs hold a table or a figure: what a cell computed, not text the model wrote. */
function computesTablesOrFigures(outputs: NotebookOutput[]): boolean {
  return outputs.some((o) => {
    if (o.output_type !== 'display_data' && o.output_type !== 'execute_result') return false;
    const data = o.data ?? {};
    return flatten(data['text/html']).trim().length > 0 || flatten(data['image/png']).trim().length > 0;
  });
}

/** The executed run's steps, or null when the run recorded none (or nothing to show). */
export function notebookSteps(
  stepGroups: ProgressGroup[] | undefined,
  toolCalls: CapturedToolCall[],
  closingPhases: ReportedPhase[] | undefined,
  sandboxDurationMs: number | null,
  instance: string | null,
): StepsPart | null {
  if (stepGroups === undefined) return null;
  const view = buildRunStepView(stepGroups, toolCalls.map(asStepCall));
  const closing = buildClosingRows(closingPhases ?? [], sandboxDurationMs);
  if (view.steps.length === 0 && view.unplaced.length === 0 && closing.length === 0) return null;
  return { kind: 'step-view', author: stepsAuthorLine(instance), view, closing };
}

export function adaptNotebook(input: NotebookAdapterInput): AnswerViewModel {
  const view = buildChatEvidenceView({
    notebook: input.notebook,
    prompt: input.prompt,
    model: input.model,
    portal: input.portal,
    toolCalls: input.toolCalls,
    composedSystemPrompt: input.composedSystemPrompt,
    composedSystemPromptHash: input.composedSystemPromptHash,
    signingKeyId: input.signingKeyId,
  });
  const reading = readNotebookProvenanceOfNotebook(view.notebook);
  const modelName = view.model ? formatModelName(view.model) : null;

  // Ruling D2: the refused-request line, counted by `describeQueryOutcome`
  // over the fields section D hands it, so the two cannot disagree.
  const refused = describeRefusedRequests(
    view.toolCalls.map((q) => ({
      failed: q.failed,
      failureKind: q.failureKind,
      resultRows: q.resultSummary?.rows,
      resultColumns: q.resultSummary?.columns,
    })),
  );

  const content = answerContent(view.renderingCellOutputs, view.synthesisMarkdown);
  const authors: AnswerViewModel['answer']['authors'] = [{ key: 'answer', text: AUTHOR.answer(modelName) }];
  // A part with two authors names both (§6): the tables and figures a cell
  // computed — said only of a notebook whose own reading is that it ran.
  if (content.kind === 'cell-outputs' && reading.state === 'executed' && computesTablesOrFigures(content.outputs)) {
    authors.push({ key: 'computed', text: AUTHOR.computedOutputs() });
  }

  // The sources line: what the answered calls returned, from the portals they named.
  const calls = input.toolCalls.map(asStepCall);
  const line = buildProvenanceLine(calls);
  const sources = line === null ? null : { author: AUTHOR.sources(coverPortals(calls, null).reached), line };

  const portalLabel = view.portal && view.portal !== '__all__' ? view.portal : 'all portals';
  const mcpServers = approximateMcpServers(view.portal, input.socrataMcpUrl);
  const environment: EnvironmentItem[] = [
    { label: 'Model', value: formatModelName(view.model) },
    { label: 'Data portal', value: portalLabel },
    ...(mcpServers.length > 0 ? [{ label: 'MCP servers', value: mcpServers.join(', ') }] : []),
    ...(view.environment?.python ? [{ label: 'Python runtime', value: view.environment.python }] : []),
    ...(view.environment?.libraries
      ? Object.entries(view.environment.libraries).slice(0, 4).map(([name, version]) => ({ label: name, value: version, mono: true }))
      : []),
    ...(view.executedAt ? [{ label: 'Executed at', value: new Date(view.executedAt).toLocaleString() }] : []),
    ...(view.executionDurationMs !== null && view.executionDurationMs !== undefined
      ? [{ label: 'Sandbox duration', value: `${(view.executionDurationMs / 1000).toFixed(1)}s` }]
      : []),
  ];

  const summary: SummarySection = view.structuredSummary
    ? { kind: 'structured', author: AUTHOR.summaryByModel(), ...view.structuredSummary }
    : view.derivedSummary
      ? { kind: 'derived', author: AUTHOR.summaryDerived(input.instance), text: view.derivedSummary }
      : { kind: 'pending' };

  return {
    status: {
      facts: [CAPTURED_VIA_WEB_CHAT, { text: reading.label }, NOT_YET_PUBLISHED],
      refused,
    },
    ...(input.title ? { title: input.title } : {}),
    answer: { content, authors, streaming: false },
    citation: {
      prompt: view.prompt,
      executedAt: view.executedAt,
      statesExecution: true,
      structuredSummary: view.structuredSummary,
      author: AUTHOR.citation(input.instance),
    },
    steps: notebookSteps(input.stepGroups, input.toolCalls, input.closingPhases, view.executionDurationMs, input.instance),
    sources,
    disclosure: {
      question: { author: AUTHOR.question(), prompt: view.prompt },
      instructions: {
        author: AUTHOR.instructions(input.instance),
        hash: view.composedSystemPromptHash,
        text: view.composedSystemPrompt,
      },
      environment,
      // Each call's words come from `deliberativeTraceLine`, where a test reads
      // them (#426): the recorded phrase through the shared sanitiser, and the
      // outcome in `describeQueryOutcome`'s words.
      trace: view.toolCalls.map((q, i) => ({ ...deliberativeTraceLine(q, i + 1), failed: q.failed === true })),
      notebook: { notebook: view.notebook, scopeSentence: reproductionScopeSentence(readReproductionClaim(view.notebook.cells)) },
      answerAgain: true,
      summary,
      signers: { executedAt: view.executedAt, signingKeyId: view.signingKeyId },
    },
  };
}
