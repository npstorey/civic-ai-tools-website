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
 *   - B · system prompt ← the composed base+overlay prompt is hashed at
 *                          execution time but its text isn't streamed to the
 *                          client today; chat output shows a stub
 *   - C · model + env   ← `extensions["org.civicaitools.execution"]` +
 *                          tool model selection
 *   - D · tool calls    ← accumulated via `phase_a_tool_call` SSE events
 *   - E · notebook      ← the executed notebook JSON itself
 *   - F · synthesis     ← the synthesis-cell markdown content (rendered prose)
 *   - G · summary       ← derived from synthesis (first paragraph / sentence)
 *
 * This is a pure function; the renderer composes the view object and passes
 * sections down to the section components.
 */
import type { Notebook, NotebookCell } from '@/lib/notebook-author';
import type { CapturedToolCall } from '@/hooks/useNotebookStream';

const EXECUTION_EXTENSION_KEY = 'org.civicaitools.execution';

export interface ChatEvidenceEnvironment {
  python?: string;
  libraries?: Record<string, string>;
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
  synthesisMarkdown: string;
  summary: string;
}

function cellText(cell: NotebookCell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
}

/** Find the synthesis cell — the markdown cell whose source begins with
 *  `## Synthesis`. Returns its body content (everything after the header
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
}

export function buildChatEvidenceView(input: BuildChatEvidenceViewInput): ChatEvidenceView {
  const synthesisMarkdown = extractSynthesisMarkdown(input.notebook);
  const summary = deriveSummary(synthesisMarkdown);
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
    synthesisMarkdown,
    summary,
  };
}
