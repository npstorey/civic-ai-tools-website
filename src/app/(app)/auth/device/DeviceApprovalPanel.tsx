'use client';

import { useCallback, useEffect, useState } from 'react';

interface LookupResponse {
  userCode: string;
  clientName: string;
  scope: string;
  expiresAt: string;
}

interface ApproveResponse {
  ok: true;
  decision: 'approve' | 'deny';
  clientName?: string;
  scope?: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'looking_up'; userCode: string }
  | { kind: 'confirm'; info: LookupResponse }
  | { kind: 'approving'; info: LookupResponse }
  | { kind: 'approved'; info: LookupResponse }
  | { kind: 'denied'; info: LookupResponse }
  | { kind: 'error'; message: string };

interface DeviceApprovalPanelProps {
  initialUserCode: string;
}

const panelStyle: React.CSSProperties = {
  padding: '20px',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  marginBottom: '16px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  marginBottom: '6px',
  color: 'var(--text-primary)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  fontSize: '16px',
  fontFamily: 'monospace',
  boxSizing: 'border-box',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const buttonPrimary: React.CSSProperties = {
  padding: '10px 18px',
  border: 'none',
  borderRadius: '4px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  backgroundColor: 'var(--accent)',
  color: 'white',
};

const buttonDanger: React.CSSProperties = {
  ...buttonPrimary,
  backgroundColor: 'var(--error)',
};

const buttonSecondary: React.CSSProperties = {
  padding: '10px 18px',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  fontSize: '14px',
  cursor: 'pointer',
  backgroundColor: 'white',
  color: 'var(--text-secondary)',
};

export default function DeviceApprovalPanel({
  initialUserCode,
}: DeviceApprovalPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [inputCode, setInputCode] = useState(initialUserCode);

  const lookup = useCallback(async (userCode: string) => {
    setPhase({ kind: 'looking_up', userCode });
    try {
      const res = await fetch(
        `/api/auth/device/lookup?user_code=${encodeURIComponent(userCode)}`,
      );
      if (res.status === 404) {
        setPhase({
          kind: 'error',
          message: 'That code is not valid. Ask the client to start over.',
        });
        return;
      }
      if (res.status === 410) {
        setPhase({
          kind: 'error',
          message: 'That code has expired. Ask the client to start over.',
        });
        return;
      }
      if (res.status === 409) {
        setPhase({
          kind: 'error',
          message: 'That code has already been used.',
        });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Lookup failed' }));
        setPhase({
          kind: 'error',
          message: body.error || 'Lookup failed. Try again.',
        });
        return;
      }
      const info = (await res.json()) as LookupResponse;
      setPhase({ kind: 'confirm', info });
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Lookup failed',
      });
    }
  }, []);

  useEffect(() => {
    if (!initialUserCode) return;
    // Defer to a microtask so the initial setState in `lookup` isn't
    // synchronous with the render/effect cycle (avoids the
    // set-state-in-effect lint rule and keeps the mount render clean).
    const id = setTimeout(() => {
      void lookup(initialUserCode);
    }, 0);
    return () => clearTimeout(id);
  }, [initialUserCode, lookup]);

  const submitCode = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const cleaned = inputCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (cleaned.length !== 8) {
        setPhase({
          kind: 'error',
          message: 'Enter the 8-character code shown by your client.',
        });
        return;
      }
      const formatted = `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
      void lookup(formatted);
    },
    [inputCode, lookup],
  );

  const act = useCallback(
    async (info: LookupResponse, decision: 'approve' | 'deny') => {
      setPhase({ kind: 'approving', info });
      try {
        const res = await fetch('/api/auth/device/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_code: info.userCode, decision }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Action failed' }));
          setPhase({ kind: 'error', message: body.error || 'Action failed' });
          return;
        }
        const result = (await res.json()) as ApproveResponse;
        setPhase({
          kind: result.decision === 'approve' ? 'approved' : 'denied',
          info,
        });
      } catch (err) {
        setPhase({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Action failed',
        });
      }
    },
    [],
  );

  if (phase.kind === 'approved') {
    return (
      <div style={panelStyle}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
          Approved
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <strong>{phase.info.clientName}</strong> is now authorized with scope{' '}
          <code>{phase.info.scope}</code>. Return to your client — it should
          receive a bearer token within a few seconds.
        </p>
      </div>
    );
  }

  if (phase.kind === 'denied') {
    return (
      <div style={panelStyle}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
          Denied
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          The request from <strong>{phase.info.clientName}</strong> was denied.
          The device code has been invalidated.
        </p>
      </div>
    );
  }

  if (phase.kind === 'confirm' || phase.kind === 'approving') {
    const info = phase.info;
    const busy = phase.kind === 'approving';
    return (
      <div style={panelStyle}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>
          Authorize this client?
        </h2>
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', fontSize: '13px', marginBottom: '8px' }}>
            <span
              style={{
                width: '120px',
                color: 'var(--text-muted)',
              }}
            >
              Client
            </span>
            <strong>{info.clientName}</strong>
          </div>
          <div style={{ display: 'flex', fontSize: '13px', marginBottom: '8px' }}>
            <span style={{ width: '120px', color: 'var(--text-muted)' }}>Scope</span>
            <code>{info.scope}</code>
          </div>
          <div style={{ display: 'flex', fontSize: '13px', marginBottom: '8px' }}>
            <span style={{ width: '120px', color: 'var(--text-muted)' }}>Code</span>
            <code style={{ letterSpacing: '0.08em' }}>{info.userCode}</code>
          </div>
          <div style={{ display: 'flex', fontSize: '13px' }}>
            <span style={{ width: '120px', color: 'var(--text-muted)' }}>
              Expires
            </span>
            <span>{new Date(info.expiresAt).toLocaleString()}</span>
          </div>
        </div>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--text-muted)',
            lineHeight: 1.5,
            marginBottom: '20px',
          }}
        >
          Approving will mint a bearer token valid for 90 days that can publish
          records on your behalf. You can revoke it anytime from the dashboard.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => act(info, 'approve')}
            disabled={busy}
            style={{ ...buttonPrimary, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Approving...' : 'Approve'}
          </button>
          <button
            onClick={() => act(info, 'deny')}
            disabled={busy}
            style={{ ...buttonDanger, opacity: busy ? 0.6 : 1 }}
          >
            Deny
          </button>
        </div>
      </div>
    );
  }

  // Idle / looking_up / error → show the code-entry form.
  return (
    <div style={panelStyle}>
      <form onSubmit={submitCode}>
        <label htmlFor="user-code" style={labelStyle}>
          User code
        </label>
        <input
          id="user-code"
          type="text"
          autoComplete="off"
          autoFocus
          value={inputCode}
          placeholder="ABCD-EFGH"
          onChange={(e) => setInputCode(e.target.value)}
          style={inputStyle}
        />
        {phase.kind === 'error' ? (
          <div
            style={{
              marginTop: '8px',
              fontSize: '13px',
              color: 'var(--error)',
            }}
          >
            {phase.message}
          </div>
        ) : null}
        <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
          <button
            type="submit"
            disabled={phase.kind === 'looking_up'}
            style={{
              ...buttonPrimary,
              opacity: phase.kind === 'looking_up' ? 0.6 : 1,
            }}
          >
            {phase.kind === 'looking_up' ? 'Looking up...' : 'Continue'}
          </button>
          {phase.kind === 'error' ? (
            <button
              type="button"
              onClick={() => {
                setPhase({ kind: 'idle' });
                setInputCode('');
              }}
              style={buttonSecondary}
            >
              Clear
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
