/**
 * Phase 2a1 — synthesize an EvidencePackage-like view from the executed
 * notebook + the streaming hook's captured state.
 *
 * The detail page (src/app/evidence/[slug]/page.tsx) renders datHere-profile
 * packages as A-G sections sourced from an `EvidencePackage`. Chat output is
 * pre-publish — there is no canonical `EvidencePackage` yet — but the
 * notebook carries enough metadata to populate the same sections honestly:
 *
 *   - A · prompt        ← user's chat input verbatim
 *   - B · system prompt ← composed prompt text streamed via the SSE
 *                          `metadata` event (Phase 2a2 item 1); rendered
 *                          inline behind a disclosure with truncated hash
 *   - C · model + env   ← `extensions["org.civicaitools.execution"]` +
 *                          tool model selection
 *   - D · tool calls    ← accumulated via `phase_a_tool_call` SSE events
 *   - E · notebook      ← the executed notebook JSON itself
 *   - F · rendered      ← outputs of the rendering code cell tagged
 *                          metadata.role === "synthesis" (Phase 2a2 item 2);
 *                          falls back to legacy `## Synthesis` markdown
 *                          extraction for backward-compatible notebooks
 *   - G · summary       ← structured summary at
 *                          extensions["org.civicaitools.summary"]
 *                          (Phase 2a2 item 3); falls back to first-sentence
 *                          heuristic from synthesis content
 *
 * This is a pure function; the renderer composes the view object and passes
 * sections down to the section components.
 */
import type { Notebook, NotebookCell } from '../../lib/notebook-author/cells.ts';
// Phase 2a2: import the constants directly from prompt.ts (a pure-string
// module) rather than the package barrel, which re-exports from
// synthesize.ts → helpers/index.ts → node:fs and pulls server-only
// modules into client bundles.
import { SUMMARY_EXTENSION_KEY, SYNTHESIS_CELL_ROLE } from '../../lib/notebook-author/prompt.ts';
import type { CapturedToolCall } from '@/hooks/useNotebookStream';

const EXECUTION_EXTENSION_KEY = 'org.civicaitools.execution';

export interface ChatEvidenceEnvironment {
  python?: string;
  libraries?: Record<string, string>;
}

/** Phase 2a2 item 2: a single Jupyter notebook cell output (display_data,
 *  execute_result, stream, or error). Shape mirrors nbformat v4.5+ with
 *  unknown-field tolerance — we don't validate, just render best-effort. */
export interface NotebookOutput {
  output_type?: string;
  /** display_data / execute_result: mime-bundle data keyed by MIME type. */
  data?: Record<string, string | string[]>;
  /** stream: name ("stdout" | "stderr"). */
  name?: string;
  /** stream: text array or string. */
  text?: string | string[];
  /** error: ename + evalue + traceback. */
  ename?: string;
  evalue?: string;
  traceback?: string[];
  /** Arbitrary other fields tolerated. */
  [key: string]: unknown;
}

export interface ChatEvidenceView {
  prompt: string;
  model: string;
  portal: string;
  toolCalls: CapturedToolCall[];
  environment: ChatEvidenceEnvironment | null;
  executedAt: string | null;
  executionDurationMs: number | null;
  sandboxId: string | null;
  notebook: Notebook;
  /** Phase 2a2 item 2: outputs of the rendering code cell tagged with
   *  metadata.role === "synthesis". Section F renders these verbatim. Null
   *  when no such cell exists (e.g., legacy notebook with a markdown
   *  synthesis cell). */
  renderingCellOutputs: NotebookOutput[] | null;
  /** Phase 2a2 fallback: legacy `## Synthesis` markdown extracted when no
   *  rendering code cell is found. Section F renders via ReactMarkdown
   *  when this is set and renderingCellOutputs is null. */
  synthesisMarkdown: string;
  /** Phase 2a2 item 3: structured two-clause summary from notebook root
   *  metadata. Null when the LLM did not emit it (legacy / fallback). */
  structuredSummary: { analysisDescription: string; headlineFinding: string } | null;
  /** Legacy one-line summary derived from synthesis markdown — used when no
   *  structuredSummary is present. */
  derivedSummary: string;
  /** Phase 2a2 item 1: composed system prompt text streamed via the
   *  metadata event. Null until the SSE event arrives. */
  composedSystemPrompt: string | null;
  composedSystemPromptHash: string | null;
  /** Active platform signing key id, streamed via the metadata event. */
  signingKeyId: string | null;
}

function cellText(cell: NotebookCell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
}

/**
 * Phase 2a2 item 2: find the rendering code cell tagged with
 * `metadata.role === "synthesis"` and return its outputs array verbatim.
 * Returns null when no such cell is present, allowing the renderer to fall
 * back to legacy synthesis-markdown extraction.
 */
function extractRenderingCellOutputs(notebook: Notebook): NotebookOutput[] | null {
  for (const cell of notebook.cells) {
    if (cell.cell_type !== 'code') continue;
    const role = (cell.metadata as Record<string, unknown> | undefined)?.role;
    if (role !== SYNTHESIS_CELL_ROLE) continue;
    const outputs = (cell as { outputs?: unknown[] }).outputs;
    if (!Array.isArray(outputs)) return [];
    return outputs as NotebookOutput[];
  }
  return null;
}

