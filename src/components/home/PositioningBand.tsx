import { EXPRESS_INTEREST_URL, TYPED_STANDARDS_URL } from '@/lib/site-config';

// Legend statuses shared with the Typed Standards architecture docs
// (end-state-vision.md) and typedstandards.org: exactly these three labels.
type LegendStatus = 'built' | 'designed' | 'upcoming';

const LEGEND_META: Record<LegendStatus, { label: string; color: string }> = {
  built: { label: 'Built', color: 'var(--success)' },
  designed: { label: 'Designed', color: 'var(--caution)' },
  upcoming: { label: 'Upcoming', color: 'var(--text-muted)' },
};

function LegendLabel({ status }: { status: LegendStatus }) {
  const { label, color } = LEGEND_META[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--text-secondary)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: color,
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  );
}

const eyebrow: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: '12px',
};

const subHeading: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 600,
  marginBottom: '16px',
  marginTop: 0,
};

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

export default function PositioningBand() {
  return (
    <section
      id="positioning"
      aria-labelledby="positioning-heading"
      style={{
        borderTop: '1px solid var(--border-color)',
        backgroundColor: 'var(--card-background)',
        marginTop: '48px',
      }}
    >
      <div className="max-w-6xl mx-auto px-6" style={{ padding: '56px 24px' }}>
        {/* Headline */}
        <p style={eyebrow}>Beyond the demo</p>
        <h2
          id="positioning-heading"
          style={{
            fontSize: '26px',
            lineHeight: '140%',
            maxWidth: '820px',
            marginTop: 0,
            marginBottom: '40px',
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

        {/* Layered stack: protocol → software → city implementations */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6" style={{ marginBottom: '48px' }}>
          <div>
            <p style={cardLabel}>1. Protocol</p>
            <p style={bodyText}>
              <a href={TYPED_STANDARDS_URL} target="_blank" rel="noopener noreferrer">
                Typed Standards
              </a>{' '}
              defines how an AI-generated answer is published as a signed
              record &mdash; so anyone can check what data was used, how, and by
              which model, without trusting the site that published it.
            </p>
          </div>
          <div>
            <p style={cardLabel}>2. Open-source software</p>
            <p style={bodyText}>
              The working parts: this website, the data connectors through
              which AI mediates open-data portals for people, and the shared
              verification library used by both this site and the independent
              verifier. All open source.
            </p>
          </div>
          <div>
            <p style={cardLabel}>3. City implementations</p>
            <p style={bodyText}>
              This site is the first: a reference implementation running
              against public data portals for New York, Chicago, and San
              Francisco. The same stack is what another city would pick up and
              run against its own portals.
            </p>
          </div>
        </div>

        {/* Three readers */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6" style={{ marginBottom: '48px' }}>
          <div>
            <p style={cardLabel}>If you set policy</p>
            <p style={bodyText}>
              AI-assisted answers about public data should come with receipts.
              Every analysis published here permanently records which datasets
              were used, what was asked of them, and which model did the work
              &mdash; and the record is signed, so a third party can confirm it
              hasn&apos;t been altered. The record shows how an answer was
              produced; it does not claim the answer is correct.
            </p>
          </div>
          <div>
            <p style={cardLabel}>If you own a data function</p>
            <p style={bodyText}>
              This is a working example of putting AI in front of your data on
              your terms: AI mediates public data for residents and staff, with
              citations, provenance capture, logging, and sign-in &mdash; while
              your analysts stay in the loop. Every piece is open source and
              portable to your portals.
            </p>
          </div>
          <div>
            <p style={cardLabel}>If you analyze data</p>
            <p style={bodyText}>
              Ask a real question against live portal data and watch the work:
              every query the AI issues is visible as actual SoQL, exportable
              as a Jupyter notebook you can re-run yourself, and publishable as
              a signed evidence record others can verify without taking your
              word for it.
            </p>
          </div>
        </div>

        {/* Boundaries: where the line is today */}
        <div style={{ marginBottom: '48px' }}>
          <h3 style={subHeading}>Where the line is today</h3>
          <p style={{ ...bodyText, marginBottom: '16px' }}>
            <LegendLabel status="built" />{' '}
            <span style={{ fontSize: '14px' }}>&mdash; running on this site today</span>
            <span style={{ margin: '0 10px', color: 'var(--text-muted)' }}>&middot;</span>
            <LegendLabel status="designed" />{' '}
            <span style={{ fontSize: '14px' }}>&mdash; specified, not yet running</span>
            <span style={{ margin: '0 10px', color: 'var(--text-muted)' }}>&middot;</span>
            <LegendLabel status="upcoming" />{' '}
            <span style={{ fontSize: '14px' }}>&mdash; planned direction</span>
          </p>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <li style={bodyText}>
              <strong style={{ color: 'var(--text-primary)' }}>
                Prototype vs. production.
              </strong>{' '}
              This site is a working prototype <LegendLabel status="built" />
              {' '}&mdash; real data, real signatures, demo-scale limits. A
              production deployment customized to one city&apos;s portals,
              policies, and scale is the next step{' '}
              <LegendLabel status="upcoming" />.
            </li>
            <li style={bodyText}>
              <strong style={{ color: 'var(--text-primary)' }}>
                Open data vs. restricted data.
              </strong>{' '}
              Everything here runs against open, public data portals{' '}
              <LegendLabel status="built" />. Extending the same verification pattern to
              access-controlled internal data is a planned direction{' '}
              <LegendLabel status="upcoming" />.
            </li>
            <li style={bodyText}>
              <strong style={{ color: 'var(--text-primary)' }}>
                Retrieval vs. analysis.
              </strong>{' '}
              The AI here both retrieves records with citations and runs
              multi-step analysis, published as signed evidence records{' '}
              <LegendLabel status="built" />. Extracting typed, machine-checkable claims
              from an analysis is specified but not yet running{' '}
              <LegendLabel status="designed" />.
            </li>
            <li style={bodyText}>
              <strong style={{ color: 'var(--text-primary)' }}>
                AI-generated vs. human-validated.
              </strong>{' '}
              Everything the AI produces is permanently labeled AI-generated,
              and human review attaches as its own signed attestation{' '}
              <LegendLabel status="built" />. AI-generated work is never silently promoted
              to human-validated.
            </li>
          </ul>
        </div>

        {/* Trust & transferability */}
        <div style={{ marginBottom: '40px' }}>
          <h3 style={subHeading}>What another city could reuse</h3>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '0 0 16px 0',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <li style={bodyText}>
              <strong style={{ color: 'var(--text-primary)' }}>Citations</strong>{' '}
              &mdash; answers name the datasets they draw on, linked back to
              the source portal.
            </li>
            <li style={bodyText}>
              <strong style={{ color: 'var(--text-primary)' }}>Provenance</strong>{' '}
              &mdash; the full trail (model, data sources, every query,
              timestamps) travels with each published analysis.
            </li>
            <li style={bodyText}>
              <strong style={{ color: 'var(--text-primary)' }}>Access controls</strong>{' '}
              &mdash; sign-in and per-user limits, so usage is accountable.
            </li>
            <li style={bodyText}>
              <strong style={{ color: 'var(--text-primary)' }}>Logging</strong>{' '}
              &mdash; every tool call is captured as a replayable trace &mdash;
              see the <a href="/explore">Explore page</a>.
            </li>
            <li style={bodyText}>
              <strong style={{ color: 'var(--text-primary)' }}>Human-in-the-loop</strong>{' '}
              &mdash; publishing is a deliberate human action, and human review
              is recorded as its own signed attestation.
            </li>
          </ul>
          <p style={bodyText}>
            All of it is open source: the protocol, the software, and the
            safeguards are built to be run by another city against its own data
            portals.
          </p>
        </div>

        {/* Express interest */}
        <div
          style={{
            borderTop: '1px solid var(--border-color)',
            paddingTop: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <p style={{ ...bodyText, flex: '1 1 320px' }}>
            Interested in running this against your city&apos;s data, or in the
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
      </div>
    </section>
  );
}
