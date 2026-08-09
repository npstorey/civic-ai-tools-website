'use client';

/**
 * Phase 2a1 — Signers + attestations placeholder beneath the A-G output.
 * Phase 2a2 item 4 (Option A): the platform signer row is reframed to be
 * honest about pre-publish state. The signature does not yet exist; it is
 * created at publish time by /api/evidence after the user signs in and
 * triggers publish. The chat-time output carries execution metadata
 * (`executedAt`, environment, sandboxId) but those are captured, not
 * signed. Option B (formalizing execution-time signing as a real signature
 * event) is deferred to a separate ADR + IMPL phase post-G3 — the
 * location-as-attestation work is the architectural prerequisite.
 *
 * Two sections rendered:
 *   - Signed by — pre-publish: dashed border + italic copy + key id
 *     "will sign at publish time." Post-publish (detail page), the
 *     equivalent renders a solid-border "signed Ed25519ph at <date>" row.
 *   - Production method — captureMethod-discipline labeling ("Executed in
 *     signed sandbox"; per ADR-0004 § captureMethod label).
 *   - Attestations — placeholder framing ("none yet"); attestations attach
 *     after publish.
 *
 * Honest framing: this section describes process (disclosure), not truth
 * (validation). See `docs/design-principles.md` Principle 1.
 */

interface ChatSignersSectionProps {
  /** Stamped at Phase D from the sandbox; informational, not a trust claim. */
  executedAt: string | null;
  /** Phase 2a2 item 4: active platform key id from the SSE metadata event.
   *  Surfaced in the pre-publish signer copy so the reader knows which key
   *  the eventual signature will be anchored under. */
  signingKeyId?: string | null;
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

/** Phase 2a2 item 4: pre-publish signer row. Visually distinct from the
 *  post-publish equivalent (dashed border, dimmed dot, italic copy) so the
 *  reader can tell at a glance that the signature is pending, not real. */
function PlatformPendingSignerRow({
  signingKeyId,
  executedAt,
}: {
  signingKeyId: string | null;
  executedAt: string | null;
}) {
  const keyIdLabel = signingKeyId ?? 'platform key (will resolve at publish)';
  const executedAtLabel = executedAt
    ? `Execution captured ${new Date(executedAt).toLocaleString()}`
    : null;
  return (
    <div
      style={{
        padding: '10px 14px',
        border: '1px dashed var(--border-color)',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        background: 'rgba(var(--accent-rgb), 0.02)',
      }}
    >
      <span aria-hidden style={{
        marginTop: '3px', flexShrink: 0,
        width: '8px', height: '8px', borderRadius: '50%',
        background: 'var(--border-color)',
      }} />
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)',
          display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
        }}>
          <span>civicaitools.org</span>
          <span
            style={{
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em',
              textTransform: 'uppercase',
              padding: '1px 6px', borderRadius: '999px',
              background: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--nyc-blue)',
            }}
          >
            Pre-publish preview
          </span>
        </div>
        <div style={{
          fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px',
          fontStyle: 'italic', lineHeight: 1.5,
        }}>
          Platform signature will be created at publish time
          (Ed25519ph; key id <code style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
            background: 'transparent', padding: '0 2px',
          }}>{keyIdLabel}</code>). The notebook execution
          metadata (executedAt, environment, sandboxId) is captured now but
          is not yet cryptographically signed.
        </div>
        {executedAtLabel && (
          <div style={{
            fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px',
          }}>
            {executedAtLabel} (informational).
          </div>
        )}
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

export default function ChatSignersSection({ executedAt, signingKeyId }: ChatSignersSectionProps) {
  return (
    <>
      <Section title="Signed by">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <PlatformPendingSignerRow signingKeyId={signingKeyId ?? null} executedAt={executedAt} />
          <EmptyTierRow tier="publisher" />
          <EmptyTierRow tier="host" />
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px', lineHeight: 1.5 }}>
          Signatures describe <em>who attached their key</em>, not whether the
          analysis is correct. The platform signer attaches at publish time;
          other signers attach if the publisher or an upstream host chooses
          to co-sign.
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
            background: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--nyc-blue)',
            fontSize: '11px', fontWeight: 700,
          }}>↻</span>
          <div>
            <div style={{ fontWeight: 500 }}>Executed in signed sandbox</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Notebook authored, executed, and stamped by the publisher
              pipeline; outputs derive from real cell execution against live
              upstream data. The signed envelope is created at publish time.
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