/** Find the legacy `## Synthesis` markdown cell — kept for backward
 *  compatibility with pre-Phase-2a2 executed notebooks that haven't been
 *  re-run yet. Returns the body content (everything after the header
 *  line and the following blank line). */
function extractSynthesisMarkdown(notebook: Notebook): string {
  for (const cell of notebook.cells) {
    if (cell.cell_type !== 'markdown') continue;
    const text = cellText(cell);
    const match = text.match(/^##\s+Synthesis\b/m);
    if (!match) continue;
    const afterHeader = text.slice(match.index! + match[0].length).replace(/^\s*\n+/, '');
    return afterHeader.trim();
  }
  return '';
}

/** Phase 2a2 item 3: read the structured two-clause summary that the LLM
 *  stamps in notebook root metadata under `org.civicaitools.summary`. */
function readStructuredSummary(notebook: Notebook): {
  analysisDescription: string;
  headlineFinding: string;
} | null {
  const extensions = notebook.metadata?.extensions as Record<string, unknown> | undefined;
  const summary = extensions?.[SUMMARY_EXTENSION_KEY] as Record<string, unknown> | undefined;
  if (!summary) return null;
  const desc = summary.analysisDescription;
  const finding = summary.headlineFinding;
  if (typeof desc !== 'string' || typeof finding !== 'string') return null;
  return {
    analysisDescription: desc.trim(),
    headlineFinding: finding.trim(),
  };
}

/** Derive a one-line summary blurb from the synthesis markdown. Prefers the
 *  first sentence that ends with a period (capped at 240 chars); falls back
 *  to the first non-empty paragraph. Strips trailing markdown emphasis. */
function deriveSummary(synthesis: string): string {
  if (!synthesis) return '';
  const stripped = synthesis
    .replace(/```[\s\S]*?```/g, '') // drop fenced code
    .replace(/^\s*[-*]\s+/gm, '')  // drop bullet markers
    .trim();
  const firstPara = stripped.split(/\n\s*\n/)[0]?.trim() ?? '';
  if (!firstPara) return '';
  const sentenceMatch = firstPara.match(/^([^.!?\n]+[.!?])/);
  const candidate = sentenceMatch ? sentenceMatch[1] : firstPara;
  if (candidate.length <= 240) return candidate.trim();
  return candidate.slice(0, 237).trim() + '…';
}

function extractExecutionExtension(notebook: Notebook): {
  environment: ChatEvidenceEnvironment | null;
  executedAt: string | null;
  executionDurationMs: number | null;
  sandboxId: string | null;
} {
  const extensions = notebook.metadata?.extensions as Record<string, unknown> | undefined;
  const ext = extensions?.[EXECUTION_EXTENSION_KEY] as Record<string, unknown> | undefined;
  if (!ext) {
    return { environment: null, executedAt: null, executionDurationMs: null, sandboxId: null };
  }
  const env = ext.environment as ChatEvidenceEnvironment | undefined;
  return {
    environment: env ?? null,
    executedAt: typeof ext.executedAt === 'string' ? ext.executedAt : null,
    executionDurationMs: typeof ext.executionDuration_ms === 'number' ? ext.executionDuration_ms : null,
    sandboxId: typeof ext.sandboxId === 'string' ? ext.sandboxId : null,
  };
}

export interface BuildChatEvidenceViewInput {
  notebook: Notebook;
  prompt: string;
  model: string;
  portal: string;
  toolCalls: CapturedToolCall[];
  /** Phase 2a2 item 1: composed system-prompt text from the SSE metadata event. */
  composedSystemPrompt?: string | null;
  composedSystemPromptHash?: string | null;
  /** Active platform signing key id from the SSE metadata event. */
  signingKeyId?: string | null;
}

export function buildChatEvidenceView(input: BuildChatEvidenceViewInput): ChatEvidenceView {
  const renderingCellOutputs = extractRenderingCellOutputs(input.notebook);
  const synthesisMarkdown = renderingCellOutputs === null
    ? extractSynthesisMarkdown(input.notebook)
    : '';
  const structuredSummary = readStructuredSummary(input.notebook);
  const derivedSummary = deriveSummary(synthesisMarkdown);
  const exec = extractExecutionExtension(input.notebook);
  return {
    prompt: input.prompt,
    model: input.model,
    portal: input.portal,
    toolCalls: input.toolCalls,
    environment: exec.environment,
    executedAt: exec.executedAt,
    executionDurationMs: exec.executionDurationMs,
    sandboxId: exec.sandboxId,
    notebook: input.notebook,
    renderingCellOutputs,
    synthesisMarkdown,
    structuredSummary,
    derivedSummary,
    composedSystemPrompt: input.composedSystemPrompt ?? null,
    composedSystemPromptHash: input.composedSystemPromptHash ?? null,
    signingKeyId: input.signingKeyId ?? null,
  };
}
