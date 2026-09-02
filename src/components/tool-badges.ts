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
 * `search` is painted with the accent family, in design tokens by name
 * (`rgba(var(--accent-rgb), α)` is the sanctioned tint form — see
 * globals.css). The four entries above it predate the token rule and are
 * literal hex: `globals.css` defines no light/background variant of `--info`,
 * `--success` or `--caution`, no channel triplet for them, and no violet
 * token, so there is no token of matching role to name for them. They are
 * left as found and flagged (#384 P2).
 */

export const OP_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  catalog: { bg: '#EEF2FF', text: '#4338CA' },
  query: { bg: '#ECFEFF', text: '#0E7490' },
  metadata: { bg: '#FFFBEB', text: '#B45309' },
  metrics: { bg: '#F5F3FF', text: '#7C3AED' },
  search: { bg: 'rgba(var(--accent-rgb), 0.1)', text: 'var(--accent)' },
};

export const OP_BADGE_TOOLTIPS: Record<string, string> = {
  catalog: "Searching the portal's directory of available datasets",
  query: 'Running a structured query against the dataset — filtering and aggregating records',
  metadata: 'Reading the data dictionary — the list of columns and what each one contains',
  metrics: 'Fetching summary statistics about the dataset (row count, update frequency, etc.)',
  search: 'Searching a catalog of available data for this topic — what exists, before any of it is read',
};
