'use client';

/**
 * The picker (S3-B W1, npstorey/civic-ai-tools#318; the owner's W0 rulings D1 = B, D2 = A, D9 = A; the ORCH's R1, R4,
 * R6): "Only the ones I pick", as a panel under the question box, and above it once the box is docked. Loaded on its
 * own (`./load-picker.ts`), so the first page's code does not carry it.
 *
 * THE PANEL (R6). A named region (`role="region"`, `aria-labelledby` on S12), never a bare `div`. Its header row holds
 * S12 and the site's × "Close" (`Dialog.tsx`'s, `ui-close`), outside the panel's own scroll, so the control stays in
 * view in the docked panel. Escape closes it too. On close, focus goes back to what opened it: the menu's trigger, or
 * "Change".
 *
 * THE LIST. Before any words (R1), the site's set-up sources in Settings' order, the flows statement's. With words,
 * the router's own search over its whole manifest (`./search.ts`), in the ranking's order: a set-up source as the
 * Settings row (`SourceRow`) with a pick control (S4); a source the site has not set up with its name, its "what"
 * line and S6a, no control and no pick (D2 = A). A query the search can match no word of reads as no words; S3 shows
 * only for a query with a searchable word and no hit. A pack the portal lock removes is never a hit (G0-6 = A).
 *
 * THE PICK (G0-3 = A, B10). A pick changes no setting. An Off row cannot be picked, and shows S5, until its own control
 * reads On or Ask first; a picked row set to Off loses its pick (the mount drops it, `QueryForm`).
 *
 * THE ROW'S CONTROL is Settings' own (`SourceStateRadios`, `SourceStateConfirmation`, through `SourceRow`), given the
 * same props Settings gives it, from the same `useSourceConsent` (the ORCH's A13; `SettingsOverlay.tsx` is another
 * lane's file this phase does not touch; a shared builder is a later change).
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import type { FlowsSource, FlowsStatement } from '@/lib/flows/statement';
import { SETTINGS_TEXT } from '@/lib/sources/copy';
import { readerSourceName, sourceRowLines } from '@/lib/sources/source-name';
import SourceRow from '@/components/sources/SourceRow';
import type { ConfirmedChange, SourceStateControlProps } from '@/components/sources/SourceStateControl';
import { panelStates, useSourceConsent, type SourceStateValue } from '@/components/sources/useSourceConsent';
import { useDefaultPortal, usePortalLocked } from '@/components/DefaultPortalProvider';
import { PICKER_TEXT } from '../copy';
import { hasSearchableWord, readerRanking, readerSearchConfiguration } from './search';
import { closePicker, setPickerQuery, togglePick, usePicks } from './store';

const MANIFEST = CIVIC_MANIFEST as unknown as ReadonlyArray<{ sourceId: string; displayName: string }>;

/** One row of the list: a source the statement lists, or a hit this site has not set up. */
type PickerRow =
  | { kind: 'set-up'; sourceId: string; source: FlowsSource; name: string }
  | { kind: 'not-set-up'; sourceId: string; name: string; what: string | null };

/** The rows for `query`: R1's list before any words, the ranking's hits after. */
export function pickerRows(query: string, statement: FlowsStatement | null, configured: ReturnType<typeof readerSearchConfiguration>): { rows: PickerRow[]; searched: boolean } {
  const sources = statement?.sources ?? [];
  const setUp = (source: FlowsSource): PickerRow => ({ kind: 'set-up', sourceId: source.sourceId, source, name: readerSourceName(source) });
  if (!hasSearchableWord(query)) return { rows: sources.map(setUp), searched: false };
  const rows = readerRanking(query, configured).flatMap((id): PickerRow[] => {
    const source = sources.find((s) => s.sourceId === id);
    if (source) return [setUp(source)];
    const entry = MANIFEST.find((e) => e.sourceId === id);
    if (!entry) return [];
    const { what } = sourceRowLines({ sourceId: id, publisher: 'not stated', variant: { variant: 'remote', kind: 'remote', runsAt: 'other' } as FlowsSource['variant'] });
    return [{ kind: 'not-set-up', sourceId: id, name: readerSourceName(entry), what }];
  });
  return { rows, searched: true };
}

const ROW = { padding: '8px 0', borderTop: '1px solid var(--border-color)' } as const;
const capitalized = (what: string | null) => (what === null ? null : what.charAt(0).toUpperCase() + what.slice(1));

/** S4: a row's pick control. Disabled on an Off row, with S5 under it as its description (fix round 1, item 1: the
 *  reason reaches a reader who hears the control, not only one who sees the line). */
