import Link from 'next/link';

// Six-audience routing strip shown above the roadmap body. Equal visual weight across all cards.
// Content is fixed per the roadmap governance design (civic-ai-tools-website#94); adding or removing
// an audience is a roadmap-change issue, not a drive-by UI edit.

interface AudienceCard {
  audience: string;
  why: string;
  linkLabel: string;
  href: string;
  external: boolean;
}

const HUB_DOC_BASE = 'https://github.com/npstorey/civic-ai-tools/blob/main';

const CARDS: AudienceCard[] = [
  {
    audience: 'Government partners',
    why: 'How to verify a civic-data analysis without trusting civicaitools.org; what the platform does and does not claim.',
    linkLabel: 'docs/trust-and-evidence.md',
    href: `${HUB_DOC_BASE}/docs/trust-and-evidence.md`,
    external: true,
  },
  {
    audience: 'Academic and policy partners',
    why: 'Open research questions, the guidance-quality evaluation corpus, how to cite or collaborate.',
    linkLabel: 'docs/research-agenda.md',
    href: `${HUB_DOC_BASE}/docs/research-agenda.md`,
    external: true,
  },
  {
    audience: 'OSS contributors',
    why: 'Where to file, how the four repos relate, and the template for non-trivial roadmap proposals.',
    linkLabel: 'CONTRIBUTING.md',
    href: `${HUB_DOC_BASE}/CONTRIBUTING.md`,
    external: true,
  },
  {
    audience: 'Journalists',
    why: 'How the evidence chain works, how to verify a package, what withdrawal means.',
    linkLabel: 'docs/trust-and-evidence.md',
    href: `${HUB_DOC_BASE}/docs/trust-and-evidence.md`,
    external: true,
  },
  {
    audience: 'Funders',
    why: 'Current self-funded state, what holds without funding, what directed funding could accelerate, what it would not change.',
    linkLabel: 'docs/sustainability.md',
    href: `${HUB_DOC_BASE}/docs/sustainability.md`,
    external: true,
  },
  {
    audience: 'End users',
    why: 'The demo. Try a query; publish an analysis as evidence.',
    linkLabel: 'civicaitools.org home',
    href: '/',
    external: false,
  },
];

export default function AudienceRoutingStrip() {
  return (
    <section
      aria-label="Audience routing"
      style={{ marginBottom: '48px' }}
    >
      <p
        style={{
          fontSize: '16px',
          lineHeight: '170%',
          color: 'var(--text-secondary)',
          marginBottom: '20px',
        }}
      >
        For deeper, audience-specific detail on what this roadmap means for your role, see the
        adjunct doc linked in each card.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '16px',
        }}
      >
        {CARDS.map((card) => (
          <AudienceCardTile key={card.audience} card={card} />
        ))}
      </div>
    </section>
  );
}

function AudienceCardTile({ card }: { card: AudienceCard }) {
  const linkStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 500,
    color: 'var(--accent)',
    textDecoration: 'none',
  };
  const arrow = ' →';

  return (
    <div
      style={{
        backgroundColor: 'var(--card-background)',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <h3
        style={{
          fontSize: '16px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          margin: 0,
        }}
      >
        {card.audience}
      </h3>
      <p
        style={{
          fontSize: '14px',
          lineHeight: '1.5',
          color: 'var(--text-secondary)',
          margin: 0,
          flexGrow: 1,
        }}
      >
        {card.why}
      </p>
      <div style={{ marginTop: '8px' }}>
        {card.external ? (
          <a href={card.href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            {card.linkLabel}
            {arrow}
          </a>
        ) : (
          <Link href={card.href} style={linkStyle}>
            {card.linkLabel}
            {arrow}
          </Link>
        )}
      </div>
    </div>
  );
}
