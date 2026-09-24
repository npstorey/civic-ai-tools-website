/**
 * The one-portal switch (#436): what a locked instance refuses, stated as pure
 * functions so the routes, the loop core and the tests share one reading.
 *
 * `SITE_PORTAL_LOCKED` (read by `isPortalLocked()` in `site-config.ts`) makes
 * the configured portal (`SITE_DEFAULT_PORTAL`) the only Socrata portal an
 * instance queries. The lock is enforced in two places, because a portal reaches a run
 * in two ways:
 *
 *   1. THE REQUEST. A query route resolves its run portal through
 *      `resolveRunPortal` (`site-config.ts`), which refuses a body naming a
 *      different portal (`PortalLockError`, reason `foreign_portal`, a 400 whose
 *      text names both portals) and refuses every request when the switch is on
 *      and no portal is configured (reason `portal_not_configured`).
 *   2. THE MODEL'S OWN CALLS. A request that named the right portal still hands
 *      the model a tool set whose `get_data` takes a `portal` argument and whose
 *      `fetch` takes identifiers that name their own portal. So the loop core
 *      (`run-tool-loop.ts`, option `lockedPortal`) refuses, as a rejected call,
 *      a call `portalOutsideLock` below says names another portal. The call is
 *      recorded, marked failed, never sent, and the model is told why through
 *      `describeToolFailureForLlm`.
 *
 * WHAT STAYS OUTSIDE THE LOCK, by ruling D7 (anchor #518):
 *   - `search`: it takes no portal argument and is answered by whichever portal
 *     the Socrata MCP server itself is configured for (`DATA_PORTAL_URL` there);
 *   - a `fetch` by a bare dataset id, which names no portal and resolves on the
 *     server the same way;
 *   - code the model writes into an executed notebook;
 *   - record replay, which derives its portal from the record it replays.
 * The other data sources (Data Commons, and Boston OpenContext, which fronts
 * the City of Boston's own portal) are separate servers with their own tools;
 * they take no Socrata portal argument, stay callable under the lock, and are
 * not governed by this switch (ruling D11).
 *
 * No Next.js imports and relative, extension-bearing imports only: this module
 * is loaded by the loop core under `node --test` and by client components.
 */

/** A portal hostname compared the way D1 rules: trimmed and lower-cased. */
export function normalizePortal(value: string): string {
  return value.trim().toLowerCase();
}

/** Why a locked instance refused a request. */
export type PortalLockReason = 'foreign_portal' | 'portal_not_configured';

/**
 * The operator-facing text of the unset refusal. Built from variable names
 * alone, so it is safe on a server log line; it is never sent to a reader,
 * who gets the generic copy instead (#436: no reader-copy kind of its own).
 */
export const PORTAL_LOCK_NOT_CONFIGURED_MESSAGE =
  'SITE_PORTAL_LOCKED is on, but SITE_DEFAULT_PORTAL is missing or empty in the server environment, so this instance has no Socrata portal to lock to ' +
  'and refuses every query rather than answer against a portal nobody configured. Set SITE_DEFAULT_PORTAL to the one Socrata portal this instance serves ' +
  '(a bare hostname), or turn SITE_PORTAL_LOCKED off, and restart the server.';

/**
 * A query route's refusal under the lock. Typed and check-and-return, like
 * `McpConfigurationError`: the resolver returns it and each route shapes its
 * own response from `status` and `reason`.
 *
 * `foreign_portal` is the CALLER's failure (400); its message names the portal
 * the request asked for and the one this instance serves, and it is returned
 * to the caller as is. `portal_not_configured` is the OPERATOR's failure
 * (503); its message names the variable, it goes to the server log only, and
 * the reader is sent the generic copy.
 */
export class PortalLockError extends Error {
  readonly reason: PortalLockReason;
  readonly status: 400 | 503;

  constructor(reason: PortalLockReason, message: string) {
    super(message);
    this.name = 'PortalLockError';
    this.reason = reason;
    this.status = reason === 'foreign_portal' ? 400 : 503;
  }
}

/**
 * The longest a requested portal is quoted back in a refusal: the length limit
 * of a DNS name. The request chose this text, so it is bounded rather than
 * echoed whole.
 */
const MAX_QUOTED_PORTAL = 253;