export function PickControl({ sourceId, name, state, picked }: { sourceId: string; name: string; state: SourceStateValue; picked: boolean }) {
  const off = state === 'off';
  const reasonId = `pick-off-reason-${useId()}`;
  return (
    <div data-part="pick-control" style={{ marginTop: '6px' }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: off ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: 500, cursor: off ? 'not-allowed' : 'pointer' }}>
        <input
          type="checkbox"
          aria-label={PICKER_TEXT.pickName(name)}
          checked={!off && picked}
          disabled={off}
          aria-describedby={off ? reasonId : undefined}
          onChange={() => togglePick(sourceId)}
        />
        {PICKER_TEXT.pick}
      </label>
      {off ? <div id={reasonId} data-part="pick-off-reason">{PICKER_TEXT.offReason}</div> : null}
    </div>
  );
}

/** A hit this site has not set up: its name, its "what" line and S6a; no control, no pick. */
function NotSetUpRow({ row }: { row: Extract<PickerRow, { kind: 'not-set-up' }> }) {
  const what = capitalized(row.what);
  return (
    <li data-source={row.sourceId} data-row-kind="not-set-up" style={ROW}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row.name}</div>
      {what !== null && <div>{what}</div>}
      <div data-part="not-set-up" style={{ marginTop: '4px' }}>{PICKER_TEXT.notSetUp}</div>
    </li>
  );
}

export default function PickerPanel({ docked }: { docked: boolean }) {
  const consent = useSourceConsent({ load: false });
  const picks = usePicks();
  const locked = usePortalLocked();
  const defaultPortal = useDefaultPortal();
  const headingId = `pick-panel-heading-${useId()}`;
  const [confirmed, setConfirmed] = useState<ConfirmedChange>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus: into the search field on open; back to what opened the panel on close (R6; `Dialog.tsx`'s rule).
  useEffect(() => {
    const opener = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    searchRef.current?.focus();
    return () => {
      if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus();
    };
  }, []);

  const statement = consent.statement;
  const ids = statement?.sources.map((s) => s.sourceId) ?? [];
  const states = panelStates(consent, ids);
  const inForce = consent.status?.inForce === true;
  const { rows, searched } = pickerRows(picks.query, statement, readerSearchConfiguration(locked, defaultPortal));

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
    }
  };

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      data-part="pick-panel"
      onKeyDown={onKeyDown}
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        backgroundColor: 'var(--white)',
        boxShadow: 'var(--shadow-menu)',
        fontSize: '14px',
        lineHeight: 1.6,
        color: 'var(--text-primary)',
        ...(docked ? { maxHeight: '45vh' } : {}),
      }}
    >
      <div data-part="pick-panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 8px 4px 16px' }}>
        <h2 id={headingId} style={{ margin: 0, fontSize: '14px', fontWeight: 600, lineHeight: 1.4 }}>{PICKER_TEXT.heading}</h2>
        <button type="button" className="ui-close" aria-label="Close" onClick={closePicker}>
          <span aria-hidden="true">{'×'}</span>
        </button>
      </div>
      <div data-part="pick-panel-body" style={{ padding: '0 16px 12px', overflowY: docked ? 'auto' : 'visible', minHeight: 0 }}>
        <input
          ref={searchRef}
          type="search"
          aria-label={SETTINGS_TEXT.search}
          placeholder={SETTINGS_TEXT.search}
          value={picks.query}
          onChange={(event) => setPickerQuery(event.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: '14px', border: '1px solid var(--border-color)', borderRadius: '6px', margin: '0 0 6px' }}
        />
        {searched && rows.length === 0 ? <p data-part="pick-no-match" style={{ margin: '0 0 6px', color: 'var(--text-secondary)' }}>{SETTINGS_TEXT.noMatch}</p> : null}
        {rows.length > 0 ? (
          <ul data-part="pick-rows" style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
            {rows.map((row) => {
              if (row.kind === 'not-set-up') return <NotSetUpRow key={row.sourceId} row={row} />;
              const state = states[row.sourceId] ?? 'ask-first';
              const control: SourceStateControlProps = {
                sourceId: row.sourceId,
                name: row.name,
                state,
                since: consent.status?.states?.[row.sourceId]?.since,
                inForce,
                writing: consent.writing,
                setState: consent.setState,
                confirmed,
                setConfirmed,
                sinceLine: false,
              };
              return (
                <SourceRow
                  key={row.sourceId}
                  source={row.source}
                  control={control}
                  consent={consent}
                  pick={<PickControl sourceId={row.sourceId} name={row.name} state={state} picked={picks.picked.includes(row.sourceId)} />}
                />
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
