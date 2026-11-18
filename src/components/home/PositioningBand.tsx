import Link from 'next/link';
import { TYPED_STANDARDS_URL } from '@/lib/site-config';
import ContactCallToAction from '@/components/ContactCallToAction';

/**
 * The home page below the question box: one screen that links out (UX-2 P10; home Q1 = B, outline B; the words of
 * C1 = A and D-17 = A, byte for byte). In order: the headline (P10-3), the claim's limit directly under it (P10-4),
 * three reader cards each ending in one link (P10-5 to P10-7; D-17's targets), the band's foot with two buttons
 * (P10-8) and the contact button alone (P10-9). What the band carried before moved: the three-layer stack into
 * `/project`'s "Three pillars", "What you can use" to `/project`, "Where the line is today" to the hub's ROADMAP.md,
 * and "What another city could reuse" into pillar 2's sentence (P10-12, P10-13).
 */

const bodyText: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '170%',
  color: 'var(--text-secondary)',
  margin: 0,
};

const cardLabel: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: '8px',
};

const cardLink: React.CSSProperties = { margin: '10px 0 0 0', fontSize: '14px', fontWeight: 500 };

/** The three reader cards: who, what this site gives them, and where to go next. */
const CARDS: Array<{ label: string; body: string; link: string; href: string }> = [
  {
    label: 'If you set policy',
    body: 'Each published analysis lists its datasets, queries and model, and is signed so anyone can check it is unchanged.',
    link: 'See published analyses',
    href: '/records',
  },
  {
    label: 'If you own a data function',
    body: 'This site shows AI answering from public data, with citations, sign-in and a record of every query. It is all open source.',
    link: 'What a city could run',
    href: '/project#three-pillars',
  },
  {
    label: 'If you analyze data',
    body: 'Ask a question against live public data and see every query the AI runs. Download the answer as a notebook, or sign in to publish it as a signed analysis.',
    link: 'Watch it in action',
    href: '/explore',
  },
];

export default function PositioningBand() {
  return (
    <section
      id="positioning"
      aria-labelledby="positioning-heading"
      style={{
        borderTop: '1px solid var(--border-color)',
        backgroundColor: 'var(--card-background)',
        marginTop: '48px',
        // The home page's "What is this site? ↓" lands here: below the sticky header, not under it (UX-2-FIX P3, H1).
        scrollMarginTop: 'var(--header-height, 72px)',
      }}
    >
      <div className="max-w-6xl mx-auto px-6" style={{ padding: '56px 24px' }}>
        <h2
          id="positioning-heading"
          style={{
            fontSize: '26px',
            lineHeight: '140%',
            maxWidth: '820px',
            marginTop: 0,
            marginBottom: '12px',
            fontWeight: 600,
          }}
        >
          Civic AI Tools is the civic reference implementation of{' '}
          <a href={TYPED_STANDARDS_URL} target="_blank" rel="noopener noreferrer">
            Typed Standards
          </a>{' '}
          &mdash; an open protocol for independent verification of AI-generated
          answers.
        </h2>
        <p style={{ ...bodyText, maxWidth: '820px', marginBottom: '40px' }}>
          A signed analysis shows how an answer was produced. It does not claim the answer is correct.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6" style={{ marginBottom: '40px' }}>
          {CARDS.map((card) => (
            <div key={card.label}>
              <p style={cardLabel}>{card.label}</p>
              <p style={bodyText}>{card.body}</p>
              <p style={cardLink}>
                <Link href={card.href}>{card.link}</Link>
              </p>
            </div>
          ))}
        </div>

        {/* The band's foot: the two buttons that were "Go deeper"'s (home Q3 = A, P10-8), and the contact button. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '12px',
            borderTop: '1px solid var(--border-color)',
            paddingTop: '24px',
          }}
        >
          <Link
            href="/project#run-it-yourself"
            className="ui-button ui-button-secondary"
            style={{ textDecoration: 'none', fontSize: '14px', padding: '10px 24px', whiteSpace: 'nowrap' }}
          >
            Run it yourself
          </Link>
          <Link
            href="/learn"
            className="ui-button ui-button-secondary"
            style={{ textDecoration: 'none', fontSize: '14px', padding: '10px 24px', whiteSpace: 'nowrap' }}
          >
            Learn how it works
          </Link>
          <ContactCallToAction buttonOnly />
        </div>
      </div>
    </section>
  );
}
