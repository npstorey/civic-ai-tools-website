import type { Metadata } from 'next';
import Link from 'next/link';
import { prose, sectionHeading, sectionSpacing, card, excerptBlock } from '@/styles/page-styles';
import { TYPED_STANDARDS_URL } from '@/lib/site-config';
import ContactCallToAction from '@/components/ContactCallToAction';
import { CONSORTIUM_MEMBERS } from '@/lib/consortium';
import { pageTitle } from '@/lib/brand-config';
import { Page } from '@/components/ui/Page';
import { PageToc } from '@/components/ui/PageToc';
import { buildFlowsStatement } from '@/lib/flows/statement';
import { sourcesSentence } from '@/lib/flows/sources-sentence';

export const metadata: Metadata = {
  title: pageTitle('Project'),
  description:
    'What the Civic AI Tools project is: verifiable AI-assisted analysis of open civic data, the pillars it works across, and real published analyses.',
};

// Case cards reference REAL records in this site's public record registry.
// Every fact below is sourced from the linked record page (title, summary,
// publisher, model, date) — do not edit a card without re-checking its record,
// and do not add cards that aren't already public at /records.
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
      'Examined pedestrian-involved crashes in ZIP code 11217 for April 21 – May 21, 2026, using the NYC Open Data Motor Vehicle Collisions dataset, and found two such incidents. The analysis also discloses what didn’t work: the planned near-schools comparison could not be completed.',
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

// The page's sections: each id and h2 written once, read by the section and by
// the jump list. Six h2s since UX-2 P10 (two moved here); the jump list is the
// owner's ruling (UX-1 G0-2 (ii)), in a commit of its own.
const SECTIONS = {
  pillars: { id: 'three-pillars', heading: 'Three pillars' },
  // UX-2 P10 (site Q3 = P, home Q5 = A): the list that was the home band's, re-dated (P10-15), and the setup that was
  // /learn's, under the band's button words (P10-17); the band and /learn link #run-it-yourself.
  use: { id: 'what-you-can-use', heading: 'What you can use (last checked November 2026)' },
  setup: { id: 'run-it-yourself', heading: 'Run it yourself' },
  consortium: { id: 'consortium', heading: 'Consortium' },
  contact: { id: 'contact', heading: 'Contact us' },
  cases: { id: 'cases', heading: 'Cases' },
} as const;

const listItem: React.CSSProperties = { ...prose, marginBottom: 0 };
const itemLabel: React.CSSProperties = { color: 'var(--text-primary)' };

