import Link from 'next/link';
import { prose, sectionHeading, sectionSpacing } from '@/styles/page-styles';
import { EXPRESS_INTEREST_URL, TYPED_STANDARDS_URL } from '@/lib/site-config';
import { Page } from '@/components/ui/Page';
import { pageTitle } from '@/lib/brand-config';
import { getDirectoryData } from '@/lib/mcp/directory-data';
import { getPortalCounts } from '@/lib/mcp/portal-data';
import { buildFlowsStatement } from '@/lib/flows/statement';
import { sourcesSentence } from '@/lib/flows/sources-sentence';

export const metadata = {
  title: pageTitle('About'),
  description: 'Civic AI Tools is an open-source project that connects AI assistants to government open data using the Model Context Protocol.',
};

export default async function AboutPage() {
  // Both counts come from the data /directory renders, so this page and the
  // directory cannot disagree. They replaced "60+" and "2,000+", which were
  // typed in and had gone stale (74 servers, 1,960 portals on 2026-10-10).
  const [directory, portalCounts, statement] = await Promise.all([getDirectoryData(), getPortalCounts(), buildFlowsStatement()]);
  const serverCount = directory.servers.length;
  const portalCount = portalCounts.total.toLocaleString('en-US');
  // UX-2-FIX P3, D12 = A: whether this site answers from the Socrata source, read from its own statement.
  const offersSocrata = statement.sources.some((source) => source.sourceId === 'socrata');

  return (
    <Page
      width="reading"
      title="About"
      lede={
        <>
          {/* P10-39 (C1 = A; site Q5 = R). */}
          Civic AI Tools is the civic reference implementation of{' '}
          <a href={TYPED_STANDARDS_URL} target="_blank" rel="noopener noreferrer">
            Typed Standards
          </a>
          , an open protocol for independent verification of AI-generated answers. You ask a plain-language question,
          and the AI answers it from live public data. Once signed in, you can publish the answer as a signed analysis.
          A signed analysis shows how an answer was produced. It does not claim the answer is correct.
        </>
      }
    >

      {/* What's in the project */}
      <section id="whats-in-the-project" style={{ ...sectionSpacing, scrollMarginTop: '80px' }}>
        <h2 style={sectionHeading}>What&apos;s in the project</h2>
        <p style={prose}>
          {/* P10-40 (C1 = A), with P10-11 read from the statement. */}
          {sourcesSentence(statement.sources)} The <Link href="/directory">directory</Link> lists many more
          connectors for civic data. The{' '}
          <a href="https://github.com/npstorey/civic-ai-tools" target="_blank" rel="noopener noreferrer">
            civic-ai-tools starter project
          </a>{' '}
          packages what you need to run the same kind of analysis on your own computer:
        </p>

        <ul
          style={{
            paddingLeft: '20px',
            margin: '0 0 24px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            fontSize: '15px',
            color: 'var(--text-secondary)',
            lineHeight: '1.7',
          }}
        >
          <li>
            {/* P10-41 (C1 = A); its install command went to /project (P10-20). */}
            <strong>
              <a href="https://github.com/npstorey/socrata-mcp-server" target="_blank" rel="noopener noreferrer">
                The Socrata connector
              </a>
            </strong>{' '}
            &mdash; this project&apos;s connector for open-data portals on Socrata
            {/* UX-2-FIX P3, D12 = A: the clause only where this site's statement offers the Socrata source. */}
            {offersSocrata ? <>, and one of this site&apos;s data sources</> : null}.{' '}
            {/* UX-2-FIX P3, A2 = A: both counts are the directory's list lengths. */}
            <Link href="/directory">Browse the directory</Link> to see the {serverCount} connectors and{' '}
            {portalCount} portals it lists.
          </li>
          <li>
            {/* P10-42 (C1 = A). */}
            <strong>Curated directory</strong> &mdash; a{' '}
            <Link href="/directory">growing directory</Link> of data connectors for civic and
            government data, including official ones from the US Census Bureau, the Government
            Publishing Office, and France&apos;s data.gouv.fr. The starter project sets up two of them.
            Know of one that should be listed?{' '}
            <a href={EXPRESS_INTEREST_URL} target="_blank" rel="noopener noreferrer">
              Get in touch
            </a>.
          </li>
          <li>
            <strong>Skill guidance</strong> &mdash; structured instructions that teach AI models how
            to query civic data accurately:{' '}
            <a
              href="https://github.com/npstorey/civic-ai-tools/blob/main/docs/skills/base.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              SoQL patterns, date handling, case-insensitive matching, zero-result verification, and
              dataset-specific knowledge
            </a>
            . Under consideration, not scheduled:{' '}
            <a href="https://github.com/npstorey/civic-ai-tools/issues/78" target="_blank" rel="noopener noreferrer">
              a stronger method for writing guidance
            </a>{' '}
            and{' '}
            <a href="https://github.com/npstorey/civic-ai-tools/issues/41" target="_blank" rel="noopener noreferrer">
              using reviews of published analyses to improve it
            </a>
            .
          </li>
          <li>
            {/* P10-43 (C1 = A). */}
            <strong>
              <Link href="/">This website</Link>
            </strong>{' '}
            &mdash; the reference implementation, where you can ask a question and watch the AI query live data.
            Signed in, you can also publish the answer. If you want to use it in teaching,{' '}
            <a href={EXPRESS_INTEREST_URL} target="_blank" rel="noopener noreferrer">
              get in touch
            </a>.
          </li>
          <li>
            {/* P10-44 (C1 = A): a new item. */}
            <strong>
              <Link href="/records">Signed analyses</Link>
            </strong>{' '}
            &mdash; each published answer is a signed record of its queries, data sources and model. It says where
            something was not recorded.
          </li>
        </ul>

        <p style={prose}>
          {/* P10-20 (C1 = A; site Q3 = P), in place of the install clause and P10-45's cut sentence. */}
          To run these tools on your own computer, see <Link href="/project#run-it-yourself">Run it yourself</Link> on
          the project page.
        </p>
      </section>

      {/* Why this exists */}
      <section style={sectionSpacing}>
        <h2 style={sectionHeading}>Why this exists</h2>
        <p style={prose}>
          Government data belongs to the public, but most of it sits on open data portals that
          require technical skills to navigate. AI tools can dramatically lower the barrier &mdash;
          making it possible for anyone who can ask a question to access and explore public data.
        </p>
        <p style={prose}>
          But easier access doesn&apos;t mean easier understanding. AI can retrieve data quickly,
          but interpreting that data &mdash; understanding its limitations, recognizing when results
          are incomplete or misleading, and drawing responsible conclusions &mdash; requires critical
          literacy that the tools alone don&apos;t provide. A confident-sounding AI answer about
          crime trends or housing data can be wrong, decontextualized, or missing crucial caveats.
        </p>
        <p style={prose}>
          Civic AI Tools is built with this tension in mind. We embed verification steps,
          uncertainty caveats, and accuracy disclaimers directly into the AI&apos;s workflow. We make
          the query process transparent so users can see exactly what data was retrieved and how. The{' '}
          <Link href="/learn">Learn page</Link> explains how these tools work and where they fail.
        </p>
        <p style={{ ...prose, fontWeight: 500 }}>
          The goal isn&apos;t just to make open data more accessible &mdash; it&apos;s to make that
          access informed.
        </p>
      </section>

      {/* Who built this */}
      <section style={sectionSpacing}>
        <h2 style={sectionHeading}>Who built this</h2>
        <p style={prose}>
          Built by{' '}
          <a href="https://nathanstorey.com" target="_blank" rel="noopener noreferrer">
            Nathan Storey
          </a>{' '}
          as a personal open-source project. This project is not affiliated with, endorsed by, or
          representative of Nathan&apos;s employer, the City of New York, or any government agency.
          It is an independent, spare-time project motivated by a belief that public data should be
          easier &mdash; and safer &mdash; to access.
        </p>
        <p style={prose}>Contributions welcome.</p>
      </section>

      {/* Get involved */}
      <section style={sectionSpacing}>
        <h2 style={sectionHeading}>Get involved</h2>
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontSize: '16px',
            marginBottom: '16px',
          }}
        >
          <li>
            <a href="https://github.com/npstorey/civic-ai-tools" target="_blank" rel="noopener noreferrer">
              civic-ai-tools
            </a>
            {' '}&mdash; starter project, skill docs, setup scripts
          </li>
          <li>
            <a href="https://github.com/npstorey/socrata-mcp-server" target="_blank" rel="noopener noreferrer">
              socrata-mcp-server
            </a>
            {' '}&mdash; the MCP server
          </li>
          <li>
            <a href="https://github.com/npstorey/civic-ai-tools-website" target="_blank" rel="noopener noreferrer">
              civic-ai-tools-website
            </a>
            {' '}&mdash; this website
          </li>
          <li>
            <a href="https://github.com/npstorey/civic-ai-tools/issues" target="_blank" rel="noopener noreferrer">
              Open issues
            </a>
            {' '}&mdash; see what&apos;s being worked on
          </li>
        </ul>
      </section>

      {/* The landscape */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={sectionHeading}>The landscape</h2>
        <p style={prose}>
          {/* P10-47 (C1 = A). */}
          Civic AI Tools is part of a growing ecosystem of projects connecting AI to government data.
          The <Link href="/directory">directory</Link> lists {serverCount} connectors for civic data.
          Our landscape research (April 2026) also found official government connectors from the US Census Bureau
          and France. It reports a US Digital Corps pilot in which query accuracy rose from near 0% to 95% with MCP,
          the Model Context Protocol.
        </p>
        <p style={{ fontSize: '14px' }}>
          <a
            href="https://github.com/npstorey/civic-ai-tools/blob/main/docs/research/landscape-analysis.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the full landscape analysis &rarr;
          </a>
        </p>
      </section>

      {/* Footer nav */}
      <div style={{ paddingTop: '32px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '24px' }}>
        <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          &larr; Ask a question
        </Link>
        <Link href="/learn" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          How it works &rarr;
        </Link>
      </div>
    </Page>
  );
}
