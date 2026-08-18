import type { Metadata } from 'next';
import { getRoadmapMarkdown } from '@/lib/roadmap/data';
import AudienceRoutingStrip from '@/components/roadmap/AudienceRoutingStrip';
import RoadmapBody from '@/components/roadmap/RoadmapBody';
import { getBrandName, pageTitle } from '@/lib/brand-config';
import { getRoadmapSource, type RoadmapSource } from '@/lib/site-config';

// A roadmap is first-person content: "our plans". An instance that has not
// published one renders the unpublished state below rather than another
// project's roadmap under its own brand (#241) — and the nav drops the link,
// so the page is a destination for anyone who has the URL, not a dead end in
// the header. `generateMetadata` (not a static `metadata` object) so the
// source is read at call time, like every other instance-config read.
export async function generateMetadata(): Promise<Metadata> {
  // `brand` is null on an instance that has not set SITE_BRAND_NAME (#259
  // P4, A3). The description then says "This site" rather than naming a
  // deployment that is not this one; the title drops its suffix.
  const brand = getBrandName();
  const subject = brand ?? 'This site';
  const source = getRoadmapSource();
  return {
    title: pageTitle('Roadmap'),
    description: source
      ? `The public roadmap for ${subject} — what is planned and what is underway. Rendered from ${source.label}.`
      : `${subject} has not published a roadmap.`,
  };
}

export default async function RoadmapPage() {
  const source = getRoadmapSource();

  if (!source) {
    return (
      <RoadmapShell>
        <RoadmapUnpublished />
      </RoadmapShell>
    );
  }

  const result = await getRoadmapMarkdown(source.rawUrl);

  return (
    <RoadmapShell>
      <p
        style={{
          fontSize: '13px',
          color: 'var(--text-muted)',
          marginBottom: '32px',
          marginTop: 0,
        }}
      >
        {/* Label and link are both derived from the configured source, so an
            instance that re-points the roadmap cannot end up with a correct
            link under the reference project's file name. */}
        Renders from{' '}
        <a href={source.viewUrl} target="_blank" rel="noopener noreferrer">
          {source.label}
        </a>
        .
      </p>

      {result.ok && result.markdown ? (
        <RoadmapBody markdown={result.markdown} />
      ) : (
        <RoadmapStub source={source} />
      )}

      {/* The routing strip's cards point at the reference project's own hub
          docs — content that belongs with the reference project's roadmap,
          not with an instance's. It renders only alongside a rendered
          roadmap; making its cards configurable is a roadmap-change issue
          (see the component header, website#94). */}
      <AudienceRoutingStrip />
    </RoadmapShell>
  );
}

function RoadmapShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ marginBottom: '8px' }}>Roadmap</h1>
      {children}
    </div>
  );
}

function RoadmapUnpublished() {
  return (
    <div
      style={{
        backgroundColor: 'var(--card-background)',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        padding: '24px',
        fontSize: '16px',
        lineHeight: '1.7',
        color: 'var(--text-secondary)',
        marginTop: '24px',
      }}
    >
      <p style={{ margin: 0 }}>This site has not published a roadmap.</p>
      <p style={{ margin: '12px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
        Running this site? Point <code>ROADMAP_RAW_URL</code> at the raw Markdown of your own
        roadmap and redeploy — this page renders it, and the link returns to the nav. See{' '}
        <code>docs/deploy.md</code> in this codebase.
      </p>
    </div>
  );
}

function RoadmapStub({ source }: { source: RoadmapSource }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--card-background)',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        padding: '24px',
        fontSize: '16px',
        lineHeight: '1.7',
        color: 'var(--text-secondary)',
      }}
    >
      <p style={{ margin: '0 0 12px 0' }}>The roadmap could not be loaded right now.</p>
      <p style={{ margin: 0 }}>
        Read the canonical version at{' '}
        <a href={source.viewUrl} target="_blank" rel="noopener noreferrer">
          {source.label}
        </a>
        .
      </p>
    </div>
  );
}
