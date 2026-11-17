'use client';

/**
 * The Settings overlay at `/settings` (UX-2 P4b; F2 = A as relay 8 amends it),
 * signed in and signed out.
 *
 * WHERE IT RENDERS. `mount` says how the reader reached it:
 *   - `intercepted`: a client-side navigation to `/settings` from any page,
 *     intercepted by the root `@modal` slot (`src/app/@modal/(.)settings`), so
 *     the overlay opens over the page it was opened from, which stays mounted
 *     (a question waiting at a pause keeps its stream). Closing goes back.
 *   - `page`: a direct load or a reload of `/settings`
 *     (`src/app/(app)/settings/page.tsx`): the overlay over the site's frame.
 *     There is no page to go back to, so closing goes to the host's front
 *     door (`/`, which the app host sends on to `/ask`).
 * Escape, the close control and the backdrop close it, and focus returns to
 * the opener; Tab stays inside (P4's `Dialog`). The two sub-pages are a P8 tab
 * pair: the arrow keys, Home and End move between them.
 *
 * DATA SOURCES (item 45). The lede (X22b on the account, item 19 in the
 * cookie); on the account, the notices with Dismiss and the date and version
 * line the dashboard's Sources tab carried, moved verbatim (M7); the search
 * (item 17) with its count (item 24) and empty line (item 22); one row per
 * configured source, the Sources panel's own (`SourceRow`), with its pause
 * card while a question waits on that source; the local-only offer; the
 * privacy link; and "Withdraw consent" whenever a consent is in force, signed
 * in or out, as the panel offers it (item 40's one withdraw sentence points
 * every reader here). Before a consent the controls are live and hold pending
 * states, as the panel's do (R9 P2).
 *
 * ABOUT THESE SETTINGS (items 6-7). `PANEL_LEAD`, item 43's words for this
 * instance (new constants; `KEPT_*` stay the privacy page's), the privacy link.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/Dialog';
import { Tabs } from '@/components/ui/Tabs';
import ConsentNotices from '@/components/sources/ConsentNotices';
import LocalOnlyOffer from '@/components/sources/LocalOnlyOffer';
import SourceRow from '@/components/sources/SourceRow';
import type { ConfirmedChange, SourceStateControlProps } from '@/components/sources/SourceStateControl';
import { panelStates, useSourceConsent, type SourceStateValue } from '@/components/sources/useSourceConsent';
import { PANEL_KEPT_ON_ACCOUNT, PANEL_LEAD, PANEL_PRIVACY_LINK, SETTINGS_TEXT, panelLeadBeforeConsent, sourcesShownLine } from '@/lib/sources/copy';
import { readerSourceName, sourceRowLines } from '@/lib/sources/source-name';
import { matchingSources } from '@/lib/sources/source-search';
import { useHostLinks } from '@/components/HostLinksProvider';
import { HARNESS_SENTENCE, WHY_THESE_MODELS } from '@/components/composer/copy';
import { readAddressSource } from '@/components/SourceLanding';

export interface SettingsOverlayProps {
  mount?: 'intercepted' | 'page';
  /** The sub-page shown first. */
  initialTab?: 'data-sources' | 'about';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A stored date in words, "20 October 2026" (UX pass row 14(a)), read from the
 * value's first ten characters as written (an ISO date or timestamp, UTC), so
 * no time zone moves it a day. Anything else is returned as stored. Moved from
 * the dashboard's Sources tab with the line that reads it (M7).
 */
function dateInWords(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : value;
}

const PARA = { margin: '0 0 10px' } as const;
const MUTED = { margin: '0 0 10px', color: 'var(--text-secondary)' } as const;

const noSubscription = () => () => {};
const noAddress = () => null;

