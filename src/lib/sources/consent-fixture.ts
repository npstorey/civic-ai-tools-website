/**
 * A consent cookie for the route-driven test suites (R6 W2, #632): since W2
 * every route that sends a question refuses one with no consent in force, so a
 * suite that drives such a route for another reason gives it a consent first,
 * as a browser that had answered the consent card would. Built by the real
 * encoder against the statement in force under the process's configuration
 * AT THE MOMENT OF THE CALL (a suite that points the model endpoint at a fresh
 * loopback port has a different model host, and so a different statement, per
 * drive), with no analytics configured.
 *
 * Not a double: it answers nothing and stubs nothing. No application module
 * imports it.
 */
import { buildFlowsStatementFor } from '../flows/statement.ts';
import { CONSENT_COOKIE_NAME, encodeConsentCookie, type SourceState } from './consent.ts';

/** `Cookie` header value: every configured source On (D6's first consent), unless `states` says otherwise. */
export function consentCookieForTests(states?: Readonly<Record<string, SourceState>>): string {
  const statement = buildFlowsStatementFor(null);
  const given = states ?? Object.fromEntries(statement.sources.map((source) => [source.sourceId, 'on' as const]));
  const value = encodeConsentCookie({
    v: 1,
    flows: statement.version,
    states: Object.fromEntries(
      Object.entries(given).map(([id, state]) => [
        id,
        { state, since: '2026-10-19', version: statement.sources.find((source) => source.sourceId === id)?.version ?? 'f'.repeat(64) },
      ]),
    ),
  });
  return `${CONSENT_COOKIE_NAME}=${value}`;
}
