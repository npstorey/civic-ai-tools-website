'use client';

import { useState } from 'react';
import type { PreRecordedTrace } from '@/lib/bpmn/traces';
import type { PlaybackSpeed, ReplayState } from '@/lib/bpmn/animation';
import type { LiveTraceStatus } from '@/hooks/useLiveTrace';

export type DiagramMode = 'examples' | 'live';

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
  // Mode
  mode: DiagramMode;
  onModeChange: (mode: DiagramMode) => void;
  // Live mode props
  liveStatus: LiveTraceStatus;
  liveError: string | null;
  liveElapsedMs: number;
  liveSlowMessage: string | null;
  onLiveStart: (query: string) => void;
  onLiveCancel: () => void;
  onLiveReplay: () => void;
  onLiveReset: () => void;
  isReplayingCapture: boolean;
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
  mode,
  onModeChange,
  liveStatus,
  liveError,
  liveElapsedMs,
  liveSlowMessage,
  onLiveStart,
  onLiveCancel,
  onLiveReplay,
  onLiveReset,
  isReplayingCapture,
}: TraceControlsProps) {
  const [liveQuery, setLiveQuery] = useState('');
  const selectedTrace = traces.find(t => t.id === selectedTraceId);
  const totalEvents = selectedTrace?.events.length ?? 0;
  const currentStep = replayState.currentEventIndex + 1;

  const handleLiveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (liveQuery.trim()) {
      onLiveStart(liveQuery.trim());
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid var(--border-color)' }}>
        <button
          onClick={() => onModeChange('examples')}
          style={{
            padding: '8px 20px',
            fontSize: '13px',
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            border: 'none',
            borderBottom: mode === 'examples' ? '2px solid var(--nyc-blue-40)' : '2px solid transparent',
            marginBottom: '-2px',
            background: 'none',
            color: mode === 'examples' ? 'var(--nyc-blue-40)' : 'var(--text-muted)',
            transition: 'all 0.15s ease',
          }}
        >
          Example traces
        </button>
        <button
          onClick={() => onModeChange('live')}
          style={{
            padding: '8px 20px',
            fontSize: '13px',
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            border: 'none',
            borderBottom: mode === 'live' ? '2px solid var(--nyc-blue-40)' : '2px solid transparent',
            marginBottom: '-2px',
            background: 'none',
            color: mode === 'live' ? 'var(--nyc-blue-40)' : 'var(--text-muted)',
            transition: 'all 0.15s ease',
          }}
        >
          Try your own
        </button>
      </div>

      {mode === 'examples' && (
        <>
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
            <button
              onClick={replayState.isPlaying ? onPause : onPlay}
              className="nyc-button nyc-button-secondary"
              style={{ padding: '6px 16px', fontSize: '13px', minWidth: '70px' }}
            >
              {replayState.isPlaying ? 'Pause' : replayState.isComplete ? 'Replay' : 'Play'}
            </button>

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
          <div style={{ height: '3px', background: 'var(--card-background)', borderRadius: '2px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${replayState.progress * 100}%`,
                background: replayState.isComplete ? 'var(--nyc-success)' : 'var(--nyc-blue-40)',
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
              <span>{selectedTrace?.title || 'Select a trace to begin'}</span>
            )}
          </div>
        </>
      )}

      {mode === 'live' && (
        <>
          {/* Live query input */}
          {(liveStatus === 'idle' || liveStatus === 'error') && !isReplayingCapture && (
            <form onSubmit={handleLiveSubmit} style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={liveQuery}
                onChange={e => setLiveQuery(e.target.value)}
                placeholder="e.g. Most common 311 complaints in Brooklyn"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: '14px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  fontFamily: 'inherit',
                  background: 'var(--background)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                type="submit"
                disabled={!liveQuery.trim()}
                className="nyc-button nyc-button-primary"
                style={{
                  padding: '8px 20px',
                  fontSize: '13px',
                  opacity: liveQuery.trim() ? 1 : 0.5,
                  cursor: liveQuery.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Run
              </button>
            </form>
          )}

          {liveStatus === 'idle' && !isReplayingCapture && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Uses one of your daily queries. Watch the diagram animate in real time.
            </div>
          )}

          {/* Running state */}
          {liveStatus === 'running' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: '14px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  background: 'var(--card-background)',
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {liveQuery}
                </div>
                <button
                  onClick={onLiveCancel}
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--background)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
              </div>

              {/* Elapsed + indeterminate progress */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {(liveElapsedMs / 1000).toFixed(0)}s elapsed
                </div>
                <div style={{
                  flex: 1,
                  height: '3px',
                  background: 'var(--card-background)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: '30%',
                    background: 'var(--nyc-blue-40)',
                    borderRadius: '2px',
                    animation: 'live-progress-slide 1.5s ease-in-out infinite',
                  }} />
                </div>
              </div>

              {liveSlowMessage && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  {liveSlowMessage}
                </div>
              )}
            </>
          )}

          {/* Complete state */}
          {liveStatus === 'complete' && !isReplayingCapture && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '13px', color: 'var(--nyc-success)', fontWeight: 500 }}>
                Complete in {(liveElapsedMs / 1000).toFixed(1)}s
              </span>
              <button
                onClick={onLiveReplay}
                className="nyc-button nyc-button-secondary"
                style={{ padding: '6px 16px', fontSize: '13px' }}
              >
                Replay
              </button>
              <button
                onClick={onLiveReset}
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
                New query
              </button>
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
          )}

          {/* Replaying captured trace */}
          {isReplayingCapture && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                onClick={replayState.isPlaying ? onPause : onLiveReplay}
                className="nyc-button nyc-button-secondary"
                style={{ padding: '6px 16px', fontSize: '13px', minWidth: '70px' }}
              >
                {replayState.isPlaying ? 'Pause' : replayState.isComplete ? 'Replay' : 'Play'}
              </button>

              <button
                onClick={onLiveReset}
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
                New query
              </button>

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
          )}

          {/* Progress bar for replay */}
          {isReplayingCapture && (
            <>
              <div style={{ height: '3px', background: 'var(--card-background)', borderRadius: '2px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${replayState.progress * 100}%`,
                    background: replayState.isComplete ? 'var(--nyc-success)' : 'var(--nyc-blue-40)',
                    borderRadius: '2px',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                {replayState.isComplete ? 'Replay complete' : replayState.isPlaying ? 'Replaying captured trace...' : 'Paused'}
              </div>
            </>
          )}

          {/* Error display */}
          {liveStatus === 'error' && liveError && (
            <div style={{
              padding: '10px 14px',
              background: 'rgba(220, 53, 69, 0.06)',
              border: '1px solid rgba(220, 53, 69, 0.2)',
              borderRadius: '4px',
              fontSize: '13px',
              color: '#dc3545',
            }}>
              {liveError}
            </div>
          )}
        </>
      )}
    </div>
  );
}
