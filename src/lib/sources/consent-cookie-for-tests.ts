/**
 * A consent cookie for the route-driving test suites (R6 W3, #632, stage-B
 * ruling (d)). Since W3 the consent gate is on, so a suite that drives a
 * gated route to measure something else (its record, its logs, its census)
 * sends a consent in force, as a reader who answered the card would. Built by
 * the real encoder against the statement in force at the moment of the call,
 * as `src/app/api/consent-gate-driven.test.ts`'s `cookieValue` builds it.
 *
 * Not a test itself, and nothing in the app imports it (the precedent is
 * `src/components/publish-dialog-test-harness.ts`). It sets no cookie on any
 * response: it builds the `Cookie` request header a browser would send.
 *
 * THE STATEMENT is `buildFlowsStatementFor(null)`: the one the gate reads
 * when no analytics variable is set, which is every suite that uses this. A
 * suite that configures analytics passes the statement it built itself.
 */
import { buildFlowsStatementFor, type FlowsStatement } from '../flows/statement.ts';
import { CONSENT_COOKIE_NAME, consentDate, encodeConsentCookie, type SourceState } from './consent.ts';

/** `civic-source-consent=<value>`: every configured source On, unless `states` says otherwise. */
export function consentCookieForTests(states: Record<string, SourceState> = {}, statement: FlowsStatement = buildFlowsStatementFor(null)): string {
  const value = encodeConsentCookie({
    v: 1,
    flows: statement.version,
    states: Object.fromEntries(
      statement.sources.map((s) => [s.sourceId, { state: states[s.sourceId] ?? 'on', since: consentDate(), version: s.version }]),
    ),
  });
  return `${CONSENT_COOKIE_NAME}=${value}`;
}
