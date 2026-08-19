'use client';

const CLAUSE_TOOLTIPS: Record<string, string> = {
  'SELECT': 'Chooses which columns to return — like picking which fields to show on a spreadsheet',
  'WHERE': 'Filters to only matching rows — like using a search filter to narrow results',
  'GROUP BY': 'Organizes rows into categories before counting or summing — like sorting mail into bins before tallying each bin',
  'ORDER BY': 'Sorts the results — like arranging a list from highest to lowest (or vice versa)',
  'LIMIT': 'Caps the number of rows returned — like asking for just the top 10 results',
};

interface SoqlDisplayProps {
  args: Record<string, unknown>;
}

export default function SoqlDisplay({ args }: SoqlDisplayProps) {
  const clauses: { keyword: string; value: string }[] = [];

  const select = args.select as string | undefined;
  const where = args.where as string | undefined;
  const group = args.group as string | undefined;
  const order = args.order as string | undefined;
  const limit = args.limit as number | undefined;

  if (select) clauses.push({ keyword: 'SELECT', value: select });
  if (where) clauses.push({ keyword: 'WHERE', value: where });
  if (group) clauses.push({ keyword: 'GROUP BY', value: group });
  if (order) clauses.push({ keyword: 'ORDER BY', value: order });
  if (limit) clauses.push({ keyword: 'LIMIT', value: String(limit) });

  if (clauses.length === 0) return null;

  return (
    <div
      style={{
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: '1.6',
        backgroundColor: 'var(--card-background)',
        borderRadius: '4px',
        padding: '8px 12px',
        overflowX: 'auto',
      }}
    >
      {clauses.map((clause, idx) => (
        <div key={idx} style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span
            data-tooltip={CLAUSE_TOOLTIPS[clause.keyword]}
            style={{
              fontWeight: 700,
              color: 'var(--accent)',
              cursor: 'help',
              position: 'relative',
              whiteSpace: 'nowrap',
            }}
          >
            {clause.keyword}
          </span>
          <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
            {clause.value}
          </span>
        </div>
      ))}
    </div>
  );
}
