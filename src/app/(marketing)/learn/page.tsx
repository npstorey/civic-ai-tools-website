import Link from 'next/link';
import { prose, sectionHeading, sectionSpacing, calloutBox, excerptBlock, card } from '@/styles/page-styles';
import { pageTitle } from '@/lib/brand-config';

export const metadata = {
  title: pageTitle('Learn'),
  description: 'Learn how this demo works, how AI connects to live civic data through MCP, and what shapes the quality of AI responses.',
};

const GITHUB_SKILL_URL = 'https://github.com/npstorey/civic-ai-tools/tree/main/packages/civic-typed-router/src/civic';
const GITHUB_STREAMING_BASE = 'https://github.com/npstorey/civic-ai-tools-website/blob/08dfa4c/src/lib/streaming.ts';

export default function LearnPage() {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px' }}>

      {/* ============================================================
          Section 1: What You Just Saw
          ============================================================ */}
      <section id="intro" style={sectionSpacing}>
        <h1 style={{ marginBottom: '16px' }}>What You Just Saw</h1>

        <p style={{ fontSize: '20px', lineHeight: '150%', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          This demo runs the same question through the same AI model twice &mdash; once
          with only its training knowledge, once with live access to open data
          portals through a protocol called MCP (Model Context Protocol).
        </p>
        <p style={prose}>
          The side-by-side comparison reveals something important: for factual
          questions about civic data, an AI without access to current open data portals
          will hedge, generalize, and sometimes fabricate specifics. The same AI
          with structured data access can cite real numbers from real datasets.
        </p>
        <p style={prose}>
          This page explains how that works &mdash; and why it matters for anyone who
          cares about trustworthy civic information.
        </p>
        <p style={prose}>
          Responses can be published as <Link href="/records">signed record packages</Link> &mdash;
          cryptographically signed, timestamped, and independently verifiable records of the question,
          tool calls, data sources, and model output. Browse the{' '}
          <Link href="/records">record index</Link> to see published analyses.
        </p>
      </section>

      {/* ============================================================
          Section 2: Why the Answers Are Different
          ============================================================ */}
      <section id="why-different" style={sectionSpacing}>
        <h2 style={sectionHeading}>Why the Answers Are Different</h2>

        {/* Comparison cards — keep existing red/green design */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--background)',
              borderRadius: '4px',
              padding: '16px',
              border: '1px solid var(--error)',
            }}
          >
            <h4 style={{ fontSize: '16px', color: 'var(--error)', marginBottom: '8px' }}>
              Without Data Tools
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
              border: '1px solid var(--success)',
            }}
          >
            <h4 style={{ fontSize: '16px', color: 'var(--success)', marginBottom: '8px' }}>
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
              <li>- Queries live databases directly</li>
              <li>- Returns structured, verifiable data</li>
              <li>- Cites specific datasets and records</li>
            </ul>
          </div>
        </div>

        <p style={prose}>
          AI models have a <strong>training data cutoff</strong> &mdash; their knowledge is frozen at a point in
          time. When asked about current government records, a model without data access has no choice
          but to draw on whatever it absorbed during training. This often means hedging with phrases
          like &ldquo;as of my last update&rdquo; or, worse, generating plausible-sounding but entirely
          fabricated statistics &mdash; a phenomenon called <strong>hallucination</strong>.
        </p>
        <p style={prose}>
          <strong>Tool augmentation</strong> changes this dynamic. MCP gives the AI structured access to live
          databases, so instead of guessing, it can query actual records &mdash; running the same kind of
          structured queries a data analyst would write. Each tool call adds real data to the
          AI&apos;s working memory, building up evidence before generating an answer.
        </p>
        <p style={prose}>
          Context windows are finite, which is why the AI must be selective about what data it
          requests. This is visible in the step-by-step progression users see in the demo: the AI
          searches for datasets, examines their structure, then constructs targeted queries rather
          than trying to retrieve everything at once.
        </p>

        <div style={calloutBox}>
          In the demo results, expand &ldquo;How was the AI guided?&rdquo; to see the specific
          instructions and domain knowledge that shaped the AI&apos;s approach to your question.
        </div>
      </section>

      {/* ============================================================
          Section 3: How MCP Connects AI to Data
          ============================================================ */}
      <section id="how-mcp-works" style={sectionSpacing}>
        <h2 style={sectionHeading}>How MCP Connects AI to Data</h2>

        <p style={prose}>
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">
            MCP (Model Context Protocol)
          </a>{' '}
          is an open standard that gives AI models structured access to external tools and data
          sources. In a similar way that web search tools connect AI to live website data, MCP
          connects AI models to live government data portals. But unlike web search, which
          retrieves articles <em>about</em> data, MCP lets the AI query databases
          directly &mdash; running the same kind of structured queries a data analyst would write.
        </p>
        <p style={prose}>
          When you ask a question in the demo, the AI searches a catalog of civic datasets, examines
          their structure, then constructs targeted queries &mdash; all through a series of tool calls
          that flow between the AI, the MCP server, and the underlying data portals. The demo
          connects to two MCP servers: the{' '}
          <a href="https://github.com/npstorey/socrata-mcp-server" target="_blank" rel="noopener noreferrer">
            Socrata MCP server
          </a>
          {' '}for open data portals in New York, Chicago, and San Francisco, and Google&apos;s{' '}
          <a href="https://docs.datacommons.org/mcp/" target="_blank" rel="noopener noreferrer">
            Data Commons MCP server
          </a>
          {' '}for US Census / ACS demographic and economic statistics. Tool calls are routed by name,
          so a single response can combine city service data with federal statistical data.
        </p>

        <Link
          href="/explore"
          className="ui-button ui-button-primary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            textDecoration: 'none',
            marginTop: '8px',
          }}
        >
          Watch it in action &rarr;
        </Link>
      </section>

      {/* ============================================================
          Section 4: What the AI Was Told Before You Asked
          ============================================================ */}
      <section id="system-prompt" style={sectionSpacing}>
        <h2 style={sectionHeading}>What the AI Was Told Before You Asked</h2>

        <p style={prose}>
          Every AI response is shaped by instructions most users never see.
          In this demo, the AI receives a detailed &ldquo;skill prompt&rdquo; that provides
          domain knowledge and behavioral rules. Here are the key components
          and why each part matters.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '24px' }}>
          {/* Category 1: Known datasets */}
          <SkillCategory
            title="Known datasets and fields"
            explanation={
              'The AI is pre-loaded with identifiers for common civic datasets so it doesn\'t have to discover them from scratch. This mirrors how a human analyst builds institutional knowledge over time.'
            }
            excerpt={`## NYC KEY DATASETS (data.cityofnewyork.us)
| Dataset | ID | Key Fields |
|---------|-----|------------|
| 311 Service Requests | erm2-nwe9 | complaint_type, borough, created_date |
| Restaurant Inspections | 43nn-pn8j | boro, grade, inspection_date |
| Housing Violations | wvxf-dwi5 | boro, violationid, inspectiondate |
| Budget Data | d52a-yn36 | agency_name, budget_amount, fiscal_year |
| Payroll Data | k397-673e | agency_name, title_description, base_salary |

## CHICAGO KEY DATASETS (data.cityofchicago.org)
| 311 Service Requests | v6vf-nfxy | sr_type, created_date, community_area |

## SF KEY DATASETS (data.sf.gov)
| 311 Cases | vw6y-z8j6 | requested_datetime, service_name, analysis_neighborhood |`}
          />

          {/* Category 2: Query syntax */}
          <SkillCategory
            title="Query syntax guidance"
            explanation={
              "Socrata's query language (SoQL) has quirks that differ from standard SQL \u2014 date functions, text search operators, pagination limits. The AI is taught these so it doesn't write queries that fail."
            }
            excerpt={`## SoQL PATTERNS
- Aggregation: "select": "complaint_type, COUNT(*) as count",
  "group": "complaint_type", "order": "count DESC"
- Date filter: "where": "created_date >= '2024-01-01'"
- Text search: "where": "complaint_type ILIKE '%noise%'"

## SoQL DATE FUNCTIONS (NOT standard SQL!)
- date_trunc_ym(date_field)  \u2192 Year-month truncation
- date_extract_y(date_field) \u2192 Extract year
- date_extract_m(date_field) \u2192 Extract month
- IMPORTANT: Do NOT use DATE_TRUNC(), EXTRACT(), MONTH(), YEAR()`}
          />

          {/* Category 3: Anti-hallucination */}
          <SkillCategory
            title="Anti-hallucination rules"
            explanation="The AI is explicitly instructed to never fabricate data and to cite dataset identifiers for every claim. This is the most important instruction in the entire prompt."
            excerpt={`## CRITICAL REQUIREMENTS
- NEVER hallucinate data - only report what tool calls actually return
- ALWAYS discover columns first with SELECT * LIMIT 1
  before querying unfamiliar datasets
- Show the queries you used
- Field names are CASE-SENSITIVE`}
          />

          {/* Category 4: Workflow */}
          <SkillCategory
            title="Workflow guidance"
            explanation="The AI is told to follow a progression: search the catalog first, then examine metadata, then construct queries. This structured approach mirrors how a careful analyst works."
            excerpt={`## WORKFLOW
1. Use type="catalog" to find datasets, OR use known dataset IDs
2. Use type="query" with "select": "*", "limit": 1 to discover columns
3. Use type="query" with proper filters based on actual column names`}
          />
        </div>

        <div style={calloutBox}>
          You can see a summary of these instructions directly in the demo results &mdash; look
          for the &ldquo;How was the AI guided?&rdquo; section below each MCP response.
        </div>

        <p style={{ fontSize: '14px', marginTop: '12px' }}>
          <a href={GITHUB_SKILL_URL} target="_blank" rel="noopener noreferrer">
            View the complete system prompt &rarr;
          </a>
        </p>
      </section>

      {/* ============================================================
          Section 5: How Step Descriptions Are Generated
          ============================================================ */}
      <section id="narration" style={sectionSpacing}>
        <h2 style={sectionHeading}>How We Describe What the AI Does</h2>

        <p style={prose}>
          The step-by-step narration you see during the AI&apos;s data retrieval process
          isn&apos;t written by the AI itself &mdash; it&apos;s generated by our interface code
          that translates raw API calls into readable descriptions.
        </p>
        <p style={prose}>
          Three functions handle this translation:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
          <NarrationLayer
            title="What's happening"
            functionName="formatToolProgress"
            githubLines="#L585-L623"
            description='Translates the raw tool call into an action description.'
            example={{
              raw: 'socrata__get_data({ type: "catalog", query: "restaurant inspections", portal: "data.cityofnewyork.us" })',
              displayed: 'Searching NYC data catalog: "restaurant inspections"',
            }}
          />
          <NarrationLayer
            title="What was found"
            functionName="formatToolResult"
            githubLines="#L950-L993"
            description="Summarizes the data returned by each tool call."
            example={{
              raw: '{ results: [...], count: 5 }',
              displayed: 'Found 5 datasets matching the search',
            }}
          />
          <NarrationLayer
            title="Why this step"
            functionName="generateToolReason"
            githubLines="#L1000-L1035"
            description='Explains the purpose of the step in the overall workflow.'
            example={{
              raw: '(the same catalog call)',
              displayed: 'to find datasets about "restaurant inspections"',
            }}
          />
        </div>

        <p style={prose}>
          This is worth understanding because it illustrates a broader point: every AI interface
          involves interpretation layers between what the AI actually does and what you see. A
          well-designed interface makes the AI&apos;s work comprehensible without distorting it.
          We&apos;ve tried to be transparent about exactly where and how we do this translation.
        </p>
        <p style={{ ...prose, fontSize: '14px', fontStyle: 'italic', color: 'var(--text-muted)' }}>
          This is similar to how a chart is an interpretation of raw numbers &mdash; the data is real,
          but the presentation is a design choice.
        </p>

        <div style={calloutBox}>
          In the demo, click &ldquo;How is this narration generated?&rdquo; near the step
          summary to see this explanation in context.
        </div>
      </section>

      {/* ============================================================
          Section 6: What Affects Response Quality
          ============================================================ */}
      <section id="quality-factors" style={sectionSpacing}>
        <h2 style={sectionHeading}>What Affects Response Quality</h2>

        <p style={prose}>
          Several additional factors affect the quality of AI responses beyond data access.
          These factors affect every query, whether you&apos;re exploring data on this site or building your own tools.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Model Selection */}
          <div style={card}>
            <h3 style={{ fontSize: '18px', marginBottom: '12px' }}>Model Selection</h3>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Different AI models have different strengths. When choosing a model, consider:
            </p>
            <ul
              style={{
                paddingLeft: '20px',
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontSize: '15px',
                color: 'var(--text-secondary)',
              }}
            >
              <li><strong>Speed vs. quality</strong> &mdash; Faster models may sacrifice accuracy</li>
              <li><strong>Cost</strong> &mdash; Premium models cost more per query</li>
              <li><strong>Reasoning ability</strong> &mdash; Complex queries need capable models</li>
              <li><strong>Tool calling</strong> &mdash; Not all models reliably use external tools</li>
              <li><strong>Ethical considerations</strong> &mdash; AI model providers have different approaches to data privacy, environmental impact, and labor practices. Consider these factors alongside performance when choosing a model.</li>
            </ul>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '12px', fontStyle: 'italic' }}>
              This demo lets you compare different models on the same query.
            </p>
          </div>

          {/* Orchestration Environment */}
          <div style={card}>
            <h3 style={{ fontSize: '18px', marginBottom: '12px' }}>Orchestration Environment</h3>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Where you run AI affects what&apos;s possible:
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
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
          </div>

          {/* Context Management */}
          <div style={card}>
            <h3 style={{ fontSize: '18px', marginBottom: '12px' }}>Context Management</h3>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: 0 }}>
              LLMs have a finite context window. System prompts, conversation history, tool results,
              and the response itself all compete for that space. This demo uses a fresh context for
              each query, maximizing room for reasoning. In longer sessions (Claude Code, Cursor),
              older context is automatically summarized to free space &mdash; which is one reason why the same
              query can produce different results in different environments.
            </p>
          </div>
        </div>
      </section>

      {/* ============================================================
          Section 6b: Model Selection
          ============================================================ */}
      <section id="model-selection" style={sectionSpacing}>
        <h2 style={sectionHeading}>Model Selection</h2>

        <p style={prose}>
          In October 2026 we ran nine AI models on 14 of the civic data questions first used in
          March, and scored every answer against a rubric and against figures read directly from
          the data portals. The demo offers three of the four models that led:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
          <div style={card}>
            <h4 style={{ fontSize: '16px', marginBottom: '6px' }}>Claude Haiku 5.5 (recommended)</h4>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6' }}>
              The model the demo starts on. In the October 2026 run it got the main answer right on 8
              of 11 questions, and partly right on the other three, at about half a cent a question in
              that run: under a tenth of what the other two cost. It was also the fastest of the three, with a
              median of 15 seconds.
            </p>
          </div>

          <div style={card}>
            <h4 style={{ fontSize: '16px', marginBottom: '6px' }}>Claude Sonnet 5.5 (balanced)</h4>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6' }}>
              Stronger analysis at moderate cost: the main answer right on 9 of 11 questions, with
              careful caveats, at about 11 cents a question and a median of 21 seconds.
            </p>
          </div>

          <div style={card}>
            <h4 style={{ fontSize: '16px', marginBottom: '6px' }}>Claude Opus 5.5 (premium)</h4>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6' }}>
              The highest quality score in the October 2026 run, with the main answer right on all 11
              questions. It is the slowest of the three (a median of 27 seconds) and costs about 21
              cents a question: worth it for complex or multi-step questions.
            </p>
          </div>
        </div>

        <p style={prose}>
          When an author publishes a record they had kept private, a second model first reviews the
          analysis against a fixed checklist: Claude Sonnet 5.5, or Claude Opus 5.5 when Sonnet 5.5
          wrote the analysis. Records published earlier with GPT-4o or GPT-5.4 keep those model
          names.
        </p>

        <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
          Full evaluation methodology and results (October 2026):{' '}
          <a
            href="https://github.com/npstorey/civic-ai-tools-website/blob/main/docs/model-evaluation-2026-10.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            model-evaluation-2026-10.md
          </a>
          . The earlier evaluation (March 2026):{' '}
          <a
            href="https://github.com/npstorey/civic-ai-tools/blob/main/docs/research/model-evaluation-results.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            model-evaluation-results.md
          </a>
        </p>
      </section>

      {/* ============================================================
          Section 7: Understanding AI Limitations
          ============================================================ */}
      <section id="ai-limitations" style={sectionSpacing}>
        <h2 style={sectionHeading}>Understanding AI Limitations</h2>

        <p style={prose}>
          Even with live data access, AI responses can contain errors. This is inherent
          to how large language models work &mdash; they generate text that <em>sounds</em> right,
          which sometimes means it <em>isn&apos;t</em> right. In AI research, this is
          called <strong>hallucination</strong>: the model produces plausible but incorrect information.
        </p>

        <p style={prose}>
          With civic data queries, common failure patterns include:
        </p>
        <ul
          style={{
            paddingLeft: '20px',
            margin: '0 0 16px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontSize: '15px',
            color: 'var(--text-secondary)',
            lineHeight: '1.6',
          }}
        >
          <li><strong>Inventing data points</strong> &mdash; reporting numbers that weren&apos;t in the query results</li>
          <li><strong>Misattributing numbers</strong> &mdash; assigning a value to the wrong column, borough, or time period</li>
          <li><strong>False confidence from small samples</strong> &mdash; describing trends from a few data points as if they&apos;re definitive</li>
          <li><strong>Wrong query syntax</strong> &mdash; generating SoQL with incorrect column names or unsupported functions, leading to errors or misleading results</li>
          <li><strong>Mixing up datasets</strong> &mdash; conflating results from different datasets when multiple are queried in one session</li>
        </ul>

        <p style={prose}>
          Our system prompt includes anti-hallucination rules (never invent data, always cite sources,
          discover columns before querying) and uncertainty guidelines (state date ranges, flag
          field interpretation assumptions, disclose limitations). These significantly reduce errors
          but cannot eliminate them entirely &mdash; the model can still misread data or draw
          unsupported conclusions.
        </p>

        <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>Best practices for users</h3>
        <ul
          style={{
            paddingLeft: '20px',
            margin: '0 0 16px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontSize: '15px',
            color: 'var(--text-secondary)',
            lineHeight: '1.6',
          }}
        >
          <li>Spot-check key numbers by clicking through to the linked dataset</li>
          <li>Be skeptical of precise percentages &mdash; the AI may round or compute incorrectly</li>
          <li>Verify that the date range in the response matches what you asked for</li>
          <li>Treat AI analysis as a starting point for investigation, not a final answer</li>
        </ul>

        <div style={calloutBox}>
          The source provenance line below each MCP response links directly to the datasets used.
          Click through to verify the data yourself.
        </div>
      </section>

      {/* ============================================================
          Section 8: See It in Action
          ============================================================ */}
      <section id="try-it" style={sectionSpacing}>
        <h2 style={sectionHeading}>See It in Action</h2>

        <p style={prose}>
          Try these queries in the demo to see different capabilities:
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '12px',
            marginBottom: '40px',
          }}
        >
          {[
            {
              query: 'Most common 311 complaints in NYC',
              capability: 'Catalog search and simple aggregation',
            },
            {
              query: 'Compare restaurant inspection grades across boroughs',
              capability: 'Multi-step iteration and grouping',
            },
            {
              query: 'Noise complaints in Brooklyn in 2024',
              capability: 'Date filtering and geographic specificity',
            },
            {
              query: 'How do housing violations in Brooklyn compare to Manhattan?',
              capability: 'Cross-category comparison',
            },
            {
              query: 'Median household income: NYC vs SF',
              capability: 'Data Commons: Census / ACS statistics',
            },
          ].map((item, idx) => (
            <Link
              key={idx}
              href={`/?q=${encodeURIComponent(item.query)}`}
              className="query-suggestion-card"
              style={{
                display: 'block',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '14px 16px',
                textDecoration: 'none',
                color: 'inherit',
                transition: 'border-color 0.15s, background-color 0.15s',
              }}
            >
              <p style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 600, color: 'var(--accent)' }}>
                &ldquo;{item.query}&rdquo;
              </p>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                {item.capability}
              </p>
            </Link>
          ))}
        </div>

        {/* Set up locally */}
        <h3 style={{ fontSize: '18px', marginBottom: '12px' }}>Set Up Locally</h3>
        <p style={{ ...prose, marginBottom: '24px' }}>
          This demo has rate limits. For unlimited access and complex multi-step analysis,
          set up MCP locally:
        </p>

        {/* Claude Desktop config */}
        <div
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <h4 style={{ fontSize: '18px', marginBottom: '8px' }}>Claude Desktop</h4>
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
              <h4 style={{ fontSize: '18px', marginBottom: '8px' }}>{item.title}</h4>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
                {item.desc}
              </p>
            </div>
          ))}
        </div>

        <p style={{ ...prose, fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px' }}>
          <strong>Note:</strong> ChatGPT does not currently support MCP natively.
          For the full MCP experience, use{' '}
          <a href="https://claude.ai/download" target="_blank" rel="noopener noreferrer">Claude Desktop</a>,{' '}
          <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer">Claude Code</a>, or{' '}
          <a href="https://cursor.com" target="_blank" rel="noopener noreferrer">Cursor</a>.
          See the{' '}
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">MCP docs</a>{' '}
          for the full list of compatible clients.
        </p>

        <div
          style={{
            backgroundColor: 'rgba(112, 186, 255, 0.15)',
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

      {/* ============================================================
          Section 8: Learn More
          ============================================================ */}
      <section id="learn-more">
        <h2 style={sectionHeading}>Learn More</h2>

        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontSize: '16px',
            marginBottom: '48px',
          }}
        >
          <li>
            <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">
              modelcontextprotocol.io
            </a>
            {' '}&mdash; Official MCP documentation
          </li>
          <li>
            <a href="https://github.com/modelcontextprotocol" target="_blank" rel="noopener noreferrer">
              MCP GitHub
            </a>
            {' '}&mdash; SDKs and specifications
          </li>
          <li>
            <a href="https://github.com/npstorey/civic-ai-tools" target="_blank" rel="noopener noreferrer">
              civic-ai-tools
            </a>
            {' '}&mdash; Socrata MCP server configs and skills
          </li>
          <li>
            <a href="https://github.com/npstorey/socrata-mcp-server" target="_blank" rel="noopener noreferrer">
              socrata-mcp-server
            </a>
            {' '}&mdash; The MCP server itself (Socrata data)
          </li>
          <li>
            <a href="https://dev.socrata.com" target="_blank" rel="noopener noreferrer">
              Socrata Developer Docs
            </a>
            {' '}&mdash; SoQL query reference and API documentation
          </li>
        </ul>

        <div style={{ paddingTop: '32px', borderTop: '1px solid var(--border-color)' }}>
          <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            &larr; Back to demo
          </Link>
        </div>
      </section>
    </div>
  );
}

