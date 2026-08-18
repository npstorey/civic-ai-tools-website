import { getSponsor } from '@/lib/site-config';

/**
 * Sponsor acknowledgment mount. Renders "{prefix} {name}." with the name
 * linked when a link is configured, styled by the caller for its surface.
 *
 * Renders nothing unless this instance has declared a sponsor
 * (`SITE_SPONSOR_NAME`; see `getSponsor` for the full variable set). That is
 * the default: an acknowledgment names who funds THIS deployment, so an
 * unconfigured instance has nothing true to say here (#259 P4, D4).
 */
export default function SponsorLine({ style }: { style?: React.CSSProperties }) {
  const sponsor = getSponsor();
  if (!sponsor) return null;
  return (
    <p style={style}>
      {sponsor.prefix}{' '}
      {sponsor.url !== null ? (
        <a href={sponsor.url} target="_blank" rel="noopener noreferrer">
          {sponsor.name}
        </a>
      ) : (
        sponsor.name
      )}
      .
    </p>
  );
}
