import Link from 'next/link';

/**
 * The record page's "View in Dashboard" link, shown to the record's creator.
 * Whether the viewer is the creator is decided by the page, on the server
 * (`sessionUserIsCreator`), and handed here as a boolean: this component
 * takes no account data.
 */
export default function DashboardLink({ isCreator }: { isCreator: boolean }) {
  if (!isCreator) return null;

  return (
    <div style={{ marginBottom: '4px' }}>
      <Link
        href="/dashboard"
        style={{
          fontSize: '13px',
          color: 'var(--accent)',
          textDecoration: 'none',
        }}
      >
        View in Dashboard &rarr;
      </Link>
    </div>
  );
}
