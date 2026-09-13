/**
 * The operation-type badge on a tool-call card (`ToolCallCard.tsx`): a colour
 * pair and a one-line tooltip per operation type the record can carry. A
 * `.ts` sibling rather than module-private constants in the component, so the
 * badge table can be read by a test without rendering JSX (#384).
 *
 * Keys are operation types as `deriveOperationType` (mcp/operation-types.ts)
 * yields them. An operation type with no entry here renders with the card's
 * neutral fallback and no tooltip — absence, not a borrowed sentence — and a
 * call the record does not type at all (`fetch`, by design) never reaches
 * this table.
 *
 * EVERY ENTRY IS PAINTED BY TOKEN NAME. `search` takes the accent family;
 * the other four take the `--op-*` operation-role family, each a hue plus its
 * channel triplet, so a background is `rgba(var(--op-*-rgb), α)` and its text
 * `var(--op-*)` — the sanctioned tint form (see globals.css).
 *
 * This docstring used to say the opposite, and the reason it gave was true
 * when it was written: globals.css defined no light/background variant of the
 * status colors, no channel triplet for them, and no violet token, so the four
 * entries were left as literal hex and flagged (#384 P2). #405 (Wave N11,
 * ruling D2) added the role family they needed. The status colors were NOT
 * reused for them: `catalog`, `query`, `metadata` and `metrics` say what a
 * request did, not how it went, and a `--caution` badge on a call that
 * succeeded would claim something the record does not
 * (docs/design-principles.md, Principle 1).
 */

export const OP_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  catalog: { bg: 'rgba(var(--op-catalog-rgb), 0.1)', text: 'var(--op-catalog)' },
  query: { bg: 'rgba(var(--op-query-rgb), 0.1)', text: 'var(--op-query)' },
  metadata: { bg: 'rgba(var(--op-metadata-rgb), 0.1)', text: 'var(--op-metadata)' },
  metrics: { bg: 'rgba(var(--op-metrics-rgb), 0.1)', text: 'var(--op-metrics)' },
  search: { bg: 'rgba(var(--accent-rgb), 0.1)', text: 'var(--accent)' },
};

export const OP_BADGE_TOOLTIPS: Record<string, string> = {
  catalog: "Searching the portal's directory of available datasets",
  query: 'Running a structured query against the dataset — filtering and aggregating records',
  metadata: 'Reading the data dictionary — the list of columns and what each one contains',
  metrics: 'Fetching summary statistics about the dataset (row count, update frequency, etc.)',
  search: 'Searching a catalog of available data for this topic — what exists, before any of it is read',
};
