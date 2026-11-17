import Link from 'next/link';
import { prose, sectionHeading, sectionSpacing, calloutBox, card } from '@/styles/page-styles';
import { pageTitle } from '@/lib/brand-config';
import { Page } from '@/components/ui/Page';
import { PageToc } from '@/components/ui/PageToc';
import { STREAMING_SOURCE_BASE, STREAMING_SOURCE_LINES } from '@/lib/streaming-source-links';
import { buildFlowsStatement } from '@/lib/flows/statement';
import { sourcesSentence } from '@/lib/flows/sources-sentence';

export const metadata = {
  title: pageTitle('Learn'),
  description: 'Learn how this site works, how AI connects to live civic data through MCP, and what shapes the quality of AI responses.',
};

const GITHUB_SKILL_URL = 'https://github.com/npstorey/civic-ai-tools/tree/main/packages/civic-typed-router/src/civic';

// The page's sections: each id and h2 written once, read by the section and by
// the jump list (UX-1 P7: nine h2s, so the page has one). The ids are linked
// from elsewhere on the site (`/learn#try-it`, `#narration`, ...) and stay.
const SECTIONS = {
  whyDifferent: { id: 'why-different', heading: 'Why the Answers Are Different' },
  howItConnects: { id: 'how-mcp-works', heading: 'How data tools connect AI to data' },
  systemPrompt: { id: 'system-prompt', heading: 'What the AI Was Told Before You Asked' },
  narration: { id: 'narration', heading: 'How We Describe What the AI Does' },
  qualityFactors: { id: 'quality-factors', heading: 'What Affects Response Quality' },
  modelSelection: { id: 'model-selection', heading: 'Model Selection' },
  aiLimitations: { id: 'ai-limitations', heading: 'Understanding AI Limitations' },
  tryIt: { id: 'try-it', heading: 'See It in Action' },
  learnMore: { id: 'learn-more', heading: 'Learn More' },
} as const;

