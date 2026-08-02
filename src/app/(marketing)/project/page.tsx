import type { Metadata } from 'next';
import Link from 'next/link';
import { prose, sectionHeading, sectionSpacing, card } from '@/styles/page-styles';
import { EXPRESS_INTEREST_URL, TYPED_STANDARDS_URL } from '@/lib/site-config';
import { CONSORTIUM_MEMBERS } from '@/lib/consortium';

export const metadata: Metadata = {
  title: 'Project - Civic AI Tools',
  description:
    'What the Civic AI Tools project is: verifiable AI-assisted analysis of open civic data, the pillars it works across, and real published evidence records.',
};

// Case cards reference REAL records in this site's public evidence registry.
// Every fact below is sourced from the linked evidence page (title, summary,
// publisher, model, date) — do not edit a card without re-checking its record,
// and do not add cards that aren't already public at /evidence.
interface CaseRecord {
  slug: string;
  question: string;
  finding: string;
  publisher: string;
  model: string;
  published: string;
}

const CASES: CaseRecord[] = [
  {
    slug: 'pedestrian-involved-traffic-crashes-in-zip-11217-and-a-comparison-of-those-n-f5f90d',
    question: 'Pedestrian-involved traffic crashes in ZIP 11217, and how many were near schools',
    finding:
      'Examined pedestrian-involved crashes in ZIP code 11217 for April 21 – May 21, 2026, using the NYC Open Data Motor Vehicle Collisions dataset, and found two such incidents. The record also discloses what didn’t work: the planned near-schools comparison could not be completed.',
    publisher: 'Nathan Storey',
    model: 'openai/gpt-5.4',
    published: 'May 21, 2026',
  },
  {
    slug: 'nyc-murders-by-year-2006-2025-from-nypd-complaint-data-historic-2d0975',
    question: 'NYC murders by year, 2006–2025',
    finding:
      'Counts murders by year of occurrence in the NYPD Complaint Data Historic dataset (qgea-i56i) on NYC Open Data, filtered to the standard CompStat homicide classification. Annual counts range from 569 in 2006 to 277 in 2025, with a citywide total of 8,081 over the twenty-year period.',
    publisher: 'Nathan Storey',
    model: 'claude-opus-4-7',
    published: 'May 16, 2026',
  },
  {
    slug: 'pittsburgh-demographic-change-by-census-tract-2014-2024-69b90e',
    question: 'Pittsburgh demographic change by census tract, 2014–2024',
    finding:
      'Compares demographics across Pittsburgh census tracts between 2014 and 2024 using ACS 5-year data from Google Data Commons — and documents its own substitution: Pittsburgh’s wards are not a Census-recognized geography, so the analysis uses census tracts instead.',
    publisher: 'Nathan Storey',
    model: 'anthropic/claude-opus-4-7',
    published: 'May 8, 2026',
  },
  {
    slug: 'how-many-311-pothole-requests-were-filed-in-dorchester-in-2024-b8cc28',
    question: 'How many 311 pothole requests were filed in Dorchester in 2024?',
    finding:
      'Found 135 requests to address potholes submitted to Boston’s 311 service for the Dorchester neighborhood in 2024 — and states its own limits: the number has not been verified against completed repairs or other data sources.',
    publisher: 'Nathan Storey',
    model: 'openai/gpt-4o',
    published: 'April 22, 2026',
  },
];

const pillarLabel: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: '8px',
  marginTop: 0,
};

const cardMeta: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--text-muted)',
  margin: 0,
};

