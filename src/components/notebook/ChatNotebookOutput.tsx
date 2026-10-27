'use client';

/**
 * The executed run's answer (`/ask`, notebook mode): the run's adapter plus
 * the shared view (LAYOUT-WEB W3 P1). This file reads what only a client can
 * read — the instance's declared identity and the server-resolved Socrata MCP
 * endpoint, both from context — hands them with the run's state to
 * `adaptNotebook`, and renders `AnswerView` from the model it returns. It
 * holds no layout of its own: the parts, their order, the disclosure and its
 * sections are the view's (`src/components/answer-view/AnswerView.tsx`), and
 * the words each part carries are the adapter's
 * (`src/components/answer-view/adapt-notebook.ts`). A render test pins the
 * layout (`chat-notebook-output-layout.test.ts`,
 * `answer-view/answer-view-layout.test.ts`), and a source read pins that this
 * file renders through the view.
 *
 * The status row states the notebook's own reading of whether it ran (C1), as
 * the record page does; the sections A-G and the signers are the envelope's,
 * inside the disclosure; the Publish control stays in the wrapper
 * (`NotebookOutput`), which hands it in as `actions`.
 */
import type { ReactNode } from 'react';
import AnswerView from '@/components/answer-view/AnswerView';
import { adaptNotebook } from '@/components/answer-view/adapt-notebook';
import { useSocrataMcpUrl } from '@/components/McpRoutingProvider';
import { useInstanceAttribution } from '@/components/EvidenceOriginProvider';
import type { Notebook } from '@/lib/notebook-author';
import type { CapturedToolCall } from '@/hooks/useNotebookStream';
import type { ProgressGroup, ReportedPhase } from '@/lib/answer-view/steps';
import type { WhereItWentModel } from '@/lib/flows/where-it-went';

interface ChatNotebookOutputProps {
  notebook: Notebook;
  prompt: string;
  model: string;
  portal: string;
  toolCalls: CapturedToolCall[];
  /**
   * Phase A's steps as the hook grouped them, one per iteration (LAYOUT-WEB
   * W2 P2). Absent when the state recorded none: the step view is not shown.
   */
  stepGroups?: ProgressGroup[];
  /** The phase events the run reported (the hook's `phaseLog`): B, C and D close the step view. */
  closingPhases?: ReportedPhase[];
  /** Phase 2a2 item 1: composed system prompt text streamed via SSE. */
  composedSystemPrompt?: string | null;
  composedSystemPromptHash?: string | null;
  /** Phase 2a2 item 4: active platform signing key id streamed via SSE. */
  signingKeyId?: string | null;
  /** Optional title over the answer. */
  title?: string;
  /** R6 W4: where the question went; the spread below carries it to the adapter. */
  flows?: WhereItWentModel;
  /** The wrapper's controls (the Publish button), placed by the view after the disclosure. */
  actions?: ReactNode;
}

export default function ChatNotebookOutput({ actions, ...run }: ChatNotebookOutputProps) {
  // The instance's identity names the authors of the site's parts; with none
  // declared, those lines are omitted. #258 C5: the server-resolved
  // SOCRATA_MCP_URL — null (not configured) leaves the "MCP servers" item out.
  const instance = useInstanceAttribution().host;
  const socrataMcpUrl = useSocrataMcpUrl();
  return <AnswerView model={adaptNotebook({ ...run, instance, socrataMcpUrl })} actions={actions} />;
}
