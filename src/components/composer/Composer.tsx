'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { FlowsStatement } from '@/lib/flows/statement';
import { ChipRow } from '@/components/ui/Page';
import ConsentCard from '@/components/sources/ConsentCard';
import LocalOnlyOffer from '@/components/sources/LocalOnlyOffer';
import NoSourcesOnLine from '@/components/sources/NoSourcesOnLine';
import { DONT_ALLOW_LINE } from '@/lib/sources/copy';
import { CHIP_ROW_LABEL, DOCKED_PLACEHOLDER, FIRST_TIME_LINE } from './copy';

/**
 * The composer (UX-2 P3b-1): the question box, its arrow, the example row,
 * the lines under the box and the guard's three slots, one component on three
 * mounts (the home page and `/ask` through `QueryForm`, `/explore` through
 * `TraceControls`).
 *
 * IT HOLDS NO STATE. The question, whether it can be sent, the guard's state
 * and the lines' words are the mount's; the composer lays them out.
 *
 * THE BAR AND THE LINES (the re-cut, O1 = A; addendum 3, 3.3). The root
 * (`data-part="composer"`) holds two blocks: the bar (`data-part="composer-bar"`),
 * which holds the box and its arrow, and the lines block after it. Before the
 * dock, in that block: the chips, the where-line, the guard's slot, the account
 * line, then whatever the mount renders beneath (`children`: the models-error
 * status). Docked, the guard's slot moves into the bar, above the box (O7 = A),
 * the chips go (O5 = A), and the first-time line follows the where-line.
 *
 * THE HARNESS MENU (UX-2 P3b-2; O8 = A; fixes 3 and 4). The mount's menu
 * (`harness`) renders in the box's field, after the arrow: one element, which
 * CSS places in the box before the arrow at 640 px and up and on its own line
 * under the box below, inside the bar, so docked it is stuck with the box. The
 * box's right padding is a class, so a media query can change it
 * (`composer-box`, `composer-box--harness`, globals.css).
 *
 * DOCKED (R1 B; the seat's rulings on leg A's stop). The mount decides when:
 * the first time a run on that surface finishes with an answer
 * (`QuerySurface`). Docked, the root carries `composer--docked`, whose rule is
 * `display: contents` (`globals.css`), so the bar is a layout child of the
 * surface and can stick at the viewport's bottom while only it is laid over
 * the answer; the lines stay in the page's flow below it. A sticky element
 * cannot leave its containing block (S14), which is why the root gives up its
 * box rather than the bar sticking inside it. The placeholder reads X23. No page
 * padding is added (S2).
 *
 * IT OWNS THE MOUNT'S ONLY `<form>`: the box and the arrow. Nothing else in the
 * composer can submit the question (the chips are `type="button"`, "Select
 * sources" is a link, the slots carry their own buttons).
 *
 * THE BOX STAYS WHERE THE READER TYPED (1D; O7 = A; the seat, #729 6796320602).
 * Docked, a slot opens above the box, inside the bar. Stuck, the bar grows
 * upward and the box does not move. At the answer's end the bar is in the
 * page's flow, so the slot would push the box down by its height; there the
 * page is scrolled by the change in the slot's space in the same frame,
 * before paint, so the answer moves up and the box stays put. The same holds
 * when a slot gives way to another (the card to the decline line) or closes.
 * Focus is not touched.
 *
 * THE FIRST-TIME LINE (X24) is one plain paragraph (the owner, 6753017330):
 * signed in both sentences, signed out the first only (O4 = A).
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
  /** Below the results, the bar sticky at the viewport's bottom; the placeholder reads X23. */
  docked?: boolean;
  /** The undocked placeholder. */
  placeholder: string;
  /** The example row, shown before the dock only; none on `/explore`. */
  chips?: ComposerChip[];
  /** The where-line under the box, computed by the mount (`data-part="where-this-question-goes"`). */
  line?: ReactNode;
  /** X24's form, or none. */
  firstTimeLine?: 'signed-in' | 'signed-out' | null;
  /** The account line, computed by the mount (`data-part="account-line"`): the count, and the sign-in line. */
  accountLine?: ReactNode;
  guard: ComposerGuard;
  /** The mount's harness menu (`HarnessMenu`), in the box after the arrow (UX-2 P3b-2). */
  harness?: ReactNode;
  /** What the mount renders beneath the lines (the models-error status). */
  children?: ReactNode;
}

