'use client';

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
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
import HarnessMenu from '@/components/composer/HarnessMenu';
import { SignInControl, useSignInAction } from '@/components/composer/SignInControl';
import { COUNT_LINE, SIGN_IN_LINE, WHERE_LINE } from '@/components/composer/copy';
import { noSourceOnReason, panelStates, useSourceConsent, type SourceStateValue } from '@/components/sources/useSourceConsent';
import { useDefaultPortalArg, usePortalLocked } from '@/components/DefaultPortalProvider';
import { useNotebooksOffered } from '@/components/NotebookModeProvider';
import { notebookModeAffordance } from '@/lib/notebook-availability';

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
   * When present, the harness menu offers "Compare with a second harness",
   * bound to this state (s6 P2, #229; UX-2 P3b-2, D4 = A — answer-first
   * mounts only). Absent (the default, and the home page's mount, Q12 = A),
   * the menu offers no Compare item.
   */
  comparisonControl?: {
    restored: boolean;
    onChange: (restored: boolean) => void;
  };
  /**
   * Whether the signed-in choices are offered to a signed-out reader (UX pass
   * row 7, the owner's ruling of 2026-10-22). Default 'always': every mount as
   * before. The public home page passes 'hidden-signed-out': signed out, on an
   * instance that offers sign-in, the harness menu shows its signed-out form
   * (UX-2 P3b-2, 2C: Model disabled, no Session type, a sign-in button), and
   * the account line under the box carries the P3b sign-in sentence (UX-2
   * P3b-1). Signed in, nothing changes.
   */
  advancedOptions?: 'always' | 'hidden-signed-out';
  /**
   * The composer sits docked below the results (UX-2 P3b-1): the surface says
   * so when a run on it starts (leg H, dock at send; `QuerySurface`).
   */
  docked?: boolean;
  /**
   * The first-time line (X24) shows under the docked box; the form picks its
   * signed-in or signed-out form from the session (Q5 = B, relay 57).
   */
  showFirstTimeLine?: boolean;
  /**
   * The home page's mount reads `q` from the address once, after mount, and fills an empty box with it, sending
   * nothing (UX-2 P3b-2, 2H; fix 7): `/learn`'s cards link `/?q=<the question>`. No other mount asks for it.
   */
  prefillFromAddress?: boolean;
}

/** The address's `q`, decoded; null with none. Read after hydration only (the server snapshot is null). */
const readAddressQuestion = (): string | null => {
  const q = new URLSearchParams(window.location.search).get('q');
  return q !== null && q.trim() !== '' ? q : null;
};
const noSubscription = () => () => {};
const noAddress = () => null;

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

export default function QueryForm({
  onSubmit,
  isLoading,
  queryCount = 0,
  defaultMode = 'standard',
  comparisonControl,
  advancedOptions = 'always',
  docked = false,
  showFirstTimeLine = false,
  prefillFromAddress = false,
}: QueryFormProps) {
  // This instance's configured default portal as a wire value, '' when none
  // (#407) — server-resolved, threaded through the root layout.
  const defaultPortal = useDefaultPortalArg();
  // SITE_PORTAL_LOCKED, server-resolved like the default portal (#436). Locked,
  // the instance serves its configured Socrata portal only: no cross-portal
  // examples, and every request goes out with '' or that portal, both of which
  // the routes resolve to it. (The portal picker this used to drop went with
  // the Advanced-options region, UX-2 P3b-2, Q7 = A.)
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
  // UX-2 P3b-2 (2H; fix 7): `q` from the address, once, into an empty box. A hydration-safe snapshot (null on the
  // server and in the first client render), then the "adjust state when a value changes" render-time pattern: no
  // setState in an effect, and no `useSearchParams`, which would client-render the prerendered home page.
  const addressQuestion = useSyncExternalStore(noSubscription, prefillFromAddress ? readAddressQuestion : noAddress, noAddress);
  const [prefilled, setPrefilled] = useState(false);
  if (addressQuestion !== null && !prefilled) {
    setPrefilled(true);
    if (query === '') setQuery(addressQuestion);
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
  // Where sign-in goes (P4c; #229 P1; Q63): one decision with the harness menu's sign-in button (UX-2 P3b-2, fix 14).
  // Null where this instance offers no sign-in.
  const signInAction = useSignInAction();
  const [mode, updateMode] = useStoredMode(notebookAffordance === 'toggle', defaultMode);
  // UX pass row 7: on a mount that asks for it, a signed-out reader on an
  // instance that offers sign-in sees the harness menu's signed-out form, and
  // the P3b sign-in sentence in the account line (UX-2 P3b-1, Q6 = B; P3b-2,
  // 2C). With no sign-in to offer, the signed-in choices stay: there is nothing
  // to sign in to, and the model choice is theirs to make (v2 ruling 4).
  const signInOffered = signInAction !== null;
  const hideAdvanced = advancedOptions === 'hidden-signed-out' && !isAuthenticated && signInOffered;
  const [models, setModels] = useState<Model[]>([]);
  const [modelsError, setModelsError] = useState(false);

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
  // with the guard: every source Off, W5/W6's words; no source On where this site cannot ask, CA-1a's (UX-2 P3b-2).
  const whereLine = (() => {
    const statement = consent.statement;
    const status = consent.status;
    const ids = statement?.sources.map((s) => s.sourceId) ?? [];
    if (!statement || !status || ids.length === 0) return null;
    const pending = status.inForce ? null : panelStates({ status, pending: consent.pending }, ids);
    const stateOf = (id: string): SourceStateValue | undefined => (pending ? pending[id] : status.states?.[id]?.state);
    const reason = noSourceOnReason(ids, stateOf, consent);
    // CA-1a (UX-2 P3b-2; C1 = A, v2 ruling 2): no source On where this site cannot ask, in both session types.
    if (reason === 'cannot-ask') return WHERE_LINE.cannotAsk;
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

  // The P3b sign-in sentence (Q6 = B with the note; 1B.3), on the home page signed out where sign-in is offered: its
  // "Sign in" makes the header's decision through the same resolver (S2): a link to the app host's sign-in on a split
  // topology, the one provider's sign-in started in place, or a link to the panel that lists several.
  const exhausted = shownCount !== null && shownCount.remaining === 0;
  const controlStyle: React.CSSProperties = exhausted ? { ...SIGN_IN_CONTROL, color: 'inherit' } : SIGN_IN_CONTROL;
  const signInLine = hideAdvanced && signInAction !== null ? (
    <span data-part="sign-in-line"><SignInControl action={signInAction} style={controlStyle}>{SIGN_IN_LINE.action}</SignInControl>{SIGN_IN_LINE.rest}</span>
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
  // the guard's slots; UX-2 P3b-2: the harness menu in the box (2B, 2C), and the models-error status beneath.
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
      harness={
        <HarnessMenu
          variant={hideAdvanced ? 'signed-out' : 'full'}
          models={models}
          model={model}
          onModel={setModel}
          session={{ mode, onMode: updateMode, affordance: notebookAffordance }}
          comparison={comparisonControl}
          disabled={isLoading}
        />
      }
    >
      {/* Model-list load failure (#283): disclosed, not painted onto the
          model picker as an invalid field — the picker didn't fail, the
          background fetch did (see docs/design-principles.md's corollary).
          Always visible, under the box, not inside the harness menu, since
          that's where "visible" cashes out for a background failure the
          reader never asked to see. */}
      {modelsError && (
        <div
          role="status"
          style={{ fontSize: '13px', color: 'var(--caution)', textAlign: 'center' }}
        >
          {MODELS_LOAD_ERROR}
        </div>
      )}
    </Composer>
  );
}