export default function ProjectPage() {
  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '48px 24px' }}>
      {/* 1. Project description */}
      <section style={sectionSpacing}>
        <h1 style={{ marginBottom: '16px' }}>The project</h1>
        <p style={{ fontSize: '20px', lineHeight: '150%', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          A published analysis of open civic data should survive scrutiny. Six months after
          it&apos;s written, a reader should be able to tell what the AI was asked, which public
          data sources it queried, which figures came from which query &mdash; and verify all of
          it without trusting the site that hosts it.
        </p>
        <p style={prose}>
          Civic AI Tools is an open-source project built around that idea. AI mediates open civic
          data for humans: anyone &mdash; a journalist, a student, a researcher, a public servant
          &mdash; can ask a plain-language question against live public data portals (NYC Open
          Data and other Socrata portals, Google Data Commons, Boston 311), watch every query the
          AI issues, and publish the result as a cryptographically signed evidence record that
          others can verify independently.
        </p>
        <p style={prose}>
          The site is the civic reference implementation of{' '}
          <a href={TYPED_STANDARDS_URL} target="_blank" rel="noopener noreferrer">
            Typed Standards
          </a>
          , an open protocol for independent verification of AI-generated answers. A record shows
          how an answer was produced; it does not claim the answer is correct. That discipline
          &mdash; disclosure, not validation &mdash; runs through everything here.
        </p>
      </section>

      {/* 2. Three pillars */}
      <section style={sectionSpacing}>
        <h2 style={sectionHeading}>Three pillars</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p style={pillarLabel}>Deliberative democracy &times; citizen science</p>
            <p style={prose}>
              Public data belongs to the public, and working with it shouldn&apos;t require a data
              science team. Anyone who can ask a question can run a real analysis against live
              portal data, see exactly how the answer was produced, and publish it as a signed
              record others can check without taking their word for it &mdash; evidence that can
              hold up in public discussion, and a resource for building open-data and AI literacy.
            </p>
          </div>
          <div>
            <p style={pillarLabel}>Government deployment</p>
            <p style={prose}>
              A working example of putting AI in front of public data on a government&apos;s own
              terms: AI mediates public data for residents and staff, with citations, provenance
              capture, logging, and sign-in, while analysts stay in the loop. This site runs as a
              prototype against New York, Chicago, and San Francisco portals; a production
              deployment customized to one city&apos;s portals, policies, and scale is the next
              step. See the <Link href="/roadmap">roadmap</Link> for what&apos;s committed.
            </p>
          </div>
          <div>
            <p style={pillarLabel}>Standards + open-source software</p>
            <p style={prose}>
              Underneath the demo:{' '}
              <a href={TYPED_STANDARDS_URL} target="_blank" rel="noopener noreferrer">
                Typed Standards
              </a>
              , a domain-neutral protocol for publishing AI-generated answers as signed,
              independently verifiable records, plus the open-source software that implements it
              &mdash; this website, the data connectors, and the shared verification library used
              by both this site and the independent verifier. Civic AI Tools is one instance;
              other sectors can run compatible registries. The{' '}
              <Link href="/roadmap">roadmap</Link> records how that direction was decided.
            </p>
          </div>
        </div>
      </section>

      {/* 3. Consortium */}
      <section style={sectionSpacing}>
        <h2 style={sectionHeading}>Consortium</h2>
        <p style={prose}>
          Founding members of the consortium supporting the Typed Standards ecosystem.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {CONSORTIUM_MEMBERS.map((member) => (
            <div key={member.name} style={card}>
              {member.logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={member.logoSrc}
                  alt={`${member.name} logo`}
                  style={{ height: '48px', marginBottom: '16px' }}
                />
              ) : (
                <div
                  aria-hidden="true"
                  style={{
                    height: '48px',
                    width: '120px',
                    backgroundColor: 'var(--skeleton-color)',
                    borderRadius: '4px',
                    marginBottom: '16px',
                  }}
                />
              )}
              <p style={{ ...pillarLabel, marginBottom: '4px' }}>
                {member.url ? (
                  <a href={member.url} target="_blank" rel="noopener noreferrer">
                    {member.name}
                  </a>
                ) : (
                  member.name
                )}
              </p>
              <p style={{ ...cardMeta, marginBottom: '8px' }}>{member.role}</p>
              <p style={{ ...prose, fontSize: '14px', marginBottom: 0 }}>{member.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Contact us */}
      <section style={sectionSpacing}>
        <h2 style={sectionHeading}>Contact us</h2>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <p style={{ ...prose, flex: '1 1 320px', marginBottom: 0 }}>
            Interested in running this against your city&apos;s data, joining the work, or in the
            verification standard behind it?
          </p>
          <a
            href={EXPRESS_INTEREST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="nyc-button nyc-button-primary"
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
      </section>

      {/* 5. Cases */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={sectionHeading}>Cases</h2>
        <p style={prose}>
          Real analyses published to this site&apos;s{' '}
          <Link href="/evidence">public evidence registry</Link>. Each card links to the signed
          record, where everything stated here can be read and independently verified. A record
          documents how an answer was produced &mdash; it does not certify that the answer is
          correct.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {CASES.map((c) => (
            <div key={c.slug} style={card}>
              <p style={{ ...pillarLabel, marginBottom: '8px' }}>
                <Link href={`/evidence/${c.slug}`}>{c.question}</Link>
              </p>
              <p style={{ ...prose, fontSize: '14px', marginBottom: '12px' }}>{c.finding}</p>
              <p style={cardMeta}>
                Published by {c.publisher} &middot; {c.published} &middot; {c.model}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
