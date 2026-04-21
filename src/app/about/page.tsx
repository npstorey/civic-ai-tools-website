import Link from 'next/link';
import { prose, sectionHeading, sectionSpacing } from '@/styles/page-styles';

export const metadata = {
  title: 'About - Civic AI Tools',
  description: 'Civic AI Tools is an open-source project that connects AI assistants to government open data using the Model Context Protocol.',
};

export default function AboutPage() {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px' }}>

      {/* Hero */}
      <section style={sectionSpacing}>
        <h1 style={{ marginBottom: '16px' }}>About</h1>
        <p style={{ fontSize: '20px', lineHeight: '150%', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Civic AI Tools is an open-source project that connects AI assistants to government open
          data. It uses the{' '}
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">
            Model Context Protocol (MCP)
          </a>{' '}
          to give AI models structured access to real datasets from cities like New York, Chicago,
          San Francisco, Seattle, and Los Angeles, plus US Census / ACS demographic and economic data
          via Google Data Commons &mdash; so you can ask plain-language questions and get answers
          grounded in actual public data, not training data.
        </p>
      </section>

      {/* What's in the project */}
      <section id="whats-in-the-project" style={{ ...sectionSpacing, scrollMarginTop: '80px' }}>
        <h2 style={sectionHeading}>What&apos;s in the project</h2>
        <p style={prose}>
          The demo on this website uses two MCP servers &mdash; our Socrata connector for city open
          data portals and Google&apos;s Data Commons for US Census / ACS statistics &mdash; and the
          broader civic data MCP ecosystem is much larger and growing fast.
          The{' '}
          <a href="https://github.com/npstorey/civic-ai-tools" target="_blank" rel="noopener noreferrer">
            civic-ai-tools starter project
          </a>{' '}
          curates this ecosystem and packages what you need to run AI-powered civic data analysis locally:
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
            <strong>
              <a href="https://github.com/npstorey/socrata-mcp-server" target="_blank" rel="noopener noreferrer">
                Socrata MCP server
              </a>
            </strong>{' '}
            &mdash; Civic AI Tools connects to open data portals powered by Tyler
            Technologies&apos; Socrata platform (formerly Socrata, now Tyler Data &amp; Insights).
            This is the server powering the demo on this website.
            Install via <code style={{ fontSize: '14px' }}>npx socrata-mcp-server</code> or clone
            the repo.{' '}
            <Link href="/directory">Browse the directory</Link> to see the MCP servers and
            2,000+ open data portals they connect to.
          </li>
          <li>
            <strong>Curated MCP server directory</strong> &mdash; a{' '}
            <Link href="/directory">growing directory</Link> of MCP servers for civic and
            government data, including official servers from the US Census Bureau, the Government
            Publishing Office, and France&apos;s data.gouv.fr. The starter repo pre-configures the
            best ones for immediate use. Know of a civic data MCP server that should be in the
            directory?{' '}
            <a href="https://nathanstorey.com/contact/" target="_blank" rel="noopener noreferrer">
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
            . Coming soon: crowdsourced
            guidance variants for specific sectors (public safety, housing, transportation, health)
            and a governance framework for evaluating how guidance affects result quality.
          </li>
          <li>
            <strong>
              <Link href="/">This demo website</Link>
            </strong>{' '}
            &mdash; an entry point for exploring what AI-assisted data analysis looks like, and a
            resource for building open data literacy and AI literacy. If you&apos;re interested in
            using Civic AI Tools in an educational, open data literacy, or AI literacy context,{' '}
            <a href="https://nathanstorey.com/contact/" target="_blank" rel="noopener noreferrer">
              get in touch
            </a>.
          </li>
        </ul>

        <p style={prose}>
          Clone the repo and connect it to Claude Code, Cursor, VS Code Copilot, or any
          MCP-compatible AI assistant to work without the token limits of the web demo.
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
          the query process transparent so users can see exactly what data was retrieved and how. And
          we&apos;re working toward literacy resources that empower people not just to use these
          tools, but to understand how they work, where they fail, and how to think critically about
          what they produce.
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
          Civic AI Tools is part of a growing ecosystem of projects connecting AI to government data.
          Our research found 60+ MCP servers for civic data, official government MCP servers from the
          US Census Bureau and France, and a US Digital Corps pilot that showed query accuracy jumping
          from near 0% to 95% with MCP.
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
          &larr; Try the demo
        </Link>
        <Link href="/learn" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          How it works &rarr;
        </Link>
      </div>
    </div>
  );
}
