'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { FlowsStatement } from '@/lib/flows/statement';
import { ChipRow } from '@/components/ui/Page';
import ConsentCard from '@/components/sources/ConsentCard';
import LocalOnlyOffer from '@/components/sources/LocalOnlyOffer';
import NoSourcesOnLine from '@/components/sources/NoSourcesOnLine';
import { DONT_ALLOW_LINE } from '@/lib/sources/copy';
import { CHIP_ROW_LABEL, DOCKED_PLACEHOLDER, FIRST_TIME_LINE_PARTS } from './copy';

/**
 * The composer (UX-2 P3b-1): the question box, its arrow, the example row,
 * the line under the box and the guard's three slots, one component on three
 * mounts (the home page and `/ask` through `QueryForm`, `/explore` through
 * `TraceControls`).
 *
 * IT HOLDS NO STATE. The question, whether it can be sent, the guard's state
 * and the line's words are the mount's; the composer lays them out, in one
 * order on every mount: the box and its arrow, the chips, the line, the
 * first-time line, the consent card, the decline line, the no-source-on line,
 * then whatever the mount renders beneath (`children`: the gear and its region
 * on the home page and `/ask`, in P3b-1).
 *
 * IT OWNS THE MOUNT'S ONLY `<form>`: the box, the arrow, the chips and the two
 * lines. The slots and `children` render outside it, so no control there can
 * submit the question.
 *
 * DOCKED (R1 B; the seat's rulings on leg A's stop). The mount decides when:
 * the first time a run on that surface finishes with an answer
 * (`QuerySurface`). Docked, the root carries `composer--docked`
 * (`globals.css`: sticky at the viewport's bottom, under the header's drawer
 * and every dialog), the placeholder reads X23, and the first-time line (X24)
 * can show under the box. The dock adds no page padding (S2): the box is in
 * the page's flow after the results, so scrolled to the end of the answer it
 * sits below the answer's last line.
 *
 * THE FIRST-TIME LINE is a P1 `inline` disclosure, closed, its first sentence
 * the summary (relay 57; design version 4). It is written here with P1's
 * classes rather than through `Disclosure`, which takes no `data-part`.
 */

/** One example question: a chip fills the box; it does not submit. */
export interface ComposerChip {
  id: string;
  label: string;
  onSelect: () => void;
}

/** The guard's state, held by the mount (`QueryForm`, `TraceControls`); the composer renders its three slots. */
export interface ComposerGuard {
  /** The consent card is shown. */
  cardOpen: boolean;
  onAllow: () => void;
  onNotNow: () => void;
  /** The box holds the question the reader declined: the decline line is shown. */
  declined: boolean;
  /** The statement the decline line's local-only offer reads. */
  statement: FlowsStatement | null;
  /** The last submit found no source On: the no-source-on line is shown. */
  noneOn: boolean;
}

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Called on a submit the composer allows (`canSubmit`): the arrow, Enter, or the form's submit. */
  onSubmit: () => void;
  canSubmit: boolean;
  isLoading: boolean;
  /** `form`: the home page's and `/ask`'s column. `wide`: `/explore`'s live panel. Default `form`. */
  placement?: 'form' | 'wide';
  /** Below the results, sticky at the viewport's bottom; the placeholder reads X23. */
  docked?: boolean;
  /** The undocked placeholder. */
  placeholder: string;
  /** The example row; none on `/explore`. */
  chips?: ComposerChip[];
  /** The line under the box (today's "where this question goes"), computed by the mount. */
  line?: ReactNode;
  /** X24's form, or none. */
  firstTimeLine?: 'signed-in' | 'signed-out' | null;
  guard: ComposerGuard;
  /** What the mount renders beneath the composer's own parts (the gear row and its region, in P3b-1). */
  children?: ReactNode;
}

// Full class names, never built from a template.
const ROOT_CLASS: Record<'form' | 'wide', { idle: string; docked: string }> = {
  form: { idle: 'composer composer--form', docked: 'composer composer--form composer--docked' },
  wide: { idle: 'composer composer--wide', docked: 'composer composer--wide composer--docked' },
};

const CHIP_STYLE_LOADING: React.CSSProperties = { cursor: 'not-allowed' };

export default function Composer({
  value,
  onChange,
  onSubmit,
  canSubmit,
  isLoading,
  placement = 'form',
  docked = false,
  placeholder,
  chips,
  line,
  firstTimeLine = null,
  guard,
  children,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, []);

  useEffect(() => { autoResize(); }, [value, autoResize]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit();
  };

  const firstTime = firstTimeLine === null ? null : FIRST_TIME_LINE_PARTS[firstTimeLine === 'signed-in' ? 'signedIn' : 'signedOut'];

  return (
    <div data-part="composer" className={ROOT_CLASS[placement][docked ? 'docked' : 'idle']}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Chat-style textarea with inline send button */}
        <div className="ui-field" style={{ position: 'relative' }}>
          <textarea
            id="query"
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onInput={autoResize}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSubmit) onSubmit();
              }
            }}
            placeholder={docked ? DOCKED_PLACEHOLDER : placeholder}
            rows={1}
            disabled={isLoading}
            aria-label="Ask a question about open data"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              resize: 'none',
              minHeight: '48px',
              maxHeight: '120px',
              overflow: 'hidden',
              paddingRight: '48px',
              borderRadius: '8px',
            }}
          />
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              position: 'absolute',
              right: '8px',
              bottom: '8px',
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              border: 'none',
              // Keyed on the condition that disables the button (UX pass row 3),
              // so a disabled arrow, as after Not now, never looks live.
              backgroundColor: canSubmit ? 'var(--accent)' : 'var(--border-color)',
              color: 'white',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s ease',
            }}
            aria-label="Submit query"
          >
            {isLoading ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="8" cy="8" r="6" stroke="white" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>

        {/* The example questions (P9's ChipRow, 1B): one row that scrolls sideways, no separator. */}
        {chips && chips.length > 0 ? (
          <div data-part="chip-row">
            <ChipRow label={CHIP_ROW_LABEL}>
              {chips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={chip.onSelect}
                  disabled={isLoading}
                  style={isLoading ? CHIP_STYLE_LOADING : undefined}
                >
                  {chip.label}
                </button>
              ))}
            </ChipRow>
          </div>
        ) : null}

        {line}

        {firstTime !== null ? (
          <details className="ui-disclosure ui-disclosure--inline" data-part="first-time-line">
            <summary className="ui-disclosure-summary">{firstTime.summary}</summary>
            <div className="ui-disclosure-body">{firstTime.body}</div>
          </details>
        ) : null}
      </form>

      {guard.cardOpen || guard.declined || guard.noneOn ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
          {guard.cardOpen ? (
            <div data-part="consent-card">
              <ConsentCard onAllow={guard.onAllow} onNotNow={guard.onNotNow} />
            </div>
          ) : null}
          {guard.declined && !guard.cardOpen ? (
            <p data-part="dont-allow" role="status" style={{ margin: 0, fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              {DONT_ALLOW_LINE} <LocalOnlyOffer statement={guard.statement} />
            </p>
          ) : null}
          {guard.noneOn && !guard.cardOpen ? (
            <p data-part="no-source-on" role="status" style={{ margin: 0, fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              <NoSourcesOnLine />
            </p>
          ) : null}
        </div>
      ) : null}

      {children ? <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>{children}</div> : null}
    </div>
  );
}
