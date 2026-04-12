'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';

/**
 * Shows a "View in Dashboard" link if the logged-in user is the evidence creator.
 * Compares the session's GitHub ID against the creator's GitHub ID.
 */
export default function DashboardLink({ creatorGithubId }: { creatorGithubId: string }) {
  const { data: session } = useSession();

  if (!session?.user?.id || session.user.id !== creatorGithubId) {
    return null;
  }

  return (
    <Link
      href="/dashboard"
      style={{
        fontSize: '13px',
        color: 'var(--nyc-blue)',
        textDecoration: 'none',
      }}
    >
      View in Dashboard &rarr;
    </Link>
  );
}
