/**
 * Phase B orchestrator (ADR-0005 §1): assemble a complete, ready-to-execute
 * Jupyter notebook from Phase A's discovery outputs.
 *
 * Inputs:
 *   - The original user query and the portal(s) involved.
 *   - The Phase A tool-call list (fetching + discovery calls).
 *   - The Phase A synthesis text (the chat-flow LLM's final answer).
 *
 * Output: a `Notebook` JSON object with cells 0..N populated and
 * `metadata.extensions[org.civicaitools.notebook].provenance` set to
 * `"executed"`. The sandbox executes this notebook in Phase C; Phase D
 * later appends the comparison cell and stamps the execution metadata.
 *
 * No additional LLM call is required in Phase B for v1 — every cell is
 * either templated (cells 0..4 + footer) or translated mechanically from
 * a Phase A tool call (steps 5..N). The chat-flow's final answer becomes
 * the synthesis-cell body; Phase 3 may refine this to reference DataFrames
 * by name once the dataframe-extraction heuristic from ADR-0005 §5 lands.
 */
import type { Notebook } from './cells.ts';
import { codeCell, emptyNotebook, markdownCell } from './cells.ts';
import { getPublicationHost } from '../site-config.ts';
import { getHelperSource, helpersForToolNames, type HelperId } from './helpers/index.ts';
import { buildMetricCaptureCell } from './phase-d.ts';
import {
  CELL_4_HEADER,
  NOTEBOOK_EXTENSION_KEY,
  PYTHON_RUNTIME_VERSION,
  SUMMARY_EXTENSION_KEY,
  SYNTHESIS_CELL_ROLE,
  type StructuredSummary,
  buildCell0Source,
  buildCell1Source,
  buildCell2Source,
  buildFooterCellSource,
  buildSynthesisCellSource,
  parseSynthesisOutput,
} from './prompt.ts';
import {
  type PhaseAToolCall,
  countAnalysisSteps,
  countReproducibleFetches,
  renderDiscoverySummaryCell,
  renderFetchToolCell,
} from './tool-to-cell.ts';

export interface PhaseAOutputs {
  query: string;
  defaultPortal: string;
  toolCalls: readonly PhaseAToolCall[];
  /** The chat-flow's final answer; becomes the synthesis cell body. */
  finalAnswer: string;
  /** The operator-declared model identity — never a deployment name. */
  modelName: string;
  /**
   * How this instance reached that model, from `modelAccessPhrase()`
   * (src/lib/model-catalog.ts). Threaded from the route rather than read here
   * so this module stays free of the SDK-bearing endpoint layer
   * (civic-ai-tools-website#30 P3, E6).
   */
  modelAccess: string;
  /** Override for deterministic tests; defaults to current UTC time. */
  generatedAt?: string;
}

export interface SynthesisOutputs {
  notebook: Notebook;
  /** DataFrame variable names produced (`df1`, `df2`, …). */
  dataFrameVariables: string[];
  /** Helpers actually embedded inline (see ADR-0005 §3). */
  embeddedHelpers: HelperId[];
  /** Structured summary parsed from the LLM's reproducible-mode output, if any. */
  summary: StructuredSummary | null;
}

function buildHelperCellSource(helperIds: readonly HelperId[]): string {
  const blocks = helperIds.map(id => getHelperSource(id).trimEnd());
  // #258: name the instance host only when one is declared (honest omission).
  const host = getPublicationHost();
  return [
    '# Helper functions (embedded inline per ADR-0005 §3).',
    `# Source of truth: src/lib/notebook-author/helpers/*.py${host ? ` on ${host}` : ''}.`,
    '',
    ...blocks,
  ].join('\n\n');
}

function uniquePortals(toolCalls: readonly PhaseAToolCall[], fallback: string): string[] {
  const set = new Set<string>();
  for (const call of toolCalls) {
    const p = call.args.portal as string | undefined;
    if (p) set.add(p);
  }
  if (set.size === 0 && fallback) set.add(fallback);
  return [...set];
}

