'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { signIn, useSession } from 'next-auth/react';
import { useHostLinks } from '@/components/HostLinksProvider';
import { useSignInOptions } from '@/components/SignInOptionsProvider';
import { resolveSignInAffordance } from '@/lib/auth-provider-options';
import { useSessionChoice } from '@/hooks/useSessionChoice';
import {
  MODE_STORAGE_KEY,
  offeredExampleQueries,
  parseStoredMode,
  resolveEffectiveMode,
  type ExampleQuery,
  type QueryMode,
} from '@/lib/query-presentation';
import { parseModelsResponse, type Model } from '@/lib/model-list';
import { MODELS_LOAD_ERROR } from '@/lib/streaming';
import { SETTINGS_HREF } from '@/lib/sources/copy';
import Composer from '@/components/composer/Composer';
import { COUNT_LINE, SIGN_IN_LINE, WHERE_LINE } from '@/components/composer/copy';
import { noSourceOnReason, panelStates, useSourceConsent, type SourceStateValue } from '@/components/sources/useSourceConsent';
import { useDefaultPortalArg, usePortalLocked } from '@/components/DefaultPortalProvider';
import { useNotebooksOffered } from '@/components/NotebookModeProvider';
import { NOTEBOOK_MODE_UNAVAILABLE_REASON, notebookModeAffordance } from '@/lib/notebook-availability';

// Re-exported for existing importers; the type itself lives in
// src/lib/query-presentation.ts alongside the derivations that use it.
export type { QueryMode };

/**
 * Sticky-per-session mode persistence (§10 Q7), on the shared
 * `useSessionChoice` mechanism. The user's explicit, stored choice wins over
 * the mount's `defaultMode`; with no choice stored the mount default applies
 * (s6 P2, #229 — 'standard' everywhere except mounts that say otherwise).
 * When the toggle is disabled (anonymous user, loading auth state, an
 * instance that runs no notebooks, etc.) the effective mode is forced to
 * 'standard'; the stored preference is preserved so signing back in restores
 * the previous choice.
 */
function useStoredMode(
  enabled: boolean,
  defaultMode: QueryMode,
): [QueryMode, (next: QueryMode) => void] {
  const [chosen, set] = useSessionChoice<QueryMode>(MODE_STORAGE_KEY, parseStoredMode);
  const effective = resolveEffectiveMode({ enabled, chosen, defaultMode });
  return [effective, set];
}

interface QueryFormProps {
  onSubmit: (query: string, model: string, portal: string, mode: QueryMode) => void;
  isLoading: boolean;
  queryCount?: number;
  /**
   * The response mode the form starts in when the visitor has not made an
   * explicit (session-persisted) choice. Default 'standard' — today's
   * behavior on every existing mount; `/ask` passes 'notebook' (s6 P2).
   */
  defaultMode?: QueryMode;
  /**
   * When present, Advanced options renders the side-by-side-comparison
   * restore toggle bound to this state (s6 P2, #229 — answer-first mounts
   * only). Absent (the default, and every pre-existing mount), nothing
   * renders and the form is unchanged.
   */
  comparisonControl?: {
    restored: boolean;
    onChange: (restored: boolean) => void;
  };
  /**
   * Whether Advanced options is offered to a signed-out reader (UX pass row 7,
   * the owner's ruling of 2026-10-22). Default 'always': every mount as before.
   * The public home page passes 'hidden-signed-out': signed out, on an instance
   * that offers sign-in, the toggle is not rendered, and the account line under
   * the box carries the P3b sign-in sentence (UX-2 P3b-1). Signed in, nothing
   * changes.
   */
  advancedOptions?: 'always' | 'hidden-signed-out';
  /**
   * The composer sits docked below the results (UX-2 P3b-1): the surface says
   * so once a run on it has finished with an answer (`QuerySurface`).
   */
  docked?: boolean;
  /**
   * The first-time line (X24) shows under the docked box; the form picks its
   * signed-in or signed-out form from the session (Q5 = B, relay 57).
   */
  showFirstTimeLine?: boolean;
}

/*
 * The suggested questions under the box live in `src/lib/query-presentation.ts`
 * (`EXAMPLE_QUERIES`, `offeredExampleQueries`). One of them demonstrates the
 * portal-scoped path, so it needs a portal to select — and that portal is the
 * instance's, not a literal (#407): `usesDefaultPortal` resolves at render to
 * `SITE_DEFAULT_PORTAL`, or to '' ("All portals") when this instance declared
 * none. The one that compares two cities is not offered on a locked instance
 * (#436).
 */

