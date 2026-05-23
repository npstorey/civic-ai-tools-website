'use client';

/**
 * Phase 2a1 — Signers + attestations placeholder beneath the A-G output.
 *
 * Two sections rendered:
 *   - Signers — lists the cryptographic signers attached to this output. For
 *     executed-notebook responses, only the platform signer (civicaitools.org)
 *     applies at chat time; publisher / host endorsement signers (per the
 *     typed-standards-proposal §2 capture-method discipline) are scaffolded
 *     but empty until those signing tiers exist.
 *   - Production method — the captureMethod-discipline labeling applied to
 *     user-facing language: "Executed in signed sandbox" matches the toggle
 *     label's past-tense form, signaling what actually happened.
 *   - Attestations — placeholder framing ("none yet"); attestations attach
 *     after publish, so chat-time output never carries them.
 *
 * Honest framing: this section describes process (disclosure), not truth
 * (validation). See `docs/design-principles.md` Principle 1.
 */

interface ChatSignersSectionProps {
  /** Stamped at Phase D from the sandbox; informational, not a trust claim. */
  executedAt: string | null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '24px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '10px', color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function SignerRow({
  label,
  detail,
  tier,
}: {
  label: string;
  detail: string;
  tier: 'platform' | 'publisher' | 'host';
}) {
  const tierLabels: Record<string, string> = {
    platform: 'platform signer',
    publisher: 'publisher signer',
    host: 'host endorsement',
  };
  return (
    <div style={{
      padding: '10px 14px', border: '1px solid var(--border-color)',
      borderRadius: '4px', display: 'flex', alignItems: 'flex-start', gap: '12px',
    }}>
      <span aria-hidden style={{
        marginTop: '3px', flexShrink: 0,
        width: '8px', height: '8px', borderRadius: '50%',
        background: 'var(--nyc-success, #00b703)',
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
          {label}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {tierLabels[tier]} · {detail}
        </div>
      </div>
    </div>
  );
}

function EmptyTierRow({ tier }: { tier: 'publisher' | 'host' }) {
  const tierLabels: Record<string, string> = {
    publisher: 'publisher signer',
    host: 'host endorsement',
  };
  const tierHints: Record<string, string> = {
    publisher: 'attaches when the user publishes this analysis under their identity',
    host: 'attaches when an upstream host (e.g., a data steward) co-signs',
  };
  return (
    <div style={{
      padding: '10px 14px', border: '1px dashed var(--border-color)',
      borderRadius: '4px', display: 'flex', alignItems: 'flex-start', gap: '12px',
      opacity: 0.7,
    }}>
      <span aria-hidden style={{
        marginTop: '3px', flexShrink: 0,
        width: '8px', height: '8px', borderRadius: '50%',
        background: 'var(--border-color)',
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
          No {tierLabels[tier]} yet
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {tierHints[tier]}
        </div>
      </div>
    </div>
  );
}

export default function ChatSignersSection({ executedAt }: ChatSignersSectionProps) {
  return (
    <>
      <Section title="Signed by">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <SignerRow
            label="civicaitools.org"
            detail={executedAt
              ? `signed Ed25519 at ${new Date(executedAt).toLocaleString()}`
              : 'signs Ed25519 at publish time'}
            tier="platform"
          />
          <EmptyTierRow tier="publisher" />
          <EmptyTierRow tier="host" />
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px', lineHeight: 1.5 }}>
          Signatures describe <em>who attached their key</em>, not whether the
          analysis is correct. The platform signer attaches at execution
          time; other signers attach if the publisher or an upstream host
          chooses to co-sign.
        </p>
      </Section>

      <Section title="Production method">
        <div style={{
          padding: '10px 14px', border: '1px solid var(--border-color)',
          borderRadius: '4px', fontSize: '14px', color: 'var(--text-primary)',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '22px', height: '22px', borderRadius: '50%',
            background: 'rgba(16, 63, 239, 0.1)', color: 'var(--nyc-blue, #0039a6)',
            fontSize: '11px', fontWeight: 700,
          }}>↻</span>
          <div>
            <div style={{ fontWeight: 500 }}>Executed in signed sandbox</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Notebook authored, executed, and stamped by the publisher
              pipeline; outputs derive from real cell execution against live
              upstream data.
            </div>
          </div>
        </div>
      </Section>

      <Section title="Attestations">
        <div style={{
          padding: '12px 16px', border: '1px dashed var(--border-color)',
          borderRadius: '6px', background: 'var(--card-background)',
          fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6,
        }}>
          <div style={{ marginBottom: '4px', fontWeight: 500, color: 'var(--text-primary)' }}>
            None yet
          </div>
          Attestations from other parties — corroborations, contradictions,
          expert evaluations — would appear here once attached. Attestations
          are added after publish; chat-time output never carries them.
        </div>
      </Section>
    </>
  );
}
