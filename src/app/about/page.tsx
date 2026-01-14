import Link from 'next/link';

export const metadata = {
  title: 'About MCP - Civic AI Tools',
  description: 'Learn how Model Context Protocol (MCP) enables LLMs to access live civic data.',
};

export default function AboutPage() {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ marginBottom: '32px' }}>What is MCP?</h1>

      <p
        style={{
          fontSize: '22px',
          lineHeight: '150%',
          color: 'var(--text-secondary)',
          marginBottom: '48px',
        }}
      >
        Model Context Protocol (MCP) is an open standard that allows Large Language
        Models to securely connect to external data sources and tools. Think of it
        as giving AI assistants the ability to &quot;see&quot; and interact with real-world
        data instead of relying solely on their training data.
      </p>

      <h2 style={{ marginBottom: '24px' }}>The problem MCP solves</h2>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '24px',
          marginBottom: '64px',
        }}
      >
        <div
          style={{
            backgroundColor: 'var(--card-background)',
            borderRadius: '4px',
            padding: '24px',
          }}
        >
          <h3
            style={{
              fontSize: '20px',
              color: 'var(--nyc-error)',
              marginBottom: '16px',
            }}
          >
            Without MCP
          </h3>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '16px',
              color: 'var(--text-secondary)',
            }}
          >
            <li>- Limited to training data (outdated)</li>
            <li>- Cannot access current information</li>
            <li>- May hallucinate statistics</li>
            <li>- No way to verify claims</li>
          </ul>
        </div>

        <div
          style={{
            backgroundColor: 'rgba(0, 183, 3, 0.1)',
            borderRadius: '4px',
            padding: '24px',
            border: '1px solid var(--nyc-success)',
          }}
        >
          <h3
            style={{
              fontSize: '20px',
              color: 'var(--nyc-success)',
              marginBottom: '16px',
            }}
          >
            With MCP
          </h3>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '16px',
              color: 'var(--text-secondary)',
            }}
          >
            <li>- Access to live, real-time data</li>
            <li>- Can query actual databases</li>
            <li>- Provides sourced, accurate info</li>
            <li>- Cites specific datasets</li>
          </ul>
        </div>
      </div>

      <h2 style={{ marginBottom: '24px' }}>How it works</h2>

      <div
        style={{
          backgroundColor: 'var(--card-background)',
          borderRadius: '4px',
          padding: '24px',
          marginBottom: '64px',
          overflowX: 'auto',
        }}
      >
        <pre
          style={{
            fontFamily: 'monospace',
            fontSize: '14px',
            lineHeight: '160%',
            color: 'var(--text-secondary)',
            margin: 0,
          }}
        >
{`User Question
     │
     ▼
┌─────────────────┐
│  LLM (Claude,   │
│  GPT-4, etc.)   │
└────────┬────────┘
         │ "I need current 311 data..."
         ▼
┌─────────────────┐
│   MCP Server    │──────► Socrata API
│  (opengov-mcp)  │◄────── Live Data
└────────┬────────┘
         │ Real data returned
         ▼
┌─────────────────┐
│  LLM Response   │
│  with citations │
└─────────────────┘`}
        </pre>
      </div>

      <h2 style={{ marginBottom: '24px' }}>About this demo</h2>

      <p
        style={{
          fontSize: '18px',
          color: 'var(--text-secondary)',
          marginBottom: '16px',
        }}
      >
        This website demonstrates the value of MCP by showing side-by-side
        comparisons of the same question answered:
      </p>

      <ol
        style={{
          paddingLeft: '24px',
          marginBottom: '64px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          fontSize: '18px',
          color: 'var(--text-secondary)',
        }}
      >
        <li>
          <strong>Without MCP:</strong> The LLM can only use its training data,
          which may be outdated or incomplete for specific civic datasets.
        </li>
        <li>
          <strong>With MCP:</strong> The LLM connects to the{' '}
          <a
            href="https://github.com/npstorey/civic-ai-tools"
            target="_blank"
            rel="noopener noreferrer"
          >
            opengov-mcp-server
          </a>
          , which provides access to Socrata open data portals from cities
          like San Francisco, Chicago, and New York.
        </li>
      </ol>

      <h2 style={{ marginBottom: '24px' }}>Use MCP locally</h2>

      <p
        style={{
          fontSize: '18px',
          color: 'var(--text-secondary)',
          marginBottom: '24px',
        }}
      >
        This demo has rate limits to manage costs. For unlimited access,
        set up MCP locally with your favorite AI tool:
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '32px',
        }}
      >
        {[
          { title: 'Claude Code', desc: 'Add opengov-mcp to your ~/.claude/settings.json' },
          { title: 'Cursor', desc: 'Configure MCP servers in Cursor settings' },
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
            <h4 style={{ fontSize: '18px', marginBottom: '8px' }}>{item.title}</h4>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
              {item.desc}
            </p>
          </div>
        ))}
      </div>

      <div
        style={{
          backgroundColor: 'rgba(112, 186, 255, 0.15)',
          borderRadius: '4px',
          padding: '24px',
          marginBottom: '64px',
        }}
      >
        <h3 style={{ fontSize: '20px', marginBottom: '12px' }}>Get started</h3>
        <p
          style={{
            fontSize: '16px',
            color: 'var(--text-secondary)',
            marginBottom: '16px',
          }}
        >
          Check out the civic-ai-tools repository for setup instructions
          and documentation.
        </p>
        <a
          href="https://github.com/npstorey/civic-ai-tools"
          target="_blank"
          rel="noopener noreferrer"
          className="nyc-button nyc-button-primary"
          style={{ textDecoration: 'none' }}
        >
          View on GitHub
        </a>
      </div>

      <h2 style={{ marginBottom: '24px' }}>Learn more about MCP</h2>

      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          fontSize: '18px',
          marginBottom: '48px',
        }}
      >
        <li>
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
          >
            modelcontextprotocol.io
          </a>
          {' '}- Official MCP documentation
        </li>
        <li>
          <a
            href="https://github.com/modelcontextprotocol"
            target="_blank"
            rel="noopener noreferrer"
          >
            MCP GitHub
          </a>
          {' '}- SDKs and specifications
        </li>
      </ul>

      <div
        style={{
          paddingTop: '32px',
          borderTop: '1px solid var(--border-color)',
        }}
      >
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          &larr; Back to demo
        </Link>
      </div>
    </div>
  );
}
