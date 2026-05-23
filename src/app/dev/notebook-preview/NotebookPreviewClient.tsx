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
        phaseStartedAt: Date.now() - 18_000,
        startedAt: baseStarted,
        completedAt: null,
        notebook: null,
        validation: null,
        sandboxId: null,
        executionDurationMs: null,
        isLoading: true,
        error: null,
      };
    case 'error':
      return {
        phase: 'C',
        detail: null,
        phaseStartedAt: Date.now() - 32_000,
        startedAt: baseStarted,
        completedAt: Date.now(),
        notebook: null,
        validation: null,
        sandboxId: null,
        executionDurationMs: null,
        isLoading: false,
        error: 'Notebook execution failed (exit 1): NameError on cell 5 — df1 referenced before assignment',
      };
    default:
      return {
        phase: 'complete',
        detail: null,
        phaseStartedAt: null,
        startedAt: baseStarted,
        completedAt: Date.now(),
        notebook,
        validation,
        sandboxId: 'vrcl-sbx-fixture',
        executionDurationMs: 12340,
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
      <NotebookOutput state={state} />
    </div>
  );
}