/** The count's answer from `/api/rate-limit`, kept only when it carries both numbers (addendum 3, 3.5). */
interface QuestionCount { remaining: number; limit: number }

/** The sign-in control reads as a link in every branch, a button where it starts the sign-in in place. */
const SIGN_IN_CONTROL: React.CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' };

const PORTALS = [
  { id: '', name: 'All portals' },
  { id: 'data.cityofnewyork.us', name: 'New York City' },
  { id: 'data.cityofchicago.org', name: 'Chicago' },
  { id: 'data.sf.gov', name: 'San Francisco' },
  { id: 'data.lacity.org', name: 'Los Angeles' },
  { id: 'data.seattle.gov', name: 'Seattle' },
];

export default function QueryForm({
  onSubmit,
  isLoading,
  queryCount = 0,
  defaultMode = 'standard',
  comparisonControl,
  advancedOptions = 'always',
  docked = false,
  showFirstTimeLine = false,
}: QueryFormProps) {
  // This instance's configured default portal as a wire value, '' when none
  // (#407) — server-resolved, threaded through the root layout.
  const defaultPortal = useDefaultPortalArg();
  // SITE_PORTAL_LOCKED, server-resolved like the default portal (#436). Locked,
  // the instance serves its configured Socrata portal only: no picker, no
  // cross-portal examples, and every request goes out with '' or that portal,
  // both of which the routes resolve to it.
  const portalLocked = usePortalLocked();
  const exampleQueries = offeredExampleQueries(portalLocked);
  const [query, setQuery] = useState('');
  // UX-2 P3b-1 (1A; addendum 3, 3.2): the box empties when the surface docks. A question the guard holds keeps its
  // text: the guard holds it before its run starts, and only a started run empties the box (`ask`, below).
  const [dockSeen, setDockSeen] = useState(docked);
  if (docked !== dockSeen) {
    // The "adjust state when a value changes" render-time pattern.
    setDockSeen(docked);
    if (docked) setQuery('');
  }
  // Empty until `/api/models` answers, then the first model THIS instance
  // offers (website#30 P4). It used to initialize to a hardcoded `openai/gpt-4o`
  // — a statement that this instance offers that id, true only of the built-in
  // catalog. On an instance with its own catalog the selector rendered
  // "Select model" while the state still held an id the instance does not
  // offer, so a submit before any selection sent it upstream. The built-in
  // catalog's first offered model is read rather than asserted: since the
  // October 2026 roster (#573) it is `anthropic/claude-haiku-5.5`.
  const [model, setModel] = useState('');
  const [portal, setPortal] = useState('');
  // Phase 2a1 gate: executed-sandbox mode is signed-in-only. Anonymous users
  // cannot invoke /api/query-notebook through the UI. `useStoredMode` keeps
  // the sticky-per-session persistence from §10 Q7 but force-returns
  // 'standard' when the user is not authenticated.
  const { status: authStatus } = useSession();
  const isAuthenticated = authStatus === 'authenticated';
  // #547: an instance that runs no notebooks (EXECUTOR_DRIVER=none,
  // server-resolved, threaded through the root layout) shows the mode
  // unavailable with its reason, signed in or not, and runs standard mode.
  // Unset, the affordance is 'toggle' exactly when signed in, as before.
  const notebooksOffered = useNotebooksOffered();
  const notebookAffordance = notebookModeAffordance({ signedIn: isAuthenticated, notebooksOffered });
  // Where sign-in should go (P4c). Null on an instance with no host
  // topology configured — then the affordance below stays in place, exactly
  // as it is today. See src/lib/host-links.ts.
  const { signInHref } = useHostLinks();
  // #229 P1: which provider the in-place branch below starts, and whether it
  // can name one at all — derived from the instance's configuration (Q63).
  const signInAffordance = resolveSignInAffordance(useSignInOptions());
  const [mode, updateMode] = useStoredMode(notebookAffordance === 'toggle', defaultMode);
  // UX pass row 7: on a mount that asks for it, a signed-out reader on an
  // instance that offers sign-in sees no toggle, and the P3b sign-in sentence
  // in the account line (UX-2 P3b-1, Q6 = B). With no sign-in to offer, the
  // toggle stays: there is nothing to sign in to, and the model and portal
  // choices are theirs to make.
  const signInOffered = signInHref !== null || signInAffordance.kind !== 'none';
  const hideAdvanced = advancedOptions === 'hidden-signed-out' && !isAuthenticated && signInOffered;
  const [models, setModels] = useState<Model[]>([]);
  const [modelsError, setModelsError] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const portalDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchModels = async () => {
      try {
        const res = await fetch('/api/models');
        const data = await res.json();
        const parsed = parseModelsResponse(data);
        if (!isMounted) return;
        if (parsed === null) {
          // Same failure class as the catch below (#283): a 200 response
          // whose body doesn't carry a usable `models` array. Routed through
          // the same reader-facing state rather than left to crash at
          // render (`models.find(...)` on an undefined `models`).
          console.error('Failed to fetch models: response missing a `models` array');
          setModelsError(true);
          return;
        }
        setModels(parsed);
        setModelsError(false);
        // Adopt this instance's first offered model, once, if the reader has
        // not already chosen. `/api/models` serves selectable entries in
        // catalog order, and the catalog's `default` flag names the notebook
        // route's model, which is deliberately not in this list.
        setModel((current) => (current === '' && parsed.length > 0 ? parsed[0].id : current));
      } catch (error) {
        console.error('Failed to fetch models:', error);
        if (isMounted) setModelsError(true);
      }
    };
    fetchModels();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (!modelOpen && !portalOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modelOpen && modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
      if (portalOpen && portalDropdownRef.current && !portalDropdownRef.current.contains(e.target as Node)) {
        setPortalOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [modelOpen, portalOpen]);

  // The consent card (R6 W3, #632; stage-A ruling (a); the Sources panel beside it was removed in UX-2 P4b).
  // Both of this form's submit paths go through the guard: with no consent in
  // force the card is shown and nothing is sent; after Allow the question is
  // sent; Not now sends nothing and holds the form for that question (a new
  // question asks again, Q2); with no source On the reader is told so; while
  // the panel's write is in flight the submit is held. A refusal a route
  // answers (`consent_required`, reported by the streaming hooks) shows the
  // card too, and Allow sends the last question again: that covers the
  // surface's own direct paths (continue, re-run, retry), which do not come
  // through this form.
  const consent = useSourceConsent();
  const [cardOpen, setCardOpen] = useState(false);
  // The where-line (UX-2 P3b-1, 1B.1; D5 B; addenda 1-3), before and after a first consent. Nothing until the
  // statement and the status are both read (a failed read leaves either null, with `loaded` true). Before a consent
  // it reads the pending states, which Allow writes (`panelStates`); after one, the guard's own lookup. One predicate
  // with the guard: every source Off, W5/W6's words; no source On where this site cannot ask, no line (addendum 2).
  const whereLine = (() => {
    const statement = consent.statement;
    const status = consent.status;
    const ids = statement?.sources.map((s) => s.sourceId) ?? [];
    if (!statement || !status || ids.length === 0) return null;
    const pending = status.inForce ? null : panelStates({ status, pending: consent.pending }, ids);
    const stateOf = (id: string): SourceStateValue | undefined => (pending ? pending[id] : status.states?.[id]?.state);
    const reason = noSourceOnReason(ids, stateOf, consent);
    if (reason === 'cannot-ask') return null;
    const on = ids.filter((id) => stateOf(id) === 'on').length;
    const sandbox = mode === 'notebook';
    return reason === 'every-off' ? WHERE_LINE.everyOff : on > 0 ? WHERE_LINE.on(on, sandbox) : WHERE_LINE.askFirst(sandbox);
  })();
  const [declinedQuery, setDeclinedQuery] = useState<string | null>(null);
  const [noneOn, setNoneOn] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);
  const lastSentRef = useRef<(() => void) | null>(null);
  /** The text of the last question sent, which a route's refusal holds (addendum 3, ruling 1). */
  const [lastSentQuery, setLastSentQuery] = useState('');
  const [refusalsSeen, setRefusalsSeen] = useState(consent.refusals);
  const [resendOnAllow, setResendOnAllow] = useState(false);
  if (consent.refusals !== refusalsSeen) {
    // The "adjust state when a value changes" render-time pattern.
    setRefusalsSeen(consent.refusals);
    if (consent.refusals > refusalsSeen) {
      // Allow then sends the last question again (read in the handler, not here).
      setResendOnAllow(true);
      setCardOpen(true);
      // The question the route refused goes back into the box if the box is still empty (addendum 3, ruling 1);
      // text the reader typed since the send stays.
      if (query === '' && lastSentQuery !== '') setQuery(lastSentQuery);
    }
  }

  // The count (UX-2 P3b-1, 1B.3; O3 = A; addendum 3, ruling 2): read when a question is sent, and again when a run
  // ends however it ends (a route adds to the count while the run is under way, so the first read can come before
  // that add). Shown from the first question on; nothing while unanswered or failed.
  const [runsEnded, setRunsEnded] = useState(0);
  const [wasLoading, setWasLoading] = useState(isLoading);
  if (isLoading !== wasLoading) {
    // The "adjust state when a value changes" render-time pattern.
    setWasLoading(isLoading);
    if (!isLoading) setRunsEnded((n) => n + 1);
  }
  const [questionCount, setQuestionCount] = useState<QuestionCount | null>(null);
  useEffect(() => {
    if (queryCount === 0) return;
    let live = true;
    fetch('/api/rate-limit')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { remaining?: unknown; limit?: unknown } | null) => {
        if (!live) return;
        setQuestionCount(body && typeof body.remaining === 'number' && typeof body.limit === 'number' ? { remaining: body.remaining, limit: body.limit } : null);
      })
      .catch(() => { if (live) setQuestionCount(null); });
    return () => { live = false; };
  }, [queryCount, runsEnded]);
  const shownCount = queryCount > 0 ? questionCount : null;

  // No model chosen yet means `/api/models` has not answered (a few hundred ms
  // on first paint) or could not answer at all. Either way there is no id to
  // send: the routes require one, and this form no longer has a hardcoded id to
  // guess with. The `modelsError` message above says so when the failure is
  // durable.
  const declined = declinedQuery !== null && query.trim() === declinedQuery;
  const canSubmit = query.trim().length > 0 && model !== '' && !isLoading && !declined && !consent.writing;

  const ask = () => {
    const args = [query.trim(), model, portal, mode] as const;
    const run = () => {
      lastSentRef.current = () => onSubmit(...args);
      setLastSentQuery(args[0]);
      onSubmit(...args);
      // The run has started: the docked box empties for the next question (1A).
      if (docked) setQuery('');
    };
    setNoneOn(false);
    void consent.guard(run, () => {
      pendingRef.current = run;
      setCardOpen(true);
    }).then((result) => {
      if (result === 'none-on') setNoneOn(true);
    });
  };

  const handleExampleClick = (example: ExampleQuery) => {
    setQuery(example.text);
    // '' when this instance configured no default — the "All portals" entry,
    // which is a working selection, not an empty one (#407).
    setPortal(example.usesDefaultPortal ? defaultPortal : '');
  };

  const selectedModel = models.find((m) => m.id === model);

  const segmentStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 14px',
    border: 'none',
    background: active ? 'var(--white)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: active ? 600 : 500,
    cursor: isLoading ? 'not-allowed' : 'pointer',
    borderRadius: '999px',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
    transition: 'background-color 0.15s ease, color 0.15s ease',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
  });

  // The P3b sign-in sentence (Q6 = B with the note; 1B.3), on the home page signed out where sign-in is offered: its
  // "Sign in" makes the header's decision through the same resolver (S2): a link to the app host's sign-in on a split
  // topology, the one provider's sign-in started in place, or a link to the panel that lists several.
  const exhausted = shownCount !== null && shownCount.remaining === 0;
  const controlStyle: React.CSSProperties = exhausted ? { ...SIGN_IN_CONTROL, color: 'inherit' } : SIGN_IN_CONTROL;
  const signInControl = signInHref !== null ? (
    <a href={signInHref} style={controlStyle}>{SIGN_IN_LINE.action}</a>
  ) : signInAffordance.kind === 'provider' ? (
    <button type="button" onClick={() => signIn(signInAffordance.option.id)} style={controlStyle}>{SIGN_IN_LINE.action}</button>
  ) : signInAffordance.kind === 'panel' ? (
    <a href={signInAffordance.href} style={controlStyle}>{SIGN_IN_LINE.action}</a>
  ) : null;
  const signInLine = hideAdvanced && signInControl !== null ? (
    <span data-part="sign-in-line">{signInControl}{SIGN_IN_LINE.rest}</span>
  ) : null;
  // The account line (O2 = A): the count, then the sign-in sentence, one paragraph. A low count (2 or fewer) is bold in
  // the text colour; at 0 the whole line takes the error colour, the reset sentence with it; never the caution colour.
  const low = shownCount !== null && shownCount.remaining > 0 && shownCount.remaining <= 2;
  const accountLine = shownCount !== null || signInLine !== null ? (
    <p data-part="account-line" className="composer-line" style={exhausted ? { color: 'var(--error)' } : undefined}>
      {shownCount !== null ? (
        <>
          {low ? <strong style={{ color: 'var(--text-primary)' }}>{COUNT_LINE.left(shownCount.remaining, shownCount.limit)}</strong> : COUNT_LINE.left(shownCount.remaining, shownCount.limit)}
          {exhausted ? <> {COUNT_LINE.reset}</> : null}
          {signInLine !== null ? ' ' : null}
        </>
      ) : null}
      {signInLine}
    </p>
  ) : null;

  // UX-2 P3b-1: the composer lays out the box, the example chips (built here, from the offered list), the lines and
  // the guard's slots; the gear, its region and the models-error status stay this form's, beneath.
  return (
    <Composer
      value={query}
      onChange={setQuery}
      onSubmit={ask}
      canSubmit={canSubmit}
      isLoading={isLoading}
      docked={docked}
      placeholder="What data is available about child care in NYC?"
      chips={exampleQueries.map((example, idx) => ({ id: String(idx), label: example.text, onSelect: () => handleExampleClick(example) }))}
      line={whereLine !== null ? (
        <p data-part="where-this-question-goes" className="composer-line">
          {whereLine}{WHERE_LINE.separator}
          {/* UX-2 P4b: the Settings overlay, a client-side link so the form beneath stays mounted. */}
          <Link href={SETTINGS_HREF}>{WHERE_LINE.link}</Link>
        </p>
      ) : null}
      firstTimeLine={showFirstTimeLine ? (isAuthenticated ? 'signed-in' : 'signed-out') : null}
      accountLine={accountLine}
      guard={{
        cardOpen,
        onAllow: () => {
          setCardOpen(false);
          setDeclinedQuery(null);
          const run = pendingRef.current ?? (resendOnAllow ? lastSentRef.current : null);
          pendingRef.current = null;
          setResendOnAllow(false);
          // A `none-on` after Allow says so, as the submit path does (addendum 1, section 3).
          if (run) void consent.guard(run, () => setCardOpen(true)).then((result) => { if (result === 'none-on') setNoneOn(true); });
        },
        onNotNow: () => {
          setCardOpen(false);
          pendingRef.current = null;
          // A route's refusal holds the question it refused, which "Don't allow" records (addendum 3, ruling 1).
          setDeclinedQuery(resendOnAllow && lastSentQuery !== '' ? lastSentQuery : query.trim());
          setResendOnAllow(false);
        },
        declined,
        statement: consent.statement,
        noneOn,
      }}
    >
      {/* The gear's row, where the mount shows it (P3b-2 replaces it with the harness menu). */}
      {hideAdvanced ? null : (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '13px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px 0',
            }}
          >
            <span style={{ fontSize: '16px' }}>&#9881;</span> Advanced options {advancedOpen ? '\u25B4' : '\u25BE'}
          </button>
        </div>
      )}

      {/* Model-list load failure (#283): disclosed, not painted onto the
          model picker as an invalid field — the picker didn't fail, the
          background fetch did (see docs/design-principles.md's corollary).
          Always visible, not gated behind Advanced options, since that's
          where "visible" cashes out for a background failure the reader
          never asked to see. */}
      {modelsError && (
        <div
          role="status"
          style={{ fontSize: '13px', color: 'var(--caution)', textAlign: 'center' }}
        >
          {MODELS_LOAD_ERROR}
        </div>
      )}

      {/* Advanced options expanded section */}
      {advancedOpen && !hideAdvanced && (
        <div>
          {/* Response mode — signed-in-only per Phase 2a1. Anonymous users
              see a sign-in prompt instead of the toggle; the executed-sandbox
              path requires authentication to invoke /api/query-notebook. On
              an instance that runs no notebooks (#547) everyone sees the
              control with that option disabled and the reason beside it. */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400, display: 'block', marginBottom: '6px' }}>
              Response mode
            </label>
            {notebookAffordance === 'toggle' ? (
              <>
                <div
                  role="radiogroup"
                  aria-label="Response mode"
                  style={{
                    display: 'flex',
                    padding: '3px',
                    gap: '4px',
                    background: 'var(--card-background)',
                    borderRadius: '999px',
                    border: '1px solid var(--border-color)',
                    width: '100%',
                  }}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'standard'}
                    disabled={isLoading}
                    onClick={() => updateMode('standard')}
                    style={segmentStyle(mode === 'standard')}
                  >
                    Standard
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'notebook'}
                    disabled={isLoading}
                    onClick={() => updateMode('notebook')}
                    style={segmentStyle(mode === 'notebook')}
                    title="Generate and execute a Jupyter notebook against live data (~30-90s)."
                  >
                    Execute in a signed sandbox
                  </button>
                </div>
                {mode === 'notebook' && (
                  <p
                    style={{
                      margin: '6px 0 0',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      lineHeight: 1.5,
                    }}
                  >
                    Generates and executes a Jupyter notebook against live
                    data. Typically 30 to 90 seconds. The notebook and a
                    cryptographic execution record are signed by the platform.
                  </p>
                )}
              </>
            ) : notebookAffordance === 'unavailable' ? (
              <>
                <div
                  role="radiogroup"
                  aria-label="Response mode"
                  style={{
                    display: 'flex',
                    padding: '3px',
                    gap: '4px',
                    background: 'var(--card-background)',
                    borderRadius: '999px',
                    border: '1px solid var(--border-color)',
                    width: '100%',
                  }}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={true}
                    disabled={isLoading}
                    style={segmentStyle(true)}
                  >
                    Standard
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={false}
                    aria-disabled="true"
                    aria-describedby="notebook-mode-unavailable"
                    disabled
                    style={{ ...segmentStyle(false), cursor: 'not-allowed', opacity: 0.55 }}
                    title={NOTEBOOK_MODE_UNAVAILABLE_REASON}
                  >
                    Execute in a signed sandbox
                  </button>
                </div>
                <p
                  id="notebook-mode-unavailable"
                  style={{
                    margin: '6px 0 0',
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    lineHeight: 1.5,
                  }}
                >
                  {NOTEBOOK_MODE_UNAVAILABLE_REASON}
                </p>
              </>
            ) : (
              <div
                style={{
                  padding: '12px 14px',
                  border: '1px dashed var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--card-background)',
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                }}
              >
                <div style={{ marginBottom: '6px', fontWeight: 500, color: 'var(--text-primary)' }}>
                  Sign in to execute in a signed sandbox
                </div>
                {/* One expression, not a sentence split around a ternary:
                    two adjacent text children would make React emit comment
                    separators, and the unset case must stay byte-identical.
                    The provider name is interpolated (#229 P1) only where the
                    in-place branch can name one — every other shape keeps the
                    provider-neutral sentence P4c already ships. */}
                <p style={{ margin: '0 0 10px' }}>
                  {signInHref === null && signInAffordance.kind === 'provider'
                    ? `Executed-sandbox mode generates and runs a Jupyter notebook against live data, then signs the execution record. Sign in with ${signInAffordance.option.name} to enable.`
                    : 'Executed-sandbox mode generates and runs a Jupyter notebook against live data, then signs the execution record. Sign in to enable.'}
                </p>
                {signInHref !== null ? (
                  /* Split topology (P4c): sign-in lives on the app surface,
                     so this is a link rather than an in-place OAuth start —
                     which could not complete from this host anyway. No
                     loading state: the destination decides server-side. */
                  <a
                    href={signInHref}
                    className="ui-button ui-button-primary"
                    style={{ fontSize: '13px', padding: '6px 14px', textDecoration: 'none' }}
                  >
                    Sign in
                  </a>
                ) : signInAffordance.kind === 'provider' ? (
                <button
                  type="button"
                  onClick={() => signIn(signInAffordance.option.id)}
                  disabled={authStatus === 'loading'}
                  className="ui-button ui-button-primary"
                  style={{
                    fontSize: '13px',
                    padding: '6px 14px',
                    cursor: authStatus === 'loading' ? 'wait' : 'pointer',
                  }}
                >
                  {authStatus === 'loading' ? 'Loading…' : `Sign in with ${signInAffordance.option.name}`}
                </button>
                ) : signInAffordance.kind === 'panel' ? (
                  /* More than one provider: the panel that can list them. */
                  <a
                    href={signInAffordance.href}
                    className="ui-button ui-button-primary"
                    style={{ fontSize: '13px', padding: '6px 14px', textDecoration: 'none' }}
                  >
                    Sign in
                  </a>
                ) : null}
              </div>
            )}
          </div>

          {/* Side-by-side comparison restore (s6 P2, #229) — rendered only
              when the mount runs answer-first and hands down the control.
              Persisted per-session by the mount, exactly like the response
              mode above. */}
          {comparisonControl && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400, display: 'block', marginBottom: '6px' }}>
                Side-by-side comparison
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={comparisonControl.restored}
                  disabled={isLoading}
                  onChange={(e) => comparisonControl.onChange(e.target.checked)}
                  style={{ marginTop: '2px', cursor: 'inherit' }}
                />
                <span>Compare with and without data tools</span>
              </label>
              <p
                style={{
                  margin: '6px 0 0 22px',
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  lineHeight: 1.5,
                }}
              >
                Adds a second answer from training data alone, side by side.
                Runs one extra model call per question.
              </p>
            </div>
          )}

          <div className="form-controls-row">
              {/* Model dropdown */}
              <div className="ui-field" ref={modelDropdownRef} style={{ position: 'relative' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400 }}>Model</label>
                <button
                  type="button"
                  onClick={() => !isLoading && setModelOpen(!modelOpen)}
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 28px 8px 10px',
                    fontSize: '14px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    backgroundColor: 'var(--white)',
                    color: 'var(--text-primary)',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    appearance: 'none',
                    position: 'relative',
                  }}
                >
                  {selectedModel?.name || 'Select model'}
                  <span style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}>
                    &#9662;
                  </span>
                </button>
                {modelOpen && (
                  <ul style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    margin: '2px 0 0 0',
                    padding: '4px 0',
                    listStyle: 'none',
                    backgroundColor: 'var(--white)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 10,
                  }}>
                    {models.map((m) => (
                      <li
                        key={m.id}
                        onClick={() => { setModel(m.id); setModelOpen(false); }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          fontSize: '15px',
                          backgroundColor: m.id === model ? 'var(--card-background)' : 'transparent',
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                        onMouseOut={(e) => { e.currentTarget.style.backgroundColor = m.id === model ? 'var(--card-background)' : 'transparent'; }}
                      >
                        {m.name}
                        {m.tag && (
                          <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '13px' }}>
                            {m.tag}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Portal dropdown — not rendered on a locked instance (#436):
                  it would offer choices the routes refuse. */}
              {!portalLocked && (
              <div className="ui-field" ref={portalDropdownRef} style={{ position: 'relative' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400 }}>Data portal</label>
                <button
                  type="button"
                  onClick={() => !isLoading && setPortalOpen(!portalOpen)}
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 28px 8px 10px',
                    fontSize: '14px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    backgroundColor: 'var(--white)',
                    color: 'var(--text-primary)',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    appearance: 'none',
                    position: 'relative',
                  }}
                >
                  {PORTALS.find((p) => p.id === portal)?.name || 'Select portal'}
                  <span style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}>
                    &#9662;
                  </span>
                </button>
                {portalOpen && (
                  <ul style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    margin: '2px 0 0 0',
                    padding: '4px 0',
                    listStyle: 'none',
                    backgroundColor: 'var(--white)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 10,
                  }}>
                    {PORTALS.map((p) => (
                      <li
                        key={p.id || '__all__'}
                        onClick={() => { setPortal(p.id); setPortalOpen(false); }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          fontSize: '15px',
                          backgroundColor: p.id === portal ? 'var(--card-background)' : 'transparent',
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                        onMouseOut={(e) => { e.currentTarget.style.backgroundColor = p.id === portal ? 'var(--card-background)' : 'transparent'; }}
                      >
                        {p.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              )}
            </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            <Link
              href="/learn#model-selection"
              style={{ fontSize: '12px', color: 'var(--text-muted)' }}
            >
              Why these models?
            </Link>
            <Link
              href="/directory?tab=portals"
              style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 400 }}
            >
              Browse available data &rarr;
            </Link>
            <Link
              href="/about#whats-in-the-project"
              style={{ fontSize: '12px', color: 'var(--text-muted)' }}
            >
              What data is available?
            </Link>
          </div>
        </div>
      )}
    </Composer>
  );
}