/** D1's refusal: the request named a portal this locked instance does not serve. */
export function foreignPortalError(requested: string, configured: string): PortalLockError {
  const quoted = requested.trim().slice(0, MAX_QUOTED_PORTAL);
  return new PortalLockError(
    'foreign_portal',
    `This instance queries one Socrata portal only, ${configured}, and this request named ${quoted}. ` +
      `Send the request with no portal, or with ${configured}.`,
  );
}

/** The unset refusal (see `PORTAL_LOCK_NOT_CONFIGURED_MESSAGE`). */
export function portalNotConfiguredError(): PortalLockError {
  return new PortalLockError('portal_not_configured', PORTAL_LOCK_NOT_CONFIGURED_MESSAGE);
}

// --- The model's own calls (D7) ----------------------------------------------

/**
 * The failure the loop core throws for a call the lock refused, before
 * anything is sent. The message is this app's own and names no portal; the
 * model is told what happened by `describeToolFailureForLlm`, which recognises
 * this class by its type, never by its words.
 *
 * The message deliberately matches none of `classifyStreamError`'s message
 * shapes, so the call is recorded with the failure kind `unknown`: the record
 * says a request was made and returned no data, which is true, and names no
 * cause it cannot state in its closed vocabulary.
 */
export class PortalLockedCallError extends Error {
  /** The one Socrata portal this instance serves — what the model is told to use instead. */
  readonly lockedPortal: string;

  constructor(lockedPortal: string) {
    super('This call names a Socrata portal other than the one this instance is locked to, so it was not sent.');
    this.name = 'PortalLockedCallError';
    this.lockedPortal = lockedPortal;
  }
}

/** A value the model put in a portal-bearing argument, as the server would read it; `null` when it named none. */
function portalValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = normalizePortal(String(value));
  return text.length > 0 ? text : null;
}

/** The hostname of a URL-shaped identifier, or `null` when it does not parse as one with a host. */
function urlHost(candidate: string): string | null {
  try {
    const host = new URL(candidate).hostname;
    return host ? host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * The portal a `fetch` identifier names, or `null` when it names none.
 *
 * Mirrors the order in which the Socrata MCP server reads an identifier
 * (`parseFetchIdentifier`, socrata-mcp-server `src/tools/socrata-tools.ts`):
 * a `dataset:<portal>:…` or `record:<portal>:…` prefix; then a URL, as given
 * or with `https://` prepended when it carries a path; then `<host>:<dataset>`
 * where the first part looks like a host. A bare dataset id, or
 * `<dataset>:<row>`, names no portal and the server resolves it against its
 * own configured portal — outside this lock (D7).
 *
 * Stricter than the server in one direction, on purpose: a URL whose path the
 * server would reject is still read for its host here, so a malformed
 * identifier naming another portal is refused before it leaves rather than
 * left to the server.
 */
export function portalNamedByFetchId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('dataset:') || trimmed.startsWith('record:')) {
    return portalValue(trimmed.split(':')[1]);
  }

  const host = urlHost(trimmed) ?? (trimmed.includes('/') ? urlHost(`https://${trimmed}`) : null);
  if (host) return host;

  const parts = trimmed.split(':');
  if (parts.length === 2 && (parts[0].includes('.') || parts[0].includes('localhost'))) {
    return portalValue(parts[0]);
  }
  return null;
}

/**
 * The portal a tool call names that differs from `lockedPortal`, or `null`
 * when the call names none or names the locked one.
 *
 *   - `get_data`: its `portal` argument AND its `domain` alias. The server
 *     resolves the pair as `domain || portal`, so either one naming another
 *     portal is where the call would go.
 *   - `fetch`: the portal its identifier names (`portalNamedByFetchId`).
 *   - every other tool: `null`. `search` takes no portal; the other sources'
 *     tools take no Socrata portal.
 *
 * Takes the call's argument record under its own name rather than reading it
 * off a recorded call, and reads it without changing it: the loop core records
 * and sends that same object.
 */
export function portalOutsideLock(
  toolName: string,
  callArguments: Record<string, unknown>,
  lockedPortal: string,
): string | null {
  const locked = normalizePortal(lockedPortal);
  const named: Array<string | null> =
    toolName === 'get_data'
      ? [portalValue(callArguments.portal), portalValue(callArguments.domain)]
      : toolName === 'fetch'
        ? [portalNamedByFetchId(callArguments.id)]
        : [];
  return named.find((portal): portal is string => portal !== null && portal !== locked) ?? null;
}
