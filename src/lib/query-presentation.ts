/**
 * Pure derivations for the query surface's mount-level configuration
 * (s6 P2, anchor #229): which presentation a mount runs, which response
 * mode it defaults to, and what those choices mean for a single run.
 *
 * Everything here is deliberately free of React and the DOM so the rules
 * can be unit-tested under `node --test` like the rest of `src/lib`. The
 * components (`QuerySurface`, `QueryForm`) and the SSE route consume these
 * instead of re-deriving the logic inline.
 *
 * Rule zero applies throughout: every default reproduces the apex demo's
 * behavior exactly. A mount that passes nothing gets the side-by-side
 * comparison, the standard response mode, and two model arms per run.
 */

/** The two response modes the query form offers. */
export type QueryMode = 'standard' | 'notebook';

/**
 * How a mount presents the standard-mode result.
 *
 * - `'comparison'` — today's apex behavior: both arms run, side-by-side
 *   panels (stacked with the without-data panel demoted on mobile).
 * - `'answer-first'` — the `/ask` configuration (Q62 G0): the with-data
 *   answer is the page; the comparison is demoted to an expand option and
 *   the demoted runs make one model call, not two.
 */
export type QuerySurfacePresentation = 'comparison' | 'answer-first';

/**
 * Session-storage keys for the two sticky per-session choices. Both use
 * `sessionStorage` (not `localStorage`) on purpose: the stickiness is
 * per-session, mirroring the pre-existing response-mode control.
 */
export const MODE_STORAGE_KEY = 'civicaitools.notebookMode';
export const COMPARISON_STORAGE_KEY = 'civicaitools.showComparison';

/** Parse a stored response-mode choice; anything unrecognized is "no choice". */
export function parseStoredMode(raw: string | null): QueryMode | null {
  return raw === 'notebook' || raw === 'standard' ? raw : null;
}

/**
 * Parse the stored comparison-restore choice; anything unrecognized is
 * "no choice" (the mount's presentation decides).
 */
export function parseStoredComparison(raw: string | null): 'on' | 'off' | null {
  return raw === 'on' || raw === 'off' ? raw : null;
}

/**
 * The response mode the form is effectively in.
 *
 * The user's explicit, session-persisted choice (`chosen`) always wins over
 * the mount's default — a `/ask` visitor who switched to Standard stays on
 * Standard for the session even though that mount defaults to notebook.
 * When the executed-sandbox path is unavailable (`enabled: false`, i.e. the
 * visitor is not authenticated), the only runnable mode is `'standard'`,
 * whatever the mount or the stored choice says; the stored choice is
 * preserved for when it becomes available again.
 */
export function resolveEffectiveMode(opts: {
  enabled: boolean;
  chosen: QueryMode | null;
  defaultMode: QueryMode;
}): QueryMode {
  if (!opts.enabled) return 'standard';
  return opts.chosen ?? opts.defaultMode;
}

/**
 * Whether a standard-mode submit should run only the with-data arm.
 *
 * True only for an answer-first mount whose visitor has not restored the
 * comparison. On a comparison mount (the apex default) this is always
 * false — both arms run, exactly as today.
 */
export function shouldRunMcpOnly(
  presentation: QuerySurfacePresentation,
  comparisonRestored: boolean,
): boolean {
  return presentation === 'answer-first' && !comparisonRestored;
}

/**
 * Whether a streaming comparison run has produced everything it is going
 * to produce. A demoted (single-arm) run never receives a without-data
 * completion, so waiting on it would spin forever — the with-data arm is
 * the whole run. A two-arm run completes when both panels do, unchanged.
 *
 * Used by `useStreamingComparison` to settle `isLoading` and by
 * `QuerySurface` to gate the local-setup footnote (which used to assume
 * two panes).
 */
export function isComparisonRunComplete(
  mcpOnly: boolean,
  withoutMcpComplete: boolean,
  withMcpComplete: boolean,
): boolean {
  return withMcpComplete && (mcpOnly || withoutMcpComplete);
}
