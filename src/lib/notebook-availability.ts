/**
 * Whether this instance runs notebooks (#547; anchor #555, ruling G0-4 A).
 *
 * `EXECUTOR_DRIVER=none` declares an instance that runs no notebooks. An unset
 * driver is not that declaration: it resolves to `vercel-sandbox`
 * (`src/lib/sandbox/execute.ts`), so "no executor configured" is not something
 * the server can infer, and an instance says so with this value. Under it:
 *
 *   - the query form shows notebook mode unavailable, with the reason below,
 *     on every mount (`/ask` and the home page), signed in or not;
 *   - the form starts in standard mode, whatever the mount's default or the
 *     visitor's stored choice;
 *   - `POST /api/query-notebook` answers 501 with
 *     `code: "notebooks_not_offered"` before it reads the body, before any
 *     model call and before the rate limiter is charged;
 *   - if execution is reached anyway, `executeNotebook` refuses with an
 *     `ExecutorSettingError` naming `EXECUTOR_DRIVER`, before any driver loads.
 *
 * Unset, empty, and each of the three drivers change nothing here: every
 * function below returns what the code did before the value existed. An
 * unknown value also changes nothing here; the executor refuses it loudly at
 * the first run, as it always has.
 *
 * This module is read by the root layout (server) and by `QueryForm` (client),
 * so it imports nothing. Only `notebooksOffered` and `notebookRouteRefusal`
 * read the environment, and only on the server.
 */

/** The `EXECUTOR_DRIVER` value that declares an instance runs no notebooks. */
export const EXECUTOR_DRIVER_NONE = 'none';

/** The `code` `POST /api/query-notebook` answers with under `EXECUTOR_DRIVER=none`. */
export const NOTEBOOKS_NOT_OFFERED_CODE = 'notebooks_not_offered';

/**
 * The status of that answer: 501 Not Implemented. Not a 4xx, because the
 * caller did nothing wrong; not 503, because nothing is down and a retry
 * will not succeed; this instance does not offer the route's function.
 */
export const NOTEBOOKS_NOT_OFFERED_STATUS = 501;

/**
 * The `error` text of that answer, for an API caller or an operator. A browser
 * never shows it: `friendlyStreamError` maps a refused request to reader copy,
 * and this text avoids every word that copy's fallback matcher reads as an
 * outage (`src/lib/streaming.ts`, `classifyStreamError`), so a stale page that
 * meets it shows the generic copy rather than "the live data source is
 * temporarily unavailable".
 */
export const NOTEBOOKS_NOT_OFFERED_MESSAGE =
  'This instance runs no notebooks (EXECUTOR_DRIVER=none), so /api/query-notebook is off. ' +
  'Ask through /api/compare-stream instead.';

/** What the query form says about notebook mode where it is off. */
export const NOTEBOOK_MODE_UNAVAILABLE_REASON =
  'Not offered on this site: it does not run notebooks, so questions are answered in standard mode.';

/**
 * How the form offers notebook mode to one visitor:
 *   - `'toggle'`: the Standard / notebook control, as for any signed-in visitor;
 *   - `'sign-in'`: the prompt to sign in, as for any signed-out visitor;
 *   - `'unavailable'`: the control with the notebook option disabled and the
 *     reason beside it. Signing in would not turn it on, so it is not the
 *     sign-in prompt; and it is shown rather than hidden, so a visitor who
 *     used notebook mode elsewhere learns why it is not here.
 */
export type NotebookModeAffordance = 'toggle' | 'sign-in' | 'unavailable';

export interface NotebookRouteRefusal {
  status: number;
  body: { error: string; code: string };
}

/**
 * True unless `EXECUTOR_DRIVER` is `none`. Never throws: an unknown value is
 * the executor's refusal to make at the first run, and a layout that threw on
 * it would take every page down with it.
 */
export function notebooksOffered(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.EXECUTOR_DRIVER !== EXECUTOR_DRIVER_NONE;
}

/** The affordance for one visitor; see `NotebookModeAffordance`. */
export function notebookModeAffordance(opts: {
  signedIn: boolean;
  notebooksOffered: boolean;
}): NotebookModeAffordance {
  if (!opts.notebooksOffered) return 'unavailable';
  return opts.signedIn ? 'toggle' : 'sign-in';
}

/** The route's answer under `EXECUTOR_DRIVER=none`; null under every other value. */
export function notebookRouteRefusal(
  env: Record<string, string | undefined> = process.env,
): NotebookRouteRefusal | null {
  if (notebooksOffered(env)) return null;
  return {
    status: NOTEBOOKS_NOT_OFFERED_STATUS,
    body: { error: NOTEBOOKS_NOT_OFFERED_MESSAGE, code: NOTEBOOKS_NOT_OFFERED_CODE },
  };
}
