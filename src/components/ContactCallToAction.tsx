import type { CSSProperties } from 'react';
import { EXPRESS_INTEREST_URL } from '@/lib/site-config';

/**
 * The contact call to action: one sentence and a "Get in touch" button to
 * `EXPRESS_INTEREST_URL`. Mounted on /project (under its "Contact us" heading)
 * with its sentence, and at the foot of the home page's band as the button
 * alone (`buttonOnly`; UX-2 P10-9, outline B). The sentence lives here and
 * nowhere else (UX-1 G0-2 (i), the wording as the owner ruled it, 2026-11-03).
 * The caller styles the block and the sentence for its surface.
 */
export default function ContactCallToAction({
  style,
  textStyle,
  buttonOnly = false,
}: {
  style?: CSSProperties;
  textStyle?: CSSProperties;
  buttonOnly?: boolean;
}) {
  const button = (
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
  );
  if (buttonOnly) return button;
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
      {button}
    </div>
  );
}
