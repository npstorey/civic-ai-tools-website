'use client';

import type { PreRecordedTrace } from '@/lib/bpmn/traces';
import type { PlaybackSpeed, ReplayState } from '@/hooks/useTraceReplay';

interface TraceControlsProps {
  traces: PreRecordedTrace[];
  selectedTraceId: string;
  onSelectTrace: (id: string) => void;
  replayState: ReplayState;
  speed: PlaybackSpeed;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onSetSpeed: (speed: PlaybackSpeed) => void;
}

const speeds: PlaybackSpeed[] = [1, 2, 4];

export default function TraceControls({
  traces,
  selectedTraceId,
  onSelectTrace,
  replayState,
  speed,
  onPlay,
  onPause,
  onReset,
  onSetSpeed,
}: TraceControlsProps) {
  const selectedTrace = traces.find(t => t.id === selectedTraceId);
  const totalEvents = selectedTrace?.events.length ?? 0;
  const currentStep = replayState.currentEventIndex + 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Trace selector pills */}
      <div className="trace-pills" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {traces.map(trace => (
          <button
            className="trace-pill"
            key={trace.id}
            onClick={() => onSelectTrace(trace.id)}
            style={{
              padding: '6px 14px',
              borderRadius: '16px',
              border: trace.id === selectedTraceId
                ? '1px solid var(--nyc-blue-40)'
                : '1px solid var(--border-color)',
              background: trace.id === selectedTraceId
                ? 'var(--nyc-blue-40)'
                : 'var(--background)',
              color: trace.id === selectedTraceId
                ? 'white'
                : 'var(--text-secondary)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontFamily: 'inherit',
            }}
          >
            {trace.chipLabel}
          </button>
        ))}
      </div>

      {/* Playback bar */}
      <div className="playback-bar" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Play/Pause button */}
        <button
          onClick={replayState.isPlaying ? onPause : onPlay}
          className="nyc-button nyc-button-secondary"
          style={{
            padding: '6px 16px',
            fontSize: '13px',
            minWidth: '70px',
          }}
        >
          {replayState.isPlaying ? 'Pause' : replayState.isComplete ? 'Replay' : 'Play'}
        </button>

        {/* Reset button */}
        {(replayState.isPlaying || replayState.isPaused || replayState.isComplete) && (
          <button
            onClick={onReset}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: '1px solid var(--border-color)',
              background: 'var(--background)',
              color: 'var(--text-muted)',
              fontSize: '13px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Reset
          </button>
        )}

        {/* Speed toggle */}
        <div className="speed-selector" style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
          {speeds.map(s => (
            <button
              key={s}
              onClick={() => onSetSpeed(s)}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                border: s === speed
                  ? '1px solid var(--nyc-blue-40)'
                  : '1px solid var(--border-color)',
                background: s === speed
                  ? 'rgba(16, 63, 239, 0.1)'
                  : 'var(--background)',
                color: s === speed
                  ? 'var(--nyc-blue-40)'
                  : 'var(--text-muted)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: '3px',
          background: 'var(--card-background)',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${replayState.progress * 100}%`,
            background: replayState.isComplete
              ? 'var(--nyc-success)'
              : 'var(--nyc-blue-40)',
            borderRadius: '2px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* Status line */}
      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
        {replayState.isComplete ? (
          <span>Complete &mdash; {selectedTrace?.responseSummary || 'Trace finished'}</span>
        ) : replayState.isPlaying || replayState.isPaused ? (
          <span>
            Step {currentStep} of {totalEvents}
            {replayState.currentIteration > 0 && (
              <> &middot; Iteration {replayState.currentIteration}</>
            )}
            {replayState.currentEvent && (
              <> &middot; {replayState.currentEvent.message}</>
            )}
          </span>
        ) : (
          <span>
            {selectedTrace?.title || 'Select a trace to begin'}
          </span>
        )}
      </div>
    </div>
  );
}
