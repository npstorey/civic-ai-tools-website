import { shouldShowRunningUnsignedIndicator } from '@/lib/evidence/unsigned-tier';

/**
 * Running-unsigned indicator (S3a P3, #166; ADR-0020 §Consequences: "a
 * running-unsigned indicator/banner shows outside a dev environment").
 *
 * Server component: renders a site-wide amber strip under the header when
 * this instance has no signing key configured AND is not running in a dev
 * environment. Dev stays calm — the unsigned tier is the intended first-run
 * state there. The banner is what keeps "stayed unsigned" a legitimate but
 * never SILENT choice (guard against silent opt-out).
 *
 * Note: on statically prerendered pages the condition is evaluated with the
 * build-time environment; on dynamic routes, at request time. Both reflect
 * the deploy's configuration.
 */
export default function RunningUnsignedBanner() {
  if (!shouldShowRunningUnsignedIndicator()) return null;

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
      evidence commit and publish are disabled and any output produced here
      carries no cryptographic commitment. Signing is the go-to-production
      step; see the{' '}
      <a
        href="https://github.com/npstorey/civic-ai-tools-website/blob/main/docs/instance-setup.md"
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