export default async function LearnPage() {
  // P10-11: the sources sentence, read from this instance's statement when the page renders (at build: the page is
  // static), never typed.
  const statement = await buildFlowsStatement();
  return (
    <Page
      width="reading"
      title="What You Just Saw"
      lede={
        <>
          The home page asks one AI model the same question twice. Once it answers from its training alone; once it
          reads live public data through MCP, the Model Context Protocol.
        </>
      }
    >
      <PageToc
        label="Sections of this page"
        items={Object.values(SECTIONS).map((section) => ({ id: section.id, label: section.heading }))}
      />

      {/* ============================================================
          Section 1: What You Just Saw
          ============================================================ */}
      <section id="intro" style={sectionSpacing}>
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
          Responses can be published as <Link href="/records">signed analyses</Link> &mdash;
          cryptographically signed, timestamped, and independently verifiable records of the question,
          tool calls, data sources, and model output. Browse the{' '}
          <Link href="/records">Analysis page</Link> to see published analyses.
        </p>
      </section>

      {/* ============================================================
          Section 2: Why the Answers Are Different
          ============================================================ */}
      <section id={SECTIONS.whyDifferent.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.whyDifferent.heading}</h2>

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
            <h3 style={{ fontSize: '16px', color: 'var(--error)', marginBottom: '8px' }}>
              Without data tools
            </h3>
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
            <h3 style={{ fontSize: '16px', color: 'var(--success)', marginBottom: '8px' }}>
              With data tools
            </h3>
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
          requests. This is visible in the step-by-step progression users see on this site: the AI
          searches for datasets, examines their structure, then constructs targeted queries rather
          than trying to retrieve everything at once.
        </p>

        <div style={calloutBox}>
          In this site&apos;s results, expand &ldquo;How was the AI guided?&rdquo; to see the specific
          instructions and domain knowledge that shaped the AI&apos;s approach to your question.
        </div>
      </section>

      {/* ============================================================
          Section 3: How data tools connect AI to data
          ============================================================ */}
      <section id={SECTIONS.howItConnects.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.howItConnects.heading}</h2>

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
        {/* P10-32 (C1 = A), with P10-11 read from the statement; its last sentence only where it lists two or more. */}
        <p style={prose}>
          When you ask a question here, the AI searches catalogs of public datasets, examines their structure, then
          runs targeted queries. Each step is a tool call from the AI to a data source, which reads the data behind it.{' '}
          {sourcesSentence(statement.sources)}
          {statement.sources.length >= 2 ? ' Tool calls are routed by name, so one answer can combine data from more than one source.' : null}
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
      <section id={SECTIONS.systemPrompt.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.systemPrompt.heading}</h2>

        {/* P10-33 (C1 = A; top change 6): the instructions without their excerpts; the rule in its third sentence is in
            the instructions the link opens (criterion 16). */}
        <p style={prose}>
          Every AI answer is shaped by instructions most readers never see. Before your question, the AI here is given
          knowledge about datasets and a set of rules. One of the rules: report only what the data tools return, and
          never invent data.
        </p>

        <div style={calloutBox}>
          You can see a summary of these instructions under each answer that used data tools. Look for the
          &ldquo;How was the AI guided?&rdquo; section.
        </div>

        <p style={{ fontSize: '14px', marginTop: '12px' }}>
          <a href={GITHUB_SKILL_URL} target="_blank" rel="noopener noreferrer">
            Read the full instructions
          </a>
        </p>
      </section>

      {/* ============================================================
          Section 5: How Step Descriptions Are Generated
          ============================================================ */}
      <section id={SECTIONS.narration.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.narration.heading}</h2>

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
            githubLines={STREAMING_SOURCE_LINES.formatToolProgress}
            description='Translates the raw tool call into an action description.'
            example={{
              raw: 'socrata__get_data({ type: "catalog", query: "restaurant inspections", portal: "data.cityofnewyork.us" })',
              displayed: 'Searching NYC data catalog: "restaurant inspections"',
            }}
          />
          <NarrationLayer
            title="What was found"
            functionName="formatToolResult"
            githubLines={STREAMING_SOURCE_LINES.formatToolResult}
            description="Summarizes the data returned by each tool call."
            example={{
              raw: '{ results: [...], count: 5 }',
              displayed: 'Found 5 datasets matching the search',
            }}
          />
          <NarrationLayer
            title="Why this step"
            functionName="generateToolReason"
            githubLines={STREAMING_SOURCE_LINES.generateToolReason}
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
          On this site, click &ldquo;How is this narration generated?&rdquo; near the step
          summary to see this explanation in context.
        </div>
      </section>

      {/* ============================================================
          Section 6: What Affects Response Quality
          ============================================================ */}
      <section id={SECTIONS.qualityFactors.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.qualityFactors.heading}</h2>

        <p style={prose}>
          Several additional factors affect the quality of AI responses beyond data access.
          These factors affect every query, whether you&apos;re exploring data on this site or building your own tools.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
                    <td style={{ padding: '8px 12px' }}>Browser (this site)</td>
                    <td style={{ padding: '8px 12px' }}>Quick questions, exploration</td>
                    <td style={{ padding: '8px 12px' }}>A daily question limit</td>
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
              and the response itself all compete for that space. This site uses a fresh context for
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
      <section id={SECTIONS.modelSelection.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.modelSelection.heading}</h2>

        <p style={prose}>
          In October 2026 we ran nine AI models on 14 of the civic data questions first used in March. We scored every
          answer against a rubric. For the 11 questions that need data, we also checked the main answer against figures
          read directly from the portals. Three of the four models that led that run are the Claude models below. In
          November 2026 we ran two of them again on 15 questions, beside three open-weight models. We added the
          open-weight model that came closest to them on answer quality. The November run did not check answers against
          figures from the portals. This site offers the four models below:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
          <div style={card}>
            <h3 style={{ fontSize: '16px', marginBottom: '6px' }}>Claude Haiku 5.5 (recommended)</h3>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6' }}>
              The model this site starts on. In the October 2026 run it got the main answer right on 8
              of 11 questions, and partly right on the other three, at about half a cent a question in
              that run: under a tenth of what Sonnet 5.5 and Opus 5.5 cost. It was also the fastest of
              those three, with a median of 15 seconds.
            </p>
          </div>

          <div style={card}>
            <h3 style={{ fontSize: '16px', marginBottom: '6px' }}>Claude Sonnet 5.5 (balanced)</h3>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6' }}>
              Stronger analysis at moderate cost. In the October 2026 run it got the main answer right on 9 of 11
              questions. It cost about 11 cents a question and took a median of 21 seconds.
            </p>
          </div>

          <div style={card}>
            <h3 style={{ fontSize: '16px', marginBottom: '6px' }}>Claude Opus 5.5 (premium)</h3>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6' }}>
              The highest quality score in the October 2026 run, with the main answer right on all 11
              questions. It was the slowest of the three in that run (a median of 27 seconds) and costs
              about 21 cents a question: worth it for complex or multi-step questions.
            </p>
          </div>

          <div style={card}>
            <h3 style={{ fontSize: '16px', marginBottom: '6px' }}>MiMo-V2.6-Flash (open-weight)</h3>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: '1.6' }}>
              An open-weight model: its maker, Xiaomi, publishes the trained model itself, not only
              access to it. In the November 2026 run it came closest of the three open-weight models to
              the Claude models on answer quality, at about a third of a cent a question, the lowest
              cost in that run. It was also the slowest model in that run, with a median of about 25
              seconds.
            </p>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: '1.6' }}>
              This site reaches it through OpenRouter, which passes each question to one of several
              companies that run the model. This site lets only three of those companies answer its
              questions: Cohere, GMICloud and Xiaomi. OpenRouter picks among the three for each
              question, and if none of them can take it, the question fails rather than going to
              another company.
            </p>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: '1.6' }}>
              In the November 2026 run its questions went to three of those companies: Cohere, GMICloud
              and Xiaomi. OpenRouter lists all three as keeping the prompts they receive: Cohere and
              Xiaomi for 30 days, and GMICloud for a period it does not state. The evaluation
              recorded two conflicts. For this model, OpenRouter also
              lists Cohere as keeping nothing, while Cohere&rsquo;s own page says prompts are kept for
              30 days and then deleted, unless zero retention has been approved. GMICloud&rsquo;s
              console terms say it does not keep a customer&rsquo;s inputs after categorizing them unless
              the customer opts in to prompt logging, and which GMICloud agreement covers
              OpenRouter&rsquo;s traffic is not stated.
            </p>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6' }}>
              Each listing and each company&rsquo;s own words are recorded in{' '}
              <a
                href="https://github.com/npstorey/civic-ai-tools-website/blob/main/docs/model-evaluation-2026-11.md#the-providers-a8"
                target="_blank"
                rel="noopener noreferrer"
              >
                the November 2026 evaluation
              </a>
              .
            </p>
          </div>
        </div>

        <p style={prose}>
          When an author publishes an analysis they had kept private, a second model first reviews it against a fixed
          checklist. The reviewer is the first model on this site&apos;s list of reviewers that did not write the
          analysis. Earlier analyses keep the model names recorded with them.
        </p>

        <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
          Full evaluation methodology and results (November 2026, with three open-weight models):{' '}
          <a
            href="https://github.com/npstorey/civic-ai-tools-website/blob/main/docs/model-evaluation-2026-11.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            model-evaluation-2026-11.md
          </a>
          . The October 2026 evaluation:{' '}
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
      <section id={SECTIONS.aiLimitations.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.aiLimitations.heading}</h2>

        <p style={prose}>
          Even with live data access, AI answers can contain errors. With civic data questions, common failure patterns
          include:
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
      <section id={SECTIONS.tryIt.id} style={sectionSpacing}>
        <h2 style={sectionHeading}>{SECTIONS.tryIt.heading}</h2>

        <p style={prose}>
          Try these queries on the home page to see different capabilities:
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

        {/* P10-19 (site Q3 = P): the setup's one home is /project. */}
        <p style={prose}>
          To run these tools on your own computer, see <Link href="/project#run-it-yourself">Run it yourself</Link> on
          the project page.
        </p>
      </section>

      {/* ============================================================
          Section 8: Learn More
          ============================================================ */}
      <section id={SECTIONS.learnMore.id}>
        <h2 style={sectionHeading}>{SECTIONS.learnMore.heading}</h2>

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
            &larr; Ask a question
          </Link>
        </div>
      </section>
    </Page>
  );
}

/* ================================================================
   Helper components (server components — no 'use client' needed)
   ================================================================ */

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
          href={`${STREAMING_SOURCE_BASE}${githubLines}`}
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
