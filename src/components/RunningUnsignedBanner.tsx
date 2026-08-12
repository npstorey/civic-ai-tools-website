import { resolveUnsignedIndicator } from '@/lib/evidence/unsigned-tier';

const SETUP_GUIDE_URL =
  'https://github.com/npstorey/civic-ai-tools-website/blob/main/docs/instance-setup.md';

/**
 * Running-unsigned indicator (S3a P3, #166; ADR-0020 §Consequences: "a
 * running-unsigned indicator/banner shows outside a dev environment").
 *
 * Server component: renders a site-wide amber strip under the header when
 * this instance cannot sign. Two reasons, two messages:
 *
 *   - no signing key — the unsigned tier, a legitimate state; shown outside a
 *     dev environment so "stayed unsigned" is never a SILENT choice.
 *   - a signing key but no `EVIDENCE_KEY_ID` — a misconfiguration, shown in
 *     every environment including dev, because it is not an intended state
 *     anywhere and dev is where it should be caught.
 *
 * Note: on statically prerendered pages the condition is evaluated with the
 * build-time environment; on dynamic routes, at request time. Both reflect
 * the deploy's configuration.
 */
export default function RunningUnsignedBanner() {
  const reason = resolveUnsignedIndicator();
  if (reason === null) return null;

  if (reason === 'no_key_id') {
    return (
      <div
        role="status"
        style={{
          backgroundColor: 'rgba(255, 179, 32, 0.15)',
          borderBottom: '1px solid var(--nyc-caution, #FFB320)',
          padding: '8px 24px',
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--text-primary)',
          textAlign: 'center',
        }}
      >
        <strong>Signing is half-configured</strong> — this instance has a
        signing key but no <code>EVIDENCE_KEY_ID</code>, so seal and publish
        are refused. It will not sign under a key id it never declared:
        evidence labeled with another deployment&rsquo;s key id cannot verify
        and misattributes the publisher. Set <code>EVIDENCE_KEY_ID</code> to
        your trust registry&rsquo;s active kid — see the{' '}
        <a
          href={SETUP_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'underline' }}
        >
          instance setup guide
        </a>
        .
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{
        backgroundColor: 'rgba(255, 179, 32, 0.15)',
        borderBottom: '1px solid var(--nyc-caution, #FFB320)',
        padding: '8px 24px',
        fontSize: '13px',
        lineHeight: 1.5,
        color: 'var(--text-primary)',
        textAlign: 'center',
      }}
    >
      <strong>Running unsigned</strong> — no signing key is configured, so
      evidence seal and publish are disabled and any output produced here
      carries no cryptographic commitment. Signing is the go-to-production
      step; see the{' '}
      <a
        href={SETUP_GUIDE_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: 'underline' }}
      >
        instance setup guide
      </a>
      .
    </div>
  );
}
