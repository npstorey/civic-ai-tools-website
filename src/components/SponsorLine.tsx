import { SPONSOR } from '@/lib/site-config';

/**
 * Sponsor acknowledgment mount. Renders "{prefix} {name}." with the name
 * linked, styled by the caller for its surface. Renders nothing while
 * SPONSOR is unset in site-config, so mounting this component is a
 * zero-visual-change operation until approved wording lands there.
 */
export default function SponsorLine({ style }: { style?: React.CSSProperties }) {
  if (!SPONSOR) return null;
  return (
    <p style={style}>
      {SPONSOR.prefix}{' '}
      <a href={SPONSOR.url} target="_blank" rel="noopener noreferrer">
        {SPONSOR.name}
      </a>
      .
    </p>
  );
}
