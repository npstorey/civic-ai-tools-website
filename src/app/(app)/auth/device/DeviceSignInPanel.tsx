'use client';

import { signIn } from 'next-auth/react';

interface DeviceSignInPanelProps {
  callbackUrl: string;
  prefilledUserCode: string;
}

export default function DeviceSignInPanel({
  callbackUrl,
  prefilledUserCode,
}: DeviceSignInPanelProps) {
  return (
    <div
      style={{
        padding: '20px',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
      }}
    >
      <p style={{ fontSize: '14px', marginBottom: '16px', lineHeight: 1.5 }}>
        Sign in with GitHub to review the authorization request
        {prefilledUserCode ? (
          <>
            {' '}for code <code style={{ fontWeight: 600 }}>{prefilledUserCode}</code>
          </>
        ) : null}
        .
      </p>
      <button
        onClick={() => signIn('github', { callbackUrl })}
        className="nyc-button nyc-button-primary"
        style={{ padding: '10px 18px', fontSize: '14px' }}
      >
        Sign in with GitHub
      </button>
    </div>
  );
}
