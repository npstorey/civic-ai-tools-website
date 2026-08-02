'use client';

/**
 * Client-side picker for the dev preview surface. Receives the
 * fixture-rendered executed notebook from the server page; switches between
 * progress / error / completed states based on the `?state=` query param.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import NotebookOutput from '@/components/notebook/NotebookOutput';
import type { NotebookStreamState } from '@/hooks/useNotebookStream';
import type { Notebook } from '@/lib/notebook-author';

interface NotebookPreviewClientProps {
  notebook: Notebook;
  validation: { ok: boolean; issues: { path: string; message: string }[] };
}

const PHASE_DETAILS: Record<string, string | null> = {
  A: 'Tool 3 of 6 — get_data (catalog search for "311 Brooklyn")',
  B: null,
  C: 'Sandbox warm-started from snapshot; executing cells…',
  D: 'Stamping execution metadata + appending comparison cell…',
};

const FIXTURE_TOOL_CALLS = [
  {
    name: 'get_data',
    operationType: 'catalog',
    reason: 'search for "311 Brooklyn complaints"',
    resultSummary: { rows: 12, columns: 5 },
  },
  {
    name: 'get_data',
    operationType: 'metadata',
    reason: 'inspect erm2-nwe9 schema',
    resultSummary: { rows: 41, columns: 3 },
  },
  {
    name: 'get_data',
    operationType: 'query',
    reason: 'aggregate by complaint_type for the past 30 days',
    resultSummary: { rows: 5, columns: 2 },
  },
];

function buildState(
  stateParam: string | null,
  notebook: Notebook,
  validation: NotebookPreviewClientProps['validation'],
): NotebookStreamState {
  const baseStarted = Date.now() - 47_000;

  switch (stateParam) {
    case 'A':
    case 'B':
    case 'C':
    case 'D':
      return {
        phase: stateParam,
        detail: PHASE_DETAILS[stateParam] ?? null,
        toolCalls: FIXTURE_TOOL_CALLS.slice(0, stateParam === 'A' ? 2 : 3),
        phaseStartedAt: Date.now() - 18_000,
        startedAt: baseStarted,
        completedAt: null,
        notebook: null,
        validation: null,
        sandboxId: null,
        executionDurationMs: null,
        composedSystemPrompt: null,
        composedSystemPromptHash: null,
        signingKeyId: null,
        answerContent: null,
        evidenceTrace: null,
        tokenUsage: null,
        pipelineDurationMs: null,
        isLoading: true,
        error: null,
      };
    case 'error':
      return {
        phase: 'C',
        detail: null,
        toolCalls: FIXTURE_TOOL_CALLS,
        phaseStartedAt: Date.now() - 32_000,
        startedAt: baseStarted,
        completedAt: Date.now(),
        notebook: null,
        validation: null,
        sandboxId: null,
        executionDurationMs: null,
        composedSystemPrompt: null,
        composedSystemPromptHash: null,
        signingKeyId: null,
        answerContent: null,
        evidenceTrace: null,
        tokenUsage: null,
        pipelineDurationMs: null,
        isLoading: false,
        error: 'Notebook execution failed (exit 1): NameError on cell 5 — df1 referenced before assignment',
      };
    default:
      return {
        phase: 'complete',
        detail: null,
        toolCalls: FIXTURE_TOOL_CALLS,
        phaseStartedAt: null,
        startedAt: baseStarted,
        completedAt: Date.now(),
        notebook,
        validation,
        sandboxId: 'vrcl-sbx-fixture',
        executionDurationMs: 12340,
        composedSystemPrompt: 'You are a helpful assistant…\n\n(Fixture-only composed prompt for the dev preview surface; the live route emits the real composed system prompt over SSE.)',
        composedSystemPromptHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678901234567890abcdef012345',
        signingKeyId: 'platform:evidence-2026-04',
        answerContent: null,
        evidenceTrace: null,
        tokenUsage: null,
        pipelineDurationMs: null,
        isLoading: false,
        error: null,
      };
  }
}

export default function NotebookPreviewClient({ notebook, validation }: NotebookPreviewClientProps) {
  const search = useSearchParams();
  const state = useMemo(
    () => buildState(search.get('state'), notebook, validation),
    [search, notebook, validation],
  );

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' }}>
      <div
        style={{
          marginBottom: '24px',
          padding: '12px 16px',
          background: 'rgba(255, 200, 0, 0.12)',
          border: '1px solid rgba(255, 165, 0, 0.5)',
          borderRadius: '4px',
          fontSize: '13px',
          color: 'var(--text-secondary)',
        }}
      >
        <strong>Dev preview — Phase 2a notebook UI</strong>
        <br />
        Add <code>?state=A|B|C|D|error</code> to preview other states. No
        live <code>/api/query-notebook</code> traffic; fixture only.
      </div>
      <NotebookOutput
        state={state}
        prompt="Show me top 5 311 complaint types in Brooklyn over the past 30 days"
        model="anthropic/claude-sonnet-4-6"
        portal="data.cityofnewyork.us"
      />
    </div>
  );
}