// Full class names, never built from a template.
const ROOT_CLASS: Record<'form' | 'wide', { idle: string; docked: string }> = {
  form: { idle: 'composer composer--form', docked: 'composer composer--form composer--docked' },
  wide: { idle: 'composer composer--wide', docked: 'composer composer--wide composer--docked' },
};

// The box's class, with and without the harness menu in it: full names, never built from a template.
const BOX_CLASS = { plain: 'composer-box', harness: 'composer-box composer-box--harness' } as const;

const CHIP_STYLE_LOADING: React.CSSProperties = { cursor: 'not-allowed' };
const SLOT_TEXT: React.CSSProperties = { margin: 0, fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary)' };

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
  accountLine,
  guard,
  harness,
  children,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<HTMLDivElement>(null);
  /** The box's top in the window and the slot's space above it, as last laid out or scrolled. */
  const held = useRef<{ top: number | null; slotSpace: number }>({ top: null, slotSpace: 0 });

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, []);

  useEffect(() => { autoResize(); }, [value, autoResize]);

  // The box's top, kept current as the reader scrolls, so a slot that opens later is measured against it.
  useEffect(() => {
    const onScroll = () => {
      const el = fieldRef.current;
      if (el) held.current = { ...held.current, top: el.getBoundingClientRect().top };
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Docked, when the slot's space changes and that moved the box (the bar in the page's flow), the page is scrolled
  // by the box's own displacement before paint, measured again until the box is back where it was: a bar pushed
  // into its sticky place moves less than the slot's height at first, and at the page's maximum scroll the browser
  // already takes back part of a shrinking slot. A stuck bar grows upward instead; the box does not move, and
  // nothing scrolls.
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const slotsEl = docked ? slotsRef.current : null;
    const slotSpace = slotsEl ? slotsEl.getBoundingClientRect().height + (parseFloat(getComputedStyle(slotsEl).marginBottom) || 0) : 0;
    const prev = held.current;
    if (docked && prev.top !== null && Math.abs(slotSpace - prev.slotSpace) > 0.5) {
      for (let i = 0; i < 8; i += 1) {
        const off = el.getBoundingClientRect().top - prev.top;
        if (Math.abs(off) <= 0.5) break;
        const y = window.scrollY;
        window.scrollBy({ top: off, behavior: 'instant' });
        if (window.scrollY === y) break;
      }
    }
    held.current = { top: el.getBoundingClientRect().top, slotSpace };
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit();
  };

  const slots = guard.cardOpen || guard.declined || guard.noneOn ? (
    <div className="composer-slots" ref={slotsRef}>
      {guard.cardOpen ? (
        <div data-part="consent-card">
          <ConsentCard onAllow={guard.onAllow} onNotNow={guard.onNotNow} />
        </div>
      ) : null}
      {guard.declined && !guard.cardOpen ? (
        <p data-part="dont-allow" role="status" style={SLOT_TEXT}>
          {DONT_ALLOW_LINE} <LocalOnlyOffer statement={guard.statement} />
        </p>
      ) : null}
      {guard.noneOn && !guard.cardOpen ? (
        <p data-part="no-source-on" role="status" style={SLOT_TEXT}>
          <NoSourcesOnLine />
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <div data-part="composer" className={ROOT_CLASS[placement][docked ? 'docked' : 'idle']}>
      <div data-part="composer-bar" className="composer-bar">
        <div className="composer-col">
          {docked ? slots : null}
          <form onSubmit={handleSubmit}>
            {/* Chat-style textarea with inline send button */}
            <div className="ui-field" ref={fieldRef} style={{ position: 'relative' }}>
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
                className={harness ? BOX_CLASS.harness : BOX_CLASS.plain}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  resize: 'none',
                  minHeight: '48px',
                  maxHeight: '120px',
                  overflow: 'hidden',
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
              {harness}
            </div>
          </form>
        </div>
      </div>

      <div className="composer-col composer-lines">
        {/* The example questions (P9's ChipRow, 1B), before the first send only (O5 = A; leg H, dock at send). */}
        {!docked && chips && chips.length > 0 ? (
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

        {firstTimeLine !== null ? (
          <p data-part="first-time-line" className="composer-line">
            {firstTimeLine === 'signed-in' ? FIRST_TIME_LINE.signedIn : FIRST_TIME_LINE.signedOut}
          </p>
        ) : null}

        {docked ? null : slots}

        {accountLine}

        {children}
      </div>
    </div>
  );
}