export default async function ProjectPage() {
  // P10-11: the sources sentence, read from this instance's statement when the page renders (at build: the page is
  // static), never typed.
  const statement = await buildFlowsStatement();
  return (
    <Page
      width="reading"
      title="The project"
      lede={
        <>
          A published analysis of open civic data should survive scrutiny. Six months after
          it&apos;s written, a reader should be able to tell what the AI was asked, which public
          data sources it queried, which figures came from which query &mdash; and verify all of
          it without trusting the site that hosts it.
        </>
      }
    >
      <PageToc
        label="Sections of this page"
        items={Object.values(SECTIONS).map((section) => ({ id: section.id, label: section.heading }))}
      />

      {/* 1. Project description (P10-10, P10-11; D-16 at the second paragraph) */}
      <section style={sectionSpacing}>
        <p style={prose}>
          Civic AI Tools is an open-source project built around that idea. Anyone can ask a plain-language question
          against live public data and watch every query the AI runs. Once signed in, they can publish the result as a
          signed analysis. {sourcesSentence(statement.sources)}
        </p>
        <p style={prose}>
          The site is the civic reference implementation of{' '}
          <a href={TYPED_STANDARDS_URL} target="_blank" rel="noopener noreferrer">
            Typed Standards
          </a>
          , an open protocol for independent verification of AI-generated answers. A signed analysis shows how an answer
          was produced. It does not claim the answer is correct. That discipline &mdash; disclosure, not validation
          &mdash; runs through everything here.
        </p>
      </section>

      {/* 2. Three pillars: one list of three; the home band's three-layer stack merged in (P10-12, P10-14; D-18). */}
      <section id={SECTIONS.pillars.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.pillars.heading}</h2>
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-6" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          <li>
            <p style={pillarLabel}>Deliberative democracy &times; citizen science</p>
            <p style={prose}>
              Public data belongs to the public, and working with it shouldn&apos;t require a data
              science team. Anyone who can ask a question can run a real analysis against live
              portal data, see exactly how the answer was produced, and publish it as a signed
              analysis others can check without taking their word for it &mdash; evidence that can
              hold up in public discussion, and a resource for building open-data and AI literacy.
            </p>
          </li>
          <li>
            <p style={pillarLabel}>Government deployment</p>
            <p style={prose}>
              The reference implementation shows what a government could run. It answers from public data, with
              citations, sign-in, a daily question limit and a record of every query. A city could run the same
              open-source software against its own data portals.
            </p>
          </li>
          <li>
            <p style={pillarLabel}>Standards + open-source software</p>
            <p style={prose}>
              <a href={TYPED_STANDARDS_URL} target="_blank" rel="noopener noreferrer">
                Typed Standards
              </a>{' '}
              is an open protocol for publishing an AI-generated answer as a signed record. Anyone can check a record
              without trusting the site that published it. Open-source software implements it: this website, the data
              connectors and the verification library this site shares with{' '}
              <a href={`${TYPED_STANDARDS_URL}/verify`} target="_blank" rel="noopener noreferrer">
                the independent verifier
              </a>
              . Civic AI Tools is one site built on it; other sectors can run their own. The{' '}
              <Link href="/roadmap">roadmap</Link> records how that direction was decided.
            </p>
          </li>
        </ul>
      </section>

      {/* 3. What you can use: moved from the home band (P10-15; P10-16; the other five items verbatim). */}
      <section id={SECTIONS.use.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.use.heading}</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <li style={listItem}>
            <strong style={itemLabel}>A command line.</strong>{' '}
            <code>npm install -g @typedstandards/cli</code> signs, views and verifies records
            from a terminal.
          </li>
          <li style={listItem}>
            <strong style={itemLabel}>Python and notebooks.</strong>{' '}
            <code>pip install typedstandards</code> signs a record from Python or a notebook.
          </li>
          <li style={listItem}>
            <strong style={itemLabel}>Your own host.</strong>{' '}
            <code>@typedstandards/host-core</code> serves signed records from a static site, and{' '}
            <a href="https://host-template.typedstandards.org" target="_blank" rel="noopener noreferrer">
              a template
            </a>{' '}
            does it on GitHub Pages.
          </li>
          <li style={listItem}>
            <strong style={itemLabel}>A live example.</strong>{' '}
            <a href="https://core-satellite.typedstandards.org" target="_blank" rel="noopener noreferrer">
              core-satellite.typedstandards.org
            </a>{' '}
            maps how the standard relates to public projects; each relation is a signed record.
          </li>
          <li style={listItem}>
            <strong style={itemLabel}>An independent check.</strong>{' '}
            <a href={`${TYPED_STANDARDS_URL}/verify`} target="_blank" rel="noopener noreferrer">
              The verifier
            </a>{' '}
            checks any record package without relying on the site that published it.
          </li>
          <li style={listItem}>
            <strong style={itemLabel}>Your own data connector.</strong>{' '}
            <code>npx -y socrata-mcp-server --stdio</code> runs the open-source Socrata server on your
            machine, so an MCP client such as Claude Desktop can query any Socrata open-data portal.
          </li>
        </ul>
      </section>

      {/* 4. Run it yourself: the one home of the setup (site Q3 = P), moved from /learn's "Set Up Locally" with its
          configuration block and per-client commands (P10-17's lead, P10-18's note). */}
      <section id={SECTIONS.setup.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.setup.heading}</h2>
        <p style={{ ...prose, marginBottom: '24px' }}>
          You can run the data connector on your own computer, with any AI assistant that supports MCP (Model Context
          Protocol). This site&apos;s daily question limit does not apply there.
        </p>
        <div
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Claude Desktop</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            The server is published on npm as{' '}
            <a href="https://www.npmjs.com/package/socrata-mcp-server" target="_blank" rel="noopener noreferrer">
              socrata-mcp-server
            </a>{' '}
            (version 0.9.2, October 2026) and needs Node.js 22 or newer. Add this to your Claude
            Desktop MCP configuration (Settings &rarr; Developer &rarr; Edit Config):
          </p>
          <pre style={{
            ...excerptBlock,
            margin: '0 0 12px 0',
          }}>{`{
  "mcpServers": {
    "socrata": {
      "command": "npx",
      "args": ["-y", "socrata-mcp-server", "--stdio"],
      "env": {
        "DATA_PORTAL_URL": "https://data.cityofnewyork.us"
      }
    }
  }
}`}</pre>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            <code style={{ fontSize: '12px' }}>DATA_PORTAL_URL</code> is optional: it is the portal a
            request uses when it names none. Without it, the server refuses every request that
            does not name a portal.
            After saving, restart Claude Desktop. To run the server from source instead, see its{' '}
            <a href="https://github.com/npstorey/socrata-mcp-server#quick-start" target="_blank" rel="noopener noreferrer">
              README
            </a>.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '32px',
          }}
        >
          {[
            { title: 'Claude Code', desc: 'claude mcp add socrata -e DATA_PORTAL_URL=https://data.cityofnewyork.us -- npx -y socrata-mcp-server --stdio' },
            { title: 'Cursor', desc: 'Add the same "socrata" entry to .cursor/mcp.json' },
            { title: 'Other tools', desc: 'Any MCP-compatible client works' },
          ].map((item, idx) => (
            <div
              key={idx}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '16px',
              }}
            >
              <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>{item.title}</h3>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
                {item.desc}
              </p>
            </div>
          ))}
        </div>

        <p style={{ ...prose, fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px' }}>
          Not every AI assistant supports MCP.{' '}
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">The MCP documentation</a>{' '}
          lists the ones that do.
        </p>

        <div
          style={{
            backgroundColor: 'var(--card-background)',
            borderRadius: '4px',
            padding: '24px',
          }}
        >
          <h3 style={{ fontSize: '18px', marginBottom: '12px' }}>Get Started</h3>
          <p style={{ fontSize: '16px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Check out the civic-ai-tools repository for setup instructions and documentation.
          </p>
          <a
            href="https://github.com/npstorey/civic-ai-tools"
            target="_blank"
            rel="noopener noreferrer"
            className="ui-button ui-button-primary"
            style={{ textDecoration: 'none' }}
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* 5. Consortium */}
      <section id={SECTIONS.consortium.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.consortium.heading}</h2>
        <p style={prose}>
          Members of the consortium that supports the Typed Standards ecosystem.
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

      {/* 6. Contact us */}
      <section id={SECTIONS.contact.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.contact.heading}</h2>
        <ContactCallToAction textStyle={prose} />
      </section>

      {/* 7. Cases */}
      <section id={SECTIONS.cases.id} style={{ marginBottom: '48px' }}>
        <h2 style={sectionHeading}>{SECTIONS.cases.heading}</h2>
        <p style={prose}>
          Real analyses published to this site&apos;s{' '}
          <Link href="/records">public registry of analyses</Link>. Each card links to the signed
          record, where everything stated here can be read and independently verified. The record
          shows how an answer was produced. It does not claim the answer is correct.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {CASES.map((c) => (
            <div key={c.slug} style={card}>
              <p style={{ ...pillarLabel, marginBottom: '8px' }}>
                <Link href={`/records/${c.slug}`}>{c.question}</Link>
              </p>
              <p style={{ ...prose, fontSize: '14px', marginBottom: '12px' }}>{c.finding}</p>
              <p style={cardMeta}>
                Published by {c.publisher} &middot; {c.published} &middot; {c.model}
              </p>
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}
