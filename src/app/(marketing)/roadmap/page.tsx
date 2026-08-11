import type { Metadata } from 'next';
import { getRoadmapMarkdown } from '@/lib/roadmap/data';
import AudienceRoutingStrip from '@/components/roadmap/AudienceRoutingStrip';
import RoadmapBody from '@/components/roadmap/RoadmapBody';
import { getBrandName } from '@/lib/brand-config';
import { getRoadmapGithubUrl } from '@/lib/site-config';

export const metadata: Metadata = {
  title: `Roadmap - ${getBrandName()}`,
  description:
    'The civic-ai-tools public roadmap — vision pillars, trust commitments, near-term plans, and how the evidence-system fork resolved (toward a domain-neutral, spec-first protocol). Mirrored from the hub repo.',
};

export default async function RoadmapPage() {
  const result = await getRoadmapMarkdown();

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ marginBottom: '8px' }}>Roadmap</h1>
      <p
        style={{
          fontSize: '13px',
          color: 'var(--text-muted)',
          marginBottom: '32px',
          marginTop: 0,
        }}
      >
        Renders from{' '}
        <a href={getRoadmapGithubUrl()} target="_blank" rel="noopener noreferrer">
          civic-ai-tools/ROADMAP.md
        </a>
        .
      </p>

      {result.ok && result.markdown ? (
        <RoadmapBody markdown={result.markdown} />
      ) : (
        <RoadmapStub />
      )}

      <AudienceRoutingStrip />
    </div>
  );
}

function RoadmapStub() {
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
      <p style={{ margin: '0 0 12px 0' }}>
        The roadmap could not be loaded from GitHub right now.
      </p>
      <p style={{ margin: 0 }}>
        Read the canonical version at{' '}
        <a href={getRoadmapGithubUrl()} target="_blank" rel="noopener noreferrer">
          civic-ai-tools/ROADMAP.md
        </a>
        .
      </p>
    </div>
  );
}
