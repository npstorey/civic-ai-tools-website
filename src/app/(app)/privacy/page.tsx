import { prose, sectionHeading, sectionSpacing } from '@/styles/page-styles';
import { pageTitle } from '@/lib/brand-config';
import { resolveAnalytics } from '@/lib/analytics';
import { buildPrivacySections, type Segment, type Statement } from '@/lib/privacy-facts';

/**
 * `/privacy` (#516 P7): what this instance does with what a reader sends,
 * every sentence computed from its configuration or stated from a named code
 * constant (`src/lib/privacy-facts.ts`). Served on every host
 * (`DUAL_SERVED_PATHS`, ruling G0-4) and linked from the footer, which the
 * root layout renders on both surfaces.
 *
 * Rendered per request, so a container's runtime environment decides it. The
 * one exception is analytics: a build-time choice, read here by literal name
 * exactly as the root layout reads it, so `next build` inlines the same values
 * into both and the page names the service whose tag the layout renders.
 *
 * Each statement carries its traces in `data-trace`: the variables it reads
 * and the constants it states. A statement with a list renders as one element
 * holding its lead, the list and any text after it, so the traces cover every
 * item. The page renders no other text but headings (`privacy-page.test.ts`).
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: pageTitle('Privacy'),
  description: "What this site does with what you send it, read from this site's configuration.",
};

function renderSegment(segment: Segment, key: number) {
  if (typeof segment === 'string') return segment;
  if ('link' in segment) {
    return (
      <a key={key} href={segment.link} target="_blank" rel="noopener noreferrer">
        {segment.text}
      </a>
    );
  }
  return (
    <code key={key} style={{ fontSize: '14px' }}>
      {segment.code}
    </code>
  );
}

function StatementLine({ statement }: { statement: Statement }) {
  const traces = { 'data-statement': statement.id, 'data-trace': statement.traces.join(' ') };
  if (statement.items === undefined) {
    return (
      <p style={prose} {...traces}>
        {statement.parts.map(renderSegment)}
      </p>
    );
  }
  // A lead sentence, a bulleted list, and optionally text after it: one
  // statement, so one element carries the traces for all of it.
  return (
    <div {...traces}>
      <p style={{ ...prose, marginBottom: '8px' }}>{statement.parts.map(renderSegment)}</p>
      <ul style={{ ...prose, paddingLeft: '20px', marginTop: 0 }}>
        {statement.items.map((item, i) => (
          <li key={i}>{item.map(renderSegment)}</li>
        ))}
      </ul>
      {statement.after && <p style={prose}>{statement.after.map(renderSegment)}</p>}
    </div>
  );
}

export default function PrivacyPage() {
  const analytics = resolveAnalytics({
    NEXT_PUBLIC_ANALYTICS_SERVICE: process.env.NEXT_PUBLIC_ANALYTICS_SERVICE,
    NEXT_PUBLIC_ANALYTICS_ID: process.env.NEXT_PUBLIC_ANALYTICS_ID,
    NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  });
  const sections = buildPrivacySections(analytics);

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ marginBottom: '32px' }}>Privacy</h1>
      {sections.map((section) => (
        <section key={section.id} id={section.id} style={{ ...sectionSpacing, marginBottom: '40px' }}>
          <h2 style={sectionHeading}>{section.heading}</h2>
          {section.statements.map((statement) => (
            <StatementLine key={statement.id} statement={statement} />
          ))}
        </section>
      ))}
    </div>
  );
}
