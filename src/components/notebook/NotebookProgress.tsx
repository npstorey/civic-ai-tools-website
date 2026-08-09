'use client';

/**
 * Phase 2a Q4 — multi-stage progress indicator for /api/query-notebook.
 *
 * Maps SSE phase events (A → B → C → D → complete) emitted by the route to
 * a four-row status list. Each row shows:
 *   - a leading status glyph (pending / spinner / check),
 *   - the stage label, and
 *   - on the active row, an elapsed-time counter (mm:ss) so the user knows
 *     the UI is alive during the ~30-60s wait.
 *
 * The component also surfaces the last `phase_a_progress` / `phase_a_tool_call`
 * message beneath the active row so users see the Phase A loop iterating
 * (the slowest stage by far) instead of staring at "Discovering datasets…"
 * for a full minute.
 */
import { useEffect, useState } from 'react';

export type NotebookPhase = 'A' | 'B' | 'C' | 'D' | 'complete';

const PHASE_ORDER: NotebookPhase[] = ['A', 'B', 'C', 'D'];

const PHASE_LABELS: Record<NotebookPhase, string> = {
  A: 'Discovering datasets',
  B: 'Synthesizing notebook',
  C: 'Executing in sandbox',
  D: 'Finalizing',
  complete: 'Done',
};

interface NotebookProgressProps {
  /** The most recent phase the server has reported. `null` before any event. */
  phase: NotebookPhase | null;
  /** Timestamps (ms since epoch). The component owns its own 1Hz clock and
   *  recomputes elapsed values internally so callers stay pure. */
  startedAt: number | null;
  phaseStartedAt: number | null;
  completedAt: number | null;
  /** Optional latest detail message — e.g., Phase A iteration message. */
  detail?: string | null;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function statusFor(target: NotebookPhase, current: NotebookPhase | null): 'pending' | 'active' | 'done' {
  if (current === null) return 'pending';
  if (current === 'complete') return 'done';
  const ti = PHASE_ORDER.indexOf(target);
  const ci = PHASE_ORDER.indexOf(current);
  if (ci > ti) return 'done';
  if (ci === ti) return 'active';
  return 'pending';
}

function StatusGlyph({ status }: { status: 'pending' | 'active' | 'done' }) {
  if (status === 'done') {
    return (
      <span aria-hidden style={{
        width: '16px', height: '16px', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        borderRadius: '50%', background: 'var(--nyc-success, #00b703)', color: 'white',
        fontSize: '11px', fontWeight: 700,
      }}>✓</span>
    );
  }
  if (status === 'active') {
    return (
      <span
        aria-hidden
        style={{
          width: '16px', height: '16px', display: 'inline-block',
          border: '2px solid var(--nyc-blue)',
          borderTopColor: 'transparent', borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }}
      />
    );
  }
  return (
    <span aria-hidden style={{
      width: '16px', height: '16px', display: 'inline-block',
      borderRadius: '50%', border: '2px solid var(--border-color, #e5e5e5)',
    }} />
  );
}

/**
 * State-driven 1Hz clock. The lazy `useState` initializer captures the
 * mount time; the interval inside `useEffect` ticks while the request is
 * active. When the stream finishes, `frozenAt` short-circuits the return
 * value so we never call `Date.now()` at render time — keeps the render
 * pure per the `react-hooks/purity` lint.
 */
function useNow(active: boolean, frozenAt: number | null): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active || frozenAt !== null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, frozenAt]);
  return frozenAt ?? now;
}

export default function NotebookProgress({
  phase,
  startedAt,
  phaseStartedAt,
  completedAt,
  detail,
}: NotebookProgressProps) {
  const active = phase !== null && phase !== 'complete' && completedAt === null;
  const now = useNow(active, completedAt);
  const totalElapsedMs = startedAt ? now - startedAt : 0;
  const currentPhaseElapsedMs = phaseStartedAt ? now - phaseStartedAt : 0;
  const totalLabel = formatElapsed(totalElapsedMs);

  return (
    <div
      aria-live="polite"
      style={{
        maxWidth: '600px',
        margin: '0 auto',
        border: '1px solid var(--border-color, #e5e5e5)',
        borderRadius: '8px',
        padding: '20px 24px',
        background: 'var(--nyc-white, #ffffff)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
          Generating reproducible notebook
        </h3>
        <span
          style={{ fontSize: '13px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}
        >
          {totalLabel}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
        The four-phase pipeline discovers data, writes a Jupyter notebook,
        runs it in a sandbox, and stamps execution metadata. Typically takes
        30 to 90 seconds.
      </p>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {PHASE_ORDER.map((p) => {
          const status = statusFor(p, phase);
          const isActive = status === 'active';
          return (
            <li
              key={p}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                opacity: status === 'pending' ? 0.6 : 1,
              }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '10px', fontSize: '14px',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isActive ? 500 : 400,
              }}>
                <StatusGlyph status={status} />
                <span>{PHASE_LABELS[p]}</span>
                {isActive && (
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {formatElapsed(currentPhaseElapsedMs)}
                  </span>
                )}
              </span>
              {isActive && detail && (
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    paddingLeft: '26px',
                    fontStyle: 'italic',
                    wordBreak: 'break-word',
                  }}
                >
                  {detail}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
