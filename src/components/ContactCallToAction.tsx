import type { CSSProperties } from 'react';
import { EXPRESS_INTEREST_URL } from '@/lib/site-config';

/**
 * The contact call to action: one sentence and a "Get in touch" button to
 * `EXPRESS_INTEREST_URL`. Mounted on /project (under its "Contact us" heading)
 * and at the foot of the home page's positioning band; the sentence lives here
 * and nowhere else (UX-1 G0-2 (i), the wording as the owner ruled it,
 * 2026-11-03). The caller styles the block and the sentence for its surface.
 */
export default function ContactCallToAction({ style, textStyle }: { style?: CSSProperties; textStyle?: CSSProperties }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexWrap: 'wrap',
        ...style,
      }}
    >
      <p style={{ ...textStyle, flex: '1 1 320px', marginBottom: 0 }}>
        Interested in running this with your city&apos;s data, or learning about the verification standard behind it?
      </p>
      <a
        href={EXPRESS_INTEREST_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="ui-button ui-button-primary"
        style={{
          textDecoration: 'none',
          fontSize: '14px',
          padding: '10px 24px',
          whiteSpace: 'nowrap',
        }}
      >
        Get in touch
      </a>
    </div>
  );
}