function DataSources() {
  const consent = useSourceConsent();
  const status = consent.status;
  const statement = consent.statement;
  const inForce = status?.inForce === true;
  const onAccount = status?.store === 'row';
  const sources = statement?.sources ?? [];
  const ids = sources.map((s) => s.sourceId);
  const states = panelStates(consent, ids);
  const count = (state: SourceStateValue) => ids.filter((id) => states[id] === state).length;
  const [query, setQuery] = useState('');
  // The last change whose write succeeded: its row confirms it (the panel's rule, UX pass row 5).
  const [confirmed, setConfirmed] = useState<ConfirmedChange>(null);
  const searchable = sources.map((source) => ({ sourceId: source.sourceId, name: readerSourceName(source), what: sourceRowLines(source).what, source }));
  const shown = matchingSources(searchable, query);
  const lead = inForce ? '' : panelLeadBeforeConsent({ on: count('on'), askFirst: count('ask-first'), off: count('off') });
  // "Ask with this source" lands here as `/settings?source=<id>` (UX-2 P6 + P10, item 7; 0d item 9). The list marks the
  // row it was opened for (`data-target-source`) and brings that row into view inside the dialog's own scroller. An id
  // this instance does not list marks nothing, and focus stays where the Dialog puts it (Close).
  // Fix round 2, A3 (b) (OA-942): the row itself carries the mark the directory gives that source's card
  // (`data-landing-target`, its border and tint in globals.css), set BEFORE the scroll so the scroll counts it, and takes
  // focus, named by the source's reader name (the row's own first line), so no radio holds focus and an arrow key changes
  // no setting. SourceRow is not changed: the overlay marks and focuses the row it rendered, found inside its own marked
  // list. The Dialog focuses Close in the same commit (a parent's effect runs after its child's), so the row takes focus
  // a frame later, without scrolling again.
  const addressSource = useSyncExternalStore(noSubscription, readAddressSource, noAddress);
  const targetSource = addressSource !== null && ids.includes(addressSource) ? addressSource : null;
  const targetName = searchable.find((s) => s.sourceId === targetSource)?.name ?? null;
  // Fix round 4 (#729): the landing ends when its target does. An overlay rendered again at an address with no source (or
  // another one) takes back what the landing set on its row: the attribute, `tabindex` and `aria-label`, and a focus not
  // yet given; focus the row holds goes to the dialog's first enabled button (Close), where a no-source open puts it.
  // `broughtIntoView` is reset with it, so a later landing on the same source marks and focuses the row again. One
  // effect does both, so the order React runs a component's effects in cannot clear a landing just made.
  const broughtIntoView = useRef<string | null>(null);
  const landing = useRef<{ row: HTMLElement; cancelFocus: () => void } | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const landed = landing.current;
    if (landed !== null && broughtIntoView.current !== targetSource) {
      landing.current = null;
      broughtIntoView.current = null;
      landed.cancelFocus();
      if (document.activeElement === landed.row) {
        landed.row.closest<HTMLElement>('[role="dialog"]')?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
      }
      landed.row.removeAttribute('data-landing-target');
      landed.row.removeAttribute('tabindex');
      landed.row.removeAttribute('aria-label');
    }
    if (targetSource === null || broughtIntoView.current === targetSource) return;
    // A quoted attribute value: only a backslash and a double quote need escaping (the id is one the statement lists).
    const id = targetSource.replace(/["\\]/g, '\\$&');
    const row = document.querySelector<HTMLElement>(`ul[data-target-source="${id}"] > li[data-source="${id}"]`);
    if (!row) return;
    broughtIntoView.current = targetSource;
    row.setAttribute('data-landing-target', '');
    row.scrollIntoView({ block: 'nearest' });
    row.tabIndex = -1;
    if (targetName !== null) row.setAttribute('aria-label', targetName);
    const focusRow = () => row.focus({ preventScroll: true });
    let cancelFocus: () => void;
    if (typeof requestAnimationFrame === 'function') {
      const frame = requestAnimationFrame(focusRow);
      cancelFocus = () => cancelAnimationFrame(frame);
    } else {
      const timer = setTimeout(focusRow, 0);
      cancelFocus = () => clearTimeout(timer);
    }
    landing.current = { row, cancelFocus };
  }, [targetSource, targetName, shown.length]);

  return (
    <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-primary)' }}>
      <p style={PARA}>{onAccount ? SETTINGS_TEXT.ledeWithAccount : SETTINGS_TEXT.ledeCookie}</p>
      {lead !== '' && <p style={MUTED}>{lead}</p>}
      {/* R9 P4 (#662), moved from the Sources panel (UX-2 P4b): the read that kept a consent given signed out on the
          account says so; the page keeps it until the reader's next change. */}
      {onAccount && inForce && status?.keptFromCookie === true && <p role="status" style={PARA}>{PANEL_KEPT_ON_ACCOUNT}</p>}
      {onAccount && inForce && <ConsentNotices />}
      {onAccount && inForce && (
        <p style={PARA}>
          {/* One string per sentence, so the markup carries no separators between its parts. */}
          {`Given on ${status?.consentedAt ? dateInWords(String(status.consentedAt)) : 'a date not recorded'}.`}
          {` It refers to the statement of where a question can go as it stood on ${status?.consentedFlowsDate ? dateInWords(status.consentedFlowsDate) : 'a date not recorded'} (version ${status?.consentedBaseVersion?.slice(0, 8) ?? 'not recorded'}).`}
        </p>
      )}
      <input
        type="search"
        aria-label={SETTINGS_TEXT.search}
        placeholder={SETTINGS_TEXT.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: '14px', border: '1px solid var(--border-color)', borderRadius: '6px', margin: '0 0 6px' }}
      />
      {query.trim() !== '' && (
        <p role="status" style={{ margin: '0 0 6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          {sourcesShownLine(shown.length, searchable.length)}
        </p>
      )}
      {shown.length === 0 && searchable.length > 0 && <p style={MUTED}>{SETTINGS_TEXT.noMatch}</p>}
      <ul data-target-source={targetSource ?? undefined} style={{ listStyle: 'none', margin: '0 0 10px', padding: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
        {shown.map(({ source, name }) => {
          const control: SourceStateControlProps = {
            sourceId: source.sourceId,
            name,
            state: states[source.sourceId] ?? 'ask-first',
            since: status?.states?.[source.sourceId]?.since,
            inForce,
            writing: consent.writing,
            setState: consent.setState,
            confirmed,
            setConfirmed,
            // The consent's own date line above carries the date (as the dashboard's tab did).
            sinceLine: false,
          };
          return <SourceRow key={source.sourceId} source={source} control={control} consent={consent} />;
        })}
      </ul>
      <p style={MUTED}>
        <LocalOnlyOffer statement={statement} />
      </p>
      <p style={PARA}>
        <a href="/privacy">{PANEL_PRIVACY_LINK}</a>
      </p>
      {inForce && (
        <button
          type="button"
          onClick={() => {
            void consent.revoke();
          }}
          disabled={consent.writing}
          style={{ padding: '6px 14px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--white)', color: 'var(--text-primary)', cursor: 'pointer' }}
        >
          Withdraw consent
        </button>
      )}
    </div>
  );
}

function About() {
  const consent = useSourceConsent({ load: false });
  const accounts = consent.status?.accounts === true;
  // UX-2 P3b-2 (fix 11): `/learn` is withheld on the app host, so the link goes to the marketing origin when the instance
  // names one; a plain link, as the privacy link below is, so it leaves the overlay with the page.
  const { marketingOrigin } = useHostLinks();
  return (
    <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-primary)' }}>
      <p style={PARA}>{PANEL_LEAD}</p>
      <p style={PARA}>{accounts ? SETTINGS_TEXT.aboutKeptWithAccounts : SETTINGS_TEXT.aboutKeptWithoutAccounts}</p>
      {/* UX-2 P3b-2 (2F; Q2 = A, Q8 = A; C2 = A): the harness sentence, here only, and the link the gear's region carried. */}
      <p style={PARA}>{HARNESS_SENTENCE}</p>
      <p style={PARA}>
        <a href={`${marketingOrigin ?? ''}/learn#model-selection`}>{WHY_THESE_MODELS}</a>
      </p>
      <p style={PARA}>
        <a href="/privacy">{PANEL_PRIVACY_LINK}</a>
      </p>
    </div>
  );
}

export default function SettingsOverlay({ mount = 'intercepted', initialTab = 'data-sources' }: SettingsOverlayProps) {
  const router = useRouter();
  // #759: the overlay holds the consent store for both sub-pages, so a switch between them never empties it.
  useSourceConsent();
  const [tab, setTab] = useState<'data-sources' | 'about'>(initialTab);
  // One navigation per opening. A soft navigation is asynchronous: until it
  // unmounts the overlay, the overlay is still open and still the top modal, so
  // a second quick Escape or close click would call `back()` again and leave
  // the page beneath. A reopen is a new mount, with a fresh flag.
  // THE RISK, stated: a navigation that never unmounted the overlay would leave
  // it unable to close. Both do unmount it: `back()` leaves `/settings`, which
  // `InterceptedSettings` renders on alone, and `push('/')` leaves the page.
  const closing = useRef(false);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (mount === 'intercepted') router.back();
    else router.push('/');
  };
  return (
    <Dialog open onClose={close} title={SETTINGS_TEXT.heading}>
      <Tabs
        label={SETTINGS_TEXT.heading}
        tabs={[
          { id: 'data-sources', label: SETTINGS_TEXT.tabs.dataSources },
          { id: 'about', label: SETTINGS_TEXT.tabs.about },
        ]}
        selectedId={tab}
        onSelect={(id) => setTab(id === 'about' ? 'about' : 'data-sources')}
      >
        {tab === 'data-sources' ? <DataSources /> : <About />}
      </Tabs>
    </Dialog>
  );
}
