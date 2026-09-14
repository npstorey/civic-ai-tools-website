/**
 * The portals a notebook cover names (Wave N11 #434 F-W, ruling D3).
 *
 * THE DEFECT. Both notebook generators collected the cover's portal line from
 * EVERY tool call's `args.portal`, refused or answered. A run whose only call
 * to a second portal was refused therefore shipped a notebook — a signed
 * extension of the record — whose cover listed that portal beside the one the
 * data came from, as if both had been reached. And when every portal-naming
 * call was refused, the list was still non-empty, so neither generator fell
 * back; but had it been filtered naively, both would have fallen back to the
 * run's or the default portal and named a portal NO call reached.
 *
 * THE RULE, one function for both generators so the two covers cannot
 * disagree about one run (docs/design-principles.md, the corollary on one
 * disclosure level in both documents):
 *   - `reached`: every portal an answered call named, in first-seen order.
 *   - `refusedOnly`: every portal that only refused calls named, in first-seen
 *     order. A portal both an answered and a refused call named is `reached`.
 *   - The fallback (the run's or the configured default portal) is used only
 *     when NO call named a portal at all — never when every naming call was
 *     refused.
 *
 * The chat surface's copy header (`McpResponseDisplay.tsx`, #384 P8 F2) and the
 * narrative formatters in `streaming.ts` already drop refused calls before
 * reading a portal; they do not list refused-only portals, and are classified
 * as such in `src/lib/portal-lists-name-no-refused-portal-as-reached.test.ts`.
 *
 * Pure, with no imports: `notebook.ts` is bundled into the client.
 */

export interface CoverPortalCall {
  args: Record<string, unknown>;
  failed?: boolean;
}

export interface CoverPortals {
  /** Portals an answered call named, or the fallback when no call named one. */
  reached: string[];
  /** Portals only refused calls named. */
  refusedOnly: string[];
}

export function coverPortals(
  calls: readonly CoverPortalCall[],
  fallback: string | null | undefined,
): CoverPortals {
  const reached: string[] = [];
  const refused: string[] = [];
  for (const call of calls) {
    const portal = call.args.portal;
    if (typeof portal !== 'string' || portal.length === 0) continue;
    const list = call.failed === true ? refused : reached;
    if (!list.includes(portal)) list.push(portal);
  }
  const refusedOnly = refused.filter((p) => !reached.includes(p));
  if (reached.length === 0 && refusedOnly.length === 0 && fallback) reached.push(fallback);
  return { reached, refusedOnly };
}

/**
 * The cover's portal lines, as markdown lines each ending in a hard break and
 * no newline. None when there is nothing to name — honest omission, as before.
 */
export function coverPortalLines(portals: CoverPortals): string[] {
  const lines: string[] = [];
  if (portals.reached.length > 0) {
    lines.push(`**Portal${portals.reached.length > 1 ? 's' : ''}:** ${portals.reached.join(', ')}  `);
  }
  if (portals.refusedOnly.length > 0) {
    lines.push(
      `**Portal${portals.refusedOnly.length > 1 ? 's' : ''} with every request refused:** ` +
        `${portals.refusedOnly.join(', ')}  `,
    );
  }
  return lines;
}
