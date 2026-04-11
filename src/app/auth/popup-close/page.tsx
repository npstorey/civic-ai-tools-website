'use client';

import { useEffect } from 'react';

export default function PopupClosePage() {
  useEffect(() => {
    try {
      window.opener?.postMessage({ type: 'auth-complete' }, window.location.origin);
    } catch {
      // opener may be null if popup was opened from a different origin
    }
    window.close();
  }, []);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', fontSize: '16px', color: 'var(--text-secondary)',
    }}>
      Authentication complete, closing...
    </div>
  );
}
