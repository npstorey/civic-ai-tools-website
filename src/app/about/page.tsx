import Link from 'next/link';

export const metadata = {
  title: 'About - Civic AI Tools',
  description: 'Learn how to get better results from AI when working with civic data.',
};

export default function AboutPage() {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ marginBottom: '16px' }}>Getting Better Results from AI</h1>

      <p
        style={{
          fontSize: '20px',
          lineHeight: '150%',
          color: 'var(--text-secondary)',
          marginBottom: '48px',
        }}
      >
        When using AI to explore civic data, several factors affect the quality of
        responses. Understanding these factors helps you get more accurate, useful results.
      </p>

      {/* Factors Section */}
      <h2 style={{ marginBottom: '24px' }}>What Affects AI Response Quality?</h2>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
          marginBottom: '64px',
        }}
      >
        {/* Factor 1: Model Selection */}
        <div
          style={{
            backgroundColor: 'var(--card-background)',
            borderRadius: '4px',
            padding: '24px',
          }}
        >
          <h3 style={{ fontSize: '20px', marginBottom: '12px' }}>
            1. Model Selection
          </h3>
          <p
            style={{
              fontSize: '16px',
              color: 'var(--text-secondary)',
              marginBottom: '12px',
            }}
          >
            Different AI models have different strengths. When choosing a model, consider:
          </p>
          <ul
            style={{
              paddingLeft: '20px',
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: '16px',
              color: 'var(--text-secondary)',
            }}
          >
            <li><strong>Speed vs. quality</strong> - Faster models may sacrifice accuracy</li>
            <li><strong>Cost</strong> - Premium models cost more per query</li>
            <li><strong>Reasoning ability</strong> - Complex queries need capable models</li>
            <li><strong>Tool calling</strong> - Not all models reliably use external tools</li>
          </ul>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-muted)',
              marginTop: '12px',
              fontStyle: 'italic',
            }}
          >
            This demo lets you compare different models on the same query.
          </p>
        </div>

        {/* Factor 2: System Prompts & Skills */}
        <div
          style={{
            backgroundColor: 'var(--card-background)',
            borderRadius: '4px',
            padding: '24px',
          }}
        >
          <h3 style={{ fontSize: '20px', marginBottom: '12px' }}>
            2. System Prompts &amp; Skills
          </h3>
          <p
            style={{
              fontSize: '16px',
              color: 'var(--text-secondary)',
              marginBottom: '12px',
            }}
          >
            System prompts provide domain knowledge that guides the AI. A &quot;skill&quot; is
            a curated prompt that teaches the model about a specific domain:
          </p>
          <ul
            style={{
              paddingLeft: '20px',
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: '16px',
              color: 'var(--text-secondary)',
            }}
          >
            <li><strong>Dataset IDs</strong> - Known identifiers for common datasets</li>
            <li><strong>Query syntax</strong> - SoQL functions that Socrata supports</li>
            <li><strong>Field names</strong> - Exact column names (case-sensitive)</li>
            <li><strong>Anti-hallucination rules</strong> - &quot;Never make up data&quot;</li>
          </ul>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-muted)',
              marginTop: '12px',
              fontStyle: 'italic',
            }}
          >
            The opengov-mcp skill teaches models how to query Socrata APIs correctly.
          </p>
        </div>

        {/* Factor 3: Orchestration Environment */}
        <div
          style={{
            backgroundColor: 'var(--card-background)',
            borderRadius: '4px',
            padding: '24px',
          }}
        >
          <h3 style={{ fontSize: '20px', marginBottom: '12px' }}>
            3. Orchestration Environment
          </h3>
          <p
            style={{
              fontSize: '16px',
              color: 'var(--text-secondary)',
              marginBottom: '16px',
            }}
          >
            Where you run AI affects what&apos;s possible:
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '15px',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Environment</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Best For</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Limitations</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--text-secondary)' }}>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '8px 12px' }}>Browser (this demo)</td>
                  <td style={{ padding: '8px 12px' }}>Quick queries, exploration</td>
                  <td style={{ padding: '8px 12px' }}>Rate limits, simple queries only</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '8px 12px' }}>IDE (Cursor)</td>
                  <td style={{ padding: '8px 12px' }}>Code integration, analysis</td>
                  <td style={{ padding: '8px 12px' }}>Requires local setup</td>
                </tr>
                <tr>
                  <td style={{ padding: '8px 12px' }}>CLI (Claude Code)</td>
                  <td style={{ padding: '8px 12px' }}>Complex multi-step analysis</td>
                  <td style={{ padding: '8px 12px' }}>Requires local setup</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-muted)',
              marginTop: '12px',
              fontStyle: 'italic',
            }}
          >
            For complex, multi-step analysis, use an IDE or CLI environment.
          </p>
        </div>

        {/* Factor 4: Tools & MCPs */}
        <div
          style={{
            backgroundColor: 'var(--card-background)',
            borderRadius: '4px',
            padding: '24px',
          }}
        >
          <h3 style={{ fontSize: '20px', marginBottom: '12px' }}>
            4. Tools &amp; MCPs
          </h3>
          <p
            style={{
              fontSize: '16px',
              color: 'var(--text-secondary)',
              marginBottom: '16px',
            }}
          >
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noopener noreferrer"
            >
              Model Context Protocol (MCP)
            </a>{' '}
            allows AI to connect to external data sources instead of relying on training data:
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '16px',
            }}
          >
            <div
              style={{
                backgroundColor: 'var(--background)',
                borderRadius: '4px',
                padding: '16px',
                border: '1px solid var(--nyc-error)',
              }}
            >
              <h4
                style={{
                  fontSize: '16px',
                  color: 'var(--nyc-error)',
                  marginBottom: '8px',
                }}
              >
                Without MCP
              </h4>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  fontSize: '14px',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <li>- Limited to training data</li>
                <li>- May hallucinate statistics</li>
                <li>- Cannot verify claims</li>
              </ul>
            </div>

            <div
              style={{
                backgroundColor: 'rgba(0, 183, 3, 0.1)',
                borderRadius: '4px',
                padding: '16px',
                border: '1px solid var(--nyc-success)',
              }}
            >
              <h4
                style={{
                  fontSize: '16px',
                  color: 'var(--nyc-success)',
                  marginBottom: '8px',
                }}
              >
                With MCP
              </h4>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  fontSize: '14px',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <li>- Access to live data</li>
                <li>- Queries actual databases</li>
                <li>- Cites specific datasets</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* How MCP Works */}
      <h2 style={{ marginBottom: '24px' }}>How MCP Works</h2>

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

      {/* About This Demo */}
      <h2 style={{ marginBottom: '24px' }}>About This Demo</h2>

      <p
        style={{
          fontSize: '18px',
          color: 'var(--text-secondary)',
          marginBottom: '64px',
        }}
      >
        This demo shows side-by-side comparisons of the same question answered
        with and without MCP. The &quot;With MCP&quot; response connects to the{' '}
        <a
          href="https://github.com/npstorey/civic-ai-tools"
          target="_blank"
          rel="noopener noreferrer"
        >
          opengov-mcp-server
        </a>
        , which provides access to Socrata open data portals from cities
        like New York, Chicago, and San Francisco.
      </p>

      {/* Try It Yourself */}
      <h2 style={{ marginBottom: '24px' }}>Try It Yourself</h2>

      <p
        style={{
          fontSize: '18px',
          color: 'var(--text-secondary)',
          marginBottom: '24px',
        }}
      >
        This demo has rate limits. For unlimited access and complex analysis,
        set up MCP locally:
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
          { title: 'Claude Code', desc: 'Add opengov-mcp to ~/.claude/settings.json' },
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
        <h3 style={{ fontSize: '20px', marginBottom: '12px' }}>Get Started</h3>
        <p
          style={{
            fontSize: '16px',
            color: 'var(--text-secondary)',
            marginBottom: '16px',
          }}
        >
          Check out the civic-ai-tools repository for setup instructions and documentation.
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

      {/* Learn More */}
      <h2 style={{ marginBottom: '24px' }}>Learn More</h2>

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
        <li>
          <a
            href="https://github.com/npstorey/civic-ai-tools"
            target="_blank"
            rel="noopener noreferrer"
          >
            civic-ai-tools
          </a>
          {' '}- OpenGov MCP server and skills
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
