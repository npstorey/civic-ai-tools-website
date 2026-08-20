/**
 * The embeddable "verify independently" badge (civic-ai-tools-website#114).
 *
 * Per ADR-0013 / Q46, the full §9.2 per-check verification is delegated to the
 * neutral client-side verifier at typedstandards.org/verify — "don't trust the
 * publisher, verify independently" is far stronger when the verifier is not
 * hosted by the publisher. This is civicaitools.org's host-side rendering of the
 * cross-host badge specced in #116: a plain `<a><img>` (no third-party JS on the
 * page) that deep-links to the verifier with this package's commitment URL.
 *
 * THE LOAD-BEARING HONESTY CONSTRAINT (regression-locked in #116 Phase E): the
 * badge is a CALL TO ACTION, never a verdict. It carries no "verified" / green
 * check — a static claim the badge can't back and anyone could forge. The real
 * §9.2 verdict is computed in the reader's own browser on the neutral domain and
 * shown ONLY there. The badge SVG (served by typedstandards.org) enforces this;
 * this component only points at it.
 *
 * CALLER GATE: render this ONLY for records in the PUBLIC visibility state —
 * test it via `normalizeVisibility` (`@/lib/evidence/visibility`), never against
 * a raw label, since the column carries either vocabulary (ADR-0016 §A). The
 * verifier resolves a package through its `/commitment` sidecar, and a sealed
 * record's commitment is redacted of the package location (content is private),
 * so /verify would surface a missing-content alarm. Sealed support is tracked
 * separately (arch-gated); until then the badge is public-state-only.
 *
 * `commitmentUrl` is the absolute, publicly-fetchable commitment endpoint for
 * this package, resolved server-side from the request host so it is correct on
 * production AND preview deploys (and so there is no client-side window read /
 * hydration mismatch).
 */

const TYPEDSTANDARDS_VERIFY_BASE = 'https://typedstandards.org/verify';
const TYPEDSTANDARDS_BADGE_SVG = 'https://typedstandards.org/badge/typed-standards-verify.svg';
// Alt text is authored and rendered HERE, in this instance's own HTML — the
// remote asset is only the <img> src. So it is ours to excise (settlement
// ruling D5 defers only the text baked INTO the typedstandards.org SVG and
// that site's own badge copy, tracked at typedstandards#52).
const BADGE_ALT = 'Verify this record with Typed Standards';
const BADGE_WIDTH = 248;
const BADGE_HEIGHT = 30;

export default function VerifyBadge({ commitmentUrl }: { commitmentUrl: string }) {
  const verifyHref = `${TYPEDSTANDARDS_VERIFY_BASE}?url=${encodeURIComponent(commitmentUrl)}`;

  return (
    <div style={{ marginTop: '8px' }}>
      <a
        href={verifyHref}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'inline-block', lineHeight: 0 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- cross-origin,
            CORS-served, fixed-size badge asset from typedstandards.org; the
            Next image optimizer must not proxy/rewrite it. */}
        <img
          src={TYPEDSTANDARDS_BADGE_SVG}
          alt={BADGE_ALT}
          width={BADGE_WIDTH}
          height={BADGE_HEIGHT}
        />
      </a>
      {/* Plainly states what verification asserts — and what it does not (P1
          disclosure ≠ validation; trust-and-evidence.md; civic-ai-tools#63). */}
      <div
        style={{
          marginTop: '6px',
          fontSize: '12px',
          lineHeight: 1.45,
          color: 'var(--text-muted)',
          maxWidth: '440px',
        }}
      >
        Re-runs the integrity, signature, timestamp, and transparency-log checks
        in your own browser on a neutral site. It confirms how this analysis was
        recorded and that it has not changed — not that the analysis is correct.
      </div>
    </div>
  );
}