/* ================================================================
   Helper components (server components — no 'use client' needed)
   ================================================================ */

function SkillCategory({
  title,
  explanation,
  excerpt,
}: {
  title: string;
  explanation: string;
  excerpt: string;
}) {
  return (
    <div>
      <h4 style={{ fontSize: '16px', marginBottom: '6px' }}>{title}</h4>
      <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: '0 0 4px 0', lineHeight: '1.6' }}>
        {explanation}
      </p>
      <pre style={excerptBlock}>{excerpt}</pre>
    </div>
  );
}

function NarrationLayer({
  title,
  functionName,
  githubLines,
  description,
  example,
}: {
  title: string;
  functionName: string;
  githubLines: string;
  description: string;
  example: { raw: string; displayed: string };
}) {
  return (
    <div style={{ ...card, padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
        <span style={{ fontSize: '15px', fontWeight: 600 }}>{title}</span>
        <a
          href={`${GITHUB_STREAMING_BASE}${githubLines}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontFamily: 'monospace', fontSize: '13px', color: 'var(--accent)' }}
        >
          {functionName}
        </a>
      </div>
      <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: '0 0 8px 0' }}>
        {description}
      </p>
      <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
        <div style={{ color: 'var(--text-muted)' }}>
          <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{example.raw}</span>
        </div>
        <div style={{ color: 'var(--success)', fontWeight: 500, marginTop: '2px' }}>
          &rarr; &ldquo;{example.displayed}&rdquo;
        </div>
      </div>
    </div>
  );
}
