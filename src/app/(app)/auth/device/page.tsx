import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { normalizeUserCode } from '@/lib/device-flow';
import DeviceApprovalPanel from './DeviceApprovalPanel';
import DeviceSignInPanel from './DeviceSignInPanel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Authorize device - Civic AI Tools',
  description: 'Authorize a CLI or external client to publish evidence on your behalf.',
};

interface PageProps {
  searchParams: Promise<{ user_code?: string }>;
}

export default async function DeviceAuthPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  const { user_code: rawCode } = await searchParams;
  const normalized = normalizeUserCode(rawCode ?? '');

  const callbackUrl = normalized
    ? `/auth/device?user_code=${encodeURIComponent(normalized)}`
    : '/auth/device';

  return (
    <div style={{ maxWidth: '520px', margin: '0 auto', padding: '48px 24px 64px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>
        Authorize device
      </h1>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-muted)',
          marginBottom: '24px',
          lineHeight: 1.5,
        }}
      >
        A CLI or external client is requesting permission to publish evidence on
        your behalf. Review the details below and approve only if you initiated
        this request.
      </p>

      {session?.user?.id ? (
        <DeviceApprovalPanel initialUserCode={normalized} />
      ) : (
        <DeviceSignInPanel callbackUrl={callbackUrl} prefilledUserCode={normalized} />
      )}
    </div>
  );
}
