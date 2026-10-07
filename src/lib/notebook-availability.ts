/**
 * Whether this instance runs notebooks (#547; anchor #555, ruling G0-4 A).
 *
 * TYPED STUB. This file lands first so the tests that name its exports
 * type-check and fail at their assertions; every function here returns what
 * the code did before `EXECUTOR_DRIVER=none` existed. The next commit gives
 * them their behaviour.
 */

/** The `EXECUTOR_DRIVER` value that declares an instance runs no notebooks. */
export const EXECUTOR_DRIVER_NONE = 'none';

/** The `code` `POST /api/query-notebook` answers with under `EXECUTOR_DRIVER=none`. */
export const NOTEBOOKS_NOT_OFFERED_CODE = 'notebooks_not_offered';

/** The status of that answer. */
export const NOTEBOOKS_NOT_OFFERED_STATUS = 501;

/** The `error` text of that answer, for an API caller or an operator. */
export const NOTEBOOKS_NOT_OFFERED_MESSAGE =
  'This instance runs no notebooks (EXECUTOR_DRIVER=none), so /api/query-notebook is off. ' +
  'Ask through /api/compare-stream instead.';

/** What the query form says about notebook mode where it is off. */
export const NOTEBOOK_MODE_UNAVAILABLE_REASON =
  'Not offered on this site: it does not run notebooks, so questions are answered in standard mode.';

/** How the form offers notebook mode to one visitor. */
export type NotebookModeAffordance = 'toggle' | 'sign-in' | 'unavailable';

export interface NotebookRouteRefusal {
  status: number;
  body: { error: string; code: string };
}

/** STUB: every instance runs notebooks, as before. */
export function notebooksOffered(
  env: Record<string, string | undefined> = process.env,
): boolean {
  void env;
  return true;
}

/** STUB: the affordance follows sign-in alone, as before. */
export function notebookModeAffordance(opts: {
  signedIn: boolean;
  notebooksOffered: boolean;
}): NotebookModeAffordance {
  return opts.signedIn ? 'toggle' : 'sign-in';
}

/** STUB: the route never refuses on this ground, as before. */
export function notebookRouteRefusal(
  env: Record<string, string | undefined> = process.env,
): NotebookRouteRefusal | null {
  void env;
  return null;
}