export function synthesizeNotebook(inputs: PhaseAOutputs): SynthesisOutputs {
  const generatedAt = inputs.generatedAt ?? new Date().toISOString();
  const portals = uniquePortals(inputs.toolCalls, inputs.defaultPortal);
  const toolNames = inputs.toolCalls.map(c => c.name);
  const helperIds = helpersForToolNames(toolNames);

  const notebook = emptyNotebook(PYTHON_RUNTIME_VERSION);

  // Cell 0 — branding + query + onboarding. Both counts are computed from the
  // tool calls, not from the cells: cell 0 is written before the step cells
  // exist, and its claim about what this notebook reproduces has to be true of
  // the document that follows it (#341, #371). `validate.ts` then re-derives
  // both from the cells, so the claim is checked against the document rather
  // than trusted.
  notebook.cells.push(markdownCell(buildCell0Source({
    query: inputs.query,
    generatedAt,
    portals,
    reproducedFetchCount: countReproducibleFetches(inputs.toolCalls),
    analysisStepCount: countAnalysisSteps(inputs.toolCalls),
  })));
  // Cell 1 — environment setup
  notebook.cells.push(codeCell(buildCell1Source()));
  // Cell 2 — imports
  notebook.cells.push(codeCell(buildCell2Source()));
  // Cell 3 — helper definitions (inline)
  notebook.cells.push(codeCell(buildHelperCellSource(helperIds)));
  // Cell 4 — section header
  notebook.cells.push(markdownCell(CELL_4_HEADER));

  // Optional discovery summary (catalog/metadata/schema calls collapsed)
  const discoveryCell = renderDiscoverySummaryCell(inputs.toolCalls);
  if (discoveryCell) notebook.cells.push(discoveryCell);

  // Steps 5..N — one (markdown + code) pair per fetching tool call
  const dataFrameVariables: string[] = [];
  const citationMap = new Map<string, { id: string; label: string; url: string }>();
  let dataFrameIndex = 1;
  for (const call of inputs.toolCalls) {
    const rendered = renderFetchToolCell(call, {
      dataFrameIndex,
      defaultPortal: inputs.defaultPortal,
    });
    if (!rendered) continue;
    notebook.cells.push(...rendered.cells);
    if (rendered.dataFrameVariable) {
      dataFrameVariables.push(rendered.dataFrameVariable);
    }
    if (rendered.citation) {
      citationMap.set(rendered.citation.id, rendered.citation);
    }
    // Only a call that actually produced a DataFrame consumes a step number.
    // Since #321 a rendered call is no longer necessarily a fetching one — a
    // failed call renders a markdown note and no DataFrame — and advancing on
    // it would number the following fetch "Step 2" with no Step 1 in the
    // notebook, or leave a gap mid-sequence.
    if (rendered.producedDataFrame) dataFrameIndex += 1;
  }

  // Metric capture — prints a single `_civic_capture=…` line that Phase D
  // parses after sandbox execution to build the comparison cell with
  // original-value literals.
  notebook.cells.push(buildMetricCaptureCell(dataFrameVariables));

  // Phase 2a2 (item 2 + 3): parse the LLM's reproducible-mode answer for
  // the synthesis code block and the structured summary. The LLM emits both
  // per the C5 skill-guidance update; either may be absent on imperfect
  // output, in which case `buildSynthesisCellSource` falls back to wrapping
  // the raw answer in display(Markdown(...)).
  const parsed = parseSynthesisOutput(inputs.finalAnswer ?? '');
  const synthesisCellSource = buildSynthesisCellSource({
    synthesisCode: parsed.synthesisCode,
    rawAnswer: inputs.finalAnswer ?? '',
  });
  notebook.cells.push(codeCell(synthesisCellSource, { role: SYNTHESIS_CELL_ROLE }));

  // Footer cell — citations + reproducibility + generation metadata
  notebook.cells.push(markdownCell(buildFooterCellSource({
    citations: [...citationMap.values()],
    generatedAt,
    modelName: inputs.modelName,
    modelAccess: inputs.modelAccess,
  })));

  // Stamp notebook-provenance discriminator (org.civicaitools.notebook.provenance).
  // Phase D fills in the execution metadata after sandbox execution.
  notebook.metadata.extensions = {
    ...(notebook.metadata.extensions ?? {}),
    [NOTEBOOK_EXTENSION_KEY]: {
      ...(((notebook.metadata.extensions ?? {})[NOTEBOOK_EXTENSION_KEY] as Record<string, unknown> | undefined) ?? {}),
      provenance: 'executed',
    },
  };

  // Phase 2a2 (item 3): stamp the structured summary in notebook root
  // metadata when the LLM provided one. Section G + the citation block
  // read from this field; legacy clients ignore it.
  if (parsed.summary) {
    notebook.metadata.extensions = {
      ...notebook.metadata.extensions,
      [SUMMARY_EXTENSION_KEY]: parsed.summary,
    };
  }

  return {
    notebook,
    dataFrameVariables,
    embeddedHelpers: helperIds,
    summary: parsed.summary,
  };
}
